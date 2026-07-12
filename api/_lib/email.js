'use strict';
/* Golden Toolbox — Resend adapter for the owner notification email.
   Free tier: 3,000 emails/month, no billing account. Sends to a single
   fixed address (you) the moment any report finishes generating — separate
   from the existing Formspree pipe (untouched, keeps running alongside this
   as a second, redundant channel).
   Uses Resend's sandbox sender (onboarding@resend.dev), which can deliver
   to your own account email with NO domain verification required. If
   goldentoolbox.com is later verified in Resend, set RESEND_FROM to a
   verified address to upgrade the "from" name — no other change needed. */

const { escapeHtml } = require('./util');

const TIMEOUT_MS = 10000;
const FROM = process.env.RESEND_FROM || 'Golden Toolbox <onboarding@resend.dev>';
const TO = process.env.OWNER_EMAIL || 'hello@sarza.ai';

function html(business, contact, reportUrl, cached) {
  return `
  <div style="font-family: Georgia, 'Playfair Display', serif; max-width: 480px; margin: 0 auto; color: #221B12; background: #F6EFE3; padding: 32px 24px;">
    <h1 style="font-size: 22px; margin: 0 0 12px;">${cached ? 'Existing report requested again' : 'New Business Checkup completed'}</h1>
    <p style="font-size: 15px; line-height: 1.6;"><strong>${escapeHtml(business.name)}</strong></p>
    <p style="font-size: 14px; line-height: 1.6; color: #6E5F49;">
      ${contact.name ? `Name: ${escapeHtml(contact.name)}<br>` : ''}
      ${contact.email ? `Email: ${escapeHtml(contact.email)}<br>` : ''}
      ${contact.phone || business.phone ? `Phone: ${escapeHtml(contact.phone || business.phone)}<br>` : ''}
    </p>
    <p style="margin: 24px 0;">
      <a href="${reportUrl}" style="display:inline-block;background:#C9962B;color:#221B12;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-family:sans-serif;">View the report</a>
    </p>
  </div>`;
}

// Never blocks report generation — a missing key or a network hiccup here
// should never fail the actual report request.
async function notifyOwner(business, contact, reportUrl, cached) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject: `${cached ? '[Repeat] ' : ''}Business Checkup: ${business.name}`,
        html: html(business, contact, reportUrl, cached),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[email] resend send failed:', res.status, body.slice(0, 200));
    } else {
      console.log('[email] resend notify sent for', business.name);
    }
  } catch (e) {
    console.error('[email] resend send failed:', e.message);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { notifyOwner };
