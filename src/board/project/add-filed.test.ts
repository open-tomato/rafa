/**
 * Tests for the add of the bugs rafa files on its own (`add-filed.ts`,
 * `addFiledBugs`), sent through one `GhRunner` that answers the
 * repository read itself and routes every `gh api` call to the strict
 * project fake (`project-fake.ts`), as `add-issue.test.ts` builds it. The
 * refresh is planted: it records which issue it was asked for and
 * answers one line naming it, so the order of the adds and of the lines
 * is read off the answer.
 *
 * ## The controls
 *
 *  - Each bug that sends no call sits beside the same report holding a
 *    filed bug, which sends calls, so sending nothing is the bug's
 *    settling and not a runner never wired.
 *  - The case with no `board.project.number` sits beside the same filed
 *    bug with the number set, which opens the runner and sends calls.
 *
 * ## The real refresh
 *
 * One case leaves the refresh unplanted, so `refreshProjectItems` runs
 * over the project and facts fakes behind one router, as `refresh.test.ts`
 * builds it. The filed bug is read back through the project port: its item
 * is on the project with its Stage set. The same bug settled `commented`
 * sits beside it, after which the project holds no item for it.
 */
import type { AddIssueOptions } from './add-issue.js';
import type { ProjectRefresh, RefreshConfig } from './refresh.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { IssueRef } from '../../ports/index.js';
import type { BugTriage } from '../../triage/triage.js';

import { describe, expect, it } from 'bun:test';

import { addFiledBugs, filedIssueNumber } from './add-filed.js';
import { createFakeFactsGh } from './facts-fake.js';
import { createGhProjectPort } from './gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY, fakeProjectId } from './project-fake.js';

/** The owner of the repository and the project. */
const OWNER = 'open-tomato';

/** The project's number. */
const NUMBER = 6;

/** The issues the triage filed, in the order filed. */
const FIRST = 41;
const SECOND = 42;

/** The config every case reads but the one that unsets the number. */
const CONFIG: RefreshConfig = {
  boardProjectNumber: NUMBER,
  boardProjectRetries: false,
  boardProjectRetryWaitSeconds: 1,
  boardProjectWriteBatchSize: 5,
  boardProjectWritePauseMs: 0,
  boardRelationships: 'labels',
  roadmapIssue: null,
  releaseFragments: '.changes',
};

/** The project's node id, as the fake makes it. */
const PROJECT_ID = fakeProjectId({ owner: OWNER, number: NUMBER });

function answered(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: '' };
}

/** The line the planted refresh answers for `issue`. */
function plantedLine(issue: number): string {
  return `refreshed #${String(issue)}`;
}

/** A GitHub ref of `issue`. */
function githubRef(issue: number): IssueRef {
  return { opt: 0, kind: 'github', externalId: String(issue), url: `https://github.com/o/r/issues/${String(issue)}` };
}

/** A bug settled `action` on `channel` with `ref`. */
function bug(index: number, settled: Pick<BugTriage, 'channel' | 'action' | 'ref'>): BugTriage {
  return { index, ...settled, foundBy: null, stored: null, problem: null };
}

/** A bug filed on the public GitHub tracker as `issue`. */
function filed(index: number, issue: number): BugTriage {
  return bug(index, { channel: 'public', action: 'filed', ref: githubRef(issue) });
}

/** What one {@link addFiledBugs} call sent, asked and answered. */
interface Run {
  readonly lines: readonly string[];
  readonly opened: number;
  readonly calls: readonly (readonly string[])[];
  /** Each issue list the refresh was asked for, in order. */
  readonly refreshed: readonly (readonly number[])[];
  /** The issues the project holds as items once the call has resolved, in the order added. */
  readonly heldAfter: readonly number[];
}

