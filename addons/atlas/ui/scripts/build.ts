/**
 * `bun scripts/build.ts`: the JavaScript half of `bun run build`. Bundles
 * the two entries into dist/ (ESM, browser, shared chunks), every package
 * external, `@open-tomato/charts` among them.
 */

/** The entries, one per subpath export. */
const ENTRIES = ['./src/index.ts', './src/contract/index.ts'];

const result = await Bun.build({
  entrypoints: ENTRIES,
  root: './src',
  outdir: './dist',
  target: 'browser',
  format: 'esm',
  splitting: true,
  packages: 'external',
  naming: { chunk: '[name]-[hash].[ext]' },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const output of result.outputs) console.info(`  ${output.path.slice(output.path.indexOf('/dist/') + 1)}  ${output.size} bytes`);
