/**
 * Profit calculator and marketplace recommendation engine.
 *
 * Every marketplace is scored on what the seller actually nets and how long the item is likely
 * to sit, then ranked according to what the seller says they care about.
 */

import { eligibility, fitScore, MARKETPLACES, realizationFor } from './marketplaces.js';
import { estimateShipping } from './shipping.js';

/**
 * Net proceeds for one item on one marketplace at a given asking price.
 *
 * The asking price is adjusted by the platform's realization factor first: the same item does
 * not fetch the same number on eBay as it does from a local buyer paying cash, so comparing
 * fee structures alone would make every zero-fee platform look like the winner.
 *
 * @param {object} item
 * @param {object} marketplace
 * @param {number} price
 * @param {object} [options]
 * @param {number} [options.taxRate]     Optional income set-aside, as a fraction of net.
 * @param {boolean} [options.raw]        Skip the realization adjustment and price as given.
 */
export function calculateProfit(item, marketplace, price, options = {}) {
  const { taxRate = 0, raw = false } = options;
  const shipping = estimateShipping(item);

  const realization = raw ? 1 : realizationFor(marketplace, item);
  const askPrice = price;
  price = round2(price * realization);

  const fee = round2(marketplace.fee(price));
  // Seller-paid postage comes out of proceeds; on buyer-paid platforms it does not, but the
  // seller still buys the box either way.
  const shippingCost = marketplace.shipping === 'seller' ? shipping.cost : 0;
  const packaging = marketplace.shipping === 'none' ? 0 : shipping.packaging;

  const grossNet = price - fee - shippingCost - packaging;
  const tax = round2(Math.max(0, grossNet) * taxRate);
  const net = round2(grossNet - tax);

  return {
    marketplaceId: marketplace.id,
    /** What the item realistically sells for here. */
    price: round2(price),
    /** What the seller asked, before the platform adjustment. */
    askPrice: round2(askPrice),
    realization,
    fee,
    shippingCost: round2(shippingCost),
    packaging: round2(packaging),
    tax,
    net,
    margin: price > 0 ? net / price : 0,
    shipping,
  };
}

const TIER_MULTIPLIER = { quick: 0.55, fair: 1, patient: 1.8 };

/** Rough time-to-sell in days, from platform velocity, category fit, demand, and price tier. */
export function expectedDays(marketplace, item, tier = 'fair') {
  const velocity =
    marketplace.speed * 0.5 + fitScore(marketplace, item.category) * 0.3 + (item.demand ?? 0.5) * 0.2;
  const base = 30 * (1 - 0.55 * velocity);
  return Math.max(1, Math.round(base * (TIER_MULTIPLIER[tier] ?? 1)));
}

const PRIORITY_WEIGHTS = {
  balanced: { profit: 0.5, speed: 0.33, effort: 0.17 },
  profit: { profit: 0.75, speed: 0.15, effort: 0.1 },
  speed: { profit: 0.25, speed: 0.65, effort: 0.1 },
};

/**
 * Rank every marketplace for an item.
 *
 * @param {object} item
 * @param {number} price      Asking price to evaluate at (normally the fair market price).
 * @param {object} [options]
 * @param {string} [options.condition]
 * @param {'balanced'|'profit'|'speed'} [options.priority]
 * @param {string} [options.tier]
 * @returns {Array} ranked entries, best first
 */
export function rankMarketplaces(item, price, options = {}) {
  const { condition = 'very-good', priority = 'balanced', tier = 'fair', taxRate = 0 } = options;
  const weights = PRIORITY_WEIGHTS[priority] ?? PRIORITY_WEIGHTS.balanced;

  const candidates = MARKETPLACES.map((marketplace) => {
    const check = eligibility(marketplace, item, condition);
    if (!check.eligible) return { marketplace, eligible: false, reason: check.reason };

    const profit = calculateProfit(item, marketplace, price, { taxRate });
    const days = expectedDays(marketplace, item, tier);
    return { marketplace, eligible: true, profit, days, fit: fitScore(marketplace, item.category) };
  });

  const eligible = candidates.filter((c) => c.eligible);
  if (!eligible.length) return [];

  const nets = eligible.map((c) => c.profit.net);
  const days = eligible.map((c) => c.days);
  const maxNet = Math.max(...nets);
  const minNet = Math.min(...nets);
  const maxDays = Math.max(...days);
  const minDays = Math.min(...days);

  const scored = eligible.map((entry) => {
    const profitScore = normalise(entry.profit.net, minNet, maxNet);
    const speedScore = 1 - normalise(entry.days, minDays, maxDays);
    const effortScore = 1 - entry.marketplace.effort;
    const score =
      profitScore * weights.profit + speedScore * weights.speed + effortScore * weights.effort;
    return { ...entry, profitScore, speedScore, effortScore, score };
  });

  const ordered = order(scored, priority);

  const bestNet = Math.max(...ordered.map((s) => s.profit.net));
  const fastest = Math.min(...ordered.map((s) => s.days));

  return ordered.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    badges: badgesFor(entry, { bestNet, fastest }),
    why: explain(entry, { bestNet, fastest, item }),
  }));
}