/** Adds the filed bugs among `bugs` over a project holding no item. */
async function addRun(bugs: readonly BugTriage[], config: RefreshConfig = CONFIG): Promise<Run> {
  const project = createFakeProjectGh({
    projects: [{ owner: OWNER, number: NUMBER, items: [] }],
    owners: [OWNER],
    repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues: [FIRST, SECOND] }],
  });
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    if (args.join(' ') === 'repo view --json nameWithOwner') {
      return Promise.resolve(answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    }
    return project.gh(args);
  };
  const refreshed: (readonly number[])[] = [];
  let opened = 0;
  const options: AddIssueOptions = {
    config,
    openGh: () => {
      opened += 1;
      return gh;
    },
    refresh: (_options, issues) => {
      refreshed.push(issues);
      return Promise.resolve<ProjectRefresh>({ kind: 'skipped', reason: 'no-issues', warnings: issues.map(plantedLine) });
    },
  };
  const lines = await addFiledBugs(options, { bugs });
  const sent = [...calls];
  const items = await createGhProjectPort(gh).items(PROJECT_ID);
  const heldAfter = items.flatMap((item) => (item.content.kind === 'issue'
    ? [item.content.number]
    : []));
  return { lines, opened, calls: sent, refreshed, heldAfter };
}

describe('addFiledBugs: the bugs filed on the public GitHub tracker', () => {
  it('adds a filed bug to the project and asks the refresh for its number', async () => {
    const run = await addRun([filed(0, FIRST)]);

    expect(run.heldAfter).toEqual([FIRST]);
    expect(run.refreshed).toEqual([[FIRST]]);
    expect(run.lines).toEqual([plantedLine(FIRST)]);
  });

  it('adds two filed bugs in the order filed and answers both lines in that order', async () => {
    const run = await addRun([filed(0, SECOND), filed(1, FIRST)]);

    expect(run.refreshed).toEqual([[SECOND], [FIRST]]);
    expect(run.heldAfter).toEqual([SECOND, FIRST]);
    expect(run.lines).toEqual([plantedLine(SECOND), plantedLine(FIRST)]);
  });
});

describe('addFiledBugs: bugs not filed on the public GitHub tracker send nothing', () => {
  const localRef: IssueRef = { opt: 0, kind: 'local', externalId: String(FIRST), url: null };
  const unfiled: readonly (readonly [string, BugTriage])[] = [
    ['a commented bug', bug(0, { channel: 'public', action: 'commented', ref: githubRef(FIRST) })],
    ['an inherited bug', bug(0, { channel: 'public', action: 'inherited', ref: githubRef(FIRST) })],
    ['a failed bug', bug(0, { channel: 'public', action: 'failed', ref: null })],
    ['a security bug', bug(0, { channel: 'private', action: 'filed', ref: localRef })],
    ['a bug filed on a local ref', bug(0, { channel: 'public', action: 'filed', ref: localRef })],
  ];

  for (const [name, settled] of unfiled) {
    it(`sends no call and answers no line for ${name}`, async () => {
      const run = await addRun([settled]);

      expect([run.lines, run.calls, run.refreshed]).toEqual([[], [], []]);
      expect(run.heldAfter).toEqual([]);
    });

    it(`control: the same report with a filed bug beside ${name} adds the filed bug alone`, async () => {
      const run = await addRun([settled, filed(1, SECOND)]);

      expect(run.calls.length).toBeGreaterThan(0);
      expect(run.refreshed).toEqual([[SECOND]]);
      expect(run.heldAfter).toEqual([SECOND]);
    });
  }
});

describe('addFiledBugs: nothing without board.project.number', () => {
  it('opens no runner and answers no line with the number unset', async () => {
    const run = await addRun([filed(0, FIRST)], { ...CONFIG, boardProjectNumber: null });

    expect([run.lines, run.opened, run.calls, run.refreshed]).toEqual([[], 0, [], []]);
    expect(run.heldAfter).toEqual([]);
  });

  it('control: the same filed bug with the number set opens the runner and sends calls', async () => {
    const run = await addRun([filed(0, FIRST)]);

    expect(run.opened).toBe(1);
    expect(run.calls.length).toBeGreaterThan(0);
  });
});

