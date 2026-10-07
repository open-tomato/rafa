/**
 * The after-pull-request half of `rafa stretch item` (`./item-merge.ts`),
 * driven through `rafa stretch item 812 --wait` in planted projects with
 * a plan of the issue already there, so the only rafa lines run are
 * `loop wait` and `pr merge`, both fakes. `gh` is one stand-in: `pr view`
 * answers the pull request the case plants, open until the fake merge
 * runs and merged at {@link MERGE_SHA} after it; `run list` is the
 * recorded fake of `src/ci/runs-fake.ts`, one list of runs per read so a
 * case can move the run from in progress to completed; `run view
 * --log-failed` answers the captured log of `src/ci/testdata/`; and
 * `issue view` answers each bug's filing time. The events file, the
 * session record, the ledger and `stretch.json` are real files.
 *
 * Controls: every refusal and every loop without a pull request reads
 * the ledger as absent beside a full run that finds it written, and the
 * cut-off cases list a bug filed after the cut-off beside one filed
 * before it, so the filter is seen to drop as well as keep.
 */
import type { StretchItemSeams } from './item.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { FakeRun } from '../../ci/runs-fake.js';
import type { OpenIssue } from '../../ports/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeRunsGh } from '../../ci/runs-fake.js';
import { beginSession } from '../../loop/sessions.js';
import { eventsFilePath } from '../../start/loop-events.js';
import { appendItem, itemsPath, readItems } from '../../stretch/items.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import {
  CI_POLL_MS,
  CI_READ_TRIES,
  CI_WAIT_MS,
  ghFiledAt,
  mergeDryRunLines,
  noPullRequestLine,
  PR_VIEW_FIELDS,
  prViewArgs,
  readLoopEnding,
  viewPull,
} from './item-merge.js';
import { createStretchItemCommand, itemLogPath } from './item.js';
import { stretchRecordPath } from './start.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-item-merge-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const STRETCH_SUBJECT = { name: 'stretch', summary: 'stretches' };
const STRETCH_CONFIG = 'version: 1\npr:\n  base: stretch/4\n';
const PLAN = '.rafa/plans/PLAN-rafa-812-pit-readings.md';
const STUB = 'rafa-812-pit-readings';
const SESSION_ID = 'loop-812-session';
const LOOP_PID = 4242;
const PR = 901;
const BRANCH = 'stretch/4';
const MERGE_SHA = 'c4da2c4c63b2e9d585d3a76ffbda1c49e3ce60d1';
const OLD_SHA = '0326b9da1b76e75bfdd0ed3b2002897e5bae75e4';
const START = Date.parse('2026-10-07T09:00:00.000Z');
const BODY = 'Plan for #812.\n\nCloses #812\nFixes #812\ncloses #604\n';
const THREE_CASES = await Bun.file(new URL('../../ci/testdata/three-cases.log-failed.txt', import.meta.url)).text();
const GATE_FILE = 'src/tests/task-gate-spawned.test.ts';

/** A run of `verify` on the integration branch. */
function verifyRun(fields: Partial<FakeRun> = {}): FakeRun {
  return {
    databaseId: 37190089292,
    workflowName: 'verify',
    headBranch: BRANCH,
    headSha: MERGE_SHA,
    status: 'completed',
    conclusion: 'failure',
    createdAt: '2026-10-07T09:30:00Z',
    ...fields,
  };
}

function bug(id: string, title: string): OpenIssue {
  return { ref: { opt: 0, kind: 'github', externalId: id, url: `https://example.test/issues/${id}` }, title, body: '' };
}

/** What a case changes about the fakes. */
interface CaseOptions {
  /** The events file's lines, as JSON objects; one `pr` event for {@link PR} when left out, none for null. */
  readonly events?: readonly object[] | null;
  /** The exit code `loop wait` answers; 0 when left out. */
  readonly waitExit?: number;
  /** The exit code `pr merge` answers; 0 when left out. */
  readonly mergeExit?: number;
  /** Whether the fake merge merges; true when left out. */
  readonly merges?: boolean;
  readonly base?: string;
  readonly state?: string;
  /** The runs `run list` answers on each read, the last list kept for every read past it. */
  readonly runs?: readonly (readonly FakeRun[])[];
  /** How many `run list` reads fail before the fake answers. */
  readonly failedListReads?: number;
  readonly bugs?: readonly OpenIssue[];
  /** Each bug's filing time, by number. */
  readonly filed?: Readonly<Record<string, string>>;
}

