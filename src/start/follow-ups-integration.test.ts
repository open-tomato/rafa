/**
 * Integration test: the plan's leftovers from the triage to the two
 * places a wrap-up writes them, over a real `local` tracker in a temp
 * directory with the run's retry cap at zero.
 *
 * The triage is `createStartTriage` with the kind routing on, over a
 * real temporary git repository and a real `bun test` run on the plan's
 * base, as `triage-kinds-integration.test.ts` runs it. The repository
 * holds two commits: `origin/main`'s tip with two green test files, then
 * the first task's commit, which turns both red. A report naming each of
 * them reads `own-fallout` twice, and with the cap at zero each entry is
 * held as a `follow-up` row of the store, never a repair task.
 *
 * A wrap-up here is the pair of calls `runWrapUp` makes: `fileFollowUps`
 * over the run's real tracker chain (`resolveTracker`, `local` first),
 * then `writeConventionLines` against a pull request fake that keeps the
 * body an edit wrote, so a later wrap-up reads it back.
 *
 * Three behaviors are proved, each beside the control that shows it is
 * not an accident of the fixture:
 *
 *   - two `own-fallout` leftovers make exactly one issue holding two
 *     lines, beside a plan with a single leftover that makes one issue
 *     of one line, and the triage called `create` on no tracker;
 *   - a second wrap-up adds no duplicate line, no `create` and no
 *     `edit`, while a third leftover reported between the two is added
 *     below the two lines the issue holds;
 *   - a `convention` entry reaches the pull request body and no
 *     tracker's `create`, the issue directory holding one file only.
 */
import type { StartTriageOptions, TaskTriageInput } from './triage.js';
import type { ResolveTrackerOptions, TrackerResolution } from '../adapters/tracker/resolve.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { IssueDraft, Tracker } from '@open-tomato/rafa/ports';

import '../adapter-registry.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { resolveTracker } from '../adapters/tracker/resolve.js';
import { ISSUES_DEFAULTS } from '../config-schema-issues.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { detail, PROVIDER_GH, SUMMARY } from '../tests/release-stage-fixtures.js';
import { createBaseRunCache, runNamedTestAt } from '../triage/base-run.js';
import { createPrivateTriageTracker } from '../triage/triage.js';

import { CONVENTIONS_HEADING, writeConventionLines } from './convention-body.js';
import { fileFollowUps, followUpsMarker, followUpsTitle } from './follow-ups.js';
import { createStartTriage } from './triage.js';

/** Each case that runs a test runs `bun test` in a worktree, so it is given room. */
const RUN_TIMEOUT_MS = 60_000;

const CLOCK = (): string => '2026-10-14T09:00:00.000Z';
const PLAN_STUB = 'demo';
const TASK = 'Rework the value';
const BRANCH = 'rafa-1077-demo';

/** The retry cap of the run: no repair task is ever added. */
const NO_RETRIES = false;

/** The plan's tracker file: one task, ticked, its report just stored. */
const TRACKER_TEXT = ['# Plan: demo', '', `- [x] ${TASK}  {agent=loop-implementer}`, ''].join('\n');
const TASK_LINE = 2;

/** The tests the first task's commit turns red, each holding one case. */
const FALLOUT_A = { file: 'src/fallout-a.test.ts', suite: 'fallout a', name: 'holds the value' } as const;
const FALLOUT_B = { file: 'src/fallout-b.test.ts', suite: 'fallout b', name: 'keeps the value' } as const;
const FALLOUT_C = { file: 'src/fallout-c.test.ts', suite: 'fallout c', name: 'still holds' } as const;
const FALLOUTS = [FALLOUT_A, FALLOUT_B, FALLOUT_C] as const;

const CONFIG: StartTriageOptions['config'] = {
  trackerDefault: 'local',
  trackerFallback: [],
  prerequisitesRequired: [],
  prerequisitesOptional: [],
  triageSimilarityThreshold: false,
  triageSimilarityCandidates: 3,
  ...ISSUES_DEFAULTS,
  errorsCodes: [],
};

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-follow-ups-int-')));
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

/** A test file over `src/value.ts` holding one case. */
function testFile(suite: string, name: string): string {
  return 'import { describe, expect, it } from \'bun:test\';\n\nimport { value } from \'./value.js\';\n\n'
    + `describe('${suite}', () => {\n  it('${name}', () => {\n    expect(value).toBe(1);\n  });\n});\n`;
}

