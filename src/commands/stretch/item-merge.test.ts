/**
 * The after-pull-request half of `rafa stretch item` (`./item-merge.ts`),
 * driven through `rafa stretch item 812 --wait` in planted projects with
 * a plan of the issue already there, so the only rafa lines run are
 * `loop wait` and `pr merge`, both fakes. `gh` is one stand-in: `pr view`
 * answers the pull request the case plants, open and `MERGEABLE` until
 * the fake merge runs and merged at {@link MERGE_SHA} after it, or open
 * for as many reads after it as the case says; `pr checks` answers one
 * passed `fragment` row, as every pull request reports; `run list` is the
 * recorded fake of `src/ci/runs-fake.ts`, one list of runs per read so a
 * case can move the run from in progress to completed; `run view
 * --log-failed` answers the captured log of `src/ci/testdata/`. Each
 * open bug carries its own `createdAt`, so `issue view` is not modelled.
 * `rafa effort collect` is a fake that answers the case's exit code and
 * moves the clock {@link COLLECT_MS} on, the effort dashboard a planted
 * one holding the item's plan row, and the recheck runner, `git` and the
 * tracker's `get` and `editable` refuse when called: every planted bug's
 * body names no `Rerun`, so each is judged `manual` and nothing runs.
 * The events file, the session record, the ledger and `stretch.json` are
 * real files.
 *
 * Controls: every refusal and every loop without a pull request reads
 * the ledger as absent beside a full run that finds it written, the
 * cut-off cases list a bug filed after the cut-off beside one filed
 * before it, so the filter is seen to drop as well as keep, and a
 * `pr merge` that ended 1 is read merged beside one read open, so the
 * exit code is seen to end the item as well as not. The collect that
 * ended 1 reads the dashboard no time beside the full run that reads it
 * once, so the collect's code is seen to gate the effort reading.
 */
import type { StretchItemSeams } from './item.js';
import type { FakeRun } from '../../ci/runs-fake.js';
import type { DashboardReadOptions } from '../../stretch/pit-effort.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';
import type { RecheckBugOptions } from '../bug/recheck-run.js';
import type { OpenIssue } from '@open-tomato/rafa/ports';
import type { GhResult, GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';
import type { Dashboard } from '@open-tomato/rafa-effort';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { beginSession } from '@open-tomato/rafa/core/loop';
import { eventsFilePath } from '@open-tomato/rafa-run/start/loop-events';

import { createFakeRunsGh, RECORDED_STRETCH_111 } from '../../ci/runs-fake.js';
import { headRunsArgs, runListArgs } from '../../ci/runs.js';
import { appendItem, itemsPath, readItems } from '../../stretch/items.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import {
  CI_POLL_MS,
  CI_READ_TRIES,
  CI_WAIT_MS,
  MERGED_POLL_MS,
  MERGED_READ_TRIES,
  mergeDryRunLines,
  noPullRequestLine,
  readLoopEnding,
} from './item-merge.js';
import { prViewArgs } from './item-pull.js';
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
/** The commit of a push to the branch after the merge, whose run is listed before the merge commit's. */
const NEWER_SHA = 'fb9abe9c1d2e3f405162738495a6b7c8d9e0f1a2';
const START = Date.parse('2026-10-07T09:00:00.000Z');
const BODY = 'Plan for #812.\n\nCloses #812\nFixes #812\ncloses #604\n';
const THREE_CASES = await Bun.file(new URL('../../ci/testdata/three-cases.log-failed.txt', import.meta.url)).text();
const GATE_FILE = 'src/tests/task-gate-spawned.test.ts';
/** How long the fake `rafa effort collect` takes on the planted clock. */
const COLLECT_MS = 12_000;
/** The `Effort:` line the planted dashboard renders for {@link STUB}. */
const EFFORT_LINE = `Effort: ${STUB}: 3 tasks, p50 2.4 min against 5.5 min, max 4.1 min.`;

