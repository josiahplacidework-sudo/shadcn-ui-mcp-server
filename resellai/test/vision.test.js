import test from 'node:test';
import assert from 'node:assert/strict';

import { getItem } from '../src/data/catalog.js';
import { priceItem } from '../src/engine/pricing.js';
import { estimateShipping } from '../src/engine/shipping.js';
import {
  RETAKE_GUIDANCE,
  UnusablePhotoError,
  parseVisionResult,
  recognizeWithVision,
} from '../src/engine/vision.js';

/** A model result for something in the catalog. */
function matchedResult(overrides = {}) {
  return {
    usable: true,
    retakeReasons: [],
    name: 'Dunk Low "Panda"',
    brand: 'Nike',
    model: 'DD1391-100',
    category: 'sneakers',
    conditionGuess: 'excellent',
    confidence: 0.9,
    detectedAccessories: ['Original box'],
    matchedItemId: 'nike-dunk-panda',
    valueLow: 0,
    valueFair: 0,
    valueHigh: 0,
    valueBasis: 'catalog-match',
    weightLb: 3.2,
    localOnly: false,
    notes: 'Clean pair, box included.',
    ...overrides,
  };
}

/** A model result for something the catalog has never heard of — the common case. */
function estimatedResult(overrides = {}) {
  return {
    usable: true,
    retakeReasons: [],
    name: '5200 Blender',
    brand: 'Vitamix',
    model: '5200',
    category: 'appliance',
    conditionGuess: 'good',
    confidence: 0.86,
    detectedAccessories: ['Tamper'],
    matchedItemId: '',
    valueLow: 180,
    valueFair: 240,
    valueHigh: 300,
    valueBasis: 'model-estimate',
    weightLb: 11,
    localOnly: false,
    notes: 'Classic motor base, container shows clouding.',
    ...overrides,
  };
}

test('a catalog match prices against real sold history, not the model estimate', () => {
  const result = parseVisionResult(matchedResult(), { seed: 'photo-1', photoCount: 2 });

  assert.equal(result.item.id, 'nike-dunk-panda');
  assert.equal(result.estimated, false);
  assert.equal(result.valueBasis, 'catalog-match');
  assert.deepEqual(result.item.comps, getItem('nike-dunk-panda').comps);
});

test('an item outside the catalog is still identified by name rather than forced into one', () => {
  const result = parseVisionResult(estimatedResult());

  // The old behaviour picked the nearest catalog entry, so a Vitamix became an Instant Pot.
  assert.equal(result.item.id.startsWith('estimated:'), true);
  assert.match(result.item.name, /Vitamix/);
  assert.match(result.identifiedAs, /Vitamix/);
  assert.equal(result.item.category, 'appliance');
});

test('an estimated item is flagged as an estimate everywhere downstream reads it', () => {
  const result = parseVisionResult(estimatedResult());

  // Three separate consumers check this: the result banner, the price card, and the row that
  // gets written into inventory. Losing the flag on any of them silently upgrades a guess into
  // a sold-price claim.
  assert.equal(result.estimated, true);
  assert.equal(result.valueBasis, 'model-estimate');
  assert.equal(result.item.estimated, true);
});

test('the estimated value range drives a real price ladder', () => {
  const result = parseVisionResult(estimatedResult());
  const pricing = priceItem(result.item, { condition: result.condition });

  assert.ok(pricing.prices.quick > 0);
  assert.ok(pricing.prices.quick <= pricing.prices.fair);
  assert.ok(pricing.prices.fair <= pricing.prices.patient);
  // Anchored on the model's fair estimate, after the condition adjustment.
  assert.ok(pricing.prices.fair > 100 && pricing.prices.fair < 400);
});

test('a wider estimate produces a wider band, not a falsely confident one', () => {
  const tight = priceItem(
    parseVisionResult(estimatedResult({ valueLow: 235, valueFair: 240, valueHigh: 245 })).item,
  );
  const wide = priceItem(
    parseVisionResult(estimatedResult({ valueLow: 80, valueFair: 240, valueHigh: 600 })).item,
  );

  const tightSpread = tight.prices.patient - tight.prices.quick;
  const wideSpread = wide.prices.patient - wide.prices.quick;
  assert.ok(wideSpread > tightSpread, 'an uncertain estimate must not read as a precise one');
  assert.ok(wide.confidence < tight.confidence);
});

test('an item the model cannot value at all is marked unpriced rather than priced at zero', () => {
  const result = parseVisionResult(
    estimatedResult({ valueLow: 0, valueFair: 0, valueHigh: 0, valueBasis: 'unknown' }),
  );

  assert.equal(result.priced, false);
  assert.equal(result.valueBasis, 'unknown');
  assert.deepEqual(result.item.comps, []);
});

test('an estimated weight still yields a shippable profile', () => {
  const result = parseVisionResult(estimatedResult());
  const shipping = estimateShipping(result.item);

  assert.equal(result.item.box, 'medium');
  assert.equal(shipping.shippable, true);
  assert.ok(shipping.cost > 0);
});

test('a bulky item the model flags as local-only is not quoted for shipping', () => {
  const result = parseVisionResult(
    estimatedResult({ name: 'Sectional Sofa', category: 'furniture', weightLb: 180, localOnly: true }),
  );

  assert.equal(result.item.localOnly, true);
  assert.equal(estimateShipping(result.item).shippable, false);
});

