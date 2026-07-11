'use strict';
/* Golden Toolbox — Business Checkup shared utilities (no external deps) */

// --- deterministic PRNG so a given business always yields the same mock report ---
function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a small seeded helper bundle
function rng(seedStr) {
  const r = mulberry32(hashStr(seedStr));
  return {
    next: r,
    int: (min, max) => Math.floor(r() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
  };
}

// --- domain / url normalization ---
function normalizeDomain(url) {
  if (!url) return '';
  let s = String(url).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  return s;
}

function ensureHttp(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s.replace(/^\/+/, '');
}

// --- slug handling ---
function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'business';
}

// URL-safe base64 (Buffer is available in Node serverless runtime)
function b64urlEncode(obj) {
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(s, 'base64').toString('utf8');
  return JSON.parse(json);
}

// Mock-phase slug: readable prefix + encoded payload after a double-dash.
// Later (with Upstash) this becomes a short key; the front-end never cares.
const SLUG_SEP = '--';

function encodeSlug(prefix, payload) {
  return slugify(prefix) + SLUG_SEP + b64urlEncode(payload);
}

function decodeSlug(slug) {
  const idx = String(slug).indexOf(SLUG_SEP);
  if (idx === -1) return null;
  const enc = String(slug).slice(idx + SLUG_SEP.length);
  try { return b64urlDecode(enc); } catch (e) { return null; }
}

// --- misc ---
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function titleCase(str) {
  // Capitalize the first letter of each whitespace-separated word only, so
  // "sam's concrete" -> "Sam's Concrete" (not "Sam'S") and "HVAC" is left alone.
  return String(str || '').replace(/(^|\s)([a-z])/g, (m, pre, c) => pre + c.toUpperCase());
}

// Rank businesses by rating with review count as a confidence weight, not a
// raw additive bonus — same idea as IMDb's "weighted rating". A handful of
// reviews shouldn't let a perfect score dominate, but a mountain of reviews
// also shouldn't let a mediocre rating outrank genuinely well-rated
// competitors just by sheer volume (the old `rating*20 + reviews` formula
// let review count swamp rating once a business crossed ~150 reviews).
// priorWeight = how many reviews' worth of trust an unproven rating gets;
// priorMean defaults to the sample's own average so it adapts per search
// rather than assuming a fixed "4.0 is average" across every trade/market.
function weightedRating(rating, reviews, priorMean, priorWeight = 10) {
  const r = Number(rating) || 0;
  const n = Number(reviews) || 0;
  return (n * r + priorWeight * priorMean) / (n + priorWeight);
}

function rankByRating(items, getRating, getReviews) {
  const ratings = items.map(getRating).filter((r) => r > 0);
  const priorMean = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 4.0;
  const score = (item) => weightedRating(getRating(item), getReviews(item), priorMean);
  return items.slice().sort((a, b) => score(b) - score(a));
}

module.exports = {
  hashStr, mulberry32, rng,
  normalizeDomain, ensureHttp,
  slugify, b64urlEncode, b64urlDecode, encodeSlug, decodeSlug, SLUG_SEP,
  clamp, escapeHtml, titleCase,
  weightedRating, rankByRating,
};
