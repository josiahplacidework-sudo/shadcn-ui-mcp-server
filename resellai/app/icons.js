/**
 * The icon set.
 *
 * Everything here was an emoji until it wasn't. Emoji are the fastest way to get a picture into a
 * prototype and the fastest way to make it look unfinished: they are drawn by the operating
 * system, so the app has no say in their weight, colour, or style, and they render as three
 * different illustrations across macOS, Windows, and Android. They also collide — the catalog has
 * two sneakers and one 👟, a jacket and jeans and one 🧥 — so the picture stops carrying
 * information and becomes decoration.
 *
 * These are one stroked path each, drawn on the same 24×24 grid at the same weight, inheriting
 * `currentColor`. That is what lets an icon sit in a tab bar, a list row, and a dark viewfinder
 * without three different assets.
 */

/** Every path is drawn for this box, so sizing is a single attribute on the <svg>. */
const VIEWBOX = 24;
/** Constant across sizes on purpose — icons that scale their stroke look like clipart. */
const STROKE = 1.6;

/* Paths only, no <svg> wrapper: the wrapper carries the size and colour, which vary per site.
 * `~` marks a path that should be filled rather than stroked — a pupil, a dot, a stud. */
const PATHS = {
  // ---- navigation
  home: ['M3.6 10.4 12 3.5l8.4 6.9V19a1.6 1.6 0 0 1-1.6 1.6h-4.2v-6h-5.2v6H5.2A1.6 1.6 0 0 1 3.6 19z'],
  inventory: [
    'M9.2 4.6H6.8A1.8 1.8 0 0 0 5 6.4v13.2a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V6.4a1.8 1.8 0 0 0-1.8-1.8h-2.4',
    'M9.4 2.9h5.2v3.4H9.4z',
    'M8.6 11.4h6.8M8.6 15.2h4.2',
  ],
  camera: [
    'M4.4 8.2h2.9l1.5-2.3h6.4l1.5 2.3h2.9a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6V9.8a1.6 1.6 0 0 1 1.6-1.6z',
    'M12 17a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z',
  ],
  analytics: ['M5.2 20.2v-6.6M12 20.2V4.6M18.8 20.2v-9.4'],
  profile: ['M12 11.8a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8z', 'M4.6 20.8a7.4 7.4 0 0 1 14.8 0'],

  // ---- catalog categories
  sneakers: [
    'M3 17.4v-6.2h3l2.3 1.9 3.8 1.4 5.6 2a2.5 2.5 0 0 1 1.6 2.3v.5a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 19.3z',
    'M6.3 13.1 8 11.2M9.7 14.4l1.8-2',
  ],
  gaming: [
    'M8.4 9h7.2a4.8 4.8 0 0 1 4.7 3.9l.6 3.4a2.1 2.1 0 0 1-3.7 1.7l-1.4-1.6H8.2l-1.4 1.6a2.1 2.1 0 0 1-3.7-1.7l.6-3.4A4.8 4.8 0 0 1 8.4 9z',
    'M6.6 13.4h2.6M7.9 12.1v2.6',
    '~M15.4 12.9a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17.4 15.1a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  ],
  electronics: [
    'M4.8 15.4v-3a7.2 7.2 0 0 1 14.4 0v3',
    'M3.2 15.6a1.6 1.6 0 0 1 1.6-1.6h1.3v5.6H4.8a1.6 1.6 0 0 1-1.6-1.6zM20.8 15.6a1.6 1.6 0 0 0-1.6-1.6h-1.3v5.6h1.3a1.6 1.6 0 0 0 1.6-1.6z',
  ],
  furniture: [
    'M5.4 11.6V8.4a2 2 0 0 1 2-2h9.2a2 2 0 0 1 2 2v3.2',
    'M3.4 13.4a1.9 1.9 0 0 1 3.8 0v2.8h9.6v-2.8a1.9 1.9 0 0 1 3.8 0v4.6H3.4z',
    'M5.6 18v2.4M18.4 18v2.4',
  ],
  apparel: [
    'M9 3.8 5.2 6 3 9.3l3.2 2.1 1.3-1.4v10.2h9v-10.2l1.3 1.4L21 9.3 18.8 6 15 3.8a3.2 3.2 0 0 1-6 0z',
  ],
  appliance: [
    'M3.6 11.2h12.2v3.2a5.2 5.2 0 0 1-5.2 5.2H8.8a5.2 5.2 0 0 1-5.2-5.2z',
    'M15.8 12.4h3.4a1.6 1.6 0 0 0 0-3.2h-1.6',
  ],
  sporting: [
    'M5.8 20.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM18.2 20.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z',
    'M5.8 16.6 9.4 9.2h5.2l3.6 7.4M9.4 9.2H7.2M12.6 9.4l1.8-2.6h2.4',
  ],
  cards: [
    'M9.4 6.6h6.4a1.6 1.6 0 0 1 1.6 1.6v10.4a1.6 1.6 0 0 1-1.6 1.6H9.4a1.6 1.6 0 0 1-1.6-1.6V8.2a1.6 1.6 0 0 1 1.6-1.6z',
    'M6.2 6.2 4.6 6.7a1.6 1.6 0 0 0-1 2l2.6 9.1',
    'M11.4 11.4h2.4',
  ],
  luxury: ['M6 9.2h12l1 10.6H5zM9.2 9.2V7.4a2.8 2.8 0 0 1 5.6 0v1.8'],
  instrument: [
    'M19.6 4.4 14.4 9.6M17.4 6.6l1.6 1.6',
    'M13.2 11a4.2 4.2 0 0 0-6 .6l-.9 1a3.7 3.7 0 0 0 5.2 5.2l1-.9a4.2 4.2 0 0 0 .7-5.9z',
    'M10.2 15.6a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z',
  ],
  tools: [
    'M20.2 5.4a4.6 4.6 0 0 1-6.1 6.1l-7.8 7.8a2.2 2.2 0 0 1-3.1-3.1l7.8-7.8a4.6 4.6 0 0 1 6.1-6.1l-2.9 2.9 3.1 3.1z',
  ],
  fitness: ['M6.6 8.2v7.6M4 10.2v3.6M17.4 8.2v7.6M20 10.2v3.6M6.6 12h10.8'],
  books: [
    'M4 5.6a1.6 1.6 0 0 1 1.6-1.6h3.8A2.6 2.6 0 0 1 12 6.6v12a2.6 2.6 0 0 0-2.6-2.6H5.6A1.6 1.6 0 0 1 4 14.4z',
    'M20 5.6A1.6 1.6 0 0 0 18.4 4h-3.8A2.6 2.6 0 0 0 12 6.6v12a2.6 2.6 0 0 1 2.6-2.6h3.8a1.6 1.6 0 0 0 1.6-1.6z',
  ],
  // A brick with square-shouldered studs. Drawn with the half-round studs an arc gives you, this
  // read as a handbag with a handle at list size — which is what the catalog's LEGO sets got.
  toys: [
    'M4.4 10.4h15.2v8.2a1.2 1.2 0 0 1-1.2 1.2H5.6a1.2 1.2 0 0 1-1.2-1.2z',
    'M7.6 10.4V8.5a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.9',
    'M13.2 10.4V8.5a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.9',
  ],
  box: ['M3.6 7.6 12 3.2l8.4 4.4v8.8L12 20.8l-8.4-4.4z', 'M3.6 7.6 12 12m0 0 8.4-4.4M12 12v8.8'],

  // ---- interface
  chat: ['M4.4 5h15.2a1.6 1.6 0 0 1 1.6 1.6v8.6a1.6 1.6 0 0 1-1.6 1.6H9.8L5.2 21v-4.2h-.8a1.6 1.6 0 0 1-1.6-1.6V6.6A1.6 1.6 0 0 1 4.4 5z'],
  cart: [
    'M2.8 4h2.4l2.4 10.9a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.3L20.4 8H6',
    '~M9.4 20.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8zM17.2 20.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z',
  ],
  image: [
    'M4.4 4.6h15.2a1.6 1.6 0 0 1 1.6 1.6v11.6a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6V6.2a1.6 1.6 0 0 1 1.6-1.6z',
    'M2.8 16.2 8.6 11l4.4 4 2.8-2.4 5.4 4.6',
    '~M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  ],
  spark: ['M12 3.4 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9z'],
  trophy: [
    'M7.6 4h8.8v5.2a4.4 4.4 0 0 1-8.8 0z',
    'M7.6 5.4H4.8v1.4a3.4 3.4 0 0 0 3 3.4M16.4 5.4h2.8v1.4a3.4 3.4 0 0 1-3 3.4',
    'M12 13.6v3.2M8.6 20.4h6.8l-.8-3.6H9.4z',
  ],
  check: ['M4.8 12.6 9.6 17.4 19.2 6.6'],
  chevron: ['M9.4 5.6 16 12l-6.6 6.4'],
  barcode: ['M4 5.6v12.8M7.2 5.6v12.8M10.4 5.6v9.6M13.6 5.6v12.8M16.8 5.6v9.6M20 5.6v12.8'],
  receipt: [
    'M6 3.2h12v17.6l-2.4-1.5-2.4 1.5-2.4-1.5-2.4 1.5L6 20.8z',
    'M9.2 8.4h5.6M9.2 12.2h5.6',
  ],
  gift: [
    'M3.6 11.4h16.8v8.2a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4z',
    'M2.8 7.4h18.4v4H2.8zM12 7.4v13.6',
    'M12 7.4S10.9 3.2 8.5 3.2a2.1 2.1 0 0 0 0 4.2zM12 7.4s1.1-4.2 3.5-4.2a2.1 2.1 0 0 1 0 4.2z',
  ],
};

/** Category id → icon name. Kept here rather than in the catalog: the engine has no pixels in it. */
const CATEGORY_ICONS = {
  sneakers: 'sneakers',
  gaming: 'gaming',
  electronics: 'electronics',
  camera: 'camera',
  furniture: 'furniture',
  apparel: 'apparel',
  appliance: 'appliance',
  sporting: 'sporting',
  cards: 'cards',
  luxury: 'luxury',
  instrument: 'instrument',
  tools: 'tools',
  fitness: 'fitness',
  books: 'books',
  toys: 'toys',
};

/**
 * One icon, as an inline <svg> string.
 *
 * Inline rather than a sprite or a font: the whole app ships as a single file with no sibling
 * assets, so there is nowhere for a sprite sheet to live.
 *
 * @param {string} name a key of PATHS; an unknown name falls back to the box
 * @param {number} size rendered edge in px
 */
export function icon(name, size = 20) {
  const paths = PATHS[name] ?? PATHS.box;
  const body = paths
    .map((d) =>
      d.startsWith('~')
        ? `<path d="${d.slice(1)}" fill="currentColor" stroke="none" />`
        : `<path d="${d}" />`,
    )
    .join('');

  // aria-hidden throughout: every icon in this app sits beside its own text label, so announcing
  // it would just read the label twice.
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The icon for a catalog category id. */
export function categoryIcon(categoryId, size = 20) {
  return icon(CATEGORY_ICONS[categoryId] ?? 'box', size);
}
