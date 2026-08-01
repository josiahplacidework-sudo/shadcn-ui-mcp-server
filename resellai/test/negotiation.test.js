import test from 'node:test';
import assert from 'node:assert/strict';

import { getItem } from '../src/data/catalog.js';
import { getMarketplace } from '../src/engine/marketplaces.js';
import { calculateProfit } from '../src/engine/profit.js';
import { evaluateOffer, priceForNet } from '../src/engine/negotiation.js';
import { analyseDepreciation, decayRate, projectValue } from '../src/engine/depreciation.js';
import { escapeCsvField, toCsv, COLUMNS } from '../src/engine/export.js';

// ---------------------------------------------------------------- negotiation

test('priceForNet inverts the fee model', () => {
  const item = getItem('airpods-pro-2');
  const marketplace = getMarketplace('ebay');
  const price = priceForNet(item, marketplace, 100);

  assert.ok(Math.abs(calculateProfit(item, marketplace, price).net - 100) < 1.5);
});

test('priceForNet handles a stepped fee schedule', () => {
  // Poshmark switches from a flat $2.95 to 20% at $15.
  const item = getItem('lululemon-define');
  const marketplace = getMarketplace('poshmark');
  const price = priceForNet(item, marketplace, 40);

  assert.ok(Math.abs(calculateProfit(item, marketplace, price).net - 40) < 1.5);
});

test('priceForNet widens its bracket when postage outruns the target', () => {
  // A 100 lb parcel costs far more to ship than a $10 net is worth, so the initial search
  // bracket (targetNet × 3 + 100) holds no solution. Bisecting it anyway used to return the
  // upper bound as though it were an answer.
  const heavy = { ...getItem('nike-dunk-panda'), weightLb: 100, box: 'oversize' };
  const marketplace = getMarketplace('ebay');
  const price = priceForNet(heavy, marketplace, 10, { raw: true });

  assert.ok(price > 10 * 3 + 100, 'should have grown past the initial bracket');
  assert.ok(calculateProfit(heavy, marketplace, price, { raw: true }).net >= 9.5);
});

test('an overdue listing never raises its floor, even when the item nets a loss', () => {
  // Fees and postage can exceed what a cheap item sells for. Time pressure must still only ever
  // lower the floor — a ratio-based clamp moves a negative floor upward.
  const item = { ...getItem('paperback-lot'), weightLb: 40, box: 'large', comps: [12, 13, 11, 14, 12] };
  const marketplace = getMarketplace('ebay');
  const base = { item, marketplace, askPrice: 14, offer: 7, condition: 'good' };

  const fresh = evaluateOffer({ ...base, daysListed: 0 });
  const overdue = evaluateOffer({ ...base, daysListed: 400 });

  assert.ok(fresh.quickNet < 0, 'precondition: this item nets a loss');
  assert.ok(
    overdue.reservationNet <= fresh.reservationNet,
    `floor rose with age: ${fresh.reservationNet} -> ${overdue.reservationNet}`,
  );
  assert.ok(overdue.reservationNet <= overdue.quickNet);
});

test('a strong offer on a fresh listing is accepted', () => {
  const result = evaluateOffer({
    item: getItem('ps5-disc'),
    marketplace: getMarketplace('ebay'),
    askPrice: 370,
    offer: 370,
    daysListed: 0,
  });

  assert.equal(result.verdict, 'accept');
});

test('a lowball is declined outright', () => {
  const result = evaluateOffer({
    item: getItem('ps5-disc'),
    marketplace: getMarketplace('ebay'),
    askPrice: 370,
    offer: 90,
    daysListed: 2,
  });

  assert.equal(result.verdict, 'decline');
  assert.match(result.reasoning, /lowball/i);
});

test('a near-miss offer produces a counter between the offer and the ask', () => {
  const result = evaluateOffer({
    item: getItem('ps5-disc'),
    marketplace: getMarketplace('ebay'),
    askPrice: 370,
    offer: 300,
    daysListed: 3,
  });

  assert.equal(result.verdict, 'counter');
  assert.ok(result.counterPrice > result.offer);
  assert.ok(result.counterPrice <= result.askPrice);
});

