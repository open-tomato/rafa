/**
 * The `local` Tracker adapter: issues as markdown files under
 * `.rafa/issues/`, for a project with no remote tracker, or a run whose
 * remote trackers all failed their preflight.
 *
 * Copied from `createLocalTracker` in open-tomato's
 * `packages/shared/issue-tracker/src/adapters/local.ts` at commit
 * `45aaab563e5b4f4e6258e19ebf752b7cfeb67bf0` (2026-08-05), and retyped
 * against rafa's `Tracker` port, which `src/ports/index.ts` copies from
 * the same commit's `port.ts`.
 *
 * ## One file per issue
 *
 * An issue is the file `<number>.md` under the directory: YAML
 * frontmatter, then the body exactly as the draft held it. The
 * frontmatter holds, in this order, the draft's `opt`, `type`, `module`,
 * `priority`, `project`, `title` and `blockedBy`, then the issue's
 * `state`, its `fallbackReason`, the `capturedAt` it was created at and
 * its `comments`, each comment written as `<now>: <body>`.
 * `Bun.YAML.stringify` writes the block and `Bun.YAML.parse` reads it
 * back.
 *
 * A file is an issue when its name is a positive whole number in
 * decimal, with no sign and no leading zero, within
 * `Number.MAX_SAFE_INTEGER`, followed by `.md`. Any other file under the
 * directory is not an issue: `find` never reads it, and it holds no
 * number.
 *
 * ## The fallback reason
 *
 * Every issue records the `fallbackReason` its adapter was made with:
 * why the trackers ahead of `local` were passed over, as the degradation
 * chain joins the failures it logged. A comment or a transition rewrites
 * the file keeping the reason recorded at create, whatever reason the
 * adapter writing it was made with, so the file keeps saying why that
 * issue landed here. The source's reason is always a string, since its
 * adapter is reached only by falling back. rafa's config can name
 * `local` as `tracker.default`, and an adapter reached first has no
 * failure to record, so the reason is `null` there.
 *
 * ## What the copy changes
 *
 *   - Identity. rafa ports no OPT ledger, and triage passes `opt: 0` in
 *     every draft, so a file cannot be named after `draft.opt` as the
 *     source's `OPT-<opt>.md` is. `create` numbers the issue one past the
 *     highest issue number under the directory, starting at 1, names the
 *     file after it and answers it in decimal as `IssueRef.externalId`.
 *     A corrupt issue file still holds its number. The file is created
 *     exclusively, so two creates racing for one number never overwrite
 *     each other: the one that finds the file taken tries the next
 *     number. `draft.opt` is kept in the frontmatter and answered as
 *     `ref.opt`, as it was handed over.
 *   - Refs. `get`, `comment` and `transition` read the file
 *     `ref.externalId` names, where the source read `ref.opt`. The
 *     source's `externalId` was the file's path. A local issue number is
 *     also a valid GitHub issue number, so a ref of another kind is
 *     refused rather than read as an unrelated local issue. An
 *     `externalId` that is not an issue number is refused before any
 *     path is built from it, so no ref names a file outside the
 *     directory.
 *   - Validation. Fields are checked by hand where the source used
 *     `zod`, and `Bun.YAML` parses where the source used `js-yaml`. Keys
 *     beyond the eleven are ignored, as `zod`'s default object strips
 *     them. The source checked a file when reading it; the copy also
 *     checks one before writing it. A draft, a state or a clock reading
 *     no read would accept is refused with nothing written, rather than
 *     written into a file every later read refuses.
 *   - Errors. `find` answers no issues for a directory that does not
 *     exist, and rejects for any other failure to list it, such as a
 *     path naming a file. The source answered no issues for every
 *     failure. An issue file `find` cannot read is skipped and reported
 *     through `warn`, which defaults to the active output's `warn`
 *     (`src/adapters/output/active.ts`), read when the report is made.
 *     The source wrote the report with `console.warn`.
 *   - Names. The source's say pending, since its captures wait for a
 *     sync rafa does not port: `PendingCapture` is
 *     {@link LocalIssueRecord}, `renderPendingFile` is
 *     {@link renderLocalIssue}, `parsePendingFile` is
 *     {@link parseLocalIssue}, `listPending` is {@link listLocalIssues},
 *     and the `pendingDir` option is `issuesDir`.
 *   - The tracker answered is frozen, as the outputs are.
 *
 * Kept as the source has them: `preflight` always answers ok, since the
 * file system is the last resort; the capabilities are all false; `find`
 * narrows by `module`, `type` and `state`, and by `text` as a lower-cased
 * substring of the title and the body joined by a newline, an absent
 * field narrowing by nothing, and then takes the first `limit`, oldest
 * first; and `transition` answers `{}`.
 */
