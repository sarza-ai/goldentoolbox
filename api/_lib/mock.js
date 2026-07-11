'use strict';
/* Golden Toolbox — Business Checkup MOCK data engine.
   Everything here is deterministic from the business inputs so a given
   business always renders the same report. Each function is a stand-in for a
   real adapter (Places, PageSpeed, HTML scan) wired in later priorities. */

const { rng, normalizeDomain, titleCase, rankByRating } = require('./util');
const { CATEGORIES, grade, rollup, framingFor } = require('./config');

const TRADES = [
  ['concrete', 'Concrete'], ['plumb', 'Plumbing'], ['hvac', 'HVAC'],
  ['heating', 'HVAC'], ['cooling', 'HVAC'], ['air', 'HVAC'],
  ['electric', 'Electrical'], ['roof', 'Roofing'], ['landscap', 'Landscaping'],
  ['lawn', 'Landscaping'], ['paint', 'Painting'], ['fenc', 'Fencing'],
  ['garage', 'Garage Doors'], ['tree', 'Tree Service'], ['pressure', 'Pressure Washing'],
  ['remodel', 'Remodeling'], ['handyman', 'Handyman'], ['strip', 'Striping'],
  ['radon', 'Radon Testing'], ['fireplace', 'Fireplace Service'],
];

const CITIES = [
  ['Denver', 'CO'], ['Aurora', 'CO'], ['Austin', 'TX'], ['Dallas', 'TX'],
  ['Phoenix', 'AZ'], ['Tampa', 'FL'], ['Charlotte', 'NC'], ['Columbus', 'OH'],
  ['Nashville', 'TN'], ['Boise', 'ID'], ['Kansas City', 'MO'], ['Tucson', 'AZ'],
];

function guessTrade(name) {
  const n = String(name || '').toLowerCase();
  for (const [kw, label] of TRADES) if (n.includes(kw)) return label;
  return 'Home Services';
}

// --- Places resolution stand-in -------------------------------------------
// Real version: Google Places Find Place / Text Search by name+phone, domain
// as secondary signal. Returns a confident match OR 1-3 candidates to confirm.
function resolveBusinessMock(form) {
  const domain = normalizeDomain(form.website);
  const seedStr = domain || (form.business + '|' + (form.phone || ''));
  const r = rng('resolve|' + seedStr);
  const [city, state] = r.pick(CITIES);
  const trade = guessTrade(form.business);

  const streetNo = r.int(120, 9800);
  const streets = ['Main St', 'Commerce Dr', 'Industrial Way', 'Oak Ave', 'Pearl St', 'Colfax Ave', 'Broadway', 'Grand Blvd'];
  const address = `${streetNo} ${r.pick(streets)}, ${city}, ${state}`;

  const base = {
    name: titleCase(form.business),
    website: form.website || '',
    domain,
    phone: form.phone || '',
    email: form.email || '',
    address,
    city, state,
    trade,
    placeId: 'mock_' + Math.abs(r.int(100000, 999999)),
  };

  // Confidence: a real Places lookup is confident when one result clearly wins.
  // Mock stand-in: confident with domain+phone, but deterministically ambiguous
  // ~30% of the time so the "confirm your business" step is reachable/demoable.
  const ambiguous = rng('ambig|' + seedStr).chance(0.3);
  const confident = !!domain && !!form.phone && !ambiguous;

  if (confident) {
    return { confident: true, business: base };
  }

  // Build 1-3 plausible candidates for the confirm step.
  const n = r.int(1, 3);
  const candidates = [];
  for (let i = 0; i < n; i++) {
    const rr = rng('cand|' + seedStr + '|' + i);
    const [c2, s2] = i === 0 ? [city, state] : rr.pick(CITIES);
    candidates.push({
      name: base.name + (i === 0 ? '' : rr.pick([' LLC', ' & Sons', ' Co.', ' Services'])),
      address: `${rr.int(120, 9800)} ${rr.pick(streets)}, ${c2}, ${s2}`,
      phone: base.phone || `(${rr.int(200, 989)}) ${rr.int(200, 989)}-${String(rr.int(0, 9999)).padStart(4, '0')}`,
      placeId: 'mock_' + Math.abs(rr.int(100000, 999999)),
      city: c2, state: s2,
      rating: (rr.int(35, 49) / 10).toFixed(1),
      reviews: rr.int(4, 90),
    });
  }
  return { confident: false, candidates, base };
}