interface Case {
  readonly project: PlantedProject;
  readonly rafaCalls: string[][];
  readonly ghCalls: string[][];
  readonly sleeps: number[];
  readonly seams: StretchItemSeams;
}

function plant(options: CaseOptions = {}): Case {
  const caseDir = realpathSync(mkdtempSync(join(scope, 'case-')));
  const project = plantProject(caseDir, STRETCH_CONFIG);
  const { root } = project;
  mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
  writeFileSync(join(root, PLAN), '# Plan\n\n- [ ] a task\n');
  const events = options.events === undefined
    ? [{ name: 'pr', summary: `pr #${String(PR)} opened`, data: { number: PR }, ts: '2026-10-07T09:20:00.000Z' }]
    : options.events;
  if (events !== null) {
    mkdirSync(join(root, '.rafa', 'runs'), { recursive: true });
    writeFileSync(eventsFilePath(root, SESSION_ID), events.map((line) => `${JSON.stringify(line)}\n`).join(''));
  }

  const rafaCalls: string[][] = [];
  const ghCalls: string[][] = [];
  const sleeps: number[] = [];
  let clock = START;
  let merged = false;
  let listReads = 0;
  const runLists = options.runs ?? [[verifyRun()]];

  const gh: GhRunner = (args) => {
    ghCalls.push([...args]);
    const answer = (result: GhResult): Promise<GhResult> => Promise.resolve(result);
    if (args[0] === 'pr' && args[1] === 'view') {
      const row = {
        baseRefName: options.base ?? BRANCH,
        body: BODY,
        headRefName: 'feat/rafa-812-pit-readings',
        mergeCommit: merged
          ? { oid: MERGE_SHA }
          : null,
        number: Number(args[2]),
        state: merged
          ? 'MERGED'
          : options.state ?? 'OPEN',
      };
      return answer({ ok: true, stdout: `${JSON.stringify(row)}\n`, stderr: '' });
    }
    if (args[0] === 'run' && args[1] === 'list') {
      listReads += 1;
      if (listReads <= (options.failedListReads ?? 0)) return answer({ ok: false, stdout: '', stderr: 'HTTP 502: Bad Gateway' });
      const runs = runLists[Math.min(listReads - (options.failedListReads ?? 0), runLists.length) - 1] ?? [];
      return createFakeRunsGh(runs).gh(args);
    }
    if (args[0] === 'run' && args[1] === 'view') return answer({ ok: true, stdout: THREE_CASES, stderr: '' });
    if (args[0] === 'issue' && args[1] === 'view') {
      const at = options.filed?.[args[2] ?? ''];
      return answer(at === undefined
        ? { ok: false, stdout: '', stderr: 'GraphQL: Could not resolve to an issue' }
        : { ok: true, stdout: `${JSON.stringify({ createdAt: at })}\n`, stderr: '' });
    }
    return answer({ ok: false, stdout: '', stderr: `fake gh: not modelled: ${args.join(' ')}` });
  };

  const seams: StretchItemSeams = {
    runRafa: async (argv) => {
      rafaCalls.push([...argv]);
      if (argv[1] === 'pr') {
        if (options.merges ?? true) merged = true;
        return Promise.resolve(options.mergeExit ?? 0);
      }
      return Promise.resolve(options.waitExit ?? 0);
    },
    launch: () => {
      beginSession(root, {
        sessionId: SESSION_ID,
        planStub: STUB,
        plan: PLAN,
        branch: 'feat/rafa-812-pit-readings',
        pid: LOOP_PID,
        startedAt: new Date(clock).toISOString(),
      }, { isAlive: (pid) => pid === LOOP_PID });
      return { pid: LOOP_PID, exitCode: () => null };
    },
    isAlive: (pid) => pid === LOOP_PID,
    gh: () => gh,
    tracker: () => ({ openIssues: async () => Promise.resolve([...(options.bugs ?? [])]) }),
    filedAt: ghFiledAt,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => new Date(clock),
    rafa: ['rafa'],
  };
  return { project, rafaCalls, ghCalls, sleeps, seams };
}