test('a concrete offer is not discounted by the platform realization factor', () => {
  // Realization models where a listing *settles*. An offer is already the settled number, so
  // applying it again would reject cash that beats what holding out is worth.
  const item = getItem('ps5-disc');
  const facebook = getMarketplace('facebook');

  const result = evaluateOffer({ item, marketplace: facebook, askPrice: 430, offer: 387, daysListed: 0 });

  // Facebook charges no fees and no shipping, so the seller keeps the offer in full.
  assert.equal(result.offerNet, 387);
  assert.ok(result.offerNet > result.fairNet, 'cash in hand should beat the expected settlement');
  assert.equal(result.verdict, 'accept');
});

test('fees are still deducted from an offer where the platform charges them', () => {
  const result = evaluateOffer({
    item: getItem('ps5-disc'),
    marketplace: getMarketplace('ebay'),
    askPrice: 370,
    offer: 333,
    daysListed: 0,
  });

  assert.ok(result.offerNet < 333, 'eBay fees and shipping come out of the offer');
  assert.equal(result.verdict, 'counter');
});

test('with nothing to concede the verdict is hold, not a counter at the asking price', () => {
  // Poshmark buyers pay shipping and accept boutique pricing, so the ask genuinely holds.
  const result = evaluateOffer({
    item: getItem('coach-tabby'),
    marketplace: getMarketplace('poshmark'),
    askPrice: 195,
    offer: 156,
    condition: 'excellent',
    daysListed: 0,
  });

  assert.equal(result.verdict, 'hold');
  // The reply must never offer the buyer the price they are already looking at.
  assert.doesNotMatch(result.reply, /\$195/);
  assert.match(result.reply, /firm/i);
});

test('a hold becomes a real counter once the floor drops below the ask', () => {
  const base = {
    item: getItem('coach-tabby'),
    marketplace: getMarketplace('poshmark'),
    askPrice: 195,
    offer: 156,
    condition: 'excellent',
  };

  assert.equal(evaluateOffer({ ...base, daysListed: 0 }).verdict, 'hold');

  const later = evaluateOffer({ ...base, daysListed: 30 });
  assert.equal(later.verdict, 'counter');
  assert.ok(later.counterPrice < later.askPrice);
});

test('time pressure lowers the reservation price', () => {
  const base = {
    item: getItem('ps5-disc'),
    marketplace: getMarketplace('ebay'),
    askPrice: 370,
    offer: 300,
  };

  const fresh = evaluateOffer({ ...base, daysListed: 0 });
  const stale = evaluateOffer({ ...base, daysListed: 60 });

  assert.ok(stale.reservationNet < fresh.reservationNet);
});

test('an offer refused on day one can be accepted once the listing goes stale', () => {
  const base = {
    item: getItem('ps5-disc'),
    marketplace: getMarketplace('ebay'),
    askPrice: 370,
    offer: 310,
  };

  assert.notEqual(evaluateOffer({ ...base, daysListed: 0 }).verdict, 'accept');
  assert.equal(evaluateOffer({ ...base, daysListed: 90 }).verdict, 'accept');
});

test('the reservation price never collapses to nothing, however stale', () => {
  const result = evaluateOffer({
    item: getItem('ps5-disc'),
    marketplace: getMarketplace('ebay'),
    askPrice: 370,
    offer: 10,
    daysListed: 3650,
  });

  assert.ok(result.reservationNet > result.quickNet * 0.6);
  assert.equal(result.verdict, 'decline');
});

test('every verdict comes with a usable reply and reasoning', () => {
  const item = getItem('coach-tabby');
  const marketplace = getMarketplace('poshmark');

  for (const offer of [200, 150, 30]) {
    const result = evaluateOffer({ item, marketplace, askPrice: 195, offer, daysListed: 5 });
    assert.ok(['accept', 'counter', 'decline'].includes(result.verdict));
    assert.ok(result.reply.length > 10, `no reply for offer ${offer}`);
    assert.ok(result.reasoning.length > 30);
  }
});

test('the counter reply quotes the counter price', () => {
  const result = evaluateOffer({
    item: getItem('ps5-disc'),
    marketplace: getMarketplace('ebay'),
    askPrice: 370,
    offer: 300,
    daysListed: 3,
  });

  assert.match(result.reply, new RegExp(`\\$${result.counterPrice}\\b`));
});

test('tone changes the wording but not the verdict', () => {
  const base = {
    item: getItem('ps5-disc'),
    marketplace: getMarketplace('ebay'),
    askPrice: 370,
    offer: 300,
    daysListed: 3,
  };

  const professional = evaluateOffer({ ...base, tone: 'professional' });
  const minimal = evaluateOffer({ ...base, tone: 'minimal' });

  assert.equal(professional.verdict, minimal.verdict);
  assert.notEqual(professional.reply, minimal.reply);
});

