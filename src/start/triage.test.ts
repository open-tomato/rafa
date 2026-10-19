/**
 * Tests for the triage `loop start` runs after each task's stored report
 * (`start/triage.ts`).
 *
 * Every repo root, tracker file, store and issue directory is made under
 * one temporary directory this file creates and removes; no case writes
 * under the repository or the home, and no case spawns anything. The
 * public tracker is a real `local` tracker under the case's root, handed
 * over by a stubbed chain resolver that records each call, and the
 * private one a real `local` tracker over the root's private triage
 * directory; each is wrapped in a spy recording every call. One case
 * resolves through the real `resolveTracker` over a config naming `local`
 * alone, so it spawns no `gh` either.
 *
 * A filed body is read back off its issue file, a stored reference off
 * the `findings` table through `bun:sqlite`, a blocker text off the
 * tracker file through `findNextTask`, and the operator's lines through a
 * sink output set for the case and unset after it.
 *
 * Each absence sits beside a control that the same reading can see the
 * thing: a report that resolves no chain beside a later one that resolves
 * it, a redacted body or line beside the same bug with no secret named, a
 * tracker file left as it was beside a blocker text written, a failing
 * tracker beside the same bug filed and stored, and a tracker gaining no
 * task beside the same text planted raw, which becomes one.
 *
 * Thirty-five mutations of `triage.ts` were driven against this file alone
 * on 2026-09-15, each an exact string found once, on a baseline of 15 pass
 * taken twice and green after, the module restored sha256-identical after
 * each. Every one reddened a case. Fail counts: 11 for the public-bug test
 * inverted; 10 each for the chain never used and the line prefix dropped;
 * 6 for the blocker problem dropped; 4 each for warnings at info and the
 * failed wording; 3 each for the env seam ignored, the line off by one, the
 * private tracker dropped, the passed-over filter inverted, the stand-in's
 * reason lost and a store problem dropped; 2 each for the chain resolved
 * per report, notes not printed, a rejection escaping the catch, a refusal
 * rethrown, the context from the working directory, a skip unmatched and
 * the found-by fixed; 1 for each of the other sixteen.
 *
 * Four more were driven on 2026-10-14, when `stale_docs` entries joined
 * the triage, on a baseline of 20 pass, the module restored
 * sha256-identical after each: `hasTriage` blind to the entries and the
 * entries resolving the chain (2 red each), the entries' notes dropped
 * and the notes printed as warnings (3 red each).
 *
 * `start()` handing each stored report to the triage it made is reached by
 * no case here, since `start()` spawns the CLI with no seam. It was read the
 * same day by spawning `loop start` twice in a scratch repository on a
 * `local` tracker, under a stand-in `claude` on a PATH with no `gh`: one
 * public issue filed then commented on, one private issue, the finding under
 * the bug's artifact kept whole, and the blocker text on the blocked line
 * and in its next prompt, with no prompt opening on the bug's `- [ ]` text.
 * Three mutations of `src/start.ts`, restored sha256-identical, each changed
 * its reading: the call dropped, the triage run before the store (the
 * finding's trigger and what lost), and the task line off by one.
 *
 * {@link CONFIG} leaves `board.project.number` unset, so no case above the
 * project's own sends a project call. Those cases set it, and route every
 * `gh` call through one runner that answers the repository read itself
 * and hands the rest to the project fake (`board/project/project-fake.ts`)
 * and the facts fake (`board/project/facts-fake.ts`), as
 * `board/project/add-filed.test.ts` builds it, so the real refresh fills
 * the added item and no case reaches `gh`. Their public tracker is a
 * `local` one spied as kind `github`, whose `create` answers a GitHub ref
 * to an issue the fake repository holds. A refused add is read beside the
 * same report with the number unset, whose tracker file and stored
 * reference it matches.
 *
 * One report listing a filed bug, a recurring one commented on, a security
 * bug and one with no `what` is read through a planted refresh that records
 * each issue list it is asked for, beside the same report without the filed
 * bug, which adds nothing; two filed bugs numbered out of order show the
 * adds follow the report's order. A report with the number unset records no
 * `gh` call and prints no line beside the same report with it set, and a
 * `json` output holds each warning of the add as a `warn` log event after
 * the filed notes.
 */
import type {
  StartTriage,
  StartTriageOptions,
  TaskTriageInput,
} from './triage.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { ResolveTrackerOptions, TrackerAttempt, TrackerResolution } from '../adapters/tracker/resolve.js';
import type { RefreshAddedItems } from '../board/project/add-issue.js';
import type { ProjectRefresh } from '../board/project/refresh.js';
import type { TriageOptions, TriageResult } from '../triage/triage.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { CliEventLog, IssueRef, Tracker } from '@open-tomato/rafa/ports';
import type { FindingOutcome } from '@open-tomato/rafa/store/findings';

import '../adapter-registry.js';

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

import { Database } from 'bun:sqlite';
import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { RAFA_VERSION } from '@open-tomato/rafa/core/command';
import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sqliteStorePath } from '@open-tomato/rafa/store/sqlite';

import { createJsonOutput } from '../adapters/output/json.js';
import { draftFixture } from '../adapters/tracker/contract.js';
import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';
import { createFakeFactsGh } from '../board/project/facts-fake.js';
import { createGhProjectPort } from '../board/project/gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY } from '../board/project/project-fake.js';
import { scopeWarning } from '../board/project/refresh-warnings.js';
import { bugRulesOf, ISSUES_DEFAULTS } from '../config-schema-issues.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { bugKeyOf, createPrivateTriageTracker, privateTriageDir, triageReport } from '../triage/triage.js';
import { findNextTask, updateTrackerLine } from '../utils/tracker.js';

import {
  createStartTriage,
  describeStartTriage,
  NOT_RESOLVED_REASON,
  unresolvedTracker,
} from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-start-triage-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** The clock every tracker stamps with. */
const CLOCK = (): string => '2026-09-15T09:00:00.000Z';

const TRACKER_TEXT = [
  '# Plan: demo',
  '',
  '- [x] Ship the parser',
  '- [BLOCKED] Wire the loop  {agent=loop-implementer}',
  '- [ ] Write the docs',
  '',
].join('\n');

/** The blocked task line of {@link TRACKER_TEXT}, counting from zero. */
const TASK_LINE = 3;

/** Its open task line, the one after it. */
const NEXT_LINE = 4;

/** The sentence the dispatch quoted for the blocked task. */
const TASK_TEXT = 'Wire the loop';

const FEEDBACK = 'Wired the loop; the hook refused the commit.';

const CONFIG: StartTriageOptions['config'] = {
  trackerDefault: 'github',
  trackerFallback: ['local'],
  prerequisitesRequired: [],
  prerequisitesOptional: [],
  triageSimilarityThreshold: 0.3,
  triageSimilarityCandidates: 3,
  triageSimilarityWeightsCauseLeaf: 0.15,
  triageSimilarityWeightsCauseFamily: 0.05,
  triageSimilarityWeightsBoundary: 0.1,
  ...ISSUES_DEFAULTS,
  errorsCodes: [],
  boardProjectNumber: null,
  boardProjectRetries: false,
  boardProjectRetryWaitSeconds: 1,
  boardProjectWriteBatchSize: 5,
  boardProjectWritePauseMs: 0,
  boardRelationships: 'labels',
  roadmapIssue: null,
  releaseFragments: '.changes',
};

/** One out-of-scope bug as a report lists it: its what, its artifact and its flag. */
type BugEntry = readonly [what: string, artifact: string | null, security: boolean | null];

/** One `stale_docs` entry as a report lists it: where the stale line is, and what no longer matches. */
type StaleDocEntry = readonly [where: string | null, what: string];

/** The lists a session's report holds. */
interface ReportParts {
  readonly feedback?: string;
  readonly blockers?: readonly string[];
  readonly bugs?: readonly BugEntry[];
  /** Left out, the report has no `stale_docs` key at all, as a session on an older prompt writes it. */
  readonly staleDocs?: readonly StaleDocEntry[];
}

/** The `stale_docs` lines of a report: none for no list, `[]` for an empty one. */
function staleDocLines(entries: readonly StaleDocEntry[] | undefined): string[] {
  if (entries === undefined) return [];
  if (entries.length === 0) return ['stale_docs: []'];
  return [
    'stale_docs:',
    ...entries.flatMap(([where, what]) => [`  - where: ${scalar(where)}`, `    what: ${scalar(what)}`]),
  ];
}

