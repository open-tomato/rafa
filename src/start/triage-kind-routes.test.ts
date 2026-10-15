/**
 * Tests for the kind routing wired into `loop start`'s triage
 * (`start/triage.ts` with `start/triage-kinds.ts`): what `createStartTriage`
 * hands `triageReport` as its `kinds`, the public tracker it resolves only
 * for a report routing something public, the `bug_routes` row of each
 * entry, and the `Triage:` line of each repair task added.
 *
 * Git is a stub answering by argv and the named test runner a stub
 * answering by commit, so no case spawns anything. Both trackers are
 * real `local` trackers under the case's root, each wrapped in a spy
 * recording every call; the chain resolver is a stub recording each
 * resolution. The tracker file, the store and the issue directories are
 * made under one temporary directory this file makes and removes.
 *
 * Each absence sits beside a control: a confirmed `own-fallout` that
 * resolves no chain beside an unconfirmed one that resolves and files;
 * a repair inserted under a cap of one beside none under `false`; a
 * report routed wholly away from the trackers beside one more `bug`
 * that resolves the chain; kinds left out filing the same entry the
 * kinds route away.
 */
import type { StartKindOptions } from './triage-kinds.js';
import type { StartTriageOptions, TaskTriageInput } from './triage.js';
import type { ResolveTrackerOptions, TrackerResolution } from '../adapters/tracker/resolve.js';
import type { BaseRunAnswer, NamedTest } from '../triage/base-run.js';
import type { GitResult } from '@open-tomato/rafa/core/git';
import type { Tracker } from '@open-tomato/rafa/ports';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { readBugRoutesForPlan } from '@open-tomato/rafa/store/bug-routes';

import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { LEFTOVER_MARKER } from '../triage/leftover-repair.js';
import { createPrivateTriageTracker, privateTriageDir } from '../triage/triage.js';
import { findNextTask } from '../utils/tracker.js';

import { createStartTriage } from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-start-triage-kinds-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

const CLOCK = (): string => '2026-10-14T09:00:00.000Z';

const TRACKER_TEXT = [
  '# Plan: demo',
  '',
  '- [x] Ship the parser',
  '- [x] Wire the loop  {agent=loop-implementer}',
  '- [ ] Write the docs',
  '',
].join('\n');

/** The ticked task the report came from, counting from zero. */
const TASK_LINE = 3;

/** The open plan task after it. */
const NEXT_LINE = 4;

const CONFIG: StartTriageOptions['config'] = {
  trackerDefault: 'github',
  trackerFallback: ['local'],
  prerequisitesRequired: [],
  prerequisitesOptional: [],
  triageSimilarityThreshold: false,
  triageSimilarityCandidates: 3,
};

const BASE = 'base0000000000000000';
const HEAD = 'head0000000000000000';

/** The test an entry names, and the plan's files. */
const TEST_FILE = 'src/a.test.ts';
const TEST_CASE = 'config > reads the file';
const PLAN_FILES = ['src/config.ts', TEST_FILE];

/** Git answering a plan branch whose base is `origin/integration`. */
function planGit(args: readonly string[]): GitResult {
  const answers: Readonly<Record<string, string>> = {
    'rev-parse HEAD': HEAD,
    'merge-base HEAD refs/remotes/origin/integration': BASE,
    [`diff --name-only -z ${BASE} HEAD --`]: `${PLAN_FILES.join('\0')}\0`,
  };
  const stdout = answers[args.join(' ')];
  return stdout === undefined
    ? { ok: false, stdout: '', stderr: 'fatal: unknown' }
    : { ok: true, stdout, stderr: '' };
}

/** A runner stub answering by commit, and the runs it made. */
interface Runner {
  readonly runTest: (commit: string, test: NamedTest) => Promise<BaseRunAnswer>;
  readonly runs: string[];
}

/** A runner answering `answers[commit]`. */
function runner(answers: Readonly<Record<string, 'green' | 'red'>>): Runner {
  const runs: string[] = [];
  return {
    runs,
    runTest: (commit, test) => {
      runs.push(`${commit} ${test.file} > ${test.name}`);
      const answer = answers[commit];
      return Promise.resolve(answer === undefined
        ? { answer: 'unrunnable', problem: `no run at ${commit}` }
        : { answer });
    },
  };
}

