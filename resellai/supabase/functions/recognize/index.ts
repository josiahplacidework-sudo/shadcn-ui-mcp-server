/**
 * Server-side item recognition.
 *
 * This function exists for one reason: the Anthropic API key must never reach the browser.
 * Once the app has real user accounts you cannot ask every user to bring their own key, and a
 * shared key shipped in the frontend is a key anyone can read out of the page source. So the
 * key lives here as an edge-function secret, the browser sends a photo and its Supabase session
 * JWT, and this function is the only thing that ever sees ANTHROPIC_API_KEY.
 *
 * That makes the app owner pay for every scan, which is why the daily cap below is enforced
 * here rather than in the client. A limit the user's own browser applies is not a limit.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.68.0';
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

/** Scans per user per UTC day. A spend control on the owner's key, not a product feature. */
const DAILY_SCAN_CAP = 25;
const MODEL = 'claude-opus-5';

/**
 * Categories the pricing engine understands, mirrored from src/data/catalog.js.
 *
 * `other` is deliberately in the list. Recognition is open-ended now — the model names whatever
 * is actually in the photo — so it must be able to say "this is not any of your categories"
 * instead of being forced into the nearest wrong one.
 */
const CATEGORIES = [
  'sneakers', 'gaming', 'electronics', 'camera', 'furniture', 'apparel',
  'appliance', 'sporting', 'cards', 'luxury', 'instrument', 'tools',
  'fitness', 'books', 'toys', 'other',
];

const CONDITIONS = ['new', 'like-new', 'excellent', 'very-good', 'good', 'fair', 'poor'];

/**
 * Catalog ids, mirrored from src/data/catalog.js.
 *
 * A match against one of these is worth far more than the model's own price estimate, because
 * it unlocks real sold comps. The model is asked to match only when it is genuinely the same
 * item — a wrong match produces confidently wrong pricing, which is worse than no match.
 */
const CATALOG_IDS = [
  'nike-dunk-panda', 'jordan-1-chicago', 'ps5-disc', 'xbox-series-x', 'airpods-pro-2',
  'canon-r50', 'westelm-desk', 'lululemon-define', 'levis-501', 'kitchenaid-artisan',
  'trek-marlin-5', 'charizard-base', 'coach-tabby', 'fender-strat', 'dewalt-drill',
  'peloton-bike', 'instant-pot-duo', 'paperback-lot', 'lego-millennium',
];

/**
 * Why a photo could not be identified, as a closed set.
 *
 * A free-text reason would be unrenderable — the UI needs to show a specific fix ("move to
 * better light"), and the copy for that lives in the app, not in whatever sentence the model
 * happened to write. The model picks reasons; the app owns the wording.
 */
const RETAKE_REASONS = [
  'too_dark', 'too_blurry', 'item_too_small', 'item_obstructed',
  'too_many_items', 'bad_angle', 'glare', 'unrecognizable',
];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'usable', 'retakeReasons', 'name', 'brand', 'model', 'category',
    'conditionGuess', 'confidence', 'detectedAccessories', 'matchedItemId',
    'valueLow', 'valueFair', 'valueHigh', 'valueBasis', 'weightLb', 'localOnly', 'notes',
  ],
  properties: {
    usable: { type: 'boolean' },
    retakeReasons: { type: 'array', items: { type: 'string', enum: RETAKE_REASONS } },
    name: { type: 'string' },
    brand: { type: 'string' },
    model: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES },
    conditionGuess: { type: 'string', enum: CONDITIONS },
    confidence: { type: 'number' },
    detectedAccessories: { type: 'array', items: { type: 'string' } },
    matchedItemId: { type: 'string', enum: ['', ...CATALOG_IDS] },
    valueLow: { type: 'number' },
    valueFair: { type: 'number' },
    valueHigh: { type: 'number' },
    valueBasis: { type: 'string', enum: ['catalog-match', 'model-estimate', 'unknown'] },
    weightLb: { type: 'number' },
    localOnly: { type: 'boolean' },
    notes: { type: 'string' },
  },
};

