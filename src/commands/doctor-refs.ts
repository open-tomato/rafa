/**
 * The references row of `rafa doctor`: how many references each saved
 * copy under `specs.dir` names that read `suspect`, `dangling` or
 * `unknown`, counted over every copy at once, with `rafa issue check
 * <n>` as the fix for a copy that holds any of the first two
 * (`.rafa/specs/rafa-151-references-specs-bugs-are.md`).
 *
 * ## Which copies
 *
 * Every file directly under `specs.dir`, resolved against the project
 * root, named `rafa-<n>-<slug>.md`, the local notes file
 * `rafa-<n>-notes.md` aside: the names `rafa issue check` finds a copy
 * by (`./issue/check.ts`). `previous/` is not read, since a copy moved
 * there is no longer the one a plan is made from. Two copies of one
 * issue are both counted, each on its own line. A `specs.dir` that does
 * not exist holds no copy; one that cannot be listed answers
 * `{ ok: false, detail }`.
 *
 * ## The reading writes nothing
 *
 * Each copy is read by `readRefsText` (`../refs/reading.ts`) over its
 * text, and the copy it answers is thrown away: `doctor` reports and
 * writes nothing, so a reference a copy keeps no stamp for reads `ok`
 * here without being stamped. `rafa issue check <n>` is the reading
 * that writes that first stamp.
 *
 * ## Issue reads, once per run
 *
 * Every copy is read through ONE verifier, so a target named by several
 * copies is read once (`memoiseVerifier`), and under it one issue
 * reader memoised by repository and number, so `#7` and `rafa-7` cost
 * one `gh issue view` between them. Same-repository issues go through
 * the `gh` runner `doctor` opened for the board.
 *
 * ## An unreadable board is `unknown`
 *
 * A board issue `gh` could not read rejects `plan create`'s check 4,
 * but here it would fail a row that only counts: so a failed read of
 * the board's own issue reads `unknown`, as an unreadable
 * cross-repository issue already does, and the copy is still counted.
 * After the first such failure every later board issue reads `unknown`
 * without asking `gh` again. A project whose provider is not `gh` has
 * no runner, and every issue it names reads `unknown` with no process
 * spawned. Any other failure — git refusing, a refs block the codec
 * will not read — fails that copy alone, its detail kept on its line.
 *
 * ## The row
 *
 * {@link renderDoctorRefs} prints nothing for a project with no saved
 * copy. Otherwise one line counts the copies and the states; each copy
 * holding a suspect or dangling reference, or one that could not be
 * read, then gets a line naming `rafa issue check <n>`; a copy holding
 * only unknown references gets a line saying why they were not
 * checked. Nothing here changes `doctor`'s exit code.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { RefState } from '../refs/stamp.js';
import type { IssueRead, IssueReader, RefVerifier } from '../refs/verify.js';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ID_PREFIX, notesFileName, SPEC_EXTENSION } from '../board/naming.js';
import { memoiseVerifier } from '../board/refs-gate.js';
import { messageOf } from '../config-sections.js';
import { createGitRunner } from '../pr/git.js';
import { readRefsText } from '../refs/reading.js';
import { UNREADABLE } from '../refs/stamp.js';
import { createRefVerifier, ghIssueReader, RefVerifyError, tsSymbolsOutliner } from '../refs/verify.js';

import { coreRoster } from './plan/refs-check.js';

/** The fix a copy holding a suspect or dangling reference is pointed at. */
export function issueCheckCommand(issue: number): string {
  return `rafa issue check ${String(issue)}`;
}

/** What an issue read answers when there is no board runner to read it with. */
export const NO_BOARD_DETAIL = 'no GitHub board: the pull request provider is not gh';

/** A saved copy's name: `rafa-<n>-<slug>.md`. */
const COPY_NAME = new RegExp(`^${ID_PREFIX}-([1-9]\\d*)-.+\\${SPEC_EXTENSION}$`, 'u');

/** How the references row is read; each left out is the system's own. */
export interface DoctorRefsSeams {
  /**
   * Makes the verifier for the project root over `issues`, the memoised
   * reader the row hands in. `createRefVerifier` over git in the root,
   * `ts-symbols` and the core roster when left out.
   */
  readonly refsVerifier?: (root: string, issues: IssueReader) => RefVerifier | Promise<RefVerifier>;
}

