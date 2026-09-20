/**
 * The `.gitignore` entry for a project's `.rafa/` directory, written
 * from the three `tracking` flags, and the notice printed when
 * `tracking.all` leaves that directory unignored: "Tracking (Q29)" in
 * `.rafa/specs/phase-1-installable.md`.
 *
 * {@link trackingEntry} answers the pattern lines for a set of flags,
 * {@link withTrackingBlock} puts them into a `.gitignore`'s text, and
 * {@link writeTrackingGitignore} does that on disk.
 * {@link noticeTrackingChange} prints the exposure notice when the
 * flags differ from the ones it last recorded, and {@link applyTracking}
 * runs the write and then the notice. `rafa init` calls it, and so may
 * any command that loads the config: the recorded digest, not the
 * caller, decides whether the tracking section changed.
 *
 * ## The entry
 *
 * Git cannot re-include a path under an excluded directory, so the
 * entry takes one of three shapes:
 *
 *   - No flag set: `.rafa/`.
 *   - `tracking.specs`, `tracking.plans` or both, `tracking.all` not
 *     set: `!/.rafa/`, `.rafa/*`, then `!.rafa/specs/` and
 *     `!.rafa/plans/` for the flags set, in that order.
 *   - `tracking.all`, whatever the other two say: `!/.rafa/`,
 *     `.rafa/triage/private/` and `.rafa/tracking.digest`.
 *
 * `.rafa/*` ignores every entry of `.rafa/` but not the directory
 * itself, so a `!` line after it re-includes one sub-path. The store
 * (`.rafa/effort/`), `runs/` and the private triage directory
 * therefore stay ignored under either individual flag with no line of
 * their own, and the config file and `instincts/` with them.
 *
 * `tracking.all` keeps two paths ignored. The private triage directory
 * holds security bugs, which the phase 1 plan keeps out of reach of
 * every tracking flag, and the notice does not name them. The digest
 * file is this checkout's record of the notice (below): tracked, it
 * would travel to a clone whose operator never read the notice and keep
 * it from printing there.
 *
 * ## The re-include
 *
 * `!/.rafa/` leads both unignoring shapes because an earlier line can
 * exclude the directory, and then no `!` line under it re-includes
 * anything. Measured with Apple Git 2.50.1: a `.rafa/` line above
 * `.rafa/*` and `!.rafa/specs/` leaves `.rafa/specs/s.md` ignored, and
 * `!/.rafa/` between them brings it back. The same line overrides a
 * `.rafa/` in `.git/info/exclude`, and one in a `core.excludesFile`, a
 * file where the operator of a globally installed rafa might keep it;
 * each was measured beside the same exclude with no entry, which
 * ignores the file.
 *
 * The leading slash anchors that line to the directory the `.gitignore`
 * sits in. `.rafa/*` holds a slash and so matches only there already,
 * while an unanchored `!.rafa/` matches at any depth. Measured under
 * the same earlier `.rafa/`: `!.rafa/` un-ignores
 * `sub/.rafa/effort/e.sqlite`, and `!/.rafa/` leaves it ignored. Every
 * other line keeps the spelling the spec and the plan give it.
 *
 * Two things the entry cannot reach, both measured under either
 * individual flag: a line below the block, where `!.rafa/effort/`
 * un-ignores the store, and a `.gitignore` inside `.rafa/`, where
 * `!effort/` does the same. Under `.rafa/` alone git reads no file
 * inside the directory, and the store stays ignored. A line above the
 * block is overridden by it. This module reads no ignore state and
 * spawns no git; `git check-ignore` is its tests' reading.
 *
 * ## The block
 *
 * The lines sit between {@link BLOCK_BEGIN} and {@link BLOCK_END}, each
 * a whole line. A rewrite replaces what lies between them and leaves
 * every other byte of the file as it was. A file with no block gets one
 * appended, after a blank line when the file holds anything, and a file
 * that does not exist is created holding the block alone. When the text
 * the block would give is the text already there,
 * {@link writeTrackingGitignore} writes nothing, so a rerun changes no
 * byte and no modification time.
 *
 * A marker found twice, one found without the other, or an end above
 * its begin is refused with a {@link GitignoreError} naming the file
 * and the lines rather than guessed at: a guess either appends a second
 * block or overwrites lines the operator wrote.
 *
 * A marker line matches with a trailing carriage return dropped, and
 * the block's lines end the way the file's first line does, so a CRLF
 * file stays CRLF. Git reads such a file as it reads LF: measured, a
 * `.rafa/*` and a `!.rafa/specs/` ending in CRLF ignore `.rafa/effort/`
 * and not `.rafa/specs/`.
 *
 * ## The notice
 *
 * The notice prints when `tracking.all` is true and the flags differ
 * from the ones recorded in `.rafa/tracking.digest` as their
 * {@link trackingDigest}. The digest is of the three resolved flags and
 * not of the file's text, so an edited comment prints nothing and a
 * flag the user scope sets counts. It is rewritten whenever it differs,
 * `tracking.all` true or false, so turning the flag off and on again
 * prints the notice again, and so does changing another flag while
 * `tracking.all` stays on.
 *
 * The notice prints before the digest is written. A print that throws
 * leaves the old digest, and a digest that cannot be written throws, so
 * either way the next call prints the notice again rather than never.
 *
 * ## Seams
 *
 * The root is an absolute path, refused with a {@link GitignoreError}
 * otherwise, as `scope.ts` refuses a relative start: resolving it would
 * read the process's working directory. The notice prints through
 * `print`, the active output's `warn` when none is given, read at each
 * notice as `config-load.ts` reads it. Nothing here reads the home.
 */
