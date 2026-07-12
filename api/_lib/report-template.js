'use strict';
/* Golden Toolbox — Business Checkup report renderer (server-side HTML).
   Reuses the site design system (/styles.css) + report styles (/checkup.css). */

const { escapeHtml } = require('./util');

const BRAND_MARK = `
<svg class="brand-mark" viewBox="0 0 64 52" width="34" height="28" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="gt-gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#EFCB68"/><stop offset=".55" stop-color="#C9962B"/><stop offset="1" stop-color="#9A6E1B"/>
  </linearGradient></defs>
  <path d="M22 12 v-4 a4 4 0 0 1 4 -4 h12 a4 4 0 0 1 4 4 v4" fill="none" stroke="url(#gt-gold)" stroke-width="4.5" stroke-linecap="round"/>
  <rect x="4" y="12" width="56" height="34" rx="5" fill="url(#gt-gold)"/>
  <rect x="4" y="25" width="56" height="3" fill="#7C5715" opacity="0.55"/>
  <rect x="27" y="21.5" width="10" height="9" rx="2" fill="#F6EFE3"/>
</svg>`;

// --- circular score ring (SVG) --------------------------------------------
function scoreRing(score, size, id) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  const cx = size / 2;
  return `
<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Score ${score} out of 100">
  <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="rgba(34,27,18,0.10)" stroke-width="10"/>
  <circle class="ring-fill band-${bandOf(score)}" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="10"
     stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
     transform="rotate(-90 ${cx} ${cx})"/>
  <text x="50%" y="50%" class="ring-num" text-anchor="middle" dominant-baseline="central">${score}</text>
</svg>`;
}

const LIVE_LABELS = {
  reputation: 'Reputation', visibility: 'Visibility',
  'customer-experience': 'Customer Experience', 'lead-capture': 'Lead Capture',
  'trust-signals': 'Trust Signals', 'content-quality': 'Content Quality',
  performance: 'Website Performance', competitors: 'Competitive Position',
};

// Some figures are inherently estimates even on a fully-live report — phone
// type is pattern-based (not carrier-verified), and the homepage read and
// trust-signal checks are based on what's visible on the site, not a full
// audit. This note always shows, regardless of how many categories are live
// vs mock, on top of the live/mock breakdown.
const ESTIMATE_NOTE = "Some figures — like phone type and what we can read from your homepage — are best-effort estimates, not verified facts. Scores reflect Golden Toolbox's own methodology, not an independent audit.";

function disclaimer(report) {
  const live = report.liveSources || [];
  if (live.length === 0) return 'Sample report — figures are illustrative until live data sources are connected. ' + ESTIMATE_NOTE + ' ';
  if (report.mock) {
    const names = live.map((id) => LIVE_LABELS[id] || id);
    const list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names.slice(-1);
    return `${list} use live data; the remaining figures are illustrative until their data sources are connected. ${ESTIMATE_NOTE} `;
  }
  return ESTIMATE_NOTE + ' ';
}

function bandOf(score) {
  if (score >= 85) return 'good';
  if (score >= 65) return 'ok';
  if (score >= 40) return 'warn';
  return 'bad';
}

function bar(score) {
  return `<div class="bar"><span class="bar-fill band-${bandOf(score)}" style="width:${score}%"></span></div>`;
}

function checkRow(chk) {
  const cls = chk.neutral ? 'chk-unknown' : (chk.ok ? 'chk-ok' : 'chk-no');
  const ic = chk.neutral ? '–' : (chk.ok ? '✓' : '✕');
  return `<li class="chk ${cls}">
    <span class="chk-ic" aria-hidden="true">${ic}</span>
    <span class="chk-label">${escapeHtml(chk.label)}</span>
    <span class="chk-val">${escapeHtml(chk.value)}</span>
  </li>`;
}

function framingBlock(cat) {
  if (!cat.framing) return '';
  const tools = cat.framing.tools.map((t, i) =>
    `<a class="frame-tool" href="${escapeHtml(cat.framing.tool_anchors[i])}">${escapeHtml(t)}</a>`).join('');
  return `<div class="frame">
    <span class="frame-tag">What this ties back to</span>
    <p class="frame-head">${escapeHtml(cat.framing.headline)}</p>
    <div class="frame-tools">${tools}</div>
  </div>`;
}

