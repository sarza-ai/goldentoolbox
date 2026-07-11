'use strict';
/* Golden Toolbox — Business Checkup report renderer (server-side HTML).
   Reuses the site design system (/styles.css) + report styles (/checkup.css). */

const { escapeHtml } = require('./util');
const { TOOLS } = require('./config');

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
  performance: 'Website Performance', 'business-details': 'Business Details',
  'techno-stack': 'Techno Stack', gbp: 'Google Business Profile',
  directory: 'Directory Presence', reputation: 'Online Reputation',
  'speed-to-lead': 'Speed-to-Lead', competitors: 'Local Competitor Snapshot',
};

// Some figures are inherently estimates even on a fully-live report — phone
// type is pattern-based (not carrier-verified), review reply rate is modeled
// (no public API exposes it), and Facebook presence is checked via a site's
// own links rather than a full search. This note always shows, regardless of
// how many categories are live vs mock, on top of the live/mock breakdown.
const ESTIMATE_NOTE = "Some figures — like phone type, review reply rate, and Facebook presence — are best-effort estimates, not verified facts. Scores reflect Golden Toolbox's own methodology, not an independent audit.";

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
  return `<li class="chk ${chk.ok ? 'chk-ok' : 'chk-no'}">
    <span class="chk-ic" aria-hidden="true">${chk.ok ? '✓' : '✕'}</span>
    <span class="chk-label">${escapeHtml(chk.label)}</span>
    <span class="chk-val">${escapeHtml(chk.value)}</span>
  </li>`;
}

// --- executive summary: the 3 biggest issues, readable in under 30s -------
function executiveSummary(report) {
  return report.categories
    .slice()
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((c) => ({ label: c.label, line: c.framing ? c.framing.headline : c.summary, band: c.band }));
}

function execSummaryBlock(report) {
  const items = executiveSummary(report);
  const rows = items.map((it) => `
    <li class="exec-item band-${it.band}">
      <span class="exec-item-label">${escapeHtml(it.label)}</span>
      <span class="exec-item-line">${escapeHtml(it.line)}</span>
    </li>`).join('');
  return `<div class="exec-summary">
    <span class="exec-summary-tag">Your 3 biggest issues right now</span>
    <ol class="exec-summary-list">${rows}</ol>
  </div>`;
}

// --- "what happens when someone calls right now" flow visual --------------
function callFlowExtra(cat) {
  const d = cat.details || {};
  const hasChat = d.afterHoursChat;
  const hasBooking = d.afterHoursBooking;
  const hasWebPath = hasChat || hasBooking;

  const nowSteps = ['Customer calls', 'No answer', 'Voicemail — no automatic follow-up', 'They call the next name in the results'];
  const futureSteps = ['Customer calls', 'Missed — instant text-back', 'They reply with what they need', 'Booked straight into your calendar'];

  const track = (label, steps, tone) => `
    <div class="callflow-track callflow-${tone}">
      <span class="callflow-label">${escapeHtml(label)}</span>
      <div class="callflow-steps">
        ${steps.map((s, i) => `<div class="callflow-step">${escapeHtml(s)}</div>${i < steps.length - 1 ? '<div class="callflow-arrow" aria-hidden="true">↓</div>' : ''}`).join('')}
      </div>
    </div>`;

  const caveat = hasWebPath
    ? `<p class="callflow-caveat">Your website does offer ${hasChat && hasBooking ? 'live chat and online booking' : hasChat ? 'live chat' : 'online booking'} for visitors who reach your site directly — but a phone call that goes unanswered still has no automatic way back to you.</p>`
    : '';

  return `<div class="detail-block callflow">
    ${track('Right now', nowSteps, 'now')}
    ${track('With Golden Toolbox', futureSteps, 'future')}
    ${caveat}
  </div>`;
}

// --- closing "what this unlocks" opportunities section ---------------------
const OPPORTUNITIES = [
  { key: 'reputation', blurb: 'Automated review requests after every job, plus a catch-up blast to past customers — new 5-star reviews roll in without you lifting a finger.' },
  { key: 'visibility', blurb: 'A fast, mobile-friendly site built to show up in Google, Maps, and AI search answers, with a virtual agent that books jobs around the clock.' },
  { key: 'leadcapture', blurb: 'Instant text-back on every missed call, with customers booking themselves straight into your calendar — nights and weekends included.' },
  { key: 'time', blurb: 'Invoices, estimate follow-ups, and appointment reminders that send themselves, built around the tools you already use.' },
];

