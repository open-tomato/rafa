/**
 * `bun scripts/build.ts`: the JavaScript half of `bun run build`. Bundles
 * the two entries into dist/ (ESM, browser, shared chunks), every package
 * external.
 *
 * `@open-tomato/charts` is kept external by a resolve hook: tsconfig
 * `paths` maps it to the sibling package's source, and bun's resolver
 * follows `paths` ahead of `--packages external` and `--external`, so the
 * CLI flags alone would bundle the charts package into this one.
 */
import type { BunPlugin } from 'bun';

/** The entries, one per subpath export. */
const ENTRIES = ['./src/index.ts', './src/contract/index.ts'];

/** Imports of the sibling charts package, with or without a subpath. */
const CHARTS = /^@open-tomato\/charts(\/.*)?$/;

const keepChartsExternal: BunPlugin = {
  name: 'keep-charts-external',
  setup(build) {
    build.onResolve({ filter: CHARTS }, (args) => ({ path: args.path, external: true }));
  },
};

const result = await Bun.build({
  entrypoints: ENTRIES,
  root: './src',
  outdir: './dist',
  target: 'browser',
  format: 'esm',
  splitting: true,
  packages: 'external',
  naming: { chunk: '[name]-[hash].[ext]' },
  plugins: [keepChartsExternal],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const output of result.outputs) console.info(`  ${output.path.slice(output.path.indexOf('/dist/') + 1)}  ${output.size} bytes`);
