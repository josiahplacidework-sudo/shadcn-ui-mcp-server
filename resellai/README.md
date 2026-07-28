# ResellAI

An AI-powered resale assistant. Scan an item, find out what it is worth, and publish a listing
to the marketplace that pays you the most.

This directory holds the [product requirements document](docs/PRD.md) and a working prototype of
the core loop it describes: **scan → identify → price → profit → marketplace → listing → publish.**

## Running it

No dependencies, no build step, no install.

Requires Node.js 18 or newer.

```bash
cd resellai
npm run serve     # http://localhost:4173
npm test          # 94 unit tests over the pricing, profit, listing, and offer engines
npm run build     # bundles everything into dist/resellai.html
```

## What is real and what is simulated

The honest boundary matters, because a resale app that guesses at prices is worse than useless.

**Simulated** — item recognition. There is no vision model behind the camera. Picking a sample
item resolves deterministically to a catalog entry, and every recognition result is flagged
`simulated: true` so the UI can say so out loud. The comps in
[`src/data/catalog.js`](src/data/catalog.js) are representative rather than live.

**Real** — everything downstream. Given an item, a condition, and a set of comps, the price
ladder, marketplace fees, shipping estimates, platform ranking, listing copy, quality score, and
bundle analysis are all genuinely computed, and they are covered by unit tests. Swapping the
simulated recogniser and the static comps for a vision model and a live sold-listings feed would
leave the rest of the engine intact.

## How the pricing works

Comps are recent **sold** prices for an item in Very Good condition, which is the baseline
everything normalises against. The engine takes a trimmed mean (discarding the highest and
lowest outlier), then applies four adjustments: condition, accessory completeness, category
seasonality for the current month, and demand.

The three price points are derived from that adjusted figure, and — this is the part that
matters — the spread between them widens when the comps disagree with each other. A tight comp
set produces a narrow band and high confidence; a scattered one produces a wide band and says so.

```
Nike Dunk Low "Panda", Very Good, July
  quick $120   fair $135   patient $155     confidence 96%
```

## Why zero fees does not win

The first version of the ranking engine sent every single item to Facebook Marketplace, because
no fees and no shipping meant net proceeds always equalled the asking price. That is wrong, and
it is wrong in a way that would cost users real money.

The fix is a **realization factor**: the share of the fair market price a platform actually
achieves. Comps are national online sold prices, so eBay is the 1.0 reference. Local buyers
negotiate and pay cash, so they realise less. Category fit compounds it — a specific sneaker in a
specific size has a handful of local buyers but thousands nationally, so listing it locally costs
far more than the 15% a local sale normally gives up.

With both forces modelled, items route where experienced resellers actually send them:

| Item | Goes to | Why |
|---|---|---|
| Air Jordan 1, deadstock | StockX | Authenticated market, clears near true value, 14 days |
| Lululemon jacket | Poshmark | Apparel buyers are there and the buyer pays shipping |
| Coach handbag | Poshmark | Boutique pricing holds despite the 20% fee |
| Charizard base set | eBay | Deepest collector audience, local sale is a non-starter |
| West Elm desk | Facebook Marketplace | Too big to ship, and local comps are the only comps |
| DeWalt drill | Facebook Marketplace | No fees beat a thin national margin at this price |

## Layout

```
resellai/
├── docs/PRD.md              Product requirements document
├── src/
│   ├── data/catalog.js      Items, categories, comps, shipping profiles
│   └── engine/
│       ├── condition.js     Condition ladder and price multipliers
│       ├── pricing.js       Comps → quick / fair / patient, with confidence
│       ├── shipping.js      Carrier selection, postage, packaging, packing tips
│       ├── marketplaces.js  Fee models, eligibility, category fit, realization
│       ├── profit.js        Net proceeds and the ranking engine
│       ├── recognition.js   Simulated vision, condition, missing-angle hints
│       ├── listing.js       Title, description, keywords, specifics, tones
│       ├── quality.js       Listing score out of 100 and ranked suggestions
│       ├── bundle.js        Bundle versus separate listings
│       ├── negotiation.js   Accept / counter / hold / decline, and the reply
│       ├── depreciation.js  What holding an item costs per month
│       └── export.js        RFC 4180 CSV export
├── app/                     Phone-shell UI (index.html, styles.css, app.js)
├── test/                    Unit tests, run with node --test
└── scripts/                 Dev server and single-file bundler
```

The engines are plain ES modules with no imports outside this directory, so they run unchanged in
Node, in the browser, or in a future backend.

## Two more judgement calls worth knowing about

**A stale listing should lower its own floor.** The negotiation assistant decides using a
reservation price — the least you should take *today*. It starts at the fair-market net and
slides toward the quick-sale net as the listing ages past its expected time to sell. The same
$300 offer is refused on day one and accepted on day sixty, which is what an experienced seller
does and what a spreadsheet never tells you.

**An offer is already a settled number.** The first version discounted incoming offers by the
platform's realization factor, the same one used to model where a *listing* settles. That
double-counts: a buyer offering $387 cash hands you $387, not $387 minus a haggling allowance.
Offers and counters are now priced raw, while the floor they are measured against keeps the
realization discount — because that is what you would actually end up with if you held out. The
practical effect is that strong local cash offers get accepted instead of rejected.

## What the prototype covers

From the PRD's Phase 1 through 4: item recognition, condition grading, the pricing engine,
profit calculator, marketplace recommendation with explanations, AI listing generation with five
tones, listing quality score, photo suggestions, shipping assistant, inventory with rooms and
folders, CSV export, price alerts, home value dashboard, analytics with seasonality, Garage Sale
Mode, the bundle builder, donate-instead-of-sell advice, the chat assistant, the AI negotiation
assistant, depreciation and hold-or-sell timing, achievements, dark mode, and the free/Pro gate.

You can upload real photos of your own. They are displayed as the item's thumbnail and drive the
photo count behind the quality score, though recognition remains simulated. Photos are held in
memory only — a few phone photos as data URLs would exhaust the localStorage quota and take the
rest of the session's state down with them.

Not built: live camera capture, background removal, barcode scanning, receipt OCR (purchase
price and date are typed in, and the depreciation maths behind them is real), and actual
marketplace API integrations — publishing updates local inventory rather than posting anywhere.

## Design

Colour, typography, and navigation follow the PRD: Deep Indigo `#4F46E5`, Emerald `#10B981`,
Soft White `#FAFAFA`, Charcoal `#111827` in dark mode, SF Pro Display and Inter for text, SF Mono
for figures, and a five-tab bottom bar with a floating scan button. The layout is a phone shell
that fills the viewport on a real device and renders as a device frame on a desktop screen.
