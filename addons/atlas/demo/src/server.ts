/**
 * The demo server: `Bun.serve` with an HTML import, so Bun bundles
 * `index.html`, its TSX and its Tailwind stylesheet on request. `bun run
 * dev` adds hot reload. The fetch adapter joins under `/api/atlas` later.
 */
import index from './index.html';

/** The port, from `PORT` or this default. */
const DEFAULT_PORT = 4319;

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);

const server = Bun.serve({
  port,
  routes: {
    '/': index,
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.info(`Atlas demo on ${server.url}`);