async function run(planted: Case, words: readonly string[] = ['812', '--wait']): Promise<CapturedRun> {
  const command = createStretchItemCommand(planted.seams);
  return dispatchInProject(['stretch', 'item', ...words], [STRETCH_SUBJECT], [command], planted.project, { PATH: '/fake/bin' });
}

/** The index of each line in `stdout`, which must hold every one, rising. */
function expectInOrder(stdout: string, lines: readonly string[]): void {
  const at = lines.map((line) => {
    const index = stdout.indexOf(line);
    expect(index, `stdout holds ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0);
    return index;
  });
  expect(at.every((value, index) => index === 0 || value > (at[index - 1] ?? -1))).toBe(true);
}

const WAIT_LINE = ['rafa', 'loop', 'wait', `--session-id=${SESSION_ID}`];
const MERGE_LINE = ['rafa', 'pr', 'merge', String(PR), '--skip-checks', '--yes'];

describe('rafa stretch item --wait, a loop that opened a pull request', () => {
  it('merges it with checks skipped, waits for the run on the merge commit, appends the ledger and prints the readings', async () => {
    const planted = plant({
      runs: [
        [verifyRun({ headSha: OLD_SHA, createdAt: '2026-10-07T08:00:00Z' })],
        [verifyRun({ status: 'in_progress', conclusion: '' })],
        [verifyRun()],
      ],
      bugs: [bug('870', 'filed during the item'), bug('700', 'filed long ago')],
      filed: { 870: '2026-10-07T09:10:00Z', 700: '2026-09-01T00:00:00Z' },
    });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls).toEqual([WAIT_LINE, MERGE_LINE]);
    expect(planted.ghCalls[0]).toEqual(prViewArgs(PR));
    expect(planted.ghCalls.filter((args) => args[1] === 'list')).toHaveLength(4);
    expect(planted.sleeps).toEqual([CI_POLL_MS, CI_POLL_MS]);
    const { items, malformed } = readItems(planted.project.root, 4);
    expect(malformed).toEqual([]);
    expect(items).toEqual([{
      issue: '812',
      plan: STUB,
      pullRequest: PR,
      mergeCommit: MERGE_SHA,
      closes: ['Closes #812', 'Closes #604'],
      at: new Date(START + 2 * CI_POLL_MS).toISOString(),
    }]);
    expectInOrder(outcome.stdout, [
      `rafa loop wait --session-id=${SESSION_ID}`,
      `rafa pr merge ${String(PR)} --skip-checks --yes`,
      `merged #${String(PR)} into ${BRANCH} at c4da2c4`,
      `waiting for the run on ${BRANCH} at c4da2c4 to end`,
      `run 37190089292 (verify) on ${BRANCH} at c4da2c4 ended: failure`,
      `ledger: #812 appended to ${itemsPath(planted.project.root, 4)}, Closes #812, Closes #604`,
      `CI: ❌ ${BRANCH}: verify run 37190089292`,
      `   ${GATE_FILE}`,
      'Bugs: 2 open.',
      `Filed since ${new Date(START).toISOString()}: 1.`,
      '   #870 filed during the item',
    ]);
    expect(outcome.stdout).not.toContain('#700 filed long ago');
  });

  it('counts new bugs from the last ledger line written before this one, not from its own', async () => {
    const planted = plant({
      bugs: [bug('871', 'after the last item'), bug('869', 'before the last item')],
      filed: { 871: '2026-10-07T09:05:00Z', 869: '2026-10-07T07:00:00Z' },
    });
    appendItem(planted.project.root, 4, {
      issue: '604',
      plan: 'rafa-604-config-set',
      pullRequest: 880,
      mergeCommit: OLD_SHA,
      closes: ['Closes #604'],
      at: '2026-10-07T08:00:00.000Z',
    });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(readItems(planted.project.root, 4).items.map((item) => item.pullRequest)).toEqual([880, PR]);
    expect(outcome.stdout).toContain('Filed since 2026-10-07T08:00:00.000Z: 1.');
    expect(outcome.stdout).toContain('#871 after the last item');
    expect(outcome.stdout).not.toContain('#869');
  });

  it('counts new bugs from stretch.json\'s start when the ledger is empty', async () => {
    const planted = plant({ bugs: [bug('872', 'during the stretch')], filed: { 872: '2026-10-07T06:00:00Z' } });
    mkdirSync(join(planted.project.root, '.rafa', 'stretch', '4'), { recursive: true });
    writeFileSync(stretchRecordPath(planted.project.root, 4), JSON.stringify({ startedAt: '2026-10-07T05:00:00.000Z' }));

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Filed since 2026-10-07T05:00:00.000Z: 1.');
  });

  it('gives up on a run that never comes after the wait\'s bound, and still writes the ledger line', async () => {
    const planted = plant({ runs: [[verifyRun({ headSha: OLD_SHA })]] });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.sleeps).toHaveLength(CI_WAIT_MS / CI_POLL_MS);
    expect(outcome.stdout).toContain(`warn: no run on ${BRANCH} at c4da2c4 ended within ${String(CI_WAIT_MS / 60_000)} minutes`);
    expect(readItems(planted.project.root, 4).items).toHaveLength(1);
  });

  it('gives up after failed reads in a row, still writes the ledger, and prints the CI reading as not read', async () => {
    const planted = plant({ failedListReads: CI_READ_TRIES + 1 });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.sleeps).toHaveLength(CI_READ_TRIES - 1);
    expect(outcome.stdout).toContain(`warn: stopped waiting for the run on ${BRANCH} at c4da2c4: ${String(CI_READ_TRIES)} reads failed in a row, the last: ci runs: gh run list`);
    expect(readItems(planted.project.root, 4).items).toHaveLength(1);
    expect(outcome.stdout).toContain('CI: not read: ci runs: gh run list');
  });

  it('keeps waiting through fewer failed reads than the limit', async () => {
    const planted = plant({ failedListReads: CI_READ_TRIES - 1 });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`run 37190089292 (verify) on ${BRANCH} at c4da2c4 ended: failure`);
  });
});

