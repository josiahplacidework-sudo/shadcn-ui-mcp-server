/**
 * Recognition engine (simulated).
 *
 * The production app sends photos to a vision model that returns brand, model, attributes, and
 * a condition estimate. This prototype has no model behind it, so identification is derived
 * deterministically from the input — the same photo always resolves to the same item, which
 * keeps demos and tests reproducible. Every result carries `simulated: true` so the UI can be
 * honest about where the answer came from.
 */

import { CATALOG, categoryOf, getItem } from '../data/catalog.js';
import { CONDITIONS } from './condition.js';

/** FNV-1a. Small, dependency-free, and stable across Node and browsers. */
export function hashString(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function pseudoRandom(seed, salt) {
  return (hashString(`${seed}:${salt}`) % 10000) / 10000;
}

const CONDITION_POOL = ['like-new', 'excellent', 'very-good', 'very-good', 'good', 'fair'];

/**
 * Identify an item from a photo descriptor.
 *
 * @param {object} input
 * @param {string} input.seed        Stable identifier — filename + size, or a sample id.
 * @param {string} [input.itemId]    Force a specific catalog item (used by the sample gallery).
 * @param {number} [input.photoCount]
 * @returns {object} recognition result
 */
export function analysePhoto(input) {
  const { seed = String(Date.now()), itemId, photoCount = 1 } = input ?? {};

  const item = itemId ? getItem(itemId) : CATALOG[hashString(seed) % CATALOG.length];
  if (!item) throw new Error(`Unknown item: ${itemId}`);

  const conditionId = CONDITION_POOL[Math.floor(pseudoRandom(seed, 'cond') * CONDITION_POOL.length)];
  const condition = CONDITIONS.find((c) => c.id === conditionId);

  // More photos genuinely improve a vision model's confidence, with diminishing returns.
  const photoBonus = Math.min(0.12, (photoCount - 1) * 0.045);
  const confidence = clamp(0.74 + pseudoRandom(seed, 'conf') * 0.21 + photoBonus, 0.5, 0.985);

  // Accessories are only visible if they were photographed.
  const detectedAccessories = (item.accessories ?? []).filter(
    (_, index) => pseudoRandom(seed, `acc${index}`) > 0.35,
  );

  return {
    simulated: true,
    item,
    category: categoryOf(item),
    condition: condition.id,
    conditionLabel: condition.label,
    conditionBlurb: condition.blurb,
    conditionConfidence: clamp(confidence - 0.06 + pseudoRandom(seed, 'cc') * 0.08, 0.45, 0.97),
    confidence,
    detectedAccessories,
    attributes: item.attributes ?? {},
    alternates: alternates(item, seed),
    photoSuggestions: photoSuggestions(item, photoCount),
    seed,
  };
}

/** Runner-up guesses, so the user can correct a misidentification. */
function alternates(item, seed) {
  return CATALOG.filter((c) => c.category === item.category && c.id !== item.id)
    .slice(0, 3)
    .map((c, index) => ({
      item: c,
      confidence: clamp(0.35 - index * 0.08 + pseudoRandom(seed, `alt${index}`) * 0.12, 0.05, 0.45),
    }));
}

const ANGLE_HINTS = {
  sneakers: ['Photograph the soles — buyers judge wear there first.', 'Show the size tag inside the tongue.', 'Include the original box label.'],
  gaming: ['Show the serial number on the underside.', 'Photograph every included cable and controller.', 'Capture the console powered on to prove it boots.'],
  electronics: ['Show the model number on the label.', 'Include the charger and cable in one shot.', 'Photograph the battery health screen if there is one.'],
  camera: ['Show the shutter count screen.', 'Photograph the sensor with the lens off.', 'Include every lens cap, strap, and battery.'],
  apparel: ['Lay it flat and photograph the measurements with a tape.', 'Show the care and size label.', 'Capture any pilling, stains, or repairs honestly.'],
  luxury: ['Photograph the serial or date code.', 'Show the interior lining and hardware close up.', 'Include the dust bag and any authenticity cards.'],
  cards: ['Shoot all four corners under raking light.', 'Photograph the back for centring and edge wear.', 'Include a shot inside the sleeve and top loader.'],
  furniture: ['Take one wide shot of the whole piece in the room.', 'Photograph every scratch and ring mark.', 'Measure and show the dimensions.'],
  appliance: ['Show it plugged in and running.', 'Photograph the interior and any removable parts.', 'Capture the model plate.'],
  instrument: ['Photograph the headstock and serial.', 'Show the fretboard and any buckle rash.', 'Include the case and all hardware.'],
  tools: ['Show the battery and charger together.', 'Photograph the chuck and any wear on the housing.', 'Capture the model number.'],
  sporting: ['Photograph the drivetrain and tyre tread.', 'Show the frame size sticker.', 'Capture any scratches on the frame.'],
  fitness: ['Show the display powered on.', 'Photograph the pedals and seat post.', 'Capture the whole unit against a clear background.'],
  books: ['Fan the spines so every title is legible.', 'Show any water damage or writing.', 'Photograph the stack on a scale for the weight.'],
  toys: ['Photograph the instruction booklet.', 'Show every minifigure or accessory laid out.', 'Capture the box condition on all sides.'],
};

export function photoSuggestions(item, photoCount = 1) {
  const hints = ANGLE_HINTS[item.category] ?? ['Add a clean, well-lit photo against a plain background.'];
  // No hints once there are enough photos — otherwise "Improve your photos" never goes away.
  const wanted = Math.max(0, 4 - photoCount);
  return hints.slice(0, wanted);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
