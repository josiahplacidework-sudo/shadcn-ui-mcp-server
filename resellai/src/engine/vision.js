/**
 * Real vision-model recognition (optional, bring-your-own key).
 *
 * `recognition.js` is the always-on default: deterministic, offline, and honest about being
 * simulated. This module is the opt-in alternative — it sends the user's own photo to the
 * Claude API and asks it to actually identify the item, using a JSON-schema-constrained
 * response so the result slots into the same shape `analysePhoto()` produces.
 *
 * Two things shape how this is wired up rather than using the official `@anthropic-ai/sdk`:
 * the app has no build step that can resolve an npm dependency (`scripts/build.mjs` only
 * inlines relative imports between local modules), and it has no backend, so the only place
 * a request can originate from is the user's own browser with their own key. Raw `fetch` against
 * the Messages API, with the direct-browser-access header the API requires for that, is the only
 * path available in this architecture — see `app/app.js` for where the key lives (session
 * storage only, never persisted to disk or synced) and the fallback to the simulator on failure.
 *
 * Because this prototype's pricing data is tied to a fixed catalog of sold comps, the model is
 * asked to match the photo to the closest catalog entry when it can. An unmatched item still
 * gets priced — just against the nearest category's comps rather than its own.
 */

import { CATALOG, CATEGORIES, categoryOf, getItem } from '../data/catalog.js';
import { CONDITIONS, getCondition } from './condition.js';
import { hashString, photoSuggestions } from './recognition.js';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';
const DEFAULT_TIMEOUT_MS = 25000;

export const RECOGNITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'category',
    'brand',
    'model',
    'conditionGuess',
    'confidence',
    'matchedItemId',
    'detectedAccessories',
    'notes',
  ],
  properties: {
    category: { type: 'string', enum: Object.keys(CATEGORIES) },
    brand: { type: 'string' },
    model: { type: 'string' },
    conditionGuess: { type: 'string', enum: CONDITIONS.map((c) => c.id) },
    confidence: { type: 'number' },
    matchedItemId: {
      anyOf: [{ type: 'string', enum: CATALOG.map((c) => c.id) }, { type: 'null' }],
    },
    detectedAccessories: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

function catalogHint() {
  return CATALOG.map((c) => `${c.id} — ${c.brand} ${c.name} (${c.category})`).join('\n');
}

function systemPrompt() {
  return `You are an item-identification assistant for a resale app. Given one or more photos of \
a secondhand item, identify what it is.

This app only has pricing data (recent sold comps) for the catalog entries below. If the photo \
closely matches one of them, set matchedItemId to that id so the app can price it against real \
history. If nothing matches closely, set matchedItemId to null and describe the item as \
accurately as you can instead — the app will fall back to a similar catalog item for pricing.

Catalog:
${catalogHint()}`;
}

const USER_PROMPT =
  'Identify the item in the attached photo(s). Note its condition and any accessories or ' +
  'original packaging visible in the photos.';

/** Splits a `data:image/jpeg;base64,AAAA` URL into an API image content block. */
function toImageBlock(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl ?? '');
  if (!match) throw new Error('Photo is not a base64 image data URL');
  return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Every catalog entry sharing this item's category, best guesses first. */
function alternatesFor(item) {
  return CATALOG.filter((c) => c.category === item.category && c.id !== item.id)
    .slice(0, 3)
    .map((c, index) => ({ item: c, confidence: clamp(0.3 - index * 0.07, 0.05, 0.4) }));
}

/** Which of the item's known accessories the model's free-text list actually names. */
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

/** Deterministic fallback pick within a category, so an unresolved item is still stable. */
function pickWithinCategory(category, seedText) {
  const pool = CATALOG.filter((c) => c.category === category);
  const from = pool.length ? pool : CATALOG;
  return from[hashString(seedText || 'unidentified-item') % from.length];
}

function resolveItem(raw) {
  if (raw.matchedItemId) {
    const item = getItem(raw.matchedItemId);
    if (item) return item;
  }
  const category = CATEGORIES[raw.category] ? raw.category : undefined;
  return pickWithinCategory(category, `${raw.brand ?? ''}${raw.model ?? ''}${raw.category ?? ''}`);
}

/**
 * Turns the model's structured JSON output into the same shape `analysePhoto()` returns, so the
 * rest of the app (pricing, listing, etc.) doesn't need to know which recognizer produced it.
 */
export function parseVisionResult(raw, { seed, photoCount = 1 } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Malformed recognition result');

  const item = resolveItem(raw);
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
    detectedAccessories: matchAccessories(item, raw.detectedAccessories),
    attributes: item.attributes ?? {},
    alternates: alternatesFor(item),
    photoSuggestions: photoSuggestions(item, photoCount),
    seed,
    identifiedAs: [raw.brand, raw.model].filter(Boolean).join(' ').trim() || item.name,
    modelNotes: typeof raw.notes === 'string' ? raw.notes : '',
  };
}

async function readErrorDetail(response) {
  try {
    const body = await response.json();
    return body?.error?.message ?? response.statusText;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

/**
 * @param {object} options
 * @param {string} options.apiKey           The user's own Anthropic API key.
 * @param {string[]} options.photos         Data URLs of the uploaded photos.
 * @param {string} [options.seed]
 * @param {number} [options.photoCount]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<object>} a recognition result shaped like `analysePhoto()`'s.
 */
export async function recognizeWithVision({
  apiKey,
  photos,
  seed,
  photoCount = photos?.length ?? 1,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!apiKey) throw new Error('No API key configured');
  if (!photos?.length) throw new Error('No photo to analyse');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

  try {
    const response = await fetch(MESSAGES_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        thinking: { type: 'disabled' },
        output_config: { effort: 'low', format: { type: 'json_schema', schema: RECOGNITION_SCHEMA } },
        system: systemPrompt(),
        messages: [
          {
            role: 'user',
            content: [...photos.slice(0, 4).map(toImageBlock), { type: 'text', text: USER_PROMPT }],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error ${response.status}: ${await readErrorDetail(response)}`);
    }

    const data = await response.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('The model declined to analyse this photo');
    }
    if (data.stop_reason === 'max_tokens') {
      throw new Error("The model's response was truncated — try again or increase max_tokens");
    }

    const textBlock = data.content?.find((block) => block.type === 'text');
    if (!textBlock) throw new Error('No structured response from the model');

    return parseVisionResult(JSON.parse(textBlock.text), { seed, photoCount });
  } finally {
    clearTimeout(timer);
  }
}
