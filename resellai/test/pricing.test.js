import test from 'node:test';
import assert from 'node:assert/strict';

import { getItem } from '../src/data/catalog.js';
import {
  compVariance,
  completeness,
  priceItem,
  roundPrice,
  seasonalityFactor,
  trimmedMean,
} from '../src/engine/pricing.js';
import { conditionFactor } from '../src/engine/condition.js';

test('trimmedMean discards the single highest and lowest comp', () => {
  // 1 and 100 are dropped, leaving 10, 20, 30.
  assert.equal(trimmedMean([1, 10, 20, 30, 100]), 20);
});

test('trimmedMean keeps every value when there are fewer than five comps', () => {
  assert.equal(trimmedMean([10, 20, 30]), 20);
});

test('trimmedMean handles an empty comp set', () => {
  assert.equal(trimmedMean([]), 0);
});

test('compVariance is zero when every comp agrees', () => {
  assert.equal(compVariance([50, 50, 50]), 0);
});

test('compVariance grows as comps disagree', () => {
  assert.ok(compVariance([10, 100]) > compVariance([48, 52]));
});

test('condition factor is 1 at the Very Good baseline', () => {
  assert.equal(conditionFactor('very-good'), 1);
  assert.ok(conditionFactor('new') > 1);
  assert.ok(conditionFactor('poor') < 1);
});

test('better condition always prices higher', () => {
  const item = getItem('nike-dunk-panda');
  const poor = priceItem(item, { condition: 'poor', month: 0 });
  const good = priceItem(item, { condition: 'good', month: 0 });
  const brandNew = priceItem(item, { condition: 'new', month: 0 });

  assert.ok(poor.prices.fair < good.prices.fair);
  assert.ok(good.prices.fair < brandNew.prices.fair);
});

test('the price ladder never inverts', () => {
  for (const id of ['paperback-lot', 'instant-pot-duo', 'peloton-bike', 'charizard-base']) {
    for (const condition of ['new', 'very-good', 'poor']) {
      const { prices } = priceItem(getItem(id), { condition, month: 5 });
      assert.ok(
        prices.quick <= prices.fair && prices.fair <= prices.patient,
        `ladder inverted for ${id} / ${condition}: ${JSON.stringify(prices)}`,
      );
    }
  }
});

test('volatile comps produce a wider quick-to-patient band', () => {
  const steady = { ...getItem('nike-dunk-panda'), comps: [130, 131, 132, 133, 134, 135] };
  const volatile = { ...getItem('nike-dunk-panda'), comps: [60, 100, 132, 180, 240, 90] };

  const steadyPricing = priceItem(steady, { month: 0 });
  const volatilePricing = priceItem(volatile, { month: 0 });

  const spread = (p) => (p.prices.patient - p.prices.quick) / p.prices.fair;
  assert.ok(spread(volatilePricing) > spread(steadyPricing));
});

test('volatile comps lower the confidence score', () => {
  const steady = { ...getItem('ps5-disc'), comps: [350, 352, 351, 353, 349, 350] };
  const volatile = { ...getItem('ps5-disc'), comps: [180, 300, 350, 520, 240, 460] };

  assert.ok(priceItem(volatile).confidence < priceItem(steady).confidence);
});

test('missing accessories reduce the price', () => {
  const item = getItem('ps5-disc');
  const full = priceItem(item, { includedAccessories: item.accessories, month: 0 });
  const bare = priceItem(item, { includedAccessories: [], month: 0 });

  assert.ok(bare.prices.fair < full.prices.fair);
});

test('completeness is 1 for items that have no accessories', () => {
  assert.equal(completeness(getItem('lululemon-define'), undefined), 1);
});

test('seasonality moves fitness gear in January and bikes in May', () => {
  assert.ok(seasonalityFactor('fitness', 0) > seasonalityFactor('fitness', 6));
  assert.ok(seasonalityFactor('sporting', 4) > seasonalityFactor('sporting', 11));
});

test('unknown categories fall back to a flat seasonal curve', () => {
  assert.equal(seasonalityFactor('nonexistent', 3), 1);
});

test('pricing is deterministic for a fixed month', () => {
  const a = priceItem(getItem('coach-tabby'), { condition: 'excellent', month: 7 });
  const b = priceItem(getItem('coach-tabby'), { condition: 'excellent', month: 7 });
  assert.deepEqual(a.prices, b.prices);
});

test('roundPrice produces marketplace-friendly numbers', () => {
  assert.equal(roundPrice(12.4), 12);
  assert.equal(roundPrice(132.2), 130);
  assert.equal(roundPrice(1247), 1250);
  assert.equal(roundPrice(0), 0);
  assert.equal(roundPrice(-5), 0);
});