import type {
  Issue,
  IssueDraft,
  IssuePriority,
  IssueQuery,
  IssueRef,
  IssueState,
  IssueType,
  Tracker,
  TrackerCapabilities,
  TransitionResult,
} from '../../ports/index.js';

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describeValue, isMapping, messageOf } from '../../config-sections.js';
import { activeOutput } from '../output/active.js';

import { ISSUE_PRIORITIES, ISSUE_STATES, ISSUE_TYPES } from './issue-values.js';

/** What every refusal and report opens with. */
const PREFIX = 'local tracker';

/** The frontmatter block and the body after it. */
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

/** An issue number as written: a positive whole number with no leading zero. */
const ISSUE_NUMBER = /^[1-9]\d*$/;

/** What an issue file's name ends with. */
const ISSUE_EXTENSION = '.md';

/** An issue as its file holds it. */
export interface LocalIssueRecord {
  readonly draft: IssueDraft;
  /** Why the trackers ahead of `local` were passed over, or null when none was. */
  readonly fallbackReason: string | null;
  /** When the issue was created, as ISO 8601. */
  readonly capturedAt: string;
  readonly state: IssueState;
  /** Every comment posted, oldest first, each opening with its timestamp. */
  readonly comments: readonly string[];
}

/** One issue file `find` could read. */
export interface LocalIssueFile {
  /** The issue's number, answered as `externalId`. */
  readonly number: number;
  /** The file's path. */
  readonly path: string;
  readonly record: LocalIssueRecord;
}

/** What a local tracker is made with. */
export interface LocalTrackerOptions {
  /** The directory the issues live in, as {@link localIssuesDir} answers it for a repository. */
  readonly issuesDir: string;
  /** Recorded in every issue this tracker creates; see the module note. */
  readonly fallbackReason: string | null;
  /** Stamps `capturedAt` and each comment, as ISO 8601. The system clock when left out. */
  readonly now?: () => string;
  /** Reports an issue file `find` skipped. The active output's `warn` when left out. */
  readonly warn?: (message: string) => void;
}

/** The frontmatter as it is written and read. */
interface LocalIssueFrontmatter {
  opt: number;
  type: IssueType;
  module: string;
  priority: IssuePriority | null;
  project: string | null;
  title: string;
  blockedBy: readonly number[];
  state: IssueState;
  fallbackReason: string | null;
  capturedAt: string;
  comments: readonly string[];
}

/** Whether a field's value is acceptable, and what an acceptable one is. */
type FieldCheck = readonly [accepts: (value: unknown) => boolean, expected: string];

/** True for a string. */
function isString(value: unknown): boolean {
  return typeof value === 'string';
}

/** True for a finite number. */
function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Accepts one of `members`. */
function oneOf(members: readonly string[]): (value: unknown) => boolean {
  return (value) => typeof value === 'string' && members.includes(value);
}

/** Accepts null, or what `accepts` accepts. */
function orNull(accepts: (value: unknown) => boolean): (value: unknown) => boolean {
  return (value) => value === null || accepts(value);
}

/** Accepts a list whose every item `accepts` accepts. */
function listOf(accepts: (value: unknown) => boolean): (value: unknown) => boolean {
  return (value) => Array.isArray(value) && value.every(accepts);
}

/**
 * Each frontmatter field's check, in the order the fields are written.
 * `satisfies` closes the set over the frontmatter's keys both ways.
 */
const FIELD_CHECKS = {
  opt: [isFiniteNumber, 'a number'],
  type: [oneOf(ISSUE_TYPES), `one of: ${ISSUE_TYPES.join(', ')}`],
  module: [isString, 'a string'],
  priority: [orNull(oneOf(ISSUE_PRIORITIES)), `null or one of: ${ISSUE_PRIORITIES.join(', ')}`],
  project: [orNull(isString), 'a string or null'],
  title: [isString, 'a string'],
  blockedBy: [listOf(isFiniteNumber), 'a list of numbers'],
  state: [oneOf(ISSUE_STATES), `one of: ${ISSUE_STATES.join(', ')}`],
  fallbackReason: [orNull(isString), 'a string or null'],
  capturedAt: [isString, 'a string'],
  comments: [listOf(isString), 'a list of strings'],
} satisfies Record<keyof LocalIssueFrontmatter, FieldCheck>;

/** The first thing wrong with a frontmatter value, or null when nothing is. */
function frontmatterProblem(value: unknown): string | null {
  if (!isMapping(value)) {
    return `the frontmatter is ${describeValue(value)}, expected a mapping`;
  }
  for (const [key, [accepts, expected]] of Object.entries(FIELD_CHECKS)) {
    if (!accepts(value[key])) {
      return `${key} is ${describeValue(value[key])}, expected ${expected}`;
    }
  }
  return null;
}

