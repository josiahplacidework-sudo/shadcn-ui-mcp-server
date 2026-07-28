/**
 * AI listing generator.
 *
 * Produces the title, description, bullets, keywords, hashtags, and item specifics for a
 * listing. In production the copy comes from an LLM prompted with the recognition result and
 * the comps; here it is assembled from templates so output is deterministic and reviewable.
 */

import { categoryOf } from '../data/catalog.js';
import { getCondition } from './condition.js';
import { estimateShipping } from './shipping.js';

export const TONES = [
  { id: 'professional', label: 'Professional', hint: 'Clear, factual, trust-building.' },
  { id: 'friendly', label: 'Friendly', hint: 'Warm and conversational.' },
  { id: 'minimal', label: 'Minimal', hint: 'Facts only, no filler.' },
  { id: 'collector', label: 'Collector-focused', hint: 'Detail-obsessed, speaks to enthusiasts.' },
  { id: 'luxury', label: 'Luxury', hint: 'Elevated and understated.' },
];

const EBAY_TITLE_LIMIT = 80;

/**
 * @param {object} params
 * @param {object} params.item
 * @param {string} params.condition
 * @param {number} params.price
 * @param {string[]} [params.includedAccessories]
 * @param {string} [params.tone]
 * @param {object} [params.marketplace]
 * @returns {object} the generated listing
 */
export function generateListing(params) {
  const {
    item,
    condition = 'very-good',
    price,
    includedAccessories = item.accessories ?? [],
    tone = 'professional',
    marketplace,
  } = params;

  const cond = getCondition(condition);
  const shipping = estimateShipping(item);

  return {
    title: buildTitle(item, cond, includedAccessories),
    description: buildDescription({ item, cond, includedAccessories, tone, shipping, marketplace, price }),
    bullets: buildBullets(item, cond, includedAccessories, shipping),
    keywords: buildKeywords(item, cond),
    hashtags: buildHashtags(item),
    specifics: buildSpecifics(item, cond, shipping),
    conditionSummary: conditionSummary(item, cond),
    shipping,
    tone,
  };
}

/** eBay-style keyword-front title, trimmed to the 80-character limit. */
export function buildTitle(item, cond, includedAccessories = []) {
  const attrs = item.attributes ?? {};
  const segments = [item.name];

  if (attrs.size) segments.push(`Size ${attrs.size}`);
  else if (attrs.capacity) segments.push(attrs.capacity);
  if (attrs.colour) segments.push(attrs.colour);
  segments.push(cond.label);

  const hasBox = includedAccessories.some((a) => /box/i.test(a));
  if (hasBox) segments.push('with Box');

  let title = segments.join(' ');
  if (title.length > EBAY_TITLE_LIMIT) {
    // Drop optional segments from the end until it fits, never the item name.
    for (let drop = segments.length - 1; drop > 0 && title.length > EBAY_TITLE_LIMIT; drop -= 1) {
      title = segments.slice(0, drop).join(' ');
    }
  }
  return title.slice(0, EBAY_TITLE_LIMIT).trim();
}

const OPENERS = {
  professional: (item, cond) =>
    `${item.name} in ${cond.label.toLowerCase()} condition, accurately described and ready to ship.`,
  friendly: (item, cond) =>
    `Selling my ${item.name} — it's in ${cond.label.toLowerCase()} shape and deserves a new home.`,
  minimal: (item, cond) => `${item.name}. ${cond.label}.`,
  collector: (item, cond) =>
    `${item.name}${item.releaseYear ? ` (${item.releaseYear})` : ''}, graded honestly as ${cond.label.toLowerCase()} by someone who knows what collectors look for.`,
  luxury: (item, cond) =>
    `An authentic ${item.name}, presented in ${cond.label.toLowerCase()} condition.`,
};

const CLOSERS = {
  professional: 'Questions are welcome. Ships within one business day of payment.',
  friendly: 'Happy to answer anything or send more photos — just ask!',
  minimal: 'Ships next business day.',
  collector: 'Packed to collector standards. More detail photos available on request.',
  luxury: 'Carefully packaged and dispatched with tracking.',
};