describe('rafa stretch item --wait, refusals before the merge', () => {
  it.each([
    ['the default branch', 'main'],
    ['another branch', 'release/1'],
    ['a bare stretch/', 'stretch/'],
  ])('refuses a pull request into %s, merging nothing', async (_name, base) => {
    const planted = plant({ base });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`#${String(PR)} opens into ${base}, not a stretch/* branch`);
    expect(outcome.stderr).toContain('Nothing was merged.');
    expect(planted.rafaCalls).toEqual([WAIT_LINE]);
    expect(existsSync(itemsPath(planted.project.root, 4))).toBe(false);
  });

  it('refuses a pull request that is not open', async () => {
    const planted = plant({ state: 'CLOSED' });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`#${String(PR)} is CLOSED, not open. Nothing was merged.`);
    expect(planted.rafaCalls).toEqual([WAIT_LINE]);
  });
});

describe('rafa stretch item --wait, a merge that did not go through', () => {
  it('ends with pr merge\'s own code and runs nothing after it', async () => {
    const planted = plant({ mergeExit: 1, merges: false });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`rafa pr merge ${String(PR)} --skip-checks --yes ended with exit code 1`);
    expect(planted.ghCalls.some((args) => args[1] === 'list')).toBe(false);
    expect(existsSync(itemsPath(planted.project.root, 4))).toBe(false);
  });

  it('ends 2 when pr merge ends 0 and the pull request is not merged', async () => {
    const planted = plant({ merges: false });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain(`rafa pr merge ended 0, and #${String(PR)} reads OPEN with no merge commit.`);
    expect(existsSync(itemsPath(planted.project.root, 4))).toBe(false);
  });
});

