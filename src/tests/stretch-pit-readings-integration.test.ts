/**
 * The pit-stop readings across modules (#1477): `finishItem`
 * (`src/commands/stretch/item-merge.ts`) driven over the real readings
 * (`src/stretch/pit-readings.ts`), the real recheck judge
 * (`src/commands/bug/recheck-judge.ts`) and the real reference reading,
 * with every outside source planted: `gh` (the recorded runs fake plus a
 * collaborator-permission answer), the tracker, the `runRafa` seam that
 * answers `rafa effort collect`, the effort dashboard and the recheck
 * runner. The ledger is a real file under a temp project root.
 *
 * Case one files two bugs after the cut-off, one with a prose `Rerun` and
 * one whose runnable reference fails, opened by a trusted author, and holds
 * the closing output in order. Case two fails every source; its control is
 * case one, which prints the same readings as figures.
 */
import type { RecheckBugOptions } from '../commands/bug/recheck-run.js';
import type { FinishInput, ItemMergeSeams, MergedPull } from '../commands/stretch/item-merge.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { OpenIssue } from '@open-tomato/rafa/ports';
import type { GhResult, GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';
import type { Dashboard } from '@open-tomato/rafa-effort';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeRunsGh } from '../ci/runs-fake.js';
import { finishItem } from '../commands/stretch/item-merge.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pit-readings-integration-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const STUB = 'rafa-812-pit-readings';
const BRANCH = 'stretch/4';
const MERGE_SHA = 'c4da2c4c63b2e9d585d3a76ffbda1c49e3ce60d1';
const START = Date.parse('2026-10-07T09:00:00.000Z');
const TEST_FILE = 'src/a.test.ts';
const COLLECT_MS = 12_000;
const BUG_PROSE = 901;
const BUG_RUNNABLE = 902;
const NOT_READ_FAILURE = /: 0 open|: none\.|Effort: .*\b0 tasks/;

/** The `Effort:` line the planted dashboard renders for {@link STUB}. */
const EFFORT_LINE = `Effort: ${STUB}: 3 tasks, p50 2.4 min against 5.5 min, max 4.1 min.`;

function plantedDashboard(): Dashboard {
  const planted = {
    trend: { metrics: [{ name: 'minutes', baselineP50: 5.5 }] },
    loops: { rows: [{ key: STUB, kind: 'plan', tasks: 3, perTask: { minutes: { min: null, avg: null, p50: 2.4, max: 4.1 } } }] },
  };
  return planted as unknown as Dashboard;
}

function bugBody(rerun: string, reproduce: string): string {
  return ['## What', '', 'It breaks.', '', '## Reproduce', '', reproduce, '', '## Rerun', '', '```', rerun, '```', ''].join('\n');
}

function filedBug(id: number, rerun: string, reproduce: string, createdAt: string): OpenIssue {
  const ref: OpenIssue['ref'] = { opt: 0, kind: 'github', externalId: String(id), url: `https://example.test/issues/${String(id)}` };
  return { ref, title: `bug ${String(id)}`, body: bugBody(rerun, reproduce), createdAt };
}

const FILED: readonly OpenIssue[] = [
  filedBug(BUG_PROSE, 'open the board and look', 'open the board, then reload', '2026-10-07T09:10:00Z'),
  filedBug(BUG_RUNNABLE, `bun test ${TEST_FILE}`, 'run the file', '2026-10-07T09:15:00Z'),
];

interface Planted {
  readonly output: string[];
  readonly rechecks: RecheckBugOptions[];
  readonly dashboardReads: number[];
  readonly collects: string[][];
  readonly run: () => Promise<void>;
}

/** What a case changes: whether every source fails. */
interface Sources {
  readonly failing: boolean;
}

