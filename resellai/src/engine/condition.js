/**
 * Condition model.
 *
 * `Very Good` is the baseline every comp set is normalised against, so its multiplier is the
 * denominator in `conditionFactor()`. Anything better than Very Good prices up, anything worse
 * prices down.
 */

export const CONDITIONS = [
  {
    id: 'new',
    label: 'New',
    multiplier: 1.0,
    blurb: 'Unused, sealed, or with original tags attached.',
  },
  {
    id: 'like-new',
    label: 'Like New',
    multiplier: 0.92,
    blurb: 'Opened but shows no signs of use. Indistinguishable from new in hand.',
  },
  {
    id: 'excellent',
    label: 'Excellent',
    multiplier: 0.85,
    blurb: 'Lightly used. Minor handling marks only, nothing visible at arm’s length.',
  },
  {
    id: 'very-good',
    label: 'Very Good',
    multiplier: 0.76,
    blurb: 'Normal light wear consistent with occasional use. Fully functional.',
  },
  {
    id: 'good',
    label: 'Good',
    multiplier: 0.66,
    blurb: 'Visible wear — scuffs, creasing, or fading — but structurally sound.',
  },
  {
    id: 'fair',
    label: 'Fair',
    multiplier: 0.5,
    blurb: 'Heavy wear or a cosmetic flaw a buyer will notice immediately.',
  },
  {
    id: 'poor',
    label: 'Poor',
    multiplier: 0.32,
    blurb: 'Damaged, incomplete, or sold for parts and repair.',
  },
];

export const BASELINE_CONDITION = 'very-good';

const BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));

export function getCondition(id) {
  return BY_ID.get(id) ?? BY_ID.get(BASELINE_CONDITION);
}

/** Price multiplier relative to the Very Good baseline the comps represent. */
export function conditionFactor(id) {
  return getCondition(id).multiplier / BY_ID.get(BASELINE_CONDITION).multiplier;
}

/** Ordered worst → best, useful for sliders. */
export const CONDITION_ORDER = [...CONDITIONS].reverse().map((c) => c.id);
