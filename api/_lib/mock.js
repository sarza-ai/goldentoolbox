'use strict';
/* Golden Toolbox — Business Checkup MOCK data engine.
   Everything here is deterministic from the business inputs so a given
   business always renders the same report. Each function is a stand-in for a
   real adapter (Places, PageSpeed, HTML scan) wired in later priorities. */

const { rng, normalizeDomain, titleCase, rankByRating, scoreChecks } = require('./util');
const { CATEGORIES, grade, rollup, framingFor } = require('./config');
const { buildLeadCaptureResult } = require('./leadcapture');

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
// Every builder returns { score, summary, checks, details } where `score`
// comes from scoreChecks() — core checks set the base, `bonus: true` checks
// only add credit. Live adapters mirror these shapes so they drop straight in.

function catReputation(r) {
  const rating = r.int(31, 49) / 10;
  const count = r.int(3, 140);
  const recentDays = r.int(2, 210);      // age of the most recent review
  const last90 = r.int(0, 18);           // reviews added in the last 90 days
  const replyRate = r.int(0, 90);
  const five = r.int(40, 80), four = r.int(8, 25), three = r.int(2, 12);
  const two = r.int(0, 8), one = 100 - five - four - three - two;
  const dist = { 5: five, 4: four, 3: three, 2: Math.max(0, two), 1: Math.max(0, one) };
  const samples = [
    { author: 'Mike R.', rating: 5, text: 'Showed up on time, did great work, cleaned up after. Would use again.', reply: replyRate > 50 },
    { author: 'Sarah T.', rating: 4, text: 'Solid job overall, took a day longer than quoted but the result is great.', reply: replyRate > 70 },
    { author: 'Dan K.', rating: rating < 4 ? 2 : 5, text: rating < 4 ? 'Hard to get a callback. Work was fine once they showed.' : 'Best in town, hands down.', reply: false },
  ];
  const checks = [
    { label: 'Average rating', ok: rating >= 4.3, value: rating.toFixed(1) + '★', weight: 2 },
    { label: 'Review volume', ok: count >= 25, value: count + ' reviews', weight: 1.5 },
    { label: 'Recent review activity', ok: recentDays <= 60, value: recentDays <= 60 ? 'Within 2 months' : `${recentDays} days ago`, weight: 1 },
    { label: 'Steady review growth', ok: last90 >= 3, value: `${last90} in last 90 days`, bonus: true, weight: 8 },
    { label: 'Owner responds to reviews', ok: replyRate >= 40, value: replyRate + '%', bonus: true, weight: 6 },
  ];
  return {
    score: scoreChecks(checks),
    summary: `${rating.toFixed(1)}★ across ${count} Google reviews${recentDays <= 60 ? ', with fresh activity' : ' — but reviews have gone quiet'}.`,
    details: { rating, count, recentDays, last90, replyRate, distribution: dist, samples, source: 'Google (up to 5 most recent shown)' },
    checks,
  };
}

// Visibility merges the old Google Business Profile check with website
// fundamentals (secure, mobile, indexable) and a light "do you measure
// results" bonus — no paid-ads requirement anywhere.
function catVisibility(r) {
  const photos = r.int(0, 40);
  const c = {
    verified: r.chance(0.72),
    hasHours: r.chance(0.75),
    categories: r.chance(0.7),
    photos,
    https: r.chance(0.85),
    mobile: r.chance(0.7),
    indexed: r.chance(0.8),
    measures: r.chance(0.5),
  };
  const checks = [
    { label: 'Google profile claimed', ok: c.verified, value: c.verified ? 'Yes' : 'No', weight: 2 },
    { label: 'Business hours on Google', ok: c.hasHours, value: c.hasHours ? 'Listed' : 'Missing', weight: 1 },
    { label: 'Services / categories listed', ok: c.categories, value: c.categories ? 'Yes' : 'No', weight: 1 },
    { label: 'Photos on your profile', ok: photos >= 10, value: photos + ' photos', weight: 1 },
    { label: 'Website is secure (HTTPS)', ok: c.https, value: c.https ? 'Yes' : 'No', weight: 1.5 },
    { label: 'Mobile-friendly site', ok: c.mobile, value: c.mobile ? 'Yes' : 'No', weight: 1.5 },
    { label: 'Findable in Google search', ok: c.indexed, value: c.indexed ? 'Indexed' : 'Not found', weight: 1 },
    { label: 'Measures results (Analytics)', ok: c.measures, value: c.measures ? 'Installed' : 'Not detected', bonus: true, weight: 6 },
  ];
  return {
    score: scoreChecks(checks),
    summary: c.verified
      ? 'Customers can find you on Google, with room to make the storefront work harder.'
      : 'Your Google presence has gaps that make you harder to find than your competitors.',
    details: c,
    checks,
  };
}

