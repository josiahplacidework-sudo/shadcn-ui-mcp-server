/**
 * Real item recognition.
 *
 * The model is asked to name what is actually in the photo, not to pick the nearest entry from
 * a fixed catalog. That is the whole point — a resale app that tells you your blender is a
 * stand mixer because a stand mixer is the closest thing it knows about is worse than one that
 * admits it is guessing.
 *
 * Two consequences follow, and both are handled here rather than pushed onto the UI:
 *
 * 1. **Most items have no sold comps.** The catalog holds nineteen items; the world does not.
 *    When the model recognises something outside it, `syntheticItem()` builds an item the
 *    pricing engine can consume out of the model's own value estimate, tagged `estimated` so
 *    every downstream surface can say where the number came from. A model estimate and a real
 *    sold-price history are not the same kind of fact and the app never presents them as one.
 *
 * 2. **Some photos cannot be identified at all.** Rather than returning a confident guess from
 *    a dark or blurry frame, the model returns `usable: false` with reasons, and this module
 *    turns those into specific instructions a person can act on. `RETAKE_GUIDANCE` lives here,
 *    not in the prompt, so the wording is ours and stays consistent.
 *
 * The API key is not in this file and never reaches the browser. Requests go to the `recognize`
 * Supabase edge function, which holds the key, checks the caller's session, and enforces the
 * daily scan cap. See supabase/functions/recognize/index.ts.
 */

import { CATALOG, CATEGORIES, categoryOf, getItem } from '../data/catalog.js';
import { CONDITIONS, getCondition } from './condition.js';
import { hashString, photoSuggestions } from './recognition.js';

const DEFAULT_TIMEOUT_MS = 45000;

/**
 * What to tell the user for each reason the model rejected a photo.
 *
 * Phrased as an action, not a diagnosis: "Move somewhere brighter" is something a person can do
 * standing where they are, whereas "insufficient illumination" is a description of their
 * failure. Ordered by how often the fix actually works.
 */
export const RETAKE_GUIDANCE = {
  too_dark: 'Move somewhere brighter, or turn on a light. Avoid shooting against a window.',
  too_blurry: 'Hold still and tap the screen to focus before capturing.',
  item_too_small: 'Get closer so the item fills most of the frame.',
  item_obstructed: 'Move whatever is covering the item, and shoot the front face.',
  too_many_items: 'Photograph one item at a time against a plain background.',
  bad_angle: 'Shoot straight on at the side with the label, logo, or model number.',
  glare: 'Turn off the flash and angle away from direct light to kill the reflection.',
  unrecognizable: 'Try a different angle, and include any label or model number.',
};

const FALLBACK_GUIDANCE = 'Try again with a clearer, closer photo in good light.';