// --- individual category mocks --------------------------------------------
const CHAT_PROVIDERS = ['Intercom', 'Drift', 'Tidio', 'Tawk.to', 'LiveChat', 'Facebook Messenger', 'HubSpot Chat', 'Zendesk Chat'];
const HOSTS = ['WordPress', 'Wix', 'Squarespace', 'GoDaddy Website Builder', 'Duda', 'Webflow', 'Custom / Unknown'];

function catBusinessDetails(r) {
  const hasChat = r.chance(0.35);
  const chatProvider = hasChat ? r.pick(CHAT_PROVIDERS) : null;
  const host = r.pick(HOSTS);
  const replyRate = r.int(0, 85);
  let score = 30;
  if (hasChat) score += 30;
  if (host !== 'Custom / Unknown') score += 12;
  score += Math.round(replyRate * 0.3);
  return {
    score: Math.min(100, score),
    summary: hasChat
      ? `We detected a ${chatProvider} chat widget on your site.`
      : 'No live chat or instant-answer widget detected on your site.',
    details: {
      chatWidget: hasChat,
      chatProvider,
      hostingPlatform: host,
      reviewReplyRate: replyRate,
    },
    checks: [
      { label: 'Live chat / instant answers', ok: hasChat, value: hasChat ? chatProvider : 'Not found' },
      { label: 'Hosting platform detected', ok: host !== 'Custom / Unknown', value: host },
      { label: 'Review reply rate', ok: replyRate >= 50, value: replyRate + '%' },
    ],
  };
}

function catTechnoStack(r) {
  const t = {
    googleAnalytics: r.chance(0.55),
    googleTagManager: r.chance(0.4),
    googleAds: r.chance(0.3),
    googleAdsConversion: r.chance(0.22),
    metaPixel: r.chance(0.33),
  };
  const found = Object.values(t).filter(Boolean).length;
  const score = Math.round((found / 5) * 100);
  return {
    score,
    summary: found === 0
      ? 'No analytics or ad tracking found — you are flying blind.'
      : `We found ${found} of 5 key tracking tags installed.`,
    details: t,
    checks: [
      { label: 'Google Analytics', ok: t.googleAnalytics, value: t.googleAnalytics ? 'Installed' : 'Missing' },
      { label: 'Google Tag Manager', ok: t.googleTagManager, value: t.googleTagManager ? 'Installed' : 'Missing' },
      { label: 'Google Ads tag', ok: t.googleAds, value: t.googleAds ? 'Installed' : 'Missing' },
      { label: 'Google Ads conversion', ok: t.googleAdsConversion, value: t.googleAdsConversion ? 'Installed' : 'Missing' },
      { label: 'Meta (Facebook) Pixel', ok: t.metaPixel, value: t.metaPixel ? 'Installed' : 'Missing' },
    ],
  };
}