/** Assembles the description: opener, condition, details, contents, shipping, and closer. */
function buildDescription({ item, cond, includedAccessories, tone, shipping, marketplace, price }) {
  const opener = (OPENERS[tone] ?? OPENERS.professional)(item, cond);
  const lines = [opener, ''];

  lines.push('CONDITION');
  lines.push(conditionSummary(item, cond));
  lines.push('');

  const attrs = item.attributes ?? {};
  if (Object.keys(attrs).length) {
    lines.push('DETAILS');
    for (const [key, value] of Object.entries(attrs)) {
      lines.push(`• ${titleCase(key)}: ${value}`);
    }
    lines.push('');
  }

  lines.push('WHAT’S INCLUDED');
  if (includedAccessories.length) {
    for (const accessory of includedAccessories) lines.push(`• ${accessory}`);
  } else {
    lines.push('• Item only, exactly as pictured');
  }
  const missing = (item.accessories ?? []).filter((a) => !includedAccessories.includes(a));
  if (missing.length) {
    lines.push(`• Not included: ${missing.join(', ')}`);
  }
  lines.push('');

  lines.push('SHIPPING');
  if (!shipping.shippable) {
    lines.push('Local pickup only — this item is too large to ship economically.');
  } else if (marketplace?.shipping === 'none') {
    // Shippable, but the chosen marketplace is pickup-only — promising tracked delivery here
    // would contradict both the marketplace and the recommendation copy.
    lines.push('Local pickup only — cash or instant transfer on collection.');
  } else if (marketplace?.shipping === 'buyer') {
    lines.push(`Ships in a ${shipping.boxLabel.toLowerCase()} via ${shipping.carrier.name}. Buyer pays shipping.`);
  } else {
    lines.push(
      `Ships free in a ${shipping.boxLabel.toLowerCase()} via ${shipping.carrier.name}, packed with padding and fully tracked.`,
    );
  }

  if (price) {
    lines.push('');
    lines.push(`Priced at $${price} based on recent completed sales.`);
  }

  lines.push('');
  lines.push(CLOSERS[tone] ?? CLOSERS.professional);

  return lines.join('\n');
}

/** The condition blurb plus the reassurance buyers in this category look for. */
function conditionSummary(item, cond) {
  const base = cond.blurb;
  const extra = {
    sneakers: 'Soles, uppers, and insoles are all shown in the photos.',
    cards: 'Corners, edges, and centring are pictured under direct light.',
    apparel: 'No holes, stains, or odours unless explicitly pictured.',
    electronics: 'Fully tested and factory reset before shipping.',
    gaming: 'Tested, working, and reset to factory settings.',
    luxury: 'Authenticity guaranteed; serial and hardware are pictured.',
  }[item.category];

  return extra ? `${base} ${extra}` : base;
}

/** Scannable highlights for marketplaces that render a bullet list above the description. */
function buildBullets(item, cond, includedAccessories, shipping) {
  const bullets = [
    `${cond.label} condition — ${cond.blurb.replace(/\.$/, '')}`,
    `Authentic ${item.brand}${item.releaseYear ? `, released ${item.releaseYear}` : ''}`,
  ];

  const attrs = item.attributes ?? {};
  for (const [key, value] of Object.entries(attrs).slice(0, 3)) {
    bullets.push(`${titleCase(key)}: ${value}`);
  }

  if (includedAccessories.length) {
    bullets.push(`Includes ${listSentence(includedAccessories)}`);
  }
  bullets.push(
    shipping.shippable
      ? `Ships fast and tracked via ${shipping.carrier.name}`
      : 'Local pickup, help loading available',
  );

  return bullets;
}

/** Search terms drawn from the brand, name, tags, and attributes, de-duplicated. */
function buildKeywords(item, cond) {
  const attrs = item.attributes ?? {};
  const words = new Set([
    item.brand.toLowerCase(),
    ...item.name.toLowerCase().split(/[\s"()]+/).filter((w) => w.length > 2),
    ...(item.tags ?? []),
    cond.label.toLowerCase(),
    'used',
    'authentic',
  ]);
  if (attrs.colour) words.add(attrs.colour.toLowerCase());
  if (attrs.size) words.add(`size ${String(attrs.size).toLowerCase()}`);
  return [...words].slice(0, 18);
}

/** Lower-cased tags for the social-style marketplaces that use them. */
function buildHashtags(item) {
  const source = [item.brand, ...(item.tags ?? []), item.category];
  const tags = source
    .map((word) => `#${String(word).toLowerCase().replace(/[^a-z0-9]/g, '')}`)
    .filter((tag) => tag.length > 3);
  return [...new Set(tags)].slice(0, 8);
}

/** The structured attribute table marketplaces use to filter search results. */
function buildSpecifics(item, cond, shipping) {
  const attributes = Object.fromEntries(
    Object.entries(item.attributes ?? {}).map(([key, value]) => [titleCase(key), value]),
  );

  return {
    Brand: item.brand,
    Condition: cond.label,
    Category: categoryOf(item).label,
    ...(item.releaseYear ? { Year: String(item.releaseYear) } : {}),
    ...attributes,
    'Shipping weight': shipping.shippable ? `${item.weightLb} lb` : 'Local pickup',
  };
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/([A-Z])/g, ' $1');
}

function listSentence(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
