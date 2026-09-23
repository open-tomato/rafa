/**
 * The command lines a body or a task line holds, and what `rafa plan
 * risk` reads off each one: the destructive patterns it matches and the
 * paths outside the repository it names or writes to.
 *
 * ## Which text is a command
 *
 * Only two places hold commands, and prose is never one of them, so
 * `git push --force` in a sentence reports nothing:
 *
 * - **The shell fences of a body** ({@link shellCommandLines}), read
 *   the way the skill checker reads them, through
 *   `src/check/shell-lines.ts`: a `bash`, `sh`, `shell`, `zsh` or
 *   `console` fence, one command per line; comments, empty lines, a
 *   `console` fence's output and a heredoc's body are not commands. A
 *   line ending in a backslash is JOINED to the lines it continues and
 *   read as one command at its first line, so `git push \` over
 *   `--force` is still a force push. One line of another language's
 *   code makes the whole fence foreign and it contributes nothing, as
 *   it contributes nothing to the checker. A fence closes on a marker
 *   run of the same character at least as long as its opener, the rule
 *   `src/check/references.ts` documents; its two expressions are
 *   private there, and that module sits at the 800-line cap, so they
 *   are spelled again here rather than exported from it.
 * - **The code spans of a task line** ({@link taskLineCommands}), each
 *   span one command. A span naming a file or a flag is read too and
 *   simply matches nothing.
 *
 * ## What a command is read for
 *
 * Each command is matched against `patterns.ts`'s fixed list, one
 * `high` per pattern. Then its words are read for paths outside the
 * repository: an absolute path or a `~` path, with a URL, a `//`
 * token and the device files in {@link DEVICE_FILES} left out, and a
 * path that resolves inside `repoRoot` (or is it) left out. Such a path
 * is `high` when the command WRITES to it and `note` otherwise. A
 * command writes to the target of an output redirection (`>`, `>>`,
 * `>|`, `&>`, `>&`, `<>`), to every operand of `mv`, `rm` and `tee`,
 * and to the destination of `cp`: its last operand, or the directory
 * its `-t` names. A word is split into shell words first, quotes
 * respected, so `echo "a; b"` is one command and `"~/x"` is `~/x`.
 *
 * ## What this reading does not see
 *
 * Named so a clean report is not read as more than it is:
 *
 * - `$HOME/x`, `${HOME}/x` and any other variable-built path: only a
 *   path WRITTEN absolute or with a `~` is one, which is the spec's
 *   rule. `rm -rf "$HOME/.cache"` reports `rm -rf` and no path.
 * - A relative path taken after a `cd` out of the repository:
 *   `cd ~/other && rm -rf build` names `~/other` as a `note` and
 *   nothing about `build`.
 * - A heredoc's body, which is data to the fence reader: a script fed
 *   to `ssh host bash <<EOF` is not read line by line.
 * - A command `patterns.ts` hides: a wrapper taking a flag with an
 *   argument, as that module's own note says.
 *
 * Nothing here reads a file, the environment or a process: the text
 * and the two directories in {@link PathSeams} are all it is handed.
 */
import { posix } from 'node:path';

import { commandOf, continuesLine, heredocTerminator, isForeignCodeLine, isShellFence } from '../../check/shell-lines.js';

import { COMMAND_WRAPPERS, destructiveMatches } from './patterns.js';

/** How much a finding weighs: `high` is what `--strict` refuses on. */
export type RiskLevel = 'high' | 'note';

/** The two finding kinds this module reports. */
export type CommandFindingKind = 'destructive' | 'outside-path';

/** One command, as read out of a fence or a code span. */
export interface CommandLine {
  /** The command, continuation lines joined with one space. */
  readonly text: string;
  /** Its 1-based line: the first line of the text it was read from. */
  readonly line: number;
}

/** Where a path stops being the repository's own. */
export interface PathSeams {
  /** The repository's root; a path inside it, or it, is not reported. */
  readonly repoRoot: string;
  /** The directory a `~` expands to. */
  readonly home: string;
}