beforeAll(() => {
  mkdirSync(repo);
  const git = createGitRunner(repo);
  must(createGitRunner(scope), ['init', '--quiet', '--initial-branch=main', repo]);
  must(git, ['config', 'user.name', 'follow-ups']);
  must(git, ['config', 'user.email', 'follow-ups@example.invalid']);
  must(git, ['config', 'commit.gpgsign', 'false']);
  // The worktree of a run links this folder in; the tests need nothing from it.
  mkdirSync(join(repo, 'node_modules'));
  put('src/value.ts', 'export const value = 1;\n');
  for (const fallout of FALLOUTS) put(fallout.file, testFile(fallout.suite, fallout.name));
  must(git, ['add', '-A']);
  must(git, ['commit', '--quiet', '-m', 'base']);
  must(git, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  put('src/value.ts', 'export const value = 2;\n');
  must(git, ['add', '-A']);
  must(git, ['commit', '--quiet', '-m', TASK]);
});

/** One out-of-scope entry the session reports, always public. */
interface Entry {
  readonly what: string;
  readonly artifact: string | null;
  readonly kind: string;
}

/** The entry of an `own-fallout` leftover naming a test the first task turned red. */
function falloutEntry(fallout: (typeof FALLOUTS)[number]): Entry {
  const test = `${fallout.file} > ${fallout.suite} > ${fallout.name}`;
  return { what: `${test} turned red after ${TASK}`, artifact: test, kind: 'own-fallout' };
}

/** The entry of a `convention` the session noticed. */
const CONVENTION_ENTRY: Entry = {
  what: 'src/start.ts is 917 lines, over the 800-line ceiling',
  artifact: null,
  kind: 'convention',
};

/** What a task's session prints: a report listing `entries`. */
function sessionOutput(entries: readonly Entry[]): string {
  const lines = entries.flatMap((entry) => [
    `  - what: ${JSON.stringify(entry.what)}`,
    `    artifact: ${JSON.stringify(entry.artifact)}`,
    '    security: false',
    `    kind: ${entry.kind}`,
  ]);
  return [
    `${TASK}.`,
    '',
    '```rafa:report',
    'status: done',
    `feedback: "${TASK}."`,
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs:',
    ...lines,
    '```',
    '',
  ].join('\n');
}

/** What a recording tracker was asked to write. */
interface Writes {
  readonly created: IssueDraft[];
  readonly edited: string[];
}

/** One case: its root, the plan's tracker file, what the trackers were handed and the pull request body. */
interface Fixture {
  readonly root: string;
  readonly trackerPath: string;
  /** What the triage's tracker, a real `local` one, was handed. */
  readonly triaged: Writes;
  /** What the wrap-ups' tracker, from the real chain, was handed. */
  readonly wrapped: Writes;
  readonly options: Omit<StartTriageOptions, 'kinds'>;
  /** Every body the pull request fake was edited to. */
  readonly bodies: string[];
  readonly pulls: ReturnType<typeof createPullRequestsDouble>;
  sessions: number;
}

/** A `local` tracker over `root` whose `create` and `edit` are recorded in `writes`. */
function recording(inner: Tracker, writes: Writes): Tracker {
  return {
    ...inner,
    create: (draft) => {
      writes.created.push(draft);
      return inner.create(draft);
    },
    ...inner.edit === undefined
      ? {}
      : {
        edit: (ref, change) => {
          writes.edited.push(change.body ?? '');
          return inner.edit!(ref, change);
        },
      },
  };
}

/** A fresh root holding the plan, with the pull request fake open on an empty-sectioned body. */
function fixture(): Fixture {
  const root = join(scope, `root-${caseCount}`);
  caseCount += 1;
  mkdirSync(root, { recursive: true });
  const trackerPath = join(root, 'PLAN_TRACKER-demo.md');
  writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');
  const triaged: Writes = { created: [], edited: [] };
  const triageTracker = recording(
    createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null, now: CLOCK }),
    triaged,
  );
  const resolve = (): Promise<TrackerResolution> => Promise.resolve({
    tracker: triageTracker,
    degraded: false,
    fallbackReason: null,
    attempts: [{ kind: 'local', ok: true, reason: null }],
  });
  setActiveOutput(sinkOutput({}));
  let body = 'Closes #1077\n\nThe plan.\n';
  const bodies: string[] = [];
  const pulls = createPullRequestsDouble({
    findOpen: () => Promise.resolve(SUMMARY),
    get: () => Promise.resolve(detail(body)),
    editBody: (_number, next) => {
      body = next;
      bodies.push(next);
      return Promise.resolve();
    },
  });
  return {
    root,
    trackerPath,
    triaged,
    wrapped: { created: [], edited: [] },
    options: {
      repoRoot: root,
      config: CONFIG,
      env: {},
      resolve,
      privateTracker: createPrivateTriageTracker(root, { now: CLOCK }),
    },
    bodies,
    pulls,
    sessions: 0,
  };
}

