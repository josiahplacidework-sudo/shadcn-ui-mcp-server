/**
 * Pricing engine.
 *
 * Turns a set of recent sold comps into three price points — quick sale, fair market, and
 * patient seller — after adjusting for condition, accessory completeness, seasonality, and
 * demand. The spread between the three widens when the comps disagree with each other, which
 * is the honest way to express "we are less sure about this one".
 */

import { conditionFactor, getCondition } from './condition.js';

/**
 * Per-category monthly demand multipliers, January → December.
 * Derived from the seasonal patterns resellers plan around: fitness gear in January, bikes and
 * patio furniture in spring, back-to-school in August, gifting categories in Q4.
 */
const SEASONALITY = {
  fitness: [1.22, 1.14, 1.04, 0.97, 0.92, 0.89, 0.88, 0.92, 0.96, 1.0, 1.04, 1.08],
  sporting: [0.9, 0.94, 1.04, 1.12, 1.16, 1.14, 1.08, 1.02, 0.98, 0.94, 0.9, 0.88],
  furniture: [0.94, 0.95, 1.0, 1.05, 1.12, 1.14, 1.12, 1.08, 1.02, 0.97, 0.94, 0.92],
  gaming: [0.96, 0.95, 0.96, 0.97, 0.98, 1.0, 1.0, 1.02, 1.04, 1.08, 1.16, 1.18],
  toys: [0.92, 0.92, 0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.08, 1.14, 1.22, 1.2],
  sneakers: [0.97, 0.98, 1.0, 1.0, 0.99, 0.97, 1.0, 1.08, 1.06, 1.02, 1.04, 1.08],
  apparel: [0.96, 0.97, 1.02, 1.04, 1.0, 0.96, 0.95, 1.06, 1.08, 1.04, 1.02, 1.0],
  appliance: [0.98, 0.97, 0.98, 1.0, 1.02, 1.0, 0.98, 1.0, 1.02, 1.06, 1.14, 1.12],
  books: [1.0, 0.98, 0.97, 0.96, 0.96, 0.94, 1.02, 1.14, 1.08, 0.98, 0.98, 1.0],
  electronics: [0.97, 0.96, 0.97, 0.98, 1.0, 1.0, 1.0, 1.04, 1.04, 1.04, 1.1, 1.12],
};

const FLAT_SEASON = new Array(12).fill(1);

export function seasonalityFactor(category, month = new Date().getMonth()) {
  const curve = SEASONALITY[category] ?? FLAT_SEASON;
  return curve[((month % 12) + 12) % 12];
}

export function seasonalityCurve(category) {
  return SEASONALITY[category] ?? FLAT_SEASON;
}

/** Mean of the comps after discarding the single highest and lowest outlier. */
export function trimmedMean(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const kept = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
  return kept.reduce((sum, n) => sum + n, 0) / kept.length;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Coefficient of variation — how much the comps disagree, as a fraction of the mean. */
export function compVariance(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / mean;
}

/** Fraction of the item's accessories the seller actually has. Items with none score 1. */
export function completeness(item, includedAccessories) {
  const total = item.accessories?.length ?? 0;
  if (total === 0) return 1;
  const included = includedAccessories ?? item.accessories;
  return Math.min(1, included.length / total);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Marketplace-friendly rounding: clean dollars low, multiples of five higher up. */
export function roundPrice(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 100) return Math.round(value);
  if (value < 500) return Math.round(value / 5) * 5;
  return Math.round(value / 10) * 10;
}

/**
 * @param {object} item          Catalog entry.
 * @param {object} [options]
 * @param {string} [options.condition]              Condition id, defaults to Very Good.
 * @param {string[]} [options.includedAccessories]  Accessories the seller has.
 * @param {number} [options.month]                  0-indexed month, defaults to now.
 * @param {number} [options.recognitionConfidence]  0–1 from the vision model.
 * @returns {object} price points, adjustment breakdown, and a confidence score.
 */
export function priceItem(item, options = {}) {
  const {
    condition = 'very-good',
    includedAccessories,
    month = new Date().getMonth(),
    recognitionConfidence = 1,
  } = options;

  const comps = item.comps ?? [];
  const base = trimmedMean(comps);
  const variance = compVariance(comps);

  const cond = conditionFactor(condition);
  const season = seasonalityFactor(item.category, month);
  const demand = 1 + ((item.demand ?? 0.5) - 0.6) * 0.18;
  const complete = completeness(item, includedAccessories);
  const accessory = 0.84 + 0.16 * complete;

  const market = base * cond * season * demand * accessory;

  // Volatile comps mean a wider realistic band in both directions.
  const downside = clamp(0.1 + variance * 0.35, 0.1, 0.24);
  const upside = clamp(0.1 + variance * 0.4, 0.1, 0.3);

  // Confidence blends how well we recognised the item with how tightly the comps agree.
  const compConfidence = clamp(1 - variance * 1.6, 0.35, 0.98);
  const confidence = clamp(recognitionConfidence * 0.55 + compConfidence * 0.45, 0.3, 0.99);

  const quick = roundPrice(market * (1 - downside));
  const fair = roundPrice(market);
  const patient = roundPrice(market * (1 + upside));

  return {
    quick,
    fair,
    patient,
    // Ensure the ladder never inverts after rounding on very cheap items.
    prices: normaliseLadder(quick, fair, patient),
    averageSold: Math.round(base),
    medianSold: Math.round(median(comps)),
    compCount: comps.length,
    variance,
    confidence,
    retainedValue: item.msrp ? market / item.msrp : null,
    adjustments: {
      condition: { factor: cond, label: getCondition(condition).label },
      seasonality: { factor: season, month },
      demand: { factor: demand, index: item.demand ?? 0.5 },
      accessories: { factor: accessory, completeness: complete },
    },
  };
}

/** Guards the quick <= fair <= patient ordering, which rounding can otherwise invert. */
function normaliseLadder(quick, fair, patient) {
  const q = Math.min(quick, fair);
  const p = Math.max(patient, fair);
  return { quick: q, fair, patient: p };
}

/** Human-readable explanation of the biggest forces moving this item's price. */
export function explainPrice(pricing) {
  const notes = [];
  const { condition, seasonality, demand, accessories } = pricing.adjustments;

  if (condition.factor > 1.05) {
    notes.push(`${condition.label} condition adds ${pct(condition.factor)} over a typical used example.`);
  } else if (condition.factor < 0.95) {
    notes.push(`${condition.label} condition costs you ${pct(condition.factor)} against a typical used example.`);
  }

  if (seasonality.factor >= 1.05) {
    notes.push(`Seasonal demand is running ${pct(seasonality.factor)} above average right now.`);
  } else if (seasonality.factor <= 0.95) {
    notes.push(`This category is ${pct(seasonality.factor)} out of season — holding could pay off.`);
  }

  if (demand.index >= 0.75) {
    notes.push('Search demand for this item is strong, so it should move quickly.');
  } else if (demand.index <= 0.4) {
    notes.push('Demand is soft, so expect a longer time to sell.');
  }

  if (accessories.completeness < 1) {
    notes.push(
      `Missing accessories reduce the price by ${pct(accessories.factor)} — including everything is the easiest win.`,
    );
  }

  if (pricing.variance > 0.2) {
    notes.push('Recent sold prices vary widely, so treat the range as a guide rather than a guarantee.');
  }

  return notes;
}

function pct(factor) {
  return `${Math.round(Math.abs(1 - factor) * 100)}%`;
}
