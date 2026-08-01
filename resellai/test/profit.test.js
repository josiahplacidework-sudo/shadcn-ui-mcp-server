import test from 'node:test';
import assert from 'node:assert/strict';

import { getItem } from '../src/data/catalog.js';
import { eligibility, getMarketplace, MARKETPLACES } from '../src/engine/marketplaces.js';
import { calculateProfit, expectedDays, rankMarketplaces, sellOrDonate } from '../src/engine/profit.js';
import { estimateShipping } from '../src/engine/shipping.js';
import { priceItem } from '../src/engine/pricing.js';

test('eBay fee matches its published 13.25% plus $0.40', () => {
  const profit = calculateProfit(getItem('airpods-pro-2'), getMarketplace('ebay'), 200, { raw: true });
  assert.equal(profit.fee, 26.9); // 200 × 0.1325 = 26.50, plus the $0.40 order fee
});

test('Poshmark charges a flat fee below $15 and 20% above it', () => {
  const item = getItem('lululemon-define');
  assert.equal(calculateProfit(item, getMarketplace('poshmark'), 10, { raw: true }).fee, 2.95);
  assert.equal(calculateProfit(item, getMarketplace('poshmark'), 100, { raw: true }).fee, 20);
});

test('local marketplaces take no fee and no shipping', () => {
  const profit = calculateProfit(getItem('westelm-desk'), getMarketplace('facebook'), 300);
  assert.equal(profit.fee, 0);
  assert.equal(profit.shippingCost, 0);
  assert.equal(profit.packaging, 0);
  // With nothing deducted, the seller keeps whatever the item realises.
  assert.equal(profit.net, profit.price);
});

test('a local buyer pays less than the national online price for a shippable item', () => {
  const item = getItem('ps5-disc');
  const local = calculateProfit(item, getMarketplace('facebook'), 400);
  const online = calculateProfit(item, getMarketplace('ebay'), 400);

  assert.ok(local.price < online.price, 'local realization should discount the asking price');
  assert.equal(local.askPrice, 400);
  assert.ok(local.realization < 1);
});

test('local-only items are not double-penalised for selling locally', () => {
  // A Peloton has only ever had local comps, so Facebook should not discount it the way it
  // discounts a shippable item that also has a national online market.
  const local = calculateProfit(getItem('peloton-bike'), getMarketplace('facebook'), 450);
  const shippable = calculateProfit(getItem('ps5-disc'), getMarketplace('facebook'), 450);

  assert.ok(local.realization > 0.95);
  assert.ok(local.realization > shippable.realization);
});

test('poor category fit lowers the price a platform can realise', () => {
  const facebook = getMarketplace('facebook');
  // Facebook is the best place for furniture and one of the worst for trading cards.
  const furniture = calculateProfit(getItem('westelm-desk'), facebook, 300);
  const sneakers = calculateProfit(getItem('nike-dunk-panda'), facebook, 300);

  assert.ok(furniture.realization > sneakers.realization);
});

test('zero fees do not automatically win — realization is applied first', () => {
  // Apparel should route to Poshmark despite its 20% fee, because apparel buyers are there
  // and they pay shipping.
  const ranked = rankMarketplaces(getItem('lululemon-define'), 70, { condition: 'excellent' });
  assert.equal(ranked[0].marketplace.id, 'poshmark');
});

test('seller-paid shipping is deducted but buyer-paid shipping is not', () => {
  const item = getItem('lululemon-define');
  const ebay = calculateProfit(item, getMarketplace('ebay'), 80);
  const posh = calculateProfit(item, getMarketplace('poshmark'), 80);

  assert.ok(ebay.shippingCost > 0);
  assert.equal(posh.shippingCost, 0);
  // Packaging is still a real cost on buyer-paid platforms.
  assert.ok(posh.packaging > 0);
});

test('net equals price minus every deduction', () => {
  const profit = calculateProfit(getItem('canon-r50'), getMarketplace('mercari'), 500, { taxRate: 0.1 });
  const expected = profit.price - profit.fee - profit.shippingCost - profit.packaging - profit.tax;
  assert.ok(Math.abs(profit.net - expected) < 0.01);
  assert.ok(profit.tax > 0);
});

test('freight-sized items are ineligible for shipped marketplaces', () => {
  const peloton = getItem('peloton-bike');
  assert.equal(eligibility(getMarketplace('ebay'), peloton).eligible, false);
  assert.equal(eligibility(getMarketplace('facebook'), peloton).eligible, true);
});

