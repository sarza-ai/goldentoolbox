'use strict';
/* Golden Toolbox — Business Checkup pipeline orchestrator.

   The seam between "mock" and "real". buildReportMock produces a full baseline;
   real adapters (PageSpeed, HTML scan, Places) are spliced in per-category
   here, so the endpoints and UI never change. Any adapter that throws falls
   back to the mock value for that category.

   PageSpeed / HTML-scan / Places are mutually independent as *inputs* (each
   only needs the original business object), so their network calls run
   concurrently — important because PageSpeed alone can take up to 30s, and
   Vercel's function ceiling is 60s. But HTML-scan and Places both patch the
   same 'directory' category (Facebook row vs Google row), so *applying*
   results has to stay strictly sequential after all fetches land, or one
   patch can silently clobber the other's write. Hence the two-phase shape
   below: fetchX() functions never touch `report`, only runPipeline does. */

const { buildReportMock, finalizeCategory } = require('./mock');
const { CATEGORIES, rollup, grade } = require('./config');
const { runPerformance } = require('./pagespeed');
const { fetchSiteHtml, buildTechnoStack, buildBusinessDetails, detectChat, detectFacebookLink } = require('./htmlscan');
const { buildSpeedToLead } = require('./speedtolead');
const { patchDirectoryRow } = require('./directory');
const places = require('./places');
const yelp = require('./yelp');
const store = require('./store');
// NOTE: Yelp's automated API path is dormant (free Fusion tier discontinued,
// now $229+/mo, fails the zero-cost requirement). The live Yelp path is
// manual-only, for admin-triggered sales-call prep — see opts.yelpManual
// below. Public form submissions never set that option, so it can't be
// triggered from the public funnel.

const PLACES_DAILY_CAP = parseInt(process.env.PLACES_DAILY_CAP || '300', 10);

function replaceCategory(report, id, built) {
  const def = CATEGORIES.find((d) => d.id === id);
  const idx = report.categories.findIndex((c) => c.id === id);
  if (!def || idx === -1) return;
  report.categories[idx] = finalizeCategory(def, built);
}

// --- fetch phase: network only, never touches `report` --------------------
async function fetchPerformance(business) {
  if (!(process.env.PAGESPEED_API_KEY && business.website)) return null;
  try {
    return await runPerformance(business.website);
  } catch (e) {
    console.error('[pipeline] pagespeed fell back to mock:', e.message);
    return null;
  }
}

async function fetchHtmlScan(business) {
  if (!business.website) return null;
  try {
    const fetched = await fetchSiteHtml(business.website);
    if (!fetched.ok) {
      console.error('[pipeline] site-html-fetch fell back to mock:', fetched.error);
      return null;
    }
    return fetched;
  } catch (e) {
    console.error('[pipeline] htmlscan fell back to mock:', e.message);
    return null;
  }
}

async function fetchPlaces(business) {
  const hasRealPlaceId = business.placeId && !String(business.placeId).startsWith('mock_');
  if (!(process.env.GOOGLE_PLACES_API_KEY && hasRealPlaceId)) return null;
  const budget = await store.checkApiBudget('places', PLACES_DAILY_CAP);
  if (!budget.allowed) {
    console.error(`[pipeline] places daily budget exceeded (${budget.used}/${budget.cap}), falling back to mock`);
    return null;
  }
  try {
    const details = await places.placeDetails(business.placeId);
    const { city, state } = places.cityStateFromAddress(details);
    let compResults = [];
    try {
      compResults = await places.competitorSearch(business.trade, city || business.city, state || business.state);
    } catch (e) {
      console.error('[pipeline] places competitor search failed:', e.message);
    }
    await store.bumpApiBudget('places', 2); // 1 details + 1 text search
    return { details, city, state, compResults };
  } catch (e) {
    console.error('[pipeline] places fell back to mock:', e.message);
    return null;
  }
}