/** A YAML scalar: a double-quoted string, or the bare word for anything else. */
function scalar(value: string | boolean | null): string {
  return typeof value === 'string'
    ? JSON.stringify(value)
    : String(value);
}

/** What a task session prints: a line of its own, then its report. */
function sessionOutput(parts: ReportParts = {}): string {
  const blockers = parts.blockers ?? [];
  const bugs = parts.bugs ?? [];
  const blockerLines = blockers.length === 0
    ? ['blockers: []']
    : ['blockers:', ...blockers.map((what) => `  - what: ${scalar(what)}`)];
  const bugLines = bugs.length === 0
    ? ['out_of_scope_bugs: []']
    : [
      'out_of_scope_bugs:',
      ...bugs.flatMap(([what, artifact, security]) => [
        `  - what: ${scalar(what)}`,
        `    artifact: ${scalar(artifact)}`,
        `    security: ${scalar(security)}`,
      ]),
    ];
  return [
    'Wired the loop.',
    '',
    '```rafa:report',
    'status: blocked',
    `feedback: ${scalar(parts.feedback ?? FEEDBACK)}`,
    'findings: []',
    'skills_used: []',
    ...blockerLines,
    ...bugLines,
    ...staleDocLines(parts.staleDocs),
    '```',
    '',
  ].join('\n');
}

/** One call a spied tracker received. */
type TrackerCall = readonly [method: string, argument: unknown];

/** A tracker that records every call before handing it on. */
interface Spied {
  readonly tracker: Tracker;
  readonly calls: TrackerCall[];
}

/** Wraps `inner`, its kind or its `create` replaced by `overrides`. */
function spy(inner: Tracker, overrides: Partial<Pick<Tracker, 'kind' | 'create'>> = {}): Spied {
  const calls: TrackerCall[] = [];
  const create = overrides.create ?? inner.create;
  const tracker: Tracker = {
    kind: overrides.kind ?? inner.kind,
    capabilities: inner.capabilities,
    preflight: inner.preflight,
    find: (query) => {
      calls.push(['find', query]);
      return inner.find(query);
    },
    get: (ref) => {
      calls.push(['get', ref]);
      return inner.get(ref);
    },
    create: (draft) => {
      calls.push(['create', draft]);
      return create(draft);
    },
    comment: (ref, body) => {
      calls.push(['comment', { ref, body }]);
      return inner.comment(ref, body);
    },
    transition: (ref, state) => {
      calls.push(['transition', { ref, state }]);
      return inner.transition(ref, state);
    },
  };
  return { tracker, calls };
}

/** The method of every call, in order. */
function methodsOf(spied: Spied): string[] {
  return spied.calls.map(([method]) => method);
}

/** The lines the active output was handed, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
}

/** Sets a sink output as the active output, answering the lines it takes. */
function captureLines(): Lines {
  const lines: Lines = { info: [], warn: [], error: [] };
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.info.push(message);
    },
    warn: (message) => {
      lines.warn.push(message);
    },
    error: (message) => {
      lines.error.push(message);
    },
  }));
  return lines;
}

/** One case's root, tracker file and spied trackers. */
interface Fixture {
  readonly root: string;
  readonly trackerPath: string;
  readonly publicDir: string;
  readonly privateDir: string;
  readonly publicSpy: Spied;
  readonly privateSpy: Spied;
}

/** A fresh root under the temporary directory, its public tracker's `create` replaced by `overrides`. */
function fixture(overrides: Partial<Pick<Tracker, 'create'>> = {}): Fixture {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  const trackerPath = join(root, 'PLAN_TRACKER-demo.md');
  writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');
  const publicDir = localIssuesDir(root);
  return {
    root,
    trackerPath,
    publicDir,
    privateDir: privateTriageDir(root),
    publicSpy: spy(createLocalTracker({ issuesDir: publicDir, fallbackReason: null, now: CLOCK }), overrides),
    privateSpy: spy(createPrivateTriageTracker(root, { now: CLOCK })),
  };
}

/** A chain resolver stub, and every call it received. */
interface ChainStub {
  readonly resolve: (options: ResolveTrackerOptions) => Promise<TrackerResolution>;
  readonly calls: ResolveTrackerOptions[];
}

/** A chain that lands on `tracker`, having passed over each of `passedOver`. */
function chainLanding(tracker: Tracker, passedOver: readonly string[] = []): ChainStub {
  const calls: ResolveTrackerOptions[] = [];
  const attempts: TrackerAttempt[] = [
    ...passedOver.map((kind) => ({ kind, ok: false, reason: `${kind} is unavailable` })),
    { kind: tracker.kind, ok: true, reason: null },
  ];
  return {
    calls,
    resolve: (options) => {
      calls.push(options);
      return Promise.resolve({ tracker, degraded: passedOver.length > 0, fallbackReason: null, attempts });
    },
  };
}

/** A chain that lands nowhere, rejecting with `message`. */
function chainRefusing(message: string): ChainStub {
  const calls: ResolveTrackerOptions[] = [];
  return {
    calls,
    resolve: (options) => {
      calls.push(options);
      return Promise.reject(new Error(message));
    },
  };
}

/** The run's triage over the fixture, the chain stubbed and no secret named unless `extra` says so. */
function triageFor(f: Fixture, chain: ChainStub, extra: Partial<StartTriageOptions> = {}): StartTriage {
  return createStartTriage({
    repoRoot: f.root,
    config: CONFIG,
    env: {},
    resolve: chain.resolve,
    privateTracker: f.privateSpy.tracker,
    ...extra,
  });
}

/** The blocked task of the fixture, dispatched under `sessionId`, with `output` and `outcome`. */
function taskInput(f: Fixture, output: string, sessionId = 'session-1', outcome: FindingOutcome = 'blocked'): TaskTriageInput {
  return {
    trackerPath: f.trackerPath,
    lineNum: TASK_LINE,
    planStub: 'demo',
    dispatch: { sessionId, taskText: TASK_TEXT, output },
    outcome,
  };
}

/** Every issue file under `dir`, lowest number first, as its bytes. */
function issueFiles(dir: string): { readonly name: string; readonly contents: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => ({ name, contents: readFileSync(join(dir, name), 'utf8') }));
}

/** The names of the issue files under `dir`. */
function issueNames(dir: string): string[] {
  return issueFiles(dir).map(({ name }) => name);
}

/** A findings row holding a reference, as the table holds it. */
interface RefRow {
  readonly session_id: string;
  readonly plan_stub: string | null;
  readonly task_line: string;
  readonly artifact: string;
  readonly outcome: string;
  readonly tracker_ref: string;
}

/** Every findings row holding a reference, oldest first; none without a store. */
function refRows(root: string): RefRow[] {
  const path = sqliteStorePath(root);
  if (!existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<RefRow, []>(
        'SELECT session_id, plan_stub, task_line, artifact, outcome, tracker_ref FROM findings'
          + ' WHERE tracker_ref IS NOT NULL ORDER BY seq',
      )
      .all();
  } finally {
    db.close();
  }
}

/** Every open, ticked or blocked task line of a tracker text. */
function taskLines(text: string): string[] {
  return text.split('\n').filter((line) => /^- \[( |x|BLOCKED)\] /.test(line));
}

