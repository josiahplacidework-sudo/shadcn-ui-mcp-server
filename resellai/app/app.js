/**
 * ResellAI prototype application.
 *
 * A single-screen phone shell that walks the full PRD journey: scan, identify, price, calculate
 * profit, pick a marketplace, generate a listing, and publish. State lives in localStorage so a
 * session survives a refresh.
 */

import { CATALOG, CATEGORIES, categoryOf, getItem } from '../src/data/catalog.js';
import { cameraSupported, captureFrame, describeCameraError, startCamera, stopCamera } from './camera.js';
import { categoryIcon, icon } from './icons.js';
import {
  analyseBundle,
  analyseDepreciation,
  analysePhoto,
  COLUMNS,
  CONDITIONS,
  evaluateOffer,
  eligibleMarketplaces,
  expectedDays,
  explainPrice,
  generateListing,
  getCondition,
  getMarketplace,
  hashString,
  packingTips,
  priceItem,
  rankMarketplaces,
  recognizeWithVision,
  scoreListing,
  sellOrDonate,
  seasonalityCurve,
  toCsv,
  TONES,
} from '../src/engine/index.js';

// ---------------------------------------------------------------- state

const STORAGE_KEY = 'resellai.state.v1';
const FREE_SCAN_LIMIT = 5;

const ROOMS = ['Bedroom', 'Closet', 'Garage', 'Kitchen', 'Office', 'Living room', 'Storage'];

const defaultState = () => ({
  view: 'home',
  /** null means "follow the system or host preference"; 'light'/'dark' is an explicit choice. */
  theme: null,
  plan: 'free',
  scansToday: 0,
  scanDay: today(),
  inventory: seedInventory(),
  current: null,
  garage: { active: false, scanned: [] },
  chat: [],
  selection: [],
  prefs: { priority: 'balanced', tone: 'professional', notifications: true, useVisionAI: false },
});

let state = load();
let toastTimer = null;

/**
 * The user's own Anthropic API key, for the optional real-AI-recognition path.
 *
 * Session storage only, never `state` — the same reasoning as `pendingPhoto` below, except the
 * risk here is a leaked credential rather than a blown quota. `save()` serialises the whole state
 * object to localStorage, which persists indefinitely and can sync across devices; keeping the
 * key out of it means it never outlives this browser tab.
 */
const VISION_KEY_STORAGE = 'resellai.visionApiKey';
let visionApiKey = '';
try {
  visionApiKey = sessionStorage.getItem(VISION_KEY_STORAGE) ?? '';
} catch {
  /* private browsing — the key just won't survive a refresh */
}

/**
 * Uploaded photos, keyed by scan seed or inventory uid.
 *
 * Deliberately in memory only. Data URLs for a handful of phone photos run to several megabytes
 * and would blow the localStorage quota on the first save, taking the rest of the session's
 * state with it. Thumbnails fall back to the category glyph once a session ends.
 */
const photoStore = new Map();

/**
 * Preview shown during the analysis animation.
 *
 * Module-level rather than on `state` for the same reason as `photoStore`: `save()` serialises
 * the whole state object, so parking a multi-megabyte data URL there would blow the quota and
 * take the rest of the session's state with it.
 */
let pendingPhoto = null;

/**
 * The open camera stream, if the camera view is showing.
 *
 * Module-level and singular on purpose: the device camera stays on until every track is stopped,
 * so there must be exactly one handle to stop, and it must survive the re-renders that replace
 * the <video> element underneath it.
 */
let cameraStream = null;

/**
 * The in-flight `startCamera()` call, if one has not resolved yet.
 *
 * Separate from `cameraStream` because there is a window — however long the permission prompt is
 * on screen — where the camera is being opened but no stream exists to hold yet.
 */
let cameraStartPromise = null;

/** Release the camera whenever we leave the camera view, however we leave it. */
function closeCamera() {
  stopCamera(cameraStream);
  cameraStream = null;
}

function photosFor(key) {
  return photoStore.get(key) ?? [];
}

/** Local calendar day, used to expire the free plan's daily scan allowance. */
function today() {
  return new Date().toDateString();
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();

    const restored = { ...defaultState(), ...JSON.parse(raw), view: 'home', current: null };
    // `prefs` is nested, so the spread above replaces it wholesale with whatever was saved —
    // a pref field added after a user's first save would otherwise never reach their state.
    restored.prefs = { ...defaultState().prefs, ...restored.prefs };

    // The free plan grants five scans *a day*. Without this the persisted counter would make it
    // a lifetime limit, permanently gating the app after the fifth scan.
    if (restored.scanDay !== today()) {
      restored.scanDay = today();
      restored.scansToday = 0;
    }
    return restored;
  } catch {
    return defaultState();
  }
}

/** Count a scan against today's allowance, rolling over if the day changed mid-session. */
function recordScan() {
  if (state.scanDay !== today()) {
    state.scanDay = today();
    state.scansToday = 0;
  }
  state.scansToday += 1;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, current: null }));
  } catch {
    /* private browsing — the prototype still works, it just will not persist */
  }
}

/** A little history so the dashboards have something to show on first run. */
function seedInventory() {
  const seeds = [
    ['airpods-pro-2', 'excellent', 'sold', 168, 22],
    ['lululemon-define', 'very-good', 'sold', 72, 40],
    ['dewalt-drill', 'good', 'sold', 85, 61],
    ['lego-millennium', 'like-new', 'listed', 145, 6],
    ['instant-pot-duo', 'good', 'scanned', null, 3],
    ['trek-marlin-5', 'very-good', 'listed', 320, 11],
    ['charizard-base', 'excellent', 'scanned', null, 1],
  ];

  return seeds.map(([itemId, condition, status, soldFor, daysAgo], index) => {
    const item = getItem(itemId);
    const pricing = priceItem(item, { condition });
    return {
      uid: `seed-${index}`,
      itemId,
      condition,
      accessories: item.accessories ?? [],
      price: pricing.prices.fair,
      status,
      soldFor,
      room: categoryOf(item).room,
      listedOn: status === 'scanned' ? [] : ['ebay'],
      date: Date.now() - daysAgo * 86400000,
    };
  });
}

// ---------------------------------------------------------------- helpers

const $ = (sel) => document.querySelector(sel);

