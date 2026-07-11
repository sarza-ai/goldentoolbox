'use strict';
/* Golden Toolbox — outcome-language copy, shared between mock and live
   adapters so a category reads the same regardless of data source.

   Product direction: explain the business consequence of a finding, not
   just what was or wasn't detected. "Google Analytics missing" tells a
   business owner nothing; "you can't tell which marketing brings in
   customers" tells them why it matters. These functions are the single
   source of truth for that framing per category. */

function technoStackSummary(found, total) {
  if (found === 0) return "You have no way to measure which marketing actually brings in customers — every dollar spent on ads or SEO is a guess.";
  if (found >= total) return 'Your marketing tracking is fully wired up — you can see exactly which channels bring in customers.';
  return `You're tracking some marketing activity, but ${total - found} of ${total} key signals are missing — some leads and ad spend aren't being measured.`;
}

function businessDetailsSummary(hasChat, chatProvider) {
  return hasChat
    ? `Visitors get an instant answer via your ${chatProvider} chat widget, even when you're on a job.`
    : 'A visitor with a quick question has no way to get an instant answer — they either call or leave, and some just leave.';
}

function gbpSummary(active, statusLabel) {
  return active
    ? 'Your Google Business Profile is live — often the first thing a customer sees before they ever visit your site.'
    : `Google shows this listing as "${statusLabel}" — a customer searching for you may not find a working profile at all.`;
}

function directorySummary(listedCount, total, avgAcc) {
  if (listedCount === total && avgAcc >= 90) {
    return "You're listed everywhere customers look, with details that match — no confusion about which listing is really you.";
  }
  return `You're listed on ${listedCount} of ${total} places customers check before calling — where the details don't match, some second-guess whether they've found the right business.`;
}

function reputationSummary(rating, count) {
  return `${rating.toFixed(1)}★ across ${count} reviews is what a customer sees before they ever hear your voice — often the deciding factor in who gets the call.`;
}

function performanceSummary(mobile) {
  if (mobile >= 80) return "Your site loads fast on a phone — visitors aren't waiting around before they see what you offer.";
  if (mobile >= 50) return 'Your homepage takes a few seconds too long to load on mobile — long enough that some visitors bail before they see your services.';
  return 'Your homepage loads slowly enough on mobile that some visitors leave before it even finishes loading — a lead lost before you ever knew they were there.';
}

function speedToLeadSummary(afterHoursPath) {
  return afterHoursPath
    ? 'You have at least one way for a customer to reach you after hours, but a missed phone call itself still goes straight to voicemail with no automatic follow-up.'
    : 'Right now, a missed call after hours just goes to voicemail with no follow-up — that customer is one search away from calling the next name on the list.';
}

function competitorsSummary(rank, total, trade, top) {
  const t = (trade || 'local').toLowerCase();
  if (rank === 1) return `You're the ${t} crew other businesses nearby are being compared against — the reviews and rating to beat.`;
  const topRating = Number(top.rating).toFixed(1);
  return `Customers comparing local ${t} businesses check reviews first. You rank #${rank} of ${total} nearby — the top crew shows ${top.reviews} reviews at ${topRating}★, and that gap is likely tipping some comparisons in their favor.`;
}

module.exports = {
  technoStackSummary, businessDetailsSummary, gbpSummary, directorySummary,
  reputationSummary, performanceSummary, speedToLeadSummary, competitorsSummary,
};
