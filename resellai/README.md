# ResellAI

An AI-powered resale assistant. Scan an item, find out what it is worth, and publish a listing
to the marketplace that pays you the most.

This directory holds the [product requirements document](docs/PRD.md) and a working prototype of
the core loop it describes: **scan → identify → price → profit → marketplace → listing → publish.**

## Running it

No dependencies and no install step. The app runs straight from source — the build is optional,
and only needed to produce the single-file bundles in `dist/`.

Requires Node.js 18 or newer.

```bash
cd resellai
npm run serve     # http://localhost:4173
npm test          # 121 unit tests over the pricing, profit, listing, offer, and vision engines
npm run build     # bundles everything into three single-file builds in dist/
```

The build emits three variants of the same app. Each is a single file that loads with no external
asset requests — no CDN, no font, no stylesheet, no image fetched from anywhere. At runtime it
talks to one backend: your Supabase project, for sign-in, your inventory, and recognition.

Recognition needs a backend, so the build reads two environment variables and inlines them:

```bash
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_ANON_KEY=sb_publishable_... \
  npm run build
```

Both are public by design — the publishable key identifies the project and authorises nothing on
its own, because every table is guarded by row-level security keyed to the caller's JWT. Building
without them prints a warning and produces an app that renders but cannot sign anyone in.

| File | Use it for |
| --- | --- |
| `dist/index.html` | Serving from a static host (Netlify, GitHub Pages, S3, …) — the filename a host's default routing looks for automatically, so no redirect or rewrite rule is needed. |
| `dist/resellai-standalone.html` | Opening the app straight from disk. Same document as `index.html`, named for a person to download and double-click rather than for a host to auto-serve. |
| `dist/resellai.html` | Embedding in a host page that supplies its own `<!doctype html>` and `<head>` (a published Claude Artifact, for instance). A document *fragment*, so opening it directly would fall back to quirks mode. |

### Deploying

The whole app is one static file with no build-time dependencies and no server, so any static
host works. For Netlify specifically: connect this GitHub repository to a new site and it deploys
itself — [`netlify.toml`](../netlify.toml) at the repo root points the build at this directory
(`base = "resellai"`), runs `npm run build`, and publishes `dist/`, where `index.html` is what
Netlify serves. No dashboard configuration is required beyond connecting the repository.

Hosting on a real domain over HTTPS is also what unlocks the live camera in Scan → Take a photo.
`getUserMedia` needs a secure context and a permission grant the user makes per origin, so it
wants a real origin to attach that grant to. A `file://` page has no useful origin, and browsers
differ on what they even claim about one — Chromium reports it as a secure context while still
refusing or mishandling camera access — so the app does not go by that claim. It hides live
capture on `file://` by protocol outright (see [`app/camera.js`](app/camera.js)), rather than
offering a button that asks for permission and then fails. `dist/resellai-standalone.html` is
therefore upload-only by design. Serve `index.html` from Netlify or any other HTTPS host and the
camera button appears, subject to browser support and the user allowing it.

## What is real, and what is an estimate

The honest boundary matters, because a resale app that guesses at prices is worse than useless.

**Real** — item recognition. Photos go to `claude-opus-5`, which names what is actually in the
frame rather than picking the nearest of nineteen catalog entries. There is no simulator and no
API key to supply: the key lives server-side in a Supabase edge function
([`supabase/functions/recognize`](supabase/functions/recognize/index.ts)), which checks the
caller's session and enforces a per-user daily cap before spending it. The browser never sees it.

**Real, and labelled** — pricing for items outside the catalog. Nineteen items have recorded sold
prices; the world does not. When recognition returns something with no history, the model also
returns a low/fair/high valuation, and [`src/engine/vision.js`](src/engine/vision.js) turns that
into an item the pricing engine can consume. Those results are flagged `estimated` and every
surface that shows one says so — the result screen replaces "recent sales" with an explicit
"this is an estimate, not sold history" banner, and the chat assistant refuses to claim
comparable sales it does not have. A guess presented as sold history is the one failure mode
worth engineering against, because it is the one that costs the user money.

**Honest about bad photos.** If the photo is too dark, blurry, angled, obstructed, or crowded to
support an identification, the model says so instead of guessing, and the app shows exactly what
to fix rather than a price for the wrong item.

