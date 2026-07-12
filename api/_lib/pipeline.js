'use strict';
/* Golden Toolbox — Business Checkup pipeline orchestrator.

   The seam between "mock" and "real". buildReportMock produces a full baseline;
   real adapters (PageSpeed, HTML scan, Places, Gemini) are spliced in
   per-category here, so the endpoints and UI never change. Any adapter that
   throws or returns nothing falls back to the mock value for that category.

   PageSpeed / HTML-scan / Places are mutually independent as *inputs* (each
   only needs the original business object), so their network calls run
   concurrently — important because PageSpeed alone can take up to 30s and
   Vercel's function ceiling is 60s. Visibility is assembled from BOTH Places
   (GBP) and the HTML scan (site fundamentals), so results are only *applied*
   after all fetches land — the two-phase shape keeps one source from clobbering
   another. Content Quality runs last (it needs the fetched HTML) and is the
   only step that may add a short extra call. */

const { buildReportMock, finalizeCategory } = require('./mock');
const { CATEGORIES, rollup, grade } = require('./config');
const { runPerformance } = require('./pagespeed');
const {
  fetchSiteHtml, buildCustomerExperience, buildLeadCapture, buildTrustSignals,
  siteSignalsForVisibility, isThinShell,
} = require('./htmlscan');
const { parseStructuredData } = require('./structured');
const { buildContentQuality } = require('./content');
const places = require('./places');
const store = require('./store');

const PLACES_DAILY_CAP = parseInt(process.env.PLACES_DAILY_CAP || '300', 10);

function replaceCategory(report, id, built) {
  const def = CATEGORIES.find((d) => d.id === id);
  const idx = report.categories.findIndex((c) => c.id === id);
  if (!def || idx === -1 || !built) return false;
  report.categories[idx] = finalizeCategory(def, built);
  return true;
}

function markLive(report, ids) {
  report.apiCalls = report.apiCalls.map((c) =>
    ids.includes(c.category) ? Object.assign({}, c, { live: true }) : c);
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

  // --- concurrent fetch phase: the slow part, running in parallel ---
  const [perfResult, htmlResult, placesResult] = await Promise.all([
    fetchPerformance(business),
    fetchHtmlScan(business),
    fetchPlaces(business),
  ]);

  // --- sequential apply phase: fast, CPU-only (except Content Quality) ---

  // Rendered signals from PageSpeed's real headless-Chrome run — reused across
  // categories so an SPA that hides content from the raw fetch is still read.
  const rendered = perfResult && perfResult.rendered ? perfResult.rendered : null;

  // Website Performance (PageSpeed)
  if (perfResult && replaceCategory(report, 'performance', perfResult.category)) {
    live.push('performance');
    markLive(report, ['performance']);
  }

  // Shared per-scan context: structured data recovered from the HTML (JSON-LD /
  // OpenGraph — present even on SPAs), the PageSpeed rendered signals, and
  // whether the page is a thin JS shell (so builders mark unreadable checks
  // neutral instead of failing them).
  let fetchedHtml = null, siteSignals = null;
  const structured = htmlResult ? parseStructuredData(htmlResult.html) : {};
  const thinShell = htmlResult ? isThinShell(htmlResult.html) : false;
  const ctx = { structured, rendered: rendered || {}, thinShell };

  // Visibility's site half is available if EITHER the HTML fetch OR the
  // PageSpeed render succeeded (heavy SPAs often fail the raw fetch but render
  // fine in PageSpeed).
  if (htmlResult || rendered) {
    siteSignals = siteSignalsForVisibility(
      htmlResult ? htmlResult.html : null,
      htmlResult ? htmlResult.finalUrl : '',
      ctx,
    );
  }

  // HTML-derived categories: Customer Experience, Lead Capture, Trust Signals
  if (htmlResult) {
    fetchedHtml = htmlResult.html;
    const applied = [];
    if (replaceCategory(report, 'customer-experience', buildCustomerExperience(fetchedHtml, htmlResult.finalUrl, ctx))) applied.push('customer-experience');
    if (replaceCategory(report, 'lead-capture', buildLeadCapture(fetchedHtml, business.phone, ctx))) applied.push('lead-capture');
    if (replaceCategory(report, 'trust-signals', buildTrustSignals(fetchedHtml, ctx))) applied.push('trust-signals');
    live.push(...applied);
    markLive(report, applied);
  }

  // Places-derived: Reputation, Visibility (GBP + site signals), Competitors
  if (placesResult) {
    const { details, city, state, compResults } = placesResult;
    report.business = Object.assign({}, report.business, {
      address: details.formatted_address || report.business.address,
      phone: details.formatted_phone_number || details.international_phone_number || report.business.phone,
      website: details.website || report.business.website,
      city: city || report.business.city,
      state: state || report.business.state,
    });

    const applied = [];
    if (replaceCategory(report, 'reputation', places.buildReputation(details))) applied.push('reputation');
    if (replaceCategory(report, 'visibility', places.buildVisibility(details, siteSignals))) applied.push('visibility');
    if (replaceCategory(report, 'competitors', places.buildCompetitors(compResults, business, details))) applied.push('competitors');
    live.push(...applied);
    markLive(report, applied);
  }

  // Content Quality — Gemini vision on the PageSpeed-rendered screenshot when
  // the raw HTML is a thin shell, else Gemini text, else the free heuristic.
  // Runs when we have either readable HTML or a rendered screenshot.
  if (fetchedHtml || (rendered && rendered.screenshotDataUri)) {
    try {
      const cq = await buildContentQuality(fetchedHtml, business, ctx);
      if (replaceCategory(report, 'content-quality', cq)) {
        live.push('content-quality');
        markLive(report, ['content-quality']);
      }
    } catch (e) {
      console.error('[pipeline] content-quality fell back to mock:', e.message);
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
