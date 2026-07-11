'use strict';
/* GET /api/report-status?slug=...
   Powers the loading page's polling. In deterministic (mock) mode the report is
   regenerated on demand, so it is always ready. In Upstash mode this reflects
   whether the report data has been written yet. */

const { json } = require('./_lib/http');
const store = require('./_lib/store');
const { businessFromSlug } = require('./_lib/store');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const slug = url.searchParams.get('slug') || '';
  if (!slug) return json(res, 400, { status: 'error', error: 'missing_slug' });

  try {
    if (store.useUpstash) {
      const report = await store.getReportBySlug(slug);
      return json(res, 200, { status: report ? 'ready' : 'pending' });
    }
    // deterministic mode: ready as long as the slug decodes to a business
    const business = businessFromSlug(slug);
    return json(res, 200, { status: business ? 'ready' : 'error' });
  } catch (e) {
    return json(res, 200, { status: 'pending' });
  }
};
