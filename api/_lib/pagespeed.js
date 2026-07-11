'use strict';
/* Golden Toolbox — real Google PageSpeed Insights adapter (priority #2).
   FREE: API key only, no billing account. Returns the same "built category"
   shape as the mock performance builder, so it drops straight into the pipeline.

   Docs: https://developers.google.com/speed/docs/insights/v5/get-started */

const { ensureHttp } = require('./util');
const copy = require('./copy');

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const TIMEOUT_MS = 30000;

// Google Core Web Vitals thresholds -> our report bands.
function band(metric, value) {
  if (value == null || isNaN(value)) return 'warn';
  if (metric === 'lcp') return value <= 2.5 ? 'good' : value <= 4.0 ? 'warn' : 'bad';
  if (metric === 'cls') return value <= 0.1 ? 'good' : value <= 0.25 ? 'warn' : 'bad';
  if (metric === 'inp') return value <= 200 ? 'good' : value <= 500 ? 'warn' : 'bad';
  return 'warn';
}

async function callStrategy(url, strategy, key) {
  const qs = new URLSearchParams({ url, strategy, category: 'performance' });
  if (key) qs.set('key', key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?${qs}`, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`pagespeed ${strategy} ${res.status}: ${body.slice(0, 180)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Pull lab score + lab/field CWV out of a runPagespeed response.
function parse(data) {
  const lh = data.lighthouseResult || {};
  const audits = lh.audits || {};
  const scoreRaw = lh.categories && lh.categories.performance && lh.categories.performance.score;
  const score = scoreRaw == null ? null : Math.round(scoreRaw * 100);

  // Prefer CrUX field data (real users) when the site has enough traffic.
  const field = (data.loadingExperience && data.loadingExperience.metrics) || {};
  const fLcp = field.LARGEST_CONTENTFUL_PAINT_MS && field.LARGEST_CONTENTFUL_PAINT_MS.percentile;
  const fCls = field.CUMULATIVE_LAYOUT_SHIFT_SCORE && field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile;
  const fInp = field.INTERACTION_TO_NEXT_PAINT && field.INTERACTION_TO_NEXT_PAINT.percentile;

  // Lab fallbacks (always present).
  const labLcp = audits['largest-contentful-paint'] && audits['largest-contentful-paint'].numericValue;
  const labCls = audits['cumulative-layout-shift'] && audits['cumulative-layout-shift'].numericValue;

  const lcp = fLcp != null ? fLcp / 1000 : (labLcp != null ? labLcp / 1000 : null);
  const cls = fCls != null ? fCls / 100 : (labCls != null ? labCls : null);
  const inp = fInp != null ? fInp : null; // INP is field-only; lab has no reliable equivalent

  const hasField = fLcp != null || fCls != null || fInp != null;
  return { score, lcp, cls, inp, hasField };
}

// runPerformance(website) -> { score, summary, checks, details } (mock-compatible)
async function runPerformance(website) {
  const key = process.env.PAGESPEED_API_KEY;
  const url = ensureHttp(website);
  if (!url) throw new Error('no website url');

  // Mobile is the priority for trades; desktop is best-effort.
  const [mobileRes, desktopRes] = await Promise.allSettled([
    callStrategy(url, 'mobile', key),
    callStrategy(url, 'desktop', key),
  ]);

  if (mobileRes.status !== 'fulfilled') {
    throw new Error('mobile strategy failed: ' + (mobileRes.reason && mobileRes.reason.message));
  }
  const mobile = parse(mobileRes.value);
  const desktop = desktopRes.status === 'fulfilled' ? parse(desktopRes.value) : { score: null };

  const mobileScore = mobile.score != null ? mobile.score : 0;
  const desktopScore = desktop.score != null ? desktop.score : mobileScore;
  const score = Math.round(mobileScore * 0.7 + desktopScore * 0.3);

  const lcp = mobile.lcp;
  const cls = mobile.cls;
  const inp = mobile.inp;

  const fmt = (v, unit, digits) => (v == null ? 'N/A' : (unit === 's' ? v.toFixed(digits) + 's' : unit === 'ms' ? Math.round(v) + 'ms' : v.toFixed(digits)));

  const cwv = {
    lcp: { value: fmt(lcp, 's', 1), band: band('lcp', lcp) },
    cls: { value: fmt(cls, '', 2), band: band('cls', cls) },
    inp: { value: fmt(inp, 'ms', 0), band: inp == null ? 'warn' : band('inp', inp) },
  };

  const checks = [
    { label: 'Mobile score', ok: mobileScore >= 70, value: mobileScore + '/100' },
    { label: 'Desktop score', ok: desktopScore >= 80, value: desktop.score != null ? desktopScore + '/100' : 'N/A' },
    { label: 'Largest Contentful Paint', ok: lcp != null && lcp <= 2.5, value: fmt(lcp, 's', 1) },
    { label: 'Cumulative Layout Shift', ok: cls != null && cls <= 0.1, value: fmt(cls, '', 2) },
    // No CrUX field data isn't a failure — don't mark it red; show it as unmeasured.
    { label: 'Interaction to Next Paint', ok: inp == null ? true : inp <= 200, value: inp == null ? 'Not enough traffic yet' : fmt(inp, 'ms', 0) },
  ];

  return {
    score,
    summary: copy.performanceSummary(mobileScore) +
      (mobile.hasField ? ' (Based on real visitor data.)' : ' (Lab estimate — site has too little traffic for real visitor data yet.)'),
    details: {
      mobileScore, desktopScore: desktop.score != null ? desktopScore : null,
      lcp, cls, inp, cwv,
      fieldData: mobile.hasField,
      source: 'Google PageSpeed Insights (live)',
    },
    checks,
  };
}

module.exports = { runPerformance };