describe('the tracker chain of a run', () => {
  it('is resolved once, for the first report with a public bug, and a later report files through the tracker it landed on', async () => {
    const lines = captureLines();
    const f = fixture();
    const chain = chainLanding(f.publicSpy.tracker, ['github']);
    const triage = triageFor(f, chain);

    const first = await triage(taskInput(f, sessionOutput({ bugs: [['The parser drops a line', 'ERR_ONE', false]] })));
    const second = await triage(taskInput(f, sessionOutput({ bugs: [['The store leaks a handle', 'ERR_TWO', false]] }), 'session-2'));

    expect(chain.calls).toEqual([{ config: CONFIG, context: { repoRoot: f.root } }]);
    expect(first?.bugs.map((bug) => bug.action)).toEqual(['filed']);
    expect(second?.bugs.map((bug) => bug.action)).toEqual(['filed']);
    expect(methodsOf(f.publicSpy)).toEqual(['find', 'create', 'find', 'create']);
    expect(issueNames(f.publicDir)).toEqual(['1.md', '2.md']);
    expect(lines.info.filter((line) => line.includes('of this run'))).toEqual([
      '   Triage: public bugs of this run go to the `local` tracker, having passed over `github`.',
    ]);

    // A second run resolves again, and its recurrence comments on the first run's issue.
    const nextRun = triageFor(f, chain);
    const recurrence = await nextRun(taskInput(f, sessionOutput({ bugs: [['The parser drops a line', 'ERR_ONE', false]] }), 'session-3'));

    expect(chain.calls).toHaveLength(2);
    expect(recurrence?.bugs.map((bug) => [bug.action, bug.foundBy])).toEqual([['commented', 'store']]);
    expect(issueNames(f.publicDir)).toEqual(['1.md', '2.md']);
  });

  it('is not resolved for a report whose bugs all go to the private tracker or have no what, where a later public bug resolves it', async () => {
    const lines = captureLines();
    const f = fixture();
    const chain = chainLanding(f.publicSpy.tracker);
    const triage = triageFor(f, chain);

    const privateOnly = await triage(taskInput(f, sessionOutput({
      bugs: [
        ['A token reaches the log', 'Bearer t0k', true],
        ['A path escapes the root', '../../etc/passwd', null],
        ['   ', 'BLANK', false],
      ],
    })));

    expect(chain.calls).toEqual([]);
    expect(f.publicSpy.calls).toEqual([]);
    expect(privateOnly?.bugs.map((bug) => [bug.channel, bug.action])).toEqual([
      ['private', 'filed'],
      ['private', 'filed'],
      ['public', 'skipped'],
    ]);
    expect(methodsOf(f.privateSpy)).toEqual(['find', 'create', 'find', 'create']);
    expect(issueNames(f.privateDir)).toEqual(['1.md', '2.md']);
    expect(lines.warn).toEqual(['   Triage: out_of_scope_bugs[2] has no what to file; nothing was filed.']);

    await triage(taskInput(f, sessionOutput({ bugs: [['The parser drops a line', 'ERR_ONE', false]] }), 'session-2'));

    expect(chain.calls).toHaveLength(1);
    expect(methodsOf(f.publicSpy)).toEqual(['find', 'create']);
  });

  it('lands nowhere once per run: one warning, each public bug failing on its refusal, the blocker and the security bug still written', async () => {
    const lines = captureLines();
    const f = fixture();
    const refusal = 'tracker chain: no tracker available; tried github: gh not found; local: EACCES';
    const chain = chainRefusing(refusal);
    const triage = triageFor(f, chain);

    const first = await triage(taskInput(f, sessionOutput({
      blockers: ['The hook refused the commit'],
      bugs: [['The parser drops a line', 'ERR_ONE', false], ['A token reaches the log', 'Bearer t0k', true]],
    })));
    const second = await triage(taskInput(f, sessionOutput({ bugs: [['The store leaks a handle', 'ERR_TWO', false]] }), 'session-2'));

    expect(chain.calls).toHaveLength(1);
    expect(first?.blocker.written).toBe(true);
    expect(findNextTask(readFileSync(f.trackerPath, 'utf8'))?.blocker).toBe('The hook refused the commit');
    expect(first?.bugs.map((bug) => [bug.channel, bug.action])).toEqual([['public', 'failed'], ['private', 'filed']]);
    expect(second?.bugs.map((bug) => [bug.channel, bug.action])).toEqual([['public', 'failed']]);
    expect(issueNames(f.privateDir)).toEqual(['1.md']);
    expect(issueNames(f.publicDir)).toEqual([]);
    expect(lines.warn).toEqual([
      `   Triage: no tracker resolved, so no public bug of this run is filed: ${refusal}`,
      `   Triage: out_of_scope_bugs[0]: not filed on the public tracker: the public tracker find failed: ${refusal}`,
      `   Triage: out_of_scope_bugs[0]: not filed on the public tracker: the public tracker find failed: ${refusal}`,
    ]);
  });

  it('resolves through the core registry when no resolver is handed in, a config naming local filing under the root', async () => {
    const lines = captureLines();
    const f = fixture();
    const triage = createStartTriage({
      repoRoot: f.root,
      config: { ...CONFIG, trackerDefault: 'local', trackerFallback: [] },
      env: {},
    });

    const result = await triage(taskInput(f, sessionOutput({
      bugs: [['The parser drops a line', 'ERR_ONE', false], ['A token reaches the log', 'Bearer t0k', true]],
    })));

    expect(result?.bugs.map((bug) => [bug.channel, bug.action])).toEqual([['public', 'filed'], ['private', 'filed']]);
    expect(issueNames(localIssuesDir(f.root))).toEqual(['1.md']);
    expect(issueNames(privateTriageDir(f.root))).toEqual(['1.md']);
    expect(lines.info).toContain('   Triage: public bugs of this run go to the `local` tracker.');
  });
});

describe('an output with nothing to triage', () => {
  it('resolves, writes and prints nothing for no report or an empty one, where a blocker alone is written with no chain resolved', async () => {
    const lines = captureLines();
    const f = fixture();
    const chain = chainLanding(f.publicSpy.tracker);
    const triage = triageFor(f, chain);

    expect(await triage(taskInput(f, 'The session printed no report.'))).toBeNull();
    expect(await triage(taskInput(f, sessionOutput()))).toBeNull();
    expect(await triage(taskInput(f, sessionOutput({ staleDocs: [] })))).toBeNull();
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(existsSync(sqliteStorePath(f.root))).toBe(false);
    expect(lines).toEqual({ info: [], warn: [], error: [] });

    const blocked = await triage(taskInput(f, sessionOutput({ blockers: ['LINEAR_API_KEY is unset'] })));

    expect(blocked?.blocker).toEqual({ text: 'LINEAR_API_KEY is unset', written: true, problem: null });
    expect(findNextTask(readFileSync(f.trackerPath, 'utf8'))?.blocker).toBe('LINEAR_API_KEY is unset');
    expect(chain.calls).toEqual([]);
    expect(f.privateSpy.calls).toEqual([]);
    expect(lines.info).toEqual(['   Triage: blockers: written onto the task line, for the next dispatch of this task.']);
  });
});

describe('a report\'s stale_docs entries', () => {
  const STALE: readonly StaleDocEntry[] = [
    ['context/triage.md:12', 'says three channels, the code has four'],
    [null, 'the README names a flag the CLI dropped'],
  ];
  const STALE_NOTES = [
    '   Triage: stale_docs[0] is stale documentation at context/triage.md:12: says three channels, the code has four;'
      + ' stored as a stale-doc row, and nothing was filed.',
    '   Triage: stale_docs[1] is stale documentation: the README names a flag the CLI dropped;'
      + ' stored as a stale-doc row, and nothing was filed.',
  ];

  it('alone are triaged with no chain resolved and no tracker called, where a later report with a public bug resolves it', async () => {
    const lines = captureLines();
    const f = fixture();
    const chain = chainLanding(f.publicSpy.tracker);
    const triage = triageFor(f, chain);

    const result = await triage(taskInput(f, sessionOutput({ staleDocs: STALE })));

    expect(result?.staleDocs.map(({ index, channel, action }) => [index, channel, action])).toEqual([
      [0, 'docs', 'skipped'],
      [1, 'docs', 'skipped'],
    ]);
    expect(result?.bugs).toEqual([]);
    expect(chain.calls).toEqual([]);
    expect(f.publicSpy.calls).toEqual([]);
    expect(f.privateSpy.calls).toEqual([]);
    expect(issueNames(f.publicDir)).toEqual([]);
    expect(issueNames(f.privateDir)).toEqual([]);
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(lines).toEqual({ info: STALE_NOTES, warn: [], error: [] });

    await triage(taskInput(f, sessionOutput({ bugs: [['The parser drops a field', 'parse.ts: field dropped', false]], staleDocs: STALE }), 'session-2'));

    expect(chain.calls).toHaveLength(1);
    expect(methodsOf(f.publicSpy)).toContain('create');
    expect(issueNames(f.publicDir)).toEqual(['1.md']);
    expect(lines.info.slice(-2)).toEqual(STALE_NOTES);
    expect(lines.warn).toEqual([]);
  });

  it('are noted with each named secret redacted, where none named leaves it in', async () => {
    const leaky = sessionOutput({ staleDocs: [['docs/deploy.md', 'still shows the token dpl-7f3a9c']] });
    const redactedLines = captureLines();
    const redacted = fixture();
    await triageFor(redacted, chainLanding(redacted.publicSpy.tracker), {
      config: { ...CONFIG, prerequisitesRequired: [{ kind: 'env', name: 'DEPLOY_TOKEN', probe: null }] },
      env: { DEPLOY_TOKEN: 'dpl-7f3a9c' },
    })(taskInput(redacted, leaky));
    const plainLines = captureLines();
    const plain = fixture();
    await triageFor(plain, chainLanding(plain.publicSpy.tracker))(taskInput(plain, leaky));

    expect(redactedLines.info).toEqual([
      '   Triage: stale_docs[0] is stale documentation at docs/deploy.md: still shows the token [redacted: DEPLOY_TOKEN];'
        + ' stored as a stale-doc row, and nothing was filed.',
    ]);
    expect(plainLines.info).toEqual([
      '   Triage: stale_docs[0] is stale documentation at docs/deploy.md: still shows the token dpl-7f3a9c;'
        + ' stored as a stale-doc row, and nothing was filed.',
    ]);
  });
});

