/**
 * Reads the words of a command line into positional words and flags.
 *
 * Copied from open-tomato's `packages/shared/cli-core/src/parseArgs.ts` at
 * commit `c4785a4cb04196e952d935791069483936600be8` (2026-06-25).
 * `types.ts` beside this module says why the package is copied.
 *
 * ## How a line is read
 *
 * The source's rules, unchanged. `--name=value` and `-n=value` carry the
 * text after the first `=`, which may be empty. `--name value` and
 * `-n value` take the next word as the value unless it opens with `-`.
 * A bare `--name` or `-n` is `true`, and `--no-name` is `false` for
 * `name`, while `--no-name=value` is the flag `no-name`. A lone `-` is a
 * positional word, and every word after the first `--` is one. A flag
 * given twice keeps the later value. Every value is a string: no word is
 * converted to the type a spec declares, and no flag or argument a spec
 * marks `required` is refused when the line leaves it out.
 *
 * ## What the copy changes
 *
 * `parseArgs` takes an optional spec, a command's `args` and `flags`
 * (a `CliCommand` is one). With no spec, or one declaring no alias and no
 * default, it answers what the source answers for every line.
 *
 * Each alias of a declared flag is another spelling of its name. A flag
 * spelled as an alias is recorded under the name, whether it carries a
 * value, stands bare, or is negated as `--no-<alias>`, so under `plan`
 * with the alias `p` both `-p PLAN.md` and `--plan=PLAN.md` answer
 * `flags.plan`. The source reads `-p` and `--p` as the same flag, so an
 * alias answers to either. Of a name and an alias both on the line, the
 * later wins, as for a flag given twice. No word after `--` is read as an
 * alias.
 *
 * Defaults are filled once the line is read. A declared flag the line
 * gives no value, bare or negated values included, takes its default: a
 * number as its string, which is what the same number typed on the line
 * reads as, and a string or a boolean as it is. Each declared argument
 * past the words given takes its default as a string, in order, until
 * one declares none: an argument's place is its only spelling, so a later
 * default has nowhere to go while an earlier word is missing.
 *
 * A spec that cannot be read is refused with a `TypeError` before the line
 * is: one spelling claimed by two flags, as a name and an alias or as an
 * alias of each, and an argument declaring `aliases`. A positional word
 * has no spelling for an alias to stand for, so the declaration would
 * promise a behaviour nothing gives. An alias spelled as its own flag's
 * name, and an empty alias list, are no refusal.
 */
import type { ArgSpec, FlagSpec } from './types.js';

/** What every refusal opens with. */
const REFUSAL = 'parseArgs';

/** A line read into positional words and flags. */
export interface ParseArgsResult {
  /** The positional words, in order, with any declared default filled in after them. */
  positional: string[];
  /** The flags by name: a value, `true` for a bare flag, `false` for `--no-<name>`. */
  flags: Record<string, string | boolean>;
}

/** What a line is read against: a command's arguments and flags. A `CliCommand` is one. */
export interface ParseArgsSpec {
  /** The positional arguments, in the order the line gives them. */
  args?: readonly ArgSpec[];
  /** The flags, whose aliases and defaults are read. */
  flags?: readonly FlagSpec[];
}

/** Refuses an argument declaring any alias. */
function refuseArgumentAliases(args: readonly ArgSpec[]): void {
  for (const arg of args) {
    if ((arg.aliases ?? []).length > 0) {
      throw new TypeError(
        `${REFUSAL}: argument "${arg.name}" declares aliases, and a positional argument has no spelling for one to stand for`,
      );
    }
  }
}

/** Each spelling a flag spec declares, names first, mapped to the name it is read as. */
function spellingsOf(flags: readonly FlagSpec[]): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  const claim = (spelling: string, name: string): void => {
    const owner = owners.get(spelling);
    if (owner !== undefined && owner !== name) {
      throw new TypeError(`${REFUSAL}: the spelling "${spelling}" names both flag "${owner}" and flag "${name}"`);
    }
    owners.set(spelling, name);
  };
  for (const flag of flags) claim(flag.name, flag.name);
  for (const flag of flags) {
    for (const alias of flag.aliases ?? []) claim(alias, flag.name);
  }
  return owners;
}

/**
 * Reads the words of `argv` by the source's rules, handing each flag to
 * `record` as it was spelled and answering the positional words.
 */
function readLine(argv: readonly string[], record: (spelling: string, value: string | boolean) => void): string[] {
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (word === undefined) continue;
    if (word === '--') {
      for (const rest of argv.slice(i + 1)) {
        if (rest !== undefined) positional.push(rest);
      }
      break;
    }
    const isLong = word.startsWith('--');
    if (!isLong && !(word.startsWith('-') && word.length > 1)) {
      positional.push(word);
      continue;
    }
    const body = word.slice(isLong
      ? 2
      : 1);
    const eqIndex = body.indexOf('=');
    const next = argv[i + 1];
    if (eqIndex !== -1) {
      record(body.slice(0, eqIndex), body.slice(eqIndex + 1));
    } else if (isLong && body.startsWith('no-') && body.length > 3) {
      record(body.slice(3), false);
    } else if (next !== undefined && !next.startsWith('-')) {
      record(body, next);
      i++;
    } else {
      record(body, true);
    }
  }
  return positional;
}

/**
 * Reads `argv` into positional words and flags, applying the aliases and
 * the defaults `spec` declares; see the module note. Throws a `TypeError`
 * naming what `spec` declares that cannot be read.
 */
export function parseArgs(argv: readonly string[], spec: ParseArgsSpec = {}): ParseArgsResult {
  const { args = [], flags: flagSpecs = [] } = spec;
  refuseArgumentAliases(args);
  const spellings = spellingsOf(flagSpecs);

  const flags: Record<string, string | boolean> = {};
  const positional = readLine(argv, (spelling, value) => {
    flags[spellings.get(spelling) ?? spelling] = value;
  });

  for (const flag of flagSpecs) {
    if (flag.default === undefined || Object.hasOwn(flags, flag.name)) continue;
    flags[flag.name] = typeof flag.default === 'number'
      ? String(flag.default)
      : flag.default;
  }
  for (const arg of args.slice(positional.length)) {
    if (arg.default === undefined) break;
    positional.push(String(arg.default));
  }

  return { positional, flags };
}