import type { RafaConfig } from '../config.js';

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { describeValue, messageOf } from '../config-sections.js';

import { SCOPE_DIR } from './scope.js';

/** The file the entry is written to, under the project root. */
export const GITIGNORE_FILE = '.gitignore';

/** The digest file's name inside the scope directory. */
const DIGEST_NAME = 'tracking.digest';

/** The private triage directory inside the scope directory, as a `.gitignore` spells it. */
const PRIVATE_TRIAGE = 'triage/private';

/** The digest of the flags the notice last saw, relative to the project root. */
export const TRACKING_DIGEST_FILE = join(SCOPE_DIR, DIGEST_NAME);

/** The line above the entry. */
export const BLOCK_BEGIN = '# >>> rafa tracking: rafa rewrites the lines up to the end marker';

/** The line below the entry. */
export const BLOCK_END = '# <<< rafa tracking';

/** The three flags, as {@link RafaConfig} holds them. */
export type TrackingFlags = Readonly<Pick<RafaConfig, 'trackingSpecs' | 'trackingPlans' | 'trackingAll'>>;

/** Each individual flag and the sub-path of the scope directory it tracks, in entry order. */
const SUB_PATHS: readonly { readonly flag: keyof TrackingFlags; readonly dir: string }[] = [
  { flag: 'trackingSpecs', dir: 'specs' },
  { flag: 'trackingPlans', dir: 'plans' },
];

/**
 * A root this module cannot write under, a `.gitignore` or digest file
 * it cannot read or write, or a `.gitignore` whose markers it cannot
 * place the entry between.
 */
export class GitignoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`rafa gitignore: ${message}`, options);
    this.name = 'GitignoreError';
  }
}

/** How {@link writeTrackingGitignore} left the file. */
export type GitignoreChange = 'created' | 'updated' | 'unchanged';

/** What {@link writeTrackingGitignore} did. */
export interface GitignoreWrite {
  /** The `.gitignore` under the root. */
  readonly file: string;
  readonly change: GitignoreChange;
}

/** What {@link noticeTrackingChange} did. */
export interface TrackingNotice {
  /** The digest file under the root. */
  readonly digestFile: string;
  /** True when the flags differed from the recorded digest, which was then rewritten. */
  readonly changed: boolean;
  /** True when the notice printed. */
  readonly printed: boolean;
}

/** What {@link applyTracking} did. */
export interface TrackingApplied {
  readonly gitignore: GitignoreWrite;
  readonly notice: TrackingNotice;
}

