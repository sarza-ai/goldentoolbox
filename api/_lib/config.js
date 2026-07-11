'use strict';
/* Golden Toolbox — Business Checkup scoring config + Four-Tools framing map */

// The four tools as pitched on goldentoolbox.com
const TOOLS = {
  reputation: { name: 'The Reputation Tool', anchor: '/#tool-reviews' },
  visibility: { name: 'The Visibility Tool', anchor: '/#tool-website' },
  leadcapture: { name: 'The Lead Capture Tool', anchor: '/#tool-booking' },
  time: { name: 'The Time Tool', anchor: '/#tool-time' },
};

// Category definitions in report display order — ordered for narrative and
// emotional impact (biggest revenue-relevant story first), not by data
// pipeline / collection order. Speed-to-Lead leads because "what happens
// when someone calls right now" is the single most visceral, ownable moment
// in the report. Techno Stack sits last — real signal, but the least human
// of the eight, so it reads as an appendix rather than an opener.
// weight -> contribution to the overall rolled score (unaffected by order).
const CATEGORIES = [
  {
    id: 'speed-to-lead',
    label: 'Speed-to-Lead',
    weight: 1.2,
    tools: ['leadcapture'],
    blurb: 'What happens the moment someone calls and you cannot pick up.',
  },
  {
    id: 'reputation',
    label: 'Online Reputation',
    weight: 1.4,
    tools: ['reputation'],
    blurb: 'Your star rating, review volume, and how you respond.',
  },
  {
    id: 'gbp',
    label: 'Google Business Profile',
    weight: 1.4,
    tools: ['visibility'],
    blurb: 'Your storefront on Google Search and Maps.',
  },
  {
    id: 'directory',
    label: 'Directory Presence',
    weight: 1,
    tools: ['visibility', 'reputation'],
    blurb: 'Whether Google, Facebook, Nextdoor, and X agree on who you are.',
  },
  {
    id: 'competitors',
    label: 'Local Competitor Snapshot',
    weight: 1,
    tools: ['visibility', 'reputation'],
    blurb: 'Where you land against the crews you show up next to.',
  },
  {
    id: 'performance',
    label: 'Website Performance',
    weight: 1.2,
    tools: ['visibility'],
    blurb: 'How fast and healthy your site is on a real phone.',
  },
  {
    id: 'business-details',
    label: 'Business Details',
    weight: 1,
    tools: ['visibility'],
    blurb: 'How well your site turns visitors into conversations.',
  },
  {
    id: 'techno-stack',
    label: 'Techno Stack',
    weight: 1,
    tools: ['visibility'],
    blurb: 'The tracking and ads plumbing that lets you measure and grow.',
  },
];

// Grade bands for score presentation.
function grade(score) {
  if (score >= 85) return { label: 'Strong', band: 'good' };
  if (score >= 65) return { label: 'Decent', band: 'ok' };
  if (score >= 40) return { label: 'Needs work', band: 'warn' };
  return { label: 'At risk', band: 'bad' };
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
  if (categoryId === 'directory' || categoryId === 'competitors') {
    return {
      headline: "You're invisible where it counts — and getting outranked.",
      tools: toolNames,
      tool_anchors: def.tools.map((t) => TOOLS[t].anchor),
    };
  }
  const map = {
    'business-details': 'A sharper site turns more of your visitors into booked jobs.',
    'techno-stack': "You can't grow what you can't measure — the tracking isn't in place.",
    'gbp': 'Your Google storefront is doing less work than it could.',
    'reputation': 'Better crews lose to better reviews. This is fixable on autopilot.',
    'performance': 'A slow site quietly sends people back to the search results.',
    'speed-to-lead': 'Every missed call you never text back is a job for the next name down.',
  };
  return {
    headline: map[categoryId] || def.blurb,
    tools: toolNames,
    tool_anchors: def.tools.map((t) => TOOLS[t].anchor),
  };
}

module.exports = { TOOLS, CATEGORIES, grade, rollup, framingFor };