const money = (n, decimals = 0) =>
  `$${Number(n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const pct = (n) => `${Math.round(n * 100)}%`;

/** The category icon for an item, at a given rendered size. */
const glyphOf = (item, size = 22) => categoryIcon(item.category, size);

/**
 * Thumbnail markup for an item, using the user's own photo when they uploaded one.
 * @param {string} [extraClass] e.g. 'thumb-lg'
 */
function thumbFor(item, key, extraClass = '') {
  const photo = photosFor(key)[0];
  const classes = `thumb ${extraClass}`.trim();

  if (photo) {
    return `<span class="${classes}" style="background-image:url('${photo}');background-size:cover;background-position:center;"></span>`;
  }
  // No per-item tint behind the icon. A different pastel for every row made the list read as
  // fifteen unrelated things rather than one inventory, and it competed with the only colour in
  // the app that carries meaning: profit and loss on the numbers to the right.
  return `<span class="${classes}">${glyphOf(item, extraClass.includes('thumb-lg') ? 40 : 22)}</span>`;
}

function toast(message) {
  const existing = $('.toast');
  if (existing) existing.remove();
  clearTimeout(toastTimer);

  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  $('.phone').appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

const isPro = () => state.plan === 'pro';
const scansLeft = () => Math.max(0, FREE_SCAN_LIMIT - state.scansToday);

/** An inventory row joined to its catalog item and freshly recalculated pricing. */
function inventoryEntry(entry) {
  const item = getItem(entry.itemId);
  const pricing = priceItem(item, { condition: entry.condition, includedAccessories: entry.accessories });
  return { ...entry, item, pricing };
}

/** Deterministic weekly market drift, so price alerts are stable within a session. */
function marketDrift(itemId) {
  const week = Math.floor(Date.now() / (7 * 86400000));
  const seeded = (hashString(`${itemId}:${week}`) % 1000) / 1000;
  return (seeded - 0.42) * 0.34; // roughly -14% … +20%
}

/** Unsold items whose value has moved enough to be worth telling the user about. */
function priceAlerts() {
  return state.inventory
    .filter((entry) => entry.status !== 'sold')
    .map((entry) => {
      const enriched = inventoryEntry(entry);
      const drift = marketDrift(entry.itemId);
      const now = Math.round(enriched.pricing.prices.fair * (1 + drift));
      return { ...enriched, drift, now, was: enriched.pricing.prices.fair };
    })
    .filter((a) => Math.abs(a.drift) > 0.07)
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
    // Owning two of something is not two pieces of news — alert once per item.
    .filter((alert, index, all) => all.findIndex((a) => a.itemId === alert.itemId) === index);
}

// ---------------------------------------------------------------- shell

/**
 * Whether the app is currently rendering dark.
 *
 * The root's `data-theme` is the source of truth because the surrounding page may own the theme
 * toggle. Rendering never writes that attribute — only an explicit in-app toggle does — so a
 * host-level theme switch is not clobbered on the next render.
 */
function isDark() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function render() {
  const views = {
    home: viewHome,
    scan: viewScan,
    analysing: viewAnalysing,
    result: viewResult,
    listing: viewListing,
    inventory: viewInventory,
    analytics: viewAnalytics,
    profile: viewProfile,
    garage: viewGarage,
    chat: viewChat,
    bundle: viewBundle,
    negotiate: viewNegotiate,
    camera: viewCamera,
  };

  const screen = $('#screen');
  screen.innerHTML = `<div class="view">${(views[state.view] ?? viewHome)()}</div>`;
  screen.scrollTop = 0;

  renderTabs();

  // Camera lifetime is settled here rather than in each action. Every route change passes
  // through render(), so leaving by the back button, the tab bar, or a capture all release the
  // device — and a navigation path added later cannot forget to.
  if (state.view === 'camera') attachCamera();
  else closeCamera();
}

const TABS = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'inventory', icon: 'inventory', label: 'Inventory' },
  { id: 'scan', icon: 'camera', label: 'Scan', center: true },
  { id: 'analytics', icon: 'analytics', label: 'Analytics' },
  { id: 'profile', icon: 'profile', label: 'Profile' },
];

/** Redraws the bottom bar, mapping sub-screens back to their owning tab. */
function renderTabs() {
  const active = { analysing: 'scan', result: 'scan', listing: 'scan', garage: 'scan', bundle: 'inventory', negotiate: 'inventory', chat: 'home' }[state.view] ?? state.view;

  $('#tabbar').innerHTML = TABS.map((tab) => {
    if (tab.center) {
      return `<button class="tab tab-scan" data-act="go" data-arg="scan" aria-label="Scan an item">
        <span class="fab">${icon('camera', 24)}</span>
      </button>`;
    }
    return `<button class="tab" data-act="go" data-arg="${tab.id}"
      ${active === tab.id ? 'aria-current="page"' : ''}>
      <span class="i">${icon(tab.icon, 22)}</span><span>${tab.label}</span>
    </button>`;
  }).join('');
}

// ---------------------------------------------------------------- home

function viewHome() {
  const active = state.inventory.filter((e) => e.status !== 'sold').map(inventoryEntry);
  const totalValue = active.reduce((sum, e) => sum + e.pricing.prices.fair, 0);
  const sold = state.inventory.filter((e) => e.status === 'sold');
  const earned = sold.reduce((sum, e) => sum + (e.soldFor ?? 0), 0);

  const byRoom = {};
  for (const entry of active) {
    byRoom[entry.room] = (byRoom[entry.room] ?? 0) + entry.pricing.prices.fair;
  }
  const rooms = Object.entries(byRoom).sort((a, b) => b[1] - a[1]);
  const maxRoom = rooms.length ? rooms[0][1] : 1;

  const alerts = priceAlerts().slice(0, 2);
  const recent = [...state.inventory].sort((a, b) => b.date - a.date).slice(0, 3).map(inventoryEntry);

  return `
    <div class="row-between" style="margin: 10px 0 16px;">
      <h1>${greeting()}</h1>
      <button class="btn btn-quiet btn-sm" data-act="go" data-arg="chat" aria-label="Ask the assistant">${icon('chat', 18)}</button>
    </div>

    <div class="hero">
      <div class="eyebrow">Estimated value sitting at home</div>
      <div class="big">${money(totalValue)}</div>
      <div class="note">Across ${active.length} scanned item${active.length === 1 ? '' : 's'} · ${money(earned)} already earned</div>
    </div>

    <div style="margin-top: 16px;">
      <button class="scan-cta" data-act="go" data-arg="scan">
        <span class="scan-lens">${icon('camera', 26)}</span>
        <span class="grow">
          <span style="display:block;font-size:15px;font-weight:600;">Scan an item</span>
          <span class="tiny">Find out what it is worth</span>
        </span>
        <span class="chev">${icon('chevron', 16)}</span>
      </button>
    </div>

    <div class="stat-grid" style="margin-top: 12px;">
      <button class="stat" data-act="go" data-arg="garage" style="text-align:left;cursor:pointer;">
        <div class="v">${icon('cart', 20)}</div>
        <div class="k" style="font-weight:600;color:var(--ink);margin-top:8px;">Garage Sale Mode</div>
        <div class="k">Scan a whole room fast</div>
      </button>
      <button class="stat" data-act="go" data-arg="analytics" style="text-align:left;cursor:pointer;">
        <div class="v profit">${money(earned)}</div>
        <div class="k">Lifetime earnings</div>
      </button>
    </div>

    ${alerts.length ? `
      <div class="section-head"><h2>Price alerts</h2></div>
      <div class="card">${alerts.map(alertCard).join('')}</div>
    ` : ''}

    ${rooms.length ? `
      <div class="section-head">
        <h2>Value by room</h2>
        <span class="link" data-act="go" data-arg="inventory">See all</span>
      </div>
      <div class="card">
        ${rooms.map(([room, value]) => `
          <div class="room">
            <div class="row-between">
              <span style="font-size:14px;font-weight:500;">${esc(room)}</span>
              <span class="num" style="font-size:14px;font-weight:600;">${money(value)}</span>
            </div>
            <div class="bar"><span style="width:${Math.max(4, (value / maxRoom) * 100)}%"></span></div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="section-head">
      <h2>Recently scanned</h2>
      <span class="link" data-act="go" data-arg="inventory">Inventory</span>
    </div>
    <div class="card">
      ${recent.map((entry) => `
        <button class="item-row" data-act="open-item" data-arg="${entry.uid}">
          ${thumbFor(entry.item, entry.uid)}
          <span class="grow col">
            <span class="name truncate">${esc(entry.item.name)}</span>
            <span class="tiny">${statusLabel(entry)}</span>
          </span>
          <span class="num" style="font-weight:600;">${money(entry.soldFor ?? entry.pricing.prices.fair)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

/** A single price-movement card for the home screen. */
function alertCard(alert) {
  const up = alert.drift > 0;
  // A row inside the alerts card rather than a card of its own. Two stacked cards for two
  // alerts made a list of two things look like two unrelated announcements.
  return `
    <div class="item-row">
      <span class="thumb">${glyphOf(alert.item)}</span>
      <span class="grow col">
        <span class="name truncate">${esc(alert.item.name)}</span>
        <span class="tiny">${up ? 'Now may be the best time to sell' : 'Value is drifting down — consider listing soon'}</span>
      </span>
      <span class="col" style="text-align:right;">
        <span class="num ${up ? 'profit' : 'loss'}" style="font-weight:600;">${money(alert.now)}</span>
        <span class="tiny ${up ? 'profit' : 'loss'}">${up ? '▲' : '▼'} ${pct(Math.abs(alert.drift))}</span>
      </span>
    </div>
  `;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The one-line status under an inventory row: sold for, listed on, or its room. */
function statusLabel(entry) {
  if (entry.status === 'sold') return `Sold for ${money(entry.soldFor)}`;
  if (entry.status === 'listed') return `Listed on ${entry.listedOn.map((id) => getMarketplace(id)?.name ?? id).join(', ')}`;
  return `In ${entry.room}`;
}

// ---------------------------------------------------------------- camera

/**
 * Live camera view.
 *
 * Rendered before the stream exists — `render()` is synchronous, and opening a camera is not.
 * The <video> starts empty and `attachCamera()` fills it once the permission prompt resolves.
 */
function viewCamera() {
  return `
    <div class="row-between" style="margin: 8px 0 14px;">
      <button class="btn btn-quiet btn-sm" data-act="go" data-arg="scan">‹ Back</button>
      ${state.prefs.useVisionAI && visionApiKey
        ? '<span class="pill pill-emerald">AI recognition on</span>'
        : '<span class="pill pill-indigo">Simulated recognition</span>'}
    </div>

    <h1>Take a photo</h1>
    <p class="sub" style="margin-top:4px;">Fill the frame with the item, and keep the background plain.</p>

    <div class="viewfinder" style="margin-top:16px;height:340px;">
      <video id="camera-feed" playsinline muted
        style="width:100%;height:100%;object-fit:cover;background:#111827;"></video>
      <span class="corner tl"></span><span class="corner tr"></span>
      <span class="corner bl"></span><span class="corner br"></span>
      <span class="glyph" id="camera-placeholder" style="position:absolute;">${icon('camera', 44)}</span>
    </div>

    <p class="tiny" id="camera-status" style="margin-top:10px;">Starting the camera…</p>

    <div class="stack" style="margin-top:16px;">
      <button class="btn btn-block" data-act="capture" id="camera-shutter" disabled>Capture</button>
      <button class="btn btn-ghost btn-block" data-act="go" data-arg="scan">Cancel</button>
    </div>
  `;
}

/**
 * Open the camera and wire it to the just-rendered view.
 *
 * Deliberately not awaited by the caller: the view is already on screen, and this fills it in
 * when the user answers the permission prompt — which may be never.
 */
async function attachCamera() {
  const video = $('#camera-feed');
  if (!video) return;

  // A re-render while the camera is open leaves a fresh <video> and a stream that is still
  // running — rebind rather than restarting, which would flicker and re-acquire the device.
  if (cameraStream) {
    video.srcObject = cameraStream;
    video.play().catch(() => {});
    markCameraReady();
    return;
  }

  // Opening a camera takes as long as the user takes to answer the permission prompt, and the
  // camera view can be left and re-entered while it sits there — tab bar, back, scan, "Take a
  // photo" again. Each re-entry renders and calls this. Without a handle on the request already
  // in flight, `cameraStream` is still null on the second pass and the device gets opened twice:
  // the second stream overwrites the first in the single module-level handle, so the first is
  // never stopped and the indicator light stays on for the rest of the session.
  if (cameraStartPromise) {
    await cameraStartPromise.catch(() => {});
    // Re-enter rather than duplicate the binding: the stream was attached to the <video> that
    // was on screen when the request started, which the re-render has since replaced. Only when
    // it opened — a failed request has already shown its error, and retrying it here would ask
    // for permission a second time immediately after the user declined it.
    if (state.view === 'camera' && cameraStream) attachCamera();
    return;
  }

  try {
    cameraStartPromise = startCamera(video);
    cameraStream = await cameraStartPromise;
  } catch (error) {
    // The view may have been left while the permission prompt sat open.
    if (state.view !== 'camera') return closeCamera();
    const status = $('#camera-status');
    if (status) status.textContent = describeCameraError(error);
    return;
  } finally {
    cameraStartPromise = null;
  }

  // The same race the other way: permission granted after the user navigated away.
  if (state.view !== 'camera') return closeCamera();
  markCameraReady();
}

function markCameraReady() {
  $('#camera-placeholder')?.remove();
  const status = $('#camera-status');
  if (status) status.textContent = 'Ready — tap Capture when the item fills the frame.';
  const shutter = $('#camera-shutter');
  if (shutter) shutter.disabled = false;
}

// ---------------------------------------------------------------- scan

function viewScan() {
  const gated = !isPro() && scansLeft() === 0;

  return `
    <div style="margin: 10px 0 16px;">
      <h1>Scan an item</h1>
      <p class="sub">Point at any item. The assistant identifies it and prices it against recent sold listings.</p>
    </div>

    <div class="viewfinder">
      <span class="corner tl"></span><span class="corner tr"></span>
      <span class="corner bl"></span><span class="corner br"></span>
      <span class="glyph">${icon('box', 64)}</span>
    </div>

    ${gated ? `
      <div class="banner banner-amber" style="margin-top:14px;">
        <strong>Daily scan limit reached.</strong> The free plan includes ${FREE_SCAN_LIMIT} scans a day.
        Upgrade to Pro for unlimited scanning.
        <div style="margin-top:10px;"><button class="btn btn-sm" data-act="upgrade">Upgrade to Pro</button></div>
      </div>
    ` : `
      <div class="banner banner-indigo" style="margin-top:14px;">
        ${state.prefs.useVisionAI && visionApiKey
          ? 'Real AI recognition is on, so a photo you take or upload is genuinely identified. Picking a sample below stays simulated — there is no photo to look at.'
          : 'Picking a sample below gives a simulated recognition result. Every other number on the next screen is computed for real, and you can switch on real AI recognition in Profile.'}
      </div>
    `}

    <div class="section-head"><h2>Try a sample</h2>
      ${isPro() ? '' : `<span class="tiny">${scansLeft()} scan${scansLeft() === 1 ? '' : 's'} left today</span>`}
    </div>

    <div class="sample-grid">
      ${CATALOG.map((item) => `
        <button class="sample" data-act="scan" data-arg="${item.id}" ${gated ? 'disabled' : ''}>
          <span class="g">${glyphOf(item, 20)}</span>
          <span class="l">${esc(shortName(item))}</span>
        </button>
      `).join('')}
    </div>

    <div class="section-head"><h2>Other ways in</h2></div>
    <div class="card">
      ${cameraSupported() ? `
        <button class="item-row" data-act="camera" ${gated ? 'disabled' : ''}>
          <span class="thumb">${icon('camera', 22)}</span>
          <span class="grow col">
            <span class="name">Take a photo</span>
            <span class="tiny">Use the camera on this device</span>
          </span>
          <span class="chev">${icon('chevron', 15)}</span>
        </button>
      ` : ''}
      <label class="item-row" style="cursor:pointer;">
        <span class="thumb">${icon('image', 22)}</span>
        <span class="grow col">
          <span class="name">Upload your own photos</span>
          <span class="tiny">Use real pictures of your item</span>
        </span>
        <span class="chev">${icon('chevron', 15)}</span>
        <input type="file" class="sr-only" accept="image/*" multiple data-act="photos" ${gated ? 'disabled' : ''} />
      </label>
      <button class="item-row" data-act="scan-random" ${gated ? 'disabled' : ''}>
        <span class="thumb">${icon('spark', 22)}</span>
        <span class="grow col"><span class="name">Surprise me</span><span class="tiny">Scan a random item</span></span>
        <span class="chev">${icon('chevron', 15)}</span>
      </button>
      <button class="item-row" data-act="barcode">
        <span class="thumb">${icon('barcode', 22)}</span>
        <span class="grow col"><span class="name">Barcode or serial</span><span class="tiny">UPC, QR, ISBN, serial number</span></span>
        <span class="chev">${icon('chevron', 15)}</span>
      </button>
      <button class="item-row" data-act="receipt">
        <span class="thumb">${icon('receipt', 22)}</span>
        <span class="grow col"><span class="name">Import a receipt</span><span class="tiny">Work out what it has cost you to keep</span></span>
        <span class="chev">${icon('chevron', 15)}</span>
      </button>
    </div>
  `;
}

/**
 * The name as it appears on a sample tile.
 *
 * Slicing at a fixed character count is what produced "AirPods Pro (2nd generat…" — a cut mid-word
 * and mid-parenthesis. Trim the parenthetical, which is always the least useful part of a product
 * name at tile size, and let the two-line clamp in styles.css end the rest at a line boundary.
 */
function shortName(item) {
  return item.name.replace(/\s*\([^)]*\)\s*$/, '');
}

function viewAnalysing() {
  const steps = [
    'Reading the image',
    'Matching against the catalog',
    'Grading condition',
    'Pulling recent sold prices',
    'Calculating your profit',
  ];

  return `
    <div style="margin: 8px 0 16px;"><h1>Analyzing…</h1></div>
    <div class="viewfinder">
      <span class="scanline"></span>
      <span class="corner tl"></span><span class="corner tr"></span>
      <span class="corner bl"></span><span class="corner br"></span>
      ${pendingPhoto
        ? `<img src="${pendingPhoto}" alt="" style="width:100%;height:100%;object-fit:cover;opacity:0.85;" />`
        : `<span class="glyph">${state.pendingIcon ? categoryIcon(state.pendingIcon, 64) : icon('image', 64)}</span>`}
    </div>
    <div class="card" style="margin-top:18px;">
      <div class="steps" id="steps">
        ${steps.map((label, i) => `
          <div class="step" data-step="${i}">
            <span class="dot">✓</span><span class="t">${label}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * @param {string} [itemId]  Force a catalog item; omit to let the seed decide.
 * @param {object} [options]
 * @param {string[]} [options.photos]  Data URLs of photos the user actually uploaded.
 * @param {string} [options.seed]      Stable seed, normally derived from the photo files.
 */
function startScan(itemId, options = {}) {
  if (!isPro() && scansLeft() === 0) {
    toast('Daily scan limit reached — upgrade for unlimited scans.');
    return;
  }

  const { photos = [], seed = `${itemId}-${Date.now()}` } = options;
  const item = itemId ? getItem(itemId) : null;

  // The category id rather than the drawn icon: this is persisted state, and markup does not
  // belong in localStorage.
  state.pendingIcon = item?.category ?? null;
  pendingPhoto = photos[0] ?? null;
  state.view = 'analysing';
  render();

  // Reveal the analysis steps in sequence, then show the result.
  const steps = [...document.querySelectorAll('.step')];
  steps.forEach((step, i) => setTimeout(() => step.classList.add('on'), 180 + i * 240));

  setTimeout(async () => {
    const photoCount = photos.length || 3;
    let recognition;

    // Real recognition only makes sense against an actual uploaded photo, never the sample
    // gallery or "surprise me" (there's no photo for the model to look at in those cases).
    if (!itemId && photos.length && state.prefs.useVisionAI && visionApiKey) {
      try {
        recognition = await recognizeWithVision({ apiKey: visionApiKey, photos, seed, photoCount });
      } catch (error) {
        toast(`Real AI recognition failed, used the built-in simulator instead — ${error.message}`);
      }
    }

    if (!recognition) {
      recognition = analysePhoto({ seed, itemId: itemId ?? undefined, photoCount });
    }

    if (photos.length) photoStore.set(seed, photos);

    state.current = {
      recognition,
      condition: recognition.condition,
      accessories: recognition.detectedAccessories,
      tier: 'fair',
      photoCount,
      photoKey: seed,
      tone: state.prefs.tone,
      room: categoryOf(recognition.item).room,
    };
    recordScan();
    state.view = 'result';

    if (state.garage.active) {
      const pricing = currentPricing();
      state.garage.scanned.push({
        itemId: recognition.item.id,
        condition: recognition.condition,
        value: pricing.prices.fair,
      });
      state.view = 'garage';
    }

    save();
    render();
  }, 180 + steps.length * 240 + 320);
}

// ---------------------------------------------------------------- result

function currentPricing() {
  const { recognition, condition, accessories } = state.current;
  return priceItem(recognition.item, {
    condition,
    includedAccessories: accessories,
    recognitionConfidence: recognition.confidence,
  });
}

function currentRanking(pricing) {
  const { recognition, condition, tier } = state.current;
  return rankMarketplaces(recognition.item, pricing.prices[tier], {
    condition,
    priority: state.prefs.priority,
    tier,
  });
}

/**
 * Marketplaces the listing will publish to.
 *
 * Defaults to the top-ranked marketplace, and commits that default to state so publishing and
 * the checkbox list can never disagree about what is selected.
 */
function currentTargets(ranked) {
  if (!state.current.targets) {
    state.current.targets = ranked[0] ? [ranked[0].marketplace.id] : [];
  }
  return state.current.targets;
}

function viewResult() {
  const { recognition, condition, accessories, tier } = state.current;
  const item = recognition.item;
  const pricing = currentPricing();
  const ranked = currentRanking(pricing);
  const best = ranked[0];
  const advice = sellOrDonate(item, best);
  const notes = explainPrice(pricing);

  return `
    <div class="row-between" style="margin: 8px 0 14px;">
      <button class="btn btn-quiet btn-sm" data-act="go" data-arg="scan">‹ Back</button>
      <span class="pill ${recognition.simulated === false ? 'pill-emerald' : 'pill-indigo'}">
        ${recognition.simulated === false ? 'AI recognition' : 'Simulated recognition'}
      </span>
    </div>

    ${thumbFor(item, state.current.photoKey, 'thumb-lg')}

    <div style="margin-top:16px;">
      <div class="eyebrow">${esc(item.brand)} · ${esc(categoryOf(item).label)}</div>
      <h1 style="margin-top:4px;">${esc(item.name)}</h1>
    </div>

    <div class="card" style="margin-top:14px;">
      <div class="row-between">
        <span class="tiny">Identification confidence</span>
        <span class="num" style="font-weight:600;">${pct(recognition.confidence)}</span>
      </div>
      <div class="confidence" style="margin-top:8px;"><span style="width:${pct(recognition.confidence)}"></span></div>
      ${recognition.alternates.length ? `
        <div class="tiny" style="margin-top:10px;">
          Not right? It might be
          ${recognition.alternates.map((alt) => `<button class="link" style="background:none;border:none;padding:0;color:var(--indigo);font-weight:600;font-size:12px;" data-act="reidentify" data-arg="${alt.item.id}">${esc(alt.item.name)}</button>`).join(' or ')}.
        </div>
      ` : ''}
    </div>

    <div class="section-head"><h2>Condition</h2><span class="tiny">${pct(recognition.conditionConfidence)} confident</span></div>
    <div class="chip-row">
      ${CONDITIONS.map((c) => `
        <button class="chip" data-act="condition" data-arg="${c.id}" aria-pressed="${c.id === condition}">${c.label}</button>
      `).join('')}
    </div>
    <p class="tiny" style="margin-top:8px;">${esc(getCondition(condition).blurb)}</p>

    ${item.accessories?.length ? `
      <div class="section-head"><h2>What you have</h2></div>
      <div class="card">
        ${item.accessories.map((accessory) => `
          <button class="check" data-act="accessory" data-arg="${esc(accessory)}" aria-checked="${accessories.includes(accessory)}">
            <span class="box">✓</span><span class="grow">${esc(accessory)}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}

    <div class="section-head"><h2>What it is worth</h2>
      <span class="tiny">${pricing.compCount} recent sales</span>
    </div>
    <div class="ladder">
      ${[
        ['quick', 'Quick sale'],
        ['fair', 'Fair market'],
        ['patient', 'Patient seller'],
      ].map(([key, label]) => `
        <button class="tier" data-act="tier" data-arg="${key}" aria-pressed="${tier === key}">
          <div class="v">${money(pricing.prices[key])}</div>
          <div class="k">${label}</div>
        </button>
      `).join('')}
    </div>
    <p class="tiny" style="margin-top:10px;">
      Average sold price ${money(pricing.averageSold)} · pricing confidence ${pct(pricing.confidence)}
      ${pricing.retainedValue ? ` · holds ${pct(pricing.retainedValue)} of its ${money(item.msrp)} retail price` : ''}
    </p>

    ${notes.length ? `
      <div class="card" style="margin-top:12px;">
        <div class="eyebrow" style="margin-bottom:8px;">Why this price</div>
        ${notes.map((note) => `<p class="tiny" style="margin-bottom:6px;">• ${esc(note)}</p>`).join('')}
      </div>
    ` : ''}

    ${best ? profitCard(best, pricing, tier) : `
      <div class="banner banner-amber" style="margin-top:14px;">
        No marketplace can carry this item profitably.
      </div>
    `}

    <div class="banner ${advice.verdict === 'sell' ? 'banner-emerald' : 'banner-amber'}" style="margin-top:14px;">
      <strong>${esc(advice.headline)}.</strong> ${esc(advice.detail)}
    </div>

    ${ranked.length ? `
      <div class="section-head"><h2>Where to sell</h2>
        <span class="link" data-act="cycle-priority">${priorityLabel()}</span>
      </div>
      <div class="card">
        ${ranked.map((entry, i) => `
          <div class="mkt ${i === 0 ? 'top' : ''}">
            <span class="rank">${entry.rank}</span>
            <span class="grow col">
              <span class="row-between">
                <span style="font-weight:600;font-size:14.5px;">${esc(entry.marketplace.name)}</span>
                <span class="num profit" style="font-weight:600;">${money(entry.profit.net, 2)}</span>
              </span>
              <span class="row wrap" style="gap:5px;margin:5px 0 3px;">
                ${entry.badges.map((b) => `<span class="pill ${badgeTone(b)}">${b}</span>`).join('')}
                <span class="pill">~${entry.days} days</span>
              </span>
              <span class="tiny">${esc(entry.why)}</span>
            </span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${depreciationCard(item, condition)}

    ${recognition.photoSuggestions.length ? `
      <div class="section-head"><h2>Improve your photos</h2></div>
      <div class="card">
        ${recognition.photoSuggestions.map((s) => `<p class="tiny" style="margin-bottom:8px;">${icon('camera', 14)} ${esc(s)}</p>`).join('')}
      </div>
    ` : ''}

    <div class="section-head"><h2>Shipping</h2></div>
    <div class="card">
      ${packingTips(item).map((tip) => `<p class="tiny" style="margin-bottom:8px;">${icon('box', 14)} ${esc(tip)}</p>`).join('')}
    </div>

    <div class="stack" style="margin-top:20px;">
      <button class="btn btn-block" data-act="create-listing">Sell Now →</button>
      <button class="btn btn-ghost btn-block" data-act="save-item">Save to inventory</button>
      <button class="btn btn-quiet btn-block" data-act="go" data-arg="chat">Ask about this item</button>
    </div>
  `;
}

/** Hold-or-sell timing, driven by the depreciation model. */
function depreciationCard(item, condition, receipt = state.receipt) {
  const analysis = analyseDepreciation({
    item,
    condition,
    purchasePrice: receipt?.itemId === item.id ? receipt.price : undefined,
    purchaseDate: receipt?.itemId === item.id ? receipt.date : undefined,
  });

  const { recommendation: rec, appreciating } = analysis;
  const tone = rec.verdict === 'sell-now' ? 'banner-amber' : appreciating ? 'banner-emerald' : 'banner-indigo';

  return `
    <div class="section-head"><h2>Hold or sell?</h2>
      <span class="link" data-act="receipt" data-arg="${item.id}">${analysis.known ? 'Edit receipt' : 'Add receipt'}</span>
    </div>
    <div class="card">
      <div class="stat-grid">
        <div class="stat">
          <div class="v">${money(analysis.inSixMonths)}</div>
          <div class="k">Worth in 6 months</div>
        </div>
        <div class="stat">
          <div class="v ${appreciating ? 'profit' : 'loss'}">${appreciating ? '+' : '−'}${money(Math.abs(analysis.monthlyChange), 2)}</div>
          <div class="k">Per month ${appreciating ? 'gained' : 'lost'}</div>
        </div>
      </div>

      ${analysis.known ? `
        <div class="divider"></div>
        <div class="ledger">
          <div class="line"><span>Paid ${esc(analysis.purchaseDate)}</span><span class="num">${money(analysis.purchasePrice)}</span></div>
          <div class="line"><span>Worth today after ${analysis.ageYears} years</span><span class="num">${money(analysis.current)}</span></div>
          <div class="line"><span>Value lost</span><span class="num loss">−${money(analysis.lost)}</span></div>
          <div class="line"><span>Cost of ownership</span><span class="num">${money(analysis.costPerMonth, 2)}/month</span></div>
        </div>
        ${analysis.inWarranty ? '<p class="tiny" style="margin-top:8px;">Likely still under manufacturer warranty — say so in the listing, it is worth real money to a buyer.</p>' : ''}
      ` : ''}

      <div class="banner ${tone}" style="margin-top:14px;">
        <strong>${esc(rec.headline)}.</strong> ${esc(rec.detail)}
      </div>
    </div>
  `;
}

function badgeTone(badge) {
  if (badge === 'Highest profit') return 'pill-emerald';
  if (badge === 'Fastest sale') return 'pill-indigo';
  return '';
}

function priorityLabel() {
  return { balanced: 'Balanced ⇄', profit: 'Most profit ⇄', speed: 'Fastest ⇄' }[state.prefs.priority];
}

/** The fee-by-fee breakdown from asking price down to net profit. */
function profitCard(entry, pricing, tier) {
  const { profit } = entry;
  const lines = [
    [`Sale price on ${entry.marketplace.name}`, profit.price],
    ['Marketplace fee', -profit.fee],
  ];
  if (profit.shippingCost) lines.push(['Shipping', -profit.shippingCost]);
  if (profit.packaging) lines.push(['Packaging', -profit.packaging]);

  return `
    <div class="card" style="margin-top:14px;">
      <div class="eyebrow" style="margin-bottom:10px;">Your profit at the ${tier} price</div>
      <div class="ledger">
        ${lines.map(([label, value]) => `
          <div class="line">
            <span>${esc(label)}</span>
            <span class="num ${value < 0 ? 'loss' : ''}">${value < 0 ? '−' : ''}${money(Math.abs(value), 2)}</span>
          </div>
        `).join('')}
        <div class="line total">
          <span>Estimated profit</span>
          <span class="num profit">${money(profit.net, 2)}</span>
        </div>
      </div>
      ${profit.realization < 0.99 ? `
        <p class="tiny" style="margin-top:10px;">
          You would ask ${money(profit.askPrice)}, but buyers here typically settle around
          ${money(profit.price)} — that is already reflected above.
        </p>` : ''}
    </div>
  `;
}

// ---------------------------------------------------------------- listing

function viewListing() {
  const { recognition, condition, accessories, tier, tone, photoCount } = state.current;
  const item = recognition.item;
  const pricing = currentPricing();
  const price = pricing.prices[tier];
  const ranked = currentRanking(pricing);
  const best = ranked[0];

  const listing = generateListing({
    item,
    condition,
    price,
    includedAccessories: accessories,
    tone,
    marketplace: best?.marketplace,
  });

  const quality = scoreListing({
    listing,
    item,
    price,
    pricing,
    photoCount,
    includedAccessories: accessories,
  });

  const targets = currentTargets(ranked);
  const available = eligibleMarketplaces(item, condition);

  return `
    <div class="row-between" style="margin: 8px 0 14px;">
      <button class="btn btn-quiet btn-sm" data-act="go" data-arg="result">‹ Back</button>
      <span class="pill pill-indigo">AI generated</span>
    </div>

    <h1>Your listing</h1>
    <p class="sub" style="margin-top:4px;">Review it, adjust the tone, then publish everywhere at once.</p>

    <div class="card" style="margin-top:16px;">
      <div class="row">
        <div class="score-ring" style="background: conic-gradient(var(--indigo) ${quality.overall * 3.6}deg, var(--line-soft) 0);">
          <div style="width:66px;height:66px;border-radius:50%;background:var(--card);display:grid;place-items:center;">
            <span class="v">${quality.overall}</span>
          </div>
        </div>
        <div class="grow col">
          <span style="font-weight:600;font-size:16px;">${quality.grade}</span>
          <span class="tiny">Listing quality score out of 100</span>
        </div>
      </div>
      <div class="divider"></div>
      ${Object.entries(quality.parts).map(([key, part]) => `
        <div style="margin-bottom:10px;">
          <div class="row-between" style="margin-bottom:4px;">
            <span class="tiny" style="text-transform:capitalize;font-weight:600;color:var(--ink-2);">${key}</span>
            <span class="tiny">${esc(part.label)}</span>
          </div>
          <div class="meter"><span style="width:${part.score}%"></span></div>
        </div>
      `).join('')}
      ${quality.suggestions.length ? `
        <div class="divider"></div>
        <div class="eyebrow" style="margin-bottom:8px;">Biggest wins</div>
        ${quality.suggestions.slice(0, 3).map((s) => `
          <p class="tiny" style="margin-bottom:7px;">↑ +${s.gain} — ${esc(s.suggestion)}</p>
        `).join('')}
      ` : ''}
    </div>

    <div class="section-head"><h2>Photos</h2>
      <span class="tiny">${photoCount} attached</span>
    </div>
    <div class="card card-tight">
      <div class="row-between">
        <span class="tiny">Six or more photos is where listings stop losing buyers.</span>
        <span class="row" style="gap:8px;">
          <button class="btn btn-quiet btn-sm" data-act="photo-count" data-arg="-1"
            ${photoCount <= 1 ? 'disabled' : ''} aria-label="Remove a photo">−</button>
          <span class="num" style="font-weight:600;min-width:18px;text-align:center;">${photoCount}</span>
          <button class="btn btn-ghost btn-sm" data-act="photo-count" data-arg="1"
            ${photoCount >= 10 ? 'disabled' : ''} aria-label="Add a photo">+</button>
        </span>
      </div>
    </div>

    <div class="section-head"><h2>Tone</h2></div>
    <div class="chip-row">
      ${TONES.map((t) => `
        <button class="chip" data-act="tone" data-arg="${t.id}" aria-pressed="${t.id === tone}">${t.label}</button>
      `).join('')}
    </div>

    <div class="section-head"><h2>Title</h2><span class="tiny">${listing.title.length}/80</span></div>
    <div class="card card-tight"><p style="font-size:14.5px;font-weight:600;line-height:1.5;">${esc(listing.title)}</p></div>

    <div class="section-head"><h2>Description</h2>
      <span class="link" data-act="copy-listing">Copy</span>
    </div>
    <div class="listing-box">${esc(listing.description)}</div>

    <div class="section-head"><h2>Keywords</h2></div>
    <div class="card card-tight">
      <div class="row wrap" style="gap:6px;">
        ${listing.keywords.map((k) => `<span class="pill">${esc(k)}</span>`).join('')}
      </div>
      <div class="divider"></div>
      <div class="row wrap" style="gap:6px;">
        ${listing.hashtags.map((h) => `<span class="pill pill-indigo">${esc(h)}</span>`).join('')}
      </div>
    </div>

    <div class="section-head"><h2>Item specifics</h2></div>
    <div class="card">
      ${Object.entries(listing.specifics).map(([key, value]) => `
        <div class="row-between" style="padding:7px 0;border-bottom:1px solid var(--line-soft);">
          <span class="tiny" style="font-weight:600;color:var(--ink-2);">${esc(key)}</span>
          <span class="tiny">${esc(value)}</span>
        </div>
      `).join('')}
    </div>

    <div class="section-head"><h2>Publish to</h2>
      ${isPro() ? '' : '<span class="pill pill-amber">Pro: cross-posting</span>'}
    </div>
    <div class="card">
      ${available.map((marketplace) => {
        const entry = ranked.find((r) => r.marketplace.id === marketplace.id);
        const selected = targets.includes(marketplace.id);
        const locked = !isPro() && targets.length >= 1 && !selected;
        return `
          <button class="check" data-act="target" data-arg="${marketplace.id}"
            aria-checked="${selected}" ${locked ? 'disabled style="opacity:0.4;"' : ''}>
            <span class="box">✓</span>
            <span class="grow col">
              <span style="font-weight:600;">${esc(marketplace.name)}</span>
              <span class="tiny">${entry ? `${money(entry.profit.net, 2)} net · ~${entry.days} days` : marketplace.feeLabel}</span>
            </span>
          </button>
        `;
      }).join('')}
    </div>

    <div class="stack" style="margin-top:20px;">
      <button class="btn btn-emerald btn-block" data-act="publish" ${targets.length ? '' : 'disabled'}>
        Publish to ${targets.length} marketplace${targets.length === 1 ? '' : 's'}
      </button>
      <button class="btn btn-ghost btn-block" data-act="save-item">Save as draft</button>
    </div>
  `;
}

// ---------------------------------------------------------------- inventory

function viewInventory() {
  const filter = state.invFilter ?? 'all';
  const entries = state.inventory
    .map(inventoryEntry)
    .filter((e) => (filter === 'all' ? true : e.status === filter))
    .sort((a, b) => b.date - a.date);

  const totalValue = state.inventory
    .filter((e) => e.status !== 'sold')
    .map(inventoryEntry)
    .reduce((sum, e) => sum + e.pricing.prices.fair, 0);

  const selection = state.selection ?? [];

  return `
    <div class="row-between" style="margin: 8px 0 14px;">
      <div><h1>Inventory</h1><p class="sub">${money(totalValue)} unsold across ${state.inventory.length} items</p></div>
      ${selection.length >= 2
        ? `<button class="btn btn-sm" data-act="go" data-arg="bundle">Bundle ${selection.length}</button>`
        : `<button class="btn btn-quiet btn-sm" data-act="export-csv" ${state.inventory.length ? '' : 'disabled'}>Export</button>`}
    </div>

    <div class="chip-row">
      ${[['all', 'All'], ['scanned', 'Not listed'], ['listed', 'Listed'], ['sold', 'Sold']].map(([id, label]) => `
        <button class="chip" data-act="inv-filter" data-arg="${id}" aria-pressed="${filter === id}">${label}</button>
      `).join('')}
    </div>

    ${entries.length ? `
      <div class="card" style="margin-top:14px;">
        ${entries.map((entry) => `
          <div class="item-row">
            <button class="check" style="width:auto;padding:0;" data-act="select" data-arg="${entry.uid}"
              aria-checked="${selection.includes(entry.uid)}" aria-label="Select for bundling">
              <span class="box">✓</span>
            </button>
            <button class="item-row" style="border:none;padding:0;flex:1;" data-act="open-item" data-arg="${entry.uid}">
              ${thumbFor(entry.item, entry.uid)}
              <span class="grow col">
                <span class="name truncate">${esc(entry.item.name)}</span>
                <span class="tiny">${statusLabel(entry)}</span>
              </span>
              <span class="col" style="text-align:right;">
                <span class="num" style="font-weight:600;">${money(entry.soldFor ?? entry.pricing.prices.fair)}</span>
                <span class="tiny">${esc(getCondition(entry.condition).label)}</span>
              </span>
            </button>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="empty"><span class="g">${icon('box', 34)}</span>Nothing here yet. Scan something to start building your inventory.</div>
    `}

    <div style="margin-top:18px;">
      <button class="btn btn-ghost btn-block" data-act="go" data-arg="scan">Scan another item</button>
    </div>
  `;
}

function viewBundle() {
  const selected = state.selection
    .map((uid) => state.inventory.find((e) => e.uid === uid))
    .filter(Boolean)
    .map((entry) => ({ item: getItem(entry.itemId), condition: entry.condition }));

  const analysis = analyseBundle(selected);

  if (!analysis.viable) {
    return `
      <button class="btn btn-quiet btn-sm" data-act="go" data-arg="inventory">‹ Back</button>
      <div class="empty"><span class="g">${icon('gift', 34)}</span>${esc(analysis.reason)}</div>
    `;
  }

  const wins = analysis.recommendation === 'bundle';

  return `
    <div class="row-between" style="margin: 8px 0 14px;">
      <button class="btn btn-quiet btn-sm" data-act="go" data-arg="inventory">‹ Back</button>
      <span class="pill pill-indigo">${selected.length} items</span>
    </div>

    <h1>Bundle builder</h1>
    <p class="sub" style="margin-top:4px;">Sell these together, or one at a time?</p>

    <div class="banner ${wins ? 'banner-emerald' : 'banner-indigo'}" style="margin-top:16px;">
      <strong>${wins ? 'Bundle them' : 'Sell separately'}.</strong> ${esc(analysis.rationale)}
    </div>

    <div class="stat-grid" style="margin-top:14px;">
      <div class="stat" ${wins ? '' : 'style="border-color:var(--indigo);"'}>
        <div class="v">${money(analysis.separate.net)}</div>
        <div class="k">Separately, net</div>
        <div class="k">${analysis.separate.listings} listings · ~${analysis.separate.days} days</div>
      </div>
      <div class="stat" ${wins ? 'style="border-color:var(--emerald);"' : ''}>
        <div class="v">${money(analysis.bundle.net)}</div>
        <div class="k">As a bundle, net</div>
        <div class="k">1 listing · ~${analysis.bundle.days} days</div>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <div class="eyebrow" style="margin-bottom:10px;">Suggested bundle</div>
      <div class="row-between">
        <span style="font-weight:600;">${esc(analysis.bundle.title)}</span>
        <span class="num" style="font-weight:600;">${money(analysis.bundle.price)}</span>
      </div>
      <div class="divider"></div>
      ${analysis.items.map((entry) => `
        <div class="row" style="padding:7px 0;">
          <span class="thumb thumb-sm">${glyphOf(entry.item, 17)}</span>
          <span class="grow tiny truncate" style="color:var(--ink-2);font-weight:600;">${esc(entry.item.name)}</span>
          <span class="num tiny">${money(entry.fair)}</span>
        </div>
      `).join('')}
      <div class="divider"></div>
      <p class="tiny">Bundle discount ${pct(analysis.discount)} · these items are ${pct(analysis.cohesion)} related${analysis.bundle.marketplace ? ` · best on ${esc(analysis.bundle.marketplace.name)}` : ''}</p>
    </div>

    <div class="stack" style="margin-top:18px;">
      <button class="btn btn-block" data-act="clear-selection">Done</button>
    </div>
  `;
}

// ---------------------------------------------------------------- garage sale mode

function viewGarage() {
  const scanned = state.garage.scanned ?? [];
  const total = scanned.reduce((sum, s) => sum + s.value, 0);

  return `
    <div class="row-between" style="margin: 8px 0 10px;">
      <div><h1>Garage Sale Mode</h1><p class="sub">Walk around. Scan everything. Watch it add up.</p></div>
      <button class="btn btn-quiet btn-sm" data-act="go" data-arg="home">Exit</button>
    </div>

    <div class="garage-total">
      <div class="eyebrow">Estimated cash in this room</div>
      <div class="v">${money(total)}</div>
      <div class="tiny">${scanned.length} item${scanned.length === 1 ? '' : 's'} scanned</div>
    </div>

    <button class="btn btn-block" data-act="garage-scan">${icon('camera', 18)} Scan next item</button>

    ${scanned.length ? `
      <div class="section-head"><h2>Scanned</h2>
        <span class="link" data-act="garage-save">Save all to inventory</span>
      </div>
      <div class="card">
        ${[...scanned].reverse().map((s) => {
          const item = getItem(s.itemId);
          return `
            <div class="item-row">
              <span class="thumb">${glyphOf(item)}</span>
              <span class="grow col">
                <span class="name truncate">${esc(item.name)}</span>
                <span class="tiny">${esc(getCondition(s.condition).label)}</span>
              </span>
              <span class="num profit" style="font-weight:600;">${money(s.value)}</span>
            </div>
          `;
        }).join('')}
      </div>
    ` : `
      <div class="empty"><span class="g">${icon('cart', 34)}</span>Nothing scanned yet. Point at the first thing you see.</div>
    `}
  `;
}

// ---------------------------------------------------------------- analytics

function viewAnalytics() {
  const sold = state.inventory.filter((e) => e.status === 'sold');
  const revenue = sold.reduce((sum, e) => sum + (e.soldFor ?? 0), 0);

  const profit = sold.reduce((sum, entry) => {
    const enriched = inventoryEntry(entry);
    const ranked = rankMarketplaces(enriched.item, entry.soldFor ?? 0, { condition: entry.condition });
    return sum + (ranked[0]?.profit.net ?? 0);
  }, 0);

  const unsold = state.inventory.filter((e) => e.status !== 'sold').map(inventoryEntry);
  const inventoryValue = unsold.reduce((sum, e) => sum + e.pricing.prices.fair, 0);
  const avgSale = sold.length ? revenue / sold.length : 0;

  const byCategory = {};
  for (const entry of state.inventory.map(inventoryEntry)) {
    const key = categoryOf(entry.item).label;
    byCategory[key] = (byCategory[key] ?? 0) + (entry.soldFor ?? entry.pricing.prices.fair);
  }
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCategory = categories.length ? categories[0][1] : 1;

  // Seasonality outlook for whatever the user holds most of.
  const focus = unsold[0]?.item;
  const curve = focus ? seasonalityCurve(focus.category) : null;
  const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  return `
    <div style="margin: 8px 0 16px;"><h1>Analytics</h1><p class="sub">What you have earned, and what is still sitting there.</p></div>

    <div class="stat-grid">
      <div class="stat"><div class="v profit">${money(revenue)}</div><div class="k">Lifetime revenue</div></div>
      <div class="stat"><div class="v">${money(profit)}</div><div class="k">Net profit</div></div>
      <div class="stat"><div class="v">${money(inventoryValue)}</div><div class="k">Inventory value</div></div>
      <div class="stat"><div class="v">${money(avgSale)}</div><div class="k">Average sale</div></div>
    </div>

    <div class="section-head"><h2>Value by category</h2></div>
    <div class="card">
      ${categories.map(([label, value]) => `
        <div class="room">
          <div class="row-between">
            <span style="font-size:14px;font-weight:600;">${esc(label)}</span>
            <span class="num" style="font-size:14px;font-weight:600;">${money(value)}</span>
          </div>
          <div class="bar"><span style="width:${Math.max(4, (value / maxCategory) * 100)}%"></span></div>
        </div>
      `).join('')}
    </div>

    ${curve ? `
      <div class="section-head"><h2>Best months to sell</h2></div>
      <div class="card">
        <p class="tiny" style="margin-bottom:12px;">Seasonal demand for ${esc(categoryOf(focus).label.toLowerCase())}, the category you hold most of.</p>
        <div class="chart">
          ${curve.map((value, i) => {
            const height = ((value - 0.85) / 0.4) * 100;
            const now = i === new Date().getMonth();
            return `<div class="col-b">
              <div class="b" style="height:${Math.max(6, Math.min(100, height))}%;${now ? 'background:linear-gradient(180deg,var(--emerald),#34d399);' : ''}"></div>
              <div class="l" ${now ? 'style="color:var(--emerald);font-weight:600;"' : ''}>${months[i]}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    ` : ''}

    <div class="section-head"><h2>Waiting to sell</h2></div>
    <div class="card">
      ${unsold.length ? unsold.slice(0, 5).map((entry) => {
        const ranked = rankMarketplaces(entry.item, entry.pricing.prices.fair, { condition: entry.condition });
        const days = ranked[0] ? expectedDays(ranked[0].marketplace, entry.item, 'fair') : null;
        return `
          <div class="item-row">
            <span class="thumb">${glyphOf(entry.item)}</span>
            <span class="grow col">
              <span class="name truncate">${esc(entry.item.name)}</span>
              <span class="tiny">${days ? `Typically sells in ~${days} days` : 'No marketplace fit'}</span>
            </span>
            <span class="num" style="font-weight:600;">${money(entry.pricing.prices.fair)}</span>
          </div>
        `;
      }).join('') : '<p class="tiny">Everything is sold. Time to scan more.</p>'}
    </div>
  `;
}

// ---------------------------------------------------------------- profile

function viewProfile() {
  const sold = state.inventory.filter((e) => e.status === 'sold');
  const earned = sold.reduce((sum, e) => sum + (e.soldFor ?? 0), 0);

  const achievements = [
    { id: 'first', label: 'First Sale', glyph: 'spark', done: sold.length >= 1 },
    { id: 'thousand', label: '$1,000 Earned', glyph: 'trophy', done: earned >= 1000 },
    { id: 'hundred', label: '100 Items Sold', glyph: 'check', done: sold.length >= 100 },
    { id: 'garage', label: 'Garage Cleared', glyph: 'cart', done: (state.garage.scanned?.length ?? 0) >= 5 },
    { id: 'closet', label: 'Closet Champion', glyph: 'apparel', done: state.inventory.filter((e) => e.room === 'Closet').length >= 3 },
    { id: 'power', label: 'Power Seller', glyph: 'spark', done: sold.length >= 25 },
  ];

  return `
    <div style="margin: 8px 0 16px;"><h1>Profile</h1></div>

    <div class="card">
      <div class="row">
        <span class="thumb" style="background:linear-gradient(145deg,var(--indigo),#7c3aed);color:#fff;">JP</span>
        <span class="grow col">
          <span style="font-weight:600;font-size:16px;">Josiah Placide</span>
          <span class="tiny">${isPro() ? 'ResellAI Pro' : 'Free plan'} · ${sold.length} items sold</span>
        </span>
      </div>
    </div>

    ${isPro() ? `
      <div class="banner banner-emerald" style="margin-top:12px;">
        <strong>Pro is active.</strong> Unlimited scans, cross-posting, price alerts, and the background remover.
      </div>
    ` : `
      <div class="card" style="margin-top:12px;background:linear-gradient(150deg,var(--indigo),#7c3aed);color:#fff;border:none;">
        <div class="eyebrow" style="color:rgba(255,255,255,0.8);">Upgrade</div>
        <h2 style="margin:6px 0;">ResellAI Pro — $9.99/mo</h2>
        <p style="font-size:13.5px;color:rgba(255,255,255,0.9);margin-bottom:14px;">
          Unlimited scans, cross-posting to every marketplace, the background remover, price alerts,
          and the AI negotiation assistant.
        </p>
        <button class="btn btn-block" style="background:#fff;color:var(--indigo);" data-act="upgrade">Upgrade to Pro</button>
        <p class="tiny" style="color:rgba(255,255,255,0.75);margin-top:10px;">
          You have used ${state.scansToday} of ${FREE_SCAN_LIMIT} free scans today.
        </p>
      </div>
    `}

    <div class="section-head"><h2>Achievements</h2></div>
    <div class="card">
      <div class="row wrap" style="gap:10px;">
        ${achievements.map((a) => `
          <div class="col" style="align-items:center;width:calc(33.33% - 7px);opacity:${a.done ? 1 : 0.35};">
            <span class="ach-icon">${icon(a.glyph, 24)}</span>
            <span class="tiny" style="text-align:center;font-weight:600;">${a.label}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section-head"><h2>Preferences</h2></div>
    <div class="card">
      <div class="row-between" style="padding:9px 0;">
        <span class="col"><span style="font-weight:600;font-size:14.5px;">Dark mode</span><span class="tiny">Charcoal theme</span></span>
        <button class="switch" data-act="theme" aria-checked="${isDark()}" role="switch" aria-label="Dark mode"></button>
      </div>
      <div class="divider"></div>
      <div class="row-between" style="padding:9px 0;">
        <span class="col"><span style="font-weight:600;font-size:14.5px;">Notifications</span><span class="tiny">Price alerts and listing views</span></span>
        <button class="switch" data-act="notifications" aria-checked="${state.prefs.notifications}" role="switch" aria-label="Notifications"></button>
      </div>
      <div class="divider"></div>
      <div class="col" style="gap:8px;padding:9px 0;">
        <span style="font-weight:600;font-size:14.5px;">Marketplace priority</span>
        <div class="row" style="gap:8px;">
          ${[['balanced', 'Balanced'], ['profit', 'Most profit'], ['speed', 'Fastest']].map(([id, label]) => `
            <button class="chip" data-act="priority" data-arg="${id}" aria-pressed="${state.prefs.priority === id}">${label}</button>
          `).join('')}
        </div>
      </div>
      <div class="divider"></div>
      <div class="col" style="gap:8px;padding:9px 0;">
        <span style="font-weight:600;font-size:14.5px;">Default listing tone</span>
        <div class="row wrap" style="gap:8px;">
          ${TONES.map((t) => `
            <button class="chip" data-act="default-tone" data-arg="${t.id}" aria-pressed="${state.prefs.tone === t.id}">${t.label}</button>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="section-head"><h2>AI recognition</h2></div>
    <div class="card">
      <div class="row-between" style="padding:9px 0;">
        <span class="col">
          <span style="font-weight:600;font-size:14.5px;">Use real AI recognition</span>
          <span class="tiny">Sends your photo to Claude instead of the built-in simulator</span>
        </span>
        <button class="switch" data-act="toggle-vision-ai" aria-checked="${state.prefs.useVisionAI}" role="switch" aria-label="Use real AI recognition"></button>
      </div>
      ${state.prefs.useVisionAI ? `
        <div class="divider"></div>
        <div class="col" style="gap:8px;padding:9px 0;">
          <span class="tiny">
            Bring your own Anthropic API key. It is sent directly from this browser to Anthropic's
            API and kept only in this tab's session storage — never saved to disk or synced across
            devices. Anyone with access to this browser tab could read it, so don't use a
            production key.
          </span>
          <div class="row" style="gap:8px;">
            <input type="password" id="vision-api-key" class="grow" placeholder="sk-ant-..." autocomplete="off" />
            <button class="btn btn-sm" data-act="save-vision-key">Save</button>
          </div>
          <span class="tiny">
            ${visionApiKey ? 'Key saved for this tab.' : 'No key set — scans fall back to simulated recognition.'}
            ${visionApiKey ? '<button class="link" data-act="clear-vision-key" style="margin-left:8px;">Remove</button>' : ''}
          </span>
        </div>
      ` : ''}
    </div>

    <div class="section-head"><h2>About this prototype</h2></div>
    <div class="banner banner-indigo">
      Item recognition is simulated by default — there is no vision model behind the camera unless
      you turn on real AI recognition above with your own API key. Everything downstream is real:
      pricing, fees, shipping, marketplace ranking, and listing copy are all computed by the
      engines in <code>src/engine/</code>, which are covered by unit tests.
    </div>

    <div style="margin-top:14px;">
      <button class="btn btn-quiet btn-block" data-act="reset">Reset prototype data</button>
    </div>
  `;
}

// ---------------------------------------------------------------- chat

const QUICK_QUESTIONS = [
  'Is this worth selling?',
  'Should I wait?',
  'Which platform pays the most?',
  'What should I price this at?',
  'How much is in my house?',
];

function viewChat() {
  return `
    <div class="row-between" style="margin: 8px 0 14px;">
      <div><h1>Assistant</h1><p class="sub">Ask anything about what you own.</p></div>
      <button class="btn btn-quiet btn-sm" data-act="go" data-arg="home">Close</button>
    </div>

    <div class="col" style="gap:10px;min-height:200px;">
      ${state.chat.length ? state.chat.map((msg) => `
        <div class="bubble ${msg.role}">${esc(msg.text)}</div>
      `).join('') : `
        <div class="bubble ai">Ask me what something is worth, when to sell it, or where it will net you the most.</div>
      `}
    </div>

    <div class="section-head"><h2>Try asking</h2></div>
    <div class="col" style="gap:8px;">
      ${QUICK_QUESTIONS.map((q) => `
        <button class="chip" style="text-align:left;white-space:normal;" data-act="ask" data-arg="${esc(q)}">${esc(q)}</button>
      `).join('')}
    </div>
  `;
}

/** Answers are derived from the same engines the rest of the app uses. */
function answer(question) {
  const q = question.toLowerCase();
  const current = state.current;

  if (q.includes('house') || q.includes('total')) {
    const active = state.inventory.filter((e) => e.status !== 'sold').map(inventoryEntry);
    const total = active.reduce((sum, e) => sum + e.pricing.prices.fair, 0);
    const best = [...active].sort((a, b) => b.pricing.prices.fair - a.pricing.prices.fair)[0];
    return `You have about ${money(total)} of unsold value across ${active.length} scanned items.${
      best ? ` The most valuable is your ${best.item.name} at roughly ${money(best.pricing.prices.fair)}.` : ''
    } Most people find far more once they scan a full room — try Garage Sale Mode.`;
  }

  if (!current) {
    return 'Scan an item first and I can tell you what it is worth, where to sell it, and whether it is worth the effort at all.';
  }

  const item = current.recognition.item;
  const pricing = currentPricing();
  const ranked = currentRanking(pricing);
  const best = ranked[0];

  if (q.includes('worth selling') || q.includes('worth it') || q.includes('donate')) {
    const advice = sellOrDonate(item, best);
    return `${advice.headline}. ${advice.detail}`;
  }

  if (q.includes('wait') || q.includes('when')) {
    const curve = seasonalityCurve(item.category);
    const month = new Date().getMonth();
    const peak = curve.indexOf(Math.max(...curve));
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (peak === month) return `Now is the peak. ${categoryOf(item).label} demand is at its yearly high this month, so list it today.`;
    const upside = Math.round((curve[peak] / curve[month] - 1) * 100);
    return upside > 5
      ? `Holding until ${names[peak]} is worth about ${upside}% more, roughly ${money(pricing.prices.fair * (curve[peak] / curve[month]) - pricing.prices.fair)} on this item. Whether that beats having the cash now is your call.`
      : `There is no meaningful seasonal upside — ${names[peak]} is only about ${upside}% better. List it now.`;
  }

  if (q.includes('platform') || q.includes('where') || q.includes('marketplace')) {
    if (!best) return 'No marketplace can carry this item profitably. Donating it is the honest answer.';
    const runnerUp = ranked[1];
    return `${best.why}${runnerUp ? ` Second choice is ${runnerUp.marketplace.name} at ${money(runnerUp.profit.net, 2)} net.` : ''}`;
  }

  if (q.includes('price') || q.includes('much')) {
    return `Recent sold prices average ${money(pricing.averageSold)}. In ${getCondition(current.condition).label.toLowerCase()} condition, ask ${money(pricing.prices.fair)} for a normal sale, ${money(pricing.prices.quick)} if you want it gone this week, or ${money(pricing.prices.patient)} if you can wait. Confidence is ${pct(pricing.confidence)} based on ${pricing.compCount} comparable sales.`;
  }

  if (q.includes('bundle')) {
    return 'Select two or more items in your inventory and open the bundle builder — it compares the total you would net separately against a single bundled listing, including how much sooner the bundle sells.';
  }

  return `Here is what I know about your ${item.name}: it is worth about ${money(pricing.prices.fair)} in ${getCondition(current.condition).label.toLowerCase()} condition${best ? `, and ${best.marketplace.name} nets you the most at ${money(best.profit.net, 2)}` : ''}. Ask me about pricing, timing, or where to sell.`;
}

// ---------------------------------------------------------------- actions

const actions = {
  go(arg) {
    if (arg === 'garage') state.garage.active = true;
    else if (state.view === 'garage') state.garage.active = false;
    state.view = arg;
    render();
  },

  scan(arg) { startScan(arg); },

  'scan-random'() {
    startScan(CATALOG[Math.floor(Math.random() * CATALOG.length)].id);
  },

  camera() {
    // Checked before opening the device rather than after, so a gated user is not asked for
    // camera permission only to be told the scan is not allowed.
    if (!isPro() && scansLeft() === 0) {
      toast('Daily scan limit reached — upgrade for unlimited scans.');
      return;
    }
    state.view = 'camera';
    render();
  },

  capture() {
    const video = $('#camera-feed');
    if (!video || !cameraStream) return;

    let photo;
    try {
      photo = captureFrame(video);
    } catch (error) {
      toast(error.message);
      return;
    }

    // startScan renders the analysing view, and render() releases the camera on the way out.
    startScan(undefined, { photos: [photo], seed: `camera-${Date.now()}` });
  },

  'garage-scan'() {
    state.garage.active = true;
    startScan(CATALOG[Math.floor(Math.random() * CATALOG.length)].id);
  },

  'garage-save'() {
    const scanned = state.garage.scanned ?? [];
    if (!scanned.length) return;

    for (const entry of scanned) {
      const item = getItem(entry.itemId);
      state.inventory.push({
        uid: `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        itemId: entry.itemId,
        condition: entry.condition,
        accessories: item.accessories ?? [],
        price: entry.value,
        status: 'scanned',
        soldFor: null,
        room: categoryOf(item).room,
        listedOn: [],
        date: Date.now(),
      });
    }

    toast(`${scanned.length} items saved to inventory`);
    state.garage = { active: false, scanned: [] };
    state.view = 'inventory';
    save();
    render();
  },

  condition(arg) { state.current.condition = arg; render(); },

  accessory(arg) {
    const list = state.current.accessories;
    const index = list.indexOf(arg);
    if (index >= 0) list.splice(index, 1);
    else list.push(arg);
    render();
  },

  tier(arg) { state.current.tier = arg; render(); },

  tone(arg) { state.current.tone = arg; render(); },

  'photo-count'(arg) {
    const next = state.current.photoCount + Number(arg);
    state.current.photoCount = Math.min(10, Math.max(1, next));
    render();
  },

  reidentify(arg) {
    const recognition = analysePhoto({ seed: `${arg}-${Date.now()}`, itemId: arg, photoCount: 3 });
    state.current = {
      ...state.current,
      recognition,
      condition: recognition.condition,
      accessories: recognition.detectedAccessories,
      room: categoryOf(recognition.item).room,
    };
    toast('Updated — thanks, that improves future recognition.');
    render();
  },

  'cycle-priority'() {
    const order = ['balanced', 'profit', 'speed'];
    state.prefs.priority = order[(order.indexOf(state.prefs.priority) + 1) % order.length];
    save();
    render();
  },

  'create-listing'() {
    state.current.targets = undefined;
    state.view = 'listing';
    render();
  },

  target(arg) {
    const targets = state.current.targets ?? [];
    const index = targets.indexOf(arg);

    if (index >= 0) targets.splice(index, 1);
    else if (!isPro() && targets.length >= 1) {
      toast('Cross-posting to several marketplaces is a Pro feature.');
      return;
    } else targets.push(arg);

    state.current.targets = targets;
    render();
  },

  'copy-listing'() {
    const { recognition, condition, accessories, tier, tone } = state.current;
    const pricing = currentPricing();
    const listing = generateListing({
      item: recognition.item,
      condition,
      price: pricing.prices[tier],
      includedAccessories: accessories,
      tone,
    });

    navigator.clipboard?.writeText(`${listing.title}\n\n${listing.description}`).then(
      () => toast('Listing copied to your clipboard'),
      () => toast('Could not access the clipboard'),
    );
  },

  publish() {
    const targets = state.current.targets ?? [];
    if (!targets.length) {
      toast('Pick at least one marketplace to publish to.');
      return;
    }

    saveCurrent('listed', targets);
    const names = targets.map((id) => getMarketplace(id)?.name ?? id).join(', ');
    toast(`Published to ${names}`);
    state.view = 'inventory';
    save();
    render();
  },

  'save-item'() {
    saveCurrent('scanned', []);
    toast('Saved to inventory');
    state.view = 'inventory';
    save();
    render();
  },

  'open-item'(arg) {
    const entry = state.inventory.find((e) => e.uid === arg);
    if (!entry) return;
    openSheet(entry);
  },

  select(arg) {
    const selection = state.selection ?? [];
    const index = selection.indexOf(arg);
    if (index >= 0) selection.splice(index, 1);
    else selection.push(arg);
    state.selection = selection;
    render();
  },

  'clear-selection'() {
    state.selection = [];
    state.view = 'inventory';
    render();
  },

  'inv-filter'(arg) { state.invFilter = arg; render(); },

  'mark-sold'(arg) {
    const entry = state.inventory.find((e) => e.uid === arg);
    if (!entry) return;
    const enriched = inventoryEntry(entry);
    entry.status = 'sold';
    entry.soldFor = enriched.pricing.prices.fair;
    closeSheet();
    toast(`Marked sold for ${money(entry.soldFor)}`);
    save();
    render();
  },

  'archive-item'(arg) {
    state.inventory = state.inventory.filter((e) => e.uid !== arg);
    state.selection = (state.selection ?? []).filter((uid) => uid !== arg);
    closeSheet();
    toast('Removed from inventory');
    save();
    render();
  },

  theme() {
    state.theme = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    save();
    render();
  },

  notifications() {
    state.prefs.notifications = !state.prefs.notifications;
    save();
    render();
  },

  priority(arg) { state.prefs.priority = arg; save(); render(); },
  'default-tone'(arg) { state.prefs.tone = arg; save(); render(); },

  'toggle-vision-ai'() {
    state.prefs.useVisionAI = !state.prefs.useVisionAI;
    save();
    render();
  },

  'save-vision-key'() {
    const value = ($('#vision-api-key')?.value ?? '').trim();
    if (!value) {
      toast('Enter an API key first.');
      return;
    }
    visionApiKey = value;
    try {
      sessionStorage.setItem(VISION_KEY_STORAGE, value);
    } catch {
      /* private browsing — the key still works for this render, just won't survive a refresh */
    }
    toast('Key saved for this browser tab.');
    render();
  },

  'clear-vision-key'() {
    visionApiKey = '';
    try {
      sessionStorage.removeItem(VISION_KEY_STORAGE);
    } catch {
      /* nothing to clear */
    }
    toast('Key removed.');
    render();
  },

  upgrade() {
    state.plan = isPro() ? 'free' : 'pro';
    toast(isPro() ? 'Pro unlocked — unlimited scans and cross-posting.' : 'Back on the free plan.');
    save();
    render();
  },

  ask(arg) {
    state.chat.push({ role: 'me', text: arg });
    state.chat.push({ role: 'ai', text: answer(arg) });
    save();
    render();
    const screen = $('#screen');
    screen.scrollTop = screen.scrollHeight;
  },

  barcode() {
    toast('Barcode scanning needs a camera — not available in the prototype.');
  },

  receipt(arg) {
    openReceiptSheet(arg ?? state.current?.recognition.item.id);
  },

  'save-receipt'(arg) {
    const price = Number.parseFloat($('#receipt-price')?.value ?? '');
    const date = ($('#receipt-date')?.value ?? '').trim();

    if (!Number.isFinite(price) || price <= 0) {
      toast('Enter what you paid, as a number.');
      return;
    }
    if (Number.isNaN(new Date(date).getTime())) {
      toast('Enter the purchase date as YYYY-MM-DD.');
      return;
    }

    state.receipt = { itemId: arg, price, date };
    closeSheet();
    toast('Receipt saved');
    save();
    render();
  },

  'clear-receipt'() {
    state.receipt = null;
    closeSheet();
    save();
    render();
  },

  negotiate(arg) {
    if (!isPro()) {
      toast('The negotiation assistant is a Pro feature.');
      return;
    }
    closeSheet();
    state.negotiation = { uid: arg, offer: null };
    state.view = 'negotiate';
    render();
  },

  'offer-preset'(arg) {
    state.negotiation.offer = Number(arg);
    render();
  },

  'evaluate-offer'() {
    const value = Number.parseFloat($('#offer-input')?.value ?? '');
    if (!Number.isFinite(value) || value <= 0) {
      toast('Enter the offer as a number.');
      return;
    }
    state.negotiation.offer = value;
    render();
  },

  'copy-reply'() {
    const text = document.querySelector('.listing-box')?.textContent ?? '';
    navigator.clipboard?.writeText(text).then(
      () => toast('Reply copied to your clipboard'),
      () => toast('Could not access the clipboard'),
    );
  },

  'accept-offer'(arg) {
    const entry = state.inventory.find((e) => e.uid === state.negotiation.uid);
    if (!entry) return;

    entry.status = 'sold';
    entry.soldFor = Number(arg);
    state.negotiation = null;
    state.view = 'inventory';
    toast(`Sold for ${money(Number(arg))}`);
    save();
    render();
  },

  'export-csv'() {
    const rows = state.inventory.map(inventoryEntry).map((entry) => {
      const ranked = rankMarketplaces(entry.item, entry.pricing.prices.fair, { condition: entry.condition });
      const best = ranked[0];
      return {
        Item: entry.item.name,
        Brand: entry.item.brand,
        Category: categoryOf(entry.item).label,
        Condition: getCondition(entry.condition).label,
        Room: entry.room,
        Status: entry.status,
        'Quick price': entry.pricing.prices.quick,
        'Market price': entry.pricing.prices.fair,
        'Patient price': entry.pricing.prices.patient,
        'Sold for': entry.soldFor ?? '',
        'Best marketplace': best ? best.marketplace.name : 'None',
        'Estimated net': best ? best.profit.net.toFixed(2) : '',
        'Listed on': entry.listedOn.map((id) => getMarketplace(id)?.name ?? id).join('; '),
        Scanned: new Date(entry.date).toISOString().slice(0, 10),
      };
    });

    downloadCsv(toCsv(rows), `resellai-inventory-${new Date().toISOString().slice(0, 10)}.csv`);
    toast(`Exported ${rows.length} items`);
  },

  reset() {
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    toast('Prototype data reset');
    render();
  },

  'close-sheet'() { closeSheet(); },
};

/** Commits the active scan to inventory, carrying any uploaded photos across. */
function saveCurrent(status, targets) {
  const { recognition, condition, accessories, tier, room, photoKey } = state.current;
  const pricing = currentPricing();
  const uid = `i-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Re-key any uploaded photos to the inventory entry so its thumbnail keeps them.
  const photos = photosFor(photoKey);
  if (photos.length) photoStore.set(uid, photos);

  state.inventory.push({
    uid,
    itemId: recognition.item.id,
    condition,
    accessories: [...accessories],
    price: pricing.prices[tier],
    status,
    soldFor: null,
    room,
    listedOn: targets,
    date: Date.now(),
  });
}

// ---------------------------------------------------------------- item sheet

function openSheet(entry) {
  const enriched = inventoryEntry(entry);
  const ranked = rankMarketplaces(enriched.item, enriched.pricing.prices.fair, { condition: entry.condition });
  const best = ranked[0];
  const drift = marketDrift(entry.itemId);

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.dataset.act = 'close-sheet';
  backdrop.innerHTML = `
    <div class="sheet" data-stop="1">
      <div class="grabber"></div>
      <div class="row">
        ${thumbFor(enriched.item, entry.uid)}
        <span class="grow col">
          <span style="font-weight:600;font-size:16px;">${esc(enriched.item.name)}</span>
          <span class="tiny">${esc(getCondition(entry.condition).label)} · ${esc(entry.room)}</span>
        </span>
      </div>

      <div class="ladder" style="margin-top:16px;">
        <div class="tier"><div class="v">${money(enriched.pricing.prices.quick)}</div><div class="k">Quick</div></div>
        <div class="tier" aria-pressed="true"><div class="v">${money(enriched.pricing.prices.fair)}</div><div class="k">Market</div></div>
        <div class="tier"><div class="v">${money(enriched.pricing.prices.patient)}</div><div class="k">Patient</div></div>
      </div>

      ${Math.abs(drift) > 0.07 ? `
        <div class="banner ${drift > 0 ? 'banner-emerald' : 'banner-amber'}" style="margin-top:12px;">
          ${drift > 0
            ? `Up ${pct(Math.abs(drift))} since you scanned it. Now may be the best time to sell.`
            : `Down ${pct(Math.abs(drift))} since you scanned it. Listing sooner limits further slippage.`}
        </div>` : ''}

      ${best ? `
        <div class="card" style="margin-top:12px;">
          <div class="eyebrow" style="margin-bottom:6px;">Best marketplace</div>
          <div class="row-between">
            <span style="font-weight:600;">${esc(best.marketplace.name)}</span>
            <span class="num profit" style="font-weight:600;">${money(best.profit.net, 2)}</span>
          </div>
          <p class="tiny" style="margin-top:8px;">${esc(best.why)}</p>
        </div>
      ` : ''}

      <div class="stack" style="margin-top:16px;">
        ${entry.status === 'listed'
          ? `<button class="btn btn-block" data-act="negotiate" data-arg="${entry.uid}">An offer came in${isPro() ? '' : ' · Pro'}</button>`
          : ''}
        ${entry.status !== 'sold' ? `<button class="btn btn-emerald btn-block" data-act="mark-sold" data-arg="${entry.uid}">Mark as sold</button>` : ''}
        <button class="btn btn-quiet btn-block" data-act="archive-item" data-arg="${entry.uid}">Remove from inventory</button>
        <button class="btn btn-ghost btn-block" data-act="close-sheet">Close</button>
      </div>
    </div>
  `;

  $('.phone').appendChild(backdrop);
}

function closeSheet() {
  document.querySelector('.sheet-backdrop')?.remove();
}

/**
 * Receipt entry.
 *
 * The PRD imports this by OCR'ing a photographed receipt. There is no OCR here, so the two
 * fields that actually drive the depreciation maths are entered by hand instead — the analysis
 * behind them is the same either way.
 */
function openReceiptSheet(itemId) {
  const item = getItem(itemId) ?? state.current?.recognition.item;
  if (!item) {
    toast('Scan an item first, then add its receipt.');
    return;
  }

  const existing = state.receipt?.itemId === item.id ? state.receipt : null;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.dataset.act = 'close-sheet';
  backdrop.innerHTML = `
    <div class="sheet" data-stop="1">
      <div class="grabber"></div>
      <h2>Receipt details</h2>
      <p class="tiny" style="margin-top:6px;">
        What you paid and when. This drives the depreciation figures — how much this item has
        cost you to own, and what waiting longer will cost.
      </p>

      <div class="col" style="gap:14px;margin-top:16px;">
        <label class="col" style="gap:6px;">
          <span class="eyebrow">Purchase price</span>
          <input type="text" inputmode="decimal" id="receipt-price"
            placeholder="${item.msrp ?? 100}" value="${existing?.price ?? ''}" />
        </label>
        <label class="col" style="gap:6px;">
          <span class="eyebrow">Purchase date</span>
          <input type="text" id="receipt-date" placeholder="YYYY-MM-DD" value="${esc(existing?.date ?? '')}" />
        </label>
      </div>

      <div class="stack" style="margin-top:18px;">
        <button class="btn btn-block" data-act="save-receipt" data-arg="${item.id}">Save receipt</button>
        ${existing ? `<button class="btn btn-quiet btn-block" data-act="clear-receipt">Remove receipt</button>` : ''}
        <button class="btn btn-ghost btn-block" data-act="close-sheet">Cancel</button>
      </div>
    </div>
  `;

  $('.phone').appendChild(backdrop);
}

// ---------------------------------------------------------------- negotiation

function viewNegotiate() {
  const context = state.negotiation;
  if (!context) {
    state.view = 'inventory';
    return viewInventory();
  }

  const entry = state.inventory.find((e) => e.uid === context.uid);
  if (!entry) {
    state.view = 'inventory';
    return viewInventory();
  }

  const enriched = inventoryEntry(entry);
  const askPrice = enriched.pricing.prices.fair;
  const marketplace = getMarketplace(entry.listedOn[0]) ?? getMarketplace('ebay');
  const daysListed = Math.max(0, Math.round((Date.now() - entry.date) / 86400000));

  const result = context.offer
    ? evaluateOffer({
        item: enriched.item,
        marketplace,
        askPrice,
        offer: context.offer,
        condition: entry.condition,
        daysListed,
        tone: state.prefs.tone,
      })
    : null;

  const badge = {
    accept: ['pill-emerald', 'Accept it'],
    counter: ['pill-indigo', 'Counter'],
    hold: ['pill-amber', 'Hold firm'],
    decline: ['pill-rose', 'Decline'],
  };

  return `
    <div class="row-between" style="margin: 8px 0 14px;">
      <button class="btn btn-quiet btn-sm" data-act="go" data-arg="inventory">‹ Back</button>
      <span class="pill pill-amber">Pro feature</span>
    </div>

    <h1>An offer came in</h1>
    <p class="sub" style="margin-top:4px;">Tell me what they offered and I will tell you whether to take it.</p>

    <div class="card" style="margin-top:16px;">
      <div class="row">
        ${thumbFor(enriched.item, entry.uid)}
        <span class="grow col">
          <span style="font-weight:600;font-size:14.5px;" class="truncate">${esc(enriched.item.name)}</span>
          <span class="tiny">Listed at ${money(askPrice)} on ${esc(marketplace.name)} · ${daysListed} day${daysListed === 1 ? '' : 's'} ago</span>
        </span>
      </div>
    </div>

    <div class="section-head"><h2>Their offer</h2></div>
    <div class="row" style="gap:10px;">
      <input type="text" inputmode="decimal" id="offer-input" class="grow"
        placeholder="${Math.round(askPrice * 0.8)}" value="${context.offer ?? ''}" />
      <button class="btn" data-act="evaluate-offer">Check</button>
    </div>

    <div class="chip-row" style="margin-top:10px;">
      ${[0.9, 0.8, 0.65, 0.4].map((share) => {
        const value = Math.round(askPrice * share);
        return `<button class="chip" data-act="offer-preset" data-arg="${value}"
          aria-pressed="${context.offer === value}">${money(value)}</button>`;
      }).join('')}
    </div>

    ${result ? `
      <div class="card" style="margin-top:16px;">
        <div class="row-between">
          <span class="pill ${badge[result.verdict][0]}" style="font-size:13px;padding:7px 14px;">${badge[result.verdict][1]}</span>
          <span class="num" style="font-weight:600;">${money(result.offerNet, 2)} net</span>
        </div>
        <p class="tiny" style="margin-top:12px;">${esc(result.reasoning)}</p>

        <div class="divider"></div>
        <div class="ledger">
          <div class="line"><span>Their offer</span><span class="num">${money(result.offer)}</span></div>
          <div class="line"><span>You net</span><span class="num">${money(result.offerNet, 2)}</span></div>
          <div class="line"><span>Your floor today</span><span class="num">${money(result.reservationNet, 2)}</span></div>
          ${result.verdict === 'counter' ? `<div class="line total"><span>Counter at</span><span class="num profit">${money(result.counterPrice)}</span></div>` : ''}
        </div>
        <p class="tiny" style="margin-top:10px;">
          Your floor started at ${money(result.fairNet, 2)} and slides toward ${money(result.quickNet, 2)}
          the longer it sits — typical time to sell here is ${result.typicalDays} days.
        </p>
      </div>

      <div class="section-head"><h2>Suggested reply</h2>
        <span class="link" data-act="copy-reply">Copy</span>
      </div>
      <div class="listing-box">${esc(result.reply)}</div>

      ${result.verdict === 'accept' ? `
        <div style="margin-top:18px;">
          <button class="btn btn-emerald btn-block" data-act="accept-offer" data-arg="${result.offer}">
            Accept and mark sold at ${money(result.offer)}
          </button>
        </div>
      ` : ''}
    ` : `
      <div class="empty"><span class="g">${icon('chat', 34)}</span>Enter an offer to see whether it clears your floor.</div>
    `}
  `;
}

// ---------------------------------------------------------------- wiring

/** Hand a generated CSV to the browser as a download. */
function downloadCsv(text, filename) {
  // The BOM is what makes Excel open UTF-8 correctly instead of mangling accented characters.
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Photo uploads arrive as a change event, not a click. */
document.addEventListener('change', (event) => {
  const input = event.target.closest('[data-act="photos"]');
  if (!input || !input.files?.length) return;

  const files = [...input.files].slice(0, 8);
  // Seed from file metadata so re-uploading the same photos identifies the same item.
  const seed = files.map((file) => `${file.name}:${file.size}`).join('|');

  Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
    ),
  ).then(
    (photos) => startScan(undefined, { photos, seed }),
    () => toast('Could not read those photos.'),
  );
});

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-act]');
  if (!trigger) return;

  // Clicking the dimmed area closes the sheet, but a click that lands on the sheet itself
  // resolves to the backdrop only when it missed every button inside — ignore those.
  if (trigger.classList.contains('sheet-backdrop') && event.target.closest('[data-stop]')) return;
  if (trigger.disabled) return;

  const handler = actions[trigger.dataset.act];
  if (handler) {
    event.preventDefault();
    handler(trigger.dataset.arg);
  }
});

function tick() {
  const el = $('#clock');
  if (el) {
    el.textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}

// Re-apply a previously chosen theme; with no explicit choice the media query governs.
if (state.theme) document.documentElement.dataset.theme = state.theme;

tick();
setInterval(tick, 20000);
render();