/**
 * The entry's pattern lines for `flags`, without the markers. See the
 * module note for the three shapes and the re-include leading two.
 */
export function trackingEntry(flags: TrackingFlags): readonly string[] {
  if (flags.trackingAll) {
    return [`!/${SCOPE_DIR}/`, `${SCOPE_DIR}/${PRIVATE_TRIAGE}/`, `${SCOPE_DIR}/${DIGEST_NAME}`];
  }
  const tracked = SUB_PATHS
    .filter((sub) => flags[sub.flag])
    .map((sub) => `!${SCOPE_DIR}/${sub.dir}/`);
  if (tracked.length === 0) return [`${SCOPE_DIR}/`];
  return [`!/${SCOPE_DIR}/`, `${SCOPE_DIR}/*`, ...tracked];
}

/** The line break the text's first line ends with, or LF when it has none. */
function lineBreakOf(text: string): string {
  return /\r?\n/.exec(text)?.[0] ?? '\n';
}

/** The 0-based indices of the lines that are `marker`, a trailing carriage return dropped. */
function indicesOf(lines: readonly string[], marker: string): readonly number[] {
  return lines.flatMap((line, index) => line.replace(/\r$/, '') === marker
    ? [index]
    : []);
}

/** Where the lines at `indices` are, as a refusal names them: 1-based. */
function whereLines(indices: readonly number[]): string {
  if (indices.length === 0) return 'no line';
  const numbers = indices.map((index) => String(index + 1));
  return indices.length === 1
    ? `line ${numbers.join('')}`
    : `lines ${numbers.join(', ')}`;
}

/** The begin and end marker lines of a block, 0-based. */
interface BlockSpan {
  readonly begin: number;
  readonly end: number;
}

/** The block's span in `lines`, null when neither marker is there; refuses any other layout. */
function blockSpan(lines: readonly string[], file: string): BlockSpan | null {
  const begins = indicesOf(lines, BLOCK_BEGIN);
  const ends = indicesOf(lines, BLOCK_END);
  if (begins.length === 0 && ends.length === 0) return null;
  const [begin] = begins;
  const [end] = ends;
  if (begins.length === 1 && ends.length === 1 && begin !== undefined && end !== undefined && begin < end) {
    return { begin, end };
  }
  const found = `the begin marker is on ${whereLines(begins)} and the end marker on ${whereLines(ends)}`;
  throw new GitignoreError(
    `${file}: cannot place the tracking entry: ${found}, expected each once with the end below the begin`,
  );
}

/**
 * The `.gitignore` text holding the entry for `flags`: `text` with its
 * block replaced, `text` with a block appended when it holds none, or
 * the block alone when `text` is null or empty. `file` only labels a
 * refusal. Throws a {@link GitignoreError} for markers it cannot place
 * the entry between; see the module note.
 */
export function withTrackingBlock(text: string | null, flags: TrackingFlags, file: string = GITIGNORE_FILE): string {
  const source = text ?? '';
  const eol = lineBreakOf(source);
  const block = [BLOCK_BEGIN, ...trackingEntry(flags), BLOCK_END]
    .map((line) => `${line}${eol}`)
    .join('');
  if (source === '') return block;

  const lines = source.split('\n');
  const span = blockSpan(lines, file);
  if (span === null) {
    const separator = source.endsWith('\n')
      ? eol
      : `${eol}${eol}`;
    return `${source}${separator}${block}`;
  }
  const before = lines.slice(0, span.begin)
    .map((line) => `${line}\n`)
    .join('');
  const after = lines.slice(span.end + 1).join('\n');
  return `${before}${block}${after}`;
}

/** Refuses a root that is not absolute; see the module note. */
function requireAbsolute(root: string): void {
  if (!isAbsolute(root)) {
    throw new GitignoreError(`project root is ${describeValue(root)}, expected an absolute path`);
  }
}

