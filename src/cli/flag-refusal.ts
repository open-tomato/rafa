/**
 * The flag words of a routed command's line that the command does not
 * declare, and the refusal naming them (#1267).
 *
 * ## Which words are refused
 *
 * A flag word is read the way `parseArgs`
 * (`packages/rafa/src/core/command/parseArgs.ts`) reads it: a word opening
 * with `--`, or with `-` and longer than the `-` alone, ahead of the first
 * `--`. Its name is the text after the dashes up to the first `=`, and a
 * `--no-<name>` word carrying no `=` is read as `<name>` negated. Every
 * word after the first `--` is positional and never refused, and a value
 * `parseArgs` takes for a flag never opens with `-`, so it is never read
 * as a flag word here.
 *
 * A flag word is accepted when its name, read so, is one of these:
 *
 *   - a flag the command declares, or an alias of one;
 *   - negated, a declared flag or alias whose type is `boolean`;
 *   - not negated, one of {@link GLOBAL_FLAG_NAMES}.
 *
 * Every other flag word is undeclared. `--no-output` is refused, since
 * `output` is a global name carrying a value and no boolean. `--help`
 * and `-h` are not global names here: routing answers a help request
 * before a command is assembled, so no line this module reads holds one.
 *
 * ## The message
 *
 * {@link unknownFlagMessage} names each undeclared flag word as typed, in
 * the order first typed and once each, then the command's declared flags
 * as `--<name>`, and {@link unknownFlagHint} points at the command's help:
 *
 *   unknown flags "--dry-run", "--bogus" for "rafa release tag"; its flags are --push, --force
 *   hint: run rafa release tag --help for its flags
 *
 * Both name the command by its canonical spelling, unless the caller
 * hands the spelling its line was routed by: a module command mounted
 * under `module exec` is reached as `rafa module exec <module> <action>`,
 * its own subject routing nothing, and the dispatcher hands that.
 */
import type { RafaCommand, RafaFlagSpec } from '@open-tomato/rafa/core/command';

import { commandSpelling, GLOBAL_FLAGS } from '@open-tomato/rafa/core/command';

/** What opens a negated long flag's name, `--no-plan` for `plan`. */
const NEGATION = 'no-';

/** The word after which every word is positional. */
const FLAGS_END = '--';

/** One spelling of a global flag as `GLOBAL_FLAGS` writes it, read as the name `parseArgs` gives it. */
function globalName(spelling: string): string {
  return spelling.replace(/^-+/u, '').split('=')[0] ?? '';
}

/**
 * The names every command reads beside its own flags, `output`,
 * `verbose`, `v` and `version`, read off the spellings
 * {@link GLOBAL_FLAGS} lists for the root help, so the two never differ.
 */
export const GLOBAL_FLAG_NAMES: readonly string[] = Object.freeze([
  ...new Set(GLOBAL_FLAGS.flatMap((flag) => flag.spelling.split(', ').map(globalName))),
]);

/** A flag word's name as `parseArgs` reads it, and whether it was typed negated. */
interface FlagName {
  readonly name: string;
  readonly negated: boolean;
}

/** Whether `parseArgs` reads `word`, typed ahead of any `--`, as a flag. */
function isFlagWord(word: string): boolean {
  return word.startsWith('--') || (word.startsWith('-') && word.length > 1);
}

/** The name `parseArgs` reads a flag word as. */
function flagName(word: string): FlagName {
  const isLong = word.startsWith('--');
  const body = word.slice(isLong
    ? 2
    : 1);
  const eqIndex = body.indexOf('=');
  if (eqIndex !== -1) return { name: body.slice(0, eqIndex), negated: false };
  if (isLong && body.startsWith(NEGATION) && body.length > NEGATION.length) {
    return { name: body.slice(NEGATION.length), negated: true };
  }
  return { name: body, negated: false };
}

/** Each spelling of a declared flag, its name and its aliases, mapped to the flag. */
function declaredSpellings(flags: readonly RafaFlagSpec[]): ReadonlyMap<string, RafaFlagSpec> {
  const spellings = new Map<string, RafaFlagSpec>();
  for (const flag of flags) {
    for (const spelling of [flag.name, ...(flag.aliases ?? [])]) spellings.set(spelling, flag);
  }
  return spellings;
}

/** Whether a flag word's name is one the command reads; see the module note. */
function accepted(read: FlagName, spellings: ReadonlyMap<string, RafaFlagSpec>): boolean {
  const flag = spellings.get(read.name);
  if (read.negated) return flag?.type === 'boolean';
  return flag !== undefined || GLOBAL_FLAG_NAMES.includes(read.name);
}

/**
 * The flag words of `line` that `command` does not declare, as typed, in
 * the order first typed and once each; empty when every flag word is
 * accepted. See the module note for what is accepted.
 */
export function undeclaredFlags(line: readonly string[], command: Pick<RafaCommand, 'flags'>): string[] {
  const spellings = declaredSpellings(command.flags);
  const undeclared = new Set<string>();
  for (const word of line) {
    if (word === FLAGS_END) break;
    if (!isFlagWord(word) || accepted(flagName(word), spellings)) continue;
    undeclared.add(word);
  }
  return [...undeclared];
}

/** The words quoted and joined, `"--a", "--b"`. */
function quoted(words: readonly string[]): string {
  return words.map((word) => `"${word}"`).join(', ');
}

/**
 * The refusal's message: each undeclared flag word as typed, then the
 * command's declared flags as `--<name>`, naming the command as
 * `spelling`, its canonical spelling unless handed one; see the module
 * note.
 */
export function unknownFlagMessage(
  command: Pick<RafaCommand, 'subject' | 'action' | 'flags'>,
  undeclared: readonly string[],
  spelling: string = commandSpelling(command),
): string {
  const noun = undeclared.length === 1
    ? 'flag'
    : 'flags';
  const declared = command.flags.length === 0
    ? 'it declares no flags'
    : `its flags are ${command.flags.map((flag) => `--${flag.name}`).join(', ')}`;
  return `unknown ${noun} ${quoted(undeclared)} for "rafa ${spelling}"; ${declared}`;
}

/**
 * The refusal's hint, pointing at the command's help, spelled as
 * `spelling`, its canonical spelling unless handed one.
 */
export function unknownFlagHint(
  command: Pick<RafaCommand, 'subject' | 'action'>,
  spelling: string = commandSpelling(command),
): string {
  return `run rafa ${spelling} --help for its flags`;
}
