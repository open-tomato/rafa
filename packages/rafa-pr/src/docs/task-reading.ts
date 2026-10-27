/**
 * What the doc task is handed: the plan's `sighting` rows and the files
 * its commits touched, read by {@link readDocTaskInput} and written into
 * the task prompt by {@link renderDocTaskSection}.
 *
 * A plan that changes code ends on one task declared `docs=repair`
 * beside `agent=doc-updater`, which repairs the docs of what the plan
 * changed. It works from two things. The rows are the reason: each is a
 * documentation line a session of the plan reported as stale, in its
 * report's `stale_docs` field, stored as a `sighting`
 * (`effort/store/stale-docs.ts`). The files are the reach: every path
 * the plan's commits touched, read off git. A plan with no rows is
 * handed the files alone, under a line saying no session reported a
 * stale line, so the task repairs from the diff.
 *
 * ## The rows
 *
 * `readStaleDocsForPlan` answers both kinds of row under the stub, and
 * only the `sighting` rows are kept: an `unsettled` row is what a doc
 * task already could not settle, and is the release issue's to carry.
 * Rows are kept in append order. Two rows naming the same place and the
 * same text, which two sessions write when both saw one line, are
 * handed once, the first kept.
 *
 * ## The files
 *
 * `git merge-base <baseRef> HEAD` names where the plan's branch left the
 * run's base, and `git diff --name-only -z --no-renames <that> HEAD`
 * lists every path changed since, relative to the repository root.
 * `--no-renames` lists a renamed file under both its old and new path,
 * since a page may still name the old one. `-z` keeps a path git would
 * otherwise quote (a space or a non-ASCII byte) as it is on disk. A
 * file added and deleted again within the plan is not in the diff, and
 * so is not handed.
 *
 * ## A read that fails
 *
 * Neither read throws. The doc task still runs with what could be read,
 * so a failure is answered in the input as a sentence and rendered into
 * the section in place of its list:
 *
 *   - a git read that fails (an unknown base ref, no shared history, a
 *     git that cannot be spawned) leaves `touchedFiles` null and says
 *     what git said in `filesProblem`;
 *   - a store that exists and cannot be read leaves `sightings` empty
 *     and says why in `sightingsProblem`. A store that does not exist is
 *     no failure: it holds no row, and the plan has none.
 *
 * ## The section
 *
 *     ## Documentation to repair
 *     Repair the documentation of what this plan changed. ...
 *     Sessions of this plan reported these documentation lines as stale:
 *     - context/triage.md:12: names three channels
 *     The plan's commits touched these files since it left `origin/main`:
 *     - `packages/rafa-pr/src/triage/triage.ts`
 *
 * A row is `- <where>: <what>`, and `- <what>` for one that named no
 * place. A file is `` - `<path>` ``. At most {@link DOC_TASK_FILE_CAP}
 * files are listed, in git's order, and the rest are counted in one
 * closing `- ...and <n> more.` line. Rows are not capped: they are the
 * reason, and a plan's sessions write few.
 *
 * Every text a session or git wrote is put on one line, each run of
 * white space one space, so no row can open a prompt line of its own
 * (a heading, or the `<!-- ralph:plan=... -->` stamp `planStubFromPrompt`
 * reads). Then the whole section is redacted of local paths by
 * `localPathRedactor` (`triage/local-paths.ts`): a path under the
 * repository root reads relative to it and a home directory reads
 * `[redacted: HOME]`, so a row naming `/home/<name>/repo/context/a.md`
 * hands the session `context/a.md`. Redaction comes after the joining,
 * so a path a line break split is matched whole.
 */
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';
import type { StaleDocRow } from '@open-tomato/rafa/store/stale-docs';

import { homedir } from 'node:os';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { createGitRunner, gitSaid } from '@open-tomato/rafa/core/git';
import { readStaleDocsForPlan } from '@open-tomato/rafa/store/stale-docs';
import { localPathRedactor } from '@open-tomato/rafa/triage/local-paths';

/** The heading of the doc task's section. */
export const DOC_TASK_HEADING = '## Documentation to repair';

/** The sentence under the heading: what the task is for. */
export const DOC_TASK_SENTENCE: string = 'Repair the documentation of what this plan changed. '
  + 'For each stale line below, and for each page, README section, skill or TSDoc note that describes a touched file, '
  + 'correct every line the change falsified.';

/** The line standing for the rows of a plan whose sessions reported none. */
export const NO_SIGHTINGS_LINE: string = 'No session of this plan reported a stale documentation line: '
  + 'repair from the touched files alone.';

/** The most touched files the section lists before counting the rest. */
export const DOC_TASK_FILE_CAP = 200;

/** One stale line a session of the plan reported, as the doc task is handed it. */
export interface DocTaskSighting {
  /** The file, with the line when known, or null when the session named none. */
  readonly where: string | null;
  /** What no longer matches. */
  readonly what: string;
}

/** What the doc task is handed; see the module note. */
export interface DocTaskInput {
  /** The ref the plan's branch is diffed against, as the caller named it. */
  readonly baseRef: string;
  /** The plan's `sighting` rows, in append order, each place and text once. */
  readonly sightings: readonly DocTaskSighting[];
  /** Why the rows could not be read, or null when they were. */
  readonly sightingsProblem: string | null;
  /** Every path the plan's commits touched, or null when git could not say. */
  readonly touchedFiles: readonly string[] | null;
  /** Why the touched files could not be read, or null when they were. */
  readonly filesProblem: string | null;
}

