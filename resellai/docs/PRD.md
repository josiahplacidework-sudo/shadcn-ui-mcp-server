# ResellAI — Product Requirements Document

**Version:** 1.0
**Founder:** Josiah Placide
**Status:** Concept
**Platform:** iOS • Android • Web (future)

---

## Vision

ResellAI is an AI-powered resale assistant that helps anyone instantly discover what their
belongings are worth and sell them with almost no effort.

The app combines computer vision, LLM listing generation, market pricing, and marketplace
integrations into one seamless experience.

Instead of asking *"What is this worth?"*, users ask *"How much money is sitting in my house?"*

## Mission

Make selling used items as easy as taking a picture.

## Problem statement

Millions of people own thousands of dollars of unused items and never sell them because they
don't know what an item is worth, where to sell it, or how to write a listing; because pricing
is confusing; because shipping feels overwhelming; and because listing across several apps is
exhausting.

Existing platforms (eBay, Facebook Marketplace, Mercari) only help *after* someone has already
decided to sell. ResellAI helps the user make that decision, then automates the rest.

## Target audience

**Primary** — ages 18–45 who own clothes, electronics, shoes, collectibles, furniture, or
sporting goods they no longer use.

**Secondary** — professional resellers, thrift flippers, garage-sale shoppers, sneaker and
vintage collectors, estate-sale buyers, college students, and parents clearing out kids' rooms.

## Core value proposition

Take one photo. Receive item identification, estimated resale value, expected profit, the best
marketplace to use, an AI-generated listing, a shipping recommendation, and one-click publishing.

---

## User journey

1. **Open app** — a large "Scan Something" camera button dominates the home screen.
2. **Capture** — take a photo or upload from the gallery.
3. **Analyze** — the AI recognizes brand, model, colour, size, material, condition, age,
   category, and included accessories, and reports a confidence score.
4. **Results** — identification plus three price points (quick sale / fair market / patient
   seller), estimated shipping, marketplace fees, and estimated profit.
5. **Sell now** — a single tap moves the item into listing creation.
6. **Generate** — the AI writes the title, description, keywords, category, suggested photo
   list, and recommended shipping option.
7. **Publish** — to Facebook Marketplace, eBay, Mercari, Poshmark, OfferUp, Craigslist, and
   (for eligible items) StockX and GOAT.

### Worked example

| | |
|---|---|
| Item | Nike Dunk Low "Panda" |
| Condition | Very Good |
| Average sold price | $132 |
| Quick sale | $115 |
| Fair market | $132 |
| Patient seller | $149 |
| Estimated shipping | $12 |
| Marketplace fees | $18 |
| **Estimated profit** | **$102** |

---

## Feature specifications

### AI recognition engine

Computer vision across multiple images, covering electronics, shoes, clothing, furniture,
kitchen appliances, gaming consoles, books, trading cards, luxury goods, jewellery, musical
instruments, tools, fitness equipment, toys, and (future) vehicles.

### AI condition detection

Rates each item **New / Like New / Excellent / Very Good / Good / Fair / Poor** and displays a
confidence percentage alongside the rating.

### Pricing engine

Combines recent sold listings, marketplace averages, regional pricing, seasonality, demand
trends, brand popularity, condition, accessory completeness, historical depreciation, and
supply levels. Outputs a quick-sale price, a market price, and a maximum expected price.

### Profit calculator

Shows selling price, marketplace fee, shipping, taxes where applicable, packaging estimate,
and net profit.

### Marketplace recommendation AI

Ranks platforms and explains *why*: fastest sale, highest profit, category fit (luxury →
Poshmark, sneakers → StockX, furniture → Facebook Marketplace, collectibles → Mercari or eBay).

### AI listing generator

Produces an SEO-optimised title, detailed description, bullet points, hashtags, condition
summary, item specifics, and shipping details. Tone options: professional, friendly, minimal,
collector-focused, luxury.

### AI background cleaner

Removes messy backgrounds and replaces them with white, light grey, lifestyle, or studio
backdrops, with shadow enhancement and brightness correction.

### Multi-photo enhancement

Picks the best cover photo, discards blurry images, and suggests missing angles — "photograph
the soles", "show the serial number", "include the charger".

### Listing quality score

Scores photo quality, description quality, pricing accuracy, title SEO, and completeness into
an overall figure out of 100, with concrete suggestions for improvement.

### Garage Sale Mode