async function runPipeline(business, opts = {}) {
  const startedAt = Date.now();
  const report = buildReportMock(business); // baseline (all mock)
  const live = [];

  // --- concurrent fetch phase: the slow part, now running in parallel ---
  const [perfResult, htmlResult, placesResult] = await Promise.all([
    fetchPerformance(business),
    fetchHtmlScan(business),
    fetchPlaces(business),
  ]);

  // --- sequential apply phase: fast, CPU-only, no more network calls ---

  // #2: PageSpeed
  if (perfResult) {
    replaceCategory(report, 'performance', perfResult);
    live.push('performance');
    report.apiCalls = report.apiCalls.map((c) =>
      c.category === 'performance' ? Object.assign({}, c, { live: true }) : c);
  }

  // #3: HTML scan — techstack, business details, + #6a Facebook directory row
  let fetchedHtml = null; // shared with #5's after-hours-path detection below
  let chatFoundOnSite = false;
  if (htmlResult) {
    fetchedHtml = htmlResult.html;
    chatFoundOnSite = detectChat(htmlResult.html).found;

    const techBuilt = buildTechnoStack(htmlResult.html);
    replaceCategory(report, 'techno-stack', techBuilt);
    live.push('techno-stack');

    const priorReplyRate = report.categories.find((c) => c.id === 'business-details').details.reviewReplyRate;
    const bizBuilt = buildBusinessDetails(htmlResult.html, priorReplyRate);
    replaceCategory(report, 'business-details', bizBuilt);
    live.push('business-details');

    report.apiCalls = report.apiCalls.map((c) =>
      (c.category === 'techno-stack' || c.category === 'business-details')
        ? Object.assign({}, c, { live: true }) : c);

    // Meta locked down free business search, so instead of searching we check
    // whether the business already links its own Facebook page from its own
    // site — a link they placed themselves is strong evidence either way.
    const fbLink = detectFacebookLink(htmlResult.html);
    const priorDirForFb = report.categories.find((c) => c.id === 'directory').details;
    const fbPatch = fbLink.found
      ? patchDirectoryRow(priorDirForFb, 'Facebook', { listed: true, accuracy: 70, live: true, displayValue: 'Listed (found on your site)' })
      : patchDirectoryRow(priorDirForFb, 'Facebook', { listed: false, accuracy: 0, live: true, displayValue: 'Not linked from your site' });
    replaceCategory(report, 'directory', fbPatch);
    live.push('directory');
    report.apiCalls = report.apiCalls.map((c) =>
      c.category === 'directory' ? Object.assign({}, c, { live: true }) : c);
  }

  // #4: Places — GBP, reviews, directory-Google, competitors
  if (placesResult) {
    const { details, city, state, compResults } = placesResult;
    report.business = Object.assign({}, report.business, {
      address: details.formatted_address || report.business.address,
      phone: details.formatted_phone_number || details.international_phone_number || report.business.phone,
      website: details.website || report.business.website,
      city: city || report.business.city,
      state: state || report.business.state,
    });

    replaceCategory(report, 'gbp', places.buildGbp(details));
    live.push('gbp');

    const priorReplyRate = report.categories.find((c) => c.id === 'reputation').details.replyRate;
    replaceCategory(report, 'reputation', places.buildReputation(details, priorReplyRate));
    live.push('reputation');

    const priorDirDetails = report.categories.find((c) => c.id === 'directory').details;
    replaceCategory(report, 'directory', places.buildDirectoryPatch(priorDirDetails));
    live.push('directory');

    replaceCategory(report, 'competitors', places.buildCompetitors(compResults, business, details));
    live.push('competitors');

    report.apiCalls = report.apiCalls.map((c) =>
      ['gbp', 'reputation', 'directory', 'competitors'].includes(c.category)
        ? Object.assign({}, c, { live: true }) : c);
  }

  // #6c: Yelp, manual-only (admin sales-call prep). Zero API cost — nothing
  // to add to apiCalls, just patches the row. Runs after Places/HTML-scan so
  // a deliberate manual entry always wins over their automated counterparts.
  if (opts.yelpManual) {
    try {
      const priorDirForYelp = report.categories.find((c) => c.id === 'directory').details;
      replaceCategory(report, 'directory', yelp.buildManualPatch(priorDirForYelp, opts.yelpManual));
      live.push('directory');
    } catch (e) {
      console.error('[pipeline] yelp manual patch failed:', e.message);
    }
  }

  // #5: phone type estimate (offline, free, no network — always runs when a
  // phone number exists) + after-hours path (reuses the HTML fetch above, if any)
  if (business.phone) {
    try {
      const built = buildSpeedToLead(business.phone, chatFoundOnSite, fetchedHtml);
      replaceCategory(report, 'speed-to-lead', built);
      live.push('speed-to-lead');
      report.apiCalls = report.apiCalls.map((c) =>
        c.category === 'speed-to-lead' ? Object.assign({}, c, { live: true }) : c);
    } catch (e) {
      console.error('[pipeline] speed-to-lead fell back to mock:', e.message);
    }
  }

  // --- recompute rollup after any real splices ---
  report.overall = rollup(report.categories);
  const g = grade(report.overall);
  report.overallGrade = g.label;
  report.overallBand = g.band;

  report.liveSources = Array.from(new Set(live));
  report.mock = report.liveSources.length < CATEGORIES.length; // any category still mock
  report.slug = store.makeSlug(business);
  report.createdAt = new Date().toISOString();
  report.source = opts.source || 'form';
  report.durationMs = Date.now() - startedAt;

  await store.putCachedReport(business, report.slug, report);

  await store.logGeneration({
    slug: report.slug,
    business: business.name,
    domain: business.domain,
    source: report.source,
    overall: report.overall,
    liveSources: report.liveSources,
    apiCalls: report.apiCalls,
    durationMs: report.durationMs,
  });

  return report;
}

module.exports = { runPipeline };
