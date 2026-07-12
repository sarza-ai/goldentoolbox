'use strict';
/* Golden Toolbox — Business Checkup scoring config + Four-Tools framing map.

   Restructured around a customer's-eye view: "if I were trying to hire this
   business today, what would my experience be — and where would they lose me?"
   Categories are scored from weighted checks (see util.scoreChecks) where
   nice-to-haves only add credit, never subtract — so a business that nails the
   fundamentals reaches Excellent without paid ads, chat bots, or an X account. */

// The four tools as pitched on goldentoolbox.com
const TOOLS = {
  reputation: { name: 'The Reputation Tool', anchor: '/#tool-reviews' },
  visibility: { name: 'The Visibility Tool', anchor: '/#tool-website' },
  leadcapture: { name: 'The Lead Capture Tool', anchor: '/#tool-booking' },
  time: { name: 'The Time Tool', anchor: '/#tool-time' },
};

// Category definitions in report display order.
// weight -> contribution to the overall rolled score.
const CATEGORIES = [
  {
    id: 'reputation',
    label: 'Reputation',
    weight: 1.5,
    tools: ['reputation'],
    blurb: 'Your star rating, review volume, freshness, and how you respond.',
  },
  {
    id: 'visibility',
    label: 'Visibility',
    weight: 1.5,
    tools: ['visibility'],
    blurb: 'How easily a customer finds you on Google — and whether your site is set up to be found.',
  },
  {
    id: 'customer-experience',
    label: 'Customer Experience',
    weight: 1.2,
    tools: ['visibility', 'leadcapture'],
    blurb: 'What a real customer runs into when they land on your site and try to reach you.',
  },
  {
    id: 'lead-capture',
    label: 'Lead Capture',
    weight: 1.3,
    tools: ['leadcapture', 'time'],
    blurb: 'How many ways a customer can actually reach you — and what happens after hours.',
  },
  {
    id: 'trust-signals',
    label: 'Trust Signals',
    weight: 1,
    tools: ['reputation', 'visibility'],
    blurb: 'The proof on your site that you are licensed, insured, and worth hiring.',
  },
  {
    id: 'content-quality',
    label: 'Content Quality',
    weight: 1,
    tools: ['visibility'],
    blurb: 'Whether your homepage makes it obvious what you do and why to choose you.',
  },
  {
    id: 'performance',
    label: 'Website Performance',
    weight: 1,
    tools: ['visibility'],
    blurb: 'How fast and healthy your site is on a real phone.',
  },
  {
    id: 'competitors',
    label: 'Competitive Position',
    weight: 1.2,
    tools: ['visibility', 'reputation'],
    blurb: 'Where you land against the crews you show up next to on Google.',
  },
];

// Grade bands for score presentation. These are the "maturity bands" — the
// overall number is still computed behind the scenes, but every score is
// spoken about as one of these four levels, not a bare percentage.
function grade(score) {
  if (score >= 85) return { label: 'Excellent', band: 'good' };
  if (score >= 65) return { label: 'Good', band: 'ok' };
  if (score >= 45) return { label: 'Needs Improvement', band: 'warn' };
  return { label: 'High Priority', band: 'bad' };
}

// Roll category scores into one overall (weighted average).
function rollup(categories) {
  let total = 0, wsum = 0;
  categories.forEach((c) => {
    const def = CATEGORIES.find((d) => d.id === c.id);
    const w = def ? def.weight : 1;
    total += c.score * w;
    wsum += w;
  });
  return wsum ? Math.round(total / wsum) : 0;
}

// Build the "what this ties back to" framing line for a low-scoring category.
function framingFor(categoryId) {
  const def = CATEGORIES.find((d) => d.id === categoryId);
  if (!def) return null;
  const toolNames = def.tools.map((t) => TOOLS[t].name);
  const map = {
    'reputation': 'Better crews lose to better reviews. This is fixable on autopilot.',
    'visibility': "If customers can't find you on Google, the job goes to whoever they do find.",
    'customer-experience': 'Every extra step between a visitor and reaching you is a job walking out the door.',
    'lead-capture': 'The easier you are to reach, the more of your traffic turns into booked work.',
    'trust-signals': "Buyers hire the business that feels safe. Right now your site isn't proving it.",
    'content-quality': "If a visitor can't tell what you do in five seconds, they hit the back button.",
    'performance': 'A slow site quietly sends people back to the search results.',
    'competitors': "You're getting outranked by crews a customer sees right next to you.",
  };
  return {
    headline: map[categoryId] || def.blurb,
    tools: toolNames,
    tool_anchors: def.tools.map((t) => TOOLS[t].anchor),
  };
}

module.exports = { TOOLS, CATEGORIES, grade, rollup, framingFor };
