'use strict';
/* Golden Toolbox — real Google Places adapter (priority #4).
   Billing-enabled Maps Platform key, lives inside the free monthly credit.
   Legacy Places API (Text Search + Place Details) — simplest surface, one key,
   no OAuth. Feeds: address resolution, Reputation, Visibility (the Google
   Business Profile half), and Competitive Position. */

const { normalizeDomain, rankByRating, scoreChecks } = require('./util');
const { guessTrade } = require('./mock');

const TIMEOUT_MS = 10000;
const TEXTSEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
const DETAILS_FIELDS = [
  'name', 'formatted_address', 'formatted_phone_number', 'international_phone_number',
  'website', 'rating', 'user_ratings_total', 'reviews', 'opening_hours', 'photos',
  'business_status', 'address_components', 'types',
].join(',');

function key() { return process.env.GOOGLE_PLACES_API_KEY; }

async function callJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function textSearch(query) {
  if (!key()) throw new Error('no places key');
  const qs = new URLSearchParams({ query, key: key() });
  const data = await callJson(`${TEXTSEARCH_URL}?${qs}`);
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`places textsearch ${data.status}${data.error_message ? ': ' + data.error_message : ''}`);
  }
  return data.results || [];
}

async function placeDetails(placeId) {
  if (!key()) throw new Error('no places key');
  const qs = new URLSearchParams({ place_id: placeId, fields: DETAILS_FIELDS, key: key() });
  const data = await callJson(`${DETAILS_URL}?${qs}`);
  if (data.status !== 'OK') {
    throw new Error(`places details ${data.status}${data.error_message ? ': ' + data.error_message : ''}`);
  }
  return data.result;
}

function phoneDigits(p) { return String(p || '').replace(/\D/g, '').slice(-10); }

function cityStateFromAddress(details) {
  const comps = (details && details.address_components) || [];
  const city = (comps.find((c) => c.types.includes('locality')) ||
    comps.find((c) => c.types.includes('postal_town')) || {}).long_name || '';
  const state = (comps.find((c) => c.types.includes('administrative_area_level_1')) || {}).short_name || '';
  return { city, state };
}

function businessFromDetails(details, trade, placeId) {
  const { city, state } = cityStateFromAddress(details);
  return {
    name: details.name,
    website: details.website || '',
    domain: normalizeDomain(details.website),
    phone: details.formatted_phone_number || details.international_phone_number || '',
    address: details.formatted_address || '',
    city, state, trade, placeId,
  };
}

// resolveBusinessReal(form) -> { confident, business } | { confident, candidates } | null
// null means "couldn't do anything useful" — caller falls back to mock.
async function resolveBusinessReal(form) {
  const trade = guessTrade(form.business);
  const query = [form.business, form.phone].filter(Boolean).join(' ') || form.business;
  const results = await textSearch(query);
  if (!results.length) return null;

  const top = results[0];
  let details = null;
  let confident = false;
  try {
    details = await placeDetails(top.place_id);
    const phoneMatch = !!form.phone && phoneDigits(details.formatted_phone_number || details.international_phone_number) === phoneDigits(form.phone);
    const domainMatch = !!form.website && !!details.website && normalizeDomain(details.website) === normalizeDomain(form.website);
    confident = phoneMatch || domainMatch;
  } catch (e) {
    console.error('[places] details lookup failed for top result:', e.message);
  }

  if (confident && details) {
    return { confident: true, business: businessFromDetails(details, trade, top.place_id) };
  }

  const candidates = results.slice(0, 3).map((r) => ({
    name: r.name,
    address: r.formatted_address || '',
    placeId: r.place_id,
    trade,
    _preview: { rating: r.rating != null ? r.rating.toFixed(1) : null, reviews: r.user_ratings_total || 0 },
  }));
  return { confident: false, candidates };
}

// --- category builders (mock-compatible shape) ----------------------------

// Reputation: rating + volume + freshness. Review recency comes from the
// timestamps on the (up to 5) reviews the API returns; owner-reply data is
// NOT exposed by Places, so we don't claim it either way.
function buildReputation(details) {
  const rating = details.rating || 0;
  const count = details.user_ratings_total || 0;
  const revs = details.reviews || [];
  // Cap at 2 samples so the Reputation card stays close in height to the other
  // category cards and the two-column grid rows line up.
  const samples = revs.slice(0, 2).map((r) => ({
    author: r.author_name, rating: r.rating, text: r.text, reply: null,
  }));
  const newestSec = revs.reduce((mx, r) => Math.max(mx, r.time || 0), 0);
  const recentDays = newestSec ? Math.round((Date.now() / 1000 - newestSec) / 86400) : null;
  const fresh = recentDays != null && recentDays <= 60;
  const checks = [
    { label: 'Average rating', ok: rating >= 4.3, value: rating ? rating.toFixed(1) + '★' : 'No rating', weight: 2 },
    { label: 'Review volume', ok: count >= 25, value: count + ' reviews', weight: 1.5 },
    { label: 'Recent review activity', ok: fresh, value: recentDays == null ? 'Unknown' : (fresh ? 'Within 2 months' : `${recentDays} days ago`), weight: 1 },
    { label: 'Recent momentum', ok: recentDays != null && recentDays <= 30, value: recentDays != null && recentDays <= 30 ? 'Active' : 'Quiet', bonus: true, weight: 6 },
  ];
  return {
    score: scoreChecks(checks),
    summary: `${rating.toFixed(1)}★ across ${count} Google reviews${fresh ? ', with fresh activity' : recentDays != null ? ' — reviews have gone quiet' : ''} (live).`,
    details: {
      rating, count, recentDays, replyRate: null, distribution: null, samples,
      source: 'Google Places (live) — 2 most recent reviews shown; reply data is not exposed by the API',
    },
    checks,
  };
}

