/**
 * Tests for the `docs` channel (`src/triage/stale-docs.ts`): the row each
 * `stale_docs` entry is answered with, its one redacted line, and that
 * `triageReport` reaches no tracker for one.
 *
 * {@link triageStaleDocs} is pure, a list and a function in and rows out,
 * so its cases are literal entries. The cases through `triageReport` run
 * over {@link refusingTracker} fakes for BOTH trackers: every method of
 * one records its name and then refuses, and {@link triageUncalled}
 * fails its case when either fake recorded anything. The record is what
 * fails the case, not the refusal: `triageReport` answers a tracker that
 * rejects as a `failed` bug and goes on, so a fake that only threw would
 * let a call through unseen.
 *
 * An empty record would also be what a fake nothing could reach gives,
 * so the absence sits beside a control: the same fakes under a report
 * holding a bug record the bug's `create`, and the same assertion throws
 * over them. Every root is made under one temporary directory this file
 * creates and removes.
 *
 * Ten mutations were driven against this file alone on 2026-10-14, one at
 * a time, 13 green before and after and both sources restored
 * sha256-identical. Each reddened (fail counts):
 *
 *   - In `triage.ts`: the call handed an empty list 4, a public `find`
 *     made and swallowed for a report with entries 5, a private `comment`
 *     made and swallowed for one 5.
 *   - In `stale-docs.ts`: the channel `machine` 6, the action `failed` 6,
 *     the line not redacted 2, not cut to one line 2, cut before it is
 *     redacted 1, a blank `where` named 1, every index 0 2.
 */
import type { BugTriage, NamedSecret, TriageOptions, TriageResult } from './triage.js';
import type { Tracker, TrackerKind } from '../ports/index.js';
import type { ReportBug, ReportStaleDoc, TaskReport } from '../report/parse.js';

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseReport } from '../report/parse.js';

import { HOME_MARKER } from './local-paths.js';
import { staleDocSentence, triageStaleDocs } from './stale-docs.js';
import { triageReport } from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-stale-docs-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The tracker file every root holds, and its one task line. */
const TRACKER_FILE = 'PLAN_TRACKER-demo.md';
const TRACKER_TEXT = ['# Plan: demo', '', '- [ ] Wire the loop', ''].join('\n');
const TASK_LINE = 2;

/** A home no case's root sits under. */
const HOME = '/home/alice';

/** A redactor that changes nothing. */
const AS_WRITTEN = (text: string): string => text;

/** A tracker whose every call is recorded and then refused. */
interface Refusing {
  readonly tracker: Tracker;
  /** The method of every call received, in order. */
  readonly calls: string[];
}

/** A tracker of `kind` that records each call and refuses it; see the file note. */
function refusingTracker(kind: TrackerKind): Refusing {
  const calls: string[] = [];
  const refusal = (method: string): Error => new Error(`the ${kind} tracker fake was called: ${method}`);
  const refuse = (method: string) => (): Promise<never> => {
    calls.push(method);
    return Promise.reject(refusal(method));
  };
  return {
    calls,
    tracker: {
      kind,
      capabilities: () => {
        calls.push('capabilities');
        throw refusal('capabilities');
      },
      preflight: refuse('preflight'),
      find: refuse('find'),
      get: refuse('get'),
      create: refuse('create'),
      comment: refuse('comment'),
      transition: refuse('transition'),
      openIssues: refuse('openIssues'),
      editable: refuse('editable'),
      edit: refuse('edit'),
    },
  };
}

/** The two fakes one triage runs over. */
interface Fakes {
  readonly publicFake: Refusing;
  readonly privateFake: Refusing;
}

function fakes(): Fakes {
  return { publicFake: refusingTracker('github'), privateFake: refusingTracker('local') };
}

/** Every call either fake received, the public one's first, each as `<tracker>.<method>`. */
function callsOf({ publicFake, privateFake }: Fakes): string[] {
  return [
    ...publicFake.calls.map((method) => `public.${method}`),
    ...privateFake.calls.map((method) => `private.${method}`),
  ];
}

/** Fails the case when either fake received a call. */
function expectNoTrackerCall(over: Fakes): void {
  expect(callsOf(over)).toEqual([]);
}

/** One case's root and the tracker file in it. */
interface Root {
  readonly path: string;
  readonly trackerPath: string;
}

function freshRoot(): Root {
  const path = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(path, { recursive: true });
  const trackerPath = join(path, TRACKER_FILE);
  writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');
  return { path, trackerPath };
}

function reportWith(parts: Partial<TaskReport> = {}): TaskReport {
  return {
    status: 'done',
    feedback: 'Wired the loop.',
    findings: [],
    skillsUsed: [],
    blockers: [],
    outOfScopeBugs: [],
    changes: [],
    staleDocs: [],
    extras: [],
    ...parts,
  };
}

function staleDoc(where: string | null, what: string): ReportStaleDoc {
  return { where, what, extras: [] };
}

