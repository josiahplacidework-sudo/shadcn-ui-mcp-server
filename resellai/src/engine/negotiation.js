/**
 * AI negotiation assistant.
 *
 * Decides whether to accept, counter, or decline an offer, and drafts the reply.
 *
 * The whole judgement rests on a reservation price — the least the seller should accept right
 * now. That is not a fixed number: an item listed this morning should hold out for the fair
 * price, while one that has sat past its expected time to sell should be closer to taking the
 * quick-sale number. Time pressure is what moves it, and it is the thing sellers get wrong.
 */

import { calculateProfit, expectedDays } from './profit.js';
import { priceItem } from './pricing.js';

/**
 * Invert the fee model: what asking price nets the seller `targetNet`?
 *
 * Fee structures are not all linear — Poshmark has a step at $15 — so this bisects rather than
 * solving algebraically, which keeps it correct for any fee function.
 */
export function priceForNet(item, marketplace, targetNet, options = {}) {
  let low = 0;
  let high = Math.max(10, targetNet * 3 + 100);

  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (calculateProfit(item, marketplace, mid, options).net < targetNet) low = mid;
    else high = mid;
  }
  return Math.round((low + high) / 2);
}

/**
 * @param {object} input
 * @param {object} input.item
 * @param {object} input.marketplace
 * @param {number} input.askPrice        Current listed price.
 * @param {number} input.offer           What the buyer offered.
 * @param {string} [input.condition]
 * @param {number} [input.daysListed]    How long it has been listed.
 * @param {string} [input.tone]
 * @returns {object} verdict, counter price, reasoning, and a ready-to-send reply
 */
export function evaluateOffer(input) {
  const {
    item,
    marketplace,
    askPrice,
    offer,
    condition = 'very-good',
    daysListed = 0,
    tone = 'professional',
  } = input;

  const pricing = priceItem(item, { condition });

  // The floor is what the seller expects to *end up* with by holding out, so it carries the
  // platform's realization discount — a $430 local listing rarely settles at $430.
  const fairNet = calculateProfit(item, marketplace, pricing.prices.fair).net;
  const quickNet = calculateProfit(item, marketplace, pricing.prices.quick).net;

  // An offer is already a settled number. Discounting it again by the same realization factor
  // would penalise the buyer for negotiating twice, and would reject offers that beat what
  // holding out is worth.
  const offerNet = calculateProfit(item, marketplace, offer, { raw: true }).net;

  const typicalDays = expectedDays(marketplace, item, 'fair');
  const pressure = Math.max(0, daysListed / Math.max(1, typicalDays));

  const reservationNet = reservationFor({ fairNet, quickNet, pressure });
  // A counter is a concrete number too, so it is priced raw for the same reason.
  const counterPrice = Math.min(
    askPrice,
    Math.max(offer + 1, priceForNet(item, marketplace, reservationNet, { raw: true })),
  );

  const ratio = askPrice > 0 ? offer / askPrice : 0;
  let verdict = decide({ offerNet, reservationNet, ratio });

  // If the floor is still at or above the asking price there is nothing to concede, so this is
  // "hold firm", not a counter — telling a buyer "I can do $370" on a $370 listing reads as
  // either a mistake or an insult.
  if (verdict === 'counter' && counterPrice >= askPrice) verdict = 'hold';

  return {
    verdict,
    offer,
    offerNet: round2(offerNet),
    askPrice,
    counterPrice,
    counterNet: round2(calculateProfit(item, marketplace, counterPrice, { raw: true }).net),
    reservationNet: round2(reservationNet),
    fairNet: round2(fairNet),
    quickNet: round2(quickNet),
    daysListed,
    typicalDays,
    pressure,
    reasoning: reasoningFor({ verdict, offer, offerNet, reservationNet, counterPrice, daysListed, typicalDays, ratio }),
    reply: replyFor({ verdict, counterPrice, tone, item }),
  };
}

/**
 * The least the seller should take today.
 *
 * Starts at the fair-market net and slides toward the quick-sale net as the listing ages. Past
 * the expected time to sell it keeps sliding, because an item nobody wants at the quick price
 * is telling you something — but never below two thirds of the quick number, which is the point
 * where holding out beats selling for scraps.
 */
