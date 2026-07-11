'use strict';
/* Golden Toolbox — real site HTML scan adapter (priority #3, free, no API key).
   One fetch of the business's homepage HTML, pattern-matched for:
   - chat widget providers (+ generic fallback)
   - hosting platform signature
   - analytics/ads tracking tags (Techno Stack category)
   Returns builder-shaped results ({score, summary, checks, details}) that drop
   straight into the pipeline via finalizeCategory, same as the PageSpeed adapter. */

const { ensureHttp } = require('./util');

const TIMEOUT_MS = 10000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GoldenToolboxCheckup/1.0';

async function fetchSiteHtml(website) {
  const url = ensureHttp(website);
  if (!url) return { ok: false, error: 'no url' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return { ok: false, error: `http ${res.status}`, status: res.status };
    // cap read size — homepage HTML only, no need for huge payloads
    const text = await res.text();
    return { ok: true, html: text.slice(0, 900000), finalUrl: res.url, status: res.status };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// --- chat widget detection ---------------------------------------------
const CHAT_SIGNATURES = [
  { provider: 'Intercom', pattern: /widget\.intercom\.io|intercomsettings|api\.intercom\.io/i },
  { provider: 'Drift', pattern: /js\.driftt\.com|drift\.load\(/i },
  { provider: 'Tidio', pattern: /code\.tidio\.co|tidiochatapi/i },
  { provider: 'Zendesk Chat', pattern: /zopim\.com|ekr\.zdassets\.com|zendesk.*widget|zewidget/i },
  { provider: 'Tawk.to', pattern: /embed\.tawk\.to/i },
  { provider: 'LiveChat', pattern: /cdn\.livechatinc\.com|__lc\s*=/i },
  { provider: 'Facebook Messenger', pattern: /fb-customerchat|connect\.facebook\.net\/[^"']+\/sdk\/xfbml\.customerchat/i },
  { provider: 'HubSpot Chat', pattern: /js\.hs-scripts\.com|hubspot-messages-iframe-container|hscta\.net/i },
  // common widgets beyond the explicit spec list — strengthens the generic net
  { provider: 'Crisp', pattern: /client\.crisp\.chat/i },
  { provider: 'Freshchat', pattern: /wchat\.freshchat\.com|fcwidget/i },
  { provider: 'Zoho SalesIQ', pattern: /salesiq\.zoho|zohosalesiqwidget/i },
];

// last-resort: a fixed-position element with chat-like naming, provider unknown
const GENERIC_CHAT_PATTERN = /(chat[-_]?widget|chat[-_]?bubble|live[-_]?chat|chat[-_]?launcher|messenger[-_]?widget)/i;

function detectChat(html) {
  for (const sig of CHAT_SIGNATURES) {
    if (sig.pattern.test(html)) return { found: true, provider: sig.provider };
  }
  if (GENERIC_CHAT_PATTERN.test(html)) return { found: true, provider: 'Unrecognized chat widget' };
  return { found: false, provider: null };
}

// --- hosting platform detection -----------------------------------------
const HOST_SIGNATURES = [
  { name: 'WordPress', pattern: /wp-content|wp-includes|<meta name="generator" content="wordpress/i },
  { name: 'Wix', pattern: /wixstatic\.com|wix\.com\/wix-ui|static\.parastorage\.com/i },
  { name: 'Squarespace', pattern: /squarespace\.com|static1\.squarespace\.com|squarespace-cdn\.com/i },
  { name: 'GoDaddy Website Builder', pattern: /godaddy\.com\/websitebuilder|gdwebsitebuilder|secureserver\.net\/websitebuilder/i },
  { name: 'Duda', pattern: /irp\.cdn-website\.com|duda\.co|dudamobile/i },
  { name: 'Webflow', pattern: /webflow\.com|data-wf-site|assets-global\.website-files\.com/i },
  { name: 'Shopify', pattern: /cdn\.shopify\.com|shopify\.com\/s\// },
];

function detectHosting(html) {
  for (const sig of HOST_SIGNATURES) {
    if (sig.pattern.test(html)) return sig.name;
  }
  return 'Custom / Unknown';
}

// --- tracking tag detection (Techno Stack) --------------------------------
function detectTracking(html) {
  const googleAnalytics = /gtag\(['"]config['"],\s*['"]G-|google-analytics\.com\/analytics\.js|googletagmanager\.com\/gtag\/js|ga\(['"]create['"]/i.test(html);
  const googleTagManager = /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i.test(html);
  const googleAds = /googleadservices\.com|google_conversion_id|AW-\d{6,}/i.test(html);
  const googleAdsConversion = /gtag\(['"]event['"],\s*['"]conversion['"]|\/pagead\/conversion/i.test(html);
  const metaPixel = /connect\.facebook\.net\/[^"']+\/fbevents\.js|fbq\(['"]init['"]/i.test(html);
  return { googleAnalytics, googleTagManager, googleAds, googleAdsConversion, metaPixel };
}

// --- category builders (mock-compatible shape) ----------------------------
function buildTechnoStack(html) {
  const t = detectTracking(html);
  const found = Object.values(t).filter(Boolean).length;
  const score = Math.round((found / 5) * 100);
  return {
    score,
    summary: found === 0
      ? 'No analytics or ad tracking found on your live site — you are flying blind.'
      : `We found ${found} of 5 key tracking tags installed on your live site.`,
    details: Object.assign({}, t, { source: 'Live HTML scan' }),
    checks: [
      { label: 'Google Analytics', ok: t.googleAnalytics, value: t.googleAnalytics ? 'Installed' : 'Missing' },
      { label: 'Google Tag Manager', ok: t.googleTagManager, value: t.googleTagManager ? 'Installed' : 'Missing' },
      { label: 'Google Ads tag', ok: t.googleAds, value: t.googleAds ? 'Installed' : 'Missing' },
      { label: 'Google Ads conversion', ok: t.googleAdsConversion, value: t.googleAdsConversion ? 'Installed' : 'Missing' },
      { label: 'Meta (Facebook) Pixel', ok: t.metaPixel, value: t.metaPixel ? 'Installed' : 'Missing' },
    ],
  };
}

// No free/zero-cost source (HTML scan or Google Places) exposes whether an
// owner replies to reviews, so this used to carry the mock baseline's
// fabricated reply-rate number straight through — which could sit right next
// to real review samples that visibly contradicted it. Don't claim a number
// we can't back up: say plainly it isn't available, and don't score it.
function buildBusinessDetails(html) {
  const chat = detectChat(html);
  const host = detectHosting(html);
  const blog = detectBlog(html);
  let score = 25;
  if (chat.found) score += 35;
  if (host !== 'Custom / Unknown') score += 20;
  if (blog.found) score += 20;
  return {
    score: Math.min(100, score),
    summary: chat.found
      ? `We detected a ${chat.provider} chat widget on your live site.`
      : 'No live chat or instant-answer widget detected on your live site.',
    details: {
      chatWidget: chat.found,
      chatProvider: chat.provider,
      hostingPlatform: host,
      hasBlog: blog.found,
      reviewReplyRate: null,
      source: 'Live HTML scan (chat + hosting + blog); review reply rate is not exposed by any free data source',
    },
    checks: [
      { label: 'Live chat / instant answers', ok: chat.found, value: chat.found ? chat.provider : 'Not found' },
      { label: 'Hosting platform detected', ok: host !== 'Custom / Unknown', value: host },
      { label: 'Blog / content section', ok: blog.found, value: blog.found ? 'Found' : 'Not found' },
      { label: 'Review reply rate', ok: true, value: 'Not available' },
    ],
  };
}

// --- Facebook page link detection (Directory Presence, priority #6) -------
// Meta locked down free-tier business search years ago, so instead of
// searching we check whether the business already links its own Facebook
// page from its own website — high-confidence when found (they linked it
// themselves), honestly "not found via this method" when it isn't.
const FB_LINK_BLOCKLIST = /^(sharer|share|plugins|dialog|tr|l\.php|policies|legal|help|business|ads|watch|marketplace|gaming|groups|events|photo\.php|permalink\.php|story\.php|sdk|v\d)/i;

function detectFacebookLink(html) {
  if (!html) return { found: false };
  const legacy = html.match(/facebook\.com\/pages\/[^/"'?]+\/(\d{6,})/i);
  if (legacy) return { found: true, pageId: legacy[1], url: 'https://facebook.com/' + legacy[1] };
  const re = /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9._-]{2,50})/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1].replace(/\/$/, '');
    if (!FB_LINK_BLOCKLIST.test(slug)) return { found: true, pageId: slug, url: 'https://facebook.com/' + slug };
  }
  return { found: false };
}

// X (formerly Twitter) — same self-link approach, same reasoning: no free
// public search, but a link the business placed on their own site is strong
// evidence either way.
const X_LINK_BLOCKLIST = /^(intent|share|search|hashtag|home|i|compose|login|signup|widgets)/i;

function detectXLink(html) {
  if (!html) return { found: false };
  const re = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,30})/gi;
  let m;
  while ((m = re.exec(html))) {
    const handle = m[1].replace(/\/$/, '');
    if (!X_LINK_BLOCKLIST.test(handle)) return { found: true, handle, url: 'https://x.com/' + handle };
  }
  return { found: false };
}

// Nextdoor business pages are usually linked as nextdoor.com/pages/{slug} —
// the neighborhood-recommendation app that's arguably the highest-signal
// platform for a local trades audience specifically.
function detectNextdoorLink(html) {
  if (!html) return { found: false };
  const m = html.match(/https?:\/\/(?:www\.)?nextdoor\.com\/(?:pages|business)\/([A-Za-z0-9_-]{2,80})/i);
  if (m) return { found: true, slug: m[1], url: 'https://nextdoor.com/pages/' + m[1] };
  return { found: false };
}

// Blog / content section on the business's own site — same-origin path or
// nav link, not an external platform, so it's a simpler presence check.
const BLOG_PATTERN = /href=["'](?:https?:\/\/[^"'/]+)?\/(?:blog|news|articles|insights)(?:[/"']|\/[^"']*["'])/i;

function detectBlog(html) {
  if (!html) return { found: false };
  return { found: BLOG_PATTERN.test(html) };
}

module.exports = {
  fetchSiteHtml, detectChat, detectHosting, detectTracking,
  detectFacebookLink, detectXLink, detectNextdoorLink, detectBlog,
  buildTechnoStack, buildBusinessDetails,
};
