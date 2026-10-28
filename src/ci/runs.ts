/**
 * The branch run reader: the newest GitHub Actions run on a branch, or
 * of one commit on it, read through `gh run list --branch <b> [--commit
 * <sha>] [--workflow <w>] --limit 1 --json`.
 *
 * Its own seam, apart from the pull-request port in `packages/rafa-pr/src/pr/gh.ts`, so
 * that file (near the 800-line cap) and its fake do not grow. The seam is
 * the {@link GhRunner} declared once in `packages/rafa-board/src/adapters/tracker/github.ts`:
 * the command spawns `gh` through `createGhRunner`, and the tests hand
 * over the recorded fake in `./runs-fake.ts`, so no case reaches GitHub.
 *
 * ## Recorded
 *
 * Read off `gh` 2.102.0 on 2026-10-07 against `open-tomato/rafa` and
 * `cli/cli`, read-only, with `--repo`:
 *
 *   - Rows come newest first, so `--limit 1` answers the newest run.
 *   - A branch with no run, with or without `--workflow`, answers `[]`
 *     and exit 0. That is the reader's `null`.
 *   - A `--workflow` naming no active workflow exits 1 and writes
 *     `could not find any workflows named <name>` to stderr, nothing to
 *     stdout. The reader throws on it: a mistyped workflow is not a
 *     branch with no run.
 *   - A running run answers `status` `in_progress` and `conclusion` the
 *     empty string; the reader answers that conclusion as `null`.
 *   - Keys are sorted by code unit and the output ends with a newline.
 *
 * `--commit` was read off `gh` 2.102.0 on 2026-10-12 against
 * `open-tomato/rafa`, read-only, with `--repo`, on `stretch/5` while its
 * two newest runs were of `fb9abe9c` and an older one of `7ade9b90`:
 *
 *   - `gh` takes `--commit` beside `--branch`, and both filter, so the
 *     reader sends the two together. `--branch stretch/5 --limit 1`
 *     answered the run of `fb9abe9c`; with `--commit 7ade9b90...` added
 *     it answered the run of `7ade9b90`, the row a later push had moved
 *     out of first place.
 *   - A full sha with no run on the branch answers `[]` and exit 0, with
 *     or without `--workflow`. That is the reader's `null`, as for a
 *     branch with no run.
 *   - A sha that is not 40 characters is no error to `gh`: the
 *     abbreviated `7ade9b9` answered `[]` and exit 0, which reads as "no
 *     run yet" for a commit that has one. An empty `--commit ""` is no
 *     filter at all and answered the branch's newest run. The reader
 *     therefore refuses both before it sends anything.
 *   - The 40 characters in upper case answered the run, its `headSha` in
 *     lower case. The reader refuses that spelling all the same: the
 *     `commit` it answers is lower case, so a caller comparing the two
 *     would never see them equal.
 *   - `--workflow` beside `--commit` filters as it does without it.
 *   - Without `--limit`, every run of the commit on the branch comes
 *     back, newest first (two for `fb9abe9c`, a `push` and a
 *     `pull_request` run of `verify`). So `--limit 1` beside `--commit`
 *     answers the newest run of that commit.
 *
 * ## Strict
 *
 * A row whose fields are missing or of the wrong type, or whose `status`
 * is not one of the six run statuses GitHub documents, throws rather than
 * reading as a run. The conclusion is kept as `gh` wrote it, since the
 * set of conclusions is wider and what each one means is the caller's
 * decision.
 */
import type { GhResult, GhRunner } from '@open-tomato/rafa-board';

import { describeValue, isMapping, messageOf } from '@open-tomato/rafa/core/config/sections';

/** What this module's errors open with. */
const PREFIX = 'ci runs';

/** A full commit sha as `gh` writes `headSha`: 40 hex characters, lower case. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** The `--json` fields the reader asks for, in the order it sends them. */
export const RUN_LIST_FIELDS = ['databaseId', 'workflowName', 'status', 'conclusion', 'headSha'] as const;

/** A run's status, as `gh` writes it. Every one but `completed` is a run not yet finished. */
export const RUN_STATES = ['queued', 'in_progress', 'completed', 'requested', 'waiting', 'pending'] as const;

export type RunState = (typeof RUN_STATES)[number];

/**
 * Which runs to read: those on one branch, of one commit when it is
 * named, and of one workflow when it is named.
 */
export interface RunQuery {
  readonly branch: string;
  /**
   * The full sha, 40 hex characters in lower case, of the commit whose
   * run is read. Left out, the newest run of the branch, which a later
   * push makes another commit's.
   */
  readonly commit?: string;
  /** The workflow's name as `gh run list --workflow` takes it. Left out, any workflow. */
  readonly workflow?: string;
}

