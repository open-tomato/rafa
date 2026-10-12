import type { FakeRun } from './runs-fake.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { createFakeRunsGh } from './runs-fake.js';
import { readNewestRun, RUN_LIST_FIELDS, runListArgs } from './runs.js';

const SHA_RED = 'b1748d99413b773649728a00fab7dcdbee52c0b5';
const SHA_GREEN = '18b373104cf0c4c430c1b8c6d5fa1aec4676318a';

/**
 * `gh run list --repo open-tomato/rafa --branch stretch/4 --workflow verify
 * --limit 1 --json databaseId,workflowName,status,conclusion,headSha`, as
 * `gh` 2.102.0 wrote it on 2026-10-07.
 */
const RECORDED_COMPLETED = `[{"conclusion":"failure","databaseId":37565187144,"headSha":"${SHA_RED}","status":"completed","workflowName":"verify"}]\n`;

/** A running run on `cli/cli`, the same day: an empty conclusion. */
const RECORDED_RUNNING = '[{"conclusion":"","databaseId":37584752754,"headSha":"17142e08db2e300b37e6da1ddcfb651eb6d9c587","status":"in_progress","workflowName":"Dependabot PR Triage (skills-driven)"}]\n';

const SHA_BEHIND = '7ade9b90745ab5674709720215c94587fd0a98fb';
const SHA_AHEAD = 'fb9abe9cf62d3f39356ed4b29bee25bbdd3724b4';
const SHA_NO_RUN = '0123456789abcdef0123456789abcdef01234567';

/**
 * `gh run list --repo open-tomato/rafa --branch stretch/5 --commit
 * 7ade9b90745ab5674709720215c94587fd0a98fb --limit 1 --json
 * databaseId,workflowName,status,conclusion,headSha`, as `gh` 2.102.0
 * wrote it on 2026-10-12, while the branch's newest run was of
 * `fb9abe9c`.
 */
const RECORDED_BY_COMMIT = `[{"conclusion":"success","databaseId":38253956537,"headSha":"${SHA_BEHIND}","status":"completed","workflowName":"verify"}]\n`;

/** The same command with `--commit fb9abe9c...`, `--workflow verify` and no `--limit`: two runs of one commit. */
const RECORDED_TWO_OF_A_COMMIT = `[{"conclusion":"success","databaseId":38269528759,"headSha":"${SHA_AHEAD}","status":"completed","workflowName":"verify"},{"conclusion":"success","databaseId":38267238905,"headSha":"${SHA_AHEAD}","status":"completed","workflowName":"verify"}]\n`;

/** A runner answering `result` to anything, recording what it was handed. */
function answering(result: GhResult): { gh: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    gh: (args) => {
      calls.push(args);
      return Promise.resolve(result);
    },
  };
}

