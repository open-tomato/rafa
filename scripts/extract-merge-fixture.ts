/**
 * Merge fixture extract: the command line of
 * `src/effort/store/fixture-extract.ts`, whose module note is the long
 * form of what is replaced, what is kept and what is sampled.
 *
 * Usage:
 *   bun scripts/extract-merge-fixture.ts <store-a> <store-b> --out=<dir> [--per-side=<n>]
 *
 * It reads the two SQLite store files read-only in one run, and writes
 * `a.json`, `b.json` and `summary.json` under `<dir>`, making it when
 * absent and refusing to replace a file already there. `--per-side` is
 * how many rows past the divergence each side keeps per merged table, 200
 * unless given. Every placeholder is keyed by a random key drawn for the
 * run and never written, so a second run gives different placeholders.
 *
 * Run it over copies, never over the live store: `bun src/rafa.ts effort
 * copy --to=<dir>` makes one. The extract lands in a scratch directory
 * for a person to review; nothing here commits it.
 *
 * Every line goes out after `[extract] `: one per table with its counts
 * and one per file written to stdout, a failure to stderr.
 *
 * Exit codes: 0 written, 2 the extract could not run.
 */
import type { Extract } from '../src/effort/store/fixture-extract.js';

import { resolve } from 'node:path';

import { messageOf } from '../src/config-sections.js';
import { DEFAULT_PER_SIDE, extractStores, writeExtract } from '../src/effort/store/fixture-extract.js';

/** Prefix on every line this script writes. */
export const TAG = '[extract]';

/** The exit code of a written extract. */
export const EXIT_WRITTEN = 0;

/** The exit code of an extract that could not run. */
export const EXIT_COULD_NOT_RUN = 2;

/** The usage line a refused argument list is answered with. */
export const USAGE = 'usage: bun scripts/extract-merge-fixture.ts <store-a> <store-b> --out=<dir> [--per-side=<n>]';

/** What the script's words ask for, every path absolute. */
export interface ExtractArgs {
  readonly pathA: string;
  readonly pathB: string;
  readonly outDir: string;
  readonly perSide: number;
}

/** The value of `--<name>=`, or null when the word is not that flag. */
function flagValue(word: string, name: string): string | null {
  const prefix = `--${name}=`;
  return word.startsWith(prefix)
    ? word.slice(prefix.length)
    : null;
}

/** The whole number `text` spells, or a throw naming it. */
function wholeNumber(text: string): number {
  if (!/^\d+$/.test(text)) throw new Error(`--per-side=${text} is not a whole number; ${USAGE}`);
  return Number(text);
}

/**
 * Reads the script's words, resolving paths against `cwd`. Throws with
 * the usage line on a missing or unknown word, before anything is read.
 */
export function readExtractArgs(argv: readonly string[], cwd: string = process.cwd()): ExtractArgs {
  const stores = argv.filter((word) => !word.startsWith('--'));
  const outs = argv.flatMap((word) => flagValue(word, 'out') ?? []);
  const perSides = argv.flatMap((word) => flagValue(word, 'per-side') ?? []);
  const unknown = argv.filter((word) => word.startsWith('--') && flagValue(word, 'out') === null && flagValue(word, 'per-side') === null);
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(' ')}; ${USAGE}`);
  const [pathA, pathB] = stores;
  if (stores.length !== 2 || pathA === undefined || pathB === undefined) {
    throw new Error(`expected two store files, got ${String(stores.length)}; ${USAGE}`);
  }
  const [outDir] = outs;
  if (outs.length !== 1 || outDir === undefined || outDir === '') throw new Error(`expected one --out=<dir>; ${USAGE}`);
  if (perSides.length > 1) throw new Error(`expected at most one --per-side=<n>; ${USAGE}`);
  const [perSide] = perSides;
  return {
    pathA: resolve(cwd, pathA),
    pathB: resolve(cwd, pathB),
    outDir: resolve(cwd, outDir),
    perSide: perSide === undefined
      ? DEFAULT_PER_SIDE
      : wholeNumber(perSide),
  };
}

/** The per-table count lines of `extract`. */
export function summaryLines(extract: Extract): string[] {
  return extract.summary.map(({ table, rowsA, rowsB, overlap, keptA, keptB }) => (
    `${TAG} ${table}: rows A ${String(rowsA)}, B ${String(rowsB)}; overlap ${String(overlap)};`
      + ` kept A ${String(keptA)}, B ${String(keptB)}`
  ));
}

/** Runs one extract over `args`, writing its lines to `log`, and answers the exit code. */
export function runExtract(args: ExtractArgs, log: (line: string) => void): number {
  const extract = extractStores(args.pathA, args.pathB, args.perSide);
  const written = writeExtract(extract, args.outDir);
  for (const line of summaryLines(extract)) log(line);
  for (const path of written) log(`${TAG} wrote ${path}`);
  return EXIT_WRITTEN;
}

if (import.meta.main) {
  let code = EXIT_COULD_NOT_RUN;
  try {
    code = runExtract(readExtractArgs(process.argv.slice(2)), (line) => console.log(line));
  } catch (err) {
    console.error(`${TAG} FAIL — ${messageOf(err)}`);
  }
  process.exit(code);
}
