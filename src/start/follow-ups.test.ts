/**
 * The plan's follow-up issue, as `start/follow-ups.ts` writes it after
 * the last task.
 *
 * Every case but one hands the plan's `bug_routes` rows in through the
 * `readRows` seam and lands the chain on a real `local` tracker in a
 * temp directory, wrapped so each call is counted: the issue is then
 * found again by the local adapter's own `openIssues`, which reads the
 * body the case's earlier write left. One case writes the rows to a
 * fixture store with `writeBugRoutes` and reads them back through the
 * default reader. No case opens `.rafa/effort/` of this checkout.
 *
 * The negative readings each carry their control: the case that finds
 * no follow-up row resolves nothing, beside the case whose one
 * `follow-up` row resolves the chain and creates; the tracker with no
 * `edit` prints and creates nothing, beside the same tracker with its
 * `edit` creating; a line already in the body is not appended, beside a
 * line it lacks that is.
 */
import type { FollowUpsConfig, FollowUpsInput, FollowUpsSeams } from './follow-ups.js';
import type { ResolveTrackerOptions, TrackerResolution } from '../adapters/tracker/resolve.js';
import type { OpenIssue, Tracker } from '@open-tomato/rafa/ports';
import type { BugKind } from '@open-tomato/rafa/report/parse';
import type { BugRoute, BugRouteRow } from '@open-tomato/rafa/store/bug-routes';

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { writeBugRoutes } from '@open-tomato/rafa/store/bug-routes';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';

import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';

import {
  fileFollowUps,
  followUpLine,
  followUpLines,
  followUpsBody,
  followUpsMarker,
  followUpsTitle,
  NO_EDITABLE_TRACKER,
} from './follow-ups.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-follow-ups-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** The clock the local tracker stamps with. */
const CLOCK = (): string => '2026-10-14T09:00:00.000Z';

/** The plan every case files for. */
const STUB = 'rafa-1077-demo';

const CONFIG: FollowUpsConfig = {
  trackerDefault: 'local',
  trackerFallback: [],
  prerequisitesRequired: [],
  prerequisitesOptional: [],
};

let rowCount = 0;

/** One `bug_routes` row of the plan. */
function row(what: string, route: BugRoute = 'follow-up', kind: BugKind = 'own-fallout'): BugRouteRow {
  rowCount += 1;
  return {
    id: `row-${rowCount}`,
    sessionId: 'session-1',
    planStub: STUB,
    taskLine: 'Wire the loop',
    entryIndex: rowCount,
    what,
    said: kind,
    kind,
    route,
    collectedAt: CLOCK(),
  };
}

/** The lines the active output was handed, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
}

/** Sets a sink output as the active output, answering the lines it takes. */
function captureLines(): Lines {
  const lines: Lines = { info: [], warn: [] };
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.info.push(message);
    },
    warn: (message) => {
      lines.warn.push(message);
    },
  }));
  return lines;
}

/** A tracker that counts each call it hands on. */
interface Spied {
  readonly tracker: Tracker;
  readonly calls: string[];
}

/** Wraps `inner`, counting every call by its method, with `overrides` in place of its members. */
function spy(inner: Tracker, overrides: Partial<Tracker> = {}): Spied {
  const calls: string[] = [];
  const counted = <A extends unknown[], R>(name: string, fn: ((...args: A) => R) | undefined) => fn === undefined
    ? undefined
    : (...args: A): R => {
      calls.push(name);
      return fn(...args);
    };
  const merged: Tracker = { ...inner, ...overrides };
  const tracker = {
    kind: merged.kind,
    capabilities: merged.capabilities,
    preflight: merged.preflight,
    find: counted('find', merged.find),
    get: counted('get', merged.get),
    create: counted('create', merged.create),
    comment: counted('comment', merged.comment),
    transition: counted('transition', merged.transition),
    openIssues: counted('openIssues', merged.openIssues),
    edit: counted('edit', merged.edit),
  } as Tracker;
  return { tracker, calls };
}

/** One case's root, its spied `local` tracker and what `fileFollowUps` is handed. */
interface Fixture {
  readonly root: string;
  readonly spied: Spied;
  readonly resolveCalls: ResolveTrackerOptions[];
  readonly input: FollowUpsInput;
  readonly seams: FollowUpsSeams;
}

