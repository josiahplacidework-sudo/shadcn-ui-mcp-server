/**
 * Zero-dependency static server for local development.
 *
 * Serves the repository root so `app/index.html` can import the engines from `src/` as real ES
 * modules, exactly as the browser would in production.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 4173);
// This server exposes every file under the project directory, so it binds to loopback unless
// asked otherwise. Set HOST=0.0.0.0 deliberately when testing from a phone on the same network.
const host = process.env.HOST ?? '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  // Redirect rather than rewrite, so the page's relative asset URLs resolve against /app/.
  if (url.pathname === '/') {
    res.writeHead(302, { location: '/app/index.html' }).end();
    return;
  }

  const requested = url.pathname;

  // Normalise before joining so a crafted path cannot escape the project directory.
  const target = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, host, () => {
  console.log(`ResellAI prototype running at http://localhost:${port}/`);
});