function catGbp(r) {
  const photos = r.int(0, 40);
  const c = {
    verified: r.chance(0.7),
    hasWebsite: r.chance(0.85),
    hasHours: r.chance(0.75),
    hasPhone: r.chance(0.9),
    hasAddress: r.chance(0.8),
    photos,
  };
  let score = 0;
  if (c.verified) score += 24;
  if (c.hasWebsite) score += 16;
  if (c.hasHours) score += 16;
  if (c.hasPhone) score += 14;
  if (c.hasAddress) score += 14;
  score += Math.min(16, Math.round(photos / 2));
  return {
    score: Math.min(100, score),
    summary: c.verified
      ? 'Your Google Business Profile is claimed, with room to fill it out.'
      : 'Your Google Business Profile appears unverified — a major visibility gap.',
    details: c,
    checks: [
      { label: 'Profile verified', ok: c.verified, value: c.verified ? 'Yes' : 'No' },
      { label: 'Website linked', ok: c.hasWebsite, value: c.hasWebsite ? 'Yes' : 'No' },
      { label: 'Hours listed', ok: c.hasHours, value: c.hasHours ? 'Yes' : 'No' },
      { label: 'Phone listed', ok: c.hasPhone, value: c.hasPhone ? 'Yes' : 'No' },
      { label: 'Address listed', ok: c.hasAddress, value: c.hasAddress ? 'Yes' : 'No' },
      { label: 'Photos', ok: photos >= 10, value: photos + ' photos' },
    ],
  };
}

function catDirectory(r, business) {
  const dirs = ['Google', 'Yelp', 'Facebook'].map((name) => {
    const listed = name === 'Google' ? true : r.chance(0.6);
    const nameMatch = listed ? r.chance(0.9) : false;
    const phoneMatch = listed ? r.chance(0.75) : false;
    const addrMatch = listed ? r.chance(0.7) : false;
    const matched = [nameMatch, phoneMatch, addrMatch].filter(Boolean).length;
    return { name, listed, nameMatch, phoneMatch, addrMatch, accuracy: listed ? Math.round((matched / 3) * 100) : 0 };
  });
  const listedCount = dirs.filter((d) => d.listed).length;
  const avgAcc = Math.round(dirs.reduce((a, d) => a + d.accuracy, 0) / dirs.length);
  const score = Math.round(avgAcc * 0.6 + (listedCount / 3) * 40);
  return {
    score: Math.min(100, score),
    summary: `Listed on ${listedCount} of 3 major directories, ${avgAcc}% name/phone/address accuracy.`,
    details: { directories: dirs, accuracy: avgAcc },
    checks: dirs.map((d) => ({
      label: d.name,
      ok: d.listed && d.accuracy >= 66,
      value: d.listed ? d.accuracy + '% match' : 'Not listed',
    })),
  };
}

function catReputation(r, business) {
  const rating = r.int(31, 49) / 10;
  const count = r.int(3, 140);
  const replyRate = r.int(0, 90);
  // star distribution
  const five = r.int(40, 80), four = r.int(8, 25), three = r.int(2, 12);
  const two = r.int(0, 8), one = 100 - five - four - three - two;
  const dist = { 5: five, 4: four, 3: three, 2: Math.max(0, two), 1: Math.max(0, one) };
  const samples = [
    { author: 'Mike R.', rating: 5, text: 'Showed up on time, did great work, cleaned up after. Would use again.', reply: replyRate > 50 },
    { author: 'Sarah T.', rating: 4, text: 'Solid job overall, took a day longer than quoted but the result is great.', reply: replyRate > 70 },
    { author: 'Dan K.', rating: rating < 4 ? 2 : 5, text: rating < 4 ? 'Hard to get a callback. Work was fine once they showed.' : 'Best in town, hands down.', reply: false },
  ];
  let score = Math.round((rating / 5) * 55);
  score += Math.min(25, Math.round(count / 4));
  score += Math.round(replyRate * 0.2);
  return {
    score: Math.min(100, score),
    summary: `${rating.toFixed(1)}★ across ${count} Google reviews, ${replyRate}% of reviews get a reply.`,
    details: { rating, count, replyRate, distribution: dist, samples, source: 'Google (up to 5 most recent shown)' },
    checks: [
      { label: 'Average rating', ok: rating >= 4.3, value: rating.toFixed(1) + '★' },
      { label: 'Review volume', ok: count >= 40, value: count + ' reviews' },
      { label: 'Owner reply rate', ok: replyRate >= 50, value: replyRate + '%' },
    ],
  };
}

