/**
 * Integration test: `createStartTriage` with the kind routing on, over a
 * fixture plan of two tasks and a real temporary git repository, run the
 * way `start()` runs it once the first task's session has reported.
 *
 * The repository holds two commits. The first is `origin/main`'s tip,
 * holding `src/value.ts` and two test files, both green; the second, the
 * first task's commit on `HEAD`, edits `src/value.ts` alone, which turns
 * `src/fallout.test.ts` red. The check therefore reads the real plan
 * base, the real plan files and a real `bun test` run in a detached
 * worktree: git and bun are not stubbed anywhere in this file.
 *
 * Each case makes its own root for the tracker file, the store and the
 * issue directories, so the cases share only the repository, which the
 * triage never writes to. The public tracker is a real `local` tracker
 * wrapped to record each `create` it is handed; the chain resolver is a
 * stub counting resolutions.
 *
 * Three behaviors are proved, each beside the control that shows it is
 * not an accident of the fixture:
 *
 *   - an entry naming the test the first task turned red adds one repair
 *     task above the second task, and no tracker's `create` is called;
 *   - an entry naming a file outside the plan's commits, with no test, is
 *     filed once;
 *   - a report with no `kind` key is filed exactly as the same report is
 *     with the kind routing left out, draft for draft.
 */
import type { StartKindOptions } from './triage-kinds.js';
import type { StartTriageOptions, TaskTriageInput } from './triage.js';
import type { ResolveTrackerOptions, TrackerResolution } from '../adapters/tracker/resolve.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { IssueDraft, Tracker } from '@open-tomato/rafa/ports';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import { createGitRunner } from '@open-tomato/rafa/core/git';
import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { readBugRoutesForPlan } from '@open-tomato/rafa/store/bug-routes';

import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';
import { ISSUES_DEFAULTS } from '../config-schema-issues.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { createBaseRunCache, runNamedTestAt } from '../triage/base-run.js';
import { LEFTOVER_MARKER } from '../triage/leftover-repair.js';
import { createPrivateTriageTracker } from '../triage/triage.js';
import { findNextTask } from '../utils/tracker.js';

import { createStartTriage } from './triage.js';

/** Each case that runs a test runs `bun test` in a worktree, so it is given room. */
const RUN_TIMEOUT_MS = 60_000;

const CLOCK = (): string => '2026-10-14T09:00:00.000Z';
const PLAN_STUB = 'demo';
const FIRST_TASK = 'Rework the value';

/** The test the first task's commit turns red, and the case it holds. */
const FALLOUT_TEST = 'src/fallout.test.ts';
const FALLOUT_CASE = 'fallout > holds the value';

/** A file the plan's commits never touched. */
const UNTOUCHED_FILE = 'src/untouched.ts';

/** The plan: two tasks, the first ticked, its report just stored. */
const TRACKER_TEXT = [
  '# Plan: demo',
  '',
  `- [x] ${FIRST_TASK}  {agent=loop-implementer}`,
  '- [ ] Write the docs',
  '',
].join('\n');

/** The first task's line, and the open second task's, counting from zero. */
const FIRST_LINE = 2;
const SECOND_LINE = 3;