// --- category-specific detail renderers -----------------------------------
function reputationExtra(d) {
  // Google's public API doesn't expose a full star-histogram — only when we
  // have one (mock mode) do we render the distribution bars.
  const rows = d.distribution ? [5, 4, 3, 2, 1].map((s) => {
    const pct = d.distribution[s] || 0;
    return `<div class="dist-row"><span class="dist-star">${s}★</span>${bar(pct)}<span class="dist-pct">${pct}%</span></div>`;
  }).join('') : '';
  const samples = (d.samples || []).map((s) => {
    // s.reply: true = replied, false = confirmed no reply (mock only — Google
    // never exposes this for real), null/undefined = unknown, say nothing
    // rather than falsely claiming "No reply" when we simply don't know.
    const replyText = s.reply === true ? 'Owner replied' : s.reply === false ? 'No reply' : '';
    return `
    <div class="rev-sample">
      <span class="rev-stars">${'★'.repeat(s.rating)}${'☆'.repeat(5 - s.rating)}</span>
      <p class="rev-text">“${escapeHtml(s.text)}”</p>
      <span class="rev-meta">${escapeHtml(s.author)}${replyText ? ' · ' + replyText : ''}</span>
    </div>`;
  }).join('');
  return `<div class="detail-block">
    ${rows ? `<div class="dist">${rows}</div>` : ''}
    <div class="rev-samples">${samples}</div>
    <p class="detail-note">${escapeHtml(d.source || '')}</p>
  </div>`;
}

function performanceExtra(d) {
  if (!d.cwv) return '';
  const cwv = [
    ['LCP', d.cwv.lcp], ['CLS', d.cwv.cls], ['INP', d.cwv.inp],
  ].map(([k, v]) => `<div class="cwv band-${v.band}"><span class="cwv-k">${k}</span><span class="cwv-v">${escapeHtml(v.value)}</span></div>`).join('');
  return `<div class="detail-block cwv-row">${cwv}</div>`;
}

function competitorsExtra(d) {
  if (!d.leaderboard) return '';
  const rows = d.leaderboard.map((c, i) => `
    <tr class="${c.you ? 'you' : ''}">
      <td class="lb-rank">${i + 1}</td>
      <td class="lb-name">${escapeHtml(c.name)}</td>
      <td class="lb-rev">${c.reviews}</td>
      <td class="lb-rate">${escapeHtml(String(c.rating))}★</td>
    </tr>`).join('');
  return `<div class="detail-block">
    <table class="leaderboard">
      <thead><tr><th>#</th><th>Business</th><th>Reviews</th><th>Rating</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// The homepage read earns its own callout — the single most valuable fix, in
// plain English, is more actionable than any checklist row.
function contentExtra(d) {
  if (!d || !d.biggestWeakness) return '';
  const via = d.analyzedBy && /gemini/i.test(d.analyzedBy) ? 'AI homepage read' : 'Homepage read';
  return `<div class="detail-block frame">
    <span class="frame-tag">${escapeHtml(via)} — biggest opportunity</span>
    <p class="frame-head">${escapeHtml(d.biggestWeakness)}</p>
  </div>`;
}

function categoryExtra(cat) {
  if (cat.id === 'reputation') return reputationExtra(cat.details);
  if (cat.id === 'performance') return performanceExtra(cat.details);
  if (cat.id === 'competitors') return competitorsExtra(cat.details);
  if (cat.id === 'content-quality') return contentExtra(cat.details);
  return '';
}

function categoryCard(cat, index) {
  return `
<article class="cat reveal" id="cat-${cat.id}">
  <div class="cat-head">
    <div class="cat-ring">${scoreRing(cat.score, 76, cat.id)}</div>
    <div class="cat-head-txt">
      <span class="cat-kicker">Category ${String(index + 1).padStart(2, '0')}</span>
      <h3>${escapeHtml(cat.label)}</h3>
      <span class="cat-grade band-${cat.band}">${escapeHtml(cat.grade)}</span>
    </div>
  </div>
  <p class="cat-summary">${escapeHtml(cat.summary)}</p>
  <ul class="chk-list">${cat.checks.map(checkRow).join('')}</ul>
  ${categoryExtra(cat)}
  ${framingBlock(cat)}
</article>`;
}

// --- the full report document ---------------------------------------------
function renderReport(report, opts = {}) {
  const b = report.business;
  const created = new Date(report.createdAt || Date.now());
  const dateStr = created.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const shareUrl = opts.shareUrl || '';

  const cards = report.categories.map((c, i) => categoryCard(c, i)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Business Checkup — ${escapeHtml(b.name)} | Golden Toolbox</title>
<meta name="description" content="Free Business Checkup for ${escapeHtml(b.name)}: reputation, visibility, customer experience, and lead capture, scored and explained." />
<meta name="robots" content="noindex, nofollow" />
<meta name="theme-color" content="#F6EFE3" />
<meta property="og:title" content="Business Checkup — ${escapeHtml(b.name)}" />
<meta property="og:description" content="Overall score ${report.overall}/100. See the full free report from Golden Toolbox." />
<meta property="og:type" content="website" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400..700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.css?v=12" />
<link rel="stylesheet" href="/checkup.css?v=2" />
</head>
<body class="report-body">

<header class="site-header" id="site-header">
  <a href="/" class="brand" aria-label="Golden Toolbox home">${BRAND_MARK}<span>Golden Toolbox</span></a>
  <div class="report-actions no-print">
    <button class="btn btn-line" id="share-btn" type="button">Share</button>
    <button class="btn btn-ink" id="print-btn" type="button">Print / PDF</button>
  </div>
</header>

<main id="main" class="report">

  <section class="report-hero">
    <p class="eyebrow"><span class="fl"></span>Your Business Checkup<span class="fl"></span></p>
    <h1>${escapeHtml(b.name)}</h1>
    <p class="report-meta">
      ${b.address ? escapeHtml(b.address) + ' · ' : ''}${escapeHtml(b.trade || 'Home Services')} · Generated ${escapeHtml(dateStr)}
    </p>

    <div class="overall">
      <div class="overall-ring">${scoreRing(report.overall, 176, 'overall')}</div>
      <div class="overall-txt">
        <span class="overall-grade band-${report.overallBand}">${escapeHtml(report.overallGrade)}</span>
        <p class="overall-lead">Here is what a customer finds when they search for you — and where you are quietly losing jobs to the crew down the road.</p>
        <a href="/checkup" class="btn btn-gold">Get my free Business Checkup follow-up</a>
      </div>
    </div>
    <p class="overall-disclaimer">Some figures below are best-effort estimates, not verified facts — see the note at the bottom for details.</p>
  </section>

  <section class="cat-grid">
    ${cards}
  </section>

  <!-- CLOSING CTA (site style) -->
  <section class="statement report-cta">
    <p>Your best marketing is a happy customer.<br /><em>Let's make sure the whole town hears about it.</em></p>
    <a href="/checkup" class="btn btn-gold btn-wide report-cta-btn">Get my free Business Checkup</a>
    <p class="report-cta-sub">Free. Plain English. The findings are yours to keep whether you hire us or not.</p>
  </section>

</main>

<footer class="site-footer">
  <div class="foot-rule" aria-hidden="true"><span>✦</span></div>
  <p class="foot-brand">Golden Toolbox</p>
  <p class="foot-line">More customers. Fewer headaches. Built for local trades across the US.</p>
  <p class="foot-copy report-disclaimer">${disclaimer(report)}© 2026 Golden Toolbox.</p>
</footer>

<script>
  (function(){
    var items = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:0.12});
      items.forEach(function(el){io.observe(el);});
    } else { items.forEach(function(el){el.classList.add('in');}); }

    var printBtn = document.getElementById('print-btn');
    if (printBtn) printBtn.addEventListener('click', function(){ window.print(); });

    var shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.addEventListener('click', function(){
      var url = ${JSON.stringify(shareUrl)} || window.location.href;
      if (navigator.share) { navigator.share({title:'Business Checkup — ${escapeHtml(b.name)}', url:url}).catch(function(){}); }
      else { navigator.clipboard && navigator.clipboard.writeText(url); shareBtn.textContent = 'Link copied'; setTimeout(function(){shareBtn.textContent='Share';},1800); }
    });
  })();
</script>
</body>
</html>`;
}

