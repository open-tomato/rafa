/**
 * Every reference a spec or a bug makes, read out of its text by
 * pattern: another issue, on this board or another, a file, an exported
 * symbol, a command, a flag and a config key.
 *
 * This is the first of the three readings under `src/refs/`. It answers
 * WHAT the text points at and on which line, and nothing else: whether
 * the target exists is `./verify.ts`'s question and whether it changed
 * is `./stamp.ts`'s. Nothing here spawns, reads a file or asks the
 * board, so every case in `./extract.test.ts` is a literal string
 * (`.rafa/specs/rafa-151-references-specs-bugs-are.md`).
 *
 * ## The seven kinds
 *
 * | Kind | Written as | Read from |
 * |---|---|---|
 * | `issue` | `#7`, `rafa-7` | running text |
 * | `cross-issue` | `owner/repo#7` | running text |
 * | `path` | a backticked token with a slash or a file extension | code spans |
 * | `symbol` | a backticked code-shaped name | code spans |
 * | `command` | `rafa <subject> <action>` | code spans |
 * | `flag` | `--name` | running text and code spans |
 * | `key` | `section.key` | code spans |
 *
 * Each {@link Ref} holds its kind, its text and the 1-based line it was
 * first read on, counted over the text exactly as it was handed in.
 *
 * ## What is not read
 *
 * A fenced block is skipped whole, and so is every quotation line (`>`
 * after up to three spaces). Both are where a spec QUOTES something —
 * a sample session, an old error, the body of another issue — and a
 * reference quoted is not a claim that the target exists here. A fence
 * closes on the character it opened with, at least as many of them and
 * nothing after, so a four-backtick fence showing a three-backtick one
 * is read as one block.
 *
 * An ISSUE is read from running text only, never from inside a code
 * span. This repository's specs quote the field they describe
 * (`Blocked by: #24 #26` in backticks, in the spec that introduced
 * it), and the ids in such an example are not issues the spec waits on.
 *
 * A COMMAND, a PATH, a SYMBOL and a KEY are read from code spans only.
 * Running text is full of words that happen to take those shapes —
 * "rafa keeps a saved copy", `e.g.`, "and/or" — and a spec that means a
 * file or a command writes it in backticks.
 *
 * ## What a backticked token is read as
 *
 * A span holding whitespace is a COMMAND when its first word is `rafa`,
 * and is otherwise read for flags alone — unless its first word is one
 * of {@link FOREIGN_PROGRAMS}, whose flags are that program's and not
 * rafa's. A span of one token is read in this order, and the first rule
 * that matches answers:
 *
 *  1. a FLAG, when it opens with `--`;
 *  2. a PATH, when it has a slash or a stem and one of
 *     {@link FILE_EXTENSIONS}, is spelled from path characters only, and
 *     does not start with `/`, `~` or `http`;
 *  3. a KEY, when it is `section.key` — a lowercase section, one dot, a
 *     camelCase key — and the section is one `SETTINGS` has a key under;
 *  4. a SYMBOL, when it is code-shaped: a camelCase or PascalCase name
 *     with an inner capital, an UPPER_SNAKE name with an underscore, or
 *     a name followed by `()`.
 *
 * Anything else is not a reference. `ok`, `HEAD` and `PATH` are words;
 * `<dir>/<name>.md` is a placeholder, `**\/*.ts` a glob and `node:fs` a
 * module specifier, none of them a file the repository can hold, which
 * is why a path is spelled from letters, digits, `_`, `.`, `-` and `/`
 * and nothing else. The extension list is closed on purpose: a dotted
 * token is a key or a member access (`specs.dir`, `Bun.file`) far more
 * often than a file whose extension nobody listed.
 *
 * A symbol written with its parentheses is read as the bare name, so
 * `readBlockedBy()` and `readBlockedBy` are one reference.
 *
 * ## Why the key and flag rules are narrower than their shapes
 *
 * Both were measured on 2026-09-24 over the 29 saved specs under this
 * repository's `.rafa/specs/`, rather than assumed. By shape alone,
 * `section.key` found 43 distinct keys there and 20 under a section
 * `SETTINGS` holds; the other 23 were other files' keys —
 * `engines.node` in a `package.json`, `message.model` in a session
 * log, the placeholder `section.key` itself — every one of which
 * `./verify.ts` would call dangling. The sections are read off
 * `SETTINGS` rather than listed here, so a section added there is read
 * here with no second edit.
 *
 * Of the multi-word spans holding a flag, 63 opened with `rafa`, 37
 * with a subject written without it (`plan create --issue`), and 23
 * with `git`, `bun`, `claude`, `gh` or `bunx`, whose `--write-tree`
 * and `--force-with-lease` rafa has never had; skipping those took the
 * distinct flags from 83 to 75. A subject spelled bare cannot be told
 * from a program without the command roster, which is `./verify.ts`'s,
 * so the closed list names the programs instead. A flag in running
 * text is still read, program or not: nothing on its line says whose
 * it is.
 *
 * ## Duplicates and blockers
 *
 * A reference is read once per kind and text, at the first line that
 * names it. A target named on the body's `Blocked by:` line is marked
 * {@link Ref.blocker}, wherever it was first read, so the `resolved`
 * state can be asked of it. Which line that is, and which of its ids
 * are local, is `src/board/blocked.ts`'s reading, taken whole so that
 * the field has one spelling across rafa.
 */
import { readBlockedBy } from '../board/blocked.js';
import { SETTINGS } from '../config-schema.js';

/** What a reference points at. */
export type RefKind =
  /** An issue on this board, `#7` or `rafa-7`. */
  | 'issue'
  /** An issue on another repository, `owner/repo#7`. */
  | 'cross-issue'
  /** A file or directory of the repository. */
  | 'path'
  /** An exported name. */
  | 'symbol'
  /** A rafa command, `rafa <subject> <action>`. */
  | 'command'
  /** A command-line flag, `--name`. */
  | 'flag'
  /** A config key, `section.key`. */
  | 'key';

/** One reference, as the text first names it. */
export interface Ref {
  /** What it points at. */
  readonly kind: RefKind;
  /** Its text as written, less a symbol's `()` and a flag's `=value`. */
  readonly text: string;
  /** The 1-based line of the text it was first read on. */
  readonly line: number;
  /** True when the body's `Blocked by:` line names it. */
  readonly blocker: boolean;
}

/** The extensions a dotted token with no slash is read as a file by. */
export const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  'cjs', 'css', 'db', 'html', 'js', 'json', 'jsonl', 'jsx', 'lock', 'md', 'mdx',
  'mjs', 'sh', 'sql', 'sqlite', 'toml', 'ts', 'tsx', 'txt', 'yaml', 'yml',
]);

/** The programs whose flags a span opening with them names; never rafa's. */
export const FOREIGN_PROGRAMS: ReadonlySet<string> = new Set([
  'bun', 'bunx', 'claude', 'eslint', 'gh', 'git', 'node', 'npm', 'npx', 'pnpm', 'ts-symbols',
  'tsc', 'yarn',
]);

/** Every config section `SETTINGS` holds a dotted key under. */
const CONFIG_SECTIONS: ReadonlySet<string> = new Set(
  Object.values(SETTINGS)
    .map((setting) => setting.key)
    .filter((key) => key.includes('.'))
    .map((key) => key.slice(0, key.indexOf('.'))),
);

/** A fenced block's opening or closing line: its fence run and what follows. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/** A quotation line. */
const QUOTE_LINE = /^ {0,3}>/u;

/** An inline code span: a backtick run, the content, the same run again. */
const CODE_SPAN = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/gu;