/** What {@link readDoctorRefs} reads from. */
export interface DoctorRefsInput {
  /** The project root: `specs.dir` is resolved against it, and git runs in it. */
  readonly root: string;
  /** `specs.dir` as configured. */
  readonly specsDir: string;
  /** The `gh` runner `doctor` opened for the board, or null for a provider that is not `gh`. */
  readonly gh: GhRunner | null;
  /** The environment `ts-symbols` is looked up on; `process.env` when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** One saved copy's counts. */
export interface DoctorRefsCopy {
  /** The issue the copy is a spec of. */
  readonly issue: number;
  /** The copy under `specs.dir` as configured. */
  readonly path: string;
  readonly suspect: number;
  readonly dangling: number;
  readonly unknown: number;
  /** Why the copy's references could not be read, or null when they were. */
  readonly error: string | null;
}

/** Every copy's counts and their totals, or why `specs.dir` could not be listed. */
export type DoctorRefsReading =
  | {
    readonly ok: true;
    readonly copies: readonly DoctorRefsCopy[];
    readonly suspect: number;
    readonly dangling: number;
    readonly unknown: number;
  }
  | { readonly ok: false; readonly detail: string };

/** A saved copy found under `specs.dir`. */
interface CopyFile {
  readonly issue: number;
  readonly name: string;
}

/** The saved copies directly under `dir`, by name; none when `dir` does not exist. */
function listCopies(dir: string): readonly CopyFile[] {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  return [...names].sort().flatMap((name) => {
    const issue = Number(COPY_NAME.exec(name)?.[1]);
    if (!Number.isSafeInteger(issue) || name === notesFileName(issue)) return [];
    return statSync(join(dir, name)).isFile()
      ? [{ issue, name }]
      : [];
  });
}

/** An issue reader that asks nothing and answers every issue as unreadable. */
function noBoardReader(): IssueReader {
  return async () => ({ kind: 'failed', detail: NO_BOARD_DETAIL });
}

/**
 * `issues` memoised by repository and number, answering every board
 * issue as failed without asking once one board read has failed; see
 * the module note.
 */
export function memoiseIssueReader(issues: IssueReader): IssueReader {
  const read = new Map<string, Promise<IssueRead>>();
  let boardFailure: IssueRead | null = null;
  return async (number, repo) => {
    if (repo === undefined && boardFailure !== null) return boardFailure;
    const key = `${repo ?? ''}#${String(number)}`;
    const known = read.get(key);
    if (known !== undefined) return known;
    const reading = issues(number, repo);
    read.set(key, reading);
    const answer = await reading;
    if (repo === undefined && answer.kind === 'failed') boardFailure = answer;
    return answer;
  };
}

/** The verifier the row reads with by default; see {@link DoctorRefsSeams.refsVerifier}. */
async function defaultVerifier(input: DoctorRefsInput, issues: IssueReader): Promise<RefVerifier> {
  return createRefVerifier({
    issues,
    git: createGitRunner(input.root),
    outline: tsSymbolsOutliner({ cwd: input.root, env: input.env }),
    roster: await coreRoster(),
  });
}

/** `verify` reading a board issue it could not read as unknown rather than rejecting; see the module note. */
function boardUnknown(verify: RefVerifier): RefVerifier {
  return async (ref) => {
    try {
      return await verify(ref);
    } catch (error) {
      if (ref.kind === 'issue' && error instanceof RefVerifyError) return UNREADABLE;
      throw error;
    }
  };
}

/** How many of `states` read `state`. */
function countOf(states: readonly RefState[], state: RefState): number {
  return states.filter((each) => each === state).length;
}

/** One copy's counts, or its failure; never a rejection. */
async function readCopy(file: CopyFile, input: DoctorRefsInput, verify: () => Promise<RefVerifier>): Promise<DoctorRefsCopy> {
  const path = join(input.specsDir, file.name);
  const empty = { issue: file.issue, path, suspect: 0, dangling: 0, unknown: 0 };
  try {
    const copy = readFileSync(resolve(input.root, path), 'utf8');
    const { rows } = await readRefsText({ copy, issue: file.issue, verify: await verify() });
    const states = rows.map((row) => row.state);
    return Object.freeze({
      ...empty,
      suspect: countOf(states, 'suspect'),
      dangling: countOf(states, 'dangling'),
      unknown: countOf(states, 'unknown'),
      error: null,
    });
  } catch (error) {
    return Object.freeze({ ...empty, error: messageOf(error) });
  }
}

/** The sum of `field` over `copies`. */
function total(copies: readonly DoctorRefsCopy[], field: 'suspect' | 'dangling' | 'unknown'): number {
  return copies.reduce((sum, copy) => sum + copy[field], 0);
}

/**
 * Counts the suspect, dangling and unknown references of every saved
 * copy under `input.specsDir`, reading each target once for the run;
 * see the module note. Writes nothing, and never rejects.
 */
export async function readDoctorRefs(input: DoctorRefsInput, seams: DoctorRefsSeams = {}): Promise<DoctorRefsReading> {
  let files: readonly CopyFile[];
  try {
    files = listCopies(resolve(input.root, input.specsDir));
  } catch (error) {
    return { ok: false, detail: messageOf(error) };
  }

  const issues = memoiseIssueReader(input.gh === null
    ? noBoardReader()
    : ghIssueReader(input.gh));
  const make = seams.refsVerifier ?? ((root: string, reader: IssueReader) => defaultVerifier({ ...input, root }, reader));
  let made: Promise<RefVerifier> | null = null;
  const verify = async (): Promise<RefVerifier> => {
    made ??= Promise.resolve(make(input.root, issues)).then((verifier) => memoiseVerifier(boardUnknown(verifier)));
    return made;
  };

  const copies: DoctorRefsCopy[] = [];
  for (const file of files) copies.push(await readCopy(file, input, verify));
  return {
    ok: true,
    copies: Object.freeze(copies),
    suspect: total(copies, 'suspect'),
    dangling: total(copies, 'dangling'),
    unknown: total(copies, 'unknown'),
  };
}

/** `1 suspect, 2 dangling`, naming only the states some reference reads. */
function stateCounts(counts: Pick<DoctorRefsCopy, 'suspect' | 'dangling' | 'unknown'>): string {
  return [
    [counts.suspect, 'suspect'],
    [counts.dangling, 'dangling'],
    [counts.unknown, 'unknown'],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, state]) => `${String(count)} ${String(state)}`)
    .join(', ');
}

