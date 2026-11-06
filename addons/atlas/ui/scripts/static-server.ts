/**
 * A static file server over a built Storybook, for `check:stories` and the
 * visual suite. Paths are resolved inside the root and refused outside it.
 */
import { join, normalize, resolve, sep } from 'node:path';

/** The address the server answers on. */
export const HOST = '127.0.0.1';

/** Starts serving `root` on `port` (0 picks a free one) and answers the server. */
export function serveStatic(root: string, port: number): Bun.Server<undefined> {
  const base = resolve(root);
  return Bun.serve({
    hostname: HOST,
    port,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
      const path = resolve(join(base, relative === ''
        ? 'index.html'
        : relative));
      if (path !== base && !path.startsWith(base + sep)) return new Response('forbidden', { status: 403 });
      const file = Bun.file(path);
      if (!(await file.exists())) return new Response('not found', { status: 404 });
      return new Response(file);
    },
  });
}