/** The newest run on a branch. */
export interface BranchRun {
  /** The run id `gh run view` takes. */
  readonly id: number;
  /** The workflow's name. */
  readonly workflow: string;
  readonly state: RunState;
  /** How the run finished (`success`, `failure`, ...), or null while it has not. */
  readonly conclusion: string | null;
  /** The full sha of the commit the run ran on. */
  readonly commit: string;
}

/**
 * The arguments after `gh` that read the newest run for `query`. Throws
 * a `TypeError` on an empty branch or workflow, and on a commit that is
 * not a 40-character sha.
 */
export function runListArgs(query: RunQuery): string[] {
  const branch = textArgument(query.branch, 'branch');
  const commit = query.commit === undefined
    ? []
    : ['--commit', shaArgument(query.commit)];
  const workflow = query.workflow === undefined
    ? []
    : ['--workflow', textArgument(query.workflow, 'workflow')];
  return ['run', 'list', '--branch', branch, ...commit, ...workflow, '--limit', '1', '--json', RUN_LIST_FIELDS.join(',')];
}

/**
 * The newest run on `query.branch`, or of `query.commit` on it when a
 * commit is named, or null when there is no such run (of that workflow,
 * when one is named). Throws when `gh` fails, naming the command and what
 * it wrote, when its answer is not a run list, and before sending
 * anything when the query is one {@link runListArgs} refuses.
 */
export async function readNewestRun(gh: GhRunner, query: RunQuery): Promise<BranchRun | null> {
  const args = runListArgs(query);
  const command = `gh ${args.join(' ')}`;
  const result = await gh(args);
  if (!result.ok) throw new Error(`${PREFIX}: ${command} failed: ${detailOf(result)}`);
  const rows = parseJson(result.stdout, command);
  if (!Array.isArray(rows)) refuse(command, `${describeValue(rows)}, expected a list`);
  const [first] = rows as unknown[];
  return first === undefined
    ? null
    : readRun(first, command);
}

/** One row of the list, as a {@link BranchRun}, or a refusal. */
function readRun(row: unknown, command: string): BranchRun {
  if (!isMapping(row)) refuse(command, `a row ${describeValue(row)}, expected an object`);
  const { databaseId, workflowName, status, conclusion, headSha } = row;
  if (typeof databaseId !== 'number' || !Number.isSafeInteger(databaseId) || databaseId <= 0) {
    refuse(command, `databaseId ${describeValue(databaseId)}, expected a positive integer`);
  }
  const workflow = readString(workflowName, 'workflowName', command);
  const state = readString(status, 'status', command);
  if (!isRunState(state)) refuse(command, `status ${describeValue(state)}, expected one of: ${RUN_STATES.join(', ')}`);
  const finished = readString(conclusion, 'conclusion', command);
  const commit = readString(headSha, 'headSha', command);
  if (!FULL_SHA.test(commit)) refuse(command, `headSha ${describeValue(commit)}, expected a 40-character sha`);
  return {
    id: databaseId,
    workflow,
    state,
    conclusion: finished === ''
      ? null
      : finished,
    commit,
  };
}

function isRunState(value: string): value is RunState {
  return (RUN_STATES as readonly string[]).includes(value);
}

/** The string in `field`, or a refusal. */
function readString(value: unknown, field: string, command: string): string {
  if (typeof value !== 'string') refuse(command, `${field} ${describeValue(value)}, expected a string`);
  return value;
}

/** A non-empty query value, or a refusal naming which one. */
function textArgument(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${PREFIX}: refused a ${name} ${describeValue(value)}, expected a non-empty string`);
  }
  return value;
}

/** A query's commit as a full sha, or a refusal quoting what was given. */
function shaArgument(value: string): string {
  if (typeof value !== 'string' || !FULL_SHA.test(value)) {
    throw new TypeError(`${PREFIX}: refused a commit ${describeValue(value)}, expected a 40-character sha`);
  }
  return value;
}

/** What `command` wrote, parsed. Refuses, naming the command, when it is not JSON. */
function parseJson(stdout: string, command: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
}

/** Refuses a payload, naming the command and what was there. */
function refuse(command: string, problem: string): never {
  throw new Error(`${PREFIX}: ${command} answered ${problem}`);
}

/** What a failed command wrote. Never empty. */
function detailOf(result: GhResult): string {
  return result.stderr.trim() || result.stdout.trim() || 'it exited non-zero and wrote nothing';
}