/** Runs `act` on `file`, turning what it throws into a {@link GitignoreError} naming the file. */
function attempt<T>(file: string, failure: string, act: () => T): T {
  try {
    return act();
  } catch (error) {
    throw new GitignoreError(`${file} ${failure} (${messageOf(error)})`, { cause: error });
  }
}

/** The text of `file`, or null when nothing is at that path. */
function readIfPresent(file: string): string | null {
  if (!existsSync(file)) return null;
  return attempt(file, 'cannot be read', () => readFileSync(file, 'utf8'));
}

/**
 * Writes the entry for `flags` into `<root>/.gitignore`, creating the
 * file when it is missing, and writes nothing when the file already
 * holds that text. Throws a {@link GitignoreError} for a relative root,
 * a file it cannot read or write, and markers it cannot place the entry
 * between.
 */
export function writeTrackingGitignore(root: string, flags: TrackingFlags): GitignoreWrite {
  requireAbsolute(root);
  const file = join(root, GITIGNORE_FILE);
  const text = readIfPresent(file);
  const next = withTrackingBlock(text, flags, file);
  if (next === text) return { file, change: 'unchanged' };

  attempt(file, 'cannot be written', () => {
    writeFileSync(file, next);
  });
  const change: GitignoreChange = text === null
    ? 'created'
    : 'updated';
  return { file, change };
}

/**
 * The SHA-256 of the three flags, hex, which the digest file records.
 * Equal flags answer equal digests, whatever file or layer set them.
 */
export function trackingDigest(flags: TrackingFlags): string {
  const section = [
    `tracking.specs=${String(flags.trackingSpecs)}`,
    `tracking.plans=${String(flags.trackingPlans)}`,
    `tracking.all=${String(flags.trackingAll)}`,
  ].join('\n');
  return createHash('sha256').update(section)
    .digest('hex');
}

/** The notice `tracking.all` prints for the project at `root`: what a commit can now carry. */
export function exposureNotice(root: string): string {
  return [
    `tracking.all is true, so ${join(root, GITIGNORE_FILE)} no longer ignores ${SCOPE_DIR}/`
    + ' and a commit can carry what it holds, including:',
    '  - unpatched issues described in specs and plans',
    '  - effort rows with model names and token counts',
    '  - instincts that may quote error output',
    `${SCOPE_DIR}/${PRIVATE_TRIAGE}/ stays ignored. Set tracking.all to false to ignore ${SCOPE_DIR}/ again.`,
  ].join('\n');
}

/**
 * The default notice sink: the active output's `warn`
 * (`adapters/output/active.ts`), read at each notice.
 */
function printWarning(message: string): void {
  activeOutput().warn(message);
}

/**
 * Prints {@link exposureNotice} through `print` when `tracking.all` is
 * true and `flags` differ from the digest recorded under `root`, and
 * records their digest whenever it differs. Throws a
 * {@link GitignoreError} for a relative root and a digest file it
 * cannot read or write. See the module note for the order.
 */
export function noticeTrackingChange(
  root: string,
  flags: TrackingFlags,
  print: (message: string) => void = printWarning,
): TrackingNotice {
  requireAbsolute(root);
  const digestFile = join(root, TRACKING_DIGEST_FILE);
  const recorded = `${trackingDigest(flags)}\n`;
  if (readIfPresent(digestFile) === recorded) {
    return { digestFile, changed: false, printed: false };
  }

  if (flags.trackingAll) print(exposureNotice(root));
  attempt(digestFile, 'cannot be written', () => {
    mkdirSync(dirname(digestFile), { recursive: true });
    writeFileSync(digestFile, recorded);
  });
  return { digestFile, changed: true, printed: flags.trackingAll };
}

/**
 * Writes the `.gitignore` entry for `flags` under `root`, then prints
 * the `tracking.all` notice if the flags changed since it last printed.
 * A refused `.gitignore` throws before anything prints or the digest is
 * written.
 */
export function applyTracking(
  root: string,
  flags: TrackingFlags,
  print: (message: string) => void = printWarning,
): TrackingApplied {
  const gitignore = writeTrackingGitignore(root, flags);
  return { gitignore, notice: noticeTrackingChange(root, flags, print) };
}
