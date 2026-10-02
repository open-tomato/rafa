/**
 * Inherited red in the triage `loop start` runs (`start/triage.ts`): the
 * run-start suite baseline read once per run, its failures handed to
 * `triageReport`, and each inherited bug named in a `Triage:` note and an
 * `inherited` loop event.
 *
 * Every root, tracker file, baseline, store and issue directory is made
 * under one temporary directory this file creates and removes. The public
 * tracker is a real `local` tracker under the case's root wrapped in a spy
 * recording every call, handed over by a chain stub; the private one is a
 * real `local` tracker over the root's private triage directory.
 *
 * Each case where nothing is inherited (no baseline, an unreadable one,
 * one whose JUnit file was not read) holds the same failure the read case
 * holds, so the only thing between filing and inheriting is the reading
 * the case names: the read case is the control that the bug can be
 * inherited at all.
 */
import type { StartTriage, TaskTriageInput } from './triage.js';
import type { CliEvent, Tracker } from '../ports/index.js';
import type { JunitReading, SuiteFailure } from '../suite/run.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

import { setActiveOutput } from '../adapters/output/active.js';
import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';
import { baselineOf, baselinePathFor, writeBaseline } from '../suite/baseline.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { createPrivateTriageTracker } from '../triage/triage.js';

import { createStartTriage, describeStartTriage, runStartFailures } from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-start-triage-inherited-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** The clock every tracker stamps with. */
const CLOCK = (): string => '2026-10-02T09:00:00.000Z';

const TRACKER_TEXT = ['# Plan: demo', '', '- [BLOCKED] Wire the loop', ''].join('\n');

/** The blocked task line of {@link TRACKER_TEXT}, counting from zero. */
const TASK_LINE = 2;

/** One red test, as a session quoted bun's output for it. */
const ARTIFACT =
  'src/parse/parse.test.ts:\nerror: expect(received).toBe(expected) at line 12\n(fail) parse > drops the last line [0.19ms]';

/** The run-start failure that test is, as the JUnit file named it. */
const FAILURE: SuiteFailure = {
  file: 'src/parse/parse.test.ts',
  name: 'parse > drops the last line',
  message: 'expect(received).toBe(expected)',
};

/** What a task session prints: a line of its own, then a report listing the red test as an out-of-scope bug. */
const OUTPUT = [
  'Wired the loop.',
  '',
  '```rafa:report',
  'status: done',
  'feedback: "Wired the loop."',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs:',
  '  - what: "Parser drops the last line"',
  `    artifact: ${JSON.stringify(ARTIFACT)}`,
  '    security: false',
  '```',
  '',
].join('\n');

/** A tracker recording the method of every call before handing it on. */
interface Spied {
  readonly tracker: Tracker;
  readonly calls: string[];
}

/** Wraps `inner`, recording each call's method. */
function spy(inner: Tracker): Spied {
  const calls: string[] = [];
  const tracker: Tracker = {
    kind: inner.kind,
    capabilities: inner.capabilities,
    preflight: inner.preflight,
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
  return { tracker, calls };
}

/** One case's root, tracker file, baseline path and spied public tracker. */
interface Fixture {
  readonly root: string;
  readonly trackerPath: string;
  readonly baselinePath: string;
  readonly publicDir: string;
  readonly publicSpy: Spied;
}

/** A fresh root under the temporary directory, with its tracker file and no baseline. */
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
    baselinePath: baselinePathFor(trackerPath),
    publicDir,
    publicSpy: spy(createLocalTracker({ issuesDir: publicDir, fallbackReason: null, now: CLOCK })),
  };
}

/** Writes a baseline holding {@link FAILURE}, its JUnit file read as `junit`. */
function writeRedBaseline(f: Fixture, junit: JunitReading = 'read'): void {
  const result = { command: ['bun', 'test'], exitCode: 1, summary: null, failures: [FAILURE], errors: 0, junit };
  writeBaseline(f.baselinePath, baselineOf(result, new Date(CLOCK()), null));
}

/** The run's triage over the fixture: no secret named, the chain landing on the spied public tracker. */
function triageFor(f: Fixture): StartTriage {
  return createStartTriage({
    repoRoot: f.root,
    config: { trackerDefault: 'local', trackerFallback: [], prerequisitesRequired: [], prerequisitesOptional: [] },
    env: {},
    resolve: () => Promise.resolve({
      tracker: f.publicSpy.tracker,
      degraded: false,
      fallbackReason: null,
      attempts: [{ kind: 'local', ok: true, reason: null }],
    }),
    privateTracker: createPrivateTriageTracker(f.root, { now: CLOCK }),
  });
}

/** The blocked task of the fixture, dispatched under `sessionId`. */
function taskInput(f: Fixture, sessionId = 'session-1'): TaskTriageInput {
  return {
    trackerPath: f.trackerPath,
    lineNum: TASK_LINE,
    planStub: 'demo',
    dispatch: { sessionId, taskText: 'Wire the loop', output: OUTPUT },
    outcome: 'done',
  };
}

/** The issue files under `dir`. */
function issueNames(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.md'))
    : [];
}

/** What the active output was handed. */
interface Captured {
  readonly info: string[];
  readonly events: CliEvent[];
}

