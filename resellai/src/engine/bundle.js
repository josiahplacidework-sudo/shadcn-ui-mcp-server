/**
 * Bundle builder.
 *
 * Decides whether a set of scanned items should be sold individually or grouped. Bundling
 * trades a little revenue for a much shorter time to sell, and it rescues low-value items that
 * are not worth listing on their own.
 */

import { priceItem } from './pricing.js';
import { expectedDays, rankMarketplaces } from './profit.js';

/** Items that plausibly belong in the same listing. */
const AFFINITY = [
  ['gaming', 'toys'],
  ['apparel', 'sneakers', 'luxury'],
  ['tools', 'sporting'],
  ['electronics', 'camera'],
  ['appliance', 'furniture'],
];

function affinityScore(categories) {
  const unique = [...new Set(categories)];
  if (unique.length === 1) return 1;
  const group = AFFINITY.find((set) => unique.every((c) => set.includes(c)));
  if (group) return 0.8;
  return Math.max(0.25, 1 - (unique.length - 1) * 0.22);
}

/**
 * @param {Array<{item:object, condition?:string}>} entries
 * @returns {object} bundle analysis and a recommendation
 */
export function analyseBundle(entries) {
  if (!entries || entries.length < 2) {
    return { viable: false, reason: 'Scan at least two items to compare bundling.' };
  }

  const priced = entries.map(({ item, condition = 'very-good' }) => {
    const pricing = priceItem(item, { condition });
    const ranked = rankMarketplaces(item, pricing.prices.fair, { condition });
    const best = ranked[0];
    return {
      item,
      condition,
      pricing,
      fair: pricing.prices.fair,
      net: best ? best.profit.net : 0,
      days: best ? best.days : 45,
      marketplace: best?.marketplace,
    };
  });

  const separateTotal = priced.reduce((sum, p) => sum + p.fair, 0);
  const separateNet = round2(priced.reduce((sum, p) => sum + p.net, 0));
  // Selling separately means waiting for the slowest item to move.
  const separateDays = Math.max(...priced.map((p) => p.days));
  const separateEffortHours = round1(priced.length * 0.55);

  const cohesion = affinityScore(priced.map((p) => p.item.category));
  // Buyers expect a discount for taking the lot; deeper for larger, less cohesive groups.
  const discount = clamp(0.06 + (priced.length - 2) * 0.02 + (1 - cohesion) * 0.14, 0.06, 0.28);
  const bundlePrice = roundTo5(separateTotal * (1 - discount));

  const anchor = priced.reduce((best, p) => (p.fair > best.fair ? p : best), priced[0]);
  const bundleRanked = rankMarketplaces(anchor.item, bundlePrice, { condition: anchor.condition });
  const bundleBest = bundleRanked[0];
  // Falling back to the gross price would count fees as profit, making a bundle look best in
  // exactly the case where nothing can be sold at all. Match the per-item fallback of 0.
  const bundleNet = bundleBest ? bundleBest.profit.net : 0;
  const bundleDays = bundleBest
    ? Math.round(expectedDays(bundleBest.marketplace, anchor.item, 'fair') * (1.15 - cohesion * 0.35))
    : Math.round(separateDays * 0.6);
  const bundleEffortHours = 0.7;

  // Value the time saved. Below this rate, waiting for individual sales is not worth it.
  const hoursSaved = separateEffortHours - bundleEffortHours;
  const daysSaved = separateDays - bundleDays;
  const netGiveUp = round2(separateNet - bundleNet);

  const lowValueCount = priced.filter((p) => p.net < 25).length;
  const recommendBundle =
    cohesion >= 0.75 && (lowValueCount >= 1 || netGiveUp <= separateNet * 0.15) && daysSaved > 0;

  return {
    viable: true,
    items: priced,
    cohesion,
    discount,
    separate: {
      total: round2(separateTotal),
      net: separateNet,
      days: separateDays,
      effortHours: separateEffortHours,
      listings: priced.length,
    },
    bundle: {
      price: bundlePrice,
      net: round2(bundleNet),
      days: bundleDays,
      effortHours: bundleEffortHours,
      listings: 1,
      marketplace: bundleBest?.marketplace,
      title: bundleTitle(priced),
    },
    recommendation: recommendBundle ? 'bundle' : 'separate',
    rationale: rationale({ recommendBundle, netGiveUp, daysSaved, hoursSaved, lowValueCount, cohesion, priced }),
  };
}

function rationale({ recommendBundle, netGiveUp, daysSaved, hoursSaved, lowValueCount, cohesion, priced }) {
  if (recommendBundle) {
    // netGiveUp is negative when bundling actually nets more — one fee and one shipment instead
    // of several. Reporting its absolute value would tell the seller they are losing money on
    // the option being recommended to them.
    const money =
      netGiveUp > 0
        ? `gives up about $${netGiveUp.toFixed(0)}`
        : `nets about $${Math.abs(netGiveUp).toFixed(0)} more`;

    const parts = [
      `Bundling ${money} and sells roughly ${daysSaved} days sooner, saving ${hoursSaved.toFixed(1)} hours of listing work.`,
    ];
    if (lowValueCount) {
      parts.push(
        `${lowValueCount} of these ${lowValueCount === 1 ? 'is' : 'are'} too thin to list alone — the bundle is what makes ${lowValueCount === 1 ? 'it' : 'them'} worth anything.`,
      );
    }
    return parts.join(' ');
  }

  if (cohesion < 0.75) {
    return 'These items appeal to different buyers, so a bundle would narrow your audience without speeding up the sale. List them separately.';
  }
  return netGiveUp >= 0
    ? `Selling separately nets about $${netGiveUp.toFixed(0)} more, and each of these ${priced.length} items is valuable enough to justify its own listing.`
    : `Bundling would net about $${Math.abs(netGiveUp).toFixed(0)} more, but these ${priced.length} items appeal to different buyers, so separate listings will each find their own.`;
}

function bundleTitle(priced) {
  const brands = [...new Set(priced.map((p) => p.item.brand))];
  const categories = [...new Set(priced.map((p) => p.item.category))];
  const lead = brands.length === 1 ? brands[0] : categories.length === 1 ? categories[0] : 'Mixed';
  return `${titleCase(lead)} Bundle — ${priced.length} Items`;
}

function titleCase(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundTo5(value) {
  return Math.round(value / 5) * 5;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