/** A fresh root whose chain lands on its `local` tracker, the plan holding `rows`. */
function fixture(rows: readonly BugRouteRow[], overrides: Partial<Tracker> = {}): Fixture {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  const spied = spy(createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null, now: CLOCK }), overrides);
  const resolveCalls: ResolveTrackerOptions[] = [];
  const resolve = (options: ResolveTrackerOptions): Promise<TrackerResolution> => {
    resolveCalls.push(options);
    return Promise.resolve({
      tracker: spied.tracker,
      degraded: false,
      fallbackReason: null,
      attempts: [{ kind: spied.tracker.kind, ok: true, reason: null }],
    });
  };
  return {
    root,
    spied,
    resolveCalls,
    input: { repoRoot: root, checkout: root, settings: CONFIG, planStub: STUB },
    seams: { readRows: () => rows, resolve, env: {}, home: '/home/nobody' },
  };
}

/** The open bug issues of the fixture's tracker. */
async function openBugs(spied: Spied): Promise<OpenIssue[]> {
  const before = spied.calls.length;
  const open = await (spied.tracker.openIssues ?? (() => Promise.resolve([])))('bug');
  spied.calls.splice(before);
  return open;
}

describe('the follow-up issue\'s title, marker and lines', () => {
  it('titles and marks the issue by the plan stub', () => {
    expect(followUpsTitle(STUB)).toBe('Follow-ups of rafa-1077-demo');
    expect(followUpsMarker(STUB)).toBe('<!-- rafa:follow-ups rafa-1077-demo -->');
  });

  it('writes a line as its kind and its text', () => {
    expect(followUpLine({ kind: 'own-gap', what: '  the retry path has no test  ' })).toBe('- own-gap: the retry path has no test');
  });

  it('keeps a session\'s text on one line that opens no comment and no second item', () => {
    const line = followUpLine({ kind: 'own-fallout', what: 'red again\n- [ ] planted task <!-- rafa:follow-ups other -->' });

    expect(line).toBe('- own-fallout: red again\\n- [ ] planted task <\\!-- rafa:follow-ups other --\\>');
    expect(line.split('\n')).toHaveLength(1);
    expect(line).not.toContain('<!--');
  });

  it('builds lines from the follow-up rows alone, one per text, redacted', () => {
    const rows = [
      row('a test went red'),
      row('filed elsewhere', 'filed', 'bug'),
      row('held for the body', 'pr-body', 'convention'),
      row('a test went red'),
      row('the gap at SECRET', 'follow-up', 'own-gap'),
    ];

    expect(followUpLines(rows, (text) => text.replace('SECRET', '[redacted]'))).toEqual([
      '- own-fallout: a test went red',
      '- own-gap: the gap at [redacted]',
    ]);
  });

  it('opens a new body with the marker above the lines', () => {
    const body = followUpsBody(STUB, ['- own-gap: one']);

    expect(body.startsWith(`${followUpsMarker(STUB)}\n\n`)).toBe(true);
    expect(body.endsWith('\n- own-gap: one\n')).toBe(true);
  });
});