describe('rafa stretch item --wait, a loop that ended without a pull request', () => {
  it('prints the no-pr reason, merges nothing and exits with loop wait\'s code', async () => {
    const planted = plant({
      waitExit: 10,
      events: [
        { name: 'task-start', summary: 'task 1/1 start', data: {}, ts: '2026-10-07T09:01:00.000Z' },
        { name: 'no-pr', summary: 'no pr  nothing to push', data: { reason: 'nothing to push' }, ts: '2026-10-07T09:02:00.000Z' },
      ],
    });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(10);
    expect(outcome.stdout).toContain('the loop of #812 ended on no-pr: nothing to push');
    expect(outcome.stdout).toContain(`log: ${itemLogPath(planted.project.root, 4, 812)}`);
    expect(outcome.stderr).toContain('ended with exit code 10 and no pull request to merge; nothing was merged.');
    expect(planted.rafaCalls).toEqual([WAIT_LINE]);
    expect(planted.ghCalls).toEqual([]);
    expect(existsSync(itemsPath(planted.project.root, 4))).toBe(false);
  });

  it('ends 2 when loop wait ends 0 and the run wrote no events file', async () => {
    const planted = plant({ events: null });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain('the loop of #812 ended without a pull request: it wrote no events file');
    expect(planted.rafaCalls).toEqual([WAIT_LINE]);
  });
});

describe('readLoopEnding', () => {
  /** A root whose events file for the session holds `lines`. */
  function rootWith(lines: readonly string[]): string {
    const root = realpathSync(mkdtempSync(join(scope, 'ending-')));
    mkdirSync(join(root, '.rafa', 'runs'), { recursive: true });
    writeFileSync(eventsFilePath(root, SESSION_ID), lines.map((line) => `${line}\n`).join(''));
    return root;
  }

  function event(name: string, data: object, summary = name): string {
    return JSON.stringify({ name, summary, data, ts: '2026-10-07T09:00:00.000Z' });
  }

  it('reads the first ending event in file order, as loop wait does', () => {
    expect(readLoopEnding(rootWith([event('task-done', {}), event('pr', { number: 7 }), event('halt', { reason: 'x' })]), SESSION_ID))
      .toEqual({ kind: 'pr', number: 7 });
    expect(readLoopEnding(rootWith([event('halt', { reason: 'tests red' }), event('pr', { number: 7 })]), SESSION_ID))
      .toEqual({ kind: 'halt', reason: 'tests red' });
  });

  it('reads an error by its message, and an event with no reason by its summary', () => {
    expect(readLoopEnding(rootWith([event('error', { message: 'boom' })]), SESSION_ID)).toEqual({ kind: 'error', reason: 'boom' });
    expect(readLoopEnding(rootWith([event('no-pr', {}, 'no pr  said nothing')]), SESSION_ID))
      .toEqual({ kind: 'no-pr', reason: 'no pr  said nothing' });
  });

  it('reads none for a file with no ending event, a pr with no number, and no file', () => {
    const plain = readLoopEnding(rootWith([event('task-start', {}), 'not json']), SESSION_ID);
    expect(plain.kind).toBe('none');
    expect(readLoopEnding(rootWith([event('pr', { number: '7' })]), SESSION_ID))
      .toEqual({ kind: 'none', reason: 'its pr event names no pull request number: "7"' });
    const empty = realpathSync(mkdtempSync(join(scope, 'ending-')));
    expect(readLoopEnding(empty, SESSION_ID).kind).toBe('none');
  });

  it('names the reason in the line it is reported by', () => {
    expect(noPullRequestLine(812, { kind: 'halt', reason: 'tests red' })).toBe('the loop of #812 ended on halt: tests red');
  });
});

