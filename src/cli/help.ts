/**
 * The help rafa prints, at three levels, rendered from the `RafaCommand`
 * declarations of the dispatcher's registry.
 *
 * The CLI surface spec asks for one renderer for all three levels, fed
 * from `RafaCommand` and tested with snapshots. {@link renderHelp} is that
 * renderer, and `src/rafa.ts` hands it to `dispatch`. It reads the
 * request and the registry it is handed and nothing else: no roster of
 * its own, no file and no environment. So every command a level names is
 * one the same registry dispatches.
 *
 * ## The three levels
 *
 *   - `rafa --help`: the tagline, the usage lines, a quick start, each
 *     subject with its summary, the top-level commands by name, the
 *     global flags, and the spend legend.
 *   - `rafa <subject> --help`: the subject's summary, its usage lines,
 *     each action with its summary, and two examples across the subject.
 *   - `rafa <subject> <action> --help`: the action's summary, its
 *     deprecation when it declares one, a usage line built from its
 *     `args` and `flags`, its description, what it spends when it
 *     declares `spends`, a table of its arguments and one of its flags,
 *     its examples, its outputs, and the other actions of its subject
 *     under `See also`.
 *
 * Each level opens with a title line, `<spelling> — <summary>`, and every
 * other block is a heading line ending in `:` with its lines indented
 * under it. A block with nothing to list is left out: no `Arguments` for
 * a command declaring none, no `See also` for a top-level command.
 *
 * ## What is derived rather than drawn
 *
 * The spec draws the root help by hand, quick start included. Here the
 * quick start is derived, so it cannot name a command that does not
 * dispatch. It is the first example of each subject's first action, in
 * roster order, then the first example of each top-level command. A
 * subject's two examples are taken across its actions: the first example
 * of each action in roster order, then the second of each, until two are
 * taken.
 *
 * The global flags are {@link GLOBAL_FLAGS}: the two `assembleContext`
 * reads for every command, and `--version`, which routing reads and which
 * takes no subject beside it (`route.ts`). The spec's `--runtime=<v>` is
 * left out: `loop start` alone reads it, and declares it, since a flag
 * typed ahead of the subject never reaches the words a wrapped command is
 * handed.
 *
 * A hidden action is in no roster. It is left out of its subject's
 * actions and examples, the quick start, the top-level commands and every
 * `See also`. Its own help still renders, since it still dispatches.
 *
 * ## The spend mark
 *
 * A command declaring `spends` (`./spends.ts`) carries a mark at the END
 * of its roster line, after its summary, so the column the summaries
 * align on is untouched by the glyph's two columns. An action's line in
 * its subject's help, and a top-level command's name in the root
 * `Commands:` list, carry `spendsMark`: the bare `🪙` for `always` and
 * `through`, and `🪙 with --resolve` or `🪙 unless --no-model` for a
 * form naming a flag. A subject's line in the root help carries the bare
 * mark when any visible action of the subject declares `spends`; a hidden
 * one does not mark it. The root help closes on {@link SPENDS_LEGEND},
 * after the global flags, when any visible command declares `spends`.
 *
 * The mark is wrapped as ONE word: its space is never a break, so a
 * summary that wraps carries `🪙 with --resolve` whole onto the next line
 * rather than leaving the glyph behind its condition. `🪙` is two UTF-16
 * units wide and two terminal columns, so the width counted by `length`
 * is the width printed.
 *
 * An action's own help carries a `Spends:` block after its description,
 * one line wrapped at the block's indent: the mark, then `what`. For a
 * form naming a flag the mark ends in a colon, `🪙 with --resolve: runs a
 * small fixed plan through the loop`, and for `always` and `through` it
 * is the bare glyph, `🪙 one planning session`. The mark is one word here
 * too. An action declaring nothing has no `Spends:` block.
 *
 * ## The usage line and the tables
 *
 * A required argument is `<name>` and an optional one `[name]`. A flag
 * taking a value is `--name=<type>`, sitting in `[]` unless it is
 * required. A boolean flag takes no value, and one defaulting to true is
 * spelled `--no-<name>`, the one spelling that changes it. Each alias
 * comes ahead of the name, joined by `|`: an alias of one letter as `-p`
 * and a longer one as `--pl`. `parseArgs` reads a word typed with one
 * dash or two as the same flag.
 *
 * A table row is the argument's name, or the flag's spellings joined by
 * `, `, then its type, `required` when it is, and its default, with the
 * description wrapped on the lines below. A string default is quoted.
 *
 * ## Layout
 *
 * Prose is wrapped on spaces at {@link HELP_WIDTH} columns. An example's
 * command is never wrapped, so it is copied whole, and a word longer than
 * the width stands alone on its line. No line ends in a space, no two
 * blank lines are adjacent, and the text ends in one newline.
 *
 * ## Snapshots
 *
 * `src/cli/testdata/help/` holds what `rafa --help`, `rafa loop --help`,
 * `rafa loop start --help` and `rafa next --help` print over the core
 * registry, and `help.test.ts` holds this renderer to them. They are
 * written afresh only when `RAFA_UPDATE_HELP_SNAPSHOTS=1` is set, so a
 * change to a core command's declaration, or to a default it reads from
 * a constant, goes red until they are regenerated and the diff read.
 */
