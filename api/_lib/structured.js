'use strict';
/* Golden Toolbox — structured-data recovery.
   JavaScript-rendered sites (Wix / Squarespace / Duda / React builds) return a
   near-empty body to a plain fetch, so regex over the visible HTML finds
   nothing. But those same platforms almost always inject schema.org JSON-LD
   and OpenGraph tags SERVER-SIDE (they have to, for Google/social previews).
   This parses those blocks from the already-fetched HTML — no new network
   call — to recover phone, hours, address, social links, and star ratings the
   visible-text scan misses. Everything is best-effort and never throws:
   malformed JSON-LD is common, so each block is parsed in isolation. */

// Pull every <script type="application/ld+json"> block and JSON.parse each.
function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let raw = m[1].trim();
    if (!raw || raw.length > 200000) continue;
    // some CMSs HTML-escape the JSON payload
    raw = raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    try { out.push(JSON.parse(raw)); } catch (e) { /* skip malformed block */ }
  }
  return out;
}

// Flatten @graph arrays and top-level arrays into a flat list of nodes.
function flattenNodes(blocks) {
  const nodes = [];
  const push = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(push); return; }
    if (Array.isArray(n['@graph'])) n['@graph'].forEach(push);
    nodes.push(n);
  };
  blocks.forEach(push);
  return nodes;
}

function typeOf(node) {
  const t = node['@type'];
  return Array.isArray(t) ? t.join(' ') : String(t || '');
}

// LocalBusiness has many subtypes (Plumber, HVACBusiness, RoofingContractor…).
const BIZ_TYPE = /LocalBusiness|Organization|Plumber|Electrician|HVAC|Roofing|Contractor|HomeAndConstruction|Store|ProfessionalService|Business/i;

function firstStr(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return firstStr(v[0]);
  return '';
}

function parseAddress(addr) {
  if (!addr) return '';
  if (typeof addr === 'string') return addr.trim();
  const a = Array.isArray(addr) ? addr[0] : addr;
  if (!a || typeof a !== 'object') return '';
  return [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
    .filter(Boolean).join(', ');
}

function parseHours(node) {
  const oh = node.openingHoursSpecification || node.openingHours;
  if (!oh) return [];
  if (Array.isArray(oh)) return oh.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean);
  return [typeof oh === 'string' ? oh : JSON.stringify(oh)];
}

const SOCIAL_HOSTS = {
  facebook: /facebook\.com/i, instagram: /instagram\.com/i, x: /(?:twitter|x)\.com/i,
  linkedin: /linkedin\.com/i, yelp: /yelp\.com/i, nextdoor: /nextdoor\.com/i, youtube: /youtube\.com/i,
};

function classifySocials(urls) {
  const socials = {};
  urls.forEach((u) => {
    for (const k of Object.keys(SOCIAL_HOSTS)) {
      if (SOCIAL_HOSTS[k].test(u)) socials[k] = u;
    }
  });
  return socials;
}

function metaTag(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1].trim();
  // attribute order can be reversed
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1].trim() : '';
}

// parseStructuredData(html) -> normalized best-effort object (never throws)
function parseStructuredData(html) {
  const empty = {
    telephone: '', email: '', hours: [], address: '', name: '', description: '',
    sameAs: [], socials: {}, aggregateRating: null,
  };
  if (!html) return empty;

  let nodes = [];
  try { nodes = flattenNodes(jsonLdBlocks(html)); } catch (e) { nodes = []; }

  const biz = nodes.find((n) => BIZ_TYPE.test(typeOf(n))) || {};
  const ratingNode = biz.aggregateRating ||
    nodes.find((n) => /AggregateRating/i.test(typeOf(n))) || null;

  // sameAs (declared social/profile links) + any social hrefs in the HTML
  let sameAs = [];
  if (Array.isArray(biz.sameAs)) sameAs = biz.sameAs.filter((s) => typeof s === 'string');
  else if (typeof biz.sameAs === 'string') sameAs = [biz.sameAs];
  const hrefSocials = (html.match(/https?:\/\/(?:www\.)?(?:facebook|instagram|twitter|x|linkedin|yelp|nextdoor|youtube)\.com\/[^\s"'<>]+/gi) || []);
  const allSocialUrls = Array.from(new Set(sameAs.concat(hrefSocials)));

  let email = firstStr(biz.email);
  if (!email) {
    const em = html.match(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
    if (em) email = em[1];
  }

  const agg = ratingNode ? {
    value: parseFloat(ratingNode.ratingValue) || null,
    count: parseInt(ratingNode.reviewCount || ratingNode.ratingCount, 10) || null,
  } : null;

  return {
    telephone: firstStr(biz.telephone),
    email,
    hours: parseHours(biz),
    address: parseAddress(biz.address),
    name: firstStr(biz.name) || metaTag(html, 'og:site_name'),
    description: firstStr(biz.description) || metaTag(html, 'og:description') || metaTag(html, 'description'),
    sameAs: allSocialUrls,
    socials: classifySocials(allSocialUrls),
    aggregateRating: (agg && (agg.value || agg.count)) ? agg : null,
  };
}

module.exports = { parseStructuredData };
