/**
 * Bundles the app into one self-contained HTML fragment.
 *
 * The app is written as plain ES modules with no dependencies, so it runs directly from
 * `app/index.html` during development. This script flattens the module graph into a single
 * inline script for environments that cannot serve multiple files — notably a published
 * Artifact, whose content-security policy blocks every external request.
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
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(function|const|let|class)\s+(\w+)/gm;
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
    exports.add(match[2]);
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
    .replace(EXPORT_DECL_RE, (_, keyword, name) => `${keyword} ${name}`);

  // Insert only after every dependency has been inserted, so Map insertion order is a valid
  // initialisation order for the emitted bundle.
  resolving.delete(id);
  modules.set(id, { id, body, imports, reexports, exports: [...exports] });
  return id;
}

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

const page = `<title>ResellAI — Take one photo. Find out what it is worth.</title>
<style>
${css}
</style>
${markup.trim()}
<script type="module">
${script}
</script>
`;

mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/resellai.html'), page);

const kb = (page.length / 1024).toFixed(1);
console.log(`Bundled ${modules.size} modules → dist/resellai.html (${kb} KB)`);
console.log(`Entry: ${entryId}`);