Walk around the house scanning item after item while a running total climbs, creating a
treasure-hunt feeling.

### Home value dashboard

Estimated value broken down by room — bedroom, garage, kitchen, closet, office, storage — with
visual charts, potential earnings, and recently scanned items.

### Inventory management

Every scan becomes inventory. Users organise, favourite, archive, mark as sold, and export.
Folders map to physical locations: garage, basement, closet, storage unit, parents' house.

### Price alerts

Monitors owned items and notifies when the market moves — "your PlayStation 5 rose from $350 to
$410; now may be the best time to sell."

### Barcode scanner

Reads UPC, QR, ISBN, and serial numbers to identify products directly.

### Receipt import

Uploads a receipt and auto-fills purchase date, original price, warranty, and depreciation.

### AI chat assistant

Answers "is this worth selling?", "should I wait?", "what platform pays the most?", "what
should I price this at?", "what if I bundle these?"

### Shipping assistant

Suggests USPS, UPS, FedEx, or Pirate Ship with the best rate, packaging suggestions, box size,
weight estimate, and label shortcuts where integrations exist.

### Bundle builder

Given several scanned items, recommends selling separately or bundling — five Xbox items worth
$420 separately may sell as a $395 bundle in half the time.

### Donation recommendation

When an item isn't worth the effort ("estimated resale value: $9"), the app says so and
recommends donating. Honest advice builds trust.

### Analytics dashboard

Lifetime sales, revenue, profit, average sale price, best categories, inventory value, monthly
trends, and items waiting to sell.

### Deal finder *(future)*

Scans marketplace listings for underpriced items and surfaces the potential flip margin.

### Social features *(future)*

Follow resellers, share flips, comment, swap tips, leaderboards, badges, weekly challenges.

---

## Monetisation

| | Free | Pro — $9.99/month |
|---|---|---|
| Scans | 5 per day | Unlimited |
| Listings | Basic | Unlimited |
| Pricing | Basic | Full pricing engine |
| History | Limited | Full inventory dashboard |
| Background remover | — | ✓ |
| Cross-posting | — | ✓ |
| Price alerts | — | ✓ |
| AI negotiation assistant | — | ✓ |
| Advanced analytics | — | ✓ |
| AI processing | Standard | Priority |

## Gamification

Achievements for first sale, $1,000 earned, 100 items sold, garage cleared, closet champion,
collector, and power seller.

## Notifications

Item increased in value • someone viewed your listing • market demand rising • time to lower
your price • bundle recommendation available.

## Settings

Currency, dark mode, language, marketplace preferences, shipping defaults, notification
controls, privacy settings.

---

## Design

**Style** — modern, premium, minimal, Apple-quality. No clutter, rounded corners, generous
spacing, smooth animations.

**Colour**

| Role | Value |
|---|---|
| Primary | Deep Indigo `#4F46E5` |
| Accent | Emerald `#10B981` |
| Background | Soft White `#FAFAFA` |
| Cards | White `#FFFFFF` |
| Dark mode | Charcoal `#111827` |
| Profit | Green |
| Loss | Red |

**Typography** — SF Pro Display for headings, Inter for body, SF Mono for numbers.

**Navigation** — bottom bar with Home, Scan, Inventory, Analytics, Profile, plus an
always-accessible floating scan button.

## AI technology stack

Vision AI for image recognition • LLM for descriptions • market analysis engine for pricing •
OCR for labels, barcodes, and receipts • recommendation engine for marketplace selection •
notification engine for price monitoring.

---

## Roadmap

**Phase 1** — AI item recognition, pricing, inventory, AI listings, profit calculator.
**Phase 2** — marketplace integrations, cross-posting, shipping, price alerts.
**Phase 3** — Garage Sale Mode, bundle recommendations, advanced analytics.
**Phase 4** — AI selling agent, voice assistant, auto-negotiation, automatic relisting,
business tools.

## Success metrics

Time from scan to published listing • average scans per user • listings created per week •
conversion from scan to sale • 30/90-day retention • premium conversion • average resale profit
per user • CSAT • NPS.

## Long-term vision

ResellAI becomes the personal "resale operating system" for consumers. Whether someone is
cleaning out a closet, running a side hustle, or managing a resale business, the app provides
instant item recognition, trustworthy pricing guidance, effortless listing creation, inventory
management, and insights that maximise value with minimal effort. The goal is to make selling
something feel as natural as taking a photo.
