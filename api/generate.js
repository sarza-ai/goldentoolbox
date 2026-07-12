'use strict';
/* POST /api/generate
   Body: { business: <resolved business>, contact: { name, email, phone, website } }
   - rate limits per IP + email
   - checks 30-day cache
   - runs the audit pipeline (mock) and stores the report
   - fires the Formspree lead notification (best-effort)
   Returns { slug, cached }. Generation only happens here (lead-gated). */

const { readBody, json, clientIp } = require('./_lib/http');
const store = require('./_lib/store');
const { runPipeline } = require('./_lib/pipeline');
const { resolveBusiness } = require('./_lib/resolve');
const { guessTrade } = require('./_lib/mock');
const { normalizeDomain } = require('./_lib/util');
const email = require('./_lib/email');

const FORMSPREE = process.env.FORMSPREE_ENDPOINT || 'https://formspree.io/f/mgojwopl';

function reportUrl(req, slug) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'goldentoolbox.com';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/checkup/${slug}`;
}

async function coerceBusiness(body) {
  // Prefer an explicitly-confirmed business; otherwise resolve from contact.
  if (body.business && body.business.name) {
    const b = body.business;
    return {
      name: String(b.name).trim(),
      website: String(b.website || (body.contact && body.contact.website) || '').trim(),
      domain: normalizeDomain(b.domain || b.website || (body.contact && body.contact.website)),
      phone: String(b.phone || '').trim(),
      email: String((body.contact && body.contact.email) || b.email || '').trim(),
      address: String(b.address || '').trim(),
      city: String(b.city || '').trim(),
      state: String(b.state || '').trim(),
      trade: b.trade || guessTrade(b.name),
      placeId: b.placeId || '',
    };
  }
  const c = body.contact || {};
  const form = {
    name: String(c.name || '').trim(),
    business: String(c.business || '').trim(),
    email: String(c.email || '').trim(),
    phone: String(c.phone || '').trim(),
    website: String(c.website || '').trim(),
  };
  const resolved = await resolveBusiness(form);
  return resolved.confident ? resolved.business : null;
}

async function fireFormspree(business, contact, url, cached) {
  try {
    await fetch(FORMSPREE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: cached
          ? 'Golden Toolbox — Business Checkup requested (existing report)'
          : 'Golden Toolbox — new Business Checkup',
        Name: contact.name || '',
        Business: business.name,
        email: contact.email || '',
        Phone: contact.phone || business.phone || '',
        Website: business.website || '',
        Report: url,
        Note: cached ? 'This business already had a report on file (within 30 days) — someone just requested it again, still a live lead.' : '',
      }),
    });
  } catch (e) { /* lead notify must never block report generation */ }
}

// Two independent, fire-and-forget notifications: Formspree tells the owner
// (existing pipe, untouched), Resend confirms to whoever submitted the form
// at the email address they typed in. Neither can block report generation.
function notify(business, contact, url, cached) {
  fireFormspree(business, contact, url, cached);
  email.sendConfirmation(contact.email, business, url);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);
  if (body.website_confirm) return json(res, 400, { error: 'spam' }); // honeypot

  const contact = body.contact || {};
  const email = String(contact.email || (body.business && body.business.email) || '').trim().toLowerCase();

  // --- rate limit: per IP and per email ---
  const ip = clientIp(req);
  const rlIp = await store.checkRateLimit('ip:' + ip);
  const rlEmail = email ? await store.checkRateLimit('email:' + email) : { allowed: true, remaining: 3 };
  if (!rlIp.allowed || !rlEmail.allowed) {
    return json(res, 429, {
      error: 'rate_limited',
      message: 'You have reached the limit of 3 new reports per hour. Try again later, or reach out and we will run one for you.',
    });
  }

  const business = await coerceBusiness(body);
  if (!business) {
    return json(res, 422, { error: 'needs_confirmation', message: 'We could not confidently match your business. Please confirm it first.' });
  }

  // --- cache check (30 days) ---
  const cachedSlug = await store.getCachedSlug(business);
  if (cachedSlug) {
    // Someone requesting an already-cached report is still a live lead event —
    // don't let the cache hit silently swallow the notification.
    notify(business, contact, reportUrl(req, cachedSlug), true);
    return json(res, 200, { slug: cachedSlug, cached: true });
  }

  // --- run the pipeline ---
  try {
    const report = await runPipeline(business, { source: body.source === 'admin' ? 'admin' : 'form' });
    // fire-and-forget notifications (skip for admin-initiated runs)
    if (report.source !== 'admin') notify(business, contact, reportUrl(req, report.slug), false);
    return json(res, 200, { slug: report.slug, cached: false });
  } catch (e) {
    console.error('[checkup:generate] failed', e);
    return json(res, 500, { error: 'generation_failed', message: 'Something went wrong building your report. Please try again.' });
  }
};
