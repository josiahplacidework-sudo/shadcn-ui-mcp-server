import test from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG, CATEGORIES, getItem } from '../src/data/catalog.js';
import { CONDITIONS } from '../src/engine/condition.js';
import { RECOGNITION_SCHEMA, parseVisionResult, recognizeWithVision } from '../src/engine/vision.js';

function rawResult(overrides = {}) {
  return {
    category: 'sneakers',
    brand: 'Nike',
    model: 'Dunk Low Panda',
    conditionGuess: 'excellent',
    confidence: 0.9,
    matchedItemId: 'nike-dunk-panda',
    detectedAccessories: ['Original box'],
    notes: 'Clean pair, box included.',
    ...overrides,
  };
}

test('schema requires every property it declares, with no extras allowed', () => {
  assert.equal(RECOGNITION_SCHEMA.additionalProperties, false);
  const propertyNames = Object.keys(RECOGNITION_SCHEMA.properties);
  assert.deepEqual([...RECOGNITION_SCHEMA.required].sort(), [...propertyNames].sort());
});

test('schema enums stay in sync with the catalog and condition list', () => {
  assert.deepEqual(RECOGNITION_SCHEMA.properties.category.enum.sort(), Object.keys(CATEGORIES).sort());
  assert.deepEqual(
    RECOGNITION_SCHEMA.properties.conditionGuess.enum.sort(),
    CONDITIONS.map((c) => c.id).sort(),
  );
});

test('parseVisionResult matches a valid matchedItemId', () => {
  const result = parseVisionResult(rawResult(), { seed: 'photo-1', photoCount: 2 });
  assert.equal(result.item.id, 'nike-dunk-panda');
  assert.equal(result.simulated, false);
  assert.equal(result.source, 'vision');
  assert.equal(result.condition, 'excellent');
  assert.equal(result.identifiedAs, 'Nike Dunk Low Panda');
});

test('parseVisionResult falls back to the category when matchedItemId is unknown', () => {
  const result = parseVisionResult(rawResult({ matchedItemId: 'not-a-real-item' }));
  assert.equal(result.item.category, 'sneakers');
});

test('parseVisionResult falls back deterministically when nothing matches', () => {
  const a = parseVisionResult(rawResult({ matchedItemId: null, category: 'not-a-category', brand: 'X', model: 'Y' }));
  const b = parseVisionResult(rawResult({ matchedItemId: null, category: 'not-a-category', brand: 'X', model: 'Y' }));
  assert.equal(a.item.id, b.item.id);
  assert.ok(CATALOG.some((c) => c.id === a.item.id));
});

test('parseVisionResult clamps an out-of-range confidence', () => {
  const tooHigh = parseVisionResult(rawResult({ confidence: 5 }));
  const tooLow = parseVisionResult(rawResult({ confidence: -1 }));
  const notANumber = parseVisionResult(rawResult({ confidence: 'high' }));
  assert.ok(tooHigh.confidence <= 0.99);
  assert.ok(tooLow.confidence >= 0.3);
  assert.ok(notANumber.confidence >= 0.3 && notANumber.confidence <= 0.99);
});

test('parseVisionResult only reports accessories the item actually has', () => {
  const item = getItem('nike-dunk-panda');
  const result = parseVisionResult(
    rawResult({ detectedAccessories: ['original box', 'a receipt', 'extra laces'] }),
  );
  assert.ok(result.detectedAccessories.every((a) => item.accessories.includes(a)));
  assert.ok(result.detectedAccessories.includes('Original box'));
  assert.ok(result.detectedAccessories.includes('Extra laces'));
});

test('parseVisionResult never returns the matched item as one of its own alternates', () => {
  const result = parseVisionResult(rawResult());
  assert.ok(result.alternates.every((alt) => alt.item.id !== result.item.id));
  assert.ok(result.alternates.length <= 3);
  assert.ok(result.alternates.every((alt) => alt.item.category === result.item.category));
});

test('parseVisionResult rejects a non-object result', () => {
  assert.throws(() => parseVisionResult(null));
  assert.throws(() => parseVisionResult('nope'));
});

test('recognizeWithVision refuses to run without a key or without photos', async () => {
  await assert.rejects(recognizeWithVision({ photos: ['data:image/png;base64,abc'] }), /API key/);
  await assert.rejects(recognizeWithVision({ apiKey: 'sk-ant-test' }), /photo/);
});

test('recognizeWithVision sends a structured-output request and parses the reply', async (t) => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedBody;

  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(rawResult()) }],
      }),
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await recognizeWithVision({
    apiKey: 'sk-ant-test',
    photos: ['data:image/jpeg;base64,Zm9v'],
    seed: 'upload-1',
  });

  assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');
  assert.equal(capturedBody.model, 'claude-opus-5');
  assert.equal(capturedBody.output_config.format.type, 'json_schema');
  assert.equal(capturedBody.messages[0].content[0].source.data, 'Zm9v');
  assert.equal(result.item.id, 'nike-dunk-panda');
  assert.equal(result.seed, 'upload-1');
});

test('recognizeWithVision surfaces a readable error on a refused request', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ stop_reason: 'refusal', content: [] }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    recognizeWithVision({ apiKey: 'sk-ant-test', photos: ['data:image/jpeg;base64,Zm9v'] }),
    /declined/,
  );
});

test('recognizeWithVision surfaces the API error message on a non-2xx response', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: async () => ({ error: { message: 'invalid x-api-key' } }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    recognizeWithVision({ apiKey: 'bad-key', photos: ['data:image/jpeg;base64,Zm9v'] }),
    /invalid x-api-key/,
  );
});
