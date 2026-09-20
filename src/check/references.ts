/**
 * The resolution and locality checks: whether the paths and commands a
 * skill or instinct body names are things the reader of that body can
 * actually reach.
 *
 * A body is instructions for an agent. `Run `scripts/verify.sh`` is
 * worth nothing when the script was renamed, and ``/Users/marcos/
 * projects/thing/src/x.ts`` is worth less than nothing in anybody
 * else's checkout: the agent follows it, finds nothing, and invents a
 * path. Both failures are SILENT — the file parses, the schema passes,
 * and the cost lands on a session months later. This module is the
 * checker's third and fourth checks, and it is the only one that reads
 * a body.
 *
 * ## The three seams
 *
 * Nothing here reads the process environment or the home. The project
 * a body is consumed in ({@link ReferenceSeams.projectRoot}), the
 * skill's own directory ({@link ReferenceSeams.skillDir}) and the
 * directories a command name is looked up in
 * ({@link ReferenceSeams.pathDirs}) are all passed in, so a test
 * points every one of them under a temporary directory of its own and
 * a run against a user tier is told, rather than guessing, that it has
 * no project.
 *
 * ## What counts as a reference
 *
 * Only code does. Prose that happens to hold a slash is not a path
 * claim, so candidates are taken from inline code spans and from
 * fenced blocks, never from running text.
 *
 * A PROJECT-LOOKING path is a relative token with a separator and an
 * extension (`src/check/references.ts`), or one opening with `./` or
 * `../`. A bare `package.json` is not one: with no separator it is as
 * likely the name of a concept as the name of a file, and the corpus
 * says so constantly. Neither is `node:fs`, a URL, a token holding a
 * glob or an angle-bracket placeholder like `<dir>/<name>.md`.
 *
 * A SCRIPT is a project-looking path that lands inside the skill's own
 * directory. It is recognised by resolving it there FIRST: a token
 * that names a file under the skill directory is that file, whatever
 * the project holds. A token whose first segment names a directory of
 * the skill (`scripts/gone.sh` beside a real `scripts/`) is a script
 * too, and a missing one fails — that is the rename the check exists
 * for.
 *
 * A TOOL is the first word of a command line in a `bash`, `sh`,
 * `shell`, `zsh` or `console` fence, looked up in `pathDirs`.
 *
 * ## Which fences are read, and why not all of them
 *
 * Paths are taken from a fence only when the fence NAMES FILES: a
 * shell fence, a fence with no info string, or a `text`-ish one
 * ({@link namesFiles}). A `ts` or `python` fence is sample code, and
 * its `./config.js` is an import specifier in an illustration, not a
 * claim that the consuming project holds that file.
 *
 * That narrowing was measured on 2026-09-18 rather than assumed, over
 * the 207 `SKILL.md` bodies of this repository's `.claude/skills` and
 * of `~/.claude/skills`. Reading paths out of EVERY fence finds 528
 * path references against 401 under the rule above; held against this
 * repository as a stand-in project root, the wide rule fails 238
 * references in 87 files and the narrow one 138 in 64. The extra
 * mentions are import specifiers and sample module paths of other
 * projects (`../../molecules/Progress`, `Table/TableRow.tsx`), which
 * is a reading every skill author would have had to work around.
 *
 * ## What a shell fence is read as
 *
 * Inside a shell fence only COMMAND lines are read, for tools and for
 * paths alike, and WHICH line is one is `shell-lines.ts`'s reading
 * rather than this module's: a comment, a heredoc body, the
 * continuation of a line ending in a backslash, and the unprompted
 * lines of a `console` fence are all passed over there, as is the
 * first word that is a builtin, an assignment or a flag. That module
 * carries the note on each of those, and on what each one costs.
 *
 * What stays here is what a command line is then read FOR. A first
 * word `shell-lines.ts` answers as a tool is looked up in
 * `pathDirs`; a first word holding a separator (`./scripts/run.sh`)
 * is a PATH, and is checked as one.
 *
 * ## A fence holding another language carries no command at all
 *
 * One line `shell-lines.ts` answers as another language's code makes
 * the WHOLE fence foreign ({@link FenceReader.foreign}): every
 * reference already read out of it is dropped, and every later line
 * of it is passed over. Evidence is taken only from a line this
 * module would have READ as a command, so a heredoc body is never
 * evidence and the `python3 -c` line opening one still names its
 * tool. Measured on 2026-09-20 over the 146 `SKILL.md` bodies of this
 * repository's `.claude/skills`, of `~/.claude/skills` and of the
 * sibling checkout's tier, read with no project root and this
 * machine's `PATH`: 492 tool references and 25 tool issues BEFORE the
 * rule, the same 492 and 25 AFTER, because NO fence of that corpus is
 * read as foreign at all. `shell-lines.ts` carries why the unit is
 * the fence rather than the line, and what those 25 and the 15 lines
 * it does flag there are.
 *
 * ## Locality
 *
 * An absolute path inside the project or inside the skill's own
 * directory is local, and is then resolved like any other path. Every
 * other absolute path is judged by its root: `/Users/`, `/home/` and
 * `/root/` FAIL ({@link HOME_ROOTS}) because they are one machine's
 * layout written into a file everyone reads;
 * {@link SYSTEM_ROOTS} — `/tmp`, `/usr`, `/bin`, `/etc`, `/dev`,
 * `/var`, `/opt`, `/private`, `/proc` — never fail, because they are
 * the same everywhere the skill will be read; anything else fails.
 *
 * A `~/`-rooted path is NOT an absolute path here. `~/.claude/skills`
 * names each reader's own home and travels correctly, which is why the
 * corpus reading behind this rule counted 5 bodies under `/Users/` or
 * `/home/` and no `~` at all. It is passed over without a word.
 *
 * ## Without a project root, a project path is unchecked
 *
 * A user tier has no consuming project, so a project-looking path
 * there is counted as {@link ReferenceIssueCode} `unchecked-path`, a
 * WARNING that never reaches the checker's exit code. Scripts and
 * tools are still resolved in that run: both are answerable without a
 * project.
 *
 * ## Off a machine's stack, a missing tool is a warning
 *
 * A tool lookup answers about the machine the check RAN on, not about
 * the body. A kotlin skill naming `gradle` and a perl skill naming
 * `cpanm` are correct files; the checkout that has neither binary is
 * the thing that differs. So when the frontmatter declares a `stack`
 * that is anything other than `agnostic`
 * ({@link ReferenceSeams.stack}), a command no `PATH` directory holds
 * is {@link ReferenceIssueCode} `missing-tool-off-stack`, a WARNING
 * that never reaches the exit code, rather than `missing-tool`.
 *
 * The failure is KEPT for `stack: [agnostic]` and for a file whose
 * frontmatter declares no `stack` at all. An agnostic skill is one
 * every session on every machine is meant to follow, so a tool it
 * names and this machine does not hold is a claim the reader cannot
 * act on; and an absent `stack` is not a statement about a stack, so
 * it buys no demotion. The demotion is about the reader's toolchain
 * alone: paths, scripts and locality are judged the same whatever the
 * `stack` says.
 */
import { existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, relative, resolve } from 'node:path';

import { AGNOSTIC_STACK } from '../schema/stack.js';

import { commandOf, continuesLine, heredocTerminator, isForeignCodeLine, isShellFence, toolOf } from './shell-lines.js';

/** The info strings of a fence that names files without being code. */
export const TEXT_FENCE_LANGUAGES: readonly string[] = ['text', 'txt', 'plain', 'plaintext'];

/** Absolute roots that are one machine's home and never another's. */
export const HOME_ROOTS: readonly string[] = ['/Users/', '/home/', '/root/'];

/** Absolute roots that mean the same thing on every machine. */
export const SYSTEM_ROOTS: readonly string[] = [
  '/bin', '/dev', '/etc', '/opt', '/private', '/proc', '/tmp', '/usr', '/var',
];

/**
 * The roots this module already has a verdict for: the home roots
 * without their trailing separator, and the system roots. An absolute
 * token under any OTHER root has to carry an extension before
 * {@link isAbsoluteReference} reads it as a path at all.
 *
 * The plan's system list is the authority here and is not extended, so
 * `/sbin`, `/lib` and `/run` are not system roots: a body naming
 * `/sbin/ifconfig` is not judged (no extension) and one naming
 * `/lib/systemd/system/x.service` fails as a foreign path. That is the
 * enumerated rule followed, not an oversight.
 */