function plant({ failing }: Sources): Planted {
  const root = realpathSync(mkdtempSync(join(scope, 'case-')));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, TEST_FILE), 'import { test } from "bun:test";\ntest("a case", () => {});\n');

  const output: string[] = [];
  const rechecks: RecheckBugOptions[] = [];
  const dashboardReads: number[] = [];
  const collects: string[][] = [];
  let clock = START;

  const runs = createFakeRunsGh([{
    databaseId: 37190089292,
    workflowName: 'verify',
    headBranch: BRANCH,
    headSha: MERGE_SHA,
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-10-07T09:30:00Z',
  }]);
  const gh: GhRunner = (args) => {
    if (failing) return Promise.reject(new Error('gh: HTTP 502 Bad Gateway'));
    if (args[0] === 'api' && /collaborators\/alice\/permission$/.test(args.join(' '))) {
      const result: GhResult = { ok: true, stdout: JSON.stringify({ permission: 'write', role_name: 'write' }), stderr: '' };
      return Promise.resolve(result);
    }
    return runs.gh(args);
  };

  const seams: ItemMergeSeams = {
    runRafa: (argv) => {
      collects.push([...argv]);
      clock += COLLECT_MS;
      return Promise.resolve(failing
        ? 1
        : 0);
    },
    gh: () => gh,
    tracker: () => ({
      kind: 'github',
      get: () => Promise.reject(new Error('fake tracker: get is not modelled')),
      editable: (ref) => Promise.resolve({ ref, title: '', body: '', open: true, labels: [], author: 'alice' }),
      openIssues: () => (failing
        ? Promise.reject(new Error('tracker: open listing failed'))
        : Promise.resolve([...FILED])),
      filedIssues: (_type, since) => (failing
        ? Promise.reject(new Error('tracker: filed listing failed'))
        : Promise.resolve(FILED.filter((bug) => Date.parse(bug.createdAt ?? '') > since.getTime()).map(({ ref, title, body, createdAt }) => ({ ref, title, body, createdAt: createdAt ?? '' })))),
    }),
    readDashboard: () => {
      dashboardReads.push(1);
      return Promise.resolve(plantedDashboard());
    },
    recheck: (options) => {
      rechecks.push(options);
      return Promise.resolve({ verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 0 });
    },
    git: () => () => ({ ok: false, stdout: '', stderr: 'fake git: not modelled' }),
    sleep: () => Promise.resolve(),
    now: () => new Date(clock),
    rafa: ['rafa'],
  };

  const info = (text: string): void => {
    output.push(text);
  };
  const context = { output: { info, warn: info }, signal: new AbortController().signal } as unknown as RafaContext;
  const item: FinishInput = {
    root,
    n: 4,
    issue: 812,
    stub: STUB,
    since: new Date(START),
    env: { PATH: '/fake/bin' },
    recheckConfig: { bugsRecheckRuns: 2, bugsRecheckTimeoutSeconds: 30, boardTrustedAuthors: [], secrets: [] },
  };
  const merged: MergedPull = {
    number: 901,
    base: BRANCH,
    body: 'Plan for #812.\n\nCloses #812\n',
    state: 'MERGED',
    mergeCommit: MERGE_SHA,
  } as MergedPull;
  return { output, rechecks, dashboardReads, collects, run: () => finishItem(context, item, merged, seams) };
}

/** The index of each of `lines` in `output`, which must hold every one, rising. */
function expectInOrder(output: readonly string[], lines: readonly RegExp[]): void {
  let from = 0;
  for (const pattern of lines) {
    const at = output.findIndex((line, index) => index >= from && pattern.test(line));
    expect(at, `output holds ${String(pattern)} after line ${String(from)}`).toBeGreaterThanOrEqual(from);
    from = at + 1;
  }
}

describe('finishItem, the pit-stop readings', () => {
  it('prints CI, the bugs, the filed bugs, the effort and a recheck per bug, in order', async () => {
    const planted = plant({ failing: false });

    await planted.run();

    expectInOrder(planted.output, [
      /^CI: .*stretch\/4/,
      /^Bugs: 2 open\.$/,
      new RegExp(`^Filed since ${new Date(START).toISOString()
        .replaceAll('.', '\\.')}: 2\\.$`),
      new RegExp(`^ {3}#${String(BUG_PROSE)} bug ${String(BUG_PROSE)}`),
      new RegExp(`^ {3}#${String(BUG_RUNNABLE)} bug ${String(BUG_RUNNABLE)}`),
      new RegExp(`^${EFFORT_LINE.replaceAll('.', '\\.')}$`),
      new RegExp(`^Recheck #${String(BUG_PROSE)}: manual$`),
      /^ {4}open the board, then reload$/,
      new RegExp(`^Recheck #${String(BUG_RUNNABLE)}: reproduces$`),
    ]);
    expect(planted.collects).toEqual([['rafa', 'effort', 'collect']]);
    expect(planted.rechecks.map((call) => call.path)).toEqual([TEST_FILE]);
    expect(planted.output.some((line) => NOT_READ_FAILURE.test(line))).toBe(false);
  });

  it('prints every reading as not read when every source fails, and no failure as zero, none or green', async () => {
    const planted = plant({ failing: true });

    await planted.run();

    const readings = planted.output.filter((line) => /^(CI|Bugs|Filed since|Effort|Recheck)\b/.test(line));
    expect(readings).toHaveLength(5);
    for (const line of readings) expect(line, line).toContain('not read');
    expect(planted.output.some((line) => NOT_READ_FAILURE.test(line))).toBe(false);
    expect(planted.output).toContain('rafa effort collect ended 1 in 12.0s');
    expect(planted.dashboardReads).toEqual([]);
    expect(planted.rechecks).toEqual([]);
  });
});