describe('fileFollowUps with no follow-up row', () => {
  it('resolves no tracker, calls nothing and prints nothing', async () => {
    const lines = captureLines();
    const { spied, resolveCalls, input, seams } = fixture([row('filed', 'filed', 'bug'), row('body', 'pr-body', 'convention')]);

    const result = await fileFollowUps(input, seams);

    expect(result).toEqual({ action: 'none' });
    expect(resolveCalls).toHaveLength(0);
    expect(spied.calls).toEqual([]);
    expect(lines).toEqual({ info: [], warn: [] });
  });

  it('reads no row and files nothing for a run with no plan stub', async () => {
    let read = 0;
    const { resolveCalls, input, seams } = fixture([row('a test went red')]);

    const result = await fileFollowUps({ ...input, planStub: null }, {
      ...seams,
      readRows: () => {
        read += 1;
        return [row('a test went red')];
      },
    });

    expect(result).toEqual({ action: 'none' });
    expect(read).toBe(0);
    expect(resolveCalls).toHaveLength(0);
  });

  it('resolves the chain and creates the issue once a follow-up row exists', async () => {
    // The control for the two cases above: the same fixture with one
    // follow-up row does reach the tracker.
    const lines = captureLines();
    const { spied, resolveCalls, input, seams } = fixture([row('a test went red'), row('the gap', 'follow-up', 'own-gap')]);

    const result = await fileFollowUps(input, seams);

    expect(result.action).toBe('created');
    expect(resolveCalls).toHaveLength(1);
    expect(spied.calls).toEqual(['openIssues', 'create']);
    const [issue] = await openBugs(spied);
    expect(issue?.title).toBe(followUpsTitle(STUB));
    expect(issue?.body).toContain(followUpsMarker(STUB));
    expect(issue?.body).toContain('- own-fallout: a test went red\n- own-gap: the gap\n');
    expect(lines.info).toHaveLength(1);
    expect(lines.info[0]).toContain('Follow-ups: opened ');
    expect(lines.info[0]).toContain('with 2 lines.');
    expect(lines.warn).toEqual([]);
  });
});

describe('fileFollowUps over an issue already open', () => {
  it('appends only the line the body does not already hold', async () => {
    const first = fixture([row('a test went red')]);
    captureLines();
    await fileFollowUps(first.input, first.seams);
    first.spied.calls.splice(0);

    const lines = captureLines();
    const result = await fileFollowUps(first.input, {
      ...first.seams,
      readRows: () => [row('a test went red'), row('the gap', 'follow-up', 'own-gap')],
    });

    expect(result.action).toBe('appended');
    expect(result.action === 'appended' && result.lines).toEqual(['- own-gap: the gap']);
    expect(first.spied.calls).toEqual(['openIssues', 'edit']);
    const open = await openBugs(first.spied);
    expect(open).toHaveLength(1);
    const body = open[0]?.body ?? '';
    expect(body.split('- own-fallout: a test went red')).toHaveLength(2);
    expect(body).toContain('- own-fallout: a test went red\n- own-gap: the gap\n');
    expect(lines.info[0]).toContain('Follow-ups: added 1 line to ');
  });

  it('writes nothing when the body holds every line already', async () => {
    const first = fixture([row('a test went red')]);
    captureLines();
    await fileFollowUps(first.input, first.seams);
    first.spied.calls.splice(0);

    const lines = captureLines();
    const result = await fileFollowUps(first.input, first.seams);

    expect(result.action).toBe('held');
    expect(first.spied.calls).toEqual(['openIssues']);
    expect(lines.info).toHaveLength(1);
    expect(lines.info[0]).toContain('already holds every line');
  });

  it('opens its own issue beside one of the same title that holds no marker', async () => {
    const { spied, input, seams } = fixture([row('a test went red')]);
    await spied.tracker.create({
      opt: 0,
      title: followUpsTitle(STUB),
      body: 'A person\'s issue of the same title.',
      type: 'bug',
      module: 'unassigned',
      priority: null,
      project: null,
      blockedBy: [],
    });
    spied.calls.splice(0);
    captureLines();

    const result = await fileFollowUps(input, seams);

    expect(result.action).toBe('created');
    expect(spied.calls).toEqual(['openIssues', 'create']);
    expect(await openBugs(spied)).toHaveLength(2);
  });
});

