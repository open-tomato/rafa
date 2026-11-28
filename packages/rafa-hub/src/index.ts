/**
 * The hub as a package entry: the one name a file outside this package
 * imports, {@link HubConfigFile}, the shape an operator's
 * `rafa-hub.config.ts` writes, as
 * `export default { … } satisfies HubConfigFile` (#1659).
 *
 * The entry exports that type and nothing else; the server, the config
 * readers and the CLI stay behind `src/bin.ts`.
 */
export type { HubConfigFile } from './config-top-level';
