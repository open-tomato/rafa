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
 */
import type {
  StartTriage,
  StartTriageOptions,
  TaskTriageInput,
} from './triage.js';
import type { ResolveTrackerOptions, TrackerAttempt, TrackerResolution } from '../adapters/tracker/resolve.js';
import type { FindingOutcome } from '../effort/store/findings.js';
import type { IssueRef, Tracker } from '../ports/index.js';
import type { TriageResult } from '../triage/triage.js';

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

import { setActiveOutput } from '../adapters/output/active.js';
import { draftFixture } from '../adapters/tracker/contract.js';
import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { createPrivateTriageTracker, privateTriageDir } from '../triage/triage.js';
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
};

/** One out-of-scope bug as a report lists it: its what, its artifact and its flag. */
type BugEntry = readonly [what: string, artifact: string | null, security: boolean | null];

/** The lists a session's report holds. */
interface ReportParts {
  readonly feedback?: string;
  readonly blockers?: readonly string[];
  readonly bugs?: readonly BugEntry[];
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
      ['session-1', 'demo', TASK_TEXT, 'ERR_ONE', 'blocked'],
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

  it('are none for a report whose blocker had no text and which listed no bug', () => {
    expect(describeStartTriage({ blocker: { text: null, written: false, problem: null }, bugs: [] })).toEqual({
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