/** The state of the project after {@link addFiledBugs} ran the real refresh. */
interface RealRun {
  readonly lines: readonly string[];
  /** The Stage each issue's item holds, by issue number. */
  readonly stages: Readonly<Record<number, string | null>>;
}

/** Adds `bugs` with the real refresh over the project and facts fakes behind one router. */
async function realRun(bugs: readonly BugTriage[]): Promise<RealRun> {
  const project = createFakeProjectGh({
    projects: [{ owner: OWNER, number: NUMBER, items: [] }],
    owners: [OWNER],
    repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues: [FIRST] }],
  });
  const facts = createFakeFactsGh({
    issues: [
      { number: 1, state: 'OPEN', labels: ['type:roadmap'] },
      { number: FIRST, state: 'OPEN', labels: ['type:spec', 'spec:ready'] },
    ],
    pulls: [],
    trees: {},
  });
  const listing = [{
    number: FIRST,
    title: `#${String(FIRST)}`,
    body: '',
    state: 'OPEN',
    stateReason: '',
    labels: [{ name: 'type:spec' }, { name: 'spec:ready' }],
  }];
  const roadmap = {
    number: 1,
    title: 'Roadmap',
    body: `- [ ] #${String(FIRST)} filed\n`,
    state: 'OPEN',
    stateReason: '',
    labels: [{ name: 'type:roadmap' }],
  };
  const gh: GhRunner = (args) => {
    const line = args.join(' ');
    if (line === 'repo view --json nameWithOwner') return Promise.resolve(answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    if (line.startsWith('issue list --label type:roadmap --state open')) return Promise.resolve(answered([roadmap]));
    if (line.startsWith('issue list --state all')) return Promise.resolve(answered([roadmap, ...listing]));
    if (args[0] === 'api' && args.includes('owner={owner}')) return facts.gh(args);
    if (args[0] === 'api') return project.gh(args);
    return Promise.resolve({ ok: false, stdout: '', stderr: `test gh: unrouted command: gh ${line}\n` });
  };
  const options: AddIssueOptions = { config: CONFIG, openGh: () => gh, sleep: () => Promise.resolve() };
  const lines = await addFiledBugs(options, { bugs });
  const port = createGhProjectPort(gh);
  const found = await port.find({ owner: OWNER, number: NUMBER });
  const read = await port.items(found?.id ?? '');
  const stages = Object.fromEntries(read.flatMap(({ content, values }) => {
    if (content.kind !== 'issue') return [];
    const stage = values.get('Stage');
    return [[content.number, stage?.kind === 'option'
      ? stage.name
      : null] as const];
  }));
  return { lines, stages };
}

describe('addFiledBugs: over the real refresh', () => {
  it('puts a filed bug on the project with its Stage set', async () => {
    const run = await realRun([filed(0, FIRST)]);

    expect(run.lines).toEqual([]);
    expect(run.stages).toEqual({ [FIRST]: 'Ready' });
  });

  it('control: the same bug settled commented leaves the project with no item for it', async () => {
    const run = await realRun([bug(0, { channel: 'public', action: 'commented', ref: githubRef(FIRST) })]);

    expect(run.lines).toEqual([]);
    expect(run.stages).toEqual({});
  });
});

describe('filedIssueNumber', () => {
  it('reads the issue number off a filed public GitHub ref', () => {
    expect(filedIssueNumber(filed(0, FIRST))).toBe(FIRST);
  });

  it('passes over a ref whose externalId is not a positive integer', () => {
    const ids = ['0', '-3', '4.5', '07', 'abc', ''];

    expect(ids.map((externalId) => filedIssueNumber(bug(0, {
      channel: 'public',
      action: 'filed',
      ref: { ...githubRef(FIRST), externalId },
    })))).toEqual(ids.map(() => null));
  });
});