const CONFIG: StartTriageOptions['config'] = {
  trackerDefault: 'local',
  trackerFallback: [],
  prerequisitesRequired: [],
  prerequisitesOptional: [],
  triageSimilarityThreshold: false,
  triageSimilarityCandidates: 3,
  triageSimilarityWeightsCauseLeaf: 0.15,
  triageSimilarityWeightsCauseFamily: 0.05,
  triageSimilarityWeightsBoundary: 0.1,
  ...ISSUES_DEFAULTS,
  errorsCodes: [],
};

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-start-triage-kinds-int-')));
const repo = join(scope, 'repo');
let caseCount = 0;

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(runner: GitRunner, args: readonly string[]): string {
  const result = runner(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Writes `text` to `path` under the repository. */
function put(path: string, text: string): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** A test file holding one case, `describe` > `it`, whose body is `body`. */
function testFile(imports: string, describeName: string, caseName: string, body: string): string {
  return `${imports}import { describe, expect, it } from 'bun:test';\n\n`
    + `describe('${describeName}', () => {\n  it('${caseName}', () => {\n    ${body}\n  });\n});\n`;
}

beforeAll(() => {
  mkdirSync(repo);
  const git = createGitRunner(repo);
  must(createGitRunner(scope), ['init', '--quiet', '--initial-branch=main', repo]);
  must(git, ['config', 'user.name', 'triage-kinds']);
  must(git, ['config', 'user.email', 'triage-kinds@example.invalid']);
  must(git, ['config', 'commit.gpgsign', 'false']);
  // The worktree of a run links this folder in; the tests need nothing from it.
  mkdirSync(join(repo, 'node_modules'));
  put('src/value.ts', 'export const value = 1;\n');
  put(UNTOUCHED_FILE, 'export const untouched = 1;\n');
  put(FALLOUT_TEST, testFile('import { value } from \'./value.js\';\n', 'fallout', 'holds the value', 'expect(value).toBe(1);'));
  must(git, ['add', '-A']);
  must(git, ['commit', '--quiet', '-m', 'base']);
  must(git, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  put('src/value.ts', 'export const value = 2;\n');
  must(git, ['add', '-A']);
  must(git, ['commit', '--quiet', '-m', FIRST_TASK]);
});

/** One out-of-scope entry of a report; `kind` is left out of the report when undefined. */
interface Entry {
  readonly what: string;
  readonly artifact?: string;
  readonly kind?: string;
}

/** What the first task's session prints: a report listing `entries`, all public. */
function sessionOutput(entries: readonly Entry[]): string {
  const lines = entries.flatMap((entry) => [
    `  - what: ${JSON.stringify(entry.what)}`,
    `    artifact: ${entry.artifact === undefined
      ? 'null'
      : JSON.stringify(entry.artifact)}`,
    '    security: false',
    ...entry.kind === undefined
      ? []
      : [`    kind: ${entry.kind}`],
  ]);
  return [
    `${FIRST_TASK}.`,
    '',
    '```rafa:report',
    'status: done',
    `feedback: "${FIRST_TASK}."`,
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs:',
    ...lines,
    '```',
    '',
  ].join('\n');
}

/** One case: its root, tracker file, the drafts `create` was handed, resolutions and lines. */
interface Fixture {
  readonly root: string;
  readonly trackerPath: string;
  readonly created: IssueDraft[];
  readonly resolutions: ResolveTrackerOptions[];
  readonly info: string[];
  readonly options: Omit<StartTriageOptions, 'kinds'>;
}

/** A fresh root holding the plan, a `local` tracker recording its `create` calls, and the output captured. */
function fixture(): Fixture {
  const root = join(scope, `root-${caseCount}`);
  caseCount += 1;
  mkdirSync(root, { recursive: true });
  const trackerPath = join(root, 'PLAN_TRACKER-demo.md');
  writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');
  const created: IssueDraft[] = [];
  const inner = createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null, now: CLOCK });
  const tracker: Tracker = {
    ...inner,
    create: (draft) => {
      created.push(draft);
      return inner.create(draft);
    },
  };
  const resolutions: ResolveTrackerOptions[] = [];
  const resolve = (options: ResolveTrackerOptions): Promise<TrackerResolution> => {
    resolutions.push(options);
    return Promise.resolve({
      tracker,
      degraded: false,
      fallbackReason: null,
      attempts: [{ kind: 'local', ok: true, reason: null }],
    });
  };
  const info: string[] = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      info.push(message);
    },
  }));
  return {
    root,
    trackerPath,
    created,
    resolutions,
    info,
    options: {
      repoRoot: root,
      config: CONFIG,
      env: {},
      resolve,
      privateTracker: createPrivateTriageTracker(root, { now: CLOCK }),
    },
  };
}

/** The run's kind options over the real repository, `bun` on the worktree run's PATH, a cap of one repair. */
function realKinds(): StartKindOptions {
  const cache = createBaseRunCache();
  const env = { ...process.env, PATH: `${dirname(Bun.which('bun') ?? '')}${delimiter}${process.env.PATH ?? ''}` };
  return {
    checkout: repo,
    prBase: 'main',
    retries: 1,
    runTest: (commit, test) => runNamedTestAt(commit, test, { checkout: repo, cache, env }),
  };
}

/** The first task, just reported, whose session printed `entries`. */
function firstTask(f: Fixture, entries: readonly Entry[]): TaskTriageInput {
  return {
    trackerPath: f.trackerPath,
    lineNum: FIRST_LINE,
    planStub: PLAN_STUB,
    dispatch: { sessionId: 'session-1', taskText: FIRST_TASK, output: sessionOutput(entries) },
    outcome: 'done',
  };
}

