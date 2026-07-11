'use strict';
/* Golden Toolbox — Directory Presence shared row-patcher (priority #6).
   Each real source (Places-Google, HTML-scan-Facebook, Yelp) patches only its
   own row via patchDirectoryRow; whichever rows haven't been patched yet stay
   as the mock baseline. Recomputes score/summary/checks from the merged set
   every time, so patches can land in any order. */

function patchDirectoryRow(priorDetails, name, rowPatch) {
  const dirs = (priorDetails.directories || []).map((d) => (d.name === name ? Object.assign({}, d, rowPatch) : d));
  const listedCount = dirs.filter((d) => d.listed).length;
  const avgAcc = Math.round(dirs.reduce((a, d) => a + (d.accuracy || 0), 0) / dirs.length);
  const score = Math.round(avgAcc * 0.6 + (listedCount / 3) * 40);
  return {
    score: Math.min(100, score),
    summary: buildSummary(dirs, listedCount, avgAcc),
    details: { directories: dirs, accuracy: avgAcc },
    checks: dirs.map((d) => ({
      label: d.name,
      ok: d.listed ? (d.displayValue ? true : d.accuracy >= 66) : false,
      value: d.listed ? (d.displayValue || d.accuracy + '% match') : (d.displayValue || 'Not listed'),
    })),
  };
}

function buildSummary(dirs, listedCount, avgAcc) {
  const liveNames = dirs.filter((d) => d.live).map((d) => d.name);
  const mockNames = dirs.filter((d) => !d.live).map((d) => d.name);
  let suffix = '';
  if (liveNames.length && mockNames.length) suffix = ` ${liveNames.join('/')} confirmed live; ${mockNames.join('/')} estimated.`;
  else if (liveNames.length) suffix = ` ${liveNames.join('/')} confirmed live.`;
  return `Listed on ${listedCount} of 3 major directories, ${avgAcc}% name/phone/address accuracy.${suffix}`;
}

module.exports = { patchDirectoryRow };