/** True when `error` carries the system error code `code`. */
function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** The issue number `text` writes, or null when it writes none. */
function parseIssueNumber(text: string): number | null {
  if (!ISSUE_NUMBER.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number)
    ? number
    : null;
}

/** The issue number a file name holds, or null when the file is not an issue. */
function issueNumberOfFile(name: string): number | null {
  return name.endsWith(ISSUE_EXTENSION)
    ? parseIssueNumber(name.slice(0, -ISSUE_EXTENSION.length))
    : null;
}

/** The path of issue `number` under `issuesDir`. */
function issuePath(issuesDir: string, number: number): string {
  return join(issuesDir, `${number}${ISSUE_EXTENSION}`);
}

/**
 * The issue numbers under `issuesDir`, lowest first: none when the
 * directory does not exist. Rejects for any other failure to list it.
 */
async function issueNumbers(issuesDir: string): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(issuesDir);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return [];
    throw error;
  }
  return names
    .map(issueNumberOfFile)
    .filter((number): number is number => number !== null)
    .sort((a, b) => a - b);
}

/** Where `local` issues live under a repository: `.rafa/issues/`. */
export function localIssuesDir(repoRoot: string): string {
  return join(repoRoot, '.rafa', 'issues');
}

/**
 * An issue file's contents.
 *
 * Throws a `TypeError`, answering nothing, when the record holds a
 * field no {@link parseLocalIssue} would accept, naming the first such
 * field, or a body that is not a string.
 */
export function renderLocalIssue(record: LocalIssueRecord): string {
  const { draft } = record;
  const frontmatter = {
    opt: draft.opt,
    type: draft.type,
    module: draft.module,
    priority: draft.priority,
    project: draft.project,
    title: draft.title,
    blockedBy: draft.blockedBy,
    state: record.state,
    fallbackReason: record.fallbackReason,
    capturedAt: record.capturedAt,
    comments: record.comments,
  } satisfies LocalIssueFrontmatter;

  const problem = frontmatterProblem(frontmatter)
    ?? (typeof draft.body === 'string'
      ? null
      : `body is ${describeValue(draft.body)}, expected a string`);
  if (problem !== null) {
    throw new TypeError(`${PREFIX}: refused to write an invalid issue: ${problem}`);
  }
  return `---\n${Bun.YAML.stringify(frontmatter, null, 2)}\n---\n${draft.body}`;
}

/**
 * Reads an issue file's contents.
 *
 * Throws when the contents open with no frontmatter block, when the
 * block is not YAML, or when it holds a field this module does not
 * write, naming `sourcePath` when one is given and the first field
 * refused.
 */
export function parseLocalIssue(contents: string, sourcePath?: string): LocalIssueRecord {
  const at = sourcePath === undefined
    ? ''
    : ` at ${sourcePath}`;

  const match = FRONTMATTER.exec(contents);
  if (match === null) {
    throw new Error(`${PREFIX}: the issue${at} has no YAML frontmatter block`);
  }
  const [, block = '', body = ''] = match;

  let meta: unknown;
  try {
    meta = Bun.YAML.parse(block);
  } catch (error) {
    throw new Error(`${PREFIX}: invalid issue${at}: ${messageOf(error)}`, { cause: error });
  }
  const problem = frontmatterProblem(meta);
  if (problem !== null) {
    throw new Error(`${PREFIX}: invalid issue${at}: ${problem}`);
  }

  // Every field was checked above.
  const fields = meta as unknown as LocalIssueFrontmatter;
  return {
    draft: {
      opt: fields.opt,
      title: fields.title,
      body,
      type: fields.type,
      module: fields.module,
      priority: fields.priority,
      project: fields.project,
      blockedBy: fields.blockedBy,
    },
    fallbackReason: fields.fallbackReason,
    capturedAt: fields.capturedAt,
    state: fields.state,
    comments: fields.comments,
  };
}

/** Reports through the output active when the report is made. */
function warnThroughActiveOutput(message: string): void {
  activeOutput().warn(message);
}

/**
 * Every issue under `issuesDir` that can be read, lowest number first.
 *
 * One unreadable file never hides the others: each is read on its own,
 * and one that fails is reported through `warn` and left out. Answers
 * none when the directory does not exist, and rejects for any other
 * failure to list it.
 */
export async function listLocalIssues(
  issuesDir: string,
  warn: (message: string) => void = warnThroughActiveOutput,
): Promise<LocalIssueFile[]> {
  const numbers = await issueNumbers(issuesDir);
  const settled = await Promise.allSettled(numbers.map(async (number): Promise<LocalIssueFile> => {
    const path = issuePath(issuesDir, number);
    let contents: string;
    try {
      contents = await readFile(path, 'utf8');
    } catch (error) {
      throw new Error(`${PREFIX}: could not read ${path}: ${messageOf(error)}`, { cause: error });
    }
    return { number, path, record: parseLocalIssue(contents, path) };
  }));

  return settled.flatMap((result) => {
    if (result.status === 'fulfilled') return [result.value];
    warn(`${messageOf(result.reason)}; find skipped it`);
    return [];
  });
}