/** A dashboard holding the item's plan row beside another plan's, and a `minutes` baseline of 5.5 min. */
function plantedDashboard(): Dashboard {
  const row = (key: string, tasks: number, p50: number, max: number): object => (
    { key, kind: 'plan', tasks, perTask: { minutes: { min: null, avg: null, p50, max } } }
  );
  const planted = {
    trend: { metrics: [{ name: 'minutes', baselineP50: 5.5 }] },
    loops: { rows: [row('rafa-604-config-set', 7, 9.9, 9.9), row(STUB, 3, 2.4, 4.1)] },
  };
  return planted as unknown as Dashboard;
}

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

/** An open bug filed at `createdAt`. */
function bug(id: string, title: string, createdAt: string): OpenIssue {
  const ref: OpenIssue['ref'] = { opt: 0, kind: 'github', externalId: id, url: `https://example.test/issues/${id}` };
  return { ref, title, body: '', createdAt };
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
  /** How many reads after the merge still answer the pull request open; none when left out. */
  readonly openReadsAfterMerge?: number;
  readonly base?: string;
  readonly state?: string;
  /** The runs `run list` answers on each read, the last list kept for every read past it. */
  readonly runs?: readonly (readonly FakeRun[])[];
  /** How many `run list` reads fail before the fake answers. */
  readonly failedListReads?: number;
  readonly bugs?: readonly OpenIssue[];
  /** The bugs `filedIssues` answers, filed after the cut-off or not, when it is not derived from `bugs`. */
  readonly filed?: readonly OpenIssue[];
  /** The message `filedIssues` throws, when it should. */
  readonly filedThrows?: string;
  /** The exit code `rafa effort collect` answers; 0 when left out. */
  readonly collectExit?: number;
  /** The project's config; {@link STRETCH_CONFIG} when left out. */
  readonly config?: string;
  /** Who opened each bug, by number, as `editable` answers it; `editable` refuses when left out. */
  readonly authors?: Readonly<Record<string, string>>;
}

interface Case {
  readonly project: PlantedProject;
  readonly rafaCalls: string[][];
  readonly ghCalls: string[][];
  readonly sleeps: number[];
  /** How many times `pr view` was read after the merge ran. */
  readonly viewsAfterMerge: () => number;
  /** Every read of the effort dashboard. */
  readonly dashboardReads: DashboardReadOptions[];
  /** Every run of the recheck runner. */
  readonly rechecks: RecheckBugOptions[];
  /** Every git line, by its words. */
  readonly gitCalls: string[][];
  readonly seams: StretchItemSeams;
}

