/**
 * Marketplace catalogue and fee models.
 *
 * Fee rates reflect each platform's published seller terms. `fit` scores are the empirical
 * "where does this category actually sell" weighting the recommendation engine leans on.
 *
 * `realization` is the share of the fair market price a seller actually achieves on that
 * platform. Comps are national online sold prices, so eBay is the 1.0 reference. Local buyers
 * expect a discount for paying cash and collecting in person, which is why a zero-fee platform
 * is not automatically the most profitable one.
 */

const DEFAULT_FIT = 0.5;
const DEFAULT_REALIZATION = 0.95;

export const MARKETPLACES = [
  {
    id: 'ebay',
    name: 'eBay',
    /** 13.25% final value fee plus a fixed per-order charge. */
    fee: (price) => price * 0.1325 + 0.4,
    feeLabel: '13.25% + $0.40',
    /** Comps are largely eBay sold data, so this is the reference price. */
    realization: 1.0,
    shipping: 'seller',
    reach: 0.98,
    speed: 0.62,
    effort: 0.55,
    payout: '2–3 days after delivery',
    fit: {
      electronics: 0.92, camera: 0.95, gaming: 0.88, cards: 0.85, tools: 0.86,
      instrument: 0.82, sneakers: 0.74, toys: 0.8, appliance: 0.7, apparel: 0.55,
      books: 0.6, luxury: 0.72, sporting: 0.62, fitness: 0.4, furniture: 0.25,
    },
  },
  {
    id: 'facebook',
    name: 'Facebook Marketplace',
    /** No fee on local pickup sales. */
    fee: () => 0,
    feeLabel: 'No fee (local)',
    /** Local buyers negotiate, and the audience is one metro area. */
    realization: 0.85,
    shipping: 'none',
    localOnly: true,
    reach: 0.9,
    speed: 0.9,
    effort: 0.2,
    payout: 'Cash at pickup',
    fit: {
      furniture: 0.96, fitness: 0.92, appliance: 0.86, sporting: 0.88, tools: 0.78,
      instrument: 0.72, gaming: 0.7, electronics: 0.66, toys: 0.68, books: 0.5,
      apparel: 0.42, sneakers: 0.5, camera: 0.55, luxury: 0.4, cards: 0.35,
    },
  },
  {
    id: 'mercari',
    name: 'Mercari',
    /** 10% selling fee plus 2.9% + $0.50 processing. */
    fee: (price) => price * 0.129 + 0.5,
    feeLabel: '10% + 2.9% + $0.50',
    /** Buyers arrive expecting a discount against eBay. */
    realization: 0.95,
    shipping: 'seller',
    reach: 0.72,
    speed: 0.7,
    effort: 0.28,
    payout: '2–5 days after delivery',
    fit: {
      cards: 0.9, toys: 0.86, apparel: 0.78, electronics: 0.74, gaming: 0.76,
      books: 0.72, sneakers: 0.7, luxury: 0.62, tools: 0.6, camera: 0.62,
      appliance: 0.55, instrument: 0.5, sporting: 0.52, fitness: 0.3, furniture: 0.2,
    },
  },
  {
    id: 'poshmark',
    name: 'Poshmark',
    /** Flat $2.95 under $15, otherwise 20%. */
    fee: (price) => (price < 15 ? 2.95 : price * 0.2),
    feeLabel: '20% (flat $2.95 under $15)',
    /** Buyers pay shipping and expect boutique pricing, so ask prices hold. */
    realization: 1.05,
    shipping: 'buyer',
    reach: 0.66,
    speed: 0.6,
    effort: 0.35,
    payout: '3 days after delivery',
    categories: ['apparel', 'luxury', 'sneakers'],
    fit: { apparel: 0.94, luxury: 0.9, sneakers: 0.72 },
  },
  {
    id: 'offerup',
    name: 'OfferUp',
    fee: () => 0,
    feeLabel: 'No fee (local)',
    /** Heavier haggling than Facebook and a smaller audience. */
    realization: 0.82,
    shipping: 'none',
    localOnly: true,
    reach: 0.6,
    speed: 0.78,
    effort: 0.2,
    payout: 'Cash at pickup',
    fit: {
      furniture: 0.84, fitness: 0.8, sporting: 0.78, tools: 0.76, appliance: 0.74,
      gaming: 0.62, electronics: 0.6, instrument: 0.6, toys: 0.56, camera: 0.5,
      apparel: 0.34, sneakers: 0.44, books: 0.4, luxury: 0.3, cards: 0.3,
    },
  },
  {
    id: 'craigslist',
    name: 'Craigslist',
    fee: () => 0,
    feeLabel: 'No fee',
    /** Smallest audience and the most aggressive negotiation. */
    realization: 0.78,
    shipping: 'none',
    localOnly: true,
    reach: 0.42,
    speed: 0.55,
    effort: 0.3,
    payout: 'Cash at pickup',
    fit: {
      furniture: 0.78, fitness: 0.74, tools: 0.72, appliance: 0.66, sporting: 0.64,
      instrument: 0.62, electronics: 0.44, gaming: 0.4, camera: 0.4, apparel: 0.2,
      sneakers: 0.22, books: 0.3, toys: 0.34, luxury: 0.2, cards: 0.2,
    },
  },
  {
    id: 'stockx',
    name: 'StockX',
    /** ~9% transaction fee plus 3% payment processing. */
    fee: (price) => price * 0.12,
    feeLabel: '9% + 3% processing',
    /** An efficient bid/ask market clears close to true value. */
    realization: 0.98,
    shipping: 'seller',
    reach: 0.8,
    speed: 0.95,
    effort: 0.1,
    payout: '2–5 days after authentication',
    categories: ['sneakers'],
    /** Authenticated resale only accepts deadstock-grade product. */
    minCondition: ['new', 'like-new'],
    fit: { sneakers: 0.97 },
  },
  {
    id: 'goat',
    name: 'GOAT',
    /** 9.5% commission plus 2.9% processing and a $5 seller fee. */
    fee: (price) => price * 0.124 + 5,
    feeLabel: '9.5% + 2.9% + $5',
    /** Similar to StockX with slightly thinner bidding. */
    realization: 0.97,
    shipping: 'seller',
    reach: 0.74,
    speed: 0.88,
    effort: 0.12,
    payout: '3 days after authentication',
    categories: ['sneakers'],
    minCondition: ['new', 'like-new', 'excellent'],
    fit: { sneakers: 0.93 },
  },
];