/**
 * Apply the seller's stated priority to the ranking.
 *
 * A weighted score alone is not enough: when the seller explicitly asks for the most money, a
 * $2 difference should still put the higher payout first, even though the composite score would
 * happily trade it away for convenience. So an explicit priority sorts on that dimension
 * directly, and the composite score only breaks ties between options that are materially equal.
 */
function order(scored, priority) {
  if (priority === 'profit') {
    return leadWith(scored, (e) => e.profit.net, 'desc');
  }
  if (priority === 'speed') {
    return leadWith(scored, (e) => e.days, 'asc');
  }
  return [...scored].sort((a, b) => b.score - a.score);
}

/** Sort by `metric`, then re-order the statistically tied leaders by overall score. */
function leadWith(scored, metric, direction) {
  const sorted = [...scored].sort((a, b) =>
    direction === 'desc' ? metric(b) - metric(a) : metric(a) - metric(b),
  );

  const best = metric(sorted[0]);
  // Within 1% on the chosen metric counts as a draw; prefer the better all-round option.
  const isTied = (entry) =>
    direction === 'desc'
      ? metric(entry) >= best * 0.99
      : metric(entry) <= best * 1.01;

  const tied = sorted.filter(isTied).sort((a, b) => b.score - a.score);
  const rest = sorted.filter((entry) => !isTied(entry));
  return [...tied, ...rest];
}

function badgesFor(entry, { bestNet, fastest }) {
  const badges = [];
  if (entry.profit.net === bestNet) badges.push('Highest profit');
  if (entry.days === fastest) badges.push('Fastest sale');
  if (entry.marketplace.effort <= 0.15) badges.push('Least effort');
  if (entry.fit >= 0.9) badges.push('Best category fit');
  return badges;
}

function explain(entry, { bestNet, fastest, item }) {
  const { marketplace, profit, days, fit } = entry;
  const parts = [];

  if (profit.net === bestNet) {
    parts.push(`nets the most at $${profit.net.toFixed(2)} after ${marketplace.feeLabel.toLowerCase()}`);
  } else {
    const gap = (bestNet - profit.net).toFixed(2);
    parts.push(`nets $${profit.net.toFixed(2)}, about $${gap} less than the best option`);
  }

  if (days === fastest) parts.push(`and typically sells fastest here, around ${days} days`);
  else parts.push(`with a typical sale in about ${days} days`);

  if (fit >= 0.85) parts.push(`— this is where ${item.category} buyers actually shop`);

  if (profit.realization < 0.97) {
    const discount = Math.round((1 - profit.realization) * 100);
    parts.push(`— expect to settle around ${discount}% under your asking price here`);
  } else if (profit.realization > 1.02) {
    parts.push('— buyers here accept higher asking prices');
  }

  if (marketplace.shipping === 'none') parts.push('— but it is cash on pickup with no fees');
  if (marketplace.shipping === 'buyer') parts.push('— and the buyer pays shipping');

  return `${marketplace.name} ${parts.join(' ')}.`;
}

function normalise(value, min, max) {
  if (max === min) return 1;
  return (value - min) / (max - min);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Sell-versus-donate guidance. Below roughly $20 of net proceeds the time cost of listing,
 * packing, and shipping outweighs the money, and saying so is what earns trust.
 */
export function sellOrDonate(item, bestEntry) {
  if (!bestEntry) {
    return {
      verdict: 'donate',
      headline: 'Not worth listing',
      detail: 'No marketplace can carry this item profitably. Donate it and take the deduction.',
    };
  }

  const net = bestEntry.profit.net;
  const effortHours = 0.4 + (bestEntry.profit.shipping.shippable ? 0.3 : 0.2);
  const hourly = net / effortHours;

  if (net < 12) {
    return {
      verdict: 'donate',
      headline: 'Donate this one',
      detail: `Roughly $${net.toFixed(0)} after fees and shipping. Donating is worth more than the hour it would take to sell.`,
      hourly,
    };
  }
  if (net < 25) {
    return {
      verdict: 'bundle',
      headline: 'Bundle it',
      detail: `About $${net.toFixed(0)} on its own — thin for the effort. Group it with similar items and sell the lot.`,
      hourly,
    };
  }
  return {
    verdict: 'sell',
    headline: 'Worth selling',
    detail: `About $${net.toFixed(0)} net, roughly $${hourly.toFixed(0)}/hour for the time it takes to list and ship.`,
    hourly,
  };
}
