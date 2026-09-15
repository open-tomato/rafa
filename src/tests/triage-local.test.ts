/**
 * Loop-owned triage (`src/triage/triage.ts`) over the real `local`
 * tracker adapter, tying its outward guarantees together in one file: an
 * out-of-scope bug filed once and commented on when it recurs, a security
 * bug kept off the public tracker, a named secret kept off a filed body,
 * and a blocker's text carried through to the prompt of the task's later
 * dispatch.
 *
 * `src/triage/triage.test.ts` already drives `triageReport` through a
 * mutation-testing grid over spied `local` trackers, and
 * `src/start/triage.test.ts` does the same for `createStartTriage`'s
 * wiring into `loop start`. Neither carries a written blocker on to
 * `buildTaskPrompt` (`start/dispatch.ts`), the function that puts the
 * text in front of a session on the task's next dispatch, so this file
 * closes that one gap rather than repeating either suite's grid.
 *
 * Every root, tracker file and issue directory sits under one temporary
 * directory this file creates and removes; no case writes under the
 * repository or the home, and no case spawns a process. The public
 * tracker is a real `local` tracker wrapped in a spy recording every
 * call it receives, so a case reads what was, or was not, asked of it,
 * and the private tracker is `triageReport`'s own default over the
 * fixture's root. A filed or commented-on body is read back off its
 * issue file on disk, never off what `triageReport` answered.
 */
import type { FindingsDispatch } from '../effort/store/findings.js';
import type { Tracker } from '../ports/index.js';
import type { ReportBlocker, ReportBug, TaskReport } from '../report/parse.js';
import type { TaskSessionRunner } from '../start/dispatch.js';
import type { NamedSecret } from '../triage/triage.js';
import type { TaskInfo } from '../utils/tracker.js';

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
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';
import { BLOCKER_PROMPT_PREFIX, dispatchTask } from '../start/dispatch.js';
import { createPrivateTriageTracker, privateTriageDir, triageReport } from '../triage/triage.js';
import { escapeBlockerText, findNextTask } from '../utils/tracker.js';

import { sinkOutput } from './output-sinks.js';

/** The clock every tracker call in this file stamps with. */
const CLOCK = (): string => '2026-09-15T10:00:00.000Z';

const TRACKER_TEXT = [
  '# Plan: demo',
  '',
  '- [x] Ship the parser',
  '- [BLOCKED] Wire the loop',
  '- [ ] Write the docs',
  '',
].join('\n');

/** The blocked task line of {@link TRACKER_TEXT}, counting from zero. */
const TASK_LINE = 3;

/** That line's sentence, with no declaration to strip. */
const TASK_TEXT = 'Wire the loop';

const FIRST: FindingsDispatch = { sessionId: 'session-1', planStub: 'demo', taskLine: TASK_TEXT };
const SECOND: FindingsDispatch = { sessionId: 'session-2', planStub: 'demo', taskLine: TASK_TEXT };

/** The artifact a recurring public bug shares across two reports. */
const ARTIFACT = 'TypeError: connection pool exhausted';

/** A token no fixture names as a secret, so a filed body may hold it as a control. */
const TOKEN = 'ghp_localAdapterProbeToken';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-triage-local-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

beforeEach(() => {
  setActiveOutput(sinkOutput({}));
});

afterEach(() => {
  setActiveOutput(null);
});

/** One `out_of_scope_bugs` entry, as a session's report would carry it. */
function bug(what: string, artifact: string | null, security: boolean | null): ReportBug {
  return { what, artifact, security, extras: [] };
}

/** One `blockers` entry naming `what`, with no artifact of its own. */
function blocker(what: string): ReportBlocker {
  return { what, artifact: null, extras: [] };
}

/** A parsed report, `parts` overriding the fields a case cares about. */
function reportWith(parts: Partial<TaskReport> = {}): TaskReport {
  return {
    status: 'blocked',
    feedback: 'Wired the loop; hit a snag.',
    findings: [],
    skillsUsed: [],
    blockers: [],
    outOfScopeBugs: [],
    extras: [],
    ...parts,
  };
}

/** One call a spied tracker received. */
type TrackerCall = readonly [method: string, argument: unknown];

/** A tracker that records every call before handing it on. */
interface Spied {
  readonly tracker: Tracker;
  readonly calls: TrackerCall[];
}

