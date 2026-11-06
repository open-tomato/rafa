/**
 * `rafa stretch item 812 --resume` (`./item-resume.ts`), dispatched in
 * planted projects with a plan of the issue in `plan.dir` and the item's
 * log planted with `rafa· pr #<pr> opened` lines. Every process is a fake,
 * as in `./item-merge.test.ts`: `gh pr view` answers the pull request
 * open and `MERGEABLE` until the fake `pr merge` runs, or merged from the
 * first read when the case says so; `gh pr checks` answers one passed
 * `fragment` row; `gh run list` answers one completed run on the merge
 * commit; `rafa effort collect` answers 0, the effort dashboard is a
 * planted one holding the item's plan row, and the recheck runner, `git`
 * and the tracker's `get` and `editable` refuse when called, since no
 * planted bug names a runnable `Rerun`. The ledger, the plan and the log
 * are real files.
 *
 * Controls: the log names an earlier pull request before the one read,
 * so the last line is seen to win over the first; the open case lists a
 * bug filed after the log's last change beside one filed before it, so
 * the cut-off is seen to drop as well as keep; and every refusal finds
 * no fake called and no ledger, beside the two runs that find it written.
 */
import type { StretchItemSeams } from './item.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';
import type { OpenIssue } from '@open-tomato/rafa/ports';
import type { GhResult, GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';
import type { Dashboard } from '@open-tomato/rafa-effort';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeRunsGh } from '../../ci/runs-fake.js';
import { appendItem, itemsPath, readItems } from '../../stretch/items.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { mergeDryRunLines } from './item-merge.js';
import { readLogPullRequest, resumeDryRunLines } from './item-resume.js';
import { createStretchItemCommand, itemLogPath, STRETCH_ITEM_USAGE } from './item.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-item-resume-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const STRETCH_SUBJECT = { name: 'stretch', summary: 'stretches' };
const STRETCH_CONFIG = 'version: 1\npr:\n  base: stretch/4\n';
const PLAN = '.rafa/plans/PLAN-rafa-812-pit-readings.md';
const STUB = 'rafa-812-pit-readings';
const PR = 901;
const EARLIER_PR = 880;
const BRANCH = 'stretch/4';
const MERGE_SHA = 'c4da2c4c63b2e9d585d3a76ffbda1c49e3ce60d1';
const START = Date.parse('2026-10-07T09:00:00.000Z');
/** The log's last change, the cut-off when the ledger and `stretch.json` hold none. */
const LOG_TIME = new Date('2026-10-07T08:30:00.000Z');
const BODY = 'Plan for #812.\n\nCloses #812\n';
const MERGE_LINE = ['rafa', 'pr', 'merge', String(PR), '--yes'];
const COLLECT_LINE = ['rafa', 'effort', 'collect'];
/** The `Effort:` line {@link plantedDashboard} renders. */
const EFFORT_LINE = `Effort: ${STUB}: 2 tasks, p50 1.5 min against no baseline, max 3.0 min.`;

/** A dashboard holding the item's plan row and no `minutes` baseline. */
function plantedDashboard(): Dashboard {
  const planted = {
    trend: { metrics: [] },
    loops: { rows: [{ key: STUB, kind: 'plan', tasks: 2, perTask: { minutes: { min: null, avg: null, p50: 1.5, max: 3 } } }] },
  };
  return planted as unknown as Dashboard;
}

/** An open bug filed at `createdAt`. */
function bug(id: string, title: string, createdAt: string): OpenIssue {
  const ref: OpenIssue['ref'] = { opt: 0, kind: 'github', externalId: id, url: `https://example.test/issues/${id}` };
  return { ref, title, body: '', createdAt };
}

/** What a case changes about the project and the fakes. */
interface CaseOptions {
  /** The log's text; the two `pr` lines when left out, no log at all for null. */
  readonly log?: string | null;
  /** Whether the pull request reads merged from the first read. */
  readonly mergedAlready?: boolean;
  readonly bugs?: readonly OpenIssue[];
}

interface Case {
  readonly project: PlantedProject;
  readonly log: string;
  readonly rafaCalls: string[][];
  readonly ghCalls: string[][];
  readonly launches: string[][];
  readonly seams: StretchItemSeams;
}

/** The log of an item whose loop opened {@link EARLIER_PR}, then {@link PR}. */
const TWO_PR_LOG = [
  'rafa· task 1/1 start      "a task"',
  `rafa· pr #${String(EARLIER_PR)} opened`,
  'rafa· wrap-up           push',
  `rafa· pr #${String(PR)} opened`,
  'a line some child wrote',
  '',
].join('\n');