test('an unusable photo throws with specific, actionable retake guidance', () => {
  const raw = { usable: false, retakeReasons: ['too_dark', 'item_too_small'] };

  assert.throws(
    () => parseVisionResult(raw),
    (error) => {
      assert.ok(error instanceof UnusablePhotoError);
      assert.deepEqual(error.reasons, ['too_dark', 'item_too_small']);
      assert.equal(error.guidance.length, 2);
      assert.match(error.guidance[0], /brighter/i);
      assert.match(error.guidance[1], /closer/i);
      return true;
    },
  );
});

test('an unusable photo with no stated reason still gets usable advice', () => {
  assert.throws(
    () => parseVisionResult({ usable: false, retakeReasons: [] }),
    (error) => {
      assert.ok(error instanceof UnusablePhotoError);
      assert.ok(error.guidance.length >= 1);
      assert.ok(error.guidance.every((line) => line.length > 10));
      return true;
    },
  );
});

test('every retake reason has guidance phrased as an action the user can take', () => {
  for (const [reason, advice] of Object.entries(RETAKE_GUIDANCE)) {
    assert.ok(advice.length > 10, `${reason} needs real guidance`);
    // Guidance the user cannot act on standing where they are is not guidance.
    assert.match(advice, /^[A-Z]/, `${reason} should read as an instruction`);
  }
});

test('an unrecognised retake reason is dropped rather than rendered as undefined', () => {
  assert.throws(
    () => parseVisionResult({ usable: false, retakeReasons: ['made_up_reason'] }),
    (error) => {
      assert.ok(error.guidance.every((line) => typeof line === 'string' && line.length > 0));
      return true;
    },
  );
});

test('confidence is clamped into range whatever the model returns', () => {
  assert.ok(parseVisionResult(matchedResult({ confidence: 5 })).confidence <= 0.99);
  assert.ok(parseVisionResult(matchedResult({ confidence: -1 })).confidence >= 0.3);
  const nan = parseVisionResult(matchedResult({ confidence: 'high' })).confidence;
  assert.ok(nan >= 0.3 && nan <= 0.99);
});

test('a catalog match only reports accessories that item actually has', () => {
  const item = getItem('nike-dunk-panda');
  const result = parseVisionResult(
    matchedResult({ detectedAccessories: ['original box', 'a receipt', 'extra laces'] }),
  );

  assert.ok(result.detectedAccessories.every((a) => item.accessories.includes(a)));
  assert.ok(result.detectedAccessories.includes('Original box'));
});

test('blank accessory strings do not match everything', () => {
  const result = parseVisionResult(matchedResult({ detectedAccessories: ['', '   ', 'Original box'] }));
  assert.deepEqual(result.detectedAccessories, ['Original box']);
});

test('an estimated item offers no catalog alternates, since it matched nothing', () => {
  assert.deepEqual(parseVisionResult(estimatedResult()).alternates, []);

  const matched = parseVisionResult(matchedResult());
  assert.ok(matched.alternates.length > 0);
  assert.ok(matched.alternates.every((alt) => alt.item.id !== matched.item.id));
});

test('the same item recognised twice resolves to the same id', () => {
  const a = parseVisionResult(estimatedResult());
  const b = parseVisionResult(estimatedResult());
  assert.equal(a.item.id, b.item.id);
});

test('parseVisionResult rejects a non-object result', () => {
  assert.throws(() => parseVisionResult(null));
  assert.throws(() => parseVisionResult('nope'));
});

test('recognizeWithVision refuses to run without config, session, or photos', async () => {
  await assert.rejects(
    recognizeWithVision({ accessToken: 't', photos: ['data:image/png;base64,abc'] }),
    /not configured/,
  );
  await assert.rejects(
    recognizeWithVision({ functionUrl: 'https://x/recognize', photos: ['data:image/png;base64,abc'] }),
    /Sign in/,
  );
  await assert.rejects(
    recognizeWithVision({ functionUrl: 'https://x/recognize', accessToken: 't' }),
    /photo/,
  );
});

test('recognizeWithVision authenticates with the session token and never sends an API key', async (t) => {
  const originalFetch = globalThis.fetch;
  let captured;

  globalThis.fetch = async (url, init) => {
    captured = { url, headers: init.headers, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ result: matchedResult(), scansRemaining: 24 }) };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await recognizeWithVision({
    functionUrl: 'https://project.supabase.co/functions/v1/recognize',
    accessToken: 'user-session-jwt',
    photos: ['data:image/jpeg;base64,Zm9v'],
    seed: 'upload-1',
  });

  assert.equal(captured.headers.authorization, 'Bearer user-session-jwt');
  // The whole point of the server-side move: no key can appear in a browser request.
  assert.equal(JSON.stringify(captured).includes('x-api-key'), false);
  assert.equal(JSON.stringify(captured).includes('sk-ant'), false);
  assert.deepEqual(captured.body.photos, ['data:image/jpeg;base64,Zm9v']);
  assert.equal(result.item.id, 'nike-dunk-panda');
  assert.equal(result.seed, 'upload-1');
});

test('recognizeWithVision surfaces the server error message rather than a status code', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: 'You have used all 25 scans for today. They reset at midnight UTC.' }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    recognizeWithVision({
      functionUrl: 'https://x/recognize',
      accessToken: 't',
      photos: ['data:image/jpeg;base64,Zm9v'],
    }),
    /all 25 scans/,
  );
});

test('recognizeWithVision propagates a retake request as an UnusablePhotoError', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ result: { usable: false, retakeReasons: ['too_blurry'] } }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    recognizeWithVision({
      functionUrl: 'https://x/recognize',
      accessToken: 't',
      photos: ['data:image/jpeg;base64,Zm9v'],
    }),
    (error) => {
      assert.ok(error instanceof UnusablePhotoError);
      assert.match(error.guidance[0], /focus/i);
      return true;
    },
  );
});
