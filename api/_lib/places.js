'use strict';
/* Golden Toolbox — real Google Places adapter (priority #4).
   Billing-enabled Maps Platform key, lives inside the free monthly credit.
   Legacy Places API (Text Search + Place Details) — simplest surface, one key,
   no OAuth. Feeds: address resolution, GBP, Online Reputation, the Google row
   of Directory Presence, and the Local Competitor Snapshot. */

const { normalizeDomain, rankByRating } = require('./util');
const { guessTrade } = require('./mock');
const { patchDirectoryRow } = require('./directory');
const copy = require('./copy');

const TIMEOUT_MS = 10000;
const TEXTSEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
const DETAILS_FIELDS = [
  'name', 'formatted_address', 'formatted_phone_number', 'international_phone_number',
  'website', 'rating', 'user_ratings_total', 'reviews', 'opening_hours', 'photos',
  'business_status', 'address_components',
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
function buildGbp(details) {
  const photos = (details.photos || []).length; // API caps this list; treat as a floor
  const hasWebsite = !!details.website;
  const hasHours = !!details.opening_hours;
  const hasPhone = !!(details.formatted_phone_number || details.international_phone_number);
  const hasAddress = !!details.formatted_address;
  // Places has no public "owner-verified" flag; business_status is the closest honest proxy.
  const active = !details.business_status || details.business_status === 'OPERATIONAL';
  let score = 0;
  if (active) score += 24;
  if (hasWebsite) score += 16;
  if (hasHours) score += 16;
  if (hasPhone) score += 14;
  if (hasAddress) score += 14;
  score += Math.min(16, Math.round(photos / 2));
  return {
    score: Math.min(100, score),
    summary: copy.gbpSummary(active, details.business_status || 'unverified'),
    details: { verified: active, hasWebsite, hasHours, hasPhone, hasAddress, photos, source: 'Google Places (live)' },
    checks: [
      { label: 'Listed & operational on Google', ok: active, value: active ? 'Yes' : (details.business_status || 'Unknown') },
      { label: 'Website linked', ok: hasWebsite, value: hasWebsite ? 'Yes' : 'No' },
      { label: 'Hours listed', ok: hasHours, value: hasHours ? 'Yes' : 'No' },
      { label: 'Phone listed', ok: hasPhone, value: hasPhone ? 'Yes' : 'No' },
      { label: 'Address listed', ok: hasAddress, value: hasAddress ? 'Yes' : 'No' },
      { label: 'Photos', ok: photos >= 10, value: (photos >= 10 ? '10+' : photos) + ' photos' },
    ],
  };
}

// Places has no public "owner replied" signal at all — not even a sample.
// Earlier this carried the mock baseline's reply-rate number through
// unchanged, which meant a fabricated percentage could sit right next to
// real reviews that visibly contradicted it. Don't claim a number we can't
// back up: say plainly that it isn't available, and don't penalize or credit
// the score for something we didn't actually measure.
function buildReputation(details) {
  const rating = details.rating || 0;
  const count = details.user_ratings_total || 0;
  const samples = (details.reviews || []).slice(0, 5).map((r) => ({
    author: r.author_name, rating: r.rating, text: r.text, reply: null, // null = unknown, not "confirmed no reply"
  }));
  const score = Math.round((rating / 5) * 70) + Math.min(30, Math.round(count / 3.33));
  return {
    score: Math.min(100, score),
    summary: copy.reputationSummary(rating, count),
    details: {
      rating, count, replyRate: null, distribution: null, samples,
      source: 'Google Places (live) — up to 5 most recent reviews shown; reply data is not exposed by the API',
    },
    checks: [
      { label: 'Average rating', ok: rating >= 4.3, value: rating.toFixed(1) + '★' },
      { label: 'Review volume', ok: count >= 40, value: count + ' reviews' },
      { label: 'Owner reply rate', ok: true, value: 'Not available (Google doesn\'t expose this)' },
    ],
  };
}

// Google is ground truth here — it's the same place_id we already resolved.
function buildDirectoryPatch(priorDetails) {
  return patchDirectoryRow(priorDetails, 'Google', {
    listed: true, nameMatch: true, phoneMatch: true, addrMatch: true, accuracy: 100, live: true,
  });
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
    summary: copy.competitorsSummary(rank, comps.length, business.trade, top),
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
  buildGbp, buildReputation, buildDirectoryPatch, competitorSearch, buildCompetitors,
};