function plant(options: CaseOptions = {}): Case {
  const caseDir = realpathSync(mkdtempSync(join(scope, 'case-')));
  const project = plantProject(caseDir, options.config ?? STRETCH_CONFIG);
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
  let mergeRan = false;
  let viewsAfterMerge = 0;
  let listReads = 0;
  const runLists = options.runs ?? [[verifyRun()]];
  const dashboardReads: DashboardReadOptions[] = [];
  const rechecks: RecheckBugOptions[] = [];
  const gitCalls: string[][] = [];
  const authors = options.authors;

  const gh: GhRunner = (args) => {
    ghCalls.push([...args]);
    const answer = (result: GhResult): Promise<GhResult> => Promise.resolve(result);
    if (args[0] === 'pr' && args[1] === 'view') {
      if (mergeRan) viewsAfterMerge += 1;
      const readMerged = merged && viewsAfterMerge > (options.openReadsAfterMerge ?? 0);
      const row = {
        baseRefName: options.base ?? BRANCH,
        body: BODY,
        headRefName: 'feat/rafa-812-pit-readings',
        mergeCommit: readMerged
          ? { oid: MERGE_SHA }
          : null,
        mergeable: readMerged
          ? 'UNKNOWN'
          : 'MERGEABLE',
        number: Number(args[2]),
        state: readMerged
          ? 'MERGED'
          : options.state ?? 'OPEN',
      };
      return answer({ ok: true, stdout: `${JSON.stringify(row)}\n`, stderr: '' });
    }
    if (args[0] === 'pr' && args[1] === 'checks') {
      return answer({ ok: true, stdout: `${JSON.stringify([{ name: 'fragment', state: 'SKIPPED', link: '' }])}\n`, stderr: '' });
    }
    if (args[0] === 'run' && args[1] === 'list') {
      listReads += 1;
      if (listReads <= (options.failedListReads ?? 0)) return answer({ ok: false, stdout: '', stderr: 'HTTP 502: Bad Gateway' });
      const runs = runLists[Math.min(listReads - (options.failedListReads ?? 0), runLists.length) - 1] ?? [];
      return createFakeRunsGh(runs).gh(args);
    }
    if (args[0] === 'run' && args[1] === 'view') return answer({ ok: true, stdout: THREE_CASES, stderr: '' });
    return answer({ ok: false, stdout: '', stderr: `fake gh: not modelled: ${args.join(' ')}` });
  };

  const seams: StretchItemSeams = {
    runRafa: async (argv) => {
      rafaCalls.push([...argv]);
      if (argv[1] === 'pr') {
        mergeRan = true;
        if (options.merges ?? true) merged = true;
        return Promise.resolve(options.mergeExit ?? 0);
      }
      if (argv[1] === 'effort') {
        clock += COLLECT_MS;
        return Promise.resolve(options.collectExit ?? 0);
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
    tracker: () => ({
      kind: 'github',
      get: () => Promise.reject(new Error('fake tracker: get is not modelled')),
      editable: (ref) => (authors === undefined
        ? Promise.reject(new Error('fake tracker: editable is not modelled'))
        : Promise.resolve({ ref, title: '', body: '', open: true, labels: [], author: authors[ref.externalId] ?? '' })),
      openIssues: async () => Promise.resolve([...(options.bugs ?? [])]),
      filedIssues: async (_type, since) => {
        if (options.filedThrows !== undefined) throw new Error(options.filedThrows);
        return Promise.resolve((options.filed ?? options.bugs ?? []).flatMap(({ ref, title, body, createdAt }) => (
          createdAt !== null && Date.parse(createdAt) > since.getTime()
            ? [{ ref, title, body, createdAt }]
            : []
        )));
      },
    }),
    readDashboard: (read) => {
      dashboardReads.push(read);
      return Promise.resolve(plantedDashboard());
    },
    recheck: (recheck) => {
      rechecks.push(recheck);
      return Promise.resolve({ verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 0 });
    },
    git: () => (args) => {
      gitCalls.push([...args]);
      return { ok: false, stdout: '', stderr: 'fake git: not modelled' };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => new Date(clock),
    rafa: ['rafa'],
  };
  return { project, rafaCalls, ghCalls, sleeps, viewsAfterMerge: () => viewsAfterMerge, dashboardReads, rechecks, gitCalls, seams };
}

async function run(planted: Case, words: readonly string[] = ['812', '--wait'], env: Readonly<Record<string, string>> = {}): Promise<CapturedRun> {
  const command = createStretchItemCommand(planted.seams);
  return dispatchInProject(['stretch', 'item', ...words], [STRETCH_SUBJECT], [command], planted.project, { PATH: '/fake/bin', ...env });
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
const MERGE_LINE = ['rafa', 'pr', 'merge', String(PR), '--yes'];
const COLLECT_LINE = ['rafa', 'effort', 'collect'];

describe('rafa stretch item --wait, a loop that opened a pull request', () => {
  it('waits for its checks, merges it, waits for the run on the merge commit, appends the ledger and prints the readings', async () => {
    const planted = plant({
      runs: [
        [verifyRun({ headSha: OLD_SHA, createdAt: '2026-10-07T08:00:00Z' })],
        [verifyRun({ status: 'in_progress', conclusion: '' })],
        [verifyRun()],
      ],
      bugs: [bug('870', 'filed during the item', '2026-10-07T09:10:00Z'), bug('700', 'filed long ago', '2026-09-01T00:00:00Z')],
    });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls).toEqual([WAIT_LINE, MERGE_LINE, COLLECT_LINE]);
    expect(planted.ghCalls[0]).toEqual(prViewArgs(PR));
    expect(planted.ghCalls.filter((args) => args[1] === 'list')).toHaveLength(5);
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
      `#${String(PR)} mergeability: MERGEABLE`,
      `waiting for the checks of #${String(PR)}`,
      `rafa pr merge ${String(PR)} --yes`,
      `merged #${String(PR)} into ${BRANCH} at c4da2c4`,
      `waiting for the run on ${BRANCH} at c4da2c4 to end`,
      `run 37190089292 (verify) on ${BRANCH} at c4da2c4 ended: failure`,
      `ledger: #812 appended to ${itemsPath(planted.project.root, 4)}, Closes #812, Closes #604`,
      `CI: ❌ ${BRANCH}: red on c4da2c4, 1 workflow.`,
      '   ❌ verify run 37190089292 is failure.',
      `     ${GATE_FILE}`,
      'Bugs: 2 open.',
      `Filed since ${new Date(START).toISOString()}: 1.`,
      '   #870 filed during the item',
      EFFORT_LINE,
      'Recheck #870: manual',
    ]);
    expect(outcome.stdout).not.toContain('#700 filed long ago');
    expect(outcome.stdout).not.toContain('warn:');
  });

  it('records the merge as rafa pr merge <pr> --yes, run after the mergeability and checks reads', async () => {
    const planted = plant();

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls[1]).toEqual(['rafa', 'pr', 'merge', String(PR), '--yes']);
    expect(planted.ghCalls.slice(0, 3).map((args) => args.slice(0, 2).join(' '))).toEqual(['pr view', 'pr view', 'pr checks']);
    expect(planted.viewsAfterMerge()).toBe(1);
    expect(`${outcome.stdout}${outcome.stderr}`).not.toContain('--skip-checks');
  });

  it('reads the pull request again until it reads merged, and goes on', async () => {
    const planted = plant({ openReadsAfterMerge: 1 });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.viewsAfterMerge()).toBe(2);
    expect(planted.sleeps[0]).toBe(MERGED_POLL_MS);
    expect(outcome.stdout).toContain(`merged #${String(PR)} into ${BRANCH} at c4da2c4`);
    expect(readItems(planted.project.root, 4).items).toHaveLength(1);
  });

  it('counts new bugs from the last ledger line written before this one, not from its own', async () => {
    const planted = plant({
      bugs: [bug('871', 'after the last item', '2026-10-07T09:05:00Z'), bug('869', 'before the last item', '2026-10-07T07:00:00Z')],
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

  it('lists the bugs filed since the ledger\'s last line oldest first, from the listing alone, with no issue view per bug', async () => {
    const planted = plant({
      bugs: [
        bug('874', 'filed last', '2026-10-07T09:08:00Z'),
        bug('869', 'filed before the last item', '2026-10-07T07:00:00Z'),
        bug('873', 'filed first', '2026-10-07T08:30:00Z'),
      ],
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
    expectInOrder(outcome.stdout, [
      'Bugs: 3 open.',
      'Filed since 2026-10-07T08:00:00.000Z: 2.',
      '   #873 filed first',
      '   #874 filed last',
    ]);
    expect(outcome.stdout).not.toContain('Filed since the last item: not read');
    expect(outcome.stdout).not.toContain('#869');
    expect(planted.ghCalls.filter((args) => args[0] === 'issue' && args[1] === 'view')).toEqual([]);
    expect(planted.ghCalls.filter((args) => args[0] === 'issue')).toEqual([]);
  });

  it('lists a bug filed after the cut-off and closed since, absent from the open listing, with its first body line', async () => {
    const closed: OpenIssue = { ...bug('1084', 'filed after the cut-off, closed by the pit stop', '2026-10-07T09:10:00Z'), body: 'It broke on stretch 7.\nMore detail.\n' };
    const planted = plant({
      bugs: [bug('870', 'still open', '2026-10-07T06:00:00Z')],
      filed: [closed],
    });
    mkdirSync(join(planted.project.root, '.rafa', 'stretch', '4'), { recursive: true });
    writeFileSync(stretchRecordPath(planted.project.root, 4), JSON.stringify({ startedAt: '2026-10-07T05:00:00.000Z' }));

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expectInOrder(outcome.stdout, [
      'Bugs: 1 open.',
      'Filed since 2026-10-07T05:00:00.000Z: 1.',
      '   #1084 filed after the cut-off, closed by the pit stop: It broke on stretch 7.',
    ]);
    expect(outcome.stdout).not.toContain('More detail.');
    expect(outcome.stdout).not.toContain('#870');
  });

  it('prints the filed-since reading as not read when filedIssues throws, the open count still printed', async () => {
    const planted = plant({
      bugs: [bug('870', 'still open', '2026-10-07T09:10:00Z'), bug('871', 'also open', '2026-10-07T09:11:00Z')],
      filedThrows: 'gh issue list: HTTP 502',
    });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Bugs: 2 open.');
    expect(outcome.stdout).toContain('Filed since the last item: not read: ');
    expect(outcome.stdout).toContain('HTTP 502');
    expect(outcome.stdout).not.toContain('Filed since 2026');
    expect(outcome.stdout).not.toContain('none');
  });

  it('counts new bugs from stretch.json\'s start when the ledger is empty', async () => {
    const planted = plant({ bugs: [bug('872', 'during the stretch', '2026-10-07T06:00:00Z')] });
    mkdirSync(join(planted.project.root, '.rafa', 'stretch', '4'), { recursive: true });
    writeFileSync(stretchRecordPath(planted.project.root, 4), JSON.stringify({ startedAt: '2026-10-07T05:00:00.000Z' }));

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Filed since 2026-10-07T05:00:00.000Z: 1.');
  });

  it('gives up when no run on the merge commit is found within the wait\'s bound, and still writes the ledger line', async () => {
    const planted = plant({ runs: [[verifyRun({ headSha: OLD_SHA })]] });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.sleeps).toHaveLength(CI_WAIT_MS / CI_POLL_MS);
    expect(outcome.stdout).toContain(`warn: no run on ${BRANCH} at c4da2c4 was found within ${String(CI_WAIT_MS / 60_000)} minutes`);
    expect(outcome.stdout).not.toContain('had not ended within');
    expect(outcome.stdout).not.toContain('the readings below are of the newest run');
    expect(readItems(planted.project.root, 4).items).toHaveLength(1);
  });

  it('ends the wait on a red run of the merge commit while a newer green run of the branch is listed first', async () => {
    const newer = verifyRun({ databaseId: 37190099999, headSha: NEWER_SHA, conclusion: 'success', createdAt: '2026-10-07T09:40:00Z' });
    const planted = plant({ runs: [[newer, verifyRun()]] });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.sleeps).toEqual([]);
    expect(planted.ghCalls.filter((args) => args[1] === 'list')).toEqual([
      runListArgs({ branch: BRANCH, commit: MERGE_SHA }),
      runListArgs({ branch: BRANCH }),
      headRunsArgs(BRANCH, NEWER_SHA),
    ]);
    expectInOrder(outcome.stdout, [
      `waiting for the run on ${BRANCH} at c4da2c4 to end`,
      `run 37190089292 (verify) on ${BRANCH} at c4da2c4 ended: failure`,
      `CI: ✅ ${BRANCH}: green on ${NEWER_SHA.slice(0, 7)}, 1 workflow.`,
      '   ✅ verify run 37190099999 is success.',
    ]);
    expect(outcome.stdout).not.toContain('warn:');
  });

  it('prints the red CI line for the planted 90471b00 pair on the merge commit, a skipped run newest above two failed ones', async () => {
    const pair = RECORDED_STRETCH_111
      .filter((held) => held.headSha.startsWith('90471b00'))
      .map((held) => ({ ...held, headBranch: BRANCH, headSha: MERGE_SHA }));
    const planted = plant({ runs: [pair] });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expectInOrder(outcome.stdout, [
      `CI: ❌ ${BRANCH}: red on c4da2c4, 2 workflows.`,
      '   ✅ Release bot fragment run 41456634201 is skipped.',
      '   ❌ verify run 41456633215 is failure.',
    ]);
    expect(outcome.stdout).not.toContain('run 41456159309');
  });

  it('says the run it found had not ended when the merge commit\'s run is still going at the wait\'s bound', async () => {
    const planted = plant({ runs: [[verifyRun({ status: 'in_progress', conclusion: '' })]] });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.sleeps).toHaveLength(CI_WAIT_MS / CI_POLL_MS);
    expect(outcome.stdout).toContain(`warn: run 37190089292 (verify) on ${BRANCH} at c4da2c4 had not ended within ${String(CI_WAIT_MS / 60_000)} minutes`);
    expect(outcome.stdout).not.toContain('warn: no run on');
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

describe('rafa stretch item --wait, the effort collect and the rechecks', () => {
  it('runs rafa effort collect after the ledger line and prints its time before the readings, which it reads for the item', async () => {
    const planted = plant({ bugs: [bug('870', 'filed during the item', '2026-10-07T09:10:00Z')] });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls.at(-1)).toEqual(COLLECT_LINE);
    expectInOrder(outcome.stdout, [
      `ledger: #812 appended to ${itemsPath(planted.project.root, 4)}`,
      'rafa effort collect\n',
      'rafa effort collect ended 0 in 12.0s',
      `CI: ❌ ${BRANCH}: red on c4da2c4, 1 workflow.`,
      'Bugs: 1 open.',
      `Filed since ${new Date(START).toISOString()}: 1.`,
      EFFORT_LINE,
      'Recheck #870: manual',
    ]);
    expect(planted.dashboardReads.map((read) => read.repoRoot)).toEqual([planted.project.root]);
    expect(outcome.stdout).not.toContain('not wired');
  });

  it('prints the effort as not read after a collect that ended 1, reading no dashboard, the other readings still printed', async () => {
    const planted = plant({ collectExit: 1, bugs: [bug('870', 'filed during the item', '2026-10-07T09:10:00Z')] });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.dashboardReads).toEqual([]);
    expectInOrder(outcome.stdout, [
      'rafa effort collect ended 1 in 12.0s',
      `CI: ❌ ${BRANCH}: red on c4da2c4, 1 workflow.`,
      'Bugs: 1 open.',
      `Filed since ${new Date(START).toISOString()}: 1.`,
      'Effort: not read (rafa effort collect ended with exit code 1).',
      'Recheck #870: manual',
    ]);
    expect(outcome.stdout).not.toContain(`Effort: ${STUB}:`);
  });

  it('prints the rechecks as not read when the bugs filed since were not read', async () => {
    const planted = plant({ filedThrows: 'gh issue list: HTTP 502' });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Recheck: not read (gh issue list: HTTP 502).');
    expect(outcome.stdout).not.toContain('Recheck: no bug filed since.');
  });

  it('judges a runnable bug with the config\'s runs, deadline and trusted authors, its secrets left out, an untrusted one skipped', async () => {
    const config = `${STRETCH_CONFIG}bugs:\n  recheck:\n    runs: 4\n    timeoutSeconds: 30\nboard:\n  trustedAuthors: [alice]\n`;
    const body = ['## Reproduce', '', 'run the gate', '', '## Rerun', '', '```', `bun test ${GATE_FILE}`, '```', ''].join('\n');
    const filed = (id: string, at: string): OpenIssue => ({ ...bug(id, `runnable ${id}`, at), body });
    const planted = plant({
      config,
      authors: { '870': 'alice', '871': 'mallory' },
      bugs: [filed('870', '2026-10-07T09:10:00Z'), filed('871', '2026-10-07T09:11:00Z')],
    });
    mkdirSync(join(planted.project.root, 'src', 'tests'), { recursive: true });
    writeFileSync(join(planted.project.root, GATE_FILE), 'import { test } from "bun:test";\ntest("a case", () => {});\n');

    const outcome = await run(planted, ['812', '--wait'], { GITHUB_TOKEN: 'ghp_planted0secret0value' });

    expect(outcome.exitCode).toBe(0);
    expect(planted.rechecks).toHaveLength(1);
    expect(planted.rechecks[0]).toMatchObject({ checkout: planted.project.root, runs: 4, timeoutMs: 30_000 });
    expect(planted.rechecks[0]?.env['PATH']).toBe('/fake/bin');
    expect(planted.rechecks[0]?.env['GITHUB_TOKEN']).toBeUndefined();
    expect(planted.gitCalls).toEqual([['remote', 'get-url', 'origin']]);
    expectInOrder(outcome.stdout, ['Recheck #870: reproduces', 'Recheck #871: skipped: opened by mallory, ']);
  });

  it('prints no bug filed since as the recheck reading when none was filed', async () => {
    const planted = plant();

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Recheck: no bug filed since.');
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

describe('rafa stretch item --wait, a merge that ended non-zero', () => {
  it('goes on when the pull request reads merged, warning that the clean-up is what failed', async () => {
    const planted = plant({ mergeExit: 1 });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`warn: rafa pr merge ${String(PR)} --yes ended with exit code 1, and #${String(PR)} is merged:`
      + ' the clean-up after the merge is what failed; finish it with rafa cleanup.');
    expect(planted.viewsAfterMerge()).toBe(1);
    expect(readItems(planted.project.root, 4).items.map((item) => item.mergeCommit)).toEqual([MERGE_SHA]);
  });
});

describe('rafa stretch item --wait, a merge that did not go through', () => {
  it('ends with pr merge\'s own code after the reads, and runs nothing after it', async () => {
    const planted = plant({ mergeExit: 1, merges: false });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`rafa pr merge ${String(PR)} --yes ended with exit code 1, and #${String(PR)} reads OPEN`
      + ` with no merge commit after ${String(MERGED_READ_TRIES)} reads`);
    expect(outcome.stdout).not.toContain('warn:');
    expect(planted.viewsAfterMerge()).toBe(MERGED_READ_TRIES);
    expect(planted.ghCalls.some((args) => args[1] === 'list')).toBe(false);
    expect(existsSync(itemsPath(planted.project.root, 4))).toBe(false);
  });

  it('ends 2 when pr merge ends 0 and the pull request never reads merged', async () => {
    const planted = plant({ merges: false });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain(`rafa pr merge ${String(PR)} --yes ended 0, and #${String(PR)} reads OPEN with no merge commit`
      + ` after ${String(MERGED_READ_TRIES)} reads.`);
    expect(planted.viewsAfterMerge()).toBe(MERGED_READ_TRIES);
    expect(planted.sleeps).toEqual(Array.from({ length: MERGED_READ_TRIES - 1 }, () => MERGED_POLL_MS));
    expect(planted.ghCalls.some((args) => args[1] === 'list')).toBe(false);
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

describe('the dry run', () => {
  it('prints the merge half\'s lines after the loop wait line, and runs none of them', async () => {
    const planted = plant();

    const outcome = await run(planted, ['812', '--wait', '--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls).toEqual([]);
    expect(planted.ghCalls).toEqual([]);
    const lines = mergeDryRunLines(['rafa'], planted.project.root, 4);
    expect(lines[0]).toBe('wait for GitHub to compute the mergeability of <pr>  (again every 5s while it reads UNKNOWN, up to 2 minutes)');
    expect(lines[1]).toBe('wait for the checks of <pr> to pass  (again every 20s, up to 20 minutes)');
    expect(lines[2]).toBe('rafa pr merge <pr> --yes');
    expect(lines[3]).toStartWith(`gh run list --branch ${BRANCH} --commit <merge-commit> --limit 1 --json`);
    expect(lines.slice(4)).toEqual([
      `append the item to ${itemsPath(planted.project.root, 4)}`,
      'rafa effort collect',
      `print the pit-stop readings of ${BRANCH}`,
      'recheck each bug filed since the last item, as rafa bug recheck judges it, posting no comment',
    ]);
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