describe('what a public bug is filed with', () => {
  it('carries the plan stub, the task text and the feedback, and its reference is stored under the dispatch a later report comments through', async () => {
    const lines = captureLines();
    const f = fixture();
    const triage = triageFor(f, chainLanding(f.publicSpy.tracker));

    await triage(taskInput(f, sessionOutput({ bugs: [['The parser drops a line', 'ERR_ONE', false]] })));

    const [issue] = issueFiles(f.publicDir);
    expect(issue?.contents).toContain('## Plan\n\n```\ndemo\n```');
    expect(issue?.contents).toContain(`## Task\n\n\`\`\`\n${TASK_TEXT}\n\`\`\``);
    expect(issue?.contents).toContain(`## Feedback\n\n\`\`\`\n${FEEDBACK}\n\`\`\``);
    const rows = refRows(f.root);
    expect(rows.map((row) => [row.session_id, row.plan_stub, row.task_line, row.artifact, row.outcome])).toEqual([
      ['session-1', 'demo', TASK_TEXT, bugKeyOf(f.trackerPath, 'ERR_ONE'), 'blocked'],
    ]);
    expect(JSON.parse(rows[0]!.tracker_ref)).toMatchObject({ kind: 'local', externalId: '1' });
    expect(lines.info).toEqual([
      '   Triage: public bugs of this run go to the `local` tracker.',
      '   Triage: out_of_scope_bugs[0]: filed on the public tracker as local issue 1.',
    ]);

    const later = await triage(taskInput(f, sessionOutput({ bugs: [['The parser drops a line again', 'ERR_ONE', false]] }), 'session-2', 'done'));

    expect(later?.bugs.map((bug) => [bug.action, bug.foundBy])).toEqual([['commented', 'store']]);
    expect(issueNames(f.publicDir)).toEqual(['1.md']);
    expect(issueFiles(f.publicDir)[0]?.contents.split('Reported again by a rafa task session.')).toHaveLength(2);
    expect(lines.info.at(-1)).toBe(
      '   Triage: out_of_scope_bugs[0]: recurs in local issue 1 on the public tracker, found by its stored reference; commented on it.',
    );
  });
});

describe('the named secrets', () => {
  const secretConfig: StartTriageOptions['config'] = {
    ...CONFIG,
    prerequisitesRequired: [{ kind: 'env', name: 'DEPLOY_TOKEN', probe: null }],
  };
  const leaky = sessionOutput({
    feedback: 'Deploy failed with dpl-7f3a9c after auth ghp_live_123456 was rejected.',
    bugs: [['Deploy fails with dpl-7f3a9c', 'auth ghp_live_123456 rejected', false]],
  });

  it('are absent from the filed issue, read back off its file, where the same bug filed with none named holds them', async () => {
    captureLines();
    const redacted = fixture();
    await triageFor(redacted, chainLanding(redacted.publicSpy.tracker), {
      config: secretConfig,
      env: { DEPLOY_TOKEN: 'dpl-7f3a9c', GITHUB_TOKEN: 'ghp_live_123456' },
    })(taskInput(redacted, leaky));
    const plain = fixture();
    await triageFor(plain, chainLanding(plain.publicSpy.tracker))(taskInput(plain, leaky));

    const [filed] = issueFiles(redacted.publicDir);
    expect(filed?.contents).not.toContain('dpl-7f3a9c');
    expect(filed?.contents).not.toContain('ghp_live_123456');
    expect(filed?.contents).toContain('[redacted: DEPLOY_TOKEN]');
    expect(filed?.contents).toContain('[redacted: GITHUB_TOKEN]');
    const [control] = issueFiles(plain.publicDir);
    expect(control?.contents).toContain('dpl-7f3a9c');
    expect(control?.contents).toContain('ghp_live_123456');
  });

  it('are read from the process environment when no environment is handed in', async () => {
    captureLines();
    const name = 'RAFA_START_TRIAGE_PROBE_SECRET';
    const value = 'probe-secret-51c2';
    const config: StartTriageOptions['config'] = {
      ...CONFIG,
      prerequisitesOptional: [{ kind: 'env', name, probe: null, reason: null }],
    };
    const output = sessionOutput({ bugs: [[`The probe leaks ${value}`, null, false]] });

    process.env[name] = value;
    try {
      const fromProcess = fixture();
      await createStartTriage({
        repoRoot: fromProcess.root,
        config,
        resolve: chainLanding(fromProcess.publicSpy.tracker).resolve,
      })(taskInput(fromProcess, output));
      const handedEmpty = fixture();
      await createStartTriage({
        repoRoot: handedEmpty.root,
        config,
        env: {},
        resolve: chainLanding(handedEmpty.publicSpy.tracker).resolve,
      })(taskInput(handedEmpty, output));

      expect(issueFiles(fromProcess.publicDir)[0]?.contents).not.toContain(value);
      expect(issueFiles(fromProcess.publicDir)[0]?.contents).toContain(`[redacted: ${name}]`);
      expect(issueFiles(handedEmpty.publicDir)[0]?.contents).toContain(value);
    } finally {
      Reflect.deleteProperty(process.env, name);
    }
  });
});

