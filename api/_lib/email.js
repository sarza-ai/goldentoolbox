'use strict';
/* Golden Toolbox — Resend adapter for submitter confirmation emails.
   Free tier: 3,000 emails/month, no billing account. Separate from the
   existing Formspree owner-notification pipe (already works, stays
   untouched) — this specifically confirms to whoever submitted the form,
   at the email address they typed in, with a link to their report. */

const { escapeHtml } = require('./util');

const TIMEOUT_MS = 10000;
const FROM = process.env.RESEND_FROM || 'Golden Toolbox <checkup@goldentoolbox.com>';

function html(business, reportUrl) {
  return `
  <div style="font-family: Georgia, 'Playfair Display', serif; max-width: 480px; margin: 0 auto; color: #221B12; background: #F6EFE3; padding: 32px 24px;">
    <h1 style="font-size: 22px; margin: 0 0 12px;">Your Business Checkup is ready</h1>
    <p style="font-size: 15px; line-height: 1.6;">Thanks for requesting a free Business Checkup for <strong>${escapeHtml(business.name)}</strong>.</p>
    <p style="font-size: 15px; line-height: 1.6;">We checked your reviews, your website, your Google profile, your directory listings, and what happens when someone calls and you don't pick up — it's all in one report.</p>
    <p style="margin: 24px 0;">
      <a href="${reportUrl}" style="display:inline-block;background:#C9962B;color:#221B12;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-family:sans-serif;">View my Business Checkup</a>
    </p>
    <p style="font-size: 13px; color: #6E5F49;">Save this link — it's yours to keep, no account needed.</p>
  </div>`;
}

// Never blocks report generation — a missing key, a bad address, or a
// network hiccup here should never fail the actual report request.
async function sendConfirmation(toEmail, business, reportUrl) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !toEmail) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [toEmail],
        subject: `Your free Business Checkup for ${business.name} is ready`,
        html: html(business, reportUrl),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[email] resend send failed:', res.status, body.slice(0, 200));
    }
  } catch (e) {
    console.error('[email] resend send failed:', e.message);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendConfirmation };
