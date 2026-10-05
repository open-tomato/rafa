/**
 * Whether a reference's target is there, read as the fingerprint
 * `./stamp.ts` compares: one reference at a time, each kind through its
 * own seam.
 *
 * This is the second of the three readings under `src/refs/`.
 * `./extract.ts` answers WHAT a spec points at and `./stamp.ts` whether
 * it changed; this module reads the target as it is NOW
 * (`.rafa/specs/rafa-151-references-specs-bugs-are.md`). Nothing here
 * spawns a process: `gh`, `git` and `ts-symbols` arrive through the
 * seams of {@link RefVerifySeams}, so `./verify.test.ts` drives fakes
 * and a repository planted under the temp directory.
 *
 * ## Per kind
 *
 * | Kind | Read through | Answers |
 * |---|---|---|
 * | `issue` | {@link IssueReader} over `gh issue view` | its fingerprint, `absent`, or a throw |
 * | `cross-issue` | the same reader, with `--repo owner/repo` | its fingerprint, or `unreadable` on any failure |
 * | `path` | `git ls-files`, then `git rev-parse HEAD:<path>` | its blob sha, `present` or `absent` |
 * | `symbol` | `git grep` for a line declaring `<name>` over tracked `.ts`, confirmed by `ts-symbols outline` where it can | `present` or `absent` |
 * | `command`, `flag` | the `describe` roster | `present` or `absent` |
 * | `key` | `SETTINGS` | `present` or `absent` |
 *
 * ## Issues
 *
 * `#7` and `rafa-7` are both issue 7 on the board's repository, read
 * with `gh issue view 7 --json title,body,state`; `gh` resolves the
 * repository of the directory its runner runs in, as the `github`
 * tracker's does. `owner/repo#7` is read on the same runner with
 * `--repo owner/repo`, since the tracker port's `IssueRef` holds no
 * repository to route it by.
 *
 * Read off `gh` 2.100.0 on 2026-09-24 against this repository: an
 * issue number no issue or pull request holds exits 1 with `GraphQL:
 * Could not resolve to an issue or pull request with the number of
 * 999999. (repository.issue)`, which is the one failure read as
 * `absent`. `gh issue view` answers a pull request's number as well,
 * with `state` `MERGED`, and a spec's `#152` may mean that pull
 * request, so it is read like an issue: `OPEN` is `open`, and `CLOSED`
 * and `MERGED` are `closed`.
 *
 * Any other failure on the board's own repository — `gh` missing,
 * unauthenticated, offline, or answering JSON of another shape — throws
 * {@link RefVerifyError}: the board is the one repository the check
 * must be able to read, and reading its failure as a state would pass
 * or refuse a spec on something that says nothing about it. On another
 * repository EVERY failure, not-found included, is `unreadable`, which
 * `./stamp.ts` reads as `unknown`: `gh` answers a private repository it
 * may not read exactly as one that does not exist (`Could not resolve
 * to a Repository with the name …`), so neither can be told dangling.
 *
 * ## Paths
 *
 * A path is looked up in the list `git ls-files -z` answers, read once
 * per verifier, and a leading `./` is dropped. In this order:
 *
 *  1. a tracked file of that path is that file;
 *  2. a path some tracked file sits under is a directory, `present`;
 *  3. otherwise, a path that ends some tracked path on a `/` boundary
 *     is that file when exactly one file ends so, and `present` when
 *     several files, or a directory, do;
 *  4. anything else is `absent`.
 *
 * A file is fingerprinted by `git rev-parse --verify --quiet
 * HEAD:<path>`, its blob sha at `HEAD`; one tracked but not yet
 * committed has no sha there and reads `present`. A directory reads
 * `present` rather than its tree sha, which would move with every file
 * under it.
 *
 * The third rule was measured, not assumed. Over the 256 distinct paths
 * `extractRefs` reads out of this repository's 29 saved specs on
 * 2026-09-24, 106 were tracked files and 20 tracked directories, and
 * the suffix rule found 31 more that a spec writes short: `stamp.ts`,
 * `report/record.ts`. The 99 left name other repositories (`packages/…`,
 * `services/…`), gitignored files (`.rafa/config.yaml`) or files since
 * removed, and read `absent`.
 *
 * ## Symbols
 *
 * A symbol is `present` when some tracked `.ts` file declares it, which
 * `git grep --null -E` over the pathspec `*.ts` answers line by line. A
 * line declares `name` in one of three forms, each opening the line
 * after any white space:
 *
 * | Form | Reads | Such as |
 * |---|---|---|
 * | keyword | `function`, `const`, `let`, `class`, `type` or `interface`, after any of `export`, `default`, `declare`, `abstract`, `async` | `function localHelper(`, `export const A =`, `function* gen` |
 * | member or field | the name, bare or quoted, then `:` or `?:`, after any of `readonly`, `static`, `get` and the other member modifiers; inline after `{`, `,` or `;` on a line that does not open with `/` or `*` | `  readonly kind: …`, `  'quoted': 2,`, `const T = { field: 1 }` |
 * | method | the name, then one parenthesised list (one level of nesting), then `:` or `{` | `  run(args: string): void;`, `  get size() {` |
 *
 * So a word in a `//` comment or a doc comment's ` * ` line declares
 * nothing, and neither does a call opening a line (`callOnly(a, b);`,
 * or `describe('x', () => {`, whose list does not close on the line) or
 * a name standing only in a type (`const v: Foreign`). Missed: a
 * method whose parameters span lines, a name destructured
 * (`const { a } =`), and a second name of one `const a = 1, b = 2`.
 * Read too: a parameter on a line of its own (`  name: string,`), which
 * the field form cannot tell from a field. All of these were measured
 * over a planted file on 2026-10-05.
 *
 * With no `ts-symbols` on `PATH` ({@link RefVerifySeams.outline} null),
 * any declaring line is enough. With it, the outline confirms where it
 * can, which was read off `ts-symbols outline --json` on 2026-10-05: it
 * lists every top-level declaration, exported or not (`function`,
 * `async function`, `function*`, `const`, `let`, `class`, `abstract
 * class`, `type`, `interface`, `enum`, `declare const`, and `export
 * default function f` as `f`), and one level of members under an
 * interface, a class or an enum. It does NOT list an object literal's
 * fields, a type literal's fields, or a declaration inside a body. Those
 * are written indented, so:
 *
 *  1. a declaring line that opens with white space is `present` on the
 *     grep alone, with nothing outlined: the outline cannot tell a
 *     member it lists from a field it never lists;
 *  2. otherwise each file holding a declaring line, all at the start of
 *     their lines, is outlined in turn, and the symbol is `present` when
 *     one lists it, a member included;
 *  3. a file `ts-symbols` could not outline counts as the grep found it.
 *
 * Rule 2 is what refuses a line the grep reads wrongly at the start of a
 * line, such as `const planted = 1;` inside a template literal: the
 * outline lists the template's `const`, not `planted` (measured the same
 * day). A barrel's `export … from` lists nothing and declares nothing
 * here either, so a name only re-exported is found where it is
 * declared. The command takes one file (a second was ignored when
 * tried) and took 0.65s over `./stamp.ts` on 2026-09-24, which is why
 * the grep narrows first rather than every tracked file being outlined.
 *
 * Measured against this repository with `ts-symbols` on `PATH` on
 * 2026-10-05: the module-local `issueOf`, `pathTarget` and `trackedFiles`,
 * the type alias `PathTarget` and the interface members `outline` and
 * `roster` of {@link RefVerifySeams} read `present`, each of which the
 * export-only grep this replaced read `absent`; two words no file holds
 * read `absent` under both.
 *
 * `git grep` exits 1, writing nothing, when no line matches; the runner
 * answers that as not ok with an empty stderr, which reads as no
 * declaration. Not ok with anything on stderr throws.
 *
 * ## Commands and flags
 *
 * Both are read against the `describe` roster ({@link DescribeDocument}),
 * handed in rather than built here so that the caller picks it:
 * `src/commands/plan/refs-check.ts` hands in the checkout's own roster
 * when the project root is rafa itself, and the core roster otherwise.
 *
 * A command `rafa <word> [<word>]` is `present` when some spelling the
 * roster holds opens with those words: a subject and its plural, a
 * subject or its plural with each action, a top-level command, and each
 * alias as typed. So `rafa plan` and `rafa module exec` are `present`,
 * the second as the start of `module exec linear next`. A command whose
 * first word is a top-level command or a one-word alias, and NOT a
 * subject, is `present` whatever word follows, since routing reads that
 * word as its argument. After a subject the second word must be an
 * action: the router would hand `rafa plan bogus` to the alias `plan`,
 * but a spec writing a second lowercase word after a subject means an
 * action, and one since renamed is exactly what should read dangling.
 *
 * A flag `--name` is `present` when any command in the roster declares
 * `name` as a flag or an alias of one, or when it is `--no-<name>` for
 * such a flag, which `parseArgs` reads as `name` false. The global
 * flags are no command's, so the roster does not hold them: their names
 * are read off `GLOBAL_FLAGS` in `src/cli/help.ts`, with `help`, which
 * `src/cli/route.ts` reads as `--help` before anything else.
 *
 * ## Keys
 *
 * A key is `present` when some entry of `SETTINGS` in
 * `src/config-schema.ts` has it as its `key`.
 */
import type { Ref } from './extract.js';
import type { IssueState, LiveReading } from './stamp.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { DescribeDocument } from '../cli/describe.js';
import type { GitRunner } from '../pr/git.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { GLOBAL_FLAGS } from '../cli/help.js';
import { pluralOf } from '../cli/registry.js';
import { SETTINGS } from '../config-schema.js';
import { gitSaid } from '../pr/git.js';

import { ABSENT, blobFingerprint, issueFingerprint, PRESENT, UNREADABLE } from './stamp.js';

/** What reading one issue answered. */
export type IssueRead =
  | { readonly kind: 'found'; readonly title: string; readonly body: string; readonly state: IssueState }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly detail: string };

/** Reads issue `number` on the board's repository, or on `repo` (`owner/name`) when given. Never rejects. */
export type IssueReader = (number: number, repo?: string) => Promise<IssueRead>;

/**
 * The names one TypeScript file declares at its top level, exported or
 * not, with each one's members, or null when the file could not be
 * outlined. Never rejects.
 */
export type SymbolOutliner = (file: string) => Promise<readonly string[] | null>;

/** What a verifier reads its targets through. */
export interface RefVerifySeams {
  /** Reads issues, here and on other repositories. */
  readonly issues: IssueReader;
  /** Runs git in the repository root. */
  readonly git: GitRunner;
  /** Outlines a file through `ts-symbols`, or null when it is not on `PATH`: the grep answers alone. */
  readonly outline: SymbolOutliner | null;
  /** The roster commands and flags are read against. */
  readonly roster: DescribeDocument;
}

/** Reads one reference's target as it is now. */
export type RefVerifier = (ref: Pick<Ref, 'kind' | 'text'>) => Promise<LiveReading>;

/** A target that could not be read where reading it is required: the board's issue, git. */
export class RefVerifyError extends Error {
  constructor(problem: string) {
    super(`refs verify: ${problem}`);
    this.name = 'RefVerifyError';
  }
}

/** The fields `gh issue view` is asked for. */
const ISSUE_FIELDS = 'title,body,state';

/** What `gh` writes for an issue number nothing holds; see the module note. */
const NO_SUCH_ISSUE = 'Could not resolve to an issue or pull request';

/** The state each `gh` state is read as. */
const ISSUE_STATES: Readonly<Record<string, IssueState>> = { OPEN: 'open', CLOSED: 'closed', MERGED: 'closed' };

/** `#7` or `rafa-7`. */
const LOCAL_ISSUE_TEXT = /^(?:#|rafa-)([1-9]\d*)$/u;

/** `owner/repo#7`. */
const CROSS_ISSUE_TEXT = /^([\w.-]+\/[\w.-]+)#([1-9]\d*)$/u;

/** A git object id: sha1 or sha256, in hex. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** A plain identifier; `./extract.ts` reads no other symbol. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** A line that opens with white space: a declaration below the top level, as written. */
const INDENTED = /^\s/u;

/** What may stand before a top-level keyword, each followed by white space. */
const DECLARATION_MODIFIERS = '((export|default|declare|abstract|async)[[:space:]]+)*';

/** What may stand before a member's or a field's name, each followed by white space. */
const MEMBER_MODIFIERS = '((readonly|static|public|private|protected|abstract|override|declare|async|get|set)[[:space:]]+)*';

/** A character no identifier holds: the end of a whole word. */
const NOT_IDENTIFIER = '[^A-Za-z0-9_$]';

/** A flag's name out of a global flag's spelling. */
const SPELLED_FLAG = /--([a-z][a-z0-9-]*)/gu;

/** The flag `src/cli/route.ts` reads before any command, and no roster lists. */
const ROUTED_FLAGS = ['help'];

/** A JSON value's own field, or undefined. */
function field(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.hasOwn(value, name)
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

/** `text` read as JSON, or undefined when it is not. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The issue a `gh issue view` payload holds, or null when it holds another shape. */
function issueOf(payload: unknown): IssueRead | null {
  const title = field(payload, 'title');
  const body = field(payload, 'body');
  const state = field(payload, 'state');
  if (typeof title !== 'string' || typeof body !== 'string' || typeof state !== 'string') return null;
  if (!Object.hasOwn(ISSUE_STATES, state)) return null;
  return { kind: 'found', title, body, state: ISSUE_STATES[state] ?? 'open' };
}

/**
 * The reader over `gh issue view`, run by `gh` on the board's
 * repository, or with `--repo` on another. The module note holds how
 * each answer is read.
 */
export function ghIssueReader(gh: GhRunner): IssueReader {
  return async (number, repo) => {
    const args = ['issue', 'view', String(number), '--json', ISSUE_FIELDS];
    const result = await gh(repo === undefined
      ? args
      : [...args, '--repo', repo]);
    if (!result.ok) {
      if (result.stderr.includes(NO_SUCH_ISSUE)) return { kind: 'missing' };
      return { kind: 'failed', detail: result.stderr.trim() || result.stdout.trim() || 'gh exited non-zero and wrote nothing' };
    }
    return issueOf(parsedJson(result.stdout))
      ?? { kind: 'failed', detail: `gh issue view ${String(number)} answered no title, body and state` };
  };
}

/** What {@link tsSymbolsOutliner} is made with. */
export interface OutlinerOptions {
  /** The repository root, the directory `ts-symbols` runs in. */
  readonly cwd: string;
  /** The environment whose `PATH` it is looked up on and that it runs with: `process.env` when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** A listed symbol with its members, the one level `ts-symbols outline` lists under it. */
function withMembers(symbol: unknown): readonly unknown[] {
  const children = field(symbol, 'children');
  return Array.isArray(children)
    ? [symbol, ...(children as readonly unknown[])]
    : [symbol];
}

/** Every name a `ts-symbols outline --json` payload lists, members included, or null when it lists none as it should. */
function declaredNames(payload: unknown): readonly string[] | null {
  const symbols = field(payload, 'symbols');
  if (!Array.isArray(symbols)) return null;
  return symbols
    .flatMap(withMembers)
    .map((symbol: unknown) => field(symbol, 'name'))
    .filter((name): name is string => typeof name === 'string');
}

/**
 * The outliner over `ts-symbols outline <file> --json`, or null when
 * `ts-symbols` is not on the `PATH` of `options.env`. It runs through
 * {@link createGhRunner}, whose `command` option spawns any program and
 * answers a failure rather than rejecting.
 */
export function tsSymbolsOutliner(options: OutlinerOptions): SymbolOutliner | null {
  const env = options.env ?? process.env;
  const found = Bun.which('ts-symbols', { PATH: env.PATH ?? '', cwd: options.cwd });
  if (found === null) return null;

  const run = createGhRunner({ cwd: options.cwd, command: found, env });
  return async (file) => {
    const result = await run(['outline', file, '--json']);
    return result.ok
      ? declaredNames(parsedJson(result.stdout))
      : null;
  };
}

/** The issue number `#7` or `rafa-7` names, or null when it names none. */
function localIssueNumber(text: string): number | null {
  const found = LOCAL_ISSUE_TEXT.exec(text);
  const number = Number(found?.[1]);
  return Number.isSafeInteger(number)
    ? number
    : null;
}

/** A board issue's fingerprint; throws when the board cannot be read. */
async function verifyIssue(text: string, issues: IssueReader): Promise<LiveReading> {
  const number = localIssueNumber(text);
  if (number === null) return ABSENT;

  const read = await issues(number);
  if (read.kind === 'missing') return ABSENT;
  if (read.kind === 'failed') throw new RefVerifyError(`could not read issue ${text}: ${read.detail}`);
  return issueFingerprint(read);
}

/** Another repository's issue's fingerprint, or unreadable on any failure. */
async function verifyCrossIssue(text: string, issues: IssueReader): Promise<LiveReading> {
  const found = CROSS_ISSUE_TEXT.exec(text);
  const repo = found?.[1] ?? '';
  const number = Number(found?.[2]);
  const halves = repo.split('/');
  if (!Number.isSafeInteger(number) || halves.some((half) => half === '.' || half === '..')) return UNREADABLE;

  const read = await issues(number, repo);
  return read.kind === 'found'
    ? issueFingerprint(read)
    : UNREADABLE;
}

/** Where a path points among the tracked files: one file, something present, or nothing. */
type PathTarget = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'present' } | { readonly kind: 'absent' };

/** The target `text` names among `tracked`, by the rules in the module note. */
function pathTarget(text: string, tracked: readonly string[]): PathTarget {
  const path = text.replace(/^(?:\.\/)+/u, '');
  const under = path === '' || path.endsWith('/')
    ? path
    : `${path}/`;
  if (tracked.includes(path)) return { kind: 'file', path };
  if (tracked.some((file) => file.startsWith(under))) return { kind: 'present' };

  const files = tracked.filter((file) => file.endsWith(`/${path}`));
  const isDirectory = tracked.some((file) => file.includes(`/${under}`));
  if (files.length === 1 && !isDirectory) return { kind: 'file', path: files[0] ?? path };
  return files.length > 0 || isDirectory
    ? { kind: 'present' }
    : { kind: 'absent' };
}

/** A tracked file's fingerprint: its blob sha at `HEAD`, or `present` when `HEAD` holds none. */
function fileReading(path: string, git: GitRunner): LiveReading {
  const result = git(['rev-parse', '--verify', '--quiet', `HEAD:${path}`]);
  const sha = result.stdout.trim();
  return result.ok && OBJECT_ID.test(sha)
    ? blobFingerprint(sha)
    : PRESENT;
}

/** Every tracked path, as `git ls-files -z` answers them; throws when git cannot say. */
function trackedFiles(git: GitRunner): readonly string[] {
  const result = git(['ls-files', '-z']);
  if (!result.ok) throw new RefVerifyError(`git ls-files failed: ${gitSaid(result) || 'it wrote nothing'}`);
  return result.stdout.split('\0').filter((file) => file !== '');
}

/**
 * The `git grep -E` patterns for a line declaring `name`, one per form the
 * module note's table lists: a keyword's, a member's or field's, a method's.
 */
function declarationPatterns(name: string): readonly string[] {
  const written = `(${name}|'${name}'|"${name}")`;
  return [
    `^[[:space:]]*${DECLARATION_MODIFIERS}(function[[:space:]*]+|(const|let|class|type|interface)[[:space:]]+)${name}(${NOT_IDENTIFIER}|$)`,
    `^[[:space:]]*(([^/*[:space:]].*)?[{,;][[:space:]]*)?${MEMBER_MODIFIERS}${written}[?!]?[[:space:]]*:`,
    `^[[:space:]]*${MEMBER_MODIFIERS}${written}[?]?[[:space:]]*(<[^>]*>)?\\(([^()]|\\([^()]*\\))*\\)[[:space:]]*[:{]`,
  ];
}

/** One line `git grep` read as declaring a name, and the file it sits in. */
interface DeclarationLine {
  readonly file: string;
  readonly text: string;
}

/** The lines of tracked `.ts` files that declare `name`; throws when git cannot say. */
function declarationLines(name: string, git: GitRunner): readonly DeclarationLine[] {
  const patterns = declarationPatterns(name).flatMap((pattern) => ['-e', pattern]);
  const result = git(['grep', '--null', '-E', ...patterns, '--', '*.ts']);
  if (!result.ok && result.stderr.trim() === '') return [];
  if (!result.ok) throw new RefVerifyError(`git grep for ${name} failed: ${gitSaid(result)}`);
  return result.stdout
    .split('\n')
    .filter((line) => line.includes('\0'))
    .map((line) => {
      const end = line.indexOf('\0');
      return { file: line.slice(0, end), text: line.slice(end + 1) };
    });
}

/** A symbol's reading: `present` when some tracked file declares it, by the rules in the module note. */
async function verifySymbol(name: string, git: GitRunner, outline: SymbolOutliner | null): Promise<LiveReading> {
  if (!IDENTIFIER.test(name)) return ABSENT;

  const lines = declarationLines(name, git);
  if (lines.length === 0) return ABSENT;
  if (outline === null || lines.some((line) => INDENTED.test(line.text))) return PRESENT;
  for (const file of new Set(lines.map((line) => line.file))) {
    const names = await outline(file);
    if (names === null || names.includes(name)) return PRESENT;
  }
  return ABSENT;
}

/** Every spelling the roster types a command as, each as its words. */
function commandSpellings(roster: DescribeDocument): readonly (readonly string[])[] {
  const words = (typed: string): readonly string[] => typed.split(' ');
  const topLevel = roster.commands.flatMap((command) => [command.name, ...command.aliases]);
  const underSubjects = roster.subjects.flatMap((subject) => [subject.name, pluralOf(subject.name)].flatMap((name) => [
    name,
    ...subject.actions.map((action) => `${name} ${action.name}`),
  ]));
  const aliases = roster.subjects.flatMap((subject) => subject.actions.flatMap((action) => action.aliases));
  return [...topLevel, ...underSubjects, ...aliases].map(words);
}

/** True when `rafa <typed…>` is a command the roster holds, by the rules in the module note. */
function isRosterCommand(text: string, roster: DescribeDocument): boolean {
  const [program, ...typed] = text.split(' ');
  if (program !== 'rafa' || typed.length === 0) return false;

  const spellings = commandSpellings(roster);
  const subjects = new Set(roster.subjects.flatMap((subject) => [subject.name, pluralOf(subject.name)]));
  const first = typed[0] ?? '';
  const takesArgument = !subjects.has(first) && spellings.some((spelling) => spelling.length === 1 && spelling[0] === first);
  return takesArgument || spellings.some((spelling) => typed.every((word, index) => spelling[index] === word));
}

/** Every flag name the roster declares, with the aliases, the global flags and `help`. */
function rosterFlags(roster: DescribeDocument): ReadonlySet<string> {
  const actions = [...roster.commands, ...roster.subjects.flatMap((subject) => subject.actions)];
  const declared = actions.flatMap((action) => action.flags.flatMap((flag) => [flag.name, ...flag.aliases]));
  const global = GLOBAL_FLAGS.flatMap((flag) => [...flag.spelling.matchAll(SPELLED_FLAG)].map((match) => match[1] ?? ''));
  return new Set([...declared, ...global, ...ROUTED_FLAGS]);
}

/** True when `--name` is a flag the roster or the router reads. */
function isRosterFlag(text: string, roster: DescribeDocument): boolean {
  if (!text.startsWith('--')) return false;

  const name = text.slice(2);
  const flags = rosterFlags(roster);
  return flags.has(name) || (name.startsWith('no-') && flags.has(name.slice(3)));
}

/** True when some setting is written as `text`. */
function isSettingKey(text: string): boolean {
  return Object.values(SETTINGS).some((setting) => setting.key === text);
}

/** `PRESENT` when `holds`, `ABSENT` otherwise. */
function presence(holds: boolean): LiveReading {
  return holds
    ? PRESENT
    : ABSENT;
}

/**
 * A verifier reading each reference through `seams`, by the rules in
 * the module note. The tracked files are listed once, on the first path
 * it reads. It rejects with {@link RefVerifyError} when the board's
 * issue or git cannot be read, and answers every other target.
 */
export function createRefVerifier(seams: RefVerifySeams): RefVerifier {
  let tracked: readonly string[] | null = null;
  const listed = (): readonly string[] => {
    tracked ??= trackedFiles(seams.git);
    return tracked;
  };

  return async (ref) => {
    switch (ref.kind) {
      case 'issue': return verifyIssue(ref.text, seams.issues);
      case 'cross-issue': return verifyCrossIssue(ref.text, seams.issues);
      case 'path': {
        const target = pathTarget(ref.text, listed());
        if (target.kind === 'file') return fileReading(target.path, seams.git);
        return presence(target.kind === 'present');
      }
      case 'symbol': return verifySymbol(ref.text, seams.git, seams.outline);
      case 'command': return presence(isRosterCommand(ref.text, seams.roster));
      case 'flag': return presence(isRosterFlag(ref.text, seams.roster));
      case 'key': return presence(isSettingKey(ref.text));
    }
  };
}

/** One reference's reading through a verifier made for it alone; see {@link createRefVerifier}. */
export async function verifyRef(ref: Pick<Ref, 'kind' | 'text'>, seams: RefVerifySeams): Promise<LiveReading> {
  return createRefVerifier(seams)(ref);
}