// Visibility = Google Business Profile completeness + website fundamentals.
// siteSignals (https/mobile/indexed/measures) come from the HTML scan and may
// be null when the site couldn't be fetched — then only the GBP half is scored.
function buildVisibility(details, siteSignals) {
  const photos = (details.photos || []).length; // API caps this list; treat as a floor
  const hasHours = !!details.opening_hours;
  const hasCategories = Array.isArray(details.types) && details.types.filter((t) => t !== 'point_of_interest' && t !== 'establishment').length > 0;
  const active = !details.business_status || details.business_status === 'OPERATIONAL';
  const checks = [
    { label: 'Listed & operational on Google', ok: active, value: active ? 'Yes' : (details.business_status || 'Unknown'), weight: 2 },
    { label: 'Business hours on Google', ok: hasHours, value: hasHours ? 'Listed' : 'Missing', weight: 1 },
    { label: 'Services / categories listed', ok: hasCategories, value: hasCategories ? 'Yes' : 'No', weight: 1 },
    { label: 'Photos on your profile', ok: photos >= 10, value: (photos >= 10 ? '10+' : photos) + ' photos', weight: 1 },
  ];
  if (siteSignals) {
    checks.push(
      { label: 'Website is secure (HTTPS)', ok: siteSignals.https, value: siteSignals.https ? 'Yes' : 'No', weight: 1.5 },
      { label: 'Mobile-friendly site', ok: siteSignals.mobile, value: siteSignals.mobile ? 'Yes' : 'No', weight: 1.5 },
      { label: 'Findable in Google search', ok: siteSignals.indexed, value: siteSignals.indexed ? 'Indexed' : 'Not found', weight: 1 },
      { label: 'Measures results (Analytics)', ok: siteSignals.measures, value: siteSignals.measures ? 'Installed' : 'Not detected', bonus: true, weight: 6 },
    );
  }
  return {
    score: scoreChecks(checks),
    summary: active
      ? 'Customers can find you on Google, with room to make the storefront work harder.'
      : `Google lists your business status as "${details.business_status}" — this needs attention.`,
    details: {
      verified: active, hasHours, hasCategories, photos,
      site: siteSignals || null,
      source: 'Google Places (live)' + (siteSignals ? ' + live site scan' : ''),
    },
    checks,
  };
}

async function competitorSearch(trade, city, state) {
  const q = `${trade} near ${city}${state ? ', ' + state : ''}`.trim();
  const results = await textSearch(q || trade);
  return results.slice(0, 10);
}

function buildCompetitors(results, business, details) {
  const comps = results
    .filter((r) => r.place_id !== business.placeId)
    .map((r) => ({ name: r.name, reviews: r.user_ratings_total || 0, rating: r.rating || 0, you: false }));
  comps.push({ name: business.name + ' (You)', reviews: details.user_ratings_total || 0, rating: details.rating || 0, you: true });
  const ranked = rankByRating(comps, (c) => c.rating, (c) => c.reviews);
  const rank = ranked.findIndex((c) => c.you) + 1;
  const top = ranked[0];
  const score = Math.round(Math.max(10, 100 - (rank - 1) * (90 / comps.length)));
  return {
    score,
    summary: `You rank #${rank} of ${comps.length} nearby ${business.trade || 'local'} businesses by reviews and rating (live).`,
    details: {
      rank, total: comps.length,
      leaderboard: ranked.map((c) => ({ name: c.name, reviews: c.reviews, rating: c.rating.toFixed(1), you: !!c.you })),
      top: { name: top.name, reviews: top.reviews, rating: top.rating.toFixed(1) },
      source: 'Google Places Text Search (live)',
    },
    checks: [
      { label: 'Local rank', ok: rank <= 3, value: `#${rank} of ${comps.length}` },
      { label: 'Your reviews vs. top', ok: (details.user_ratings_total || 0) >= top.reviews, value: `${details.user_ratings_total || 0} vs ${top.reviews}` },
      { label: 'Your rating vs. top', ok: (details.rating || 0) >= top.rating, value: `${(details.rating || 0).toFixed(1)}★ vs ${top.rating.toFixed(1)}★` },
    ],
  };
}

module.exports = {
  textSearch, placeDetails, cityStateFromAddress, resolveBusinessReal,
  buildReputation, buildVisibility, competitorSearch, buildCompetitors,
};
