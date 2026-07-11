'use strict';
/* Golden Toolbox — single business-resolution entry point.
   Uses real Google Places when GOOGLE_PLACES_API_KEY is set, else the mock
   resolver. Normalizes both into the exact same shape so confirm.js,
   generate.js, and admin-generate.js never branch on mock-vs-real. */

const { normalizeDomain } = require('./util');
const { resolveBusinessMock, guessTrade } = require('./mock');
const places = require('./places');

async function resolveBusiness(form) {
  let result = null;
  if (process.env.GOOGLE_PLACES_API_KEY) {
    try {
      result = await places.resolveBusinessReal(form);
    } catch (e) {
      console.error('[resolve] places lookup failed, falling back to mock:', e.message);
    }
  }
  if (!result) result = resolveBusinessMock(form);
  if (result.confident) return result;

  const domain = normalizeDomain(form.website);
  const trade = guessTrade(form.business);
  const candidates = (result.candidates || []).map((c) => ({
    name: c.name,
    website: c.website || form.website,
    domain: c.domain || domain,
    phone: c.phone || form.phone,
    email: c.email || form.email,
    address: c.address || '',
    city: c.city || '',
    state: c.state || '',
    trade: c.trade || trade,
    placeId: c.placeId,
    _preview: c._preview || (c.rating != null ? { rating: c.rating, reviews: c.reviews } : {}),
  }));
  return { confident: false, candidates };
}

module.exports = { resolveBusiness };