/** The run's kind options over the real repository, with the retry cap at zero. */
function realKinds(): NonNullable<StartTriageOptions['kinds']> {
  const cache = createBaseRunCache();
  const env = { ...process.env, PATH: `${dirname(Bun.which('bun') ?? '')}${delimiter}${process.env.PATH ?? ''}` };
  return {
    checkout: repo,
    prBase: 'main',
    retries: NO_RETRIES,
    runTest: (commit, test) => runNamedTestAt(commit, test, { checkout: repo, cache, env }),
  };
}

/** Reports `entries` as the output of a new session of the task, and triages it. */
async function report(f: Fixture, entries: readonly Entry[]): Promise<readonly string[]> {
  f.sessions += 1;
  const input: TaskTriageInput = {
    trackerPath: f.trackerPath,
    lineNum: TASK_LINE,
    planStub: PLAN_STUB,
    dispatch: { sessionId: `session-${String(f.sessions)}`, taskText: TASK, output: sessionOutput(entries) },
    outcome: 'done',
  };
  const result = await createStartTriage({ ...f.options, kinds: realKinds() })(input);
  return result?.bugs.map((bug) => bug.action) ?? [];
}

/** One wrap-up, as `runWrapUp` makes it: the follow-ups, then the conventions into the pull request. */
async function wrapUp(f: Fixture): Promise<void> {
  const settings = CONFIG;
  const resolve = async (options: ResolveTrackerOptions): Promise<TrackerResolution> => {
    const resolution = await resolveTracker(options);
    return { ...resolution, tracker: recording(resolution.tracker, f.wrapped) };
  };
  await fileFollowUps(
    { repoRoot: f.root, checkout: f.root, settings, planStub: PLAN_STUB },
    { resolve, env: {} },
  );
  await writeConventionLines(
    { repoRoot: f.root, checkout: f.root, branch: BRANCH, settings, planStub: PLAN_STUB },
    { pulls: () => f.pulls.pulls, readProvider: () => PROVIDER_GH, env: {} },
  );
}

/** The open `bug` issues of the fixture's own `local` directory, read afresh. */
async function openBugs(f: Fixture): ReturnType<NonNullable<Tracker['openIssues']>> {
  const local = createLocalTracker({ issuesDir: localIssuesDir(f.root), fallbackReason: null, now: CLOCK });
  return await local.openIssues!('bug');
}

/** The issue files of the fixture's issue directory, none when it was never made. */
function issueFiles(f: Fixture): string[] {
  const dir = localIssuesDir(f.root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.md'));
}

/** The lines of `body` that open a list item. */
function listLines(body: string): string[] {
  return body.split('\n').filter((line) => line.startsWith('- '));
}

describe('two own-fallout leftovers with the retry cap at zero', () => {
  it('make exactly one issue holding two lines, and the triage creates none', async () => {
    // Arrange
    const f = fixture();
    const actions = await report(f, [falloutEntry(FALLOUT_A), falloutEntry(FALLOUT_B)]);
    expect(actions).toEqual(['follow-up', 'follow-up']);

    // Act
    await wrapUp(f);

    // Assert
    expect(f.triaged.created).toEqual([]);
    expect(f.wrapped.created).toHaveLength(1);
    const issues = await openBugs(f);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.title).toBe(followUpsTitle(PLAN_STUB));
    expect(issue.body).toContain(followUpsMarker(PLAN_STUB));
    expect(listLines(issue.body)).toEqual([
      `- own-fallout: ${falloutEntry(FALLOUT_A).what}`,
      `- own-fallout: ${falloutEntry(FALLOUT_B).what}`,
    ]);
    expect(issueFiles(f)).toHaveLength(1);
  }, RUN_TIMEOUT_MS);

  it('make one issue of one line for a plan with a single leftover', async () => {
    // Arrange
    const f = fixture();
    await report(f, [falloutEntry(FALLOUT_A)]);

    // Act
    await wrapUp(f);

    // Assert
    const issues = await openBugs(f);
    expect(issues).toHaveLength(1);
    expect(listLines(issues[0]!.body)).toEqual([`- own-fallout: ${falloutEntry(FALLOUT_A).what}`]);
  }, RUN_TIMEOUT_MS);

  it('leave the plan\'s tracker file without a repair task', async () => {
    // Arrange
    const f = fixture();

    // Act
    await report(f, [falloutEntry(FALLOUT_A), falloutEntry(FALLOUT_B)]);

    // Assert
    expect(await Bun.file(f.trackerPath).text()).toBe(TRACKER_TEXT);
    expect(readBugRoutesForPlan(f.root, PLAN_STUB).map((row) => row.route)).toEqual(['follow-up', 'follow-up']);
  }, RUN_TIMEOUT_MS);
});