/** The stored routes of the plan, as the kind said, the kind routed and the route. */
function routesOf(f: Fixture): string[] {
  return readBugRoutesForPlan(f.root, PLAN_STUB).map((row) => `${row.entryIndex} ${row.said ?? '-'} ${row.kind} ${row.route}`);
}

describe('an entry naming the test the first task turned red', () => {
  const falloutEntry: Entry = {
    what: `${FALLOUT_TEST} > ${FALLOUT_CASE} turned red after ${FIRST_TASK}`,
    artifact: `${FALLOUT_TEST} > ${FALLOUT_CASE}`,
    kind: 'bug',
  };

  it('adds one repair task above the second task and calls create on no tracker', async () => {
    // Arrange
    const f = fixture();
    const triage = createStartTriage({ ...f.options, kinds: realKinds() });

    // Act
    const result = await triage(firstTask(f, [falloutEntry]));

    // Assert
    expect(result?.bugs.map((bug) => bug.action)).toEqual(['repair']);
    const lines = readFileSync(f.trackerPath, 'utf8').split('\n');
    expect(lines).toHaveLength(TRACKER_TEXT.split('\n').length + 1);
    expect(lines.slice(0, SECOND_LINE)).toEqual(TRACKER_TEXT.split('\n').slice(0, SECOND_LINE));
    expect(lines[SECOND_LINE]).toContain(LEFTOVER_MARKER);
    expect(lines[SECOND_LINE]).toContain('own-fallout');
    expect(lines[SECOND_LINE + 1]).toBe('- [ ] Write the docs');
    expect(findNextTask(lines.join('\n'))?.lineNum).toBe(SECOND_LINE);
    expect(f.created).toEqual([]);
    expect(f.resolutions).toEqual([]);
    expect(routesOf(f)).toEqual(['0 bug own-fallout repair']);
  }, RUN_TIMEOUT_MS);

  it('adds no repair task when the cap is zero, holding the entry for the follow-up issue', async () => {
    // Arrange
    const f = fixture();
    const triage = createStartTriage({ ...f.options, kinds: { ...realKinds(), retries: false } });

    // Act
    const result = await triage(firstTask(f, [falloutEntry]));

    // Assert
    expect(result?.bugs.map((bug) => bug.action)).toEqual(['follow-up']);
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(f.created).toEqual([]);
    expect(routesOf(f)).toEqual(['0 bug own-fallout follow-up']);
  }, RUN_TIMEOUT_MS);
});

describe('an entry naming a file outside the plan\'s commits and no test', () => {
  it('is filed once, the plan holding no repair task for it', async () => {
    // Arrange
    const f = fixture();
    const triage = createStartTriage({ ...f.options, kinds: realKinds() });

    // Act
    const result = await triage(firstTask(f, [{
      what: `${UNTOUCHED_FILE} keeps a stale constant`,
      kind: 'own-gap',
    }]));

    // Assert
    expect(result?.bugs.map((bug) => bug.action)).toEqual(['filed']);
    expect(f.created).toHaveLength(1);
    expect(f.created[0]?.title).toContain(UNTOUCHED_FILE);
    expect(f.resolutions).toHaveLength(1);
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(routesOf(f)).toEqual(['0 own-gap bug filed']);
  });
});

describe('a report with no kind key', () => {
  const plain: Entry = { what: 'The board refresh drops the Stage field' };

  it('is filed exactly as the same report is with the kind routing left out', async () => {
    // Arrange: each fixture captures the active output, so the second is made after the first has run.
    const without = fixture();

    // Act
    await createStartTriage(without.options)(firstTask(without, [plain]));
    const withKinds = fixture();
    await createStartTriage({ ...withKinds.options, kinds: realKinds() })(firstTask(withKinds, [plain]));

    // Assert
    expect(withKinds.created).toHaveLength(1);
    expect(withKinds.created).toEqual(without.created);
    expect(withKinds.resolutions).toHaveLength(1);
    expect(readFileSync(withKinds.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(withKinds.info).toEqual(without.info.map((line) => line.replaceAll(without.root, withKinds.root)));
    expect(routesOf(withKinds)).toEqual(['0 - bug filed']);
  });
});