/** A bug with no artifact: it has no key, so it is filed with one `create` and no lookup. */
function bug(what: string, security: boolean): ReportBug {
  return { what, artifact: null, security, extras: [] };
}

/** The row an entry at `index` is answered with, its line `problem`. */
function docsRow(index: number, problem: string): BugTriage {
  return { index, channel: 'docs', action: 'skipped', ref: null, foundBy: null, stored: null, problem };
}

function triageOver(
  over: Fakes,
  root: Root,
  report: TaskReport,
  extra: Partial<TriageOptions> = {},
): Promise<TriageResult> {
  return triageReport({
    repoRoot: root.path,
    trackerPath: root.trackerPath,
    lineNum: TASK_LINE,
    dispatch: { sessionId: 'session-1', planStub: 'demo', taskLine: 'Wire the loop' },
    outcome: 'done',
    report,
    tracker: over.publicFake.tracker,
    privateTracker: over.privateFake.tracker,
    secrets: [],
    home: HOME,
    ...extra,
  });
}

/** Triages `report` over two fresh fakes, failing the case on any call either received. */
async function triageUncalled(
  root: Root,
  report: TaskReport,
  extra: Partial<TriageOptions> = {},
): Promise<TriageResult> {
  const over = fakes();
  const result = await triageOver(over, root, report, extra);
  expectNoTrackerCall(over);
  return result;
}

const PAGE = staleDoc('context/triage.md:12', 'the page says three channels, and there are four');
const PAGE_LINE = 'stale_docs[0] is stale documentation at context/triage.md:12:'
  + ' the page says three channels, and there are four';

describe('triageStaleDocs', () => {
  it('answers one skipped row per entry on the docs channel, in the order of the list', () => {
    const rows = triageStaleDocs([PAGE, staleDoc('README.md', 'names a removed flag')], AS_WRITTEN);

    expect(rows).toEqual([
      docsRow(0, PAGE_LINE),
      docsRow(1, 'stale_docs[1] is stale documentation at README.md: names a removed flag'),
    ]);
  });

  it('answers none for a list of none', () => {
    expect(triageStaleDocs([], AS_WRITTEN)).toEqual([]);
  });

  it('names the place an entry gives, and leaves it out for a null or a blank one', () => {
    expect(staleDocSentence(PAGE))
      .toBe('stale documentation at context/triage.md:12: the page says three channels, and there are four');
    expect(staleDocSentence(staleDoc(null, 'names a removed flag'))).toBe('stale documentation: names a removed flag');
    expect(staleDocSentence(staleDoc('  ', 'names a removed flag'))).toBe('stale documentation: names a removed flag');

    const [unplaced] = triageStaleDocs([staleDoc(null, 'names a removed flag')], AS_WRITTEN);

    expect(unplaced!.problem).toBe('stale_docs[0] is stale documentation: names a removed flag');
  });

  it('cuts a text written over several lines to one', () => {
    const entry = staleDoc('context/cli.md:40\t', 'first line\nsecond  line\n');

    // Control: the sentence itself still holds the breaks the row loses.
    expect(staleDocSentence(entry)).toContain('first line\nsecond  line\n');

    const [row] = triageStaleDocs([entry], AS_WRITTEN);

    expect(row!.problem).toBe('stale_docs[0] is stale documentation at context/cli.md:40 : first line second line');
  });

  it('redacts through the function it is handed, before the text is cut to a line', () => {
    const secret = 'tok\nen';
    const entry = staleDoc('docs/deploy.md', `the page quotes ${secret} in its example`);
    const redact = (text: string): string => text.replaceAll(secret, '[redacted: DEPLOY_TOKEN]');

    const [row] = triageStaleDocs([entry], redact);

    expect(row!.problem)
      .toBe('stale_docs[0] is stale documentation at docs/deploy.md: the page quotes [redacted: DEPLOY_TOKEN] in its example');

    // Control: unredacted, the same entry keeps the value, joined to one line.
    const [written] = triageStaleDocs([entry], AS_WRITTEN);

    expect(written!.problem).toContain('the page quotes tok en in its example');
  });

  it('numbers an entry by its place in the parsed list, which leaves out one with no what', () => {
    const output = [
      '```rafa:report',
      'status: done',
      'stale_docs:',
      '  - where: "context/a.md:1"',
      '  - where: "context/b.md:2"',
      '    what: "says three channels"',
      '```',
    ].join('\n');
    const reading = parseReport(output);
    if (!reading.present) throw new Error('the fixture output holds no report');

    // Control: the parser saw both entries, and named the dropped one by where it was written.
    expect(reading.issues.map((issue) => issue.field)).toContain('stale_docs[0].what');

    expect(triageStaleDocs(reading.report.staleDocs, AS_WRITTEN)).toEqual([
      docsRow(0, 'stale_docs[0] is stale documentation at context/b.md:2: says three channels'),
    ]);
  });
});

