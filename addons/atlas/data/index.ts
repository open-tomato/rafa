/**
 * `@open-tomato/atlas-data`: the public entry. The contract is also
 * reachable on its own as `@open-tomato/atlas-data/contract`, and the
 * query engine, which reads no database itself, as
 * `@open-tomato/atlas-data/query`. The replica and the table source over
 * it run under bun only, so they are reachable as
 * `@open-tomato/atlas-data/replica` and `@open-tomato/atlas-data/source`
 * and not from here, which keeps this entry browser-safe.
 */
export * from './src/contract/index.js';
