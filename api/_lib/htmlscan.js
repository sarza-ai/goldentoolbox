'use strict';
/* Golden Toolbox — real site HTML scan adapter (free, no API key).
   One fetch of the business's homepage HTML, pattern-matched to feed several
   categories from a single request:
   - Customer Experience (phone/email/form/hours/mobile)
   - Lead Capture channels (phone/email/form/chat/booking/text)
   - Trust Signals (licensed/insured/testimonials/guarantee/certs/financing/BBB)
   - Visibility fundamentals (HTTPS/mobile/indexable/measures-results)
   Builders return { score, summary, checks, details } so they drop straight
   into the pipeline via finalizeCategory, same as the PageSpeed adapter. */

const { ensureHttp, scoreChecks } = require('./util');
const { buildLeadCaptureResult, estimatePhoneType } = require('./leadcapture');

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
  { provider: 'Crisp', pattern: /client\.crisp\.chat/i },
  { provider: 'Freshchat', pattern: /wchat\.freshchat\.com|fcwidget/i },
  { provider: 'Zoho SalesIQ', pattern: /salesiq\.zoho|zohosalesiqwidget/i },
  { provider: 'Podium', pattern: /connect\.podium\.com|podium-widget/i },
];
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

// --- "do they measure results" (Analytics / Pixel — NO paid-ads requirement)
function detectTracking(html) {
  const googleAnalytics = /gtag\(['"]config['"],\s*['"]G-|google-analytics\.com\/analytics\.js|googletagmanager\.com\/gtag\/js|ga\(['"]create['"]/i.test(html);
  const googleTagManager = /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i.test(html);
  const metaPixel = /connect\.facebook\.net\/[^"']+\/fbevents\.js|fbq\(['"]init['"]/i.test(html);
  return { googleAnalytics, googleTagManager, metaPixel, any: googleAnalytics || googleTagManager || metaPixel };
}

// --- contact channels (Customer Experience + Lead Capture) ----------------
const BOOKING_SIGNATURES = /calendly\.com|acuityscheduling\.com|squareup\.com\/appointments|setmore\.com|housecallpro\.com|schedulicity\.com|servicetitan\.com\/book|jobber|book(?:ing)?[-_]?(now|online|widget)/i;
const PHONE_TEXT = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;

function detectChannels(html) {
  const chat = detectChat(html);
  const clickToCall = /href=["']tel:/i.test(html);
  const phoneVisible = clickToCall || PHONE_TEXT.test(html.replace(/<[^>]+>/g, ' '));
  const email = /href=["']mailto:/i.test(html) || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(html);
  const form = /<form[\s>]/i.test(html) || /wpforms|gravityforms|contact-form-7|hs-form|jotform|typeform/i.test(html);
  const booking = BOOKING_SIGNATURES.test(html);
  const text = /href=["']sms:/i.test(html) || /\btext (us|me)\b/i.test(html);
  return {
    phone: phoneVisible, email, form, chat: chat.found, booking, text,
    clickToCall, chatProvider: chat.provider,
  };
}

function detectHours(html) {
  const stripped = html.replace(/<[^>]+>/g, ' ');
  return /\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b[^.]{0,40}\d/i.test(stripped) ||
    /\b(hours|open)\b[^.]{0,30}\d{1,2}\s?(am|pm|:)/i.test(stripped) ||
    /24\/7|open 24 hours/i.test(stripped);
}

// --- site fundamentals for Visibility -------------------------------------
function detectSiteBasics(html, finalUrl) {
  const https = /^https:/i.test(finalUrl || '');
  const mobile = /<meta[^>]+name=["']viewport["']/i.test(html);
  const indexed = !/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html);
  return { https, mobile, indexed };
}

// --- trust signals --------------------------------------------------------
const TRUST_PATTERNS = {
  licensed: /\blicens(e|ed)\b|lic(?:ense)?\s*#|state licens|fully licensed/i,
  insured: /\binsured\b|\bbonded\b|liability insurance|licensed (?:and|&) insured/i,
  testimonials: /testimonial|what (?:our |my )?(?:customers|clients) say|customer stories|hear from our/i,
  guarantee: /guarantee|warrant(?:y|ies)|satisfaction guaranteed|money[\s-]?back|100% satisfaction/i,
  certifications: /\bcertified\b|certification|NATE\b|EPA certified|factory[\s-]?trained|award[\s-]?winning|angi (?:certified|super)/i,
  financing: /financing|finance options|payment plan|0%\s?apr|affirm\.com|synchrony|wisetack|greensky/i,
  bbb: /bbb\.org|better business bureau|bbb accredited|a\+ rating/i,
};

function detectTrust(html) {
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const out = {};
  for (const k of Object.keys(TRUST_PATTERNS)) out[k] = TRUST_PATTERNS[k].test(stripped);
  return out;
}

// --- category builders (mock-compatible shape) ----------------------------
function buildCustomerExperience(html, finalUrl) {
  const ch = detectChannels(html);
  const hours = detectHours(html);
  const { mobile } = detectSiteBasics(html, finalUrl);
  const checks = [
    { label: 'Phone number easy to find', ok: ch.phone, value: ch.phone ? 'Yes' : 'Hard to find', weight: 1.5 },
    { label: 'Tap-to-call on mobile', ok: ch.clickToCall, value: ch.clickToCall ? 'Yes' : 'No', weight: 1 },
    { label: 'Contact form on site', ok: ch.form, value: ch.form ? 'Yes' : 'No', weight: 1 },
    { label: 'Email address available', ok: ch.email, value: ch.email ? 'Yes' : 'No', weight: 1 },
    { label: 'Hours listed on your site', ok: hours, value: hours ? 'Yes' : 'Not found', weight: 1 },
    { label: 'Reads well on a phone', ok: mobile, value: mobile ? 'Yes' : 'No', weight: 1 },
  ];
  return {
    score: scoreChecks(checks),
    summary: ch.phone && ch.clickToCall
      ? 'A customer can reach you quickly — the basics are in place.'
      : 'A customer has to work harder than they should to get in touch.',
    details: Object.assign({ hours }, ch, { source: 'Live HTML scan' }),
    checks,
  };
}

function buildLeadCapture(html, phone) {
  const ch = detectChannels(html);
  const channels = {
    phone: ch.phone || !!phone, email: ch.email, form: ch.form,
    chat: ch.chat, booking: ch.booking, text: ch.text,
  };
  const built = buildLeadCaptureResult(channels, {
    phoneTypeEstimate: estimatePhoneType(phone),
    chatProvider: ch.chatProvider,
    source: 'Live HTML scan + offline phone-type estimate',
  });
  return built;
}

function buildTrustSignals(html) {
  const t = detectTrust(html);
  const checks = [
    { label: 'Licensed / insured stated', ok: t.licensed || t.insured, value: (t.licensed || t.insured) ? 'Yes' : 'Not stated', weight: 1.5 },
    { label: 'Customer testimonials', ok: t.testimonials, value: t.testimonials ? 'On site' : 'Not found', weight: 1 },
    { label: 'Satisfaction guarantee / warranty', ok: t.guarantee, value: t.guarantee ? 'Yes' : 'Not stated', weight: 1 },
    { label: 'Certifications or awards', ok: t.certifications, value: t.certifications ? 'Yes' : 'Not found', bonus: true, weight: 6 },
    { label: 'Financing offered', ok: t.financing, value: t.financing ? 'Yes' : 'No', bonus: true, weight: 5 },
    { label: 'BBB / accreditation', ok: t.bbb, value: t.bbb ? 'Yes' : 'Not found', bonus: true, weight: 5 },
  ];
  return {
    score: scoreChecks(checks),
    summary: (t.licensed || t.insured)
      ? 'Your site shows some proof you\'re safe to hire — there\'s room to show more.'
      : "Your site doesn't clearly prove you're licensed, insured, and trustworthy.",
    details: Object.assign({}, t, { source: 'Live HTML scan' }),
    checks,
  };
}

// Visibility is assembled in the pipeline from Places (GBP) + these HTML
// fundamentals, so we expose the raw signals rather than a full category.
function siteSignalsForVisibility(html, finalUrl) {
  const basics = detectSiteBasics(html, finalUrl);
  const tracking = detectTracking(html);
  return { https: basics.https, mobile: basics.mobile, indexed: basics.indexed, measures: tracking.any, tracking };
}

module.exports = {
  fetchSiteHtml, detectChat, detectHosting, detectTracking,
  detectChannels, detectTrust, detectSiteBasics, detectHours,
  buildCustomerExperience, buildLeadCapture, buildTrustSignals,
  siteSignalsForVisibility,
};
