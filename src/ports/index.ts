/**
 * The root's build entry for `@open-tomato/rafa/ports`: `bun build` writes
 * the `dist/` file the root's `exports` names from this path, until #808
 * publishes core itself. The code lives in core's package, `packages/rafa/`.
 */
export * from '@open-tomato/rafa/ports';