describe('a triage failure', () => {
  it('is a warning: a tracker that rejects leaves the tracker file as it was and stores no reference, and the triage resolves', async () => {
    const lines = captureLines();
    const f = fixture({ create: () => Promise.reject(new Error('HTTP 502 from the tracker')) });
    const triage = triageFor(f, chainLanding(f.publicSpy.tracker));

    const result = await triage(taskInput(f, sessionOutput({ bugs: [['The parser drops a line', 'ERR_ONE', false]] })));

    expect(result?.bugs.map((bug) => bug.action)).toEqual(['failed']);
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(refRows(f.root)).toEqual([]);
    expect(issueNames(f.publicDir)).toEqual([]);
    expect(lines.warn).toEqual([
      '   Triage: out_of_scope_bugs[0]: not filed on the public tracker: the public tracker create failed: HTTP 502 from the tracker',
    ]);
  });

  it('is a warning for a private tracker triage refuses, which writes nothing, where a local one writes the same report', async () => {
    const lines = captureLines();
    const report = sessionOutput({
      blockers: ['The hook refused the commit'],
      bugs: [['A token reaches the log', 'Bearer t0k', true]],
    });
    const refused = fixture();
    const githubKind = spy(createPrivateTriageTracker(refused.root, { now: CLOCK }), { kind: 'github' });

    const result = await triageFor(refused, chainLanding(refused.publicSpy.tracker), {
      privateTracker: githubKind.tracker,
    })(taskInput(refused, report));

    expect(result).toBeNull();
    expect(readFileSync(refused.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(githubKind.calls).toEqual([]);
    expect(issueNames(refused.privateDir)).toEqual([]);
    expect(lines.warn).toEqual([
      '   Triage: nothing more was triaged for this task: triage: refused a private tracker of kind "github";'
        + ' security bugs are filed to a local tracker only, and nothing was triaged',
    ]);

    const accepted = fixture();
    const written = await triageFor(accepted, chainLanding(accepted.publicSpy.tracker))(taskInput(accepted, report));

    expect(written?.blocker.written).toBe(true);
    expect(issueNames(accepted.privateDir)).toEqual(['1.md']);
  });

  it('is warned about with each named secret redacted, where none named leaves it in', async () => {
    const token = 'ghp_live_123456';
    const warnBoth = async (env: Readonly<Record<string, string>>): Promise<void> => {
      const f = fixture();
      await triageFor(f, chainRefusing(`gh: token ${token} is invalid`), { env })(
        taskInput(f, sessionOutput({ bugs: [['The parser drops a line', 'ERR_ONE', false]] })),
      );
      const tokenKind = spy(createPrivateTriageTracker(f.root, { now: CLOCK }), { kind: token });
      await triageFor(f, chainLanding(f.publicSpy.tracker), { env, privateTracker: tokenKind.tracker })(
        taskInput(f, sessionOutput({ bugs: [['A token reaches the log', 'Bearer t0k', true]] }), 'session-2'),
      );
    };

    const redacted = captureLines();
    await warnBoth({ GITHUB_TOKEN: token });
    const plain = captureLines();
    await warnBoth({});

    expect(redacted.warn).toEqual([
      '   Triage: no tracker resolved, so no public bug of this run is filed: gh: token [redacted: GITHUB_TOKEN] is invalid',
      '   Triage: out_of_scope_bugs[0]: not filed on the public tracker: the public tracker find failed:'
        + ' gh: token [redacted: GITHUB_TOKEN] is invalid',
      '   Triage: nothing more was triaged for this task: triage: refused a private tracker of kind'
        + ' "[redacted: GITHUB_TOKEN]"; security bugs are filed to a local tracker only, and nothing was triaged',
    ]);
    expect(plain.warn).toHaveLength(3);
    expect(plain.warn.filter((line) => line.includes(token))).toHaveLength(3);
  });
});

describe('an out-of-scope bug', () => {
  it('never becomes a task: the tracker gains no task line, and once the task is ticked the next one is the plan task after it', async () => {
    captureLines();
    const f = fixture();
    const bugWhat = 'The parser crashes\n- [ ] Fix the parser crash';
    const blockerWhat = 'The hook refused\n- [ ] Rewrite the hook -->';

    await triageFor(f, chainLanding(f.publicSpy.tracker))(taskInput(f, sessionOutput({
      blockers: [blockerWhat],
      bugs: [[bugWhat, 'ERR_TASKLIKE', false], [bugWhat, 'ERR_PRIVATE', true]],
    })));

    const after = readFileSync(f.trackerPath, 'utf8');
    expect(issueNames(f.publicDir)).toEqual(['1.md']);
    expect(issueNames(f.privateDir)).toEqual(['1.md']);
    expect(after.split('\n')).toHaveLength(TRACKER_TEXT.split('\n').length);
    expect(taskLines(after)).toHaveLength(taskLines(TRACKER_TEXT).length);
    const resumed = findNextTask(after);
    expect(resumed?.lineNum).toBe(TASK_LINE);
    expect(resumed?.blocker).toBe(blockerWhat);
    updateTrackerLine(f.trackerPath, TASK_LINE, 'done');
    expect(findNextTask(readFileSync(f.trackerPath, 'utf8'))?.lineNum).toBe(NEXT_LINE);

    // The same bug text planted raw under the task opens a task the reading answers.
    const planted = join(f.root, 'PLAN_TRACKER-planted.md');
    const trackerLines = TRACKER_TEXT.split('\n');
    writeFileSync(planted, [...trackerLines.slice(0, TASK_LINE + 1), bugWhat, ...trackerLines.slice(TASK_LINE + 1)].join('\n'), 'utf8');
    updateTrackerLine(planted, TASK_LINE, 'done');
    expect(findNextTask(readFileSync(planted, 'utf8'))?.task).toBe('Fix the parser crash');
  });
});

describe('the lines a triage prints', () => {
  it('name the blocker text and each bug once: a note for what reached a tracker, and a warning for everything else', () => {
    const github = (externalId: string, url: string | null = null): IssueRef => ({ opt: 0, kind: 'github', externalId, url });
    const unset = { ref: null, foundBy: null, stored: null, problem: null } as const;
    const result: TriageResult = {
      blocker: { text: 'x', written: false, problem: 'tracker line 4 is no open or blocked task line with text' },
      bugs: [
        { ...unset, index: 0, channel: 'public', action: 'filed', ref: github('7', 'https://github.com/o/r/issues/7'), stored: 'inserted' },
        {
          ...unset,
          index: 1,
          channel: 'public',
          action: 'commented',
          ref: github('7'),
          foundBy: 'find',
          problem: 'storing the reference failed: database is locked',
        },
        { ...unset, index: 2, channel: 'public', action: 'commented', ref: github('7'), foundBy: 'store' },
        { ...unset, index: 3, channel: 'public', action: 'filed', ref: github('9'), stored: 'conflict' },
        {
          ...unset,
          index: 4,
          channel: 'private',
          action: 'failed',
          ref: { opt: 0, kind: 'local', externalId: '2', url: null },
          foundBy: 'find',
          problem: 'the private tracker comment failed: EACCES',
        },
        { ...unset, index: 5, channel: 'public', action: 'failed', problem: 'reading the stored reference failed: SQLITE_CORRUPT' },
        { ...unset, index: 6, channel: 'public', action: 'skipped', problem: 'out_of_scope_bugs[6] has no what to file' },
      ],
      staleDocs: [],
    };

    expect(describeStartTriage(result)).toEqual({
      notes: [
        'Triage: out_of_scope_bugs[0]: filed on the public tracker as https://github.com/o/r/issues/7.',
        'Triage: out_of_scope_bugs[1]: recurs in github issue 7 on the public tracker, found by a tracker find; commented on it.',
        'Triage: out_of_scope_bugs[2]: recurs in github issue 7 on the public tracker, found by its stored reference; commented on it.',
        'Triage: out_of_scope_bugs[3]: filed on the public tracker as github issue 9.',
      ],
      warnings: [
        'Triage: blockers: tracker line 4 is no open or blocked task line with text',
        'Triage: out_of_scope_bugs[1]: storing the reference failed: database is locked',
        'Triage: out_of_scope_bugs[3]: the store keeps another reference for its artifact, in place of github issue 9.',
        'Triage: out_of_scope_bugs[4]: recurs in local issue 2 on the private tracker, not commented on:'
          + ' the private tracker comment failed: EACCES',
        'Triage: out_of_scope_bugs[5]: not filed on the public tracker: reading the stored reference failed: SQLITE_CORRUPT',
        'Triage: out_of_scope_bugs[6] has no what to file; nothing was filed.',
      ],
    });
  });

  it('hold one note per stale_docs entry, after the bugs\' notes, each naming its index as stored with nothing filed, and no warning', () => {
    const unset = { ref: null, foundBy: null, stored: null } as const;
    const result: TriageResult = {
      blocker: { text: null, written: false, problem: null },
      bugs: [
        {
          ...unset,
          index: 0,
          channel: 'public',
          action: 'filed',
          ref: { opt: 0, kind: 'github', externalId: '9', url: null },
          problem: null,
        },
      ],
      staleDocs: [
        {
          ...unset,
          index: 0,
          channel: 'docs',
          action: 'skipped',
          problem: 'stale_docs[0] is stale documentation at context/cli.md:4: names a command that was renamed',
        },
        { ...unset, index: 1, channel: 'docs', action: 'skipped', problem: null },
      ],
    };

    expect(describeStartTriage(result)).toEqual({
      notes: [
        'Triage: out_of_scope_bugs[0]: filed on the public tracker as github issue 9.',
        'Triage: stale_docs[0] is stale documentation at context/cli.md:4: names a command that was renamed;'
          + ' stored as a stale-doc row, and nothing was filed.',
        'Triage: stale_docs[1] is stale documentation; stored as a stale-doc row, and nothing was filed.',
      ],
      warnings: [],
    });
    expect(describeStartTriage({ ...result, staleDocs: [] }).notes).toHaveLength(1);
  });

  it('are none for a report whose blocker had no text and which listed no bug', () => {
    expect(describeStartTriage({ blocker: { text: null, written: false, problem: null }, bugs: [], staleDocs: [] })).toEqual({
      notes: [],
      warnings: [],
    });
  });
});

describe('the stand-in for a tracker the run did not resolve', () => {
  it('answers its preflight with its reason and rejects every other call with it', async () => {
    const standIn = unresolvedTracker('github', NOT_RESOLVED_REASON);
    const ref: IssueRef = { opt: 0, kind: 'github', externalId: '1', url: null };

    expect(standIn.kind).toBe('github');
    expect(await standIn.preflight()).toEqual({ ok: false, reason: NOT_RESOLVED_REASON });
    expect(standIn.capabilities()).toEqual({ projects: false, customFields: false, issueTypes: false });
    await Promise.all([
      expect(standIn.find({ text: 'x' })).rejects.toThrow(NOT_RESOLVED_REASON),
      expect(standIn.get(ref)).rejects.toThrow(NOT_RESOLVED_REASON),
      expect(standIn.create(draftFixture())).rejects.toThrow(NOT_RESOLVED_REASON),
      expect(standIn.comment(ref, 'body')).rejects.toThrow(NOT_RESOLVED_REASON),
      expect(standIn.transition(ref, 'todo')).rejects.toThrow(NOT_RESOLVED_REASON),
    ]);
  });
});

describe('the run\'s similarity settings', () => {
  // 10 of 14 distinct words shared, counted by hand: a score of 0.71.
  const first = ['Parser drops the last line', 'parse returned too few lines for the input', false] as const;
  const reworded = ['Parser drops the final line', 'parse returned too few lines for the text', false] as const;

  /** Triages `first`, then `reworded`, over a local tracker with its `openIssues` reading, under `config`. */
  async function rewordedAfterFirst(f: Fixture, config: StartTriageOptions['config']): Promise<TriageResult | null> {
    const tracker = createLocalTracker({ issuesDir: f.publicDir, fallbackReason: null, now: CLOCK });
    const triage = triageFor(f, chainLanding(tracker), { config });
    await triage(taskInput(f, sessionOutput({ bugs: [first] }), 'session-1'));
    return triage(taskInput(f, sessionOutput({ bugs: [reworded] }), 'session-2'));
  }

  it('reach triage, so a reworded bug comments on the nearest open bug, its note naming the score', async () => {
    const lines = captureLines();
    const f = fixture();

    const second = await rewordedAfterFirst(f, CONFIG);

    expect(second?.bugs.map((bug) => [bug.action, bug.foundBy])).toEqual([['commented', 'similarity']]);
    expect(issueNames(f.publicDir)).toEqual(['1.md']);
    expect(lines.info.at(-1)).toBe(
      '   Triage: out_of_scope_bugs[0]: recurs in local issue 1 on the public tracker,'
        + ' found by word similarity (score 0.71); commented on it.',
    );
  });

  it('turned off with a threshold of false, file the reworded bug as a second issue, the control', async () => {
    captureLines();
    const f = fixture();

    const second = await rewordedAfterFirst(f, { ...CONFIG, triageSimilarityThreshold: false });

    expect(second?.bugs.map((bug) => [bug.action, bug.foundBy])).toEqual([['filed', null]]);
    expect(issueNames(f.publicDir)).toEqual(['1.md', '2.md']);
  });
});

describe('what each triageReport is handed', () => {
  /** A git runner that spawns nothing: it records each call and answers `abc1234` to every one. */
  function fakeGit(): { readonly git: GitRunner; readonly calls: (readonly string[])[] } {
    const calls: (readonly string[])[] = [];
    return {
      calls,
      git: (args) => {
        calls.push(args);
        return { ok: true, stdout: 'abc1234\n', stderr: '' };
      },
    };
  }

  /** A `triageReport` that records the options it is handed, then triages through the real one. */
  function capturing(): { readonly seen: TriageOptions[]; readonly report: (options: TriageOptions) => Promise<TriageResult> } {
    const seen: TriageOptions[] = [];
    return {
      seen,
      report: (options) => {
        seen.push(options);
        return triageReport(options);
      },
    };
  }

  const oneBug = sessionOutput({ bugs: [['The parser drops a line', 'ERR_ONE', false]] });

  it('carries the checkout, the fake git runner, the environment and the bug rules read from the config', async () => {
    captureLines();
    const f = fixture();
    const checkout = mkdtempSync(join(tempBase, 'checkout-'));
    const { git, calls } = fakeGit();
    const env = { CI: 'true' };
    const config: StartTriageOptions['config'] = {
      ...CONFIG,
      issuesEnvironments: ['staging'],
      issuesVocabularyModules: ['parser'],
      errorsCodes: [{ code: 'parse:dropped-line', description: 'a line is dropped', hint: 'keep the line', level: 'error' }],
    };
    const { seen, report } = capturing();

    await triageFor(f, chainLanding(f.publicSpy.tracker), { checkout, git, env, config, triageReport: report })(taskInput(f, oneBug));

    expect(seen).toHaveLength(1);
    const [handed] = seen;
    expect(handed?.repoRoot).toBe(f.root);
    expect(handed?.checkout).toBe(checkout);
    expect(handed?.git).toBe(git);
    expect(handed?.env).toBe(env);
    expect(handed?.bugRules).toEqual(bugRulesOf(config));
    expect(handed?.bugRules?.environments).toContain('staging');
    expect(handed?.bugRules?.modules).toEqual(['parser']);
    expect(handed?.bugRules?.codes.map((entry) => entry.code)).toContain('parse:dropped-line');
    // The record reads the code version through the runner handed, and the
    // place through the environment handed: the fake's answer to the status
    // read is a changed file, so the commit reads dirty. The store and the
    // issue stay at the repo root all the same.
    expect(calls).toEqual([['rev-parse', '--short', 'HEAD'], ['status', '--porcelain', '--untracked-files=no']]);
    expect(issueNames(f.publicDir)).toEqual(['1.md']);
    const [filed] = issueFiles(f.publicDir);
    expect(filed?.contents).toContain('## Environment\n\nci\n');
    expect(filed?.contents).toContain(`## Versions\n\n\`\`\`\nrafa: ${RAFA_VERSION}\ncode: abc1234-dirty\n\`\`\`\n`);
  });

  it('left without a checkout, a git runner or an environment, hands the repo root, a runner of its own and the process environment', async () => {
    captureLines();
    const f = fixture();
    const { git } = fakeGit();
    const { seen, report } = capturing();

    await createStartTriage({
      repoRoot: f.root,
      config: CONFIG,
      resolve: chainLanding(f.publicSpy.tracker).resolve,
      privateTracker: f.privateSpy.tracker,
      triageReport: report,
    })(taskInput(f, oneBug));

    const [handed] = seen;
    expect(handed?.checkout).toBe(f.root);
    expect(typeof handed?.git).toBe('function');
    expect(handed?.git).not.toBe(git);
    expect(handed?.env).toBe(process.env);
    expect(handed?.bugRules).toEqual(bugRulesOf(CONFIG));
  });

  it('takes a worktree path outside the project out of the filed body, where a triage without the checkout leaves it in', async () => {
    captureLines();
    const outside = mkdtempSync(join(tempBase, 'outside-worktree-'));
    const what = `The parser drops a line in ${join(outside, 'src', 'parse.ts')}`;
    const output = sessionOutput({ bugs: [[what, 'ERR_OUTSIDE', false]] });

    const handed = fixture();
    await triageFor(handed, chainLanding(handed.publicSpy.tracker), { checkout: outside, git: fakeGit().git })(taskInput(handed, output));
    const plain = fixture();
    await triageFor(plain, chainLanding(plain.publicSpy.tracker))(taskInput(plain, output));

    const [filed] = issueFiles(handed.publicDir);
    expect(filed?.contents).toContain('The parser drops a line in src/parse.ts');
    expect(filed?.contents).not.toContain(outside);
    const [control] = issueFiles(plain.publicDir);
    expect(control?.contents).toContain(outside);
  });

  it('takes the default worktree\'s .rafa/worktrees/<stub>/ prefix out of the filed body, where a triage without the checkout leaves it in', async () => {
    captureLines();
    const stubPath = (root: string): string => join(root, '.rafa', 'worktrees', 'demo-stub');
    const output = (root: string): string => sessionOutput({
      bugs: [[`The parser drops a line in ${join(stubPath(root), 'src', 'parse.ts')}`, 'ERR_WORKTREE', false]],
    });

    const handed = fixture();
    mkdirSync(stubPath(handed.root), { recursive: true });
    await triageFor(handed, chainLanding(handed.publicSpy.tracker), { checkout: stubPath(handed.root), git: fakeGit().git })(
      taskInput(handed, output(handed.root)),
    );
    const plain = fixture();
    await triageFor(plain, chainLanding(plain.publicSpy.tracker))(taskInput(plain, output(plain.root)));

    const [filed] = issueFiles(handed.publicDir);
    expect(filed?.contents).toContain('The parser drops a line in src/parse.ts');
    expect(filed?.contents).not.toContain('.rafa/worktrees/demo-stub');
    const [control] = issueFiles(plain.publicDir);
    expect(control?.contents).toContain('.rafa/worktrees/demo-stub/src/parse.ts');
  });
});

/** The owner of the fake repository and of its project. */
const PROJECT_OWNER = 'open-tomato';

/** The project's number, set in {@link PROJECT_CONFIG}. */
const PROJECT_NUMBER = 6;

/** The issue the `github` public tracker files a bug as: one the fake repository holds. */
const FILED_ISSUE = 41;

/** {@link CONFIG} with `board.project.number` set. */
const PROJECT_CONFIG: StartTriageOptions['config'] = { ...CONFIG, boardProjectNumber: PROJECT_NUMBER };

/** GitHub's documented refusal for a token with no project scope, as `board/project/add-issue.test.ts` plants it; NOT a reading. */
const SCOPE_STDERR = 'gh: Your token has not been granted the required scopes to execute this query. The \'projectV2\' field requires one of the following scopes: [\'read:project\'], but your token has only been granted the: [\'repo\'] scopes.\n';

/** The bug every project case's report lists, public, with an artifact. */
const PROJECT_BUG: BugEntry = ['The parser drops a line', 'ERR_ONE', false];

function answered(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: '' };
}

/** The ref the `github` public tracker answers for the bug it files as `issue`. */
function githubRefOf(issue: number): IssueRef {
  return {
    opt: 0,
    kind: 'github',
    externalId: String(issue),
    url: `https://github.com/${FAKE_PROJECT_REPOSITORY}/issues/${String(issue)}`,
  };
}

/** The ref the `github` public tracker answers for each bug it files. */
const FILED_REF: IssueRef = githubRefOf(FILED_ISSUE);

/** One case's fixture, its `github` public tracker, the project fake and the runner routing to it. */
interface ProjectScene {
  readonly f: Fixture;
  readonly github: Spied;
  readonly project: ReturnType<typeof createFakeProjectGh>;
  readonly gh: GhRunner;
  /** Every `gh` call the runner was handed, in order. */
  readonly calls: readonly (readonly string[])[];
}

/**
 * A fresh fixture whose public tracker is of kind `github` and files its
 * bugs as `issues`, in order (the last again for any bug beyond them),
 * beside a project holding no item and a runner answering the repository
 * read and the board listing itself and routing every `gh api` call to
 * the facts or the project fake. The tracker reads every issue back open
 * and takes every comment, as GitHub would for the issues it filed.
 */
function projectScene(issues: readonly number[] = [FILED_ISSUE]): ProjectScene {
  const f = fixture();
  let filedCount = 0;
  const local = createLocalTracker({ issuesDir: f.publicDir, fallbackReason: null, now: CLOCK });
  const inner: Tracker = {
    ...local,
    get: (ref) => Promise.resolve({ ...draftFixture({ title: 'a bug' }), ref, state: 'todo' }),
    comment: () => Promise.resolve(),
  };
  const github = spy(inner, {
    kind: 'github',
    create: () => {
      const issue = issues[Math.min(filedCount, issues.length - 1)] ?? FILED_ISSUE;
      filedCount += 1;
      return Promise.resolve(githubRefOf(issue));
    },
  });
  const project = createFakeProjectGh({
    projects: [{ owner: PROJECT_OWNER, number: PROJECT_NUMBER, items: [] }],
    owners: [PROJECT_OWNER],
    repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues }],
  });
  const facts = createFakeFactsGh({
    issues: [
      { number: 1, state: 'OPEN', labels: ['type:roadmap'] },
      ...issues.map((number) => ({ number, state: 'OPEN' as const, labels: ['type:bug'] })),
    ],
  });
  const listed = (number: number, labels: readonly string[], body: string): Readonly<Record<string, unknown>> => ({
    number,
    title: `#${String(number)}`,
    body,
    state: 'OPEN',
    stateReason: '',
    labels: labels.map((name) => ({ name })),
  });
  const roadmap = listed(1, ['type:roadmap'], '');
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    const line = args.join(' ');
    if (line === 'repo view --json nameWithOwner') return Promise.resolve(answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    if (line.startsWith('issue list --label type:roadmap --state open')) return Promise.resolve(answered([roadmap]));
    if (line.startsWith('issue list --state all')) return Promise.resolve(answered([roadmap, ...issues.map((number) => listed(number, ['type:bug'], ''))]));
    if (args[0] === 'api' && args.includes('owner={owner}')) return facts.gh(args);
    if (args[0] === 'api') return project.gh(args);
    return Promise.resolve({ ok: false, stdout: '', stderr: `test gh: unrouted command: gh ${line}\n` });
  };
  return { f, github, project, gh, calls };
}