/** A path outside the repository, as one command names it. */
export interface OutsidePath {
  /** The path as written, `~` kept. */
  readonly path: string;
  /** Whether the command writes to it. */
  readonly writes: boolean;
}

/** One finding a command line carries. */
export interface CommandFinding {
  /** `high` for a destructive command or a write outside, else `note`. */
  readonly level: RiskLevel;
  /** Which of the two readings found it. */
  readonly kind: CommandFindingKind;
  /** The line a report prints, e.g. `rm -rf — rm -rf build`. */
  readonly text: string;
  /** The pattern name, or the path as written. */
  readonly subject: string;
  /** The command it was found in. */
  readonly command: string;
  /** The command's 1-based line. */
  readonly line: number;
}

/**
 * Device files that are outside the repository without being a place
 * anything is kept: `> /dev/null` discards, it does not write. Leaving
 * them in would make every silenced command a `high`.
 */
export const DEVICE_FILES: readonly string[] = [
  '/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr', '/dev/tty',
];

/** Commands every operand of which is written to. */
const WRITES_EVERY_OPERAND: readonly string[] = ['mv', 'rm', 'tee'];

/** Words that stand ahead of a command without being it. */
const COMMAND_PREFIXES: readonly string[] = [...COMMAND_WRAPPERS, '!', '{'];

/** A fenced block's opening line: its marker run and its info string. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/;

/** A line that is only a marker run, a candidate close for SOME fence. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** An inline code span, with its contents captured. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** A redirection operator, longest spelling first. */
const REDIRECT = /^(?:&>>|&>|>>|>\||>&|<<<|<<-|<<|<&|<>|>|<)/;

/** Redirections whose target is written. */
const OUTPUT_REDIRECTS = /^(?:\d*(?:>>|>\||>&|<>|>)|&>>|&>)$/;

/** Redirections whose next word is a heredoc terminator or a string. */
const HEREDOC_REDIRECTS = /^\d*<<[-<]?$/;

/** Characters that end a word and open a new command. */
const SEPARATORS = ';&|()`';

/** An assignment word ahead of a command. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/** A URL, or anything else carrying a scheme. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** One shell word or operator of a command. */
export interface ShellToken {
  readonly kind: 'word' | 'separator' | 'redirect';
  readonly text: string;
}

/** The fence being read, from its opening line to its close. */
interface FenceState {
  readonly info: string;
  readonly delimiter: string;
  readonly length: number;
  terminator: string | null;
  pending: { text: string; readonly line: number } | null;
  foreign: boolean;
  readonly commands: CommandLine[];
}