/** The plan's own fallout: the named test is green on the base and red on the head. */
const FALLOUT_RUNS = { [BASE]: 'green', [HEAD]: 'red' } as const;

/** One out-of-scope entry of a report: its what, artifact, flag and kind, the kind left out when null. */
interface Entry {
  readonly what: string;
  readonly artifact?: string;
  readonly security?: boolean;
  readonly kind?: string;
}

/** The entry naming {@link TEST_CASE}, said as `kind`. */
function testEntry(kind: string | undefined, security = false): Entry {
  return {
    what: `${TEST_FILE} > ${TEST_CASE} turned red after the parser task`,
    artifact: `${TEST_FILE} > ${TEST_CASE}`,
    security,
    ...kind === undefined
      ? {}
      : { kind },
  };
}

/** An entry's artifact as a YAML scalar. */
function artifactText(entry: Entry): string {
  return entry.artifact === undefined
    ? 'null'
    : JSON.stringify(entry.artifact);
}

/** What a task session prints: a report listing `entries`. */
function sessionOutput(entries: readonly Entry[]): string {
  const lines = entries.flatMap((entry) => [
    `  - what: ${JSON.stringify(entry.what)}`,
    `    artifact: ${artifactText(entry)}`,
    `    security: ${String(entry.security ?? false)}`,
    ...entry.kind === undefined
      ? []
      : [`    kind: ${entry.kind}`],
  ]);
  return [
    'Wired the loop.',
    '',
    '```rafa:report',
    'status: done',
    'feedback: "Wired the loop."',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs:',
    ...lines,
    '```',
    '',
  ].join('\n');
}

/** A tracker recording the method of every call before handing it on. */
function spied(inner: Tracker, calls: string[]): Tracker {
  return {
    ...inner,
    find: (query) => {
      calls.push('find');
      return inner.find(query);
    },
    get: (ref) => {
      calls.push('get');
      return inner.get(ref);
    },
    create: (draft) => {
      calls.push('create');
      return inner.create(draft);
    },
    comment: (ref, body) => {
      calls.push('comment');
      return inner.comment(ref, body);
    },
    transition: (ref, state) => {
      calls.push('transition');
      return inner.transition(ref, state);
    },
  };
}

/** One case's root, tracker file, trackers' calls, resolutions and lines. */
interface Fixture {
  readonly root: string;
  readonly trackerPath: string;
  readonly publicCalls: string[];
  readonly privateCalls: string[];
  readonly resolutions: ResolveTrackerOptions[];
  readonly info: string[];
  readonly warn: string[];
  readonly options: Omit<StartTriageOptions, 'kinds'>;
}

/** A fresh root, its trackers spied, its chain landing on the public one, and the output captured. */
function fixture(): Fixture {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  const trackerPath = join(root, 'PLAN_TRACKER-demo.md');
  writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');
  const publicCalls: string[] = [];
  const privateCalls: string[] = [];
  const resolutions: ResolveTrackerOptions[] = [];
  const publicTracker = spied(createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null, now: CLOCK }), publicCalls);
  const resolve = (options: ResolveTrackerOptions): Promise<TrackerResolution> => {
    resolutions.push(options);
    return Promise.resolve({
      tracker: publicTracker,
      degraded: false,
      fallbackReason: null,
      attempts: [{ kind: 'local', ok: true, reason: null }],
    });
  };
  const info: string[] = [];
  const warn: string[] = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      info.push(message);
    },
    warn: (message) => {
      warn.push(message);
    },
  }));
  return {
    root,
    trackerPath,
    publicCalls,
    privateCalls,
    resolutions,
    info,
    warn,
    options: {
      repoRoot: root,
      config: CONFIG,
      env: {},
      resolve,
      privateTracker: spied(createPrivateTriageTracker(root, { now: CLOCK }), privateCalls),
    },
  };
}

