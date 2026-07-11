'use strict';
/* POST /api/confirm
   Body: { name, business, email, phone, website }
   Resolves the business via Places (real when GOOGLE_PLACES_API_KEY is set,
   else mock). Returns either a confident match or 1-3 candidates for the
   "confirm your business" step, already shaped for /api/generate. */

const { readBody, json } = require('./_lib/http');
const { resolveBusiness } = require('./_lib/resolve');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);

  const form = {
    name: String(body.name || '').trim(),
    business: String(body.business || '').trim(),
    email: String(body.email || '').trim(),
    phone: String(body.phone || '').trim(),
    website: String(body.website || '').trim(),
  };
  if (body.website_confirm) return json(res, 400, { error: 'spam' }); // honeypot

  if (!form.business || !form.email || !form.website) {
    return json(res, 400, { error: 'missing_fields', message: 'Business name, email, and website are required.' });
  }

  try {
    const resolved = await resolveBusiness(form);
    return json(res, 200, resolved);
  } catch (e) {
    console.error('[confirm] resolution failed:', e.message);
    return json(res, 500, { error: 'resolution_failed', message: 'Something went wrong looking up your business. Please try again.' });
  }
};