function ok(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

function run(overrides: Partial<FakeRun>): FakeRun {
  return {
    databaseId: 1,
    workflowName: 'verify',
    headBranch: 'stretch/4',
    headSha: SHA_GREEN,
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-10-06T15:58:34Z',
    ...overrides,
  };
}

describe('runListArgs', () => {
  it('reads one run of a branch, with the fields the reader takes', () => {
    expect(runListArgs({ branch: 'stretch/4' })).toEqual([
      'run', 'list', '--branch', 'stretch/4', '--limit', '1', '--json', 'databaseId,workflowName,status,conclusion,headSha',
    ]);
  });

  it('names the workflow when one is given', () => {
    expect(runListArgs({ branch: 'main', workflow: 'verify' })).toEqual([
      'run', 'list', '--branch', 'main', '--workflow', 'verify', '--limit', '1', '--json', RUN_LIST_FIELDS.join(','),
    ]);
  });

  it.each([
    [{ branch: '' }, 'branch ""'],
    [{ branch: '  ' }, 'branch "  "'],
    [{ branch: 'main', workflow: '' }, 'workflow ""'],
  ])('refuses an empty value: %p', (query, named) => {
    expect(() => runListArgs(query)).toThrow(`ci runs: refused a ${named}, expected a non-empty string`);
  });

  it('names the commit after the branch, keeping --limit 1', () => {
    expect(runListArgs({ branch: 'stretch/5', commit: SHA_BEHIND })).toEqual([
      'run', 'list', '--branch', 'stretch/5', '--commit', SHA_BEHIND, '--limit', '1', '--json', RUN_LIST_FIELDS.join(','),
    ]);
  });

  it('keeps the workflow after the commit when both are named', () => {
    expect(runListArgs({ branch: 'stretch/5', commit: SHA_BEHIND, workflow: 'verify' })).toEqual([
      'run', 'list', '--branch', 'stretch/5', '--commit', SHA_BEHIND, '--workflow', 'verify', '--limit', '1', '--json', RUN_LIST_FIELDS.join(','),
    ]);
  });

  it('builds for a query with no commit what it built before the commit was added', () => {
    expect(runListArgs({ branch: 'stretch/5' }).includes('--commit')).toBe(false);
    expect(runListArgs({ branch: 'stretch/5', workflow: 'verify' }).includes('--commit')).toBe(false);
  });

  it.each([
    ['an empty value', ''],
    ['an abbreviated sha', '7ade9b9'],
    ['39 characters', SHA_BEHIND.slice(1)],
    ['41 characters', `${SHA_BEHIND}0`],
    ['40 characters that are not hex', 'g'.repeat(40)],
    ['the sha in upper case', SHA_BEHIND.toUpperCase()],
    ['a sha with a space after it', `${SHA_BEHIND} `],
    ['a placeholder', '<merge-commit>'],
  ])('refuses a commit that is not a 40-character sha: %s', (_name, commit) => {
    expect(() => runListArgs({ branch: 'stretch/5', commit })).toThrow(
      `ci runs: refused a commit ${JSON.stringify(commit)}, expected a 40-character sha`,
    );
  });

  it('refuses the branch before the commit, and takes the same query once the commit is whole (the control)', () => {
    expect(() => runListArgs({ branch: '', commit: '7ade9b9' })).toThrow('ci runs: refused a branch ""');
    expect(() => runListArgs({ branch: 'stretch/5', commit: SHA_BEHIND })).not.toThrow();
  });
});

describe('readNewestRun over recorded output', () => {
  it('reads a finished run: id, workflow, state, conclusion and commit', async () => {
    const { gh, calls } = answering(ok(RECORDED_COMPLETED));
    expect(await readNewestRun(gh, { branch: 'stretch/4', workflow: 'verify' })).toEqual({
      id: 37565187144,
      workflow: 'verify',
      state: 'completed',
      conclusion: 'failure',
      commit: SHA_RED,
    });
    expect(calls).toEqual([runListArgs({ branch: 'stretch/4', workflow: 'verify' })]);
  });

  it('reads a running run\'s empty conclusion as null', async () => {
    const { gh } = answering(ok(RECORDED_RUNNING));
    expect(await readNewestRun(gh, { branch: 'trunk' })).toMatchObject({ state: 'in_progress', conclusion: null });
  });

  it('answers null for a branch with no run', async () => {
    const { gh } = answering(ok('[]\n'));
    expect(await readNewestRun(gh, { branch: 'no-such-branch' })).toBeNull();
  });

  it('throws on a failed command, naming it and quoting what gh wrote', async () => {
    const { gh } = answering({ ok: false, stdout: '', stderr: 'could not find any workflows named nope\n' });
    await expect(readNewestRun(gh, { branch: 'main', workflow: 'nope' })).rejects.toThrow(
      'ci runs: gh run list --branch main --workflow nope --limit 1 --json databaseId,workflowName,status,conclusion,headSha failed: could not find any workflows named nope',
    );
  });

  it('throws on a failure that wrote nothing', async () => {
    const { gh } = answering({ ok: false, stdout: '', stderr: '' });
    await expect(readNewestRun(gh, { branch: 'main' })).rejects.toThrow('it exited non-zero and wrote nothing');
  });
});

describe('readNewestRun refuses what is not a run list', () => {
  const ROW = { conclusion: 'success', databaseId: 7, headSha: SHA_GREEN, status: 'completed', workflowName: 'verify' };

  it.each([
    ['not JSON', 'nope', 'wrote output that is not JSON'],
    ['a mapping', '{}', 'answered a mapping, expected a list'],
    ['a scalar row', '[3]', 'answered a row 3, expected an object'],
    ['a missing id', JSON.stringify([{ ...ROW, databaseId: undefined }]), 'databaseId undefined, expected a positive integer'],
    ['a string id', JSON.stringify([{ ...ROW, databaseId: '7' }]), 'databaseId "7", expected a positive integer'],
    ['an unknown status', JSON.stringify([{ ...ROW, status: 'done' }]), 'status "done", expected one of: queued, in_progress, completed'],
    ['a null conclusion', JSON.stringify([{ ...ROW, conclusion: null }]), 'conclusion null, expected a string'],
    ['a missing workflow', JSON.stringify([{ ...ROW, workflowName: undefined }]), 'workflowName undefined, expected a string'],
    ['a short sha', JSON.stringify([{ ...ROW, headSha: 'b1748d9' }]), 'headSha "b1748d9", expected a 40-character sha'],
  ])('%s', async (_name, stdout, message) => {
    const { gh } = answering(ok(stdout));
    await expect(readNewestRun(gh, { branch: 'main' })).rejects.toThrow(message);
  });

  it('reads the same row once it is well formed (the control for the refusals)', async () => {
    const { gh } = answering(ok(JSON.stringify([ROW])));
    expect(await readNewestRun(gh, { branch: 'main' })).toEqual({
      id: 7, workflow: 'verify', state: 'completed', conclusion: 'success', commit: SHA_GREEN,
    });
  });
});

describe('readNewestRun through the recorded fake', () => {
  const RUNS: readonly FakeRun[] = [
    run({ databaseId: 37475959369, createdAt: '2026-10-06T14:04:45Z' }),
    run({ databaseId: 37565187144, headSha: SHA_RED, conclusion: 'failure', createdAt: '2026-10-07T03:06:22Z' }),
    run({ databaseId: 37491979473, createdAt: '2026-10-06T15:58:34Z' }),
    run({ databaseId: 900, workflowName: 'lint', createdAt: '2026-10-07T05:00:00Z', status: 'queued', conclusion: '' }),
    run({ databaseId: 901, headBranch: 'main', createdAt: '2026-10-07T09:00:00Z' }),
  ];

  it('answers the bytes gh wrote for the same run', async () => {
    const fake = createFakeRunsGh(RUNS);
    const result = await fake.gh(runListArgs({ branch: 'stretch/4', workflow: 'verify' }));
    expect(result).toEqual(ok(RECORDED_COMPLETED));
  });

  it('returns the newest run of the named workflow on the branch', async () => {
    const fake = createFakeRunsGh(RUNS);
    expect(await readNewestRun(fake.gh, { branch: 'stretch/4', workflow: 'verify' })).toMatchObject({
      id: 37565187144,
      conclusion: 'failure',
      commit: SHA_RED,
    });
  });

  it('returns the newest run of any workflow when none is named', async () => {
    const fake = createFakeRunsGh(RUNS);
    expect(await readNewestRun(fake.gh, { branch: 'stretch/4' })).toEqual({
      id: 900, workflow: 'lint', state: 'queued', conclusion: null, commit: SHA_GREEN,
    });
  });

  it('answers null for a branch with no run, of a workflow with none there', async () => {
    const fake = createFakeRunsGh(RUNS, ['deploy']);
    expect(await readNewestRun(fake.gh, { branch: 'stretch/9' })).toBeNull();
    expect(await readNewestRun(fake.gh, { branch: 'stretch/4', workflow: 'deploy' })).toBeNull();
  });

  it('throws on a workflow the repository does not have', async () => {
    const fake = createFakeRunsGh(RUNS);
    await expect(readNewestRun(fake.gh, { branch: 'stretch/4', workflow: 'nope' })).rejects.toThrow(
      'could not find any workflows named nope',
    );
  });

  it('records the one command it was sent', async () => {
    const fake = createFakeRunsGh(RUNS);
    await readNewestRun(fake.gh, { branch: 'main' });
    expect(fake.calls()).toEqual([runListArgs({ branch: 'main' })]);
  });
});

describe('readNewestRun by commit, where a newer run on the branch is listed first', () => {
  /** `stretch/5` of `open-tomato/rafa` as the recording read it: two runs of `fb9abe9c` above one of `7ade9b90`. */
  const RUNS: readonly FakeRun[] = [
    run({ databaseId: 38253956537, headBranch: 'stretch/5', headSha: SHA_BEHIND, createdAt: '2026-10-12T13:11:28Z' }),
    run({ databaseId: 38253997303, headBranch: 'stretch/101', headSha: SHA_BEHIND, createdAt: '2026-10-12T13:11:50Z' }),
    run({ databaseId: 38267238905, headBranch: 'stretch/5', headSha: SHA_AHEAD, createdAt: '2026-10-12T15:01:56Z' }),
    run({ databaseId: 38269528759, headBranch: 'stretch/5', headSha: SHA_AHEAD, createdAt: '2026-10-12T15:20:36Z' }),
    run({ databaseId: 902, workflowName: 'lint', headBranch: 'stretch/5', headSha: SHA_BEHIND, createdAt: '2026-10-12T13:30:00Z', conclusion: 'failure' }),
  ];

  it('reads the named commit\'s run of a workflow, not the branch\'s newest', async () => {
    const fake = createFakeRunsGh(RUNS);
    expect(await readNewestRun(fake.gh, { branch: 'stretch/5', commit: SHA_BEHIND, workflow: 'verify' })).toEqual({
      id: 38253956537, workflow: 'verify', state: 'completed', conclusion: 'success', commit: SHA_BEHIND,
    });
    expect(fake.calls()).toEqual([[
      'run', 'list', '--branch', 'stretch/5', '--commit', SHA_BEHIND, '--workflow', 'verify', '--limit', '1', '--json', RUN_LIST_FIELDS.join(','),
    ]]);
  });

  it('reads the branch\'s newest run, of the other commit, for the same query with no commit (the control)', async () => {
    const fake = createFakeRunsGh(RUNS);
    expect(await readNewestRun(fake.gh, { branch: 'stretch/5', workflow: 'verify' })).toMatchObject({
      id: 38269528759,
      commit: SHA_AHEAD,
    });
  });

  it('reads the newest run of the commit, of any workflow, when none is named', async () => {
    const fake = createFakeRunsGh(RUNS);
    expect(await readNewestRun(fake.gh, { branch: 'stretch/5', commit: SHA_BEHIND })).toMatchObject({
      id: 902,
      workflow: 'lint',
      conclusion: 'failure',
      commit: SHA_BEHIND,
    });
    expect(await readNewestRun(fake.gh, { branch: 'stretch/5', commit: SHA_AHEAD })).toMatchObject({ id: 38269528759 });
  });

  it('answers null for a commit with no run on the branch, although the branch has runs', async () => {
    const fake = createFakeRunsGh(RUNS);
    expect(await readNewestRun(fake.gh, { branch: 'stretch/5', commit: SHA_NO_RUN })).toBeNull();
    expect(await readNewestRun(fake.gh, { branch: 'stretch/4', commit: SHA_BEHIND })).toBeNull();
  });

  it('reads the bytes gh wrote for the command it sends', async () => {
    const { gh, calls } = answering(ok(RECORDED_BY_COMMIT));
    expect(await readNewestRun(gh, { branch: 'stretch/5', commit: SHA_BEHIND })).toMatchObject({ id: 38253956537, commit: SHA_BEHIND });
    expect(calls).toEqual([runListArgs({ branch: 'stretch/5', commit: SHA_BEHIND })]);
  });

  it('sends nothing for a commit that is not a 40-character sha', async () => {
    const fake = createFakeRunsGh(RUNS);
    await expect(readNewestRun(fake.gh, { branch: 'stretch/5', commit: '7ade9b9' })).rejects.toThrow(
      'ci runs: refused a commit "7ade9b9", expected a 40-character sha',
    );
    expect(fake.calls()).toEqual([]);
  });
});

describe('the fake filters by --commit as gh was recorded', () => {
  const FIELDS = RUN_LIST_FIELDS.join(',');
  /** The runs of `open-tomato/rafa` the recording read, on 2026-10-12. */
  const RUNS: readonly FakeRun[] = [
    run({ databaseId: 38253956537, headBranch: 'stretch/5', headSha: SHA_BEHIND, createdAt: '2026-10-12T13:11:28Z' }),
    run({ databaseId: 38253997303, headBranch: 'stretch/101', headSha: SHA_BEHIND, createdAt: '2026-10-12T13:11:50Z' }),
    run({ databaseId: 38267238905, headBranch: 'stretch/5', headSha: SHA_AHEAD, createdAt: '2026-10-12T15:01:56Z' }),
    run({ databaseId: 38269528759, headBranch: 'stretch/5', headSha: SHA_AHEAD, createdAt: '2026-10-12T15:20:36Z' }),
  ];

  function list(...flags: string[]): Promise<GhResult> {
    return createFakeRunsGh(RUNS).gh(['run', 'list', ...flags, '--json', FIELDS]);
  }

  it.each([
    ['beside its branch', ['--branch', 'stretch/5', '--commit', SHA_NO_RUN, '--limit', '1']],
    ['beside its branch and a workflow', ['--branch', 'stretch/5', '--commit', SHA_NO_RUN, '--workflow', 'verify', '--limit', '1']],
    ['alone', ['--commit', SHA_NO_RUN]],
  ])('answers [] and exit 0 for a commit with no run, %s', async (_name, flags) => {
    expect(await list(...flags)).toEqual(ok('[]\n'));
  });

  it('answers the run of a commit that sits behind a newer run of the same branch, in the bytes gh wrote', async () => {
    expect(await list('--branch', 'stretch/5', '--commit', SHA_BEHIND, '--limit', '1')).toEqual(ok(RECORDED_BY_COMMIT));
  });

  it('answers the newer commit\'s run to the same command with no --commit (the control for the filter)', async () => {
    const rows = JSON.parse((await list('--branch', 'stretch/5', '--limit', '1')).stdout) as unknown;
    expect(rows).toEqual([expect.objectContaining({ databaseId: 38269528759, headSha: SHA_AHEAD })]);
  });

  it('answers every run of the commit on the branch, newest first, when no --limit cuts them', async () => {
    expect(await list('--branch', 'stretch/5', '--commit', SHA_AHEAD, '--workflow', 'verify')).toEqual(ok(RECORDED_TWO_OF_A_COMMIT));
    expect(await list('--branch', 'stretch/5', '--commit', SHA_BEHIND)).toEqual(ok(RECORDED_BY_COMMIT));
  });

  it('keeps --branch as a filter beside --commit: another branch\'s run of the commit is left out', async () => {
    expect(await list('--branch', 'stretch/4', '--commit', SHA_BEHIND)).toEqual(ok('[]\n'));
    const rows = JSON.parse((await list('--commit', SHA_BEHIND)).stdout) as unknown;
    expect(rows).toEqual([
      expect.objectContaining({ databaseId: 38253997303 }),
      expect.objectContaining({ databaseId: 38253956537 }),
    ]);
  });

  it.each([
    ['an abbreviated sha', '7ade9b9', '[]\n'],
    ['a value that is no sha', 'nothex', '[]\n'],
    ['the full sha in upper case', SHA_BEHIND.toUpperCase(), RECORDED_BY_COMMIT],
  ])('answers %s as gh did', async (_name, commit, stdout) => {
    expect(await list('--branch', 'stretch/5', '--commit', commit, '--limit', '1')).toEqual(ok(stdout));
  });

  it('still fails on a workflow the repository does not have, as gh did beside --commit', async () => {
    const result = await list('--branch', 'stretch/5', '--commit', SHA_BEHIND, '--workflow', 'nope', '--limit', '1');
    expect(result).toEqual({ ok: false, stdout: '', stderr: 'could not find any workflows named nope\n' });
  });
});

describe('the fake is strict', () => {
  const fake = createFakeRunsGh([run({})]);

  it.each([
    [['run', 'view', '1'], 'fake gh: command not modelled: run view 1'],
    [['run', 'list', '--status', 'completed', '--json', 'status'], 'fake gh: flag not modelled: --status'],
    [['run', 'list', '--branch'], 'fake gh: flag --branch has no value'],
    [['run', 'list', '--json', 'status', '--commit'], 'fake gh: flag --commit has no value'],
    [['run', 'list', '--commit', '', '--json', 'status'], 'fake gh: --commit "" is empty, which gh reads as no filter'],
    [['run', 'list', '--json', 'status', '--json', 'status'], 'fake gh: flag --json given twice'],
    [['run', 'list', '--branch', 'main'], 'fake gh: run list is modelled with --json only'],
    [['run', 'list', '--limit', '0', '--json', 'status'], 'fake gh: --limit 0 is not a positive integer'],
    [['run', 'list', '--json', 'bogus'], 'Unknown JSON field: "bogus"'],
  ])('refuses %p', async (args, message) => {
    const result = await fake.gh(args);
    expect(result.ok).toBe(false);
    expect(result.stderr).toStartWith(message);
  });

  it('answers a modelled command (the control for the refusals)', async () => {
    expect((await fake.gh(['run', 'list', '--json', 'status'])).stdout).toBe('[{"status":"completed"}]\n');
  });
});