function opportunitiesBlock() {
  const cards = OPPORTUNITIES.map((it) => {
    const tool = TOOLS[it.key];
    return `<a class="opp-card" href="${escapeHtml(tool.anchor)}">
      <span class="opp-name">${escapeHtml(tool.name)}</span>
      <p class="opp-blurb">${escapeHtml(it.blurb)}</p>
    </a>`;
  }).join('');
  return `<section class="section opportunities">
    <p class="eyebrow"><span class="fl"></span>What fixing this unlocks<span class="fl"></span></p>
    <h2>Here's what's <em>possible.</em></h2>
    <div class="opp-grid">${cards}</div>
  </section>`;
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

// Only Mobile/Desktop score stay in the main visible checklist (people
// generally understand "score out of 100"); the acronym-heavy Core Web
// Vitals rows (LCP/CLS/INP) move entirely into this collapsed section — not
// duplicated between the visible list and here.
function performanceExtra(cat) {
  const d = cat.details;
  if (!d.cwv) return '';
  const cwvTiles = [
    ['LCP', d.cwv.lcp], ['CLS', d.cwv.cls], ['INP', d.cwv.inp],
  ].map(([k, v]) => `<div class="cwv band-${v.band}"><span class="cwv-k">${k}</span><span class="cwv-v">${escapeHtml(v.value)}</span></div>`).join('');
  const advancedChecks = cat.checks.slice(2); // Largest Contentful Paint / Cumulative Layout Shift / Interaction to Next Paint
  return `<details class="detail-block cwv-details">
    <summary>See the technical speed report</summary>
    <div class="cwv-row">${cwvTiles}</div>
    <ul class="chk-list">${advancedChecks.map(checkRow).join('')}</ul>
  </details>`;
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

function categoryExtra(cat) {
  if (cat.id === 'speed-to-lead') return callFlowExtra(cat);
  if (cat.id === 'reputation') return reputationExtra(cat.details);
  if (cat.id === 'performance') return performanceExtra(cat);
  if (cat.id === 'competitors') return competitorsExtra(cat.details);
  return '';
}

function categoryCard(cat, index) {
  // Techno Stack is the least human of the eight categories — real signal,
  // but pure plumbing. De-emphasize it as a click-to-expand appendix rather
  // than a wall of acronyms sitting in the main flow of the report.
  // Performance keeps Mobile/Desktop score visible (people understand a
  // score out of 100); the LCP/CLS/INP rows move into performanceExtra's
  // collapsed section instead, not duplicated here.
  const visibleChecks = cat.id === 'performance' ? cat.checks.slice(0, 2) : cat.checks;
  const checksMarkup = `<ul class="chk-list">${visibleChecks.map(checkRow).join('')}</ul>`;
  const checksBlock = cat.id === 'techno-stack'
    ? `<details class="chk-details"><summary>See the technical tracking details</summary>${checksMarkup}</details>`
    : checksMarkup;
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
  ${checksBlock}
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
<meta name="description" content="Free Business Checkup for ${escapeHtml(b.name)}: reviews, website, Google profile, and speed-to-lead, scored and explained." />
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
<link rel="stylesheet" href="/checkup.css?v=1" />
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

    ${execSummaryBlock(report)}
  </section>

  <section class="cat-grid">
    ${cards}
  </section>

  ${opportunitiesBlock()}

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
<link rel="stylesheet" href="/styles.css?v=12" /><link rel="stylesheet" href="/checkup.css?v=1" />
</head><body class="report-body">
<main class="loading-wrap">
  <div class="loading-box" aria-hidden="true">${BRAND_MARK}</div>
  <p class="eyebrow"><span class="fl"></span>Opening the toolbox<span class="fl"></span></p>
  <h1 class="loading-title">Building your Business Checkup…</h1>
  <p class="loading-sub" id="loading-step">Checking your website, your reviews, and your Google profile.</p>
  <div class="loading-bar"><span></span></div>
</main>
<script>
  var steps = ['Fetching your website…','Scanning your tech stack…','Reading your Google reviews…','Checking directories…','Measuring page speed…','Sizing up local competitors…','Scoring everything…'];
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
