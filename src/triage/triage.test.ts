/**
 * Tests for loop-owned triage (`src/triage/triage.ts`).
 *
 * Every repo root, tracker file, store and issue directory is made under
 * one temporary directory this file creates and removes; no case writes
 * under the repository or the home. Both trackers are real `local`
 * trackers under the case's root, each wrapped in a spy that records
 * every call before handing it on, so a case asserts what was asked of a
 * tracker and reads what it did off the disk. A filed title, body or
 * comment is read back off the issue file, never off what the module
 * answered, and a stored reference off the `findings` table through
 * `bun:sqlite`.
 *
 * Each absence sits beside a control that the same reading can see the
 * thing: the private route's untouched public spy beside a public bug the
 * same spy records, a redacted body beside the same bug filed with no
 * secrets holding the value, an untouched tracker file beside a write.
 *
 * Thirty-one mutations of `triage.ts` were driven against this file alone
 * on 2026-09-15, the unmutated module green twice before each grid and
 * restored sha256-identical after every mutation. On the first grid, of
 * 31 cases, thirty ran and twenty-nine reddened (fail counts):
 *
 *   - Routing: a missing flag routed public 1, the private route filing to
 *     the public tracker 5, the default private tracker over
 *     `.rafa/issues` 5, the kind check dropped 1, the identity check
 *     dropped 1, the refusal made after the blocker write 1.
 *   - Lookup: the public store lookup skipped 4, a stored reference of any
 *     kind used 1, `find` not narrowed to `bug` 2, a bug with no artifact
 *     looked up 3, a blank artifact taken as a key 1, an unreadable store
 *     filing anyway 1, a recurrence found in the store stored again 1.
 *   - Filing: a priority set 1, the type `code` 2, the fence fixed at three
 *     backticks 1, a blank `what` filed 1, a step rethrowing 3, the
 *     store's problem dropped 1.
 *   - Blockers: the first text alone written 1, a blank text kept 1.
 *   - Secrets: `find` asked for the raw artifact 1, the title cut before
 *     redaction 1, section values unredacted 3, the trimmed form not
 *     redacted 1, the shortest value tried first 2, values not escaped 1,
 *     the optional tier dropped 1, names not deduplicated 1.
 *
 * A problem left unredacted stayed green, and reddens the failing-tracker
 * problem case added for it alone (1 of 32). A blank variable named as a
 * secret was not run on the first grid, its string matching two places;
 * spelled to match one, it reddened the unset, empty or blank case (1).
 *
 * That grid was driven against the module as it keyed a bug on its
 * artifact alone. The lookup now keys on the artifact with the tracker
 * file it was reported against, so the grid's counts are of the earlier
 * module and no line of it was re-measured here; the cases under `bug
 * identity keyed by artifact and tracker file` are the readings for the
 * key itself.
 */
import type { NamedSecret, TriageOptions, TriageResult } from './triage.js';
import type { FindingsDispatch } from '../effort/store/findings.js';
import type { IssueDraft, IssueRef, Tracker } from '../ports/index.js';
import type { ReportBlocker, ReportBug, TaskReport } from '../report/parse.js';

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
import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalTracker, localIssuesDir, parseLocalIssue } from '../adapters/tracker/local.js';
import { writeFindings } from '../effort/store/findings.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import { readTrackerRef, writeTrackerRef } from '../effort/store/tracker-refs.js';
import { findNextTask } from '../utils/tracker.js';

import {
  blockerTextOf,
  bugKeyOf,
  createPrivateTriageTracker,
  issueTitle,
  namedSecrets,
  PRIVATE_TRIAGE_DIR,
  privateTriageDir,
  redactSecrets,
  TITLE_MAX_LENGTH,
  triageReport,
} from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-triage-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The clock both trackers stamp with. */
const CLOCK = (): string => '2026-09-15T08:00:00.000Z';

const TRACKER_TEXT = [
  '# Plan: demo',
  '',
  '- [x] Ship the parser',
  '- [BLOCKED] Wire the loop  {agent=loop-implementer}',
  '- [ ] Write the docs',
  '',
].join('\n');

/** The blocked task line of {@link TRACKER_TEXT}, counting from zero. */
const BLOCKED_LINE = 3;

/** Its ticked line. */
const TICKED_LINE = 2;

const FIRST: FindingsDispatch = { sessionId: 'session-1', planStub: 'demo', taskLine: 'Wire the loop' };
const SECOND: FindingsDispatch = { sessionId: 'session-2', planStub: 'demo', taskLine: 'Wire the loop' };

const ARTIFACT = 'TypeError: lines.at(-1) is undefined';

