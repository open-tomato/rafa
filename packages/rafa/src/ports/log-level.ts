/**
 * The logger's level, in a leaf of its own so a module that needs only
 * the level (the logger's settings, the config section that reads them)
 * imports it without reaching the rest of `./ports`. `packages/rafa/src/ports/index.ts`
 * re-exports it, so the `./ports` subpath names it unchanged.
 */

/**
 * How loud a log entry is, or `api` for the metadata of one request and
 * its response. `error`, `warn` and `debug` are ordered, quietest first;
 * `api` sits outside that order and is turned on by itself. There is no
 * `info`: that is a command's own text, which goes through `Output`.
 */
export type LogLevel = 'error' | 'warn' | 'debug' | 'api';
