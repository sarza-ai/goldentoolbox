'use strict';
/* Golden Toolbox — Business Checkup storage adapter.

   Two backends behind one interface:
   - UPSTASH  : if UPSTASH_REDIS_REST_URL + TOKEN are set, use Upstash REST
                (cached reports w/ 30d TTL, rate-limit counters, spend logs).
   - DETERMINISTIC (default, mock phase): no external service. The slug carries
                a compact encoding of the business, and the report is
                regenerated on demand. Rate limiting is best-effort in-memory.

   The endpoints only call this interface, so flipping to Upstash later
   (priority #7) touches nothing else. */

const { encodeSlug, decodeSlug, normalizeDomain } = require('./util');

const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const RATE_MAX = 3;                            // generations
const RATE_WINDOW_SECONDS = 60 * 60;           // per hour

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useUpstash = !!(UPSTASH_URL && UPSTASH_TOKEN);

// ---- Upstash REST helpers (only used when configured) --------------------
async function upstash(command) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error('upstash ' + res.status);
  const data = await res.json();
  return data.result;
}

// ---- slug <-> business (deterministic self-contained slug) ---------------
// Compact keys keep the URL shorter.
function packBusiness(b) {
  return {
    n: b.name, w: b.website, d: b.domain, p: b.phone,
    a: b.address, c: b.city, s: b.state, t: b.trade, id: b.placeId,
  };
}
function unpackBusiness(o) {
  if (!o) return null;
  return {
    name: o.n, website: o.w, domain: o.d, phone: o.p,
    address: o.a, city: o.c, state: o.s, trade: o.t, placeId: o.id, email: '',
  };
}

function makeSlug(business) {
  return encodeSlug(business.name, packBusiness(business));
}

function businessFromSlug(slug) {
  const decoded = decodeSlug(slug);
  return unpackBusiness(decoded);
}

// ---- cache: key a business by domain or placeId --------------------------
function cacheKey(business) {
  const id = normalizeDomain(business.domain) || business.placeId || business.name;
  return 'checkup:report:' + id;
}

// In-memory fallback stores (used when Upstash isn't configured). These persist
// within a warm serverless instance / the local dev process — enough to avoid
// re-running the pipeline on every report view. Durable cross-instance caching
// arrives with Upstash (priority #7); the interface is identical either way.
const memReports = new Map();     // slug -> { report, exp }
const memDomainSlug = new Map();  // cacheKey -> { slug, exp }

function memGet(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { map.delete(key); return null; }
  return e;
}

async function getCachedSlug(business) {
  const key = cacheKey(business);
  if (useUpstash) return upstash(['GET', key]);
  const e = memGet(memDomainSlug, key);
  return e ? e.slug : null;
}

async function putCachedReport(business, slug, report) {
  const exp = Date.now() + CACHE_TTL_SECONDS * 1000;
  if (useUpstash) {
    await upstash(['SET', cacheKey(business), slug, 'EX', String(CACHE_TTL_SECONDS)]);
    await upstash(['SET', 'checkup:data:' + slug, JSON.stringify(report), 'EX', String(CACHE_TTL_SECONDS)]);
    return;
  }
  memDomainSlug.set(cacheKey(business), { slug, exp });
  memReports.set(slug, { report, exp });
}

async function getReportBySlug(slug) {
  if (useUpstash) {
    const raw = await upstash(['GET', 'checkup:data:' + slug]);
    return raw ? JSON.parse(raw) : null;
  }
  const e = memGet(memReports, slug);
  return e ? e.report : null;
}

// ---- rate limiting -------------------------------------------------------
const memBuckets = new Map(); // fallback only; best-effort within one instance

async function checkRateLimit(identifier) {
  const key = 'checkup:rl:' + identifier;
  if (useUpstash) {
    const count = await upstash(['INCR', key]);
    if (count === 1) await upstash(['EXPIRE', key, String(RATE_WINDOW_SECONDS)]);
    return { allowed: count <= RATE_MAX, remaining: Math.max(0, RATE_MAX - count), limit: RATE_MAX };
  }
  const now = Date.now();
  const b = memBuckets.get(key) || { count: 0, reset: now + RATE_WINDOW_SECONDS * 1000 };
  if (now > b.reset) { b.count = 0; b.reset = now + RATE_WINDOW_SECONDS * 1000; }
  b.count += 1;
  memBuckets.set(key, b);
  return { allowed: b.count <= RATE_MAX, remaining: Math.max(0, RATE_MAX - b.count), limit: RATE_MAX };
}

// ---- API spend budget guard (cost control for billed APIs, e.g. Places) --
const memBudget = new Map();
const BUDGET_WINDOW_SECONDS = 24 * 60 * 60; // daily

function budgetKey(name) {
  return 'checkup:budget:' + name + ':' + new Date().toISOString().slice(0, 10);
}

async function checkApiBudget(name, cap) {
  const key = budgetKey(name);
  const used = useUpstash
    ? Number((await upstash(['GET', key])) || 0)
    : (memBudget.get(key) || 0);
  return { allowed: used < cap, used, cap };
}

async function bumpApiBudget(name, by = 1) {
  const key = budgetKey(name);
  if (useUpstash) {
    const v = await upstash(['INCRBY', key, String(by)]);
    if (Number(v) === by) await upstash(['EXPIRE', key, String(BUDGET_WINDOW_SECONDS)]);
    return Number(v);
  }
  const next = (memBudget.get(key) || 0) + by;
  memBudget.set(key, next);
  return next;
}

// ---- spend / generation log ----------------------------------------------
async function logGeneration(record) {
  const line = JSON.stringify(Object.assign({ at: new Date().toISOString() }, record));
  // Always emit to the function logs so it's visible in Vercel today.
  console.log('[checkup:gen]', line);
  if (useUpstash) {
    try {
      await upstash(['LPUSH', 'checkup:genlog', line]);
      await upstash(['LTRIM', 'checkup:genlog', '0', '999']);
    } catch (e) { /* logging must never break generation */ }
  }
}

async function readGenerationLog(limit = 100) {
  if (!useUpstash) return [];
  const rows = await upstash(['LRANGE', 'checkup:genlog', '0', String(limit - 1)]);
  return (rows || []).map((r) => { try { return JSON.parse(r); } catch (e) { return { raw: r }; } });
}

module.exports = {
  useUpstash,
  CACHE_TTL_SECONDS, RATE_MAX, RATE_WINDOW_SECONDS,
  makeSlug, businessFromSlug, cacheKey,
  getCachedSlug, putCachedReport, getReportBySlug,
  checkRateLimit, logGeneration, readGenerationLog,
  checkApiBudget, bumpApiBudget,
};