function plant(options: CaseOptions = {}): Case {
  const caseDir = realpathSync(mkdtempSync(join(scope, 'case-')));
  const project = plantProject(caseDir, STRETCH_CONFIG);
  const { root } = project;
  mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
  writeFileSync(join(root, PLAN), '# Plan\n\n- [ ] a task\n');
  const log = itemLogPath(root, 4, 812);
  const text = options.log === undefined
    ? TWO_PR_LOG
    : options.log;
  if (text !== null) {
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, text);
    utimesSync(log, LOG_TIME, LOG_TIME);
  }

  const rafaCalls: string[][] = [];
  const ghCalls: string[][] = [];
  const launches: string[][] = [];
  let clock = START;
  let merged = options.mergedAlready ?? false;

  const gh: GhRunner = (args) => {
    ghCalls.push([...args]);
    const answer = (result: GhResult): Promise<GhResult> => Promise.resolve(result);
    if (args[0] === 'pr' && args[1] === 'view') {
      const row = {
        baseRefName: BRANCH,
        body: BODY,
        headRefName: 'feat/rafa-812-pit-readings',
        mergeCommit: merged
          ? { oid: MERGE_SHA }
          : null,
        mergeable: merged
          ? 'UNKNOWN'
          : 'MERGEABLE',
        number: Number(args[2]),
        state: merged
          ? 'MERGED'
          : 'OPEN',
      };
      return answer({ ok: true, stdout: `${JSON.stringify(row)}\n`, stderr: '' });
    }
    if (args[0] === 'pr' && args[1] === 'checks') {
      return answer({ ok: true, stdout: `${JSON.stringify([{ name: 'fragment', state: 'SKIPPED', link: '' }])}\n`, stderr: '' });
    }
    if (args[0] === 'run' && args[1] === 'list') {
      return createFakeRunsGh([{
        databaseId: 37190089292,
        workflowName: 'verify',
        headBranch: BRANCH,
        headSha: MERGE_SHA,
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-10-07T09:30:00Z',
      }]).gh(args);
    }
    return answer({ ok: false, stdout: '', stderr: `fake gh: not modelled: ${args.join(' ')}` });
  };

  const seams: StretchItemSeams = {
    runRafa: async (argv) => {
      rafaCalls.push([...argv]);
      if (argv[1] === 'pr') merged = true;
      return Promise.resolve(0);
    },
    launch: (argv) => {
      launches.push([...argv]);
      return null;
    },
    isAlive: () => false,
    gh: () => gh,
    tracker: () => ({
      kind: 'github',
      get: () => Promise.reject(new Error('fake tracker: get is not modelled')),
      editable: () => Promise.reject(new Error('fake tracker: editable is not modelled')),
      openIssues: async () => Promise.resolve([...(options.bugs ?? [])]),
      filedIssues: async (_type, since) => Promise.resolve((options.bugs ?? []).flatMap(({ ref, title, body, createdAt }) => (
        createdAt !== null && Date.parse(createdAt) > since.getTime()
          ? [{ ref, title, body, createdAt }]
          : []
      ))),
    }),
    readDashboard: () => Promise.resolve(plantedDashboard()),
    recheck: () => Promise.reject(new Error('fake recheck: no runnable bug is planted')),
    git: () => () => ({ ok: false, stdout: '', stderr: 'fake git: not modelled' }),
    sleep: async (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    now: () => new Date(clock),
    rafa: ['rafa'],
  };
  return { project, log, rafaCalls, ghCalls, launches, seams };
}

async function run(planted: Case, words: readonly string[] = ['812', '--resume']): Promise<CapturedRun> {
  const command = createStretchItemCommand(planted.seams);
  return dispatchInProject(['stretch', 'item', ...words], [STRETCH_SUBJECT], [command], planted.project, { PATH: '/fake/bin' });
}

/** Asserts nothing was run: no rafa line, no `gh` call, no launch and no ledger. */
function expectNothingRun(planted: Case): void {
  expect(planted.rafaCalls).toEqual([]);
  expect(planted.ghCalls).toEqual([]);
  expect(planted.launches).toEqual([]);
  expect(existsSync(itemsPath(planted.project.root, 4))).toBe(false);
}

describe('rafa stretch item --resume, an open pull request', () => {
  it('reads the log\'s last pr line, waits for its mergeability and checks, merges it and writes the ledger', async () => {
    const planted = plant({
      bugs: [bug('870', 'filed after the log', '2026-10-07T08:45:00Z'), bug('869', 'filed before the log', '2026-10-07T08:00:00Z')],
    });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls).toEqual([MERGE_LINE, COLLECT_LINE]);
    expect(planted.launches).toEqual([]);
    expect(planted.ghCalls.some((args) => args[1] === 'checks' && args[2] === String(PR))).toBe(true);
    expect(planted.ghCalls.some((args) => args.includes(String(EARLIER_PR)))).toBe(false);
    expect(readItems(planted.project.root, 4).items).toEqual([{
      issue: '812',
      plan: STUB,
      pullRequest: PR,
      mergeCommit: MERGE_SHA,
      closes: ['Closes #812'],
      at: new Date(START).toISOString(),
    }]);
    expect(outcome.stdout).toContain(`read #${String(PR)} from ${planted.log}`);
    expect(outcome.stdout).toContain(`#${String(PR)} mergeability: MERGEABLE`);
    expect(outcome.stdout).toContain(`waiting for the checks of #${String(PR)}`);
    expect(outcome.stdout).toContain(`rafa pr merge ${String(PR)} --yes`);
    expect(outcome.stdout).toContain(`Filed since ${LOG_TIME.toISOString()}: 1.`);
    expect(outcome.stdout).toContain('#870 filed after the log');
    expect(outcome.stdout).toContain('rafa effort collect ended 0 in 0.0s');
    expect(outcome.stdout).toContain(EFFORT_LINE);
    expect(outcome.stdout).toContain('Recheck #870: manual');
    expect(outcome.stdout).not.toContain('#869');
    expect(outcome.stdout).not.toContain('skipping the merge');
  });
});

