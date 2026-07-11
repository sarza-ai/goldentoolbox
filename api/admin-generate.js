'use strict';
/* POST /api/admin-generate   (authenticated — for Jared, live on sales calls)
   Header: x-admin-secret: <ADMIN_SECRET>   (or ?secret= for quick browser use)
   Body:   { business, email, phone, website }
   Skips the public form + rate limiting, runs the pipeline, returns the report
   URL. Not rate-limited, but still logged. Bypasses cache with ?fresh=1. */

const { readBody, json, clientIp } = require('./_lib/http');
const store = require('./_lib/store');
const { runPipeline } = require('./_lib/pipeline');
const { resolveBusiness } = require('./_lib/resolve');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const url = new URL(req.url, 'http://x');
  const secret = req.headers['x-admin-secret'] || url.searchParams.get('secret') || '';
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return json(res, 500, { error: 'not_configured', message: 'ADMIN_SECRET is not set.' });
  if (secret !== expected) return json(res, 401, { error: 'unauthorized' });

  const body = await readBody(req);
  const form = {
    name: String(body.name || 'Admin').trim(),
    business: String(body.business || '').trim(),
    email: String(body.email || '').trim(),
    phone: String(body.phone || '').trim(),
    website: String(body.website || '').trim(),
  };
  if (!form.business || !form.website) {
    return json(res, 400, { error: 'missing_fields', message: 'business and website are required.' });
  }

  const resolved = await resolveBusiness(form);
  // Admin flow skips the confirm UI — take the top candidate automatically when ambiguous.
  const business = resolved.confident ? resolved.business : (resolved.candidates && resolved.candidates[0]);
  if (!business) return json(res, 422, { error: 'no_match', message: 'Could not find that business.' });

  const fresh = url.searchParams.get('fresh') === '1';
  if (!fresh) {
    const cachedSlug = await store.getCachedSlug(business);
    if (cachedSlug) {
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'goldentoolbox.com';
      return json(res, 200, { slug: cachedSlug, cached: true, url: `https://${host}/checkup/${cachedSlug}` });
    }
  }

  try {
    const report = await runPipeline(business, { source: 'admin' });
    await store.logGeneration({ slug: report.slug, admin: true, ip: clientIp(req), business: business.name });
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'goldentoolbox.com';
    return json(res, 200, { slug: report.slug, cached: false, url: `https://${host}/checkup/${report.slug}` });
  } catch (e) {
    console.error('[checkup:admin] failed', e);
    return json(res, 500, { error: 'generation_failed' });
  }
};