/** What {@link readDocTaskInput} reads, and the seams a test replaces. */
export interface DocTaskInputOptions {
  /** The repository root: where the store lives and where git runs. */
  readonly repoRoot: string;
  /** The plan whose rows are read. */
  readonly planStub: string;
  /** The run's base, as a ref git resolves (`origin/main`, `main`, a sha). */
  readonly baseRef: string;
  /** Runs git. Defaults to {@link createGitRunner} over `repoRoot`. */
  readonly git?: GitRunner;
  /** Reads a plan's rows. Defaults to `readStaleDocsForPlan`. */
  readonly readRows?: (repoRoot: string, planStub: string) => readonly StaleDocRow[];
}

/** The paths of a git result. */
type TouchedRead =
  | { readonly files: readonly string[]; readonly problem: null }
  | { readonly files: null; readonly problem: string };

/** The rows of a store read. */
type SightingsRead =
  | { readonly sightings: readonly DocTaskSighting[]; readonly problem: null }
  | { readonly sightings: readonly []; readonly problem: string };

/** A git read that failed, named by what it ran and what git said. */
function gitProblem(action: string, result: GitResult): string {
  const said = gitSaid(result);
  return said === ''
    ? `could not ${action}`
    : `could not ${action}: ${said}`;
}

/** Every path `git diff` changed between where the branch left `baseRef` and `HEAD`. */
function readTouchedFiles(git: GitRunner, baseRef: string): TouchedRead {
  const shared = git(['merge-base', baseRef, 'HEAD']);
  const mergeBase = shared.stdout.trim();
  if (!shared.ok || mergeBase === '') {
    return { files: null, problem: gitProblem(`read where HEAD left ${baseRef}`, shared) };
  }
  const diff = git(['diff', '--name-only', '-z', '--no-renames', mergeBase, 'HEAD']);
  if (!diff.ok) {
    return { files: null, problem: gitProblem(`list the files changed since ${mergeBase}`, diff) };
  }
  return { files: diff.stdout.split('\0').filter((path) => path !== ''), problem: null };
}

/** The plan's `sighting` rows, each place and text once, or why they could not be read. */
function readSightings(
  read: (repoRoot: string, planStub: string) => readonly StaleDocRow[],
  repoRoot: string,
  planStub: string,
): SightingsRead {
  let rows: readonly StaleDocRow[];
  try {
    rows = read(repoRoot, planStub);
  } catch (error) {
    return { sightings: [], problem: `could not read the plan's stale_docs rows: ${messageOf(error)}` };
  }
  const seen = new Set<string>();
  const sightings: DocTaskSighting[] = [];
  for (const row of rows) {
    const key = JSON.stringify([row.where, row.what]);
    if (row.kind !== 'sighting' || seen.has(key)) continue;
    seen.add(key);
    sightings.push({ where: row.where, what: row.what });
  }
  return { sightings, problem: null };
}

/**
 * Reads what the doc task of `planStub` is handed: the plan's
 * `sighting` rows and the files changed since `HEAD` left `baseRef`.
 * Never throws: a read that fails is answered as its problem. See the
 * module note.
 */
export function readDocTaskInput(options: DocTaskInputOptions): DocTaskInput {
  const git = options.git ?? createGitRunner(options.repoRoot);
  const read = options.readRows ?? readStaleDocsForPlan;
  const rows = readSightings(read, options.repoRoot, options.planStub);
  const touched = readTouchedFiles(git, options.baseRef);
  return {
    baseRef: options.baseRef,
    sightings: rows.sightings,
    sightingsProblem: rows.problem,
    touchedFiles: touched.files,
    filesProblem: touched.problem,
  };
}

/** `text` with each whitespace run, line breaks included, made one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The list line of one row. */
function sightingLine(sighting: DocTaskSighting): string {
  const where = sighting.where === null
    ? ''
    : oneLine(sighting.where);
  return where === ''
    ? `- ${oneLine(sighting.what)}`
    : `- ${where}: ${oneLine(sighting.what)}`;
}

/** The rows' lines: a lead and the list, the no-rows line, or the problem. */
function sightingLines(input: DocTaskInput): readonly string[] {
  if (input.sightingsProblem !== null) {
    return [`The stale lines this plan's sessions reported could not be read (${oneLine(input.sightingsProblem)}): repair from the touched files.`];
  }
  if (input.sightings.length === 0) return [NO_SIGHTINGS_LINE];
  return [
    'Sessions of this plan reported these documentation lines as stale:',
    ...input.sightings.map(sightingLine),
  ];
}

/** The files' lines: a lead and the capped list, or the problem. */
function fileLines(input: DocTaskInput): readonly string[] {
  const base = oneLine(input.baseRef);
  if (input.touchedFiles === null) {
    const problem = oneLine(input.filesProblem ?? 'git answered no files');
    return [`The files this plan's commits touched could not be read (${problem}): run \`git diff --name-only\` against \`${base}\` yourself.`];
  }
  if (input.touchedFiles.length === 0) {
    return [`The plan's commits touched no file since it left \`${base}\`.`];
  }
  const listed = input.touchedFiles.slice(0, DOC_TASK_FILE_CAP).map((path) => `- \`${oneLine(path)}\``);
  const rest = input.touchedFiles.length - listed.length;
  const more = rest > 0
    ? [`- ...and ${rest} more.`]
    : [];
  return [`The plan's commits touched these files since it left \`${base}\`:`, ...listed, ...more];
}

/**
 * The doc task's prompt section for `input`, redacted of the local paths
 * under `repoRoot` and `home` (the run's home directory unless named).
 * See the module note for its lines.
 */
export function renderDocTaskSection(input: DocTaskInput, repoRoot: string, home: string = homedir()): string {
  const redact = localPathRedactor(repoRoot, home);
  const lines = [DOC_TASK_HEADING, DOC_TASK_SENTENCE, ...sightingLines(input), ...fileLines(input)];
  return redact(lines.join('\n'));
}