function catPerformance(r) {
  const mobile = r.int(22, 92);
  const desktop = Math.min(100, mobile + r.int(5, 25));
  const lcp = (r.int(18, 62) / 10); // seconds
  const cls = (r.int(0, 35) / 100);
  const inp = r.int(90, 480); // ms
  const score = Math.round(mobile * 0.7 + desktop * 0.3);
  const pass = (m, good, ok) => (m <= good ? 'good' : m <= ok ? 'warn' : 'bad');
  return {
    score,
    summary: `Mobile PageSpeed ${mobile}/100, desktop ${desktop}/100.`,
    details: {
      mobileScore: mobile, desktopScore: desktop,
      lcp, cls, inp,
      cwv: {
        lcp: { value: lcp + 's', band: pass(lcp, 2.5, 4.0) },
        cls: { value: cls.toFixed(2), band: pass(cls, 0.1, 0.25) },
        inp: { value: inp + 'ms', band: pass(inp, 200, 500) },
      },
    },
    checks: [
      { label: 'Mobile score', ok: mobile >= 70, value: mobile + '/100' },
      { label: 'Desktop score', ok: desktop >= 80, value: desktop + '/100' },
      { label: 'Largest Contentful Paint', ok: lcp <= 2.5, value: lcp + 's' },
      { label: 'Cumulative Layout Shift', ok: cls <= 0.1, value: cls.toFixed(2) },
      { label: 'Interaction to Next Paint', ok: inp <= 200, value: inp + 'ms' },
    ],
  };
}

function catSpeedToLead(r, business) {
  const types = ['Mobile', 'VoIP', 'Landline'];
  const phoneType = r.pick(types);
  const hasChat = r.chance(0.35);
  const hasBookingForm = r.chance(0.5);
  const afterHoursPath = hasChat || hasBookingForm;
  let score = 20;
  if (phoneType !== 'Landline') score += 25;
  if (hasChat) score += 30;
  if (hasBookingForm) score += 25;
  return {
    score: Math.min(100, score),
    summary: afterHoursPath
      ? 'You have at least one after-hours path, but a missed call still goes unanswered.'
      : 'Right now, a missed call after hours just goes to voicemail — and the next name down.',
    details: {
      phoneTypeEstimate: phoneType,
      estimated: true,
      afterHoursChat: hasChat,
      afterHoursBooking: hasBookingForm,
    },
    checks: [
      { label: 'Phone type (estimated)', ok: phoneType !== 'Landline', value: phoneType },
      { label: 'After-hours chat path', ok: hasChat, value: hasChat ? 'Yes' : 'No' },
      { label: 'Self-serve booking / callback form', ok: hasBookingForm, value: hasBookingForm ? 'Yes' : 'No' },
    ],
  };
}