describe('rafa stretch item --resume, a merged pull request', () => {
  it('runs no pr merge line, prints the skip line and writes the ledger', async () => {
    const planted = plant({ mergedAlready: true });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls).toEqual([COLLECT_LINE]);
    expect(planted.ghCalls.some((args) => args[1] === 'checks')).toBe(false);
    expect(outcome.stdout).toContain(`#${String(PR)} is merged already at c4da2c4; skipping the merge`);
    expect(outcome.stdout).not.toContain('rafa pr merge');
    expect(readItems(planted.project.root, 4).items.map((item) => [item.pullRequest, item.mergeCommit])).toEqual([[PR, MERGE_SHA]]);
  });
});

describe('rafa stretch item --resume, a log naming no pull request', () => {
  it('refuses a log with no pr line, naming the log, and runs nothing', async () => {
    const planted = plant({ log: 'rafa· task 1/1 start      "a task"\nrafa· no pr            nothing to push\n' });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`the log ${planted.log} holds no "rafa· pr #<n> opened" line`);
    expectNothingRun(planted);
  });

  it('refuses an item with no log at all, naming its path, and runs nothing', async () => {
    const planted = plant({ log: null });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`there is no log at ${planted.log}`);
    expectNothingRun(planted);
  });

  it('answers a reason for a log that cannot be read, and the last pr line of one that can', () => {
    const dir = realpathSync(mkdtempSync(join(scope, 'log-')));

    expect(readLogPullRequest(dir)).toEqual({ kind: 'none', reason: expect.stringContaining(`the log ${dir} could not be read: `) });
    const log = join(dir, 'loop.log');
    writeFileSync(log, TWO_PR_LOG);
    expect(readLogPullRequest(log)).toEqual({ kind: 'pr', number: PR });
  });
});

describe('rafa stretch item --resume, an item the ledger holds', () => {
  it('refuses, naming the line\'s pull request and time, and runs nothing', async () => {
    const planted = plant();
    appendItem(planted.project.root, 4, {
      issue: '812',
      plan: STUB,
      pullRequest: PR,
      mergeCommit: MERGE_SHA,
      closes: ['Closes #812'],
      at: '2026-10-07T08:50:00.000Z',
    });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`#812 is in ${itemsPath(planted.project.root, 4)} already: pull request #${String(PR)},`
      + ' written at 2026-10-07T08:50:00.000Z');
    expect(planted.rafaCalls).toEqual([]);
    expect(planted.ghCalls).toEqual([]);
    expect(readItems(planted.project.root, 4).items).toHaveLength(1);
  });
});

describe('rafa stretch item --resume --dry-run', () => {
  it('prints the resume lines, the merge line marked, and no plan, loop or wait line, running nothing', async () => {
    const planted = plant();

    const outcome = await run(planted, ['812', '--resume', '--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expectNothingRun(planted);
    const lines = resumeDryRunLines(['rafa'], planted.project.root, 4, planted.log);
    expect(lines[0]).toBe(`read the pull request from ${planted.log}`);
    expect(lines).toContain('rafa pr merge <pr> --yes  (skipped when #<pr> is merged already)');
    expect(lines).toHaveLength(mergeDryRunLines(['rafa'], planted.project.root, 4).length + 1);
    for (const line of lines) expect(outcome.stdout).toContain(line);
    expect(outcome.stdout).not.toContain('plan create');
    expect(outcome.stdout).not.toContain('loop start');
    expect(outcome.stdout).not.toContain('loop wait');
    expect(outcome.stdout).toContain('dry run: would resume #812 for stretch/4; nothing was run');
  });
});

describe('rafa stretch item --resume --wait', () => {
  it('is refused with exit code 1 and the usage line, running nothing', async () => {
    const planted = plant();

    const outcome = await run(planted, ['812', '--resume', '--wait']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('pass one of them');
    expect(outcome.stderr).toContain(`Usage: ${STRETCH_ITEM_USAGE}`);
    expect(STRETCH_ITEM_USAGE).toBe('rafa stretch item <issue> [--wait | --resume] [--dry-run]');
    expectNothingRun(planted);
  });
});