/** The Stage each issue's item on the project holds, by issue number, read through the project port. */
async function projectStages(gh: GhRunner): Promise<Readonly<Record<number, string | null>>> {
  const port = createGhProjectPort(gh);
  const found = await port.find({ owner: PROJECT_OWNER, number: PROJECT_NUMBER });
  const items = await port.items(found?.id ?? '');
  return Object.fromEntries(items.flatMap(({ content, values }) => {
    if (content.kind !== 'issue') return [];
    const stage = values.get('Stage');
    return [[content.number, stage?.kind === 'option'
      ? stage.name
      : null] as const];
  }));
}

/** One line the active output was handed, with its level, in the order handed. */
type OrderedLine = readonly [level: 'info' | 'warn', message: string];

/** Sets a sink output as the active output, answering its info and warn lines in one list, in order. */
function captureOrdered(): OrderedLine[] {
  const lines: OrderedLine[] = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.push(['info', message]);
    },
    warn: (message) => {
      lines.push(['warn', message]);
    },
  }));
  return lines;
}

/** The scene's triage, its chain landing on the `github` tracker and every project call routed to the fakes. */
function projectTriage(
  scene: ProjectScene,
  config: StartTriageOptions['config'] = PROJECT_CONFIG,
  projectRefresh?: RefreshAddedItems,
): StartTriage {
  return triageFor(scene.f, chainLanding(scene.github.tracker), {
    config,
    project: {
      gh: scene.gh,
      sleep: () => Promise.resolve(),
      ...projectRefresh === undefined
        ? {}
        : { projectRefresh },
    },
  });
}