const KNOWN_ROOTS: readonly string[] = [
  ...HOME_ROOTS.map((root) => root.replace(/\/$/, '')),
  ...SYSTEM_ROOTS,
];

/**
 * A POSIX shell function definition: a name, a REQUIRED empty `()`,
 * and an opening `{` — on its own line (the body follows) or a full
 * one-liner (`_phase() { ( set -e; "$1" ); }`), which is why the `{`
 * only has to be PRESENT, not the last thing on the line.
 */
const POSIX_FUNCTION_DEFINITION = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{/;

/**
 * Bash's own function syntax: the `function` keyword, a name, and an
 * optional empty `()`, then the same `{` rule as the POSIX form. The
 * keyword is what makes this shape unambiguous without requiring the
 * parens POSIX does.
 */
const BASH_FUNCTION_DEFINITION = /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?\s*\{/;

/**
 * The names `body` defines as a shell function anywhere in it. A name
 * a body defines for itself is exactly as resolvable as a builtin is —
 * the reader never leaves the shell to reach it — so a HELPER a fenced
 * example defines and then calls (`_ok`, `_bad`, a project's own
 * `usage`) is not a claim about `PATH` at all. Measured against the
 * corpus of `~/.claude/skills` on 2026-09-18: without this, a `_ok`/
 * `_bad` assertion pair alone cost eleven files a false `missing-tool`,
 * every one a bash example that already defines what it calls.
 */
function definedFunctionNames(body: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const line of body.split('\n')) {
    const name = POSIX_FUNCTION_DEFINITION.exec(line)?.[1] ?? BASH_FUNCTION_DEFINITION.exec(line)?.[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

/** Whether an issue counts towards the checker's exit code. */
export type ReferenceSeverity = 'failure' | 'warning';

/** Every way a body can name something the reader cannot reach. */
export type ReferenceIssueCode =
  /** A project path naming nothing in the consuming project. */
  | 'unresolved-path'
  /** A path under the skill's own directory that is not there. */
  | 'missing-script'
  /** A command name no `PATH` directory holds. */
  | 'missing-tool'
  /** The same, in a skill whose `stack` is not `agnostic`. */
  | 'missing-tool-off-stack'
  /** An absolute path under a home root, outside project and skill. */
  | 'home-path'
  /** Another absolute path outside project, skill and system roots. */
  | 'foreign-path'
  /** A project path in a run with no project to resolve it against. */
  | 'unchecked-path';

/** The codes, in the order this module documents them. */
export const REFERENCE_ISSUE_CODES: readonly ReferenceIssueCode[] = [
  'unresolved-path',
  'missing-script',
  'missing-tool',
  'missing-tool-off-stack',
  'home-path',
  'foreign-path',
  'unchecked-path',
];

/**
 * What each code costs. Two are warnings: `unchecked-path`, because a
 * user tier is checked without a project root on purpose and the paths
 * it could not answer for must not redden it, and
 * `missing-tool-off-stack`, because a stack-gated skill naming a tool
 * this machine does not install is a reading about the machine.
 */
export const REFERENCE_SEVERITY: Readonly<Record<ReferenceIssueCode, ReferenceSeverity>>
  = Object.freeze({
    'unresolved-path': 'failure',
    'missing-script': 'failure',
    'missing-tool': 'failure',
    'missing-tool-off-stack': 'warning',
    'home-path': 'failure',
    'foreign-path': 'failure',
    'unchecked-path': 'warning',
  });

/** What kind of thing a body named. */
export type ReferenceKind = 'path' | 'tool';

/** Where in a body a reference was found. */
export type ReferenceSource = 'code-span' | 'fence';

/** One path or command name a body names, as written. */
export interface BodyReference {
  /** Whether it is a path or a command name. */
  readonly kind: ReferenceKind;
  /** The token, byte-exact, with no wrapping quotes or punctuation. */
  readonly text: string;
  /** Its 1-based line in the BODY, which excludes the frontmatter. */
  readonly line: number;
  /** Whether it came from an inline code span or a fenced block. */
  readonly source: ReferenceSource;
}

/** One reference the reader of this body could not reach. */
export interface ReferenceIssue {
  /** Which rule was broken. */
  readonly code: ReferenceIssueCode;
  /** Whether it counts towards the exit code. */
  readonly severity: ReferenceSeverity;
  /** The reference it is about, at its first mention. */
  readonly reference: BodyReference;
  /** A sentence a checker prints unedited, opening with its line. */
  readonly message: string;
}

/** Where one body's references are resolved. */
export interface ReferenceSeams {
  /**
   * The project a body is consumed in, or null for a tier that has
   * none. Null makes every project path an `unchecked-path` warning.
   */
  readonly projectRoot: string | null;
  /**
   * The skill's own directory, or null for an instinct record, which
   * has no directory of resources beside it.
   */
  readonly skillDir: string | null;
  /** The directories a command name is looked up in, in order. */
  readonly pathDirs: readonly string[];
  /**
   * The `stack` list the file's frontmatter declares, or null for a
   * file that declares none — an instinct record, a skill missing the
   * field, and a skill whose `stack` is not a list of strings all read
   * as null. A list that is anything other than `[agnostic]` demotes a
   * missing tool to a warning; null and `[agnostic]` keep the failure.
   *
   * Absent reads as null, so a caller that has no frontmatter to hand
   * gets the strict reading rather than the lenient one.
   */
  readonly stack?: readonly string[] | null;
}

/** What {@link checkReferences} answers. */
export interface ReferenceCheck {
  /** Every reference found, in body order, repeats kept. */
  readonly references: readonly BodyReference[];
  /** Every rule broken, in body order, one per distinct reference. */
  readonly issues: readonly ReferenceIssue[];
}

/** A fenced block's opening line: its marker run and its info string. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/;

/** A line that is only a marker run, a candidate close for SOME fence. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** An inline code span, with its contents captured. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** A trailing `:12` or `:12:3` on a path, as an editor prints one. */
const LINE_SUFFIX = /:\d+(?::\d+)?$/;

/** A URL, or anything else carrying a scheme. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** The last segment's extension: a letter, then up to seven more. */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

/** Characters that make a token a placeholder, a glob or an expression. */
const NOT_A_PATH = /[<>*?|$"'`{}()[\]!,;@\\\s]/;

/** Whether any of `issues` counts towards the exit code. */
export function hasReferenceFailure(issues: readonly ReferenceIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'failure');
}

/**
 * A `PATH` value split into directories, empty entries dropped. The
 * caller passes `process.env['PATH']`; nothing here reads it.
 */
export function pathDirectories(value: string | undefined): readonly string[] {
  return (value ?? '').split(delimiter).filter((entry) => entry.length > 0);
}

/**
 * Whether a fence with this info string names files. A shell fence, an
 * unlabelled one and a `text`-ish one do; a language fence holds
 * sample code, whose relative paths are illustrations.
 */
function namesFiles(info: string): boolean {
  return info === '' || isShellFence(info) || TEXT_FENCE_LANGUAGES.includes(info);
}

/** The info string's first word, lowercased, as the fence's language. */
function fenceInfo(raw: string): string {
  return (raw.split(/[\s,{]/)[0] ?? '').toLowerCase();
}

/** A whitespace-delimited word with its wrapping punctuation removed. */
function cleanToken(word: string): string {
  return word
    .replace(/^[('"`[{<]+/, '')
    .replace(/[)'"`\]}>,;:.]+$/, '');
}

/**
 * Whether `token` is a path claim about the consuming project: a
 * relative token with a separator and an extension, or one opening
 * with `./` or `../`. See this module's note on what is refused.
 */
export function isProjectPath(token: string): boolean {
  if (token === '' || SCHEME.test(token) || NOT_A_PATH.test(token)) return false;
  if (token.startsWith('/') || token.startsWith('~')) return false;
  if (token.endsWith('/')) return false;
  if (token.startsWith('./') || token.startsWith('../')) return true;
  return token.includes('/') && EXTENSION.test(token);
}

/**
 * Whether `token` is an absolute path the locality rule judges.
 *
 * Beyond the shape every path needs, an absolute token has to look like a
 * FILE path and not like an HTTP route: its first segment is a root this
 * module has a verdict for ({@link KNOWN_ROOTS}), or it carries an extension
 * AND a second segment, and neither opens with a `//` or a dot segment. The
 * shape-only test the extension half replaced read `/health`,
 * `/api/markets`, `/login`, `/.claude` and a comment marker's `//` as paths
 * outside the project — 109 hits against 5 on 2026-09-18; the second-segment
 * half is about those 5: a route a server answers (`/openapi.json`) is one
 * segment long and no machine's layout. Unjudged now: `/workspace/project`,
 * `/probe.json`.
 *
 * Measured 2026-09-20 over the same 146-body corpus the fence rule above
 * measures: 327 path references, 63 of them absolute, 0 `home-path` and 0
 * `foreign-path` issues, all four the same BEFORE this half and AFTER, every
 * absolute token there under a system root. Planting
 * `/srv/data/payload.json` beside `/openapi.json` in every body lifts that 0
 * to 146, the route still 0.
 */
function isAbsoluteReference(token: string): boolean {
  if (!token.startsWith('/') || token === '/' || token.includes('//')) return false;
  if (SCHEME.test(token) || NOT_A_PATH.test(token)) return false;

  const [first = '', second] = token.split('/').slice(1);
  if (first.startsWith('.')) return false;
  if (second === undefined) return KNOWN_ROOTS.includes(token);
  return KNOWN_ROOTS.includes(`/${first}`) || EXTENSION.test(token);
}

/** Whether `target` resolves inside `root`, `root` itself excluded. */
function isInside(root: string, target: string): boolean {
  const step = relative(resolve(root), resolve(target));
  return step !== '' && !step.startsWith('..') && !isAbsolute(step);
}

/** Whether `path` is a file any bit of the mode marks executable. */
function isExecutableFile(path: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** A line's inline code spans, in order. */
function codeSpans(line: string): string[] {
  return Array.from(line.matchAll(CODE_SPAN), (match) => match[1] ?? '');
}

/**
 * The path tokens of one line of code, with a trailing `:12` line
 * number dropped so an editor-shaped mention resolves.
 */
function pathTokens(text: string): string[] {
  const found: string[] = [];
  for (const word of text.split(/\s+/)) {
    const token = cleanToken(word).replace(LINE_SUFFIX, '');
    if (isProjectPath(token) || isAbsoluteReference(token)) {
      found.push(token);
    }
  }
  return found;
}

/** What one line of a fenced block is being read as. */
interface FenceReader {
  /** The fence's language, lowercased. */
  readonly info: string;
  /** The character the opening marker ran on, `` ` `` or `~`. */
  readonly delimiter: string;
  /** How many marker characters the opening line ran, 3 or more. */
  readonly length: number;
  /** The heredoc terminator being skipped to, or null. */
  terminator: string | null;
  /** Whether the previous command line continues into this one. */
  continued: boolean;
  /**
   * Whether a line this fence would have read as a command was
   * another language's code, which makes the WHOLE fence foreign.
   */
  foreign: boolean;
  /** What this fence has named so far, held until it closes. */
  readonly found: BodyReference[];
}

/**
 * Whether `line` closes the fence `reader` opened. CommonMark's own rule:
 * the closing run has to be the SAME character as the opening one, and at
 * least as long. Without this, a bare closing ` ``` ` line inside a
 * FOUR-backtick fence — the standard way a doc shows a fenced example
 * literally, `dev-planner`'s own `SKILL.md` included — reads as closing
 * the OUTER fence early, and the outer fence's real closing line then
 * reads as OPENING a fresh unlabelled fence that swallows every line
 * after it as fenced content, prose included, until the next stray
 * marker run closes it. `references.test.ts` pins the shape that broke.
 */
function closesFence(line: string, reader: FenceReader): boolean {
  const match = FENCE_CLOSE.exec(line);
  if (match === null) return false;
  const run = match[1] ?? '';
  return run[0] === reader.delimiter && run.length >= reader.length;
}

/** A reference, ready to push. */
function reference(
  kind: ReferenceKind,
  text: string,
  line: number,
  source: ReferenceSource,
): BodyReference {
  return { kind, text, line, source };
}

/** Reads one command line of a shell fence for its tool and its paths. */
function readCommand(reader: FenceReader, line: string, number: number): void {
  const command = commandOf(line, reader.info);
  if (command === null) return;
  if (isForeignCodeLine(command)) {
    reader.foreign = true;
    return;
  }

  const terminator = heredocTerminator(command);
  if (terminator !== null) {
    reader.terminator = terminator;
  }

  if (!reader.continued) {
    const tool = toolOf(command);
    if (tool !== null) reader.found.push(reference('tool', tool, number, 'fence'));
  }
  reader.continued = continuesLine(command);

  for (const token of pathTokens(command)) {
    reader.found.push(reference('path', token, number, 'fence'));
  }
}

/** Reads one line of a fenced block. */
function readFenceLine(reader: FenceReader, line: string, number: number): void {
  if (reader.foreign) return;

  if (reader.terminator !== null) {
    if (line.trim() === reader.terminator) reader.terminator = null;
    return;
  }

  if (isShellFence(reader.info)) {
    readCommand(reader, line, number);
    return;
  }

  for (const token of pathTokens(line)) {
    reader.found.push(reference('path', token, number, 'fence'));
  }
}

/** The reader a fence's opening line opens, having named nothing. */
function openFence(open: RegExpExecArray): FenceReader {
  const run = open[1] ?? '';
  return {
    info: fenceInfo(open[2] ?? ''),
    delimiter: run[0] ?? '`',
    length: run.length,
    terminator: null,
    continued: false,
    foreign: false,
    found: [],
  };
}

/**
 * Every path and tool `body` names, in order and with repeats kept.
 *
 * `body` is the text after the frontmatter, so a reference's `line` is
 * its line of that text. Nothing here touches the filesystem: the
 * reading is a parse, and {@link checkReferences} is what resolves it.
 */
export function collectReferences(body: string): readonly BodyReference[] {
  const found: BodyReference[] = [];
  let reader: FenceReader | null = null;

  for (const [index, line] of body.split('\n').entries()) {
    const number = index + 1;
    if (reader === null) {
      const open = FENCE_OPEN.exec(line);
      if (open !== null) {
        reader = openFence(open);
        continue;
      }
      for (const span of codeSpans(line)) {
        for (const token of pathTokens(span)) {
          found.push(reference('path', token, number, 'code-span'));
        }
      }
      continue;
    }

    if (closesFence(line, reader)) {
      if (!reader.foreign) found.push(...reader.found);
      reader = null;
      continue;
    }
    if (namesFiles(reader.info)) readFenceLine(reader, line, number);
  }

  // A fence the body never closes still names what it named, so the
  // last reader is flushed rather than dropped.
  if (reader !== null && !reader.foreign) found.push(...reader.found);
  return found;
}

/** An issue, taking its severity from {@link REFERENCE_SEVERITY}. */
function issueOf(
  code: ReferenceIssueCode,
  ref: BodyReference,
  sentence: string,
): ReferenceIssue {
  return {
    code,
    severity: REFERENCE_SEVERITY[code],
    reference: ref,
    message: `line ${ref.line}: ${sentence}`,
  };
}

/** The verdict on a path that lands inside the skill's own directory. */
function scriptIssue(ref: BodyReference, skillDir: string): ReferenceIssue | null {
  if (existsSync(resolve(skillDir, ref.text))) return null;
  return issueOf(
    'missing-script',
    ref,
    `${ref.text} names nothing under the skill directory`,
  );
}

/**
 * Whether `token` is the skill's own: it is there, or its first
 * segment names something that is, which is what a renamed script in a
 * real `scripts/` directory looks like.
 */
function isSkillPath(token: string, skillDir: string): boolean {
  const target = resolve(skillDir, token);
  if (!isInside(skillDir, target)) return false;
  if (existsSync(target)) return true;

  const head = token.split('/')[0] ?? '';
  return head !== '' && head !== '.' && head !== '..' && existsSync(resolve(skillDir, head));
}

/** The verdict on a relative path, given a project to resolve it in. */
function projectPathIssue(ref: BodyReference, projectRoot: string): ReferenceIssue | null {
  const target = resolve(projectRoot, ref.text);
  if (!isInside(projectRoot, target)) {
    return issueOf(
      'unresolved-path',
      ref,
      `${ref.text} points outside the project root`,
    );
  }
  if (existsSync(target)) return null;
  return issueOf(
    'unresolved-path',
    ref,
    `${ref.text} names nothing under the project root`,
  );
}

/** The verdict on a project-looking path. */
function relativeIssue(ref: BodyReference, seams: ReferenceSeams): ReferenceIssue | null {
  const { projectRoot, skillDir } = seams;
  if (skillDir !== null && isSkillPath(ref.text, skillDir)) {
    return scriptIssue(ref, skillDir);
  }
  if (projectRoot === null) {
    return issueOf(
      'unchecked-path',
      ref,
      `${ref.text} was not resolved, because this run was given no project root`,
    );
  }
  return projectPathIssue(ref, projectRoot);
}

/** Whether `token` sits under one of {@link SYSTEM_ROOTS}. */
function isSystemPath(token: string): boolean {
  return SYSTEM_ROOTS.some((root) => token === root || token.startsWith(`${root}/`));
}

/** The verdict on an absolute path: locality first, then resolution. */
function absoluteIssue(ref: BodyReference, seams: ReferenceSeams): ReferenceIssue | null {
  const { projectRoot, skillDir } = seams;
  if (skillDir !== null && isInside(skillDir, ref.text)) {
    return existsSync(ref.text)
      ? null
      : issueOf('missing-script', ref, `${ref.text} names nothing under the skill directory`);
  }
  if (projectRoot !== null && isInside(projectRoot, ref.text)) {
    return existsSync(ref.text)
      ? null
      : issueOf('unresolved-path', ref, `${ref.text} names nothing under the project root`);
  }
  if (HOME_ROOTS.some((root) => ref.text.startsWith(root))) {
    return issueOf(
      'home-path',
      ref,
      `${ref.text} is one machine home directory, outside both the project`
      + ' and the skill directory',
    );
  }
  if (isSystemPath(ref.text)) return null;
  return issueOf(
    'foreign-path',
    ref,
    `${ref.text} is an absolute path outside both the project and the skill directory`,
  );
}

/**
 * Whether `stack` gates the file to a stack this machine need not
 * carry the toolchain of: a non-empty list holding no
 * {@link AGNOSTIC_STACK} entry. An absent list, a null one, an empty
 * one and `[agnostic]` are all false, and so keep the failure.
 *
 * `[agnostic, kotlin]` is not a valid list at all — the skill schema
 * fails it as `unknown-stack` — and is read here as agnostic, so a
 * contradictory list never buys the demotion.
 */
export function isOffStack(stack: readonly string[] | null | undefined): boolean {
  if (stack === null || stack === undefined || stack.length === 0) return false;
  return !stack.includes(AGNOSTIC_STACK);
}

/**
 * The verdict on a tool name. `functions` are names the body defines
 * for itself, and `offStack` is {@link isOffStack} over the file's
 * declared `stack`, which is what parts the failure from the warning.
 */
function toolIssue(
  ref: BodyReference,
  pathDirs: readonly string[],
  functions: ReadonlySet<string>,
  offStack: boolean,
): ReferenceIssue | null {
  if (functions.has(ref.text)) return null;
  if (pathDirs.some((dir) => isExecutableFile(resolve(dir, ref.text)))) return null;
  if (offStack) {
    return issueOf(
      'missing-tool-off-stack',
      ref,
      `the command ${ref.text} is in no directory of the PATH this run was given,`
      + ' and this file declares a stack this machine need not carry',
    );
  }
  return issueOf(
    'missing-tool',
    ref,
    `the command ${ref.text} is in no directory of the PATH this run was given`,
  );
}

/** The verdict on one reference. */
function referenceIssue(
  ref: BodyReference,
  seams: ReferenceSeams,
  functions: ReadonlySet<string>,
): ReferenceIssue | null {
  if (ref.kind === 'tool') {
    return toolIssue(ref, seams.pathDirs, functions, isOffStack(seams.stack));
  }
  if (isAbsolute(ref.text)) return absoluteIssue(ref, seams);
  return relativeIssue(ref, seams);
}

/**
 * Resolves everything `body` names against `seams` and reports what
 * the reader of that body could not reach.
 *
 * A reference named twice is reported once, at its first mention: a
 * body repeating one dead path has one thing wrong with it, and
 * counting the mentions would say otherwise.
 */
export function checkReferences(body: string, seams: ReferenceSeams): ReferenceCheck {
  const references = collectReferences(body);
  const functions = definedFunctionNames(body);
  const issues: ReferenceIssue[] = [];
  const seen = new Set<string>();

  for (const ref of references) {
    // A space separates the two halves unambiguously: a kind is one of
    // two words, and no reference text survives the collector with
    // whitespace in it.
    const key = `${ref.kind} ${ref.text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const issue = referenceIssue(ref, seams, functions);
    if (issue !== null) issues.push(issue);
  }

  return { references, issues };
}