describe('viewPull', () => {
  function answering(stdout: string, ok = true): GhRunner {
    return async () => Promise.resolve({ ok, stdout, stderr: ok
      ? ''
      : 'no pull requests found' });
  }

  it('asks for the fields it reads', () => {
    expect(prViewArgs(5)).toEqual(['pr', 'view', '5', '--json', PR_VIEW_FIELDS.join(',')]);
  });

  it('reads a merged pull request as gh 2.102.0 wrote one', async () => {
    const recorded = JSON.stringify({ baseRefName: 'main', body: '', headRefName: 'feat/x', mergeCommit: { oid: OLD_SHA }, number: 881, state: 'MERGED' });

    expect(await viewPull(answering(`${recorded}\n`), 881)).toEqual({
      number: 881, state: 'MERGED', base: 'main', head: 'feat/x', body: '', mergeCommit: OLD_SHA,
    });
  });

  it.each([
    ['a gh failure', answering('', false), 'failed: no pull requests found'],
    ['output that is not JSON', answering('<html>'), 'wrote output that is not JSON'],
    ['another pull request', answering(JSON.stringify({ number: 6 })), 'answered number 6'],
    ['a merge commit with no sha', answering(JSON.stringify({ number: 5, state: 'MERGED', baseRefName: 'b', headRefName: 'h', body: '', mergeCommit: { oid: 'abc' } })), 'answered mergeCommit'],
    ['a missing field', answering(JSON.stringify({ number: 5, state: 'OPEN' })), 'answered baseRefName'],
  ])('fails with exit 2 on %s', async (_name, gh, said) => {
    const read = viewPull(gh, 5);

    expect(read).rejects.toMatchObject({ exitCode: 2 });
    await expect(read).rejects.toThrow(said);
  });
});

describe('ghFiledAt', () => {
  it('reads createdAt, and null where gh fails or answers something else', async () => {
    const answers: Record<string, GhResult> = {
      1: { ok: true, stdout: '{"createdAt":"2026-10-05T15:08:56Z"}\n', stderr: '' },
      2: { ok: false, stdout: '', stderr: 'GraphQL: Could not resolve' },
      3: { ok: true, stdout: '{"createdAt":"soon"}', stderr: '' },
      4: { ok: true, stdout: 'nope', stderr: '' },
    };
    const asked: string[][] = [];
    const read = ghFiledAt(async (args) => {
      asked.push([...args]);
      return Promise.resolve(answers[args[2] ?? ''] ?? { ok: false, stdout: '', stderr: '' });
    });
    const ref = (id: string): OpenIssue['ref'] => ({ opt: 0, kind: 'github', externalId: id, url: null });

    expect((await read(ref('1')))?.toISOString()).toBe('2026-10-05T15:08:56.000Z');
    expect(await read(ref('2'))).toBeNull();
    expect(await read(ref('3'))).toBeNull();
    expect(await read(ref('4'))).toBeNull();
    expect(asked[0]).toEqual(['issue', 'view', '1', '--json', 'createdAt']);
  });
});

describe('the dry run', () => {
  it('prints the merge half\'s lines after the loop wait line, and runs none of them', async () => {
    const planted = plant();

    const outcome = await run(planted, ['812', '--wait', '--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls).toEqual([]);
    expect(planted.ghCalls).toEqual([]);
    const lines = mergeDryRunLines(['rafa'], planted.project.root, 4);
    expect(lines[0]).toBe('rafa pr merge <pr> --skip-checks --yes');
    expect(lines[1]).toStartWith(`gh run list --branch ${BRANCH} --limit 1 --json`);
    expectInOrder(outcome.stdout, ['rafa loop wait --session-id=<session id>', ...lines, 'dry run: would start the loop']);
    expect(existsSync(itemsPath(planted.project.root, 4))).toBe(false);
  });

  it('prints none of them without --wait', async () => {
    const planted = plant();

    const outcome = await run(planted, ['812', '--dry-run']);

    expect(outcome.stdout).not.toContain('pr merge');
    expect(readFileSync(join(planted.project.root, PLAN), 'utf8')).toContain('a task');
  });
});