/** The line a {@link plantedRefresh} answers for `issue`, as its first warning. */
function plantedLine(issue: number): string {
  return `refreshed #${String(issue)}`;
}

/** The line a {@link plantedRefresh} answers for `issue`, as its second warning. */
function plantedSecondLine(issue: number): string {
  return `refreshed #${String(issue)} again`;
}

/** A refresh that records each issue list it is asked for and answers `lines` warnings for each issue. */
function plantedRefresh(
  asked: (readonly number[])[],
  lines: readonly ((issue: number) => string)[] = [plantedLine],
): RefreshAddedItems {
  return (_options, issues) => {
    asked.push(issues);
    return Promise.resolve<ProjectRefresh>({
      kind: 'skipped',
      reason: 'no-issues',
      warnings: issues.flatMap((issue) => lines.map((line) => line(issue))),
    });
  };
}

/** The issues the scene's project holds as items, in the order added. */
async function projectHeld(scene: ProjectScene): Promise<number[]> {
  const port = createGhProjectPort(scene.gh);
  const found = await port.find({ owner: PROJECT_OWNER, number: PROJECT_NUMBER });
  const items = await port.items(found?.id ?? '');
  return items.flatMap(({ content }) => (content.kind === 'issue'
    ? [content.number]
    : []));
}

/** A bug that recurs: filed by one report, commented on by the next. */
const RECURRING_BUG: BugEntry = ['The cache serves a stale row', 'ERR_RECUR', false];

/** A second public bug, distinct from {@link PROJECT_BUG}. */
const SECOND_BUG: BugEntry = ['The writer truncates a file', 'ERR_TWO', false];

/** A bug the report marks security: it goes to the private tracker. */
const SECURITY_BUG: BugEntry = ['The token is written to the log', 'ERR_TOKEN', true];

/** A bug with no `what`: nothing is filed for it. */
const NO_WHAT_BUG: BugEntry = ['', null, null];

/** The lines of `lines` handed at `level`, in order. */
function atLevel(lines: readonly OrderedLine[], level: OrderedLine[0]): string[] {
  return lines
    .filter(([handed]) => handed === level)
    .map(([, message]) => message);
}

