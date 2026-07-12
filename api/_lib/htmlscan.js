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

function detectChannels(html, structured = {}) {
  const chat = detectChat(html);
  const clickToCall = /href=["']tel:/i.test(html);
  const phoneVisible = clickToCall || PHONE_TEXT.test(html.replace(/<[^>]+>/g, ' ')) || !!structured.telephone;
  const email = /href=["']mailto:/i.test(html) || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(html) || !!structured.email;
  const form = /<form[\s>]/i.test(html) || /wpforms|gravityforms|contact-form-7|hs-form|jotform|typeform/i.test(html);
  const booking = BOOKING_SIGNATURES.test(html);
  const text = /href=["']sms:/i.test(html) || /\btext (us|me)\b/i.test(html);
  return {
    phone: phoneVisible, email, form, chat: chat.found, booking, text,
    clickToCall, chatProvider: chat.provider,
  };
}

function detectHours(html, structured = {}) {
  const stripped = String(html || '').replace(/<[^>]+>/g, ' ');
  return /\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b[^.]{0,40}\d/i.test(stripped) ||
    /\b(hours|open)\b[^.]{0,30}\d{1,2}\s?(am|pm|:)/i.test(stripped) ||
    /24\/7|open 24 hours/i.test(stripped) ||
    (Array.isArray(structured.hours) && structured.hours.length > 0);
}

// --- site fundamentals for Visibility -------------------------------------
// `rendered` (from PageSpeed's real headless-Chrome run) is authoritative when
// present — it reflects the page AFTER JavaScript, so it's correct for SPAs
// where the raw-HTML regex would give false negatives.
function detectSiteBasics(html, finalUrl, rendered = {}) {
  const https = /^https:/i.test(finalUrl || '') || rendered.https === true;
  const mobile = rendered.mobileViewport != null
    ? rendered.mobileViewport
    : /<meta[^>]+name=["']viewport["']/i.test(html || '');
  const indexed = rendered.indexable != null
    ? rendered.indexable
    : !/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html || '');
  return { https, mobile, indexed };
}

// A page is a "thin shell" when almost no visible text reached us AND it
// carries a client-side-framework fingerprint — i.e. the content is rendered
// by JavaScript we didn't execute. On such pages, a *missing* signal isn't a
// real absence, so builders mark unrecovered checks neutral instead of failing.
function isThinShell(html) {
  if (!html) return true;
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const spaMarker = /<div[^>]+id=["'](root|app|__next|__nuxt)["']|data-reactroot|__NEXT_DATA__|window\.__NUXT__|ng-version=/i.test(html);
  return text.length < 500 && spaMarker;
}

// Build a check that becomes neutral ("Unknown") instead of a red failure when
// we genuinely couldn't read the page (thin JS shell) and have no positive
// signal. A positive signal always shows as passing regardless.
function mkCheck(label, positive, valYes, valNo, opts, unreadable) {
  const o = opts || {};
  if (positive) return { label, ok: true, value: valYes, weight: o.weight, bonus: o.bonus };
  if (unreadable) return { label, ok: false, neutral: true, value: 'Unknown (JavaScript site)', weight: o.weight, bonus: o.bonus };
  return { label, ok: false, value: valNo, weight: o.weight, bonus: o.bonus };
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

function detectTrust(html, structured = {}) {
  const stripped = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const out = {};
  for (const k of Object.keys(TRUST_PATTERNS)) out[k] = TRUST_PATTERNS[k].test(stripped);
  // A published star rating (schema.org aggregateRating) is real social proof.
  if (structured.aggregateRating) out.testimonials = true;
  return out;
}

// --- category builders (mock-compatible shape) ----------------------------
// ctx = { structured, rendered, thinShell }. On a thin shell, if too little is
// recoverable to score honestly, builders return null so the pipeline keeps the
// neutral mock baseline rather than emitting an unfair 0 or an inflated 100.
function buildCustomerExperience(html, finalUrl, ctx = {}) {
  const { structured = {}, rendered = {}, thinShell = false } = ctx;
  const ch = detectChannels(html, structured);
  const hours = detectHours(html, structured);
  const { mobile } = detectSiteBasics(html, finalUrl, rendered);
  if (thinShell && [ch.phone, ch.email, hours].filter(Boolean).length < 2) return null;
  const checks = [
    mkCheck('Phone number easy to find', ch.phone, 'Yes', 'Hard to find', { weight: 1.5 }, thinShell),
    mkCheck('Tap-to-call on mobile', ch.clickToCall, 'Yes', 'No', { weight: 1 }, thinShell),
    mkCheck('Contact form on site', ch.form, 'Yes', 'No', { weight: 1 }, thinShell),
    mkCheck('Email address available', ch.email, 'Yes', 'No', { weight: 1 }, thinShell),
    mkCheck('Hours listed on your site', hours, 'Yes', 'Not found', { weight: 1 }, thinShell),
    // mobile-friendliness comes from the page <head> / rendered audit — known even on a shell
    mkCheck('Reads well on a phone', mobile, 'Yes', 'No', { weight: 1 }, false),
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

function buildLeadCapture(html, phone, ctx = {}) {
  const { structured = {}, thinShell = false } = ctx;
  const ch = detectChannels(html, structured);
  const channels = {
    phone: ch.phone || !!phone || !!structured.telephone, email: ch.email, form: ch.form,
    chat: ch.chat, booking: ch.booking, text: ch.text,
  };
  if (thinShell && Object.values(channels).filter(Boolean).length < 2) return null;
  return buildLeadCaptureResult(channels, {
    phoneTypeEstimate: estimatePhoneType(phone),
    chatProvider: ch.chatProvider,
    source: 'Live HTML scan + offline phone-type estimate',
  }, { thin: thinShell });
}

function buildTrustSignals(html, ctx = {}) {
  const { structured = {}, thinShell = false } = ctx;
  const t = detectTrust(html, structured);
  if (thinShell && [t.licensed || t.insured, t.testimonials, t.guarantee].filter(Boolean).length < 2) return null;
  const checks = [
    mkCheck('Licensed / insured stated', t.licensed || t.insured, 'Yes', 'Not stated', { weight: 1.5 }, thinShell),
    mkCheck('Customer testimonials', t.testimonials, 'On site', 'Not found', { weight: 1 }, thinShell && !structured.aggregateRating),
    mkCheck('Satisfaction guarantee / warranty', t.guarantee, 'Yes', 'Not stated', { weight: 1 }, thinShell),
    // bonus checks: a missing bonus never hurts the score anyway, so leave them
    // as plain "not found" rather than cluttering with neutral rows
    mkCheck('Certifications or awards', t.certifications, 'Yes', 'Not found', { weight: 6, bonus: true }, false),
    mkCheck('Financing offered', t.financing, 'Yes', 'No', { weight: 5, bonus: true }, false),
    mkCheck('BBB / accreditation', t.bbb, 'Yes', 'Not found', { weight: 5, bonus: true }, false),
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

// Visibility is assembled in the pipeline from Places (GBP) + these site
// fundamentals. `rendered` (PageSpeed) is preferred over raw-HTML regex; may be
// called with html=null when only the PageSpeed render is available.
function siteSignalsForVisibility(html, finalUrl, ctx = {}) {
  const { rendered = {} } = ctx;
  const basics = detectSiteBasics(html, finalUrl, rendered);
  const tracking = detectTracking(html || '');
  return { https: basics.https, mobile: basics.mobile, indexed: basics.indexed, measures: tracking.any, tracking };
}

module.exports = {
  fetchSiteHtml, detectChat, detectHosting, detectTracking,
  detectChannels, detectTrust, detectSiteBasics, detectHours, isThinShell,
  buildCustomerExperience, buildLeadCapture, buildTrustSignals,
  siteSignalsForVisibility,
};