/** The tracker file every fixture writes the plan's task lines into. */
const TRACKER_FILE = 'PLAN_TRACKER-demo.md';

/** The key {@link ARTIFACT} reported against that file is looked up under. */
const KEY = bugKeyOf(TRACKER_FILE, ARTIFACT);

/** One call a spied tracker received. */
type TrackerCall = readonly [method: string, argument: unknown];

/** A tracker that records every call before handing it on. */
interface Spied {
  readonly tracker: Tracker;
  readonly calls: TrackerCall[];
}

/** Wraps `inner`, replacing any of `create`, `find` and `comment` with `overrides`. */
function spy(inner: Tracker, overrides: Partial<Pick<Tracker, 'create' | 'find' | 'comment'>> = {}): Spied {
  const calls: TrackerCall[] = [];
  const create = overrides.create ?? inner.create;
  const find = overrides.find ?? inner.find;
  const comment = overrides.comment ?? inner.comment;
  const tracker: Tracker = {
    kind: inner.kind,
    capabilities: inner.capabilities,
    preflight: inner.preflight,
    find: (query) => {
      calls.push(['find', query]);
      return find(query);
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
      return comment(ref, body);
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

/** One case's root, tracker file and spied trackers. */
interface Fixture {
  readonly root: string;
  readonly trackerPath: string;
  readonly publicDir: string;
  readonly privateDir: string;
  readonly publicSpy: Spied;
  readonly privateSpy: Spied;
}

/** A fresh root under the temporary directory, its public tracker's calls replaced by `overrides`. */
function fixture(overrides: Partial<Pick<Tracker, 'create' | 'find' | 'comment'>> = {}): Fixture {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  const trackerPath = join(root, TRACKER_FILE);
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

function reportWith(parts: Partial<TaskReport> = {}): TaskReport {
  return {
    status: 'blocked',
    feedback: 'Built the module; the hook refused the commit.',
    findings: [],
    skillsUsed: [],
    blockers: [],
    outOfScopeBugs: [],
    extras: [],
    ...parts,
  };
}

function bug(what: string | null, artifact: string | null, security: boolean | null): ReportBug {
  return { what, artifact, security, extras: [] };
}

function blocker(what: string | null): ReportBlocker {
  return { what, artifact: null, extras: [] };
}

function triage(f: Fixture, report: TaskReport, extra: Partial<TriageOptions> = {}): Promise<TriageResult> {
  return triageReport({
    repoRoot: f.root,
    trackerPath: f.trackerPath,
    lineNum: BLOCKED_LINE,
    dispatch: FIRST,
    outcome: 'blocked',
    report,
    tracker: f.publicSpy.tracker,
    privateTracker: f.privateSpy.tracker,
    secrets: [],
    ...extra,
  });
}

/** Every issue file under `dir`, lowest number first, as its bytes. */
function issueFiles(dir: string): { readonly name: string; readonly contents: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => ({ name, contents: readFileSync(join(dir, name), 'utf8') }));
}

/** The one issue file under `dir`, parsed. Fails the case unless there is exactly one. */
function onlyIssue(dir: string): ReturnType<typeof parseLocalIssue> & { readonly contents: string } {
  const files = issueFiles(dir);
  expect(files.map(({ name }) => name)).toEqual(['1.md']);
  const contents = files[0]!.contents;
  return { ...parseLocalIssue(contents), contents };
}

/** Every findings row, oldest first: what it is keyed by and its reference. */
function findingRows(root: string): { artifact: string | null; tracker_ref: string | null }[] {
  const path = sqliteStorePath(root);
  if (!existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<{ artifact: string | null; tracker_ref: string | null }, []>(
        'SELECT artifact, tracker_ref FROM findings ORDER BY seq',
      )
      .all();
  } finally {
    db.close();
  }
}

/** A findings row holding a reference, as the table holds it. */
interface RefRow {
  readonly session_id: string;
  readonly artifact: string;
  readonly tracker_ref: string;
}

/** Every findings row holding a reference, oldest first; none without a store. */
function refRows(root: string): RefRow[] {
  const path = sqliteStorePath(root);
  if (!existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<RefRow, []>('SELECT session_id, artifact, tracker_ref FROM findings WHERE tracker_ref IS NOT NULL ORDER BY seq')
      .all();
  } finally {
    db.close();
  }
}

/** A fenced value, as the body shows one. */
function fence(value: string): string {
  return ['```', value, '```'].join('\n');
}

describe('namedSecrets', () => {
  it('names every env prerequisite of both tiers, then each token variable that is set', () => {
    const config = {
      prerequisitesRequired: [
        { kind: 'env', name: 'DB_URL', probe: null },
        { kind: 'tool', name: 'bun', probe: null },
      ],
      prerequisitesOptional: [
        { kind: 'env', name: 'SENTRY_DSN', probe: null, reason: null },
        { kind: 'env', name: 'GITHUB_TOKEN', probe: null, reason: null },
      ],
    } as const;
    const env = {
      DB_URL: 'postgres://u:p@h/app',
      SENTRY_DSN: 'dsn-1',
      GITHUB_TOKEN: 'ghp_token',
      ANTHROPIC_API_KEY: 'sk-ant-key',
      bun: 'a tool, not a secret',
    };

    expect(namedSecrets(config, env)).toEqual([
      { name: 'DB_URL', value: 'postgres://u:p@h/app' },
      { name: 'SENTRY_DSN', value: 'dsn-1' },
      { name: 'GITHUB_TOKEN', value: 'ghp_token' },
      { name: 'ANTHROPIC_API_KEY', value: 'sk-ant-key' },
    ]);
  });

  it('names nothing for a variable unset, empty or blank', () => {
    const config = {
      prerequisitesRequired: [{ kind: 'env', name: 'EMPTY', probe: null }],
      prerequisitesOptional: [{ kind: 'env', name: 'BLANK', probe: null, reason: null }],
    } as const;

    expect(namedSecrets(config, { EMPTY: '', BLANK: '  \n', LINEAR_API_KEY: undefined })).toEqual([]);
    expect(namedSecrets(config, { LINEAR_API_KEY: 'lin_key' })).toEqual([
      { name: 'LINEAR_API_KEY', value: 'lin_key' },
    ]);
  });
});

describe('redactSecrets', () => {
  it('replaces every occurrence of each value, and the longer of two overlapping values whole', () => {
    const secrets: NamedSecret[] = [{ name: 'SHORT', value: 'abc' }, { name: 'LONG', value: 'abcdef' }];

    expect(redactSecrets('x abcdef y abc z abc', secrets))
      .toBe('x [redacted: LONG] y [redacted: SHORT] z [redacted: SHORT]');
  });

  it('matches a value trimmed as well, and never a marker it wrote', () => {
    const secrets: NamedSecret[] = [
      { name: 'PADDED', value: 'tok-123\n' },
      { name: 'WORD', value: 'redacted' },
    ];

    expect(redactSecrets('a tok-123\n b tok-123 c redacted', secrets))
      .toBe('a [redacted: PADDED] b [redacted: PADDED] c [redacted: WORD]');
  });

  it('matches regular expression characters literally', () => {
    const secrets: NamedSecret[] = [{ name: 'DOTTED', value: 'a.b+' }];

    expect(redactSecrets('axbb stays, a.b+ goes', secrets)).toBe('axbb stays, [redacted: DOTTED] goes');
  });

  it('answers the text unchanged with no secrets', () => {
    expect(redactSecrets('nothing to take out', [])).toBe('nothing to take out');
  });
});

describe('issueTitle', () => {
  it('puts the text on one line and cuts it to the cap', () => {
    expect(issueTitle('Parser drops\n  the last line ')).toBe('Parser drops the last line');

    const cut = issueTitle('w'.repeat(TITLE_MAX_LENGTH + 10));
    expect(Array.from(cut)).toHaveLength(TITLE_MAX_LENGTH);
    expect(cut.endsWith('...')).toBe(true);
  });
});

describe('blockers', () => {
  it('writes the text of every blocker that has one onto the task line, where findNextTask reads it', async () => {
    const f = fixture();
    const report = reportWith({ blockers: [blocker('hook refused'), blocker(null), blocker('lint red')] });

    const result = await triage(f, report);

    expect(result.blocker).toEqual({ text: 'hook refused; lint red', written: true, problem: null });
    const next = findNextTask(readFileSync(f.trackerPath, 'utf8'));
    expect(next).toEqual({
      task: 'Wire the loop  {agent=loop-implementer}',
      lineNum: BLOCKED_LINE,
      status: 'blocked',
      blocker: 'hook refused; lint red',
    });
    expect(blockerTextOf(report.blockers)).toBe('hook refused; lint red');
  });

  it('leaves the tracker file byte-identical for a report with no blocker text', async () => {
    const f = fixture();

    const result = await triage(f, reportWith({ blockers: [blocker(null), blocker('   ')] }));

    expect(result.blocker).toEqual({ text: null, written: false, problem: null });
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
  });

  it('does not write a ticked line, and names the line', async () => {
    const f = fixture();

    const result = await triage(f, reportWith({ blockers: [blocker('hook refused')] }), { lineNum: TICKED_LINE });

    expect(result.blocker.written).toBe(false);
    expect(result.blocker.problem).toBe('tracker line 3 is no open or blocked task line with text');
    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
  });
});

describe('a public bug', () => {
  it('is filed as one needs-triage bug after the tracker finds none, and its reference is stored', async () => {
    const f = fixture();

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));

    const issue = onlyIssue(f.publicDir);
    expect(methodsOf(f.publicSpy)).toEqual(['find', 'create']);
    expect(f.publicSpy.calls[0]![1]).toEqual({ text: KEY, type: 'bug' });
    expect(issue.draft).toEqual({
      opt: 0,
      title: 'Parser drops the last line',
      body: [
        'An out-of-scope bug a rafa task session reported. The loop filed it and dispatches no task for it: a plan that wants it fixed declares a task.',
        `## What\n\n${fence('Parser drops the last line')}`,
        `## Artifact\n\n${fence(ARTIFACT)}`,
        `## Recurrence key\n\n${fence(KEY)}`,
        `## Plan\n\n${fence('demo')}`,
        `## Task\n\n${fence('Wire the loop')}`,
        `## Feedback\n\n${fence('Built the module; the hook refused the commit.')}`,
      ].join('\n\n') + '\n',
      type: 'bug',
      module: 'unassigned',
      priority: null,
      project: null,
      blockedBy: [],
    });

    const ref: IssueRef = { opt: 0, kind: 'local', externalId: '1', url: null };
    expect(result.bugs).toEqual([{
      index: 0,
      channel: 'public',
      action: 'filed',
      ref,
      foundBy: null,
      stored: 'inserted',
      problem: null,
    }]);
    expect(refRows(f.root)).toEqual([{ session_id: 'session-1', artifact: KEY, tracker_ref: JSON.stringify(ref) }]);
    expect(readTrackerRef(f.root, KEY)).toEqual(ref);
    // Control: the artifact alone keys nothing, so another file's bug reads no reference.
    expect(readTrackerRef(f.root, ARTIFACT)).toBeNull();
    expect(f.privateSpy.calls).toEqual([]);
    expect(existsSync(f.privateDir)).toBe(false);
  });

  it('is commented on the stored issue when a later session reports its artifact, with no lookup and no second issue', async () => {
    const f = fixture();
    await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));
    const callsBefore = f.publicSpy.calls.length;

    const result = await triage(f, reportWith({
      feedback: 'Seen again while wiring the loop.',
      outOfScopeBugs: [bug('Last line lost again', ARTIFACT, false)],
    }), { dispatch: SECOND });

    expect(methodsOf(f.publicSpy).slice(callsBefore)).toEqual(['comment']);
    expect(result.bugs[0]).toMatchObject({ action: 'commented', foundBy: 'store', stored: null, problem: null });
    const issue = onlyIssue(f.publicDir);
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0]!.startsWith(`${CLOCK()}: Reported again by a rafa task session.`)).toBe(true);
    expect(issue.comments[0]).toContain(fence('Last line lost again'));
    expect(issue.comments[0]).toContain(fence('Seen again while wiring the loop.'));
    // The comment carries the key, so an issue filed before this rafa gains one.
    expect(issue.comments[0]).toContain(`## Recurrence key\n\n${fence(KEY)}`);
    expect(refRows(f.root).map((row) => row.session_id)).toEqual(['session-1']);
  });

  it('is commented on an issue the tracker holds under its key when no reference is stored, which it then stores', async () => {
    const f = fixture();
    const held = await createLocalTracker({ issuesDir: f.publicDir, fallbackReason: null, now: CLOCK })
      .create({
        opt: 0,
        title: 'Filed from another checkout',
        body: `## Recurrence key\n\n${fence(KEY)}\n`,
        type: 'bug',
        module: 'x',
        priority: null,
        project: null,
        blockedBy: [],
      });

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));

    expect(methodsOf(f.publicSpy)).toEqual(['find', 'comment']);
    expect(result.bugs[0]).toMatchObject({ action: 'commented', ref: held, foundBy: 'find', stored: 'inserted' });
    expect(onlyIssue(f.publicDir).comments).toHaveLength(1);
    expect(readTrackerRef(f.root, KEY)).toEqual(held);
  });

  it('is filed beside an issue that quotes its artifact under no key of its own', async () => {
    const f = fixture();
    await createLocalTracker({ issuesDir: f.publicDir, fallbackReason: null, now: CLOCK })
      .create({ opt: 0, title: 'Filed by hand', body: `Seen: ${ARTIFACT}\n`, type: 'bug', module: 'x', priority: null, project: null, blockedBy: [] });

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));

    expect(result.bugs[0]).toMatchObject({ action: 'filed', foundBy: null });
    expect(issueFiles(f.publicDir).map(({ name }) => name)).toEqual(['1.md', '2.md']);
  });

  it('passes over a stored reference of another kind and asks the tracker', async () => {
    const f = fixture();
    const github: IssueRef = { opt: 0, kind: 'github', externalId: '7', url: 'https://github.com/o/r/issues/7' };
    writeTrackerRef(f.root, { dispatch: SECOND, outcome: 'blocked', artifact: KEY, ref: github });

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));

    expect(methodsOf(f.publicSpy)).toEqual(['find', 'create']);
    expect(result.bugs[0]).toMatchObject({ action: 'filed', stored: 'inserted', problem: null });
    expect(onlyIssue(f.publicDir).comments).toEqual([]);
  });

  it('with no artifact is filed every time, with no lookup and no reference stored', async () => {
    const f = fixture();
    const report = reportWith({ outOfScopeBugs: [bug('Flaky clock in CI', null, false), bug('Blank key', '  ', false)] });

    await triage(f, report);
    const again = await triage(f, report, { dispatch: SECOND });

    expect(methodsOf(f.publicSpy)).toEqual(['create', 'create', 'create', 'create']);
    expect(issueFiles(f.publicDir).map(({ name }) => name)).toEqual(['1.md', '2.md', '3.md', '4.md']);
    expect(again.bugs.map((entry) => entry.stored)).toEqual([null, null]);
    expect(refRows(f.root)).toEqual([]);
    expect(parseLocalIssue(issueFiles(f.publicDir)[0]!.contents).draft.body)
      .toContain('## Artifact\n\nThe report gave no artifact, so a recurrence files again.');
  });

  it('sharing an artifact with an earlier bug of the same report is commented on the issue that one filed', async () => {
    const f = fixture();

    const result = await triage(f, reportWith({
      outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false), bug('Same crash, other input', ARTIFACT, false)],
    }));

    expect(result.bugs.map((entry) => [entry.action, entry.foundBy])).toEqual([['filed', null], ['commented', 'store']]);
    expect(onlyIssue(f.publicDir).comments).toHaveLength(1);
  });

  it('with no what is skipped, and nothing is called', async () => {
    const f = fixture();

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug(null, ARTIFACT, false), bug('  ', null, true)] }));

    expect(result.bugs.map((entry) => [entry.channel, entry.action, entry.problem])).toEqual([
      ['public', 'skipped', 'out_of_scope_bugs[0] has no what to file'],
      ['private', 'skipped', 'out_of_scope_bugs[1] has no what to file'],
    ]);
    expect(f.publicSpy.calls).toEqual([]);
    expect(f.privateSpy.calls).toEqual([]);
  });

  it('whose create rejects fails alone: the next bug is filed and the blocker written', async () => {
    let creates = 0;
    const inner = { current: null as Tracker | null };
    const f = fixture({
      create: (draft: IssueDraft) => {
        creates += 1;
        return creates === 1
          ? Promise.reject(new Error('gh: HTTP 502'))
          : inner.current!.create(draft);
      },
    });
    inner.current = createLocalTracker({ issuesDir: f.publicDir, fallbackReason: null, now: CLOCK });

    const result = await triage(f, reportWith({
      blockers: [blocker('hook refused')],
      outOfScopeBugs: [bug('First bug', 'artifact one', false), bug('Second bug', 'artifact two', false)],
    }));

    expect(result.blocker.written).toBe(true);
    expect(result.bugs.map((entry) => [entry.action, entry.problem])).toEqual([
      ['failed', 'the public tracker create failed: gh: HTTP 502'],
      ['filed', null],
    ]);
    expect(onlyIssue(f.publicDir).draft.title).toBe('Second bug');
    expect(refRows(f.root).map((row) => row.artifact)).toEqual([bugKeyOf(TRACKER_FILE, 'artifact two')]);
  });

  it('filed with a reference the store refuses stays filed and names the refusal', async () => {
    const f = fixture({
      create: () => Promise.resolve({ opt: 0, kind: 'local', externalId: ' ', url: null }),
    });

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));

    const [entry] = result.bugs;
    expect(entry).toMatchObject({ action: 'filed', stored: null });
    expect(entry!.problem).toStartWith('storing the reference failed: effort store: tracker ref write has a reference whose externalId is blank');
    expect(refRows(f.root)).toEqual([]);
  });

  it('whose stored reference cannot be read fails with no tracker call', async () => {
    const f = fixture();
    mkdirSync(sqliteStorePath(f.root), { recursive: true });

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));

    expect(result.bugs[0]).toMatchObject({ action: 'failed', ref: null });
    expect(result.bugs[0]!.problem).toStartWith('reading the stored reference failed: ');
    expect(f.publicSpy.calls).toEqual([]);
    expect(issueFiles(f.publicDir)).toEqual([]);
  });
});