describe('the bugs of one report, onto the project', () => {
  it('adds the filed bug alone, where the recurring bug commented on, the security bug and the bug with no what send nothing', async () => {
    captureLines();
    const scene = projectScene([40, 41]);
    const asked: (readonly number[])[] = [];
    const triage = projectTriage(scene, PROJECT_CONFIG, plantedRefresh(asked));
    await triage(taskInput(scene.f, sessionOutput({ bugs: [RECURRING_BUG] }), 'session-1'));
    expect(asked).toEqual([[40]]);

    const lines = captureOrdered();
    const result = await triage(taskInput(
      scene.f,
      sessionOutput({ bugs: [RECURRING_BUG, PROJECT_BUG, SECURITY_BUG, NO_WHAT_BUG] }),
      'session-2',
    ));

    expect(result?.bugs.map((bug) => [bug.channel, bug.action])).toEqual([
      ['public', 'commented'],
      ['public', 'filed'],
      ['private', 'filed'],
      ['private', 'skipped'],
    ]);
    expect(result?.bugs.map((bug) => bug.ref?.externalId ?? null).slice(0, 2)).toEqual(['40', '41']);
    expect(asked).toEqual([[40], [41]]);
    expect(await projectHeld(scene)).toEqual([40, 41]);
    expect(atLevel(lines, 'warn').filter((line) => line.includes('refreshed'))).toEqual([`   Triage: ${plantedLine(41)}`]);
  });

  it('control: the same report without the filed bug adds nothing beyond the issue the first report filed', async () => {
    captureLines();
    const scene = projectScene([40, 41]);
    const asked: (readonly number[])[] = [];
    const triage = projectTriage(scene, PROJECT_CONFIG, plantedRefresh(asked));
    await triage(taskInput(scene.f, sessionOutput({ bugs: [RECURRING_BUG] }), 'session-1'));

    const lines = captureOrdered();
    const result = await triage(taskInput(
      scene.f,
      sessionOutput({ bugs: [RECURRING_BUG, SECURITY_BUG, NO_WHAT_BUG] }),
      'session-2',
    ));

    expect(result?.bugs.map((bug) => bug.action)).toEqual(['commented', 'filed', 'skipped']);
    expect(asked).toEqual([[40]]);
    expect(await projectHeld(scene)).toEqual([40]);
    expect(atLevel(lines, 'warn').filter((line) => line.includes('refreshed'))).toEqual([]);
  });

  it('adds each of two filed bugs in the order the report lists them, and prints their lines in that order', async () => {
    const lines = captureOrdered();
    const scene = projectScene([42, 41]);
    const asked: (readonly number[])[] = [];

    const result = await projectTriage(scene, PROJECT_CONFIG, plantedRefresh(asked))(
      taskInput(scene.f, sessionOutput({ bugs: [PROJECT_BUG, SECOND_BUG] })),
    );

    expect(result?.bugs.map((bug) => bug.ref?.externalId ?? null)).toEqual(['42', '41']);
    expect(asked).toEqual([[42], [41]]);
    expect(await projectHeld(scene)).toEqual([42, 41]);
    expect(atLevel(lines, 'warn')).toEqual([`   Triage: ${plantedLine(42)}`, `   Triage: ${plantedLine(41)}`]);
  });
});

describe('a report with board.project.number unset', () => {
  it('records no gh call and prints no line, where the same report with the number set sends calls and prints the refresh\'s line', async () => {
    const report = sessionOutput({ bugs: [PROJECT_BUG] });

    const unsetLines = captureOrdered();
    const unset = projectScene();
    const unsetAsked: (readonly number[])[] = [];
    await projectTriage(unset, CONFIG, plantedRefresh(unsetAsked))(taskInput(unset.f, report));
    const unsetCalls = [...unset.calls];

    const setLines = captureOrdered();
    const set = projectScene();
    const setAsked: (readonly number[])[] = [];
    await projectTriage(set, PROJECT_CONFIG, plantedRefresh(setAsked))(taskInput(set.f, report));

    expect(unsetCalls).toEqual([]);
    expect(unsetAsked).toEqual([]);
    expect(atLevel(unsetLines, 'warn')).toEqual([]);
    expect(set.calls.length).toBeGreaterThan(0);
    expect(setAsked).toEqual([[FILED_ISSUE]]);
    expect(atLevel(setLines, 'warn')).toEqual([`   Triage: ${plantedLine(FILED_ISSUE)}`]);
    expect(unsetLines.filter(([level]) => level === 'info')).toEqual(setLines.filter(([level]) => level === 'info'));
  });
});

describe('the project add under json output', () => {
  it('writes each warning the add answers as a warn log event, after the bug\'s filed note, in the order answered', async () => {
    const chunks: string[] = [];
    setActiveOutput(createJsonOutput({ stream: { write: (chunk) => chunks.push(chunk) } }), 'json');
    const scene = projectScene([42, 41]);

    await projectTriage(scene, PROJECT_CONFIG, plantedRefresh([], [plantedLine, plantedSecondLine]))(
      taskInput(scene.f, sessionOutput({ bugs: [PROJECT_BUG, SECOND_BUG] })),
    );

    const events = chunks.join('').split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as CliEventLog);
    const warned = events.filter((event) => event.type === 'log' && event.level === 'warn');
    expect(warned.map((event) => event.message)).toEqual([
      `   Triage: ${plantedLine(42)}`,
      `   Triage: ${plantedSecondLine(42)}`,
      `   Triage: ${plantedLine(41)}`,
      `   Triage: ${plantedSecondLine(41)}`,
    ]);
    const lastNote = events.map((event) => event.level).lastIndexOf('info');
    expect(lastNote).toBeGreaterThanOrEqual(0);
    expect(events.indexOf(warned[0] as CliEventLog)).toBeGreaterThan(lastNote);
  });
});

describe('a bug filed on the public github tracker, onto the project', () => {
  it('is added to the project with its Stage set, the filed note printed and no warning', async () => {
    const lines = captureOrdered();
    const scene = projectScene();

    const result = await projectTriage(scene)(taskInput(scene.f, sessionOutput({ bugs: [PROJECT_BUG] })));

    expect(result?.bugs.map((bug) => [bug.channel, bug.action, bug.ref])).toEqual([['public', 'filed', FILED_REF]]);
    expect(await projectStages(scene.gh)).toEqual({ [FILED_ISSUE]: 'Backlog' });
    expect(lines.filter(([level]) => level === 'warn')).toEqual([]);
    expect(lines).toContainEqual(['info', `   Triage: out_of_scope_bugs[0]: filed on the public tracker as ${FILED_REF.url ?? ''}.`]);
  });

  it('is refused for the project scope: the tracker line and stored reference stand as with no project, the filed note then the scope warning printed', async () => {
    const report = sessionOutput({ blockers: ['The hook refused the commit'], bugs: [PROJECT_BUG] });

    const lines = captureOrdered();
    const refused = projectScene();
    refused.project.failNext(SCOPE_STDERR);
    const result = await projectTriage(refused)(taskInput(refused.f, report));

    captureLines();
    const unset = projectScene();
    await projectTriage(unset, CONFIG)(taskInput(unset.f, report));

    expect(result?.bugs.map((bug) => bug.action)).toEqual(['filed']);
    const tracker = readFileSync(refused.f.trackerPath, 'utf8');
    expect(tracker).not.toBe(TRACKER_TEXT);
    expect(tracker).toBe(readFileSync(unset.f.trackerPath, 'utf8'));
    const refs = (root: string): string[] => refRows(root).map((row) => row.tracker_ref);
    expect(refs(refused.f.root)).toHaveLength(1);
    expect(refs(refused.f.root)).toEqual(refs(unset.f.root));
    expect(await projectStages(refused.gh)).toEqual({});

    const filedNote: OrderedLine = ['info', `   Triage: out_of_scope_bugs[0]: filed on the public tracker as ${FILED_REF.url ?? ''}.`];
    const scope: OrderedLine = ['warn', `   Triage: ${scopeWarning()}`];
    expect(lines.filter(([level]) => level === 'warn')).toEqual([scope]);
    expect(lines.at(-1)).toEqual(scope);
    expect(lines.findIndex((line) => line[0] === filedNote[0] && line[1] === filedNote[1])).toBeGreaterThanOrEqual(0);
    expect(lines.findIndex((line) => line[0] === filedNote[0] && line[1] === filedNote[1])).toBeLessThan(lines.length - 1);
  });
});