**Real** — everything downstream of recognition. Given an item, a condition, and a set of comps,
the price ladder, marketplace fees, shipping estimates, platform ranking, listing copy, quality
score, and bundle analysis are all genuinely computed, and they are covered by unit tests. This is
true whether the item was matched to the catalog or valued by the model.

## Accounts and your data

Everything is scoped to a signed-in account. Sign-up and sign-in run against Supabase Auth, and
your inventory lives in a Postgres table guarded by row-level security — the policy, not the
client, is what decides you can only read your own rows. The frontend talks to it over plain REST
rather than `@supabase/supabase-js`, because the build inlines local modules and cannot resolve an
npm dependency; adopting one would mean giving up the single-file build the project is built
around.

What stays on the device: your theme, listing tone, and marketplace priority. Those are
properties of *this browser*, not of the account — syncing them would make your phone change your
laptop.

Photos are sent for identification and are not stored on the server. They are held in memory for
the session only, because a few phone photos as data URLs would exhaust the localStorage quota
and take the rest of the session's state down with them.

Recognition costs the project owner money per scan, so the edge function enforces a per-user
daily cap (25) before it calls the model. That limit is server-side on purpose: a limit the
user's own browser applies is not a limit.

### Setting it up

1. Apply the schema in [`supabase/`](supabase/) to a Supabase project (`profiles`, `items`,
   `scans`, all with row-level security).
2. Deploy the `recognize` edge function.
3. Set `ANTHROPIC_API_KEY` as a secret on that function. **This is the one credential that must
   never reach the browser** — it is why the function exists.
4. Build the frontend with `SUPABASE_URL` and `SUPABASE_ANON_KEY` set, as above.

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
│       ├── vision.js        Real, opt-in recognition via the Claude API (BYO key)
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
photo count behind the quality score. Every photo is genuinely identified. Photos
are held in memory only — a few phone photos as data URLs would exhaust the localStorage quota and take the
rest of the session's state down with them.

Live camera capture is real: "Take a photo" opens the device camera through `getUserMedia`,
and the captured frame goes down the same path as an uploaded file — so it is identified by the
vision model when that is switched on. The option appears when the browser exposes
`getUserMedia` in a secure context and the page is not being served from `file://`, which the
standalone build is; there, and anywhere the camera is refused, uploading a photo does the same
job. See [Deploying](#deploying) for why `file://` is excluded by protocol rather than by asking
the browser whether it counts as secure.

Not built: background removal, barcode scanning, receipt OCR (purchase price and date are typed
in, and the depreciation maths behind them is real), and actual marketplace API integrations —
publishing updates local inventory rather than posting anywhere.

## Design

Colour, typography, and navigation follow the PRD: Deep Indigo `#4F46E5`, Emerald `#10B981`,
Soft White `#FAFAFA`, Charcoal `#111827` in dark mode, SF Pro Display and Inter for text, SF Mono
for figures, and a five-tab bottom bar with a floating scan button. The layout is a phone shell
that fills the viewport on a real device and renders as a device frame on a desktop screen.

Three rules keep it from looking like a template:

**Colour means something or it is not used.** Indigo marks what you can act on and emerald and
red mark profit and loss — so neither is spent on decoration. The home screen's headline figure
used to sit on an indigo-to-violet gradient card with a translucent circle in the corner, which
made the most important number in the app the hardest one to read and left no accent colour to
distinguish a button from a banner. Item thumbnails lost their per-item pastel tints for the
same reason: fifteen different pastels made one inventory look like fifteen unrelated things.

**One icon set, drawn on one grid.** [`app/icons.js`](app/icons.js) holds every icon as a single
stroked path on a 24×24 grid inheriting `currentColor`. These were emoji, which is the fastest
way to get a picture into a prototype and the fastest way to make it look unfinished: emoji are
drawn by the operating system, so the app has no say in their weight or colour and they render
as three different illustrations across macOS, Windows, and Android. They also collided — two
sneakers shared one 👟, a jacket and a pair of jeans shared one 🧥 — so the picture stopped
carrying information.

**Emphasis has to be scarce to work.** The type scale asks for at most `600`, in one step above
body text. The previous scale ran up to `820` and used seven different weights, which on any
system without a variable-weight font all round to the same Bold — so everything was emphasised
and nothing was.