/** `owner/repo#7`, as GitHub spells the names. */
const CROSS_ISSUE = /(?<![\w./-])[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+#\d+(?!\w)/gu;

/** `#7`, standing alone rather than closing an anchor, an entity or a cross ref. */
const LOCAL_ISSUE = /(?<![\w/&#])#(\d+)(?!\w)/gu;

/** `rafa-7`, the name a branch, a spec and a plan give issue 7. */
const RAFA_ISSUE = /(?<![\w-])rafa-(\d+)(?![\d])/gu;

/** `--name`, and `--name=value` read as `--name`. */
const FLAG = /(?<![\w-])--[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\w-])/gu;

/** A command word after `rafa`: a subject or an action, never an argument. */
const COMMAND_WORD = /^[a-z][a-z-]*$/u;

/** The characters a path is spelled from. */
const PATH_CHARS = /^[A-Za-z0-9_./-]+$/u;

/** `section.key`, spelled as every key in `SETTINGS` is. */
const KEY_SHAPE = /^[a-z]+\.[a-z][A-Za-z0-9]*$/u;

/** A plain identifier. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** UPPER_SNAKE with at least one underscore. */
const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u;

/** One reference as read, before duplicates and blockers are settled. */
interface Found {
  /** What it points at. */
  readonly kind: RefKind;
  /** Its text, normalised. */
  readonly text: string;
}

/** A token's own `(fence char, length)`, or null when the line opens no fence. */
interface Fence {
  /** `` ` `` or `~`. */
  readonly char: string;
  /** How many of them. */
  readonly length: number;
}

/** The fence `line` opens, or null when it opens none. */
function openingFence(line: string): Fence | null {
  const found = FENCE_LINE.exec(line);
  if (found === null) return null;

  const run = found[1] ?? '';
  const info = found[2] ?? '';
  // A backtick fence's info string may not hold a backtick; such a line is prose.
  if (run.startsWith('`') && info.includes('`')) return null;
  return { char: run.charAt(0), length: run.length };
}

/** True when `line` closes `fence`: the same character, at least as many, nothing after. */
function closesFence(line: string, fence: Fence): boolean {
  const found = FENCE_LINE.exec(line);
  if (found === null) return false;

  const run = found[1] ?? '';
  return run.charAt(0) === fence.char
    && run.length >= fence.length
    && (found[2] ?? '').trim() === '';
}

/** The lines of `text` that are read, with their 1-based numbers; fences and quotations left out. */
function readableLines(text: string): readonly { readonly number: number; readonly text: string }[] {
  const lines = text.split('\n').map((line) => line.replace(/\r$/u, ''));
  const kept: { number: number; text: string }[] = [];
  let fence: Fence | null = null;

  for (const [index, line] of lines.entries()) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    fence = openingFence(line);
    if (fence !== null || QUOTE_LINE.test(line)) continue;
    kept.push({ number: index + 1, text: line });
  }

  return kept;
}

/** What a code span holds, with the one space CommonMark strips from each side. */
function spanContent(raw: string): string {
  return raw.length > 2 && raw.startsWith(' ') && raw.endsWith(' ')
    ? raw.slice(1, -1)
    : raw;
}

/** Every flag in `text`, each read as `--name`. */
function flagsIn(text: string): readonly Found[] {
  return [...text.matchAll(FLAG)].map(([flag]) => ({ kind: 'flag', text: flag }));
}

/** `rafa <subject> <action>` out of a span whose first word is `rafa`, or null. */
function commandOf(words: readonly string[]): Found | null {
  const named = [];
  for (const word of words.slice(1, 3)) {
    if (!COMMAND_WORD.test(word)) break;
    named.push(word);
  }
  return named.length === 0
    ? null
    : { kind: 'command', text: ['rafa', ...named].join(' ') };
}

/** True when `token` is a path by the rule in the module note. */
function isPath(token: string): boolean {
  if (!PATH_CHARS.test(token)) return false;
  if (token.startsWith('/') || token.startsWith('~') || token.startsWith('http')) return false;
  if (token.includes('/')) return true;

  const dot = token.lastIndexOf('.');
  return dot > 0 && FILE_EXTENSIONS.has(token.slice(dot + 1));
}

/** True when `token` is `section.key` under a section `SETTINGS` holds. */
function isKey(token: string): boolean {
  return KEY_SHAPE.test(token) && CONFIG_SECTIONS.has(token.slice(0, token.indexOf('.')));
}

/** The symbol `token` names, or null when it is not code-shaped. */
function symbolOf(token: string): string | null {
  if (token.endsWith('()')) {
    const name = token.slice(0, -2);
    if (IDENTIFIER.test(name)) return name;
    return null;
  }
  if (UPPER_SNAKE.test(token)) return token;

  const innerCapital = /[A-Z]/u.test(token.slice(1)) && /[a-z]/u.test(token);
  if (IDENTIFIER.test(token) && innerCapital) return token;
  return null;
}

/** What a one-token span is read as, by the order in the module note. */
function tokenRef(token: string): readonly Found[] {
  if (token.startsWith('--')) return flagsIn(token);
  if (isPath(token)) return [{ kind: 'path', text: token }];
  if (isKey(token)) return [{ kind: 'key', text: token }];

  const symbol = symbolOf(token);
  if (symbol === null) return [];
  return [{ kind: 'symbol', text: symbol }];
}

/** Every reference one code span holds. */
function spanRefs(content: string): readonly Found[] {
  const words = content.trim().split(/\s+/u);
  if (words.length === 1) return tokenRef(words[0] ?? '');

  const first = words[0] ?? '';
  if (FOREIGN_PROGRAMS.has(first)) return [];

  const command = first === 'rafa'
    ? commandOf(words)
    : null;
  if (command === null) return flagsIn(content);
  return [command, ...flagsIn(content)];
}

/** Every issue, cross-repository issue and flag in running text, in line order. */
function proseRefs(text: string): readonly Found[] {
  const hits: { at: number; found: Found }[] = [];

  for (const match of text.matchAll(CROSS_ISSUE)) {
    hits.push({ at: match.index, found: { kind: 'cross-issue', text: match[0] } });
  }
  const local = text.replace(CROSS_ISSUE, (token) => ' '.repeat(token.length));
  for (const match of local.matchAll(LOCAL_ISSUE)) {
    hits.push({ at: match.index, found: { kind: 'issue', text: match[0] } });
  }
  for (const match of local.matchAll(RAFA_ISSUE)) {
    hits.push({ at: match.index, found: { kind: 'issue', text: match[0] } });
  }
  for (const match of text.matchAll(FLAG)) {
    hits.push({ at: match.index, found: { kind: 'flag', text: match[0] } });
  }

  return [...hits].sort((a, b) => a.at - b.at).map((hit) => hit.found);
}

/** Every reference one line holds, in the order the line names them. */
function lineRefs(line: string): readonly Found[] {
  const found: Found[] = [];
  let from = 0;

  for (const match of line.matchAll(CODE_SPAN)) {
    found.push(...proseRefs(line.slice(from, match.index)), ...spanRefs(spanContent(match[2] ?? '')));
    from = match.index + match[0].length;
  }
  found.push(...proseRefs(line.slice(from)));

  return found;
}

/** The texts the body's `Blocked by:` line names: `#7` and `owner/repo#7` alike. */
function blockerTexts(text: string): ReadonlySet<string> {
  const read = readBlockedBy(0, text);
  return new Set([...read.blockers.map((id) => `#${String(id)}`), ...read.foreign]);
}

/** True when `found` is a target the `Blocked by:` line names. */
function isBlocker(found: Found, blockers: ReadonlySet<string>): boolean {
  if (found.kind === 'cross-issue') return blockers.has(found.text);
  if (found.kind !== 'issue') return false;
  return blockers.has(`#${found.text.replace(/^(?:#|rafa-)/u, '')}`);
}

/**
 * Every reference `text` makes, each once per kind and text at the first
 * line that names it, in the order the text first names them.
 *
 * `text` is a spec's or a bug's body as written; line numbers count its
 * own lines, CRLF or LF alike. Never throws: text that names nothing
 * answers an empty list. The module note holds what is read, what is
 * skipped and why.
 */
export function extractRefs(text: string): readonly Ref[] {
  const blockers = blockerTexts(text);
  const seen = new Set<string>();
  const refs: Ref[] = [];

  for (const line of readableLines(text)) {
    for (const found of lineRefs(line.text)) {
      const id = `${found.kind}:${found.text}`;
      if (seen.has(id)) continue;
      seen.add(id);
      refs.push(Object.freeze({ ...found, line: line.number, blocker: isBlocker(found, blockers) }));
    }
  }

  return Object.freeze(refs);
}
