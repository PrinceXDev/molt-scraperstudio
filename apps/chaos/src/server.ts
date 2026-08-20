import { createServer } from 'node:http';

import { parseLayoutVersion, renderPage } from './render.js';

/**
 * Local preview server for the chaos site.
 *
 * Useful for eyeballing each layout while developing. It is *not* what the
 * Bright Data collector scrapes: collectors run in Bright Data's cloud and
 * cannot reach localhost, so the deployed static build is the real target.
 */

const PORT = Number(process.env['PORT'] ?? 4321);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const version = parseLayoutVersion(url.searchParams.get('v'));

  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    // Never let a proxy serve stale markup while we are demonstrating a change.
    'cache-control': 'no-store',
  });
  res.end(renderPage(version, { mode: 'server' }));
});

server.listen(PORT, () => {
  process.stdout.write(`chaos site on http://localhost:${PORT}  (try ?v=1, ?v=2, ?v=3)\n`);
});