describe('the stale_docs entries of a report, triaged', () => {
  it('are each answered as skipped on docs, with no call to either tracker', async () => {
    const report = reportWith({ staleDocs: [PAGE, staleDoc(null, 'names a removed flag')] });

    const result = await triageUncalled(freshRoot(), report);

    expect(result.staleDocs).toEqual([
      docsRow(0, PAGE_LINE),
      docsRow(1, 'stale_docs[1] is stale documentation: names a removed flag'),
    ]);
    expect(result.bugs).toEqual([]);
    expect(result.blocker).toEqual({ text: null, written: false, problem: null });
  });

  it('control: the same fakes record the create of a bug, and the same assertion fails over them', async () => {
    const publicOnly = fakes();
    const publicResult = await triageOver(publicOnly, freshRoot(), reportWith({
      outOfScopeBugs: [bug('Parser drops the last line', false)],
    }));

    expect(callsOf(publicOnly)).toEqual(['public.create']);
    expect(publicResult.bugs[0]).toMatchObject({
      channel: 'public',
      action: 'failed',
      problem: 'the public tracker create failed: the github tracker fake was called: create',
    });
    expect(() => expectNoTrackerCall(publicOnly)).toThrow();

    const privateOnly = fakes();
    await triageOver(privateOnly, freshRoot(), reportWith({
      outOfScopeBugs: [bug('A token reaches the log', true)],
    }));

    expect(callsOf(privateOnly)).toEqual(['private.create']);
    expect(() => expectNoTrackerCall(privateOnly)).toThrow();
  });

  it('add no call to those of the bugs beside them, and are answered whatever the tracker does', async () => {
    const over = fakes();
    const report = reportWith({
      outOfScopeBugs: [bug('Parser drops the last line', false)],
      staleDocs: [PAGE],
    });

    const result = await triageOver(over, freshRoot(), report);

    expect(callsOf(over)).toEqual(['public.create']);
    expect(result.bugs.map(({ channel, action }) => [channel, action])).toEqual([['public', 'failed']]);
    expect(result.staleDocs).toEqual([docsRow(0, PAGE_LINE)]);
  });

  it('are none for a report listing none', async () => {
    const result = await triageUncalled(freshRoot(), reportWith());

    expect(result.staleDocs).toEqual([]);
  });

  it('are not read for a machine fault, so a page naming a toolchain stays on docs', async () => {
    const toolchain = staleDoc('docs/build.md', 'still says a tapi error means reinstalling the SDK');

    const result = await triageUncalled(freshRoot(), reportWith({ staleDocs: [toolchain] }));

    expect(result.staleDocs).toEqual([
      docsRow(0, 'stale_docs[0] is stale documentation at docs/build.md: still says a tapi error means reinstalling the SDK'),
    ]);

    // Control: the same text as a bug is read as a machine fault.
    const asBug = await triageUncalled(freshRoot(), reportWith({ outOfScopeBugs: [bug(toolchain.what, false)] }));

    expect(asBug.bugs[0]).toMatchObject({ channel: 'machine', action: 'skipped' });
  });

  it('leave the root as it was: no store, no issue file, and the tracker file byte for byte', async () => {
    const root = freshRoot();

    await triageUncalled(root, reportWith({ staleDocs: [PAGE] }));

    expect(readdirSync(root.path)).toEqual([TRACKER_FILE]);
    expect(readFileSync(root.trackerPath, 'utf8')).toBe(TRACKER_TEXT);

    // Control: a security bug over the default private tracker writes under the same root.
    const over = fakes();
    const filed = await triageOver(over, root, reportWith({
      outOfScopeBugs: [bug('A token reaches the log', true)],
    }), { privateTracker: undefined });

    expect(filed.bugs[0]).toMatchObject({ channel: 'private', action: 'filed' });
    expect(readdirSync(root.path).sort()).toEqual(['.rafa', TRACKER_FILE]);
    expectNoTrackerCall(over);
  });

  it('have their line redacted of a named secret, the root and the home', async () => {
    const root = freshRoot();
    const secrets: readonly NamedSecret[] = [{ name: 'DEPLOY_TOKEN', value: 'dpl-7f3a9c' }];
    const entry = staleDoc(
      `${root.path}/context/triage.md:12`,
      `the page quotes dpl-7f3a9c from ${HOME}/.config/rafa`,
    );
    const report = reportWith({ staleDocs: [entry] });

    const result = await triageUncalled(root, report, { secrets });

    expect(result.staleDocs).toEqual([
      docsRow(0, 'stale_docs[0] is stale documentation at context/triage.md:12:'
        + ` the page quotes [redacted: DEPLOY_TOKEN] from ${HOME_MARKER}/.config/rafa`),
    ]);

    // Control: with no secret named, the same reading sees the value.
    const unnamed = await triageUncalled(root, report);

    expect(unnamed.staleDocs[0]!.problem).toContain('the page quotes dpl-7f3a9c from');
  });
});
