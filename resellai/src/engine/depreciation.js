/**
 * Depreciation model.
 *
 * Answers the question behind "should I wait?" — what holding this item actually costs per
 * month. Most categories bleed value; a few (trading cards, retired LEGO, some sneakers)
 * appreciate, and telling someone to sell an appreciating asset would be bad advice.
 *
 * Rates are annual, applied geometrically. A negative rate appreciates.
 */

import { priceItem } from './pricing.js';

const ANNUAL_DECAY = {
  electronics: 0.28,
  fitness: 0.22,
  camera: 0.2,
  apparel: 0.2,
  gaming: 0.18,
  books: 0.15,
  appliance: 0.14,
  sporting: 0.13,
  tools: 0.1,
  furniture: 0.09,
  luxury: 0.08,
  instrument: 0.06,
  sneakers: 0.05,
  toys: -0.02, // retired sets drift up
  cards: -0.06, // graded and vintage cards appreciate
};

const DEFAULT_DECAY = 0.15;

export function decayRate(category) {
  return ANNUAL_DECAY[category] ?? DEFAULT_DECAY;
}

/** Value after `years`, compounding the annual rate. */
export function projectValue(value, category, years) {
  const rate = decayRate(category);
  return value * (1 - rate) ** years;
}

/**
 * @param {object} input
 * @param {object} input.item
 * @param {string} [input.condition]
 * @param {number} [input.purchasePrice]   From a receipt, if known.
 * @param {string|number} [input.purchaseDate]
 * @returns {object} current value, projections, monthly cost of holding, and a recommendation
 */
export function analyseDepreciation(input) {
  const { item, condition = 'very-good', purchasePrice, purchaseDate } = input;

  const pricing = priceItem(item, { condition });
  const current = pricing.prices.fair;
  const rate = decayRate(item.category);
  const appreciating = rate < 0;

  const inSixMonths = Math.round(projectValue(current, item.category, 0.5));
  const inTwelveMonths = Math.round(projectValue(current, item.category, 1));
  const monthlyChange = round2(current - projectValue(current, item.category, 1 / 12));

  const owned = ownership({ purchasePrice, purchaseDate, current, item });

  return {
    current,
    rate,
    appreciating,
    inSixMonths,
    inTwelveMonths,
    /** Positive means it costs this much per month to keep. */
    monthlyChange,
    sixMonthCost: Math.round(current - inSixMonths),
    ...owned,
    recommendation: recommend({ appreciating, monthlyChange, current, inSixMonths }),
  };
}

function ownership({ purchasePrice, purchaseDate, current, item }) {
  // `0` is a legitimate purchase price — gifts, hand-me-downs, and kerbside finds are common in
  // resale — so only a missing price counts as unknown.
  if (purchasePrice == null || !purchaseDate) return { known: false };

  const purchased = new Date(purchaseDate);
  if (Number.isNaN(purchased.getTime())) return { known: false };

  const ageYears = Math.max(0, (Date.now() - purchased.getTime()) / (365.25 * 86400000));
  const lost = round2(purchasePrice - current);

  return {
    known: true,
    purchasePrice,
    purchaseDate: purchased.toISOString().slice(0, 10),
    ageYears: round1(ageYears),
    retained: purchasePrice > 0 ? current / purchasePrice : null,
    lost,
    /** What it has cost per month of ownership so far. */
    costPerMonth: ageYears > 0 ? round2(lost / (ageYears * 12)) : null,
    /** Manufacturer warranties are typically a year. */
    inWarranty: ageYears < 1 && !['cards', 'books', 'apparel'].includes(item.category),
  };
}

function recommend({ appreciating, monthlyChange, current, inSixMonths }) {
  if (appreciating) {
    return {
      verdict: 'hold',
      headline: 'This one is gaining value',
      detail: `This category tends to appreciate — about ${money(Math.abs(monthlyChange))} a month at this value. There is no rush to sell, so list it only when you want the cash.`,
    };
  }

  // Below a dollar a month, the decay is noise next to the effort of selling.
  if (monthlyChange < 1) {
    return {
      verdict: 'no-rush',
      headline: 'Holding costs you almost nothing',
      detail: `This loses roughly ${money(monthlyChange)} a month. Sell it when it suits you — waiting is not costing you meaningfully.`,
    };
  }

  const sixMonthLoss = current - inSixMonths;
  if (monthlyChange >= 4 || sixMonthLoss / current > 0.15) {
    return {
      verdict: 'sell-now',
      headline: 'Sell this sooner rather than later',
      detail: `It is shedding about ${money(monthlyChange)} every month. Waiting six months costs you roughly ${money(sixMonthLoss)} — more than most people expect.`,
    };
  }

  return {
    verdict: 'sell-soon',
    headline: 'Worth listing in the next month or two',
    detail: `About ${money(monthlyChange)} a month of value is draining away — around ${money(sixMonthLoss)} over six months.`,
  };
}

function money(n) {
  return `$${Math.abs(Number(n ?? 0)).toFixed(2).replace(/\.00$/, '')}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