describe('a second wrap-up of the same plan', () => {
  it('adds no duplicate line, and neither creates nor edits', async () => {
    // Arrange
    const f = fixture();
    await report(f, [falloutEntry(FALLOUT_A), falloutEntry(FALLOUT_B)]);
    await wrapUp(f);
    const before = (await openBugs(f))[0]!.body;

    // Act
    await wrapUp(f);

    // Assert
    expect(f.wrapped.created).toHaveLength(1);
    expect(f.wrapped.edited).toEqual([]);
    const issues = await openBugs(f);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.body).toBe(before);
    expect(listLines(issues[0]!.body)).toHaveLength(2);
    expect(issueFiles(f)).toHaveLength(1);
  }, RUN_TIMEOUT_MS);

  it('adds only the line a later session reported, below the two the issue holds', async () => {
    // Arrange
    const f = fixture();
    await report(f, [falloutEntry(FALLOUT_A), falloutEntry(FALLOUT_B)]);
    await wrapUp(f);
    await report(f, [falloutEntry(FALLOUT_C)]);

    // Act
    await wrapUp(f);

    // Assert
    expect(f.wrapped.created).toHaveLength(1);
    expect(f.wrapped.edited).toHaveLength(1);
    const issues = await openBugs(f);
    expect(issues).toHaveLength(1);
    expect(listLines(issues[0]!.body)).toEqual([
      `- own-fallout: ${falloutEntry(FALLOUT_A).what}`,
      `- own-fallout: ${falloutEntry(FALLOUT_B).what}`,
      `- own-fallout: ${falloutEntry(FALLOUT_C).what}`,
    ]);
  }, RUN_TIMEOUT_MS);
});

describe('a convention entry', () => {
  it('reaches the pull request body and no tracker\'s create', async () => {
    // Arrange
    const f = fixture();
    const actions = await report(f, [CONVENTION_ENTRY]);
    expect(actions).toEqual(['pr-body']);

    // Act
    await wrapUp(f);

    // Assert
    expect(f.bodies).toEqual([
      `Closes #1077\n\nThe plan.\n\n${CONVENTIONS_HEADING}\n\n- ${CONVENTION_ENTRY.what}\n`,
    ]);
    expect(f.triaged.created).toEqual([]);
    expect(f.wrapped.created).toEqual([]);
    expect(issueFiles(f)).toEqual([]);
  });

  it('is written once, a second wrap-up leaving the body alone', async () => {
    // Arrange
    const f = fixture();
    await report(f, [CONVENTION_ENTRY]);
    await wrapUp(f);

    // Act
    await wrapUp(f);

    // Assert
    expect(f.bodies).toHaveLength(1);
  });

  it('beside two own-fallout leftovers, takes the body while they take the one issue', async () => {
    // Arrange
    const f = fixture();
    await report(f, [falloutEntry(FALLOUT_A), CONVENTION_ENTRY, falloutEntry(FALLOUT_B)]);

    // Act
    await wrapUp(f);

    // Assert
    expect(f.triaged.created).toEqual([]);
    expect(f.wrapped.created).toHaveLength(1);
    expect(issueFiles(f)).toHaveLength(1);
    const issue = (await openBugs(f))[0]!;
    expect(listLines(issue.body)).toHaveLength(2);
    expect(issue.body).not.toContain(CONVENTION_ENTRY.what);
    expect(f.bodies).toHaveLength(1);
    expect(f.bodies[0]).toContain(`- ${CONVENTION_ENTRY.what}`);
    expect(f.bodies[0]).not.toContain('own-fallout');
  }, RUN_TIMEOUT_MS);
});