/** The kinds of a run on {@link planGit}, capped at `retries`, running through `run`. */
function kindsOf(run: Runner, retries: StartKindOptions['retries'] = 1): StartKindOptions {
  return { checkout: '/checkout', prBase: 'integration', retries, git: planGit, runTest: run.runTest };
}

/** The ticked task of the fixture, its session having printed `entries`. */
function taskInput(f: Fixture, entries: readonly Entry[], sessionId = 'session-1'): TaskTriageInput {
  return {
    trackerPath: f.trackerPath,
    lineNum: TASK_LINE,
    planStub: 'demo',
    dispatch: { sessionId, taskText: 'Wire the loop', output: sessionOutput(entries) },
    outcome: 'done',
  };
}

/** The stored routes of the plan, as said, kind and route. */
function routesOf(f: Fixture): string[] {
  return readBugRoutesForPlan(f.root, 'demo').map((row) => `${row.entryIndex} ${row.said ?? '-'} ${row.kind} ${row.route}`);
}

/** The issue files under `dir`. */
function issueNames(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.md'))
    : [];
}

/** The `Triage:` lines naming a repair task added. */
function repairLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.includes('Triage: ') && line.includes('a repair task was added'));
}

describe('an own-fallout the check confirms', () => {
  it('adds one repair task above the next plan task, resolves no chain, calls no tracker and prints one line for it', async () => {
    const f = fixture();
    const run = runner(FALLOUT_RUNS);

    const result = await createStartTriage({ ...f.options, kinds: kindsOf(run) })(taskInput(f, [testEntry('own-fallout')]));

    expect(result?.bugs.map((bug) => bug.action)).toEqual(['repair']);
    const lines = readFileSync(f.trackerPath, 'utf8').split('\n');
    expect(lines[NEXT_LINE]).toStartWith('- [BLOCKED] Repair the own-fallout leftover: ');
    expect(lines[NEXT_LINE]).toContain(LEFTOVER_MARKER);
    expect(lines[NEXT_LINE + 1]).toBe('- [ ] Write the docs');
    expect(findNextTask(lines.join('\n'))?.lineNum).toBe(NEXT_LINE);
    expect(f.resolutions).toHaveLength(0);
    expect(f.publicCalls).toEqual([]);
    expect(f.privateCalls).toEqual([]);
    expect(repairLines(f.info)).toEqual([
      `   Triage: out_of_scope_bugs[0]: own-fallout: a repair task was added at tracker line ${NEXT_LINE + 1}, above the next plan task; nothing was filed.`,
    ]);
    expect(f.warn).toEqual([]);
    expect(routesOf(f)).toEqual(['0 own-fallout own-fallout repair']);
  });

  it('runs its test once on the head and once on the base, though the chain\'s check and the triage\'s both read it', async () => {
    const f = fixture();
    const run = runner(FALLOUT_RUNS);

    await createStartTriage({ ...f.options, kinds: kindsOf(run) })(taskInput(f, [testEntry('own-fallout')]));

    expect(run.runs).toEqual([`${HEAD} ${TEST_FILE} > ${TEST_CASE}`, `${BASE} ${TEST_FILE} > ${TEST_CASE}`]);
  });

  it('is held for the follow-up issue under the default cap of false: no task added, no chain, no repair line', async () => {
    const f = fixture();

    await createStartTriage({ ...f.options, kinds: kindsOf(runner(FALLOUT_RUNS), false) })(taskInput(f, [testEntry('own-fallout')]));

    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(f.resolutions).toHaveLength(0);
    expect(f.publicCalls).toEqual([]);
    expect(repairLines(f.info)).toEqual([]);
    expect(f.info).toContain('   Triage: out_of_scope_bugs[0]: own-fallout: held for this plan\'s follow-up issue, past its cap on repair tasks; nothing was filed.');
    expect(routesOf(f)).toEqual(['0 own-fallout own-fallout follow-up']);
  });
});