export function getMarketplace(id) {
  return MARKETPLACES.find((m) => m.id === id);
}

export function fitScore(marketplace, category) {
  return marketplace.fit?.[category] ?? DEFAULT_FIT;
}

/**
 * The share of the fair market price this platform actually achieves for this item.
 *
 * Two forces combine. The platform's own baseline captures how hard its buyers negotiate, and
 * category fit captures audience depth: a specific sneaker in a specific size has a handful of
 * local buyers but thousands nationally, so listing it locally costs real money on top of the
 * usual haggling.
 *
 * Items that can only ever sell locally — furniture, exercise equipment — already have local
 * comps, so a local platform realises the full price rather than a discount against a national
 * online price that was never available to them.
 */
export function realizationFor(marketplace, item) {
  let base = marketplace.realization ?? DEFAULT_REALIZATION;

  if (item.localOnly && marketplace.localOnly) {
    // Craigslist and OfferUp still trail Facebook's reach, so keep their relative order.
    base = Math.min(1, base / 0.85);
  }

  // A thin audience for the category drags the achievable price down by up to 25%.
  const fitAdjustment = 0.75 + 0.25 * fitScore(marketplace, item.category);
  return Math.min(1.08, base * fitAdjustment);
}

/**
 * Whether an item can actually be listed on a marketplace.
 * @returns {{eligible:boolean, reason?:string}}
 */
export function eligibility(marketplace, item, condition = 'very-good') {
  if (marketplace.categories && !marketplace.categories.includes(item.category)) {
    return { eligible: false, reason: `${marketplace.name} only accepts ${marketplace.categories.join(', ')}.` };
  }
  if (marketplace.minCondition && !marketplace.minCondition.includes(condition)) {
    return { eligible: false, reason: `${marketplace.name} requires near-deadstock condition.` };
  }
  const mustShip = marketplace.shipping === 'seller' || marketplace.shipping === 'buyer';
  if (mustShip && (item.localOnly || item.box === 'freight')) {
    return { eligible: false, reason: 'Too large to ship economically.' };
  }
  if (marketplace.localOnly && item.category === 'cards') {
    return { eligible: false, reason: 'Small collectibles rarely sell locally.' };
  }
  return { eligible: true };
}

/** Every marketplace that will actually accept this item in this condition. */
export function eligibleMarketplaces(item, condition = 'very-good') {
  return MARKETPLACES.filter((m) => eligibility(m, item, condition).eligible);
}
