/**
 * `@open-tomato/charts/engine`: the headless engine. Every primitive's pure
 * option builder, `renderToSvg` over ECharts' server-side SVG renderer, the
 * token map they read, and the value format spec with its zod schemas. No
 * React and no DOM.
 *
 * Only `export *` here: bun drops an entry's named re-exports when the
 * package is `sideEffects: false`, so `headless.ts` holds the list.
 */
export * from './headless.js';