/** The fence an opening line opens, having read nothing. */
function openFence(open: RegExpExecArray): FenceState {
  const run = open[1] ?? '';
  return {
    info: (open[2] ?? '').split(/[\s,{]/)[0]?.toLowerCase() ?? '',
    delimiter: run[0] ?? '`',
    length: run.length,
    terminator: null,
    pending: null,
    foreign: false,
    commands: [],
  };
}

/** Whether `line` closes `fence`: the same marker, at least as long. */
function closesFence(line: string, fence: FenceState): boolean {
  const run = FENCE_CLOSE.exec(line)?.[1] ?? '';
  return run !== '' && run[0] === fence.delimiter && run.length >= fence.length;
}

/** A command piece with its trailing continuation backslash dropped. */
function withoutBackslash(piece: string): string {
  return piece.replace(/\\$/, '').trim();
}

/** Ends the command being joined, if one is, and keeps it. */
function flush(fence: FenceState): void {
  if (fence.pending !== null) fence.commands.push({ text: fence.pending.text, line: fence.pending.line });
  fence.pending = null;
}

/** The text a continuation line adds, a `console` prompt's `> ` dropped. */
function continuationOf(line: string, info: string): string {
  const text = line.trim();
  return info === 'console' && text.startsWith('> ')
    ? text.slice(2)
    : text;
}

/** Reads one line inside a shell fence. */
function readFenceLine(fence: FenceState, line: string, number: number): void {
  const pending = fence.pending;
  if (pending === null && fence.terminator !== null) {
    if (line.trim() === fence.terminator) fence.terminator = null;
    return;
  }
  const piece = pending === null
    ? commandOf(line, fence.info)
    : continuationOf(line, fence.info);
  if (piece === null || piece === '') return;
  if (isForeignCodeLine(piece)) {
    fence.foreign = true;
    return;
  }

  fence.terminator = heredocTerminator(piece) ?? fence.terminator;
  if (pending === null) fence.pending = { text: withoutBackslash(piece), line: number };
  else pending.text = `${pending.text} ${withoutBackslash(piece)}`;
  if (!continuesLine(piece)) flush(fence);
}

/** What a closed (or never-closed) fence contributes. */
function commandsOf(fence: FenceState): readonly CommandLine[] {
  flush(fence);
  return fence.foreign
    ? []
    : fence.commands;
}

/**
 * Every command line in the shell fences of `body`, in order. `line`
 * counts from the first line of `body`, so a caller that hands a whole
 * file, frontmatter included, gets the file's own line numbers.
 */
export function shellCommandLines(body: string): readonly CommandLine[] {
  const found: CommandLine[] = [];
  let fence: FenceState | null = null;

  for (const [index, line] of body.split('\n').entries()) {
    if (fence === null) {
      const open = FENCE_OPEN.exec(line);
      if (open !== null) fence = openFence(open);
      continue;
    }
    if (closesFence(line, fence)) {
      found.push(...commandsOf(fence));
      fence = null;
      continue;
    }
    if (isShellFence(fence.info) && !fence.foreign) readFenceLine(fence, line, index + 1);
  }

  if (fence !== null) found.push(...commandsOf(fence));
  return found;
}

/**
 * The code spans of one task line, each read as a command, and nothing
 * else of the line: the prose around a span is never a command. A span
 * `commandOf` answers null for (a comment) or that holds another
 * language's code is dropped.
 *
 * @param taskLine - The task line, checkbox and declarations included.
 * @param line - Its 1-based line in the plan, given to every command.
 */
export function taskLineCommands(taskLine: string, line: number): readonly CommandLine[] {
  const found: CommandLine[] = [];
  for (const match of taskLine.matchAll(CODE_SPAN)) {
    const command = commandOf(match[1] ?? '', 'sh');
    if (command !== null && !isForeignCodeLine(command)) found.push({ text: command, line });
  }
  return found;
}

/** The end of a quoted run opened at `start`, past its closing quote. */
function quotedEnd(command: string, start: number): number {
  const quote = command[start];
  let index = start + 1;
  while (index < command.length && command[index] !== quote) {
    index += quote === '"' && command[index] === '\\'
      ? 2
      : 1;
  }
  return Math.min(index + 1, command.length);
}

/** A quoted run's contents, a double quote's escapes undone. */
function unquote(run: string): string {
  const closed = run.length > 1 && run.endsWith(run[0] ?? '');
  const inner = run.slice(1, closed
    ? -1
    : undefined);
  return run.startsWith('"')
    ? inner.replace(/\\(["\\$`])/g, '$1')
    : inner;
}

/** Whether a redirection opens at `rest`: `>` or `<`, or `&>`. */
function opensRedirect(rest: string): boolean {
  return rest.startsWith('>') || rest.startsWith('<') || rest.startsWith('&>');
}

/**
 * A command split into shell words, separators and redirections.
 * Quotes are respected and removed; a fd number glued to a redirection
 * (`2>`) is part of it rather than a word.
 */
export function shellTokens(command: string): readonly ShellToken[] {
  const tokens: ShellToken[] = [];
  let word = '';
  let hasWord = false;
  const endWord = (): void => {
    if (hasWord) tokens.push({ kind: 'word', text: word });
    word = '';
    hasWord = false;
  };

  let index = 0;
  while (index < command.length) {
    const char = command[index] ?? '';
    const rest = command.slice(index);
    if (opensRedirect(rest)) {
      const fd = /^\d+$/.test(word)
        ? word
        : '';
      if (fd === '') endWord();
      word = '';
      hasWord = false;
      const operator = REDIRECT.exec(rest)?.[0] ?? char;
      tokens.push({ kind: 'redirect', text: `${fd}${operator}` });
      index += operator.length;
    } else if (char === '\'' || char === '"') {
      const end = quotedEnd(command, index);
      word += unquote(command.slice(index, end));
      hasWord = true;
      index = end;
    } else if (char === '\\') {
      word += command[index + 1] ?? '';
      hasWord = true;
      index += 2;
    } else if (/\s/.test(char)) {
      endWord();
      index += 1;
    } else if (SEPARATORS.includes(char)) {
      endWord();
      const operator = /^(?:&&|\|\||[;&|()`])/.exec(rest)?.[0] ?? char;
      tokens.push({ kind: 'separator', text: operator });
      index += operator.length;
    } else {
      word += char;
      hasWord = true;
      index += 1;
    }
  }
  endWord();
  return tokens;
}

/** A command's tokens cut at every separator, empty segments dropped. */
function segmentsOf(tokens: readonly ShellToken[]): readonly (readonly ShellToken[])[] {
  const segments: ShellToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind === 'separator') segments.push([]);
    else segments.at(-1)?.push(token);
  }
  return segments.filter((segment) => segment.length > 0);
}

/** One segment's words, with which of them a redirection writes to. */
interface SegmentWords {
  readonly argv: readonly string[];
  readonly redirected: readonly { readonly word: string; readonly writes: boolean }[];
}

/** Splits a segment into its argument words and its redirection targets. */
function wordsOf(segment: readonly ShellToken[]): SegmentWords {
  const argv: string[] = [];
  const redirected: { word: string; writes: boolean }[] = [];
  let operator: string | null = null;
  for (const token of segment) {
    if (token.kind === 'redirect') {
      operator = token.text;
    } else if (operator === null) {
      argv.push(token.text);
    } else {
      if (!HEREDOC_REDIRECTS.test(operator)) {
        redirected.push({ word: token.text, writes: OUTPUT_REDIRECTS.test(operator) });
      }
      operator = null;
    }
  }
  return { argv, redirected };
}

/** Where the command word of `argv` is, past assignments and wrappers. */
function commandIndex(argv: readonly string[]): number {
  let index = 0;
  let afterWrapper = false;
  while (index < argv.length) {
    const word = argv[index] ?? '';
    const isWrapperFlag: boolean = afterWrapper && word.startsWith('-');
    if (!ASSIGNMENT.test(word) && !COMMAND_PREFIXES.includes(word) && !isWrapperFlag) return index;
    afterWrapper = COMMAND_PREFIXES.includes(word) || isWrapperFlag;
    index += 1;
  }
  return index;
}

/** The operands after a command word: its non-flag words, all after `--`. */
function operandsOf(args: readonly string[]): readonly string[] {
  const end = args.indexOf('--');
  const flagged = end === -1
    ? args
    : args.slice(0, end);
  const after = end === -1
    ? []
    : args.slice(end + 1);
  return [...flagged.filter((word) => !word.startsWith('-')), ...after];
}

/** The words `cp` writes to: the directory `-t` names, else its last operand. */
function copyTargets(args: readonly string[]): readonly string[] {
  const flag = args.indexOf('-t');
  if (flag !== -1 && args[flag + 1] !== undefined) return [args[flag + 1] ?? ''];
  const long = args.find((word) => word.startsWith('--target-directory='));
  if (long !== undefined) return [long.slice('--target-directory='.length)];
  return operandsOf(args).slice(-1);
}

/** The words of `argv` its command writes to. */
function writtenWords(argv: readonly string[]): ReadonlySet<string> {
  const at = commandIndex(argv);
  const name = posix.basename(argv[at] ?? '');
  const args = argv.slice(at + 1);
  if (WRITES_EVERY_OPERAND.includes(name)) return new Set(operandsOf(args));
  if (name === 'cp') return new Set(copyTargets(args));
  return new Set();
}

/** The path a word carries: itself, or the value of a `--flag=` or `NAME=`. */
function pathCandidate(word: string): string {
  if (word.startsWith('/') || word.startsWith('~')) return word;
  const equals = word.indexOf('=');
  return equals === -1
    ? word
    : word.slice(equals + 1);
}

/** Whether `target` is `root` or resolves inside it. */
function isWithin(root: string, target: string): boolean {
  const step = posix.relative(posix.resolve(root), posix.resolve(target));
  return !step.startsWith('..') && !posix.isAbsolute(step);
}

/**
 * Whether `path` is an absolute or `~` path outside the repository. A
 * `~user` path cannot be resolved without reading the machine, and is
 * outside on its face.
 */
export function isOutsidePath(path: string, seams: PathSeams): boolean {
  if (SCHEME.test(path) || path.startsWith('//') || DEVICE_FILES.includes(path)) return false;
  if (path === '~' || path.startsWith('~/')) return !isWithin(seams.repoRoot, posix.join(seams.home, path.slice(1)));
  if (path.startsWith('~')) return true;
  return path.startsWith('/') && !isWithin(seams.repoRoot, path);
}

/**
 * The paths outside the repository one command names, each once, in
 * order, with whether the command writes to it.
 */
export function outsidePaths(command: string, seams: PathSeams): readonly OutsidePath[] {
  const found = new Map<string, boolean>();
  const note = (word: string, writes: boolean): void => {
    const path = pathCandidate(word);
    if (isOutsidePath(path, seams)) found.set(path, (found.get(path) ?? false) || writes);
  };

  for (const segment of segmentsOf(shellTokens(command))) {
    const { argv, redirected } = wordsOf(segment);
    const written = writtenWords(argv);
    for (const word of argv) note(word, written.has(word) || written.has(pathCandidate(word)));
    for (const target of redirected) note(target.word, target.writes);
  }
  return Array.from(found, ([path, writes]) => ({ path, writes }));
}

/** Every finding of one command, destructive patterns first. */
function findingsOf(command: CommandLine, seams: PathSeams): readonly CommandFinding[] {
  const destructive = destructiveMatches(command.text).map((pattern): CommandFinding => ({
    level: 'high',
    kind: 'destructive',
    text: `${pattern.name} — ${command.text}`,
    subject: pattern.name,
    command: command.text,
    line: command.line,
  }));
  const paths = outsidePaths(command.text, seams).map((path): CommandFinding => ({
    level: path.writes
      ? 'high'
      : 'note',
    kind: 'outside-path',
    text: `${path.path} — ${path.writes
      ? 'written by'
      : 'named in'} ${command.text}`,
    subject: path.path,
    command: command.text,
    line: command.line,
  }));
  return [...destructive, ...paths];
}

/** Every finding of `commands`, in their order. */
export function readCommands(
  commands: readonly CommandLine[],
  seams: PathSeams,
): readonly CommandFinding[] {
  return commands.flatMap((command) => findingsOf(command, seams));
}

/** Every finding in the shell fences of `body`. */
export function readBodyCommands(body: string, seams: PathSeams): readonly CommandFinding[] {
  return readCommands(shellCommandLines(body), seams);
}

/** Every finding in the code spans of one task line. */
export function readTaskLineCommands(
  taskLine: string,
  line: number,
  seams: PathSeams,
): readonly CommandFinding[] {
  return readCommands(taskLineCommands(taskLine, line), seams);
}