describe('an entry the check reads as bug', () => {
  it('resolves the chain once and is filed, for an own-fallout claim whose test is green on the head', async () => {
    const f = fixture();

    await createStartTriage({ ...f.options, kinds: kindsOf(runner({ [BASE]: 'green', [HEAD]: 'green' })) })(taskInput(f, [testEntry('own-fallout')]));

    expect(f.resolutions).toHaveLength(1);
    expect(f.publicCalls).toContain('create');
    expect(issueNames(localIssuesDir(f.root))).toHaveLength(1);
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(routesOf(f)).toEqual(['0 own-fallout bug filed']);
  });

  it('is filed as before for a report with no kind key naming no test and no plan file, its said kind stored as none', async () => {
    const f = fixture();
    const run = runner(FALLOUT_RUNS);

    await createStartTriage({ ...f.options, kinds: kindsOf(run) })(taskInput(f, [{ what: 'The board refresh drops the Stage field in src/board/refresh.ts' }]));

    expect(f.resolutions).toHaveLength(1);
    expect(f.publicCalls).toContain('create');
    expect(run.runs).toEqual([]);
    expect(routesOf(f)).toEqual(['0 - bug filed']);
  });
});

describe('a report routing nothing public', () => {
  it('resolves no chain and calls no tracker for a convention, a docs and a machine entry, where one more bug resolves it', async () => {
    const f = fixture();
    const triage = createStartTriage({ ...f.options, kinds: kindsOf(runner(FALLOUT_RUNS)) });
    const away: Entry[] = [
      { what: 'src/start.ts is past the 800-line ceiling', kind: 'convention' },
      { what: 'context/triage.md still names three channels', kind: 'docs' },
      { what: 'this machine has no bun in PATH for a hook', kind: 'machine' },
    ];

    await triage(taskInput(f, away));

    expect(f.resolutions).toHaveLength(0);
    expect(f.publicCalls).toEqual([]);
    expect(f.privateCalls).toEqual([]);
    expect(routesOf(f)).toEqual(['0 convention convention pr-body', '1 docs docs docs', '2 machine machine machine']);
    expect(f.info).toContain('   Triage: out_of_scope_bugs[0]: convention: held for the pull request\'s body; nothing was filed.');
    expect(f.info).toContain('   Triage: out_of_scope_bugs[1]: docs: stored as a stale-doc sighting; nothing was filed.');

    await triage(taskInput(f, [...away, { what: 'The board refresh drops the Stage field', kind: 'bug' }], 'session-2'));

    expect(f.resolutions).toHaveLength(1);
    expect(f.publicCalls).toContain('create');
  });

  it('takes a security own-fallout to the private tracker, running no test and resolving no chain', async () => {
    const f = fixture();
    const run = runner(FALLOUT_RUNS);

    await createStartTriage({ ...f.options, kinds: kindsOf(run) })(taskInput(f, [testEntry('own-fallout', true)]));

    expect(run.runs).toEqual([]);
    expect(f.resolutions).toHaveLength(0);
    expect(f.privateCalls).toContain('create');
    expect(issueNames(privateTriageDir(f.root))).toHaveLength(1);
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(routesOf(f)).toEqual(['0 own-fallout own-fallout private']);
  });
});

describe('kinds left out', () => {
  it('file an own-fallout claim on the public tracker as before kinds existed, adding no task', async () => {
    const f = fixture();

    await createStartTriage(f.options)(taskInput(f, [testEntry('own-fallout')]));

    expect(f.resolutions).toHaveLength(1);
    expect(f.publicCalls).toContain('create');
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(routesOf(f)).toEqual(['0 own-fallout own-fallout filed']);
  });
});

describe('a route write the store refuses', () => {
  it('is one Triage: warning, the entries still routed', async () => {
    const f = fixture();
    const sameId = (): string => 'one-id';

    await createStartTriage({ ...f.options, seams: { newId: sameId }, kinds: kindsOf(runner(FALLOUT_RUNS)) })(taskInput(f, [
      { what: 'src/start.ts is past the 800-line ceiling', kind: 'convention' },
      { what: 'src/start/dispatch.ts is past it too', kind: 'convention' },
    ]));

    expect(f.warn).toHaveLength(1);
    expect(f.warn[0]).toStartWith('   Triage: out_of_scope_bugs: their routes were not stored: ');
    expect(routesOf(f)).toEqual([]);
    expect(f.info.filter((line) => line.includes('held for the pull request'))).toHaveLength(2);
  });
});
