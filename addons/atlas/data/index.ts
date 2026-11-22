/**
 * `@open-tomato/atlas-data`: the public entry. The contract is also
 * reachable on its own as `@open-tomato/atlas-data/contract`. The replica
 * runs under bun only, so it is reachable as
 * `@open-tomato/atlas-data/replica` and not from here, which keeps this
 * entry browser-safe.
 */
export * from './src/contract/index.js';