describe('bug identity keyed by artifact and tracker file', () => {
  it('two reports of one defect worded differently under one artifact and one file: the second comments on the issue the first filed', async () => {
    const f = fixture();
    await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));

    const result = await triage(f, reportWith({
      feedback: 'Seen again while wiring the loop.',
      outOfScopeBugs: [bug('Loop wiring loses the last line too', ARTIFACT, false)],
    }), { dispatch: SECOND });

    expect(result.bugs[0]).toMatchObject({ action: 'commented', foundBy: 'store', problem: null });
    expect(issueFiles(f.publicDir)).toHaveLength(1);
  });

  it('keeps its reference in a row of its own, beside the finding the report stored under the artifact', async () => {
    const f = fixture();
    writeFindings(f.root, {
      dispatch: FIRST,
      outcome: 'blocked',
      findings: [{
        trigger: 'when parsing', kind: 'gotcha', what: 'lines lost', cause: null, resolution: null,
        artifact: ARTIFACT, signal: 'loud', extras: [],
      }],
    });

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));

    expect(result.bugs[0]).toMatchObject({ action: 'filed', stored: 'inserted', problem: null });
    expect(findingRows(f.root).map((row) => [row.artifact, row.tracker_ref === null])).toEqual([
      [ARTIFACT, true],
      [KEY, false],
    ]);
  });

  it('control: two different defects that share an artifact string across two tracker files stay two issues', async () => {
    const f = fixture();
    const secondTrackerPath = join(f.root, 'PLAN_TRACKER-other.md');
    writeFileSync(secondTrackerPath, TRACKER_TEXT, 'utf8');

    await triage(f, reportWith({ outOfScopeBugs: [bug('Parser drops the last line', ARTIFACT, false)] }));

    const result = await triage(f, reportWith({
      outOfScopeBugs: [bug('Unrelated crash sharing the same message', ARTIFACT, false)],
    }), { dispatch: SECOND, trackerPath: secondTrackerPath });

    expect(result.bugs[0]).toMatchObject({ action: 'filed', foundBy: null });
    expect(issueFiles(f.publicDir)).toHaveLength(2);
  });
});