// A lightweight loading page shown while a report is still generating.
function renderLoading(slug) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Building your Business Checkup… | Golden Toolbox</title>
<meta name="robots" content="noindex, nofollow" /><meta name="theme-color" content="#F6EFE3" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400..700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.css?v=12" /><link rel="stylesheet" href="/checkup.css?v=2" />
</head><body class="report-body">
<main class="loading-wrap">
  <div class="loading-box" aria-hidden="true">${BRAND_MARK}</div>
  <p class="eyebrow"><span class="fl"></span>Opening the toolbox<span class="fl"></span></p>
  <h1 class="loading-title">Building your Business Checkup…</h1>
  <p class="loading-sub" id="loading-step">Checking your website, your reviews, and your Google profile.</p>
  <div class="loading-bar"><span></span></div>
</main>
<script>
  var steps = ['Fetching your website…','Reading your Google reviews…','Checking how customers reach you…','Looking for trust signals…','Reading your homepage…','Measuring page speed…','Sizing up local competitors…','Scoring everything…'];
  var i = 0, el = document.getElementById('loading-step');
  setInterval(function(){ i=(i+1)%steps.length; if(el) el.textContent = steps[i]; }, 1600);
  var slug = ${JSON.stringify(slug)};
  function poll(){
    fetch('/api/report-status?slug=' + encodeURIComponent(slug)).then(function(r){return r.json();}).then(function(d){
      if (d && d.status === 'ready') { window.location.reload(); }
      else { setTimeout(poll, 2000); }
    }).catch(function(){ setTimeout(poll, 2500); });
  }
  setTimeout(poll, 2000);
</script>
</body></html>`;
}

module.exports = { renderReport, renderLoading, BRAND_MARK, scoreRing, bandOf };
