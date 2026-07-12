'use strict';
/* Golden Toolbox — Lead Capture (the signature category).
   Scored by HOW MANY ways a customer can reach you, then banded — not by
   whether you have any one specific tool. This is the deliberate fix for the
   old Speed-to-Lead math, which treated "no live chat / no online booking" as
   a failure and capped ordinary phone-first businesses in the 40s.

   Bands:
     4+ channels  -> Excellent   (90)
     2-3 channels -> Good        (72)
     phone only   -> Needs work  (55)
     email only   -> Poor        (35)
     none found   -> High Priority (18)
   After-hours coverage (chat or booking) nudges within a band but never
   creates a penalty. */

const { parsePhoneNumberFromString } = require('libphonenumber-js');

const CHANNEL_LABELS = {
  phone: 'Phone number',
  email: 'Email address',
  form: 'Contact / quote form',
  chat: 'Live chat',
  booking: 'Online booking',
  text: 'Text / SMS',
};

function bandFor(channels) {
  const present = Object.keys(CHANNEL_LABELS).filter((k) => channels[k]);
  const count = present.length;
  const afterHours = !!(channels.chat || channels.booking);

  let score;
  if (count >= 4) score = 90;
  else if (count >= 2) score = 72;
  else if (count === 1 && channels.phone) score = 55;
  else if (count === 1 && channels.email) score = 35;
  else if (count === 1) score = 50; // one non-phone/email channel
  else score = 18;

  if (afterHours && score < 90) score += 4; // small nudge, never a penalty
  return { score, count, afterHours, present };
}

// Shared result builder — mock passes random channel booleans, the live path
// passes booleans detected from the site HTML + phone type. Identical shape.
function buildLeadCaptureResult(channels, extra = {}) {
  const { score, count, afterHours } = bandFor(channels);
  const checks = Object.keys(CHANNEL_LABELS).map((k) => ({
    label: CHANNEL_LABELS[k],
    ok: !!channels[k],
    value: channels[k] ? 'Available' : 'Not offered',
  }));

  let summary;
  if (count >= 4) summary = `Customers have ${count} easy ways to reach you — that's how you turn traffic into booked jobs.`;
  else if (count >= 2) summary = `Customers have ${count} ways to reach you. Adding one more after-hours path would tighten the net.`;
  else if (count === 1 && channels.phone) summary = 'Phone is the only way to reach you — every missed call is a job for the next name down.';
  else if (count === 1 && channels.email) summary = 'Email is the only listed way to reach you — most customers won\'t wait on a reply.';
  else if (count === 0) summary = 'We couldn\'t find a clear way for a customer to reach you from your site.';
  else summary = 'There\'s one way to reach you — more paths would capture more of your traffic.';

  return {
    score,
    summary,
    details: Object.assign({
      channelCount: count,
      channels,
      afterHoursPath: afterHours,
    }, extra),
    checks,
  };
}

// --- live phone-type estimate (offline, free) -----------------------------
// NANP numbers don't encode mobile vs landline in their format, so
// libphonenumber usually returns FIXED_LINE_OR_MOBILE for US geographic
// numbers — we don't overclaim "Mobile" there.
function estimatePhoneType(phone) {
  if (!phone) return 'Unknown';
  try {
    const parsed = parsePhoneNumberFromString(phone, 'US');
    if (!parsed || !parsed.isValid()) return 'Unknown';
    const t = parsed.getType();
    if (t === 'FIXED_LINE') return 'Landline';
    if (t === 'MOBILE') return 'Mobile';
    if (t === 'FIXED_LINE_OR_MOBILE') return 'Mobile/landline (unclear)';
    if (t === 'VOIP') return 'VoIP';
    if (t === 'TOLL_FREE') return 'Toll-free';
    return 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

module.exports = { buildLeadCaptureResult, bandFor, estimatePhoneType, CHANNEL_LABELS };
