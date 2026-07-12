'use strict';
/* Golden Toolbox — Content Quality (homepage read).
   Answers the question a keyword scan can't: "if I landed here as a customer,
   is it clear what they do, is there a reason to act, would I hire them?"

   Two paths, same output shape:
   - Gemini (Google AI Studio free tier) when GEMINI_API_KEY is set — a real
     LLM read of the homepage text. Free within rate limits; on the free tier
     Google may use inputs to improve models, and the only input is the
     business's own PUBLIC homepage text.
   - Heuristic fallback (always free, no key, no network) — pattern-based
     checks for a clear offer, a call to action, and trust proof. Used when
     there's no key, the call fails, or the rate limit is hit — same "fall back
     to free" contract as the rest of the pipeline. */

const { scoreChecks } = require('./util');

const TIMEOUT_MS = 12000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// --- shared: turn checks into the category result -------------------------
function toResult(c, extra) {
  const checks = [
    { label: 'Clear what you do', ok: c.clear, value: c.clear ? 'Yes' : 'Unclear', weight: 1.5 },
    { label: 'Strong call to action', ok: c.cta, value: c.cta ? 'Yes' : 'Weak', weight: 1.5 },
    { label: 'Builds trust', ok: c.trust, value: c.trust ? 'Yes' : 'Thin', weight: 1 },
    { label: 'Would a customer hire you from this page?', ok: c.wouldHire, value: c.wouldHire ? 'Likely' : 'Unlikely', weight: 1 },
  ];
  return {
    score: scoreChecks(checks),
    summary: c.summary || (c.clear && c.cta
      ? 'Your homepage makes it clear what you do and how to move forward.'
      : 'Your homepage makes a visitor work to understand what you do and why to choose you.'),
    details: Object.assign({
      clear: c.clear, cta: c.cta, trust: c.trust, wouldHire: c.wouldHire,
      biggestWeakness: c.biggestWeakness || null,
    }, extra),
    checks,
  };
}

// --- heuristic path (free, no key) ----------------------------------------
const SERVICE_VERBS = /\b(install|repair|replace|service|clean|paint|remodel|build|maintain|inspect|seal|coat|stripe|pave|landscap|mow|prune|haul|remove|restore|renovate)\w*/i;
const CTA_PATTERNS = /\b(call (?:now|us|today)|get (?:a )?(?:free )?(?:quote|estimate)|free estimate|request (?:service|a quote)|book (?:now|online|a)|schedule (?:now|online|a|your)|contact us|get started)\b/i;
const TRUST_PATTERNS = /\b(licens|insured|bonded|guarantee|warrant|testimonial|reviews?|years? (?:of )?experience|family[\s-]owned|certified|BBB)\b/i;

function stripText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function heuristicContentQuality(html) {
  const text = stripText(html).slice(0, 6000);
  const hasH1 = /<h1[\s>]/i.test(html);
  const clear = hasH1 && SERVICE_VERBS.test(text);
  const cta = CTA_PATTERNS.test(text) || /href=["']tel:/i.test(html);
  const trust = TRUST_PATTERNS.test(text);
  const wouldHire = [clear, cta, trust].filter(Boolean).length >= 2;
  let biggestWeakness = null;
  if (!clear) biggestWeakness = "It isn't obvious in the first screen what service you provide — lead with the job you do for the customer.";
  else if (!cta) biggestWeakness = 'There\'s no clear call to action — add a "Get a free estimate" or "Call now" button up top.';
  else if (!trust) biggestWeakness = 'The page shows little proof you\'re safe to hire — add licensing, reviews, or a guarantee.';
  return toResult({ clear, cta, trust, wouldHire, biggestWeakness }, { analyzedBy: 'heuristic (free)' });
}

// --- Gemini path (free tier) ----------------------------------------------
function buildPrompt(text, business) {
  return `You are auditing the homepage of a local trades business for the owner.
Business name: ${business.name || 'Unknown'}
Trade: ${business.trade || 'Home services'}

Here is the visible text of their homepage:
"""
${text.slice(0, 8000)}
"""

Answer ONLY with a compact JSON object, no markdown, with these exact keys:
{
  "clear": boolean,        // is it obvious within seconds what they do?
  "cta": boolean,          // is there a clear call to action (call, quote, book)?
  "trust": boolean,        // does it build trust (licensed, reviews, guarantee, experience)?
  "wouldHire": boolean,    // would a typical customer feel confident hiring them from this page?
  "biggestWeakness": string, // one sentence, plain English, the single most valuable fix
  "summary": string        // one encouraging but honest sentence for the owner
}`;
}

async function geminiContentQuality(html, business) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const text = stripText(html);
  if (!text) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(text, business) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[content] gemini failed:', res.status, body.slice(0, 160));
      return null;
    }
    const data = await res.json();
    const raw = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return toResult({
      clear: !!parsed.clear, cta: !!parsed.cta, trust: !!parsed.trust, wouldHire: !!parsed.wouldHire,
      biggestWeakness: parsed.biggestWeakness || null, summary: parsed.summary || null,
    }, { analyzedBy: 'Gemini (live)' });
  } catch (e) {
    console.error('[content] gemini error:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// buildContentQuality(html, business) -> category result. Tries Gemini, falls
// back to the free heuristic. Never throws.
async function buildContentQuality(html, business) {
  if (!html) return null;
  const viaGemini = await geminiContentQuality(html, business);
  return viaGemini || heuristicContentQuality(html);
}

module.exports = { buildContentQuality, heuristicContentQuality };
