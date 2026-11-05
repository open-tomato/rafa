/**
 * The command line of `scripts/survey/test-index.ts`: the four modes it
 * asks for and the five flags that pick them. {@link parseMode} reads the
 * arguments after the script's path, in any order, into the survey (no
 * argument), the record (`--baseline --map=<file>`), the guard
 * (`--against=<record> --map=<file>`) or the re-key
 * (`--rekey=<record> --map=<file>`, with `--dry-run` as its one boolean),
 * and refuses any other line with the usage text it prints. Every mode
 * reads it: `test-index.ts` calls it once when run as a script, and hands
 * the mode on to `main`, `guard` or `rekey` (`test-index-rekey.ts`).
 */

/** The record mode, with the map it reads. */
export interface BaselineMode {
  /** Always `true`: the mode writes the record. */
  readonly baseline: true;
  /** The map's path, absolute or relative to the repository root. */
  readonly map: string;
}

/** The guard, with the record and the map it reads. */
export interface AgainstMode {
  /** The record's path, absolute or relative to the repository root. */
  readonly against: string;
  /** The map's path, absolute or relative to the repository root. */
  readonly map: string;
}

/** The re-key, with the record it rewrites, the map it reads and whether it writes. */
export interface RekeyMode {
  /** The record's path, absolute or relative to the repository root. */
  readonly rekey: string;
  /** The map's path, absolute or relative to the repository root. */
  readonly map: string;
  /** Whether to print the lines and write nothing (`--dry-run`). */
  readonly dryRun: boolean;
}

/** A mode that writes files: the survey's two, or the record. */
export type WritingMode = 'survey' | BaselineMode;

/** What a command line asks for: the survey's files, the record, the guard, or the re-key. */
export type TestIndexMode = WritingMode | AgainstMode | RekeyMode;

/** The flag that picks the record mode. */
export const BASELINE_FLAG = '--baseline';

/** The flag that picks the guard, up to the record's path. */
export const AGAINST_FLAG = '--against=';

/** The flag that picks the re-key, up to the record's path. */
export const REKEY_FLAG = '--rekey=';

/** The re-key's one boolean: print its lines and write nothing. */
export const DRY_RUN_FLAG = '--dry-run';

/** The flag that names the map each mode but the survey reads, up to the map's path. */
export const MAP_FLAG = '--map=';

/**
 * The value after `flag` in `arg`, when `arg` opens with it and holds one.
 *
 * @param arg - One argument.
 * @param flag - A flag that takes its value after `=`.
 * @returns The value, or `undefined` when `arg` is not the flag or holds no value.
 */
function flagValue(arg: string, flag: string): string | undefined {
  return arg.startsWith(flag) && arg.length > flag.length
    ? arg.slice(flag.length)
    : undefined;
}

/** The arguments a command line holds, each read once. */
interface ParsedArgs {
  readonly baseline: boolean;
  readonly against: string | undefined;
  readonly rekey: string | undefined;
  readonly dryRun: boolean;
  readonly map: string | undefined;
}

/**
 * Reads each argument as one of the five flags, refusing any other and
 * any flag passed twice.
 *
 * @param args - The arguments after the script's path.
 * @param usage - The refusal's text for an argument that is none of them.
 * @returns The flags read.
 * @throws When an argument is none of the flags, or one is passed twice.
 */
function readArgs(args: readonly string[], usage: string): ParsedArgs {
  let baseline = false;
  let against: string | undefined;
  let rekey: string | undefined;
  let dryRun = false;
  let map: string | undefined;
  for (const arg of args) {
    const againstValue = flagValue(arg, AGAINST_FLAG);
    const rekeyValue = flagValue(arg, REKEY_FLAG);
    const mapValue = flagValue(arg, MAP_FLAG);
    if (arg === BASELINE_FLAG && !baseline) {
      baseline = true;
    } else if (againstValue !== undefined && against === undefined) {
      against = againstValue;
    } else if (rekeyValue !== undefined && rekey === undefined) {
      rekey = rekeyValue;
    } else if (arg === DRY_RUN_FLAG && !dryRun) {
      dryRun = true;
    } else if (mapValue !== undefined && map === undefined) {
      map = mapValue;
    } else {
      throw new Error(usage);
    }
  }
  return { against, baseline, dryRun, map, rekey };
}

/**
 * The mode a command line asks for, its arguments in any order.
 *
 * @param args - The arguments after the script's path.
 * @returns `survey` when there is no argument, the map's path under `map`
 *   with `baseline` when the arguments are `--baseline` and
 *   `--map=<file>`, the record's path under `against` beside the map's
 *   when they are `--against=<record>` and `--map=<file>`, and the
 *   record's path under `rekey` beside the map's, with `dryRun` telling
 *   whether `--dry-run` was passed, when they are `--rekey=<record>` and
 *   `--map=<file>`.
 * @throws When any other argument is passed, one twice, more than one of
 *   `--baseline`, `--against=` and `--rekey=`, a flag ending in `=` with no
 *   path, `--dry-run` without `--rekey=<record>`, a mode without
 *   `--map=<file>`, or `--map=<file>` alone.
 */
export function parseMode(args: readonly string[]): TestIndexMode {
  if (args.length === 0) {
    return 'survey';
  }
  const usage = `unknown arguments: ${args.join(' ')}. Usage: bun scripts/survey/test-index.ts `
    + `[${BASELINE_FLAG} ${MAP_FLAG}<file> | ${AGAINST_FLAG}<record> ${MAP_FLAG}<file>`
    + ` | ${REKEY_FLAG}<record> ${MAP_FLAG}<file> [${DRY_RUN_FLAG}]]`;
  const { against, baseline, dryRun, map, rekey } = readArgs(args, usage);
  const modeCount = [baseline, against !== undefined, rekey !== undefined].filter(Boolean).length;
  if (modeCount > 1 || (dryRun && rekey === undefined)) {
    throw new Error(usage);
  }
  if (modeCount === 0) {
    throw new Error(`${MAP_FLAG}<file> names the map of ${BASELINE_FLAG}, ${AGAINST_FLAG}<record> or ${REKEY_FLAG}<record>, and none was passed`);
  }
  if (map === undefined) {
    throw new Error(`${modeFlag(baseline, against)} reads the map: pass ${MAP_FLAG}<file> beside it`);
  }
  if (rekey !== undefined) {
    return { dryRun, map, rekey };
  }
  return against === undefined
    ? { baseline: true, map }
    : { against, map };
}

/**
 * The flag that picked the one mode a command line holds, as a refusal names it.
 *
 * @param baseline - Whether `--baseline` was passed.
 * @param against - The record's path after `--against=`, when passed.
 * @returns `--baseline`, `--against=<record>`, or `--rekey=<record>` when neither.
 */
function modeFlag(baseline: boolean, against: string | undefined): string {
  if (baseline) {
    return BASELINE_FLAG;
  }
  return against === undefined
    ? `${REKEY_FLAG}<record>`
    : `${AGAINST_FLAG}<record>`;
}
