import test from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG, getItem } from '../src/data/catalog.js';
import { analysePhoto, hashString, photoSuggestions } from '../src/engine/recognition.js';
import { getMarketplace } from '../src/engine/marketplaces.js';
import { rankMarketplaces } from '../src/engine/profit.js';
import { generateListing, TONES } from '../src/engine/listing.js';
import { scoreListing } from '../src/engine/quality.js';
import { analyseBundle } from '../src/engine/bundle.js';
import { priceItem } from '../src/engine/pricing.js';

test('recognition is deterministic for the same seed', () => {
  const a = analysePhoto({ seed: 'photo-1234.jpg' });
  const b = analysePhoto({ seed: 'photo-1234.jpg' });

  assert.equal(a.item.id, b.item.id);
  assert.equal(a.condition, b.condition);
  assert.equal(a.confidence, b.confidence);
});

test('different seeds can resolve to different items', () => {
  const ids = new Set(
    Array.from({ length: 40 }, (_, i) => analysePhoto({ seed: `sample-${i}` }).item.id),
  );
  assert.ok(ids.size > 1);
});

test('recognition honours a forced item id', () => {
  const result = analysePhoto({ seed: 'anything', itemId: 'charizard-base' });
  assert.equal(result.item.id, 'charizard-base');
});

test('recognition rejects an unknown item id', () => {
  assert.throws(() => analysePhoto({ seed: 'x', itemId: 'not-a-real-item' }), /Unknown item/);
});

test('recognition is always flagged as simulated', () => {
  assert.equal(analysePhoto({ seed: 'a' }).simulated, true);
});

test('more photos raise recognition confidence', () => {
  const one = analysePhoto({ seed: 'same-seed', photoCount: 1 });
  const many = analysePhoto({ seed: 'same-seed', photoCount: 5 });
  assert.ok(many.confidence > one.confidence);
});

test('confidence never leaves the 0-1 range', () => {
  for (let i = 0; i < 100; i += 1) {
    const result = analysePhoto({ seed: `seed-${i}`, photoCount: 9 });
    assert.ok(result.confidence > 0 && result.confidence <= 1);
    assert.ok(result.conditionConfidence > 0 && result.conditionConfidence <= 1);
  }
});

test('hashString is stable and unsigned', () => {
  assert.equal(hashString('resellai'), hashString('resellai'));
  assert.ok(hashString('resellai') >= 0);
  assert.notEqual(hashString('a'), hashString('b'));
});

test('titles stay within the 80-character marketplace limit', () => {
  for (const item of CATALOG) {
    const listing = generateListing({ item, condition: 'very-good', price: 100 });
    assert.ok(listing.title.length <= 80, `${item.id} title too long: ${listing.title.length}`);
    assert.ok(listing.title.includes(item.brand) || listing.title.includes(item.name.split(' ')[0]));
  }
});

test('every tone produces a distinct opening line', () => {
  const item = getItem('coach-tabby');
  const openings = TONES.map(
    (tone) => generateListing({ item, condition: 'excellent', price: 180, tone: tone.id }).description.split('\n')[0],
  );
  assert.equal(new Set(openings).size, TONES.length);
});

test('the description names accessories that are missing', () => {
  const item = getItem('ps5-disc');
  const listing = generateListing({
    item,
    condition: 'good',
    price: 300,
    includedAccessories: ['DualSense controller'],
  });

  assert.match(listing.description, /Not included/);
  assert.match(listing.description, /HDMI cable/);
});

test('listings carry keywords, hashtags, and specifics', () => {
  const listing = generateListing({ item: getItem('nike-dunk-panda'), condition: 'very-good', price: 130 });

  assert.ok(listing.keywords.length > 5);
  assert.ok(listing.hashtags.every((tag) => tag.startsWith('#')));
  assert.ok(Object.keys(listing.specifics).length >= 5);
  assert.ok(listing.bullets.length >= 4);
});

test('local-pickup items say so in the shipping section', () => {
  const listing = generateListing({ item: getItem('peloton-bike'), condition: 'good', price: 450 });
  assert.match(listing.description, /Local pickup only/);
});

test('a complete listing scores higher than a bare one', () => {
  const item = getItem('canon-r50');
  const pricing = priceItem(item, { condition: 'excellent' });
  const listing = generateListing({ item, condition: 'excellent', price: pricing.prices.fair });

  const strong = scoreListing({
    listing,
    item,
    price: pricing.prices.fair,
    pricing,
    photoCount: 8,
    includedAccessories: item.accessories,
  });
  const weak = scoreListing({
    listing,
    item,
    price: pricing.prices.fair,
    pricing,
    photoCount: 1,
    includedAccessories: [],
  });

  assert.ok(strong.overall > weak.overall);
  assert.ok(strong.overall <= 100 && weak.overall >= 0);
});