// ---------------------------------------------------------------- depreciation

test('trading cards appreciate while electronics decay', () => {
  assert.ok(decayRate('cards') < 0);
  assert.ok(decayRate('electronics') > 0.2);
});

test('unknown categories get a default decay rate', () => {
  assert.equal(decayRate('nonexistent'), 0.15);
});

test('projectValue compounds over time', () => {
  const oneYear = projectValue(100, 'electronics', 1);
  const twoYears = projectValue(100, 'electronics', 2);

  assert.ok(Math.abs(oneYear - 72) < 0.01);
  assert.ok(twoYears < oneYear);
});

test('an appreciating item is recommended for holding', () => {
  const result = analyseDepreciation({ item: getItem('charizard-base'), condition: 'excellent' });

  assert.equal(result.appreciating, true);
  assert.equal(result.recommendation.verdict, 'hold');
  assert.ok(result.inTwelveMonths > result.current);
});

test('a fast-decaying item is recommended for immediate sale', () => {
  const result = analyseDepreciation({ item: getItem('canon-r50'), condition: 'excellent' });

  assert.equal(result.recommendation.verdict, 'sell-now');
  assert.ok(result.monthlyChange > 0);
  assert.ok(result.inSixMonths < result.current);
});

test('purchase details produce ownership figures', () => {
  const result = analyseDepreciation({
    item: getItem('ps5-disc'),
    condition: 'very-good',
    purchasePrice: 499,
    purchaseDate: '2021-01-15',
  });

  assert.equal(result.known, true);
  assert.ok(result.lost > 0);
  assert.ok(result.ageYears > 3);
  assert.ok(result.retained < 1);
  assert.equal(result.inWarranty, false);
});

test('depreciation works without any receipt', () => {
  const result = analyseDepreciation({ item: getItem('ps5-disc') });

  assert.equal(result.known, false);
  assert.ok(result.current > 0);
  assert.ok(result.recommendation.headline.length > 5);
});

test('an unparseable purchase date is ignored rather than throwing', () => {
  const result = analyseDepreciation({
    item: getItem('ps5-disc'),
    purchasePrice: 499,
    purchaseDate: 'not a date',
  });

  assert.equal(result.known, false);
});

// ---------------------------------------------------------------- export

test('CSV fields are quoted and embedded quotes are doubled', () => {
  assert.equal(escapeCsvField('Nike Dunk Low "Panda"'), '"Nike Dunk Low ""Panda"""');
  assert.equal(escapeCsvField('a,b'), '"a,b"');
  assert.equal(escapeCsvField(null), '""');
  assert.equal(escapeCsvField(0), '"0"');
});

test('toCsv writes a header and one line per row', () => {
  const csv = toCsv([
    { Item: 'Nike Dunk Low "Panda"', Brand: 'Nike', Status: 'listed' },
    { Item: 'PlayStation 5', Brand: 'Sony', Status: 'sold' },
  ]);

  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('"Item","Brand"'));
  assert.ok(lines[1].includes('""Panda""'));
});

test('a quoted comma does not create an extra column', () => {
  const csv = toCsv([{ Item: 'Desk, oak', Brand: 'West Elm' }]);
  const row = csv.trim().split('\r\n')[1];

  // Splitting on the field boundary rather than every comma yields the full column count.
  assert.equal(row.split('","').length, COLUMNS.length);
});

test('toCsv handles an empty inventory', () => {
  const csv = toCsv([]);
  assert.equal(csv.trim().split('\r\n').length, 1);
});

// ---------------------------------------------------------------- review follow-ups

test('an appreciating item still reports ownership when it was free', () => {
  // $0 is a real purchase price in resale — gifts, hand-me-downs, kerbside finds.
  const result = analyseDepreciation({
    item: getItem('charizard-base'),
    condition: 'excellent',
    purchasePrice: 0,
    purchaseDate: '2020-01-01',
  });

  assert.equal(result.known, true);
  assert.equal(result.purchasePrice, 0);
  assert.equal(result.retained, null, 'retained is undefined against a zero cost basis');
  assert.ok(result.lost < 0, 'a free item is pure gain, not a loss');
});

test('a missing purchase price is still unknown', () => {
  const result = analyseDepreciation({ item: getItem('ps5-disc'), purchaseDate: '2021-01-01' });
  assert.equal(result.known, false);
});