/** A recognition attempt that produced no identification, only instructions for a better photo. */
export class UnusablePhotoError extends Error {
  constructor(reasons = []) {
    const list = reasons.length ? reasons : ['unrecognizable'];
    super('The photo was not clear enough to identify the item');
    this.name = 'UnusablePhotoError';
    this.reasons = list;
    this.guidance = list.map((r) => RETAKE_GUIDANCE[r]).filter(Boolean);
    if (!this.guidance.length) this.guidance = [FALLBACK_GUIDANCE];
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Nearest shipping box profile for an estimated weight, mirroring the catalog's own bands. */
function boxForWeight(weightLb) {
  if (!Number.isFinite(weightLb) || weightLb <= 0) return 'medium';
  if (weightLb <= 1) return 'poly';
  if (weightLb <= 4) return 'small';
  if (weightLb <= 12) return 'medium';
  if (weightLb <= 40) return 'large';
  return 'freight';
}

/**
 * Builds comps from the model's low/fair/high estimate.
 *
 * The pricing engine's whole design reads a *spread* of recent sold prices — it derives the
 * ladder and its confidence from how much those prices disagree. Handing it a single number
 * would produce an artificially tight band and a confidence score that claims more certainty
 * than an estimate deserves, so the three points are expanded into a small spread whose width
 * is the model's own low-to-high range. Wide estimate in, wide band out.
 */
function compsFromEstimate(low, fair, high) {
  const mid = fair > 0 ? fair : (low + high) / 2;
  if (!(mid > 0)) return [];
  const lo = low > 0 ? low : mid * 0.8;
  const hi = high > 0 ? high : mid * 1.25;
  return [lo, (lo + mid) / 2, mid, mid, (mid + hi) / 2, hi].map((n) => Math.round(n));
}

/**
 * An item the pricing engine can price, assembled from the model's description.
 *
 * `estimated: true` is the load-bearing field. Everything downstream keys off it to label the
 * number as an estimate rather than sold history, so it must survive into inventory and out
 * the other side — an item that loses this flag becomes indistinguishable from a real comp.
 */
function syntheticItem(raw) {
  const comps = compsFromEstimate(raw.valueLow, raw.valueFair, raw.valueHigh);
  const category = CATEGORIES[raw.category] ? raw.category : 'other';
  const name = [raw.brand, raw.name].filter(Boolean).join(' ').trim() || raw.name || 'Unidentified item';
  const weightLb = Number.isFinite(raw.weightLb) && raw.weightLb > 0 ? raw.weightLb : 2;

  return {
    id: `estimated:${hashString(`${name}${category}`)}`,
    name,
    brand: raw.brand || '',
    category,
    msrp: null,
    comps,
    // Mid-range: the model has no search-volume data, and pretending otherwise would move the
    // price on a signal that does not exist.
    demand: 0.5,
    weightLb,
    box: boxForWeight(weightLb),
    localOnly: Boolean(raw.localOnly),
    accessories: Array.isArray(raw.detectedAccessories) ? raw.detectedAccessories.slice(0, 6) : [],
    attributes: raw.model ? { Model: raw.model } : {},
    authenticatable: false,
    tags: [raw.brand, raw.model, category].filter(Boolean).map((t) => String(t).toLowerCase()),
    estimated: true,
    priced: comps.length > 0,
  };
}

/** Which of a catalog item's known accessories the model's free-text list actually names. */
function matchAccessories(item, spotted) {
  const known = item.accessories ?? [];
  const list = Array.isArray(spotted)
    ? spotted.filter((s) => typeof s === 'string' && s.trim().length > 0)
    : [];
  if (!known.length || !list.length) return [];
  return known.filter((accessory) => {
    const a = accessory.toLowerCase();
    return list.some((name) => {
      const b = name.toLowerCase();
      return a.includes(b) || b.includes(a);
    });
  });
}

/** Catalog entries in the same category, offered as "not right? it might be" alternatives. */
function alternatesFor(item) {
  if (item.estimated) return [];
  return CATALOG.filter((c) => c.category === item.category && c.id !== item.id)
    .slice(0, 3)
    .map((c, index) => ({ item: c, confidence: clamp(0.3 - index * 0.07, 0.05, 0.4) }));
}

/**
 * Turns the model's structured output into the shape the rest of the app consumes.
 *
 * @throws {UnusablePhotoError} when the model judged the photo too poor to identify anything.
 */
export function parseVisionResult(raw, { seed, photoCount = 1 } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Malformed recognition result');

  if (raw.usable === false) {
    throw new UnusablePhotoError(
      Array.isArray(raw.retakeReasons) ? raw.retakeReasons.filter((r) => RETAKE_GUIDANCE[r]) : [],
    );
  }

  // A catalog match beats the model's own estimate: real sold prices outrank a guess, even a
  // well-informed one.
  const matched = raw.matchedItemId ? getItem(raw.matchedItemId) : null;
  const item = matched ?? syntheticItem(raw);
  const condition = getCondition(raw.conditionGuess);
  const confidence = clamp(Number.isFinite(raw.confidence) ? raw.confidence : 0.7, 0.3, 0.99);

  return {
    simulated: false,
    source: 'vision',
    item,
    category: categoryOf(item),
    condition: condition.id,
    conditionLabel: condition.label,
    conditionBlurb: condition.blurb,
    conditionConfidence: confidence,
    confidence,
    detectedAccessories: matched
      ? matchAccessories(matched, raw.detectedAccessories)
      : (item.accessories ?? []),
    attributes: item.attributes ?? {},
    alternates: alternatesFor(item),
    photoSuggestions: photoSuggestions(item, photoCount),
    seed,
    identifiedAs: [raw.brand, raw.name].filter(Boolean).join(' ').trim() || item.name,
    modelNotes: typeof raw.notes === 'string' ? raw.notes : '',
    // How the price was arrived at, carried through so the UI never has to guess.
    valueBasis: matched ? 'catalog-match' : (raw.valueBasis ?? 'model-estimate'),
    estimated: !matched,
    priced: matched ? true : Boolean(item.priced),
  };
}

/**
 * Recognise an item via the server-side `recognize` function.
 *
 * @param {object} options
 * @param {string} options.functionUrl   The edge function endpoint.
 * @param {string} options.accessToken   The signed-in user's Supabase session JWT.
 * @param {string[]} options.photos      Data URLs of the photos to analyse.
 * @returns {Promise<object>} a recognition result shaped like `analysePhoto()`'s.
 * @throws {UnusablePhotoError} when the photo needs retaking.
 */
export async function recognizeWithVision({
  functionUrl,
  accessToken,
  photos,
  seed,
  photoCount = photos?.length ?? 1,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!functionUrl) throw new Error('Recognition is not configured');
  if (!accessToken) throw new Error('Sign in to scan an item');
  if (!photos?.length) throw new Error('No photo to analyse');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ photos: photos.slice(0, 4) }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error || `Recognition failed (${response.status})`);
    }

    return parseVisionResult(body.result, { seed, photoCount });
  } finally {
    clearTimeout(timer);
  }
}
