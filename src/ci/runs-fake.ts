/**
 * A strict recorded fake of `gh run list`, the one command `./runs.ts`
 * sends: an in-memory list of workflow runs behind a {@link GhRunner},
 * recording every command it is handed.
 *
 * The discipline `packages/rafa-pr/src/pr/gh-fake.ts` holds for pull requests, kept apart
 * from it so that file does not grow. This module is a test helper that
 * is not itself a test file: bun runs nothing in it until a `*.test.ts`
 * calls it.
 *
 * ## Recorded
 *
 * What it answers was read off `gh` 2.102.0 on 2026-10-07 (the readings
 * `./runs.ts` lists): rows newest first, keys sorted by code unit, a
 * trailing newline, `[]` and exit 0 for a branch with no run, an empty
 * conclusion while a run is not finished, and for a `--workflow` naming
 * no workflow, exit 1 with `could not find any workflows named <name>`
 * on stderr. A `--json` field `gh` does not know exits 1 with
 * `Unknown JSON field: "<name>"` followed by the list of fields.
 *
 * `--commit` was read off `gh` 2.102.0 on 2026-10-12 against
 * `open-tomato/rafa`, read-only, with `--repo`, on `stretch/5` while its
 * newest runs were of `fb9abe9c` and an older one of `7ade9b90`:
 *
 *   - `gh` takes `--commit` beside `--branch`, and both filter. With
 *     `--branch stretch/5 --commit 7ade9b90... --limit 1` it answered
 *     that commit's run, not the branch's newest. With `--branch
 *     stretch/4` and the same commit it answered `[]`; with no
 *     `--branch`, that run and one of the same commit on `stretch/101`.
 *   - A full sha with no run answers `[]` and exit 0, beside `--branch`,
 *     beside `--branch` and `--workflow`, and alone.
 *   - A sha that is not 40 characters matches nothing: the abbreviated
 *     `7ade9b9` answered `[]` and exit 0, as did `nothex`. The match is
 *     on the whole sha, in either case: the 40 characters in upper case
 *     answered the run, its `headSha` in lower case.
 *   - `--workflow` beside `--commit` filters as it does without it, and
 *     a workflow the repository does not have still exits 1 with `could
 *     not find any workflows named <name>`.
 *   - Without `--limit`, every run of the commit on the branch comes
 *     back, newest first: two for `fb9abe9c` (a `push` and a
 *     `pull_request` run of `verify`), one for `7ade9b90`. So `--limit 1`
 *     beside `--commit` answers the newest run of that commit.
 *   - An empty `--commit ""` is no filter: `gh` answered the branch's
 *     newest run. `--commit` as the last argument exits 1 with `flag
 *     needs an argument: --commit` and the usage text.
 *
 * ## Strict
 *
 * Only `run list` with `--branch`, `--commit`, `--workflow`, `--limit`
 * and `--json` is modelled. Any other command, flag, or a flag with no
 * value is refused with `ok` false and a message opening `fake gh:`,
 * rather than ignored, so a reader sending a flag nobody checked fails
 * its case. An empty `--commit` is refused the same way, although `gh`
 * takes it: there it silently reads the branch's newest run, which is
 * the answer a reader asking by commit must never get.
 */
