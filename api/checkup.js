'use strict';
/* GET /checkup/:slug  (via vercel.json rewrite -> /api/checkup?slug=:slug)
   Renders the report page. In Upstash mode it serves the stored report; in
   deterministic (mock) mode it regenerates the report from the slug payload. */

const { html } = require('./_lib/http');
const store = require('./_lib/store');
const { renderReport, renderLoading } = require('./_lib/report-template');
const { buildReportMock } = require('./_lib/mock');
const { businessFromSlug } = require('./_lib/store');

function notFound(res) {
  return html(res, 404, `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Report not found | Golden Toolbox</title>
<link rel="stylesheet" href="/styles.css?v=12"/><link rel="stylesheet" href="/checkup.css?v=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/></head>
<body class="report-body"><main class="loading-wrap">
<p class="eyebrow"><span class="fl"></span>Hmm<span class="fl"></span></p>
<h1 class="loading-title">We couldn't find that report.</h1>
<p class="loading-sub">The link may be old or mistyped. Run a fresh Business Checkup and we'll build a new one.</p>
<a href="/checkup" class="btn btn-gold" style="margin-top:20px">Get my free Business Checkup</a>
</main></body></html>`);
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const slug = url.searchParams.get('slug') || '';
  if (!slug) return notFound(res);

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'goldentoolbox.com';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const shareUrl = `${proto}://${host}/checkup/${slug}`;

  try {
    // 1. Prefer the stored report (real data lives here; never recomputed on view).
    const stored = await store.getReportBySlug(slug);
    if (stored) return html(res, 200, renderReport(stored, { shareUrl }));

    // 2. Cold cache miss but the slug decodes to a business.
    const business = businessFromSlug(slug);
    if (!business || !business.name) return notFound(res);

    // In Upstash mode the report may still be generating — show loading + poll.
    if (store.useUpstash) return html(res, 200, renderLoading(slug));

    // Deterministic/mock mode: rebuild the (mock) report from the slug payload.
    const report = buildReportMock(business);
    report.slug = slug;
    report.createdAt = report.createdAt || new Date().toISOString();
    return html(res, 200, renderReport(report, { shareUrl }));
  } catch (e) {
    console.error('[checkup:render] failed', e);
    return notFound(res);
  }
};