/** Sets a sink output as the active output, answering its notes and events. */
function capture(): Captured {
  const captured: Captured = { info: [], events: [] };
  setActiveOutput(sinkOutput({
    info: (message) => {
      captured.info.push(message);
    },
    event: (event) => {
      captured.events.push(event);
    },
  }));
  return captured;
}

/** The note naming {@link FAILURE} as inherited, with nothing commented on. */
const INHERITED_NOTE =
  '   Triage: out_of_scope_bugs[0]: inherited: the run-start failure src/parse/parse.test.ts > parse > drops the last line;'
  + ' nothing was filed.';

describe('a run-start baseline holding the reported failure', () => {
  it('files nothing, names the failure in a note and one inherited event, and calls no tracker', async () => {
    const f = fixture();
    writeRedBaseline(f);
    const captured = capture();

    const result = await triageFor(f)(taskInput(f));

    expect(result?.bugs.map((bug) => bug.action)).toEqual(['inherited']);
    expect(issueNames(f.publicDir)).toEqual([]);
    expect(f.publicSpy.calls).toEqual(['find']);
    expect(captured.info).toContain(INHERITED_NOTE);
    expect(captured.events).toEqual([
      expect.objectContaining({
        type: 'event',
        name: 'inherited',
        summary: 'inherited        src/parse/parse.test.ts > parse > drops the last line',
        data: { file: FAILURE.file, name: FAILURE.name },
      }),
    ]);
  });

  it('is read once per run, and the issue its key finds is commented on once for two reports', async () => {
    const f = fixture();
    const captured = capture();
    // A run with no baseline files the bug, so the next run's key finds an open issue.
    await triageFor(f)(taskInput(f, 'session-0'));
    expect(f.publicSpy.calls).toEqual(['find', 'create']);
    writeRedBaseline(f);
    const triage = triageFor(f);

    const first = await triage(taskInput(f, 'session-1'));
    rmSync(f.baselinePath);
    const second = await triage(taskInput(f, 'session-2'));

    expect(first?.bugs.map((bug) => [bug.action, bug.ref?.externalId])).toEqual([['inherited', '1']]);
    expect(second?.bugs.map((bug) => [bug.action, bug.ref])).toEqual([['inherited', null]]);
    expect(f.publicSpy.calls.slice(2)).toEqual(['get', 'comment']);
    expect(issueNames(f.publicDir)).toHaveLength(1);
    expect(captured.events.map((event) => event.type === 'event' && event.name)).toEqual(['inherited', 'inherited']);
  });
});

describe('a run-start baseline that names no failure', () => {
  /** Each reading that inherits nothing, beside how its baseline is left. */
  const READINGS: readonly (readonly [string, (f: Fixture) => void])[] = [
    ['missing', () => {}],
    ['unreadable', (f) => {
      writeFileSync(f.baselinePath, '{ not json', 'utf8');
    }],
    ['without a JUnit reading', (f) => {
      writeRedBaseline(f, 'missing');
    }],
  ];

  it.each(READINGS)('inherits nothing when %s: the bug is filed and no inherited line or event is printed', async (_, leave) => {
    const f = fixture();
    leave(f);
    const captured = capture();

    const result = await triageFor(f)(taskInput(f));

    expect(runStartFailures(f.trackerPath)).toEqual([]);
    expect(result?.bugs.map((bug) => bug.action)).toEqual(['filed']);
    expect(f.publicSpy.calls).toEqual(['find', 'create']);
    expect(issueNames(f.publicDir)).toHaveLength(1);
    expect(captured.info.some((line) => line.includes('inherited'))).toBe(false);
    expect(captured.events).toEqual([]);
  });
});

describe('runStartFailures', () => {
  it('answers the failures of a read baseline, and none for a tracker whose name names no baseline', () => {
    const f = fixture();
    writeRedBaseline(f);

    expect(runStartFailures(f.trackerPath)).toEqual([FAILURE]);
    expect(runStartFailures(join(f.root, 'tracker.md'))).toEqual([]);
  });
});

describe('the note for an inherited bug', () => {
  const unset = { ref: null, foundBy: null, stored: null, problem: null } as const;

  it('names the run-start failure and the issue commented on, or a red test when no failure is named', () => {
    const result = {
      blocker: { text: null, written: false, problem: null },
      bugs: [
        { ...unset, index: 0, channel: 'public', action: 'inherited' },
        {
          ...unset,
          index: 1,
          channel: 'public',
          action: 'inherited',
          ref: { opt: 0, kind: 'github', externalId: '7', url: null },
          foundBy: 'store',
        },
        { ...unset, index: 2, channel: 'public', action: 'inherited' },
      ],
    } as const;

    expect(describeStartTriage(result, new Map([[0, FAILURE], [1, FAILURE]])).notes).toEqual([
      INHERITED_NOTE.trim(),
      'Triage: out_of_scope_bugs[1]: inherited: the run-start failure src/parse/parse.test.ts > parse > drops the last line;'
        + ' nothing was filed, and github issue 7 on the public tracker, found by its stored reference, was commented on.',
      'Triage: out_of_scope_bugs[2]: inherited: a red test the run started with; nothing was filed.',
    ]);
  });
});