/** True when an issue's record matches every field `query` narrows by. */
function matchesQuery(record: LocalIssueRecord, query: IssueQuery): boolean {
  const { draft } = record;
  if (query.module !== undefined && draft.module !== query.module) return false;
  if (query.type !== undefined && draft.type !== query.type) return false;
  if (query.state !== undefined && record.state !== query.state) return false;
  if (query.text === undefined) return true;
  return `${draft.title}\n${draft.body}`.toLowerCase().includes(query.text.toLowerCase());
}

/** The ref of issue `number`, carrying the `opt` its draft held. */
function refFor(number: number, opt: number): IssueRef {
  return { opt, kind: 'local', externalId: String(number), url: null };
}

/**
 * The issue number a ref names. Throws when the ref is of another kind,
 * or its `externalId` is not an issue number.
 */
function issueNumberOfRef(ref: IssueRef): number {
  if (ref.kind !== 'local') {
    throw new Error(
      `${PREFIX}: refused a ref of kind ${describeValue(ref.kind)}; this tracker reads local refs only`,
    );
  }
  const number = typeof ref.externalId === 'string'
    ? parseIssueNumber(ref.externalId)
    : null;
  if (number === null) {
    throw new Error(
      `${PREFIX}: externalId ${describeValue(ref.externalId)} is not a local issue number,`
        + ' expected a positive whole number with no leading zero',
    );
  }
  return number;
}

/** Makes a `local` tracker over `options.issuesDir`; see the module note. */
export function createLocalTracker(options: LocalTrackerOptions): Tracker {
  const { issuesDir, fallbackReason } = options;
  const now = options.now ?? ((): string => new Date().toISOString());
  const warn = options.warn ?? warnThroughActiveOutput;

  /** The issue a ref names, and its number. */
  async function read(ref: IssueRef): Promise<{ number: number; record: LocalIssueRecord }> {
    const number = issueNumberOfRef(ref);
    const path = issuePath(issuesDir, number);
    let contents: string;
    try {
      contents = await readFile(path, 'utf8');
    } catch (cause) {
      throw new Error(`${PREFIX}: no issue ${number} under ${issuesDir}`, { cause });
    }
    return { number, record: parseLocalIssue(contents, path) };
  }

  /** Writes an existing issue's file again, refusing a record no read would accept. */
  async function rewrite(number: number, record: LocalIssueRecord): Promise<void> {
    const contents = renderLocalIssue(record);
    await writeFile(issuePath(issuesDir, number), contents, 'utf8');
  }

  const tracker: Tracker = {
    kind: 'local',

    capabilities: (): TrackerCapabilities => ({
      projects: false,
      customFields: false,
      issueTypes: false,
    }),

    preflight: async () => ({ ok: true }),

    create: async (draft: IssueDraft): Promise<IssueRef> => {
      const contents = renderLocalIssue({
        draft,
        fallbackReason,
        capturedAt: now(),
        state: 'todo',
        comments: [],
      });
      await mkdir(issuesDir, { recursive: true });
      const held = await issueNumbers(issuesDir);
      for (let number = (held.at(-1) ?? 0) + 1; Number.isSafeInteger(number); number += 1) {
        try {
          await writeFile(issuePath(issuesDir, number), contents, { encoding: 'utf8', flag: 'wx' });
          return refFor(number, draft.opt);
        } catch (error) {
          if (!hasCode(error, 'EEXIST')) throw error;
        }
      }
      throw new Error(`${PREFIX}: no issue number is left under ${issuesDir}`);
    },

    get: async (ref: IssueRef): Promise<Issue> => {
      const { record } = await read(ref);
      return { ...record.draft, ref, state: record.state };
    },

    find: async (query: IssueQuery): Promise<IssueRef[]> => {
      const matched = (await listLocalIssues(issuesDir, warn))
        .filter(({ record }) => matchesQuery(record, query));
      return matched
        .slice(0, query.limit ?? matched.length)
        .map(({ number, record }) => refFor(number, record.draft.opt));
    },

    comment: async (ref: IssueRef, body: string): Promise<void> => {
      const { number, record } = await read(ref);
      await rewrite(number, { ...record, comments: [...record.comments, `${now()}: ${body}`] });
    },

    transition: async (ref: IssueRef, state: IssueState): Promise<TransitionResult> => {
      const { number, record } = await read(ref);
      await rewrite(number, { ...record, state });
      return {};
    },
  };
  return Object.freeze(tracker);
}