import type { CommandExample, RafaCommand } from './command.js';
import type { ArgSpec, FlagSpec } from './core/types.js';
import type { CommandRegistry, SubjectSpec } from './registry.js';
import type { HelpRequest } from './route.js';

import { isTopLevel } from './command.js';
import { mountKey } from './registry.js';
import { SPENDS_GLYPH, spendsCondition, spendsMark } from './spends.js';

/** The column help's prose is wrapped at. */
export const HELP_WIDTH = 80;

/** What rafa is: the root help's title line after `rafa — `. */
export const HELP_TAGLINE = 'run a plan through the ralph loop, one task per session';

/** How many examples a subject's help lists. */
export const SUBJECT_EXAMPLES = 2;

/** A flag every command reads, as the root help lists it. */
export interface GlobalFlag {
  /** The spellings, as a person types them. */
  readonly spelling: string;
  /** What the flag does, in a phrase. */
  readonly note: string;
}

/**
 * The flags the root help lists: the two `assembleContext` reads for
 * every command, typed ahead of the subject or after the action, then
 * `--version`, which `routeLine` reads and which is typed alone.
 */
export const GLOBAL_FLAGS: readonly GlobalFlag[] = Object.freeze([
  { spelling: '--output=json', note: 'NDJSON events instead of text (also RAFA_OUTPUT=json)' },
  { spelling: '-v, --verbose', note: 'repeat for more, up to 3; --verbose=N (also RAFA_VERBOSITY=N)' },
  { spelling: '--version', note: 'print "rafa <version>" and exit; typed alone, no short form' },
]);

/** The root help's closing line, saying what the spend mark means. */
export const SPENDS_LEGEND = `${SPENDS_GLYPH}  starts Claude Code sessions, which spend your Claude usage`;

/** The indent of a block's lines under its heading. */
const INDENT = '  ';

/** The indent of a note or a description under a row. */
const NOTE_INDENT = '      ';

/** The indent a wrapped usage line continues at. */
const USAGE_CONTINUATION = '    ';

/** The spaces between a row's left column and its right, past the longest left. */
const GAP = 3;

/** The fewest columns wrapped text is given, however deep its indent. */
const MIN_TEXT_WIDTH = 20;

/** A help request for one action. */
type ActionRequest = Extract<HelpRequest, { level: 'action' }>;

/**
 * A row of two columns: the left, and the text beside it, which may be
 * empty, then a spend mark wrapped as one word, or null for none.
 */
type Row = readonly [left: string, right: string, mark?: string | null];

/** A table row: the left column, the attributes beside it, and the description below. */
type TableRow = readonly [left: string, attributes: string, description: string];

/** The words of `text`, split on whitespace. */
function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((part) => part !== '');
}

/**
 * `words` packed into lines, the first at most `first` columns wide and
 * each later one at most `rest`. A longer word stands alone. A word may
 * hold a space, and is never split at it: that is how a spend mark stays
 * whole.
 */
