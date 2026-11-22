/**
 * Bun's own `fetch`, `Request`, `Response` and `Headers`, read when this
 * module is first evaluated: the preload (`happy-dom.ts`) imports it
 * before happy-dom replaces them. happy-dom's `fetch` refuses a
 * cross-origin read and its `Response` is not one `Bun.serve` answers
 * with, so a test that serves over HTTP (`src/server.test.ts`) puts these
 * back for its run with `useBunNetwork` and hands happy-dom's back after.
 */

/** The four globals a request over the wire goes through. */
interface NetworkGlobals {
  readonly fetch: typeof fetch;
  readonly Request: typeof Request;
  readonly Response: typeof Response;
  readonly Headers: typeof Headers;
}

const BUN_NETWORK: NetworkGlobals = { fetch, Request, Response, Headers };

function current(): NetworkGlobals {
  return { fetch: globalThis.fetch, Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };
}

function install(network: NetworkGlobals): void {
  Object.assign(globalThis, network);
}

/** Puts Bun's network globals in place and answers the function that restores the ones it replaced. */
export function useBunNetwork(): () => void {
  const replaced = current();
  install(BUN_NETWORK);
  return () => {
    install(replaced);
  };
}