test('StockX only accepts sneakers in near-deadstock condition', () => {
  const stockx = getMarketplace('stockx');
  assert.equal(eligibility(stockx, getItem('nike-dunk-panda'), 'new').eligible, true);
  assert.equal(eligibility(stockx, getItem('nike-dunk-panda'), 'good').eligible, false);
  assert.equal(eligibility(stockx, getItem('ps5-disc'), 'new').eligible, false);
});

test('ranking returns only eligible marketplaces, best first', () => {
  const item = getItem('ps5-disc');
  const ranked = rankMarketplaces(item, 350);

  assert.ok(ranked.length > 0);
  assert.ok(ranked.length <= MARKETPLACES.length);
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, 'ranking is not sorted by score');
  }
  assert.equal(ranked[0].rank, 1);
});

test('a profit priority ranks the highest net first', () => {
  const item = getItem('airpods-pro-2');
  const ranked = rankMarketplaces(item, 160, { priority: 'profit' });
  const bestNet = Math.max(...ranked.map((r) => r.profit.net));
  assert.equal(ranked[0].profit.net, bestNet);
});

test('a speed priority ranks the fastest marketplace first', () => {
  const item = getItem('westelm-desk');
  const ranked = rankMarketplaces(item, 280, { priority: 'speed' });
  const fastest = Math.min(...ranked.map((r) => r.days));
  assert.equal(ranked[0].days, fastest);
});

test('furniture is steered to local marketplaces', () => {
  const ranked = rankMarketplaces(getItem('westelm-desk'), 280);
  assert.ok(['facebook', 'offerup', 'craigslist'].includes(ranked[0].marketplace.id));
});

test('sneakers in deadstock condition surface an authenticated platform', () => {
  const ranked = rankMarketplaces(getItem('jordan-1-chicago'), 330, { condition: 'new' });
  assert.ok(ranked.some((r) => ['stockx', 'goat'].includes(r.marketplace.id)));
});

test('every ranked entry explains itself', () => {
  const ranked = rankMarketplaces(getItem('nike-dunk-panda'), 130);
  for (const entry of ranked) {
    assert.ok(entry.why.includes(entry.marketplace.name));
    assert.ok(entry.why.length > 30);
  }
});

test('a patient asking price takes longer to sell than a quick one', () => {
  const item = getItem('nike-dunk-panda');
  const marketplace = getMarketplace('ebay');
  assert.ok(expectedDays(marketplace, item, 'patient') > expectedDays(marketplace, item, 'quick'));
});

test('low-value items are recommended for donation, not listing', () => {
  const item = getItem('paperback-lot');
  const pricing = priceItem(item, { condition: 'good' });
  const ranked = rankMarketplaces(item, pricing.prices.fair, { condition: 'good' });
  const advice = sellOrDonate(item, ranked[0]);

  assert.ok(['donate', 'bundle'].includes(advice.verdict));
});

test('valuable items are recommended for sale', () => {
  const item = getItem('canon-r50');
  const pricing = priceItem(item, { condition: 'excellent' });
  const ranked = rankMarketplaces(item, pricing.prices.fair, { condition: 'excellent' });

  assert.equal(sellOrDonate(item, ranked[0]).verdict, 'sell');
});

test('sellOrDonate handles having no eligible marketplace', () => {
  assert.equal(sellOrDonate(getItem('paperback-lot'), undefined).verdict, 'donate');
});

test('books ship by Media Mail, and freight items do not ship at all', () => {
  assert.match(estimateShipping(getItem('paperback-lot')).carrier.name, /Media Mail/);

  const peloton = estimateShipping(getItem('peloton-bike'));
  assert.equal(peloton.shippable, false);
  assert.equal(peloton.total, 0);
});

test('a book lot over the USPS Media Mail weight limit ships by another carrier', () => {
  const books = getItem('paperback-lot');
  assert.match(estimateShipping({ ...books, weightLb: 70 }).carrier.name, /Media Mail/);

  // USPS refuses Media Mail over 70 lb, so quoting its rate here would price a service the
  // seller could not actually buy.
  const overweight = estimateShipping({ ...books, weightLb: 71 });
  assert.doesNotMatch(overweight.carrier.name, /Media Mail/);
  assert.ok(overweight.shippable);
});

test('shipping cost rises with weight', () => {
  const light = estimateShipping(getItem('airpods-pro-2'));
  const heavy = estimateShipping(getItem('kitchenaid-artisan'));
  assert.ok(heavy.cost > light.cost);
});
