'use strict';
/* Golden Toolbox — Speed-to-Lead adapter (priority #5).
   Phone type is offline/pattern-based via libphonenumber-js — no API call, no
   cost — labeled "estimated" since it's pattern-based, not carrier-verified.
   After-hours path detection (chat widget / booking form) reuses the HTML
   already fetched for the techstack scan — no extra network call. */

const { parsePhoneNumberFromString } = require('libphonenumber-js');

const BOOKING_SIGNATURES = /calendly\.com|acuityscheduling\.com|squareup\.com\/appointments|setmore\.com|housecallpro\.com|schedulicity\.com|servicetitan\.com\/book|book(?:ing)?[-_]?widget/i;

// The US/Canada numbering plan (NANP) does not encode mobile vs. landline in
// the number format itself — unlike many other countries, so libphonenumber
// almost always returns FIXED_LINE_OR_MOBILE for ordinary US geographic
// numbers. Claiming a confident "Mobile" there would overstate what the
// library actually knows; we label that case as genuinely undetermined.
function estimatePhoneType(phone) {
  if (!phone) return { type: 'Unknown', ok: true };
  try {
    const parsed = parsePhoneNumberFromString(phone, 'US');
    if (!parsed || !parsed.isValid()) return { type: 'Unknown', ok: true };
    const t = parsed.getType();
    if (t === 'FIXED_LINE') return { type: 'Landline', ok: false };
    if (t === 'MOBILE') return { type: 'Mobile', ok: true };
    if (t === 'FIXED_LINE_OR_MOBILE') return { type: 'Mobile/landline (unclear)', ok: true };
    if (t === 'VOIP') return { type: 'VoIP', ok: true };
    if (t === 'TOLL_FREE') return { type: 'Toll-free', ok: true };
    return { type: 'Unknown', ok: true };
  } catch (e) {
    return { type: 'Unknown', ok: true };
  }
}

function detectBooking(html) {
  return !!html && BOOKING_SIGNATURES.test(html);
}

// chatFound/hasBooking may be null when the site HTML couldn't be fetched —
// in that case we still return a live result built entirely from the (always
// available, offline) phone-type estimate, with the after-hours-path checks
// marked as unknown rather than guessed.
function buildSpeedToLead(phone, chatFound, html) {
  const phoneEst = estimatePhoneType(phone);
  const htmlAvailable = html != null;
  const hasBooking = htmlAvailable ? detectBooking(html) : null;
  const hasChat = htmlAvailable ? !!chatFound : null;
  const afterHoursPath = !!(hasChat || hasBooking);

  let score = 20;
  if (phoneEst.ok) score += 25;
  if (hasChat) score += 30;
  if (hasBooking) score += 25;
  if (!htmlAvailable) score += 20; // partial credit — we simply don't know, don't punish

  const summary = !htmlAvailable
    ? `Estimated phone type: ${phoneEst.type}. We couldn't check your site for an after-hours path.`
    : afterHoursPath
      ? 'You have at least one after-hours path, but a missed call still goes unanswered.'
      : 'Right now, a missed call after hours just goes to voicemail — and the next name down.';

  return {
    score: Math.min(100, score),
    summary,
    details: {
      phoneTypeEstimate: phoneEst.type,
      estimated: true,
      afterHoursChat: hasChat,
      afterHoursBooking: hasBooking,
      source: 'libphonenumber-js (offline, estimated)' + (htmlAvailable ? ' + live HTML scan' : ''),
    },
    checks: [
      { label: 'Phone type (estimated)', ok: phoneEst.ok, value: phoneEst.type },
      { label: 'After-hours chat path', ok: hasChat === null ? true : hasChat, value: hasChat === null ? 'Unknown' : (hasChat ? 'Yes' : 'No') },
      { label: 'Self-serve booking / callback form', ok: hasBooking === null ? true : hasBooking, value: hasBooking === null ? 'Unknown' : (hasBooking ? 'Yes' : 'No') },
    ],
  };
}

module.exports = { estimatePhoneType, detectBooking, buildSpeedToLead };