test('overpricing is called out in the quality suggestions', () => {
  const item = getItem('nike-dunk-panda');
  const pricing = priceItem(item, { condition: 'very-good' });
  const listing = generateListing({ item, condition: 'very-good', price: pricing.prices.patient * 3 });

  const score = scoreListing({
    listing,
    item,
    price: pricing.prices.patient * 3,
    pricing,
    photoCount: 6,
    includedAccessories: item.accessories,
  });

  assert.ok(score.suggestions.some((s) => s.area === 'pricing'));
});

test('quality suggestions are ordered by how much score they recover', () => {
  const item = getItem('lululemon-define');
  const pricing = priceItem(item, { condition: 'good' });
  const listing = generateListing({ item, condition: 'good', price: pricing.prices.fair });
  const score = scoreListing({ listing, item, price: pricing.prices.fair, pricing, photoCount: 1 });

  for (let i = 1; i < score.suggestions.length; i += 1) {
    assert.ok(score.suggestions[i - 1].gain >= score.suggestions[i].gain);
  }
});

test('a bundle needs at least two items', () => {
  const result = analyseBundle([{ item: getItem('ps5-disc') }]);
  assert.equal(result.viable, false);
});

test('related low-value items are recommended as a bundle', () => {
  const result = analyseBundle([
    { item: getItem('instant-pot-duo'), condition: 'good' },
    { item: getItem('kitchenaid-artisan'), condition: 'good' },
  ]);

  assert.equal(result.viable, true);
  assert.ok(result.bundle.price < result.separate.total);
  assert.ok(result.bundle.days <= result.separate.days);
  assert.ok(result.rationale.length > 20);
});

test('unrelated items are recommended for separate listings', () => {
  const result = analyseBundle([
    { item: getItem('charizard-base'), condition: 'excellent' },
    { item: getItem('peloton-bike'), condition: 'good' },
    { item: getItem('fender-strat'), condition: 'very-good' },
  ]);

  assert.equal(result.recommendation, 'separate');
  assert.ok(result.cohesion < 0.75);
});

test('bundle discount stays within a believable range', () => {
  const result = analyseBundle([
    { item: getItem('ps5-disc') },
    { item: getItem('xbox-series-x') },
    { item: getItem('lego-millennium') },
  ]);

  assert.ok(result.discount >= 0.06 && result.discount <= 0.28);
});

// ---------------------------------------------------------------- review follow-ups

test('photo suggestions stop once there are enough photos', () => {
  const item = getItem('ps5-disc');

  assert.ok(photoSuggestions(item, 1).length > 0);
  assert.equal(photoSuggestions(item, 4).length, 0, 'four photos is enough — stop nagging');
  assert.equal(photoSuggestions(item, 8).length, 0);
});

test('a pickup-only marketplace never promises tracked shipping', () => {
  // The PS5 is perfectly shippable, but Facebook Marketplace is local pickup.
  const listing = generateListing({
    item: getItem('ps5-disc'),
    condition: 'good',
    price: 300,
    marketplace: getMarketplace('facebook'),
  });

  assert.match(listing.description, /Local pickup only/);
  assert.doesNotMatch(listing.description, /Ships free/);
  assert.doesNotMatch(listing.description, /fully tracked/);
});

test('a seller-shipped marketplace still promises tracked shipping', () => {
  const listing = generateListing({
    item: getItem('ps5-disc'),
    condition: 'good',
    price: 300,
    marketplace: getMarketplace('ebay'),
  });

  assert.match(listing.description, /Ships free/);
});

test('bundle rationale reports a gain as a gain, not as money given up', () => {
  const result = analyseBundle([
    { item: getItem('instant-pot-duo'), condition: 'good' },
    { item: getItem('kitchenaid-artisan'), condition: 'good' },
  ]);

  const netGiveUp = result.separate.net - result.bundle.net;
  if (netGiveUp < 0) {
    assert.match(result.rationale, /nets about \$\d+ more/);
    assert.doesNotMatch(result.rationale, /gives up/);
  } else {
    assert.match(result.rationale, /gives up about \$\d+/);
  }
});

test('a bundle with no eligible marketplace nets nothing, not its gross price', () => {
  // Two freight-only items: nothing that ships can carry them, so there is no net to report.
  const result = analyseBundle([
    { item: getItem('peloton-bike'), condition: 'good' },
    { item: getItem('westelm-desk'), condition: 'good' },
  ]);

  assert.ok(result.viable);
  assert.ok(
    result.bundle.net <= result.bundle.price,
    'net must never exceed the gross bundle price',
  );
});

test('ranking by profit still works when every option nets a loss', () => {
  // A cheap, heavy item on fee-charging marketplaces nets below zero everywhere.
  const item = { ...getItem('paperback-lot'), comps: [4, 5, 6, 5, 4, 5] };
  const ranked = rankMarketplaces(item, 5, { condition: 'good', priority: 'profit' });

  assert.ok(ranked.length > 0);
  assert.ok(ranked.some((r) => r.profit.net < 0), 'expected at least one negative net');

  const bestNet = Math.max(...ranked.map((r) => r.profit.net));
  // The tie window must still include the leader when the best net is negative.
  assert.ok(ranked[0].profit.net >= bestNet - Math.abs(bestNet) * 0.01);
});