// Customer Experience: what a real visitor runs into trying to reach you.
function catCustomerExperience(r) {
  const c = {
    phoneVisible: r.chance(0.85),
    clickToCall: r.chance(0.55),
    email: r.chance(0.6),
    form: r.chance(0.6),
    hours: r.chance(0.5),
    mobileUsable: r.chance(0.7),
  };
  const checks = [
    { label: 'Phone number easy to find', ok: c.phoneVisible, value: c.phoneVisible ? 'Yes' : 'Hard to find', weight: 1.5 },
    { label: 'Tap-to-call on mobile', ok: c.clickToCall, value: c.clickToCall ? 'Yes' : 'No', weight: 1 },
    { label: 'Contact form on site', ok: c.form, value: c.form ? 'Yes' : 'No', weight: 1 },
    { label: 'Email address available', ok: c.email, value: c.email ? 'Yes' : 'No', weight: 1 },
    { label: 'Hours listed on your site', ok: c.hours, value: c.hours ? 'Yes' : 'No', weight: 1 },
    { label: 'Reads well on a phone', ok: c.mobileUsable, value: c.mobileUsable ? 'Yes' : 'No', weight: 1 },
  ];
  return {
    score: scoreChecks(checks),
    summary: c.phoneVisible && c.clickToCall
      ? 'A customer can reach you quickly — the basics are in place.'
      : 'A customer has to work harder than they should to get in touch.',
    details: c,
    checks,
  };
}

// Lead Capture (signature): scored by how MANY ways a customer can reach you,
// banded — not by whether you have any one specific tool. No chat ≠ failure.
function catLeadCapture(r) {
  const channels = {
    phone: r.chance(0.9),
    email: r.chance(0.6),
    form: r.chance(0.6),
    chat: r.chance(0.3),
    booking: r.chance(0.35),
    text: r.chance(0.25),
  };
  return buildLeadCaptureResult(channels);
}

// Trust Signals: the proof on a site that you're safe to hire.
function catTrustSignals(r) {
  const c = {
    licensed: r.chance(0.5),
    insured: r.chance(0.45),
    testimonials: r.chance(0.55),
    guarantee: r.chance(0.4),
    certifications: r.chance(0.35),
    financing: r.chance(0.3),
    bbb: r.chance(0.3),
  };
  const checks = [
    { label: 'Licensed / insured stated', ok: c.licensed || c.insured, value: (c.licensed || c.insured) ? 'Yes' : 'Not stated', weight: 1.5 },
    { label: 'Customer testimonials', ok: c.testimonials, value: c.testimonials ? 'On site' : 'Not found', weight: 1 },
    { label: 'Satisfaction guarantee / warranty', ok: c.guarantee, value: c.guarantee ? 'Yes' : 'Not stated', weight: 1 },
    { label: 'Certifications or awards', ok: c.certifications, value: c.certifications ? 'Yes' : 'Not found', bonus: true, weight: 6 },
    { label: 'Financing offered', ok: c.financing, value: c.financing ? 'Yes' : 'No', bonus: true, weight: 5 },
    { label: 'BBB / accreditation', ok: c.bbb, value: c.bbb ? 'Yes' : 'Not found', bonus: true, weight: 5 },
  ];
  return {
    score: scoreChecks(checks),
    summary: (c.licensed || c.insured)
      ? 'Your site shows some proof you\'re safe to hire — there\'s room to show more.'
      : "Your site doesn't clearly prove you're licensed, insured, and trustworthy.",
    details: c,
    checks,
  };
}

// Content Quality: mock stand-in for the Gemini/heuristic homepage read.
function catContentQuality(r) {
  const c = {
    clear: r.chance(0.6),
    cta: r.chance(0.5),
    trust: r.chance(0.55),
    wouldHire: r.chance(0.5),
  };
  const weaknesses = [
    'No clear call to action above the fold — visitors don\'t know what to do next.',
    'It isn\'t obvious what service area you cover.',
    'The homepage leads with "about us" instead of what you do for the customer.',
    'No phone number or booking prompt near the top of the page.',
  ];
  const checks = [
    { label: 'Clear what you do', ok: c.clear, value: c.clear ? 'Yes' : 'Unclear', weight: 1.5 },
    { label: 'Strong call to action', ok: c.cta, value: c.cta ? 'Yes' : 'Weak', weight: 1.5 },
    { label: 'Builds trust', ok: c.trust, value: c.trust ? 'Yes' : 'Thin', weight: 1 },
    { label: 'Would a customer hire you from this page?', ok: c.wouldHire, value: c.wouldHire ? 'Likely' : 'Unlikely', weight: 1 },
  ];
  return {
    score: scoreChecks(checks),
    summary: c.clear && c.cta
      ? 'Your homepage makes it clear what you do and how to move forward.'
      : 'Your homepage makes a visitor work to understand what you do and why to choose you.',
    details: Object.assign({}, c, { biggestWeakness: r.pick(weaknesses), analyzedBy: 'heuristic (sample)' }),
    checks,
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
  'reputation': (r, b) => catReputation(r, b),
  'visibility': (r, b) => catVisibility(r, b),
  'customer-experience': (r, b) => catCustomerExperience(r, b),
  'lead-capture': (r, b) => catLeadCapture(r, b),
  'trust-signals': (r, b) => catTrustSignals(r, b),
  'content-quality': (r, b) => catContentQuality(r, b),
  'performance': (r, b) => catPerformance(r, b),
  'competitors': (r, b) => catCompetitors(r, b),
};

// The mock "API calls" a real run would have logged, for spend monitoring.
const MOCK_API_CALLS = {
  'reputation': [{ api: 'google-places-details', count: 1 }],
  'visibility': [{ api: 'google-places-details', count: 1 }, { api: 'site-html-fetch', count: 1 }],
  'customer-experience': [{ api: 'site-html-fetch', count: 1 }],
  'lead-capture': [{ api: 'site-html-fetch', count: 1 }],
  'trust-signals': [{ api: 'site-html-fetch', count: 1 }],
  'content-quality': [{ api: 'gemini-flash (free tier)', count: 1 }],
  'performance': [{ api: 'pagespeed-insights', count: 2 }],
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