const SYSTEM_PROMPT = `You identify secondhand items from photos for a resale app.

IDENTIFY WHAT IS ACTUALLY THERE. Name the specific item — brand, model, and identifying \
details you can actually see. Do not force an item into a category or a catalog entry it does \
not belong to. Being accurately specific ("Vitamix 5200 blender") is the whole job; a vague or \
wrong answer costs the user real money when it gets priced.

REFUSE BAD PHOTOS RATHER THAN GUESSING. Set usable=false and list retakeReasons when the photo \
genuinely does not support an identification: it is too dark or blurry to read markings, the \
item is too small in frame or obstructed, several items compete for attention, the angle hides \
the identifying face, or glare washes out detail. A confident guess from a bad photo is the \
worst outcome — the user acts on a number derived from the wrong item. When usable=false, \
leave the item fields empty or zero; only retakeReasons matters.

CATALOG MATCH. If the item is genuinely one of the entries below, set matchedItemId to that id \
and valueBasis="catalog-match" — the app has real sold-price history for those and will price \
against it. Match only on a real match, not a resemblance: a different colourway, model year, \
or capacity is NOT a match. Otherwise set matchedItemId="".

VALUE ESTIMATE. When there is no catalog match, estimate the current US secondhand resale value \
in USD for the item in the condition you observe: valueLow (quick sale), valueFair (typical \
sold price), valueHigh (patient seller). Set valueBasis="model-estimate". If you genuinely have \
no basis for a number, set the values to 0 and valueBasis="unknown" — the app will say so \
rather than invent a price. Also estimate weightLb (shipping weight, packed) and set \
localOnly=true for anything too large or fragile to ship practically.

Catalog entries with real sold-price history:
nike-dunk-panda — Nike Dunk Low "Panda" (sneakers)
jordan-1-chicago — Air Jordan 1 Retro High OG "Chicago" (sneakers)
ps5-disc — PlayStation 5 Console, disc edition (gaming)
xbox-series-x — Xbox Series X Console (gaming)
airpods-pro-2 — AirPods Pro 2nd generation (electronics)
canon-r50 — Canon EOS R50 Mirrorless Camera (camera)
westelm-desk — West Elm Mid-Century Desk (furniture)
lululemon-define — Lululemon Define Jacket (apparel)
levis-501 — Levi's 501 Original Fit Jeans (apparel)
kitchenaid-artisan — KitchenAid Artisan Stand Mixer (appliance)
trek-marlin-5 — Trek Marlin 5 Mountain Bike (sporting)
charizard-base — Pokemon Charizard Base Set card (cards)
coach-tabby — Coach Tabby Shoulder Bag (luxury)
fender-strat — Fender Player Stratocaster (instrument)
dewalt-drill — DeWalt 20V Max Cordless Drill (tools)
peloton-bike — Peloton Bike (fitness)
instant-pot-duo — Instant Pot Duo 6qt (appliance)
paperback-lot — Paperback book lot (books)
lego-millennium — LEGO Millennium Falcon 75257 (toys)`;

const USER_PROMPT =
  'Identify the item in this photo. Judge whether the photo is good enough to identify it at ' +
  'all before describing it. Note the condition you can observe and any accessories or original ' +
  'packaging visible.';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

/** Splits a `data:image/jpeg;base64,AAAA` URL into an API image block. */
function toImageBlock(dataUrl: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl ?? '');
  if (!match) throw new Error('Photo is not a base64 image data URL');
  return {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: match[1] as never, data: match[2] },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Recognition is not configured on this server.' }, 503);

  // The service-role client bypasses RLS, which is exactly what the scan ledger needs: a user
  // may read their own scan count but must never be able to write one, or the cap is voluntary.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in to scan an item.' }, 401);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: 'Your session has expired. Sign in again.' }, 401);

  // UTC day boundary. The cap is a billing control, so it tracks the billing clock rather than
  // the user's timezone — a user travelling east should not get a second day's allowance.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error: countError } = await admin
    .from('scans')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', startOfDay.toISOString());

  if (countError) return json({ error: 'Could not check your scan allowance.' }, 500);
  if ((count ?? 0) >= DAILY_SCAN_CAP) {
    return json(
      { error: `You have used all ${DAILY_SCAN_CAP} scans for today. They reset at midnight UTC.` },
      429,
    );
  }

  let photos: string[];
  try {
    const body = await req.json();
    photos = Array.isArray(body?.photos) ? body.photos : [];
  } catch {
    return json({ error: 'Malformed request.' }, 400);
  }
  if (!photos.length) return json({ error: 'No photo to analyse.' }, 400);

  let images;
  try {
    images = photos.slice(0, 4).map(toImageBlock);
  } catch {
    return json({ error: 'That photo could not be read.' }, 400);
  }

  const anthropic = new Anthropic({ apiKey });

  let result;
  try {
    // max_tokens covers thinking *and* the response on this model — thinking is on by default,
    // so a budget sized only for the JSON would truncate mid-object.
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [...images, { type: 'text', text: USER_PROMPT }] }],
    } as never) as never as {
      stop_reason: string;
      content: Array<{ type: string; text?: string }>;
    };

    if (response.stop_reason === 'refusal') {
      return json({ error: 'The model declined to analyse this photo.' }, 422);
    }
    if (response.stop_reason === 'max_tokens') {
      return json({ error: 'The analysis was cut short. Try again.' }, 502);
    }

    const textBlock = response.content?.find((block) => block.type === 'text');
    if (!textBlock?.text) return json({ error: 'No structured response from the model.' }, 502);

    result = JSON.parse(textBlock.text);
  } catch (error) {
    return json({ error: `Recognition failed: ${(error as Error).message}` }, 502);
  }

  // Recorded after the call, so a failed request does not spend the user's allowance.
  await admin.from('scans').insert({
    user_id: user.id,
    identified: result?.usable ? [result.brand, result.name].filter(Boolean).join(' ') : null,
    usable: Boolean(result?.usable),
  });

  return json({ result, scansRemaining: DAILY_SCAN_CAP - (count ?? 0) - 1 });
});