function reservationFor({ fairNet, quickNet, pressure }) {
  const band = fairNet - quickNet;

  if (pressure <= 1) return fairNet - band * pressure;

  const overdue = Math.min(1, pressure - 1);
  return Math.max(quickNet * 0.67, quickNet - band * overdue * 0.5);
}

function decide({ offerNet, reservationNet, ratio }) {
  if (offerNet >= reservationNet) return 'accept';
  // A lowball under 45% of the asking price is not a negotiation, it is a fishing expedition.
  if (ratio < 0.45) return 'decline';
  if (offerNet >= reservationNet * 0.75) return 'counter';
  return 'decline';
}

function reasoningFor({ verdict, offer, offerNet, reservationNet, counterPrice, daysListed, typicalDays, ratio }) {
  const age =
    daysListed === 0
      ? 'It was listed today'
      : `It has been listed ${daysListed} day${daysListed === 1 ? '' : 's'} against a typical ${typicalDays}`;

  if (verdict === 'accept') {
    return `${age}, and $${offer} nets you $${offerNet.toFixed(2)} — at or above the $${reservationNet.toFixed(2)} you should be holding out for. Take it.`;
  }

  if (verdict === 'counter') {
    const gap = (reservationNet - offerNet).toFixed(2);
    return `${age}. $${offer} nets $${offerNet.toFixed(2)}, which is $${gap} short of your $${reservationNet.toFixed(2)} floor. Counter at $${counterPrice} — close enough that most buyers take it.`;
  }

  if (verdict === 'hold') {
    return `${age}, so there is nothing to concede yet. After fees and shipping you would need the full asking price to clear your $${reservationNet.toFixed(2)} floor. Hold firm — if it is still here in a few weeks, the floor drops on its own.`;
  }

  if (ratio < 0.45) {
    return `${age}. At ${Math.round(ratio * 100)}% of your asking price this is a lowball, not an opening bid. Decline politely and wait — buyers who open this low rarely close near your number.`;
  }

  return `${age}. $${offer} nets only $${offerNet.toFixed(2)} against a $${reservationNet.toFixed(2)} floor. Decline — holding out costs you less than selling this low.`;
}

const REPLIES = {
  accept: {
    professional: () => 'That works for me. I will send the invoice now and ship within one business day.',
    friendly: () => 'Deal — that works! Sending the invoice over now, and it will go out tomorrow.',
    minimal: () => 'Accepted. Invoice sent.',
    collector: () => 'That is a fair number for a piece in this condition. Accepted — it will be packed to collector standards.',
    luxury: () => 'Agreed. I will send the invoice shortly; it will be dispatched with tracking.',
  },
  counter: {
    professional: (price) => `Thanks for the offer. I cannot do that number, but I can do $${price} — that is the lowest that still works for me after fees and shipping.`,
    friendly: (price) => `Appreciate the offer! I can't quite go that low, but $${price} works — let me know and it's yours.`,
    minimal: (price) => `$${price} is my best.`,
    collector: (price) => `I appreciate a serious offer. $${price} is where I need to be for an example in this condition — comparable pieces have been selling above that.`,
    luxury: (price) => `Thank you for your interest. I am able to accept $${price}, which reflects the piece's condition and completeness.`,
  },
  hold: {
    professional: () => 'Thanks for the offer. The price is firm for now — it is priced against recent completed sales, and it has not been listed long.',
    friendly: () => "Thanks for the offer! I'm going to hold at the listed price for now, but check back in a couple of weeks!",
    minimal: () => 'Price is firm.',
    collector: () => 'I appreciate the interest, but the price reflects recent comparable sales. Firm for now.',
    luxury: () => 'Thank you for your interest. The price is firm at present.',
  },
  decline: {
    professional: () => 'Thanks for the offer, but that is well below what these have been selling for. I will hold at the listed price for now.',
    friendly: () => "Thanks for reaching out! That's a bit too low for me though — I'll hang onto it for now. Feel free to check back!",
    minimal: () => 'Too low, thanks.',
    collector: () => 'I appreciate the interest, but recent sales are well above that. I will hold for the right buyer.',
    luxury: () => 'Thank you for the offer. It is below the current market for this piece, so I will hold at the listed price.',
  },
};

function replyFor({ verdict, counterPrice, tone }) {
  const set = REPLIES[verdict] ?? REPLIES.decline;
  return (set[tone] ?? set.professional)(counterPrice);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