function pack(words: readonly string[], first: number, rest: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const width = lines.length === 0
      ? first
      : rest;
    if (line === '') {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  return line === ''
    ? lines
    : [...lines, line];
}

/**
 * `words` wrapped after `prefix` on their first line and after `indent` on
 * each later one, or no line when there are none.
 */
function hangWords(prefix: string, words: readonly string[], indent = prefix): string[] {
  const width = (used: string): number => Math.max(HELP_WIDTH - used.length, MIN_TEXT_WIDTH);
  return pack(words, width(prefix), width(indent)).map((line, index) => (index === 0
    ? `${prefix}${line}`
    : `${indent}${line}`));
}

/**
 * `text` wrapped after `prefix` on its first line and after `indent` on
 * each later one, or no line when `text` is empty.
 */
function hang(prefix: string, text: string, indent = prefix): string[] {
  return hangWords(prefix, wordsOf(text), indent);
}

/** The column a row's right text starts at: past the longest left that has a right, and the gap. */
function columnOf(rows: readonly Row[]): number {
  const lefts = rows.filter(([, right]) => right !== '').map(([left]) => left.length);
  return INDENT.length + Math.max(0, ...lefts) + GAP;
}

/** One row under a heading, its right text and its mark wrapped at `column`. */
function row([left, right, mark = null]: Row, column: number): string[] {
  const head = `${INDENT}${left}`;
  const words = mark === null
    ? wordsOf(right)
    : [...wordsOf(right), mark];
  return words.length === 0
    ? [head]
    : hangWords(head.padEnd(column), words, ' '.repeat(column));
}

/** The mark ending a command's roster line, or null for one declaring no `spends`. */
function markOf(command: RafaCommand): string | null {
  return command.spends === undefined
    ? null
    : spendsMark(command.spends);
}

/** The bare mark on a subject's line when any visible action of it spends, or null. */
function subjectMark(subject: SubjectSpec, registry: CommandRegistry): string | null {
  return registry.actionsOf(subject.name).some((action) => action.spends !== undefined)
    ? SPENDS_GLYPH
    : null;
}

/** A top-level command as the root `Commands:` list names it: its name, then its mark. */
function commandWord(command: RafaCommand): string {
  const mark = markOf(command);
  return mark === null
    ? command.subject
    : `${command.subject} ${mark}`;
}

/**
 * The lines of an action's `Spends:` block: its mark, a colon after a
 * condition, then `what`; none for an action declaring nothing.
 */
function spendsLines(command: RafaCommand): string[] {
  const { spends } = command;
  if (spends === undefined) return [];
  const mark = spendsCondition(spends) === null
    ? SPENDS_GLYPH
    : `${spendsMark(spends)}:`;
  return hangWords(INDENT, [mark, ...wordsOf(spends.what)]);
}

/** Rows under a heading, their right texts aligned. */
function rows(entries: readonly Row[]): string[] {
  const column = columnOf(entries);
  return entries.flatMap((entry) => row(entry, column));
}

/** A table's rows: each head aligned, each description wrapped below it. */
function table(entries: readonly TableRow[]): string[] {
  const column = columnOf(entries.map(([left, attributes]) => [left, attributes]));
  return entries.flatMap(([left, attributes, description]) => [
    ...row([left, attributes], column),
    ...hang(NOTE_INDENT, description),
  ]);
}

/** A heading and its lines, or nothing when there are no lines. */
function block(heading: string, lines: readonly string[]): string[] {
  return lines.length === 0
    ? []
    : [`${heading}:`, ...lines];
}

/** A level's title line: the spelling, and the summary after a dash. */
function title(spelling: string, summary: string): string[] {
  return summary.trim() === ''
    ? [spelling]
    : hang(`${spelling} — `, summary, INDENT);
}

/** An example: its command whole, and its note wrapped below. */
function exampleLines(example: CommandExample): string[] {
  return [`${INDENT}${example.cmd}`, ...hang(NOTE_INDENT, example.note)];
}

/** The blocks of a level joined by one blank line, ending in one newline. */
function joinBlocks(blocks: readonly (readonly string[])[]): string {
  const written = blocks.filter((lines) => lines.length > 0).map((lines) => lines.join('\n'));
  return `${written.join('\n\n')}\n`;
}

/** True when a value is not undefined. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** The root help; see the module note. */
function renderRoot(registry: CommandRegistry): string {
  const subjects = registry.subjects();
  const topLevel = registry.commands().filter(isTopLevel);
  const quickStart = [
    ...subjects.map((subject) => registry.actionsOf(subject.name)[0]?.examples[0]),
    ...topLevel.map((command) => command.examples[0]),
  ].filter(isDefined);
  return joinBlocks([
    title('rafa', HELP_TAGLINE),
    block('Usage', rows([
      ['rafa <subject> <action> [args] [flags]', ''],
      ['rafa <subject> --help', 'actions for a subject'],
      ['rafa <subject> <action> --help', 'arguments, flags, examples'],
    ])),
    block('Quick start', quickStart.map((example) => `${INDENT}${example.cmd}`)),
    block('Subjects', rows(subjects.map((subject) => [subject.name, subject.summary, subjectMark(subject, registry)]))),
    block('Commands', hangWords(INDENT, topLevel.map((command, index) => (index === topLevel.length - 1
      ? commandWord(command)
      : `${commandWord(command)},`)))),
    block('Global flags', rows(GLOBAL_FLAGS.map((flag) => [flag.spelling, flag.note]))),
    registry.commands().some((command) => command.spends !== undefined)
      ? [SPENDS_LEGEND]
      : [],
  ]);
}

/**
 * Up to `count` examples taken across `actions`: the first of each in
 * order, then the second of each, and so on.
 */
function examplesAcross(actions: readonly RafaCommand[], count: number): CommandExample[] {
  const depth = Math.max(0, ...actions.map((action) => action.examples.length));
  const rounds = Array.from({ length: depth }, (_, round) => actions.flatMap((action) => action.examples.slice(round, round + 1)));
  return rounds.flat().slice(0, count);
}

/** A subject's help; see the module note. */
function renderSubject(subject: SubjectSpec, registry: CommandRegistry): string {
  const actions = registry.actionsOf(subject.name);
  const spelling = `rafa ${subject.name}`;
  return joinBlocks([
    title(spelling, subject.summary),
    block('Usage', rows([
      [`${spelling} <action> [args] [flags]`, ''],
      [`${spelling} <action> --help`, 'arguments, flags, examples'],
    ])),
    block('Actions', rows(actions.map((action) => [action.action, action.summary, markOf(action)]))),
    block('Examples', examplesAcross(actions, SUBJECT_EXAMPLES).flatMap(exampleLines)),
  ]);
}

/** A flag's spellings, its aliases ahead of its name: `-p` for a one-letter alias, `--` before any other. */
function spellingsOf(flag: FlagSpec, negated: boolean): string[] {
  return [...(flag.aliases ?? []), flag.name].map((word) => {
    if (negated) return `--no-${word}`;
    return word.length === 1
      ? `-${word}`
      : `--${word}`;
  });
}

/** How the usage line spells a flag; see the module note. */
function flagUsage(flag: FlagSpec): string {
  const negated = flag.type === 'boolean' && flag.default === true;
  const spelled = spellingsOf(flag, negated).join('|');
  const typed = flag.type === 'boolean'
    ? spelled
    : `${spelled}=<${flag.type}>`;
  return flag.required === true
    ? typed
    : `[${typed}]`;
}

/** How the usage line spells an argument: `<name>` when required, `[name]` otherwise. */
function argUsage(arg: ArgSpec): string {
  return arg.required === true
    ? `<${arg.name}>`
    : `[${arg.name}]`;
}

/** A default as a table row shows it: a string quoted, anything else as it reads. */
function defaultText(value: string | boolean | number): string {
  return typeof value === 'string'
    ? JSON.stringify(value)
    : String(value);
}

/** A table row's attributes: the type, `required` when it is, and the default. */
function attributesOf(spec: ArgSpec | FlagSpec): string {
  const required = spec.required === true
    ? ['required']
    : [];
  const fallback = spec.default === undefined
    ? []
    : [`default ${defaultText(spec.default)}`];
  return [spec.type, ...required, ...fallback].join(', ');
}

/** An argument's table row: its name, its attributes and its description. */
function argRow(arg: ArgSpec): TableRow {
  return [arg.name, attributesOf(arg), arg.description];
}

/** A flag's table row: its spellings, its attributes and its description. */
function flagRow(flag: FlagSpec): TableRow {
  return [spellingsOf(flag, false).join(', '), attributesOf(flag), flag.description];
}

/**
 * The other actions of the action's subject or mount, each as it is typed.
 * None for a top-level command: `actionsOf` answers no top-level command
 * under a subject's name.
 */
function seeAlso(request: ActionRequest, registry: CommandRegistry): string[] {
  const { command, spelling, module } = request;
  const holder = module === null
    ? command.subject
    : mountKey(module.name);
  const words = spelling.split(' ');
  const prefix = words.slice(0, -1).join(' ');
  return registry.actionsOf(holder)
    .filter((other) => other.action !== command.action)
    .map((other) => `rafa ${prefix} ${other.action}`);
}

/** An action's help; see the module note. */
function renderAction(request: ActionRequest, registry: CommandRegistry): string {
  const { command, spelling } = request;
  const { deprecated } = command;
  const usage = [`rafa ${spelling}`, ...command.args.map(argUsage), ...command.flags.map(flagUsage)].join(' ');
  return joinBlocks([
    title(`rafa ${spelling}`, command.summary),
    block('Deprecated', deprecated === undefined
      ? []
      : hang(INDENT, `since ${deprecated.since}; use "rafa ${deprecated.use}"`)),
    block('Usage', hang(INDENT, usage, USAGE_CONTINUATION)),
    block('Description', hang(INDENT, command.description)),
    block('Spends', spendsLines(command)),
    block('Arguments', table(command.args.map(argRow))),
    block('Flags', table(command.flags.map(flagRow))),
    block('Examples', command.examples.flatMap(exampleLines)),
    block('Outputs', hang(INDENT, command.outputs.join(', '))),
    block('See also', hang(INDENT, seeAlso(request, registry).join(', '))),
  ]);
}

/**
 * The help text for a request, rendered from `registry`: the
 * `HelpRenderer` `src/rafa.ts` hands `dispatch`. See the module note.
 */
export function renderHelp(request: HelpRequest, registry: CommandRegistry): string {
  switch (request.level) {
    case 'root':
      return renderRoot(registry);
    case 'subject':
      return renderSubject(request.subject, registry);
    case 'action':
      return renderAction(request, registry);
  }
}