describe('a security bug', () => {
  /** A finding under the artifact, so a reference write would have a row to attach to. */
  function seedFinding(root: string): void {
    writeFindings(root, {
      dispatch: FIRST,
      outcome: 'blocked',
      findings: [{
        trigger: 'when parsing', kind: 'gotcha', what: 'lines lost', cause: null, resolution: null,
        artifact: ARTIFACT, signal: 'loud', extras: [],
      }],
    });
  }

  it('is filed only to the private tracker, the public one never asked, and no reference is stored', async () => {
    const f = fixture();
    seedFinding(f.root);

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Token printed to the log', ARTIFACT, true)] }));

    expect(result.bugs).toEqual([{
      index: 0,
      channel: 'private',
      action: 'filed',
      ref: { opt: 0, kind: 'local', externalId: '1', url: null },
      foundBy: null,
      stored: null,
      problem: null,
    }]);
    expect(f.publicSpy.calls).toEqual([]);
    expect(methodsOf(f.privateSpy)).toEqual(['find', 'create']);
    expect(onlyIssue(join(f.root, PRIVATE_TRIAGE_DIR)).draft.title).toBe('Token printed to the log');
    expect(existsSync(f.publicDir)).toBe(false);
    expect(refRows(f.root)).toEqual([]);
    expect(readTrackerRef(f.root, KEY)).toBeNull();

    // Control: the same bug unflagged reaches the public spy and the store.
    await triage(f, reportWith({ outOfScopeBugs: [bug('Token printed to the log', ARTIFACT, false)] }));
    expect(methodsOf(f.publicSpy)).toEqual(['find', 'create']);
    expect(refRows(f.root)).toHaveLength(1);
  });

  it('with a missing flag is counted as true', async () => {
    const f = fixture();

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Maybe a leak', ARTIFACT, null)] }));

    expect(result.bugs[0]).toMatchObject({ channel: 'private', action: 'filed' });
    expect(f.publicSpy.calls).toEqual([]);
    expect(issueFiles(f.privateDir)).toHaveLength(1);
  });

  it('recurring is commented on the private issue its own find matches, the public tracker still never asked', async () => {
    const f = fixture();
    const report = reportWith({ outOfScopeBugs: [bug('Token printed to the log', ARTIFACT, true)] });

    await triage(f, report);
    const again = await triage(f, report, { dispatch: SECOND });

    expect(again.bugs[0]).toMatchObject({ channel: 'private', action: 'commented', foundBy: 'find', stored: null });
    expect(methodsOf(f.privateSpy)).toEqual(['find', 'create', 'find', 'comment']);
    expect(onlyIssue(f.privateDir).comments).toHaveLength(1);
    expect(f.publicSpy.calls).toEqual([]);
    expect(refRows(f.root)).toEqual([]);
  });

  it('refuses a private tracker that is not local, or is the public tracker, triaging nothing', async () => {
    const f = fixture();
    const report = reportWith({
      blockers: [blocker('hook refused')],
      outOfScopeBugs: [bug('Token printed to the log', ARTIFACT, true)],
    });

    const notLocal = { ...f.privateSpy.tracker, kind: 'github' };
    await expect(triage(f, report, { privateTracker: notLocal }))
      .rejects.toThrow('triage: refused a private tracker of kind "github"');
    await expect(triage(f, report, { privateTracker: f.publicSpy.tracker }))
      .rejects.toThrow('triage: refused the public tracker as the private one');

    expect(readFileSync(f.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
    expect(f.publicSpy.calls).toEqual([]);
    expect(f.privateSpy.calls).toEqual([]);
  });

  it('defaults to a local tracker under the private triage directory', async () => {
    const f = fixture();

    const result = await triage(f, reportWith({ outOfScopeBugs: [bug('Token printed to the log', null, true)] }), {
      privateTracker: undefined,
    });

    expect(result.bugs[0]).toMatchObject({ channel: 'private', action: 'filed' });
    expect(issueFiles(join(f.root, '.rafa', 'triage', 'private'))).toHaveLength(1);
    expect(f.publicSpy.calls).toEqual([]);
  });
});

describe('a machine-scoped bug', () => {
  /**
   * #17's artifact: a linker failure against an Xcode Command Line Tools
   * SDK installed on the machine the session ran on, not against rafa.
   */
  const LINKER_ARTIFACT = 'ld: tapi error: malformed file: '
    + '\'/Library/Developer/CommandLineTools/SDKs/MacOSX14.4.sdk/usr/lib/libSystem.tbd\' '
    + '(missing \'TBD_OBJC_CONSTRAINT\' token)';

  it('naming a linker failure against an installed SDK is neither filed nor searched for, and kept'
    + ' machine-scoped, beside a rafa bug in the same report that is still filed', async () => {
    const f = fixture();
    const report = reportWith({
      outOfScopeBugs: [
        bug('Build fails linking against the installed SDK', LINKER_ARTIFACT, false),
        bug('Parser drops the last line', ARTIFACT, false),
      ],
    });

    const result = await triage(f, report);

    // The machine-scoped bug: no tracker call of any kind, and never filed.
    expect(result.bugs[0]).toMatchObject({
      index: 0,
      channel: 'machine',
      ref: null,
      foundBy: null,
      stored: null,
    });
    expect(result.bugs[0]!.action).not.toBe('filed');

    // Control: the rafa bug beside it is still filed to the public tracker.
    expect(result.bugs[1]).toMatchObject({ index: 1, channel: 'public', action: 'filed', stored: 'inserted' });
    expect(methodsOf(f.publicSpy)).toEqual(['find', 'create']);
    expect(f.publicSpy.calls[0]![1]).toEqual({ text: KEY, type: 'bug' });
    expect(f.privateSpy.calls).toEqual([]);
    expect(issueFiles(f.publicDir)).toHaveLength(1);
    expect(onlyIssue(f.publicDir).draft.title).toBe('Parser drops the last line');
    expect(refRows(f.root)).toHaveLength(1);
  });
});

describe('named secrets in what is filed', () => {
  const TOKEN = 'ghp_s3cretT0kenValue';
  const DB = 'postgres://app:hunter2@db.internal/app';
  const SECRETS: NamedSecret[] = [{ name: 'GITHUB_TOKEN', value: TOKEN }, { name: 'DB_URL', value: DB }];

  /** A report and a dispatch holding both secrets in every value that is filed. */
  function leakyOptions(): { report: TaskReport; dispatch: FindingsDispatch } {
    return {
      report: reportWith({
        feedback: `Connected with ${DB}; the push printed ${TOKEN}.`,
        outOfScopeBugs: [bug(`Push prints ${TOKEN} to stdout`, `auth header ${TOKEN}`, false)],
      }),
      dispatch: { sessionId: 'session-1', planStub: 'demo', taskLine: `Migrate ${DB}` },
    };
  }

  it('are absent from the filed issue and the query, read back off the disk', async () => {
    const f = fixture();
    const { report, dispatch } = leakyOptions();

    await triage(f, report, { dispatch, secrets: SECRETS });

    const issue = onlyIssue(f.publicDir);
    expect(issue.contents).not.toContain(TOKEN);
    expect(issue.contents).not.toContain(DB);
    expect(issue.contents).not.toContain('hunter2');
    expect(issue.draft.title).toBe('Push prints [redacted: GITHUB_TOKEN] to stdout');
    expect(issue.draft.body).toContain(fence('auth header [redacted: GITHUB_TOKEN]'));
    expect(issue.draft.body).toContain(fence('Migrate [redacted: DB_URL]'));
    expect(issue.draft.body).toContain(fence('Connected with [redacted: DB_URL]; the push printed [redacted: GITHUB_TOKEN].'));
    expect(f.publicSpy.calls[0])
      .toEqual(['find', { text: bugKeyOf(TRACKER_FILE, 'auth header [redacted: GITHUB_TOKEN]'), type: 'bug' }]);
    expect(JSON.stringify(f.publicSpy.calls)).not.toContain(TOKEN);
  });

  it('are present in the filed issue when none are named, the control that the reading can see them', async () => {
    const f = fixture();
    const { report, dispatch } = leakyOptions();

    await triage(f, report, { dispatch, secrets: [] });

    const { contents } = onlyIssue(f.publicDir);
    expect(contents).toContain(TOKEN);
    expect(contents).toContain(DB);
  });

  it('are absent from a recurrence comment, which the reference under the unredacted key still finds', async () => {
    const f = fixture();
    const { report, dispatch } = leakyOptions();
    await triage(f, report, { dispatch, secrets: SECRETS });

    const again = await triage(f, report, { dispatch: { ...dispatch, sessionId: 'session-2' }, secrets: SECRETS });

    expect(again.bugs[0]).toMatchObject({ action: 'commented', foundBy: 'store' });
    const issue = onlyIssue(f.publicDir);
    expect(issue.comments).toHaveLength(1);
    expect(issue.contents).not.toContain(TOKEN);
    expect(issue.contents).not.toContain(DB);
    expect(issue.comments[0]).toContain('[redacted: GITHUB_TOKEN]');
  });

  it('are absent from a security bug filed privately', async () => {
    const f = fixture();
    const { report, dispatch } = leakyOptions();
    const flagged = { ...report, outOfScopeBugs: [bug(`Push prints ${TOKEN}`, `auth header ${TOKEN}`, true)] };

    await triage(f, flagged, { dispatch, secrets: SECRETS });

    const issue = onlyIssue(f.privateDir);
    expect(issue.contents).not.toContain(TOKEN);
    expect(issue.contents).not.toContain(DB);
    expect(issue.contents).toContain('[redacted: GITHUB_TOKEN]');
  });

  it('are absent from the problem a failing tracker answers', async () => {
    const f = fixture({ create: () => Promise.reject(new Error(`gh: bad credentials for ${TOKEN}`)) });
    const { report, dispatch } = leakyOptions();
    const unkeyed = { ...report, outOfScopeBugs: [bug(`Push prints ${TOKEN}`, null, false)] };

    const result = await triage(f, unkeyed, { dispatch, secrets: SECRETS });

    expect(result.bugs[0]!.problem).toBe('the public tracker create failed: gh: bad credentials for [redacted: GITHUB_TOKEN]');
  });

  it('are taken out of a title before it is cut, so no part of one straddling the cut is filed', async () => {
    const secret = 'SECRETVALUE0123456789';
    const what = `${'x'.repeat(TITLE_MAX_LENGTH - 10)}${secret}`;
    const report = reportWith({ outOfScopeBugs: [bug(what, null, false)] });
    const redacted = fixture();
    const plain = fixture();

    await triage(redacted, report, { secrets: [{ name: 'S', value: secret }] });
    await triage(plain, report);

    const redactedTitle = onlyIssue(redacted.publicDir).draft.title;
    expect(redactedTitle).not.toContain('SECRETV');
    expect(redactedTitle.endsWith('...')).toBe(true);
    // Control: unredacted, the cut keeps the start of the value.
    expect(onlyIssue(plain.publicDir).draft.title).toContain('SECRETV');
  });

  it('leave a feedback holding a fence verbatim inside a longer one', async () => {
    const f = fixture();
    const feedback = 'before\n```ts\nconst x = 1;\n```\nafter';

    await triage(f, reportWith({ feedback, outOfScopeBugs: [bug('Fence in feedback', null, false)] }));

    expect(onlyIssue(f.publicDir).draft.body).toContain(`## Feedback\n\n\`\`\`\`\n${feedback}\n\`\`\`\`\n`);
  });
});