function catCompetitors(r, business) {
  const youReviews = r.int(5, 60);
  const youRating = r.int(35, 47) / 10;
  const comps = [];
  const prefixes = ['Pro', 'Elite', 'Brothers', 'Premier', 'A-1', 'All Star', 'Summit', 'Reliable', 'Frontier', 'Cornerstone', 'Legacy', 'Ironclad'];
  // pick distinct prefixes so no two competitors share a name
  const pool = prefixes.slice();
  const n = r.int(5, 8);
  for (let i = 0; i < n; i++) {
    const rr = rng('comp|' + business.domain + '|' + i);
    const pfx = pool.splice(rr.int(0, pool.length - 1), 1)[0] || `Trade ${i + 1}`;
    comps.push({
      name: `${pfx} ${business.trade}`,
      reviews: rr.int(15, 210),
      rating: (rr.int(38, 50) / 10),
    });
  }
  comps.push({ name: business.name + ' (You)', reviews: youReviews, rating: youRating, you: true });
  const ranked = rankByRating(comps, (c) => c.rating, (c) => c.reviews);
  const rank = ranked.findIndex((c) => c.you) + 1;
  const top = ranked[0];
  const score = Math.round(Math.max(10, 100 - (rank - 1) * (90 / comps.length)));
  return {
    score,
    summary: `You rank #${rank} of ${comps.length} nearby ${business.trade} crews by reviews and rating.`,
    details: {
      rank, total: comps.length,
      leaderboard: ranked.map((c) => ({ name: c.name, reviews: c.reviews, rating: c.rating.toFixed(1), you: !!c.you })),
      top: { name: top.name, reviews: top.reviews, rating: top.rating.toFixed(1) },
    },
    checks: [
      { label: 'Local rank', ok: rank <= 3, value: `#${rank} of ${comps.length}` },
      { label: 'Your reviews vs. top', ok: youReviews >= top.reviews, value: `${youReviews} vs ${top.reviews}` },
      { label: 'Your rating vs. top', ok: youRating >= top.rating, value: `${youRating.toFixed(1)}★ vs ${top.rating.toFixed(1)}★` },
    ],
  };
}

const BUILDERS = {
  'business-details': (r, b) => catBusinessDetails(r, b),
  'techno-stack': (r, b) => catTechnoStack(r, b),
  'gbp': (r, b) => catGbp(r, b),
  'directory': (r, b) => catDirectory(r, b),
  'reputation': (r, b) => catReputation(r, b),
  'performance': (r, b) => catPerformance(r, b),
  'speed-to-lead': (r, b) => catSpeedToLead(r, b),
  'competitors': (r, b) => catCompetitors(r, b),
};

// The mock "API calls" a real run would have logged, for spend monitoring.
const MOCK_API_CALLS = {
  'business-details': [{ api: 'site-html-fetch', count: 1 }],
  'techno-stack': [{ api: 'site-html-fetch', count: 1 }],
  'gbp': [{ api: 'google-places-details', count: 1 }],
  'directory': [{ api: 'google-places-details', count: 1 }, { api: 'facebook-graph', count: 1 }],
  'reputation': [{ api: 'google-places-details', count: 1 }],
  'performance': [{ api: 'pagespeed-insights', count: 2 }],
  'speed-to-lead': [{ api: 'libphonenumber (offline)', count: 0 }],
  'competitors': [{ api: 'google-places-textsearch', count: 1 }],
};

// Turn a raw built result ({score, summary, checks, details}) into a full
// category object. Shared by the mock engine and by real adapters (PageSpeed,
// etc.) spliced in via the pipeline.
function finalizeCategory(def, built) {
  const g = grade(built.score);
  const cat = {
    id: def.id,
    label: def.label,
    blurb: def.blurb,
    tools: def.tools,
    score: built.score,
    grade: g.label,
    band: g.band,
    summary: built.summary,
    checks: built.checks,
    details: built.details,
  };
  if (built.score < 65) cat.framing = framingFor(def.id);
  return cat;
}

function buildReportMock(business) {
  const seed = business.domain || (business.name + '|' + business.phone);
  const categories = CATEGORIES.map((def) => {
    const r = rng(def.id + '|' + seed);
    const built = BUILDERS[def.id](r, business);
    return finalizeCategory(def, built);
  });

  const overall = rollup(categories);

  // aggregate mock api-call log
  const apiCalls = [];
  CATEGORIES.forEach((def) => {
    (MOCK_API_CALLS[def.id] || []).forEach((c) => apiCalls.push(Object.assign({ category: def.id }, c)));
  });

  return {
    version: 1,
    mock: true,
    business,
    overall,
    overallGrade: grade(overall).label,
    overallBand: grade(overall).band,
    categories,
    apiCalls,
  };
}

module.exports = { resolveBusinessMock, buildReportMock, finalizeCategory, guessTrade, MOCK_API_CALLS };