/** The line one copy gets, or none for a copy whose references all read. */
function copyLine(copy: DoctorRefsCopy): readonly string[] {
  const issue = `#${String(copy.issue)}`;
  if (copy.error !== null) {
    return [`  ${issue} ${copy.path}: its references could not be read (${copy.error}) — ${issueCheckCommand(copy.issue)}`];
  }
  if (copy.suspect + copy.dangling > 0) return [`  ${issue} ${copy.path}: ${stateCounts(copy)} — ${issueCheckCommand(copy.issue)}`];
  if (copy.unknown > 0) {
    return [`  ${issue} ${copy.path}: ${stateCounts(copy)}, not checked — the board or their repository could not be read`];
  }
  return [];
}

/** The head line: how many copies, and what their references read. */
function headLine(reading: Extract<DoctorRefsReading, { ok: true }>): string {
  const copies = reading.copies.length === 1
    ? '1 saved copy'
    : `${String(reading.copies.length)} saved copies`;
  const failed = reading.copies.filter((copy) => copy.error !== null).length;
  const counts = stateCounts(reading);
  const unread = failed === 0
    ? ''
    : `, ${String(failed)} not read`;
  if (reading.suspect + reading.dangling === 0) {
    const unknown = reading.unknown === 0
      ? ''
      : ` (${counts})`;
    return `References: ${copies}, none suspect or dangling${unknown}${unread}.`;
  }
  return `References: ${counts} across ${copies}${unread}; run rafa issue check <n> to see each:`;
}

/**
 * The row for `reading`: nothing for a project with no saved copy or a
 * `specs.dir` that could not be listed, a head line otherwise, and a
 * line per copy that needs one; see the module note.
 */
export function renderDoctorRefs(reading: DoctorRefsReading): readonly string[] {
  if (!reading.ok || reading.copies.length === 0) return [];
  return [headLine(reading), ...reading.copies.flatMap(copyLine)];
}