import type { RunState } from './runs.js';
import type { GhResult, GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';

/** The fields `gh run list --json` accepts, as its refusal lists them. */
export const RUN_LIST_JSON_FIELDS = [
  'attempt',
  'conclusion',
  'createdAt',
  'databaseId',
  'displayTitle',
  'event',
  'headBranch',
  'headSha',
  'name',
  'number',
  'startedAt',
  'status',
  'updatedAt',
  'url',
  'workflowDatabaseId',
  'workflowName',
] as const;

/** A run planted in the fake: the fields the reader asks for, and where and when it ran. */
export interface FakeRun {
  readonly databaseId: number;
  readonly workflowName: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly status: RunState;
  /** The empty string while the run is not finished, as `gh` writes it. */
  readonly conclusion: string;
  /** An ISO time; the fake answers runs newest first by it. */
  readonly createdAt: string;
}

/** The fake: a {@link GhRunner} and what it was handed. */
export interface FakeRunsGh {
  readonly gh: GhRunner;
  /** Every command handed over, refused ones included, in order. */
  readonly calls: () => readonly (readonly string[])[];
}

/** The flags `run list` is modelled with, each taking one value. */
const FLAGS = new Set(['--branch', '--commit', '--workflow', '--limit', '--json']);

/**
 * A fake holding `runs`, and every workflow named by one of them plus
 * `workflows`, so a case can plant a workflow that has not run yet.
 */
export function createFakeRunsGh(runs: readonly FakeRun[], workflows: readonly string[] = []): FakeRunsGh {
  const held = runs.map((run) => Object.freeze({ ...run }));
  const known = new Set([...workflows, ...held.map((run) => run.workflowName)]);
  const calls: (readonly string[])[] = [];

  const gh: GhRunner = (args) => {
    calls.push(Object.freeze([...args]));
    return Promise.resolve(answer(args, held, known));
  };
  return { gh, calls: () => [...calls] };
}

/** What `gh` answers to `args`. */
function answer(args: readonly string[], runs: readonly FakeRun[], workflows: ReadonlySet<string>): GhResult {
  if (args[0] !== 'run' || args[1] !== 'list') return refused(`command not modelled: ${args.join(' ')}`);
  const flags = readFlags(args.slice(2));
  if (typeof flags === 'string') return refused(flags);

  const fields = (flags.get('--json') ?? '').split(',');
  const unknown = fields.find((field) => !(RUN_LIST_JSON_FIELDS as readonly string[]).includes(field));
  if (!flags.has('--json')) return refused('run list is modelled with --json only');
  if (unknown !== undefined) {
    return failed(`Unknown JSON field: "${unknown}"\nAvailable fields:\n${RUN_LIST_JSON_FIELDS.map((f) => `  ${f}`).join('\n')}\n`);
  }
  const workflow = flags.get('--workflow');
  if (workflow !== undefined && !workflows.has(workflow)) {
    return failed(`could not find any workflows named ${workflow}\n`);
  }
  const limit = Number(flags.get('--limit') ?? '20');
  if (!Number.isSafeInteger(limit) || limit < 1) return refused(`--limit ${flags.get('--limit')} is not a positive integer`);

  const commit = flags.get('--commit')?.toLowerCase();
  if (commit === '') return refused('--commit "" is empty, which gh reads as no filter');

  const branch = flags.get('--branch');
  const rows = [...runs]
    .filter((run) => (branch === undefined || run.headBranch === branch) && (workflow === undefined || run.workflowName === workflow))
    .filter((run) => commit === undefined || run.headSha.toLowerCase() === commit)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((run) => pick(run, fields));
  return { ok: true, stdout: `${JSON.stringify(rows)}\n`, stderr: '' };
}

/** The flags in `rest`, each with its value, or what refuses them. */
function readFlags(rest: readonly string[]): Map<string, string> | string {
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index] ?? '';
    const value = rest[index + 1];
    if (!FLAGS.has(flag)) return `flag not modelled: ${flag}`;
    if (value === undefined) return `flag ${flag} has no value`;
    if (flags.has(flag)) return `flag ${flag} given twice`;
    flags.set(flag, value);
  }
  return flags;
}

/** The asked fields of `run`, keys sorted by code unit as `gh` writes them. */
function pick(run: FakeRun, fields: readonly string[]): Record<string, unknown> {
  const record = run as unknown as Readonly<Record<string, unknown>>;
  return Object.fromEntries([...fields].sort().map((field) => [field, record[field] ?? null]));
}

/** A failure the fake invents, for what it does not model. */
function refused(message: string): GhResult {
  return { ok: false, stdout: '', stderr: `fake gh: ${message}\n` };
}

/** A failure as `gh` wrote it. */
function failed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}
