'use strict';
/* Golden Toolbox — Yelp adapter (priority #6, Directory Presence row).

   The automated path (matchBusiness/buildYelpPatch, Yelp Fusion Business
   Match) is built but NOT wired into the pipeline — Yelp discontinued its
   free tier (now $229+/mo with zero free usage allowance), which fails the
   zero-cost requirement. Kept here dormant in case a compliant free source
   ever appears.

   buildManualPatch is the live path: for admin-triggered reports only
   (sales-call prep), you eyeball the prospect's Yelp page yourself and pass
   what you saw — no API, no cost, no automation, no public exposure. */

const { patchDirectoryRow } = require('./directory');

const TIMEOUT_MS = 10000;
const MATCH_URL = 'https://api.yelp.com/v3/businesses/matches';

function key() { return process.env.YELP_API_KEY; }

function phoneDigits(p) { return String(p || '').replace(/\D/g, '').slice(-10); }

async function matchBusiness(business) {
  if (!key()) throw new Error('no yelp key');
  const qs = new URLSearchParams({
    name: business.name,
    address1: business.address || '',
    city: business.city || '',
    state: business.state || '',
    country: 'US',
  });
  if (business.phone) qs.set('phone', '+1' + phoneDigits(business.phone));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let data;
  try {
    const res = await fetch(`${MATCH_URL}?${qs}`, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key()}` },
    });
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }
  if (data.error) throw new Error(`yelp match ${data.error.code}${data.error.description ? ': ' + data.error.description : ''}`);
  return (data.businesses || [])[0] || null;
}

function buildYelpPatch(priorDetails, matched, business) {
  if (!matched) {
    return patchDirectoryRow(priorDetails, 'Yelp', { listed: false, accuracy: 0, live: true });
  }
  // Business Match already did the name-matching work — that's its job.
  // Phone/address are extra corroborating signals we can check ourselves.
  const phoneMatch = !!(business.phone && matched.phone && phoneDigits(matched.phone) === phoneDigits(business.phone));
  const addrMatch = !!matched.address1;
  const accuracy = Math.round(((1 + (phoneMatch ? 1 : 0) + (addrMatch ? 1 : 0)) / 3) * 100);
  return patchDirectoryRow(priorDetails, 'Yelp', { listed: true, nameMatch: true, phoneMatch, addrMatch, accuracy, live: true });
}

// manual = { listed, nameMatch, phoneMatch, addrMatch } — whatever you can
// see on their Yelp page at a glance. nameMatch defaults true when listed
// (you found the right page); phone/address are your call.
function buildManualPatch(priorDetails, manual) {
  if (!manual || !manual.listed) {
    return patchDirectoryRow(priorDetails, 'Yelp', {
      listed: false, accuracy: 0, live: true, displayValue: 'Not listed (checked by you)',
    });
  }
  const nameMatch = manual.nameMatch !== false;
  const phoneMatch = !!manual.phoneMatch;
  const addrMatch = !!manual.addrMatch;
  const accuracy = Math.round(((nameMatch ? 1 : 0) + (phoneMatch ? 1 : 0) + (addrMatch ? 1 : 0)) / 3 * 100);
  return patchDirectoryRow(priorDetails, 'Yelp', {
    listed: true, nameMatch, phoneMatch, addrMatch, accuracy, live: true,
    displayValue: `${accuracy}% match (checked by you)`,
  });
}

module.exports = { matchBusiness, buildYelpPatch, buildManualPatch };