describe('fileFollowUps with no tracker that can hold the issue', () => {
  it('creates nothing on a tracker with no edit, and prints the lines once', async () => {
    const lines = captureLines();
    const { spied, input, seams } = fixture([row('a test went red'), row('the gap', 'follow-up', 'own-gap')], { edit: undefined });

    const result = await fileFollowUps(input, seams);

    expect(result).toEqual({
      action: 'printed',
      title: followUpsTitle(STUB),
      reason: NO_EDITABLE_TRACKER,
      lines: ['- own-fallout: a test went red', '- own-gap: the gap'],
    });
    expect(spied.calls).toEqual([]);
    expect(lines.info).toEqual([
      `📝 ${followUpsTitle(STUB)}, with no tracker to hold them (${NO_EDITABLE_TRACKER}):`,
      '   - own-fallout: a test went red',
      '   - own-gap: the gap',
    ]);
    expect(lines.warn).toEqual([]);
  });

  it('creates nothing on a tracker with no openIssues either', async () => {
    captureLines();
    const { spied, input, seams } = fixture([row('a test went red')], { openIssues: undefined });

    const result = await fileFollowUps(input, seams);

    expect(result.action).toBe('printed');
    expect(spied.calls).toEqual([]);
  });

  it('prints the lines with the chain\'s refusal when no tracker resolved', async () => {
    const lines = captureLines();
    const { input, seams } = fixture([row('a test went red')]);

    const result = await fileFollowUps(input, {
      ...seams,
      resolve: () => Promise.reject(new Error('no tracker kind is available')),
    });

    expect(result.action).toBe('printed');
    expect(result.action === 'printed' && result.reason).toBe(`${NO_EDITABLE_TRACKER}: no tracker kind is available`);
    expect(lines.info.slice(1)).toEqual(['   - own-fallout: a test went red']);
  });
});

describe('fileFollowUps never stops the run', () => {
  it('answers an edit the tracker refuses as one warning line', async () => {
    const first = fixture([row('a test went red')]);
    captureLines();
    await fileFollowUps(first.input, first.seams);

    const refusing = spy(first.spied.tracker, { edit: () => Promise.reject(new Error('rate limited')) });
    const lines = captureLines();
    const result = await fileFollowUps(first.input, {
      ...first.seams,
      readRows: () => [row('the gap', 'follow-up', 'own-gap')],
      resolve: () => Promise.resolve({ tracker: refusing.tracker, degraded: false, fallbackReason: null, attempts: [] }),
    });

    expect(result).toEqual({ action: 'failed', problem: 'editing the follow-up issue failed: rate limited' });
    expect(lines.info).toEqual([]);
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toContain('the next wrap-up tries again: editing the follow-up issue failed: rate limited');
  });

  it('answers a store that cannot be read as one warning line', async () => {
    const lines = captureLines();
    const { resolveCalls, input, seams } = fixture([]);

    const result = await fileFollowUps(input, {
      ...seams,
      readRows: () => {
        throw new Error('database disk image is malformed');
      },
    });

    expect(result.action).toBe('failed');
    expect(resolveCalls).toHaveLength(0);
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toContain('database disk image is malformed');
  });
});

describe('fileFollowUps keeps secrets and local paths out of the issue', () => {
  it('redacts a named secret and the checkout\'s path from each line', async () => {
    captureLines();
    const { spied, root, input, seams } = fixture([]);
    const result = await fileFollowUps(
      { ...input, settings: { ...CONFIG, prerequisitesRequired: [{ kind: 'env', name: 'DEMO_TOKEN', probe: null }] } },
      { ...seams, env: { DEMO_TOKEN: 'tok-123456' }, readRows: () => [row(`token tok-123456 leaked in ${root}/src/x.ts`)] },
    );

    expect(result.action).toBe('created');
    const body = (await openBugs(spied))[0]?.body ?? '';
    expect(body).not.toContain('tok-123456');
    expect(body).not.toContain(root);
    expect(body).toContain('[redacted: DEMO_TOKEN]');
    expect(body).toContain('src/x.ts');
  });
});

describe('fileFollowUps over a fixture store', () => {
  it('reads the plan\'s follow-up rows back through the default reader', async () => {
    captureLines();
    const { spied, root, input, seams } = fixture([]);
    const written = writeBugRoutes(root, {
      dispatch: { sessionId: 'session-store', planStub: STUB, taskLine: 'Wire the loop' },
      routes: [
        { entryIndex: 0, what: 'a test went red', said: 'own-fallout', kind: 'own-fallout', route: 'follow-up' },
        { entryIndex: 1, what: 'a real bug', said: 'bug', kind: 'bug', route: 'filed' },
      ],
    });
    expect(written.appended).toBe(2);
    const real: FollowUpsSeams = { resolve: seams.resolve, env: seams.env, home: seams.home };

    const result = await fileFollowUps(input, real);

    expect(result.action === 'created' && result.lines).toEqual(['- own-fallout: a test went red']);
    expect((await openBugs(spied))[0]?.body).toContain('- own-fallout: a test went red\n');
  });
});