/** Wraps `inner`, recording every call it receives before handing it on. */
function spy(inner: Tracker): Spied {
  const calls: TrackerCall[] = [];
  const tracker: Tracker = {
    kind: inner.kind,
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
      return inner.create(draft);
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

/** The method of every call the spy recorded, in order. */
function methodsOf(spied: Spied): string[] {
  return spied.calls.map(([method]) => method);
}

/** One case's root, tracker file and spied public tracker. */
interface Fixture {
  readonly root: string;
  readonly trackerPath: string;
  readonly publicDir: string;
  readonly privateDir: string;
  readonly publicSpy: Spied;
  readonly privateTracker: Tracker;
}

/** A fresh root under the temporary directory, its tracker file freshly planted. */
function fixture(): Fixture {
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
    publicSpy: spy(createLocalTracker({ issuesDir: publicDir, fallbackReason: null, now: CLOCK })),
    privateTracker: createPrivateTriageTracker(root, { now: CLOCK }),
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

/** The one issue file under `dir`, its contents. Fails the case unless there is exactly one. */
function onlyIssue(dir: string): string {
  const files = issueFiles(dir);
  expect(files.map(({ name }) => name)).toEqual(['1.md']);
  return files[0]!.contents;
}

/** Triages `report` from `dispatch`, over one fixture's real local trackers. */
function triage(
  f: Fixture,
  report: TaskReport,
  dispatch: FindingsDispatch,
  secrets: readonly NamedSecret[] = [],
): ReturnType<typeof triageReport> {
  return triageReport({
    repoRoot: f.root,
    trackerPath: f.trackerPath,
    lineNum: TASK_LINE,
    dispatch,
    outcome: 'blocked',
    report,
    tracker: f.publicSpy.tracker,
    privateTracker: f.privateTracker,
    secrets,
  });
}

/** The task `findNextTask` answers off `f`'s tracker file. Fails the case when there is none. */
function nextTask(f: Fixture): TaskInfo {
  const info = findNextTask(readFileSync(f.trackerPath, 'utf8'));
  if (info === null) throw new Error('no open or blocked task in the tracker');
  return info;
}

describe('an out-of-scope bug over the local adapter', () => {
  it('creates exactly one issue, and a later report sharing its artifact comments on it with no second issue', async () => {
    const f = fixture();

    const first = await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }), FIRST);

    expect(first.bugs[0]).toMatchObject({ channel: 'public', action: 'filed' });
    expect(methodsOf(f.publicSpy)).toEqual(['find', 'create']);
    expect(issueNames(f.publicDir)).toEqual(['1.md']);

    const second = await triage(f, reportWith({
      feedback: 'Seen again while wiring the loop.',
      outOfScopeBugs: [bug('Last line lost again', ARTIFACT, false)],
    }), SECOND);

    expect(second.bugs[0]).toMatchObject({ channel: 'public', action: 'commented', foundBy: 'store' });
    expect(methodsOf(f.publicSpy)).toEqual(['find', 'create', 'comment']);
    expect(issueNames(f.publicDir)).toEqual(['1.md']);
    expect(onlyIssue(f.publicDir)).toContain('Last line lost again');
  });
});

describe('a security bug over the local adapter', () => {
  it('lands in the private tracker while a spy proves the public find was never called', async () => {
    const f = fixture();

    const result = await triage(f, reportWith({
      outOfScopeBugs: [bug('Token printed to the log', 'Bearer abc123token', true)],
    }), FIRST);

    expect(result.bugs[0]).toMatchObject({ channel: 'private', action: 'filed' });
    expect(f.publicSpy.calls.some(([method]) => method === 'find')).toBe(false);
    expect(f.publicSpy.calls).toEqual([]);
    expect(issueNames(f.privateDir)).toEqual(['1.md']);
    expect(existsSync(f.publicDir)).toBe(false);
  });
});

describe('a named secret over the local adapter', () => {
  it('is absent from the filed body', async () => {
    const f = fixture();
    const report = reportWith({
      feedback: `Retried the push after ${TOKEN} was rejected.`,
      outOfScopeBugs: [bug(`Push prints ${TOKEN} to stdout`, `auth header ${TOKEN}`, false)],
    });

    await triage(f, report, FIRST, [{ name: 'GITHUB_TOKEN', value: TOKEN }]);

    const contents = onlyIssue(f.publicDir);
    expect(contents).not.toContain(TOKEN);
    expect(contents).toContain('[redacted: GITHUB_TOKEN]');
  });
});

describe('a blocker over the local adapter', () => {
  it('writes its text onto the task tracker line, reaching the prompt of the task later dispatch', async () => {
    const f = fixture();
    const blockerText = 'The commit hook refused: lint errors in src/loop.ts';

    const result = await triage(f, reportWith({ blockers: [blocker(blockerText)] }), FIRST);

    expect(result.blocker).toEqual({ text: blockerText, written: true, problem: null });
    const taskInfo = nextTask(f);
    expect(taskInfo).toEqual({ task: TASK_TEXT, lineNum: TASK_LINE, status: 'blocked', blocker: blockerText });

    const prompts: string[] = [];
    const run: TaskSessionRunner = (prompt) => {
      prompts.push(prompt);
      return Promise.resolve({ exitCode: 0, stdout: '' });
    };
    await dispatchTask({
      taskInfo,
      promptContent: 'The loop stages and commits on your behalf.',
      planContent: TRACKER_TEXT,
      inject: 'full',
      repoRoot: f.root,
      home: join(f.root, 'home'),
      settingSources: ['project', 'local'],
      run,
      newSessionId: () => 'session-under-test',
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(`${BLOCKER_PROMPT_PREFIX}${escapeBlockerText(blockerText)}`);
    expect(prompts[0]?.startsWith(`Your scoped task is: ${TASK_TEXT}`)).toBe(true);
  });
});
