/**
 * Shipping assistant.
 *
 * Estimates postage and packaging from the item's box profile and weight, and recommends a
 * carrier. Rates approximate published US retail pricing for USPS Ground Advantage, UPS Ground,
 * and FedEx Home Delivery; a production build would call the carriers' rate APIs with a real
 * origin and destination.
 */

import { BOX } from '../data/catalog.js';

const RATE_CARD = {
  [BOX.poly]: { base: 5.5, perLb: 0.45, packaging: 0.75, label: 'Padded mailer' },
  [BOX.small]: { base: 7.9, perLb: 0.6, packaging: 1.25, label: 'Small box' },
  [BOX.medium]: { base: 11.5, perLb: 0.75, packaging: 2.5, label: 'Medium box' },
  [BOX.large]: { base: 16.0, perLb: 0.95, packaging: 4.0, label: 'Large box' },
  [BOX.oversize]: { base: 28.0, perLb: 1.2, packaging: 7.0, label: 'Oversize box' },
  [BOX.freight]: { base: 0, perLb: 0, packaging: 0, label: 'Local pickup' },
};

const CARRIERS = {
  media: { name: 'USPS Media Mail', note: 'Books and printed media qualify for the cheapest rate.' },
  ground: { name: 'USPS Ground Advantage', note: 'Best value under about 5 lb, 2–5 day delivery.' },
  ups: { name: 'UPS Ground via Pirate Ship', note: 'Discounted commercial rates with no monthly fee.' },
  fedex: { name: 'FedEx Home Delivery', note: 'Cheapest option once a package passes about 20 lb.' },
  local: { name: 'Local pickup', note: 'Too large to ship economically — sell locally.' },
};

/** Media Mail is dramatically cheaper, so books get their own rate. */
function mediaMailRate(weightLb) {
  return 4.13 + Math.max(0, Math.ceil(weightLb) - 1) * 0.68;
}

/** Cheapest sensible carrier for the item's weight and category. */
function pickCarrier(item) {
  if (item.box === BOX.freight || item.localOnly) return CARRIERS.local;
  if (item.category === 'books') return CARRIERS.media;
  if (item.weightLb >= 20) return CARRIERS.fedex;
  if (item.weightLb >= 5) return CARRIERS.ups;
  return CARRIERS.ground;
}

/**
 * @returns {{cost:number, packaging:number, total:number, carrier:object, boxLabel:string,
 *            weightLb:number, shippable:boolean}}
 */
export function estimateShipping(item) {
  const card = RATE_CARD[item.box] ?? RATE_CARD[BOX.medium];
  const carrier = pickCarrier(item);
  const shippable = !(item.localOnly || item.box === BOX.freight);

  let cost = 0;
  if (shippable) {
    cost =
      carrier === CARRIERS.media
        ? mediaMailRate(item.weightLb)
        : card.base + card.perLb * item.weightLb;
  }

  const packaging = shippable ? card.packaging : 0;

  return {
    cost: round2(cost),
    packaging: round2(packaging),
    total: round2(cost + packaging),
    carrier,
    boxLabel: card.label,
    weightLb: item.weightLb,
    shippable,
  };
}

/** Packing guidance shown alongside the estimate. */
export function packingTips(item) {
  const tips = [];
  const shipping = estimateShipping(item);

  if (!shipping.shippable) {
    tips.push('Too heavy or bulky to ship profitably — list locally for pickup.');
    tips.push('Meet in a public place during daylight, and take cash or an instant transfer.');
    return tips;
  }

  tips.push(`Use a ${shipping.boxLabel.toLowerCase()} — roughly ${item.weightLb} lb packed.`);

  if (item.category === 'sneakers') {
    tips.push('Ship the shoe box inside a shipping box; a damaged box costs you money on resale.');
  }
  if (item.category === 'cards') {
    tips.push('Sleeve, top-load, then team-bag the card before it goes in a rigid mailer.');
  }
  if (item.category === 'electronics' || item.category === 'gaming') {
    tips.push('Double-box with at least two inches of padding, and remove any personal accounts first.');
  }
  if (item.category === 'apparel') {
    tips.push('Fold, bag in clear poly, then mail — clean and pressed photographs and arrives better.');
  }
  if (item.weightLb >= 15) {
    tips.push('Weigh on a bathroom scale before buying the label; guessing low is the most common loss.');
  }

  tips.push(`${shipping.carrier.name}: ${shipping.carrier.note}`);
  return tips;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
