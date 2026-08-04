/**
 * Bundles the app into one self-contained HTML fragment.
 *
 * The app is written as plain ES modules with no dependencies, so it runs directly from
 * `app/index.html` during development. This script flattens the module graph into a single
 * inline script for environments that cannot serve multiple files — notably a published
 * Artifact, whose content-security policy blocks every external asset request.
 *
 * It is deliberately not a general-purpose bundler. It understands exactly the module syntax
 * this project uses, and throws on anything it does not recognise rather than emitting a
 * silently broken bundle.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(root, 'app/app.js');

const IMPORT_RE = /^import\s+\{([\s\S]*?)\}\s+from\s+['"](.+?)['"];?\s*$/gm;
const EXPORT_STAR_RE = /^export\s+\*\s+from\s+['"](.+?)['"];?\s*$/gm;
const EXPORT_DECL_RE = /^export\s+(async\s+)?(function|const|let|class)\s+(\w+)/gm;
/** `export { a, b };` — a list of already-declared local bindings. */
const EXPORT_LIST_RE = /^export\s+\{([^}]*)\}\s*;?\s*$/gm;
const BARE_IMPORT_RE = /^import\s+['"](.+?)['"];?\s*$/gm;
const DEFAULT_EXPORT_RE = /^export\s+default\b/m;
/** `export { a } from './b.js'` — a scoped re-export, which this bundler does not resolve. */
const EXPORT_FROM_RE = /^export\s+\{[^}]*\}\s+from\s+['"].+?['"];?\s*$/m;

const modules = new Map();
const resolving = new Set();

function moduleId(absolutePath) {
  return relative(root, absolutePath).replace(/\\/g, '/');
}

/** Parses a module and its imports, inserting each one only after its dependencies. */
function collect(absolutePath) {
  const id = moduleId(absolutePath);
  if (modules.has(id)) return id;

  // The emitted bundle initialises modules in insertion order, so a cycle could not be
  // initialised in any valid order. Fail loudly rather than emit a broken bundle.
  if (resolving.has(id)) {
    throw new Error(`Import cycle detected at ${id}: ${[...resolving, id].join(' → ')}`);
  }
  resolving.add(id);

  const source = readFileSync(absolutePath, 'utf8');

  if (DEFAULT_EXPORT_RE.test(source)) {
    throw new Error(`${id}: default exports are not supported by this bundler`);
  }
  if (BARE_IMPORT_RE.test(source)) {
    throw new Error(`${id}: side-effect-only imports are not supported by this bundler`);
  }
  if (EXPORT_FROM_RE.test(source)) {
    throw new Error(`${id}: 'export { … } from' is not supported — re-export with 'export *' instead`);
  }

  const imports = [];
  const reexports = [];
  const exports = new Set();

  for (const match of source.matchAll(IMPORT_RE)) {
    const names = match[1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const dep = collect(resolve(dirname(absolutePath), match[2]));
    imports.push({ names, dep });
  }

  for (const match of source.matchAll(EXPORT_STAR_RE)) {
    reexports.push(collect(resolve(dirname(absolutePath), match[1])));
  }

  for (const match of source.matchAll(EXPORT_DECL_RE)) {
    exports.add(match[3]);
  }

  for (const match of source.matchAll(EXPORT_LIST_RE)) {
    for (const name of match[1].split(',').map((n) => n.trim()).filter(Boolean)) {
      if (name.includes(' as ')) {
        throw new Error(`${id}: renaming exports ('${name}') is not supported by this bundler`);
      }
      exports.add(name);
    }
  }

  const body = source
    .replace(IMPORT_RE, '')
    .replace(EXPORT_STAR_RE, '')
    .replace(EXPORT_LIST_RE, '')
    .replace(EXPORT_DECL_RE, (_, asyncKeyword, keyword, name) => `${asyncKeyword ?? ''}${keyword} ${name}`);

  // Insert only after every dependency has been inserted, so Map insertion order is a valid
  // initialisation order for the emitted bundle.
  resolving.delete(id);
  modules.set(id, { id, body, imports, reexports, exports: [...exports] });
  return id;
}

/** Wraps a module as a registry entry whose exports later modules destructure. */
function emit(module) {
  const bindings = module.imports
    .map(({ names, dep }) => `  const { ${names.join(', ')} } = __m[${JSON.stringify(dep)}];`)
    .join('\n');

  const returned = [
    ...module.reexports.map((dep) => `...__m[${JSON.stringify(dep)}]`),
    ...module.exports,
  ];

  return `__m[${JSON.stringify(module.id)}] = (() => {
${bindings}
${module.body}
  return { ${returned.join(', ')} };
})();`;
}

const entryId = collect(ENTRY);

// `collect` inserts each module only once its dependencies are in, so insertion order already
// places every dependency before the module that imports it.
const ordered = [...modules.values()];
if (ordered.some((module) => !module)) {
  throw new Error('Internal error: a module was never resolved');
}
const script = [
  'const __m = {};',
  ...ordered.map(emit),
].join('\n\n');

// Compile the emitted script before writing it. `new Function` parses without running, so any
// module syntax this bundler failed to transform surfaces here as a build error rather than as
// a blank page at runtime.
try {
  new Function(script); // eslint-disable-line no-new-func
} catch (error) {
  throw new Error(`Emitted bundle is not valid JavaScript: ${error.message}`);
}

const css = readFileSync(resolve(root, 'app/styles.css'), 'utf8');
const html = readFileSync(resolve(root, 'app/index.html'), 'utf8');

// Reuse the markup between <body> and </body> so the shell never drifts out of sync.
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error('app/index.html: could not find the <body> element');
const markup = bodyMatch[1].replace(/\s*<script[\s\S]*?<\/script>\s*/g, '\n');

// Deliberately a document *fragment*, not a full HTML document.
//
// The output is published as a Claude Artifact, and that publisher supplies its own
// `<!doctype html><html><head>…</head><body>` wrapper. Emitting our own doctype and html/head/
// body here would nest a second document inside the first. Standards mode comes from the host
// wrapper. To open the bundle directly in a browser instead, use `npm run serve`, which serves
// app/index.html — a complete document with its own doctype.
//
// The one head element we do emit is the viewport meta, and it earns its place. A host wrapper
// will supply a sensible `width=device-width`, but it has no reason to add `viewport-fit=cover`
// — and without that, `env(safe-area-inset-*)` resolves to zero, so the notch handling in
// styles.css would quietly do nothing on a phone. Browsers scan for this tag wherever it
// appears and the later one wins, so declaring it here reliably overrides the host's.
// The home-screen icon is inlined rather than linked. Both builds are single files with no
// sibling assets to serve it from, and without it iOS falls back to a screenshot of the page.
const iconPng = readFileSync(resolve(root, 'app/apple-touch-icon.png')).toString('base64');
const APPLE_ICON_LINK = `<link rel="apple-touch-icon" href="data:image/png;base64,${iconPng}" />`;

const page = `<title>ResellAI — Take one photo. Find out what it is worth.</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="ResellAI" />
${APPLE_ICON_LINK}
<style>
${css}
</style>
${markup.trim()}
<script type="module">
${script}
</script>
`;

// The standalone build wraps the same fragment in a complete document, for opening the file
// directly from disk. Without a doctype a browser falls back to quirks mode, which breaks the
// phone shell's layout — so this variant carries the head from app/index.html rather than
// relying on a host page to supply one.
const headMatch = html.match(/<head>([\s\S]*?)<\/head>/);
if (!headMatch) throw new Error('app/index.html: could not find the <head> element');

// Drop the stylesheet link; the CSS is inlined below. Matched independently of attribute order,
// quote style, and whether the tag self-closes, so reformatting index.html cannot quietly leave
// an external <link> in a build whose entire purpose is to need no external requests.
const STYLESHEET_LINK_RE =
  /\s*<link\b(?=[^>]*\brel\s*=\s*["'][^"']*\bstylesheet\b[^"']*["'])[^>]*>\s*/gi;
/** The icon link is re-emitted inlined below, so the file-relative one from index.html goes. */
const APPLE_ICON_LINK_RE =
  /\s*<link\b(?=[^>]*\brel\s*=\s*["'][^"']*\bapple-touch-icon\b[^"']*["'])[^>]*>\s*/gi;
const head = headMatch[1].replace(STYLESHEET_LINK_RE, '\n').replace(APPLE_ICON_LINK_RE, '\n');

const standalone = `<!doctype html>
<html lang="en">
<head>
${head.trim()}
${APPLE_ICON_LINK}
<style>
${css}
</style>
</head>
<body>
${markup.trim()}
<script type="module">
${script}
</script>
</body>
</html>
`;

// Every output must load with no external asset references in its shell — the Artifact CSP
// blocks external requests outright, and the standalone build is opened straight from a file://
// path where relative URLs resolve to nothing. A reference surviving into one of them is a
// silent failure at exactly the moment it matters, so check rather than trust the transforms
// above.
//
// Scoped to loading, deliberately. This says nothing about what the running app does: the
// opt-in vision path in src/engine/vision.js calls Anthropic's API at runtime once the user
// supplies a key, and that request is intended and cannot be spotted in markup anyway.
//
// Any href or src that is not a data: URI would be fetched at load. Checked generically
// rather than per-tag so a future <link> or <img> added to index.html is caught too.
const EXTERNAL_REF_RE = /<(?:link|script|img|source)\b[^>]*\b(?:href|src)\s*=\s*["'](?!data:)[^"']*["'][^>]*>/gi;

// index.html is the same document as the standalone build, under the name a static host looks
// for automatically. Two names for identical content rather than one: resellai-standalone.html
// is the one meant for a person to download and double-click, where a generic "index.html"
// would be a confusing filename to hand someone; index.html is the one a host's default
// directory-listing behaviour finds without any redirect or rewrite rule.
for (const [name, output] of [
  ['resellai.html', page],
  ['resellai-standalone.html', standalone],
  ['index.html', standalone],
]) {
  // Only the document shell is checked. The bundled script is already inline by construction,
  // and it builds markup in template literals — `<img src="${pendingPhoto}">` is a runtime data
  // URL, not a fetch, but reads as an external reference to a regex.
  const shell = output.replace(/<script type="module">[\s\S]*?<\/script>/g, '');
  const leftover = shell.match(EXTERNAL_REF_RE)?.[0];
  if (leftover) {
    throw new Error(`dist/${name} still references an external file: ${leftover.trim()}`);
  }
}

mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/resellai.html'), page);
writeFileSync(resolve(root, 'dist/resellai-standalone.html'), standalone);
writeFileSync(resolve(root, 'dist/index.html'), standalone);

const kb = (page.length / 1024).toFixed(1);
const standaloneKb = (standalone.length / 1024).toFixed(1);
console.log(`Bundled ${modules.size} modules → dist/resellai.html (${kb} KB, fragment for embedding)`);
console.log(`                              → dist/resellai-standalone.html (${standaloneKb} KB, opens from disk)`);
console.log(`                              → dist/index.html (${standaloneKb} KB, same file — for static hosts)`);
console.log(`Entry: ${entryId}`);
