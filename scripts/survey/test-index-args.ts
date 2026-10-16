/**
 * The command line of `scripts/survey/test-index.ts`: the three modes it
 * asks for and the three flags that pick them. {@link parseMode} reads the
 * arguments after the script's path, in any order, into the survey (no
 * argument), the record (`--baseline --map=<file>`) or the guard
 * (`--against=<record> --map=<file>`), and refuses any other line with the
 * usage text it prints. Every mode reads it: `test-index.ts` calls it once
 * when run as a script, and hands the mode on to `main` or `guard`.
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

/** A mode that writes files: the survey's two, or the record. */
export type WritingMode = 'survey' | BaselineMode;

/** What a command line asks for: the survey's files, the record, or the guard. */
export type TestIndexMode = WritingMode | AgainstMode;

/** The flag that picks the record mode. */
export const BASELINE_FLAG = '--baseline';

/** The flag that picks the guard, up to the record's path. */
export const AGAINST_FLAG = '--against=';

/** The flag that names the map either mode reads, up to the map's path. */
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
  readonly map: string | undefined;
}

/**
 * Reads each argument as one of the three flags, refusing any other and
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
  let map: string | undefined;
  for (const arg of args) {
    const againstValue = flagValue(arg, AGAINST_FLAG);
    const mapValue = flagValue(arg, MAP_FLAG);
    if (arg === BASELINE_FLAG && !baseline) {
      baseline = true;
    } else if (againstValue !== undefined && against === undefined) {
      against = againstValue;
    } else if (mapValue !== undefined && map === undefined) {
      map = mapValue;
    } else {
      throw new Error(usage);
    }
  }
  return { against, baseline, map };
}

/**
 * The mode a command line asks for, its arguments in any order.
 *
 * @param args - The arguments after the script's path.
 * @returns `survey` when there is no argument, the map's path under `map`
 *   with `baseline` when the arguments are `--baseline` and
 *   `--map=<file>`, and the record's path under `against` beside the
 *   map's when they are `--against=<record>` and `--map=<file>`.
 * @throws When any other argument is passed, one twice, `--baseline` with
 *   `--against=`, a flag ending in `=` with no path, either mode without
 *   `--map=<file>`, or `--map=<file>` alone.
 */
export function parseMode(args: readonly string[]): TestIndexMode {
  if (args.length === 0) {
    return 'survey';
  }
  const usage = `unknown arguments: ${args.join(' ')}. Usage: bun scripts/survey/test-index.ts `
    + `[${BASELINE_FLAG} ${MAP_FLAG}<file> | ${AGAINST_FLAG}<record> ${MAP_FLAG}<file>]`;
  const { against, baseline, map } = readArgs(args, usage);
  if (baseline && against !== undefined) {
    throw new Error(usage);
  }
  if (!baseline && against === undefined) {
    throw new Error(`${MAP_FLAG}<file> names the map of ${BASELINE_FLAG} or ${AGAINST_FLAG}<record>, and neither was passed`);
  }
  const flag = baseline
    ? BASELINE_FLAG
    : `${AGAINST_FLAG}<record>`;
  if (map === undefined) {
    throw new Error(`${flag} reads the map: pass ${MAP_FLAG}<file> beside it`);
  }
  return against === undefined
    ? { baseline: true, map }
    : { against, map };
}
