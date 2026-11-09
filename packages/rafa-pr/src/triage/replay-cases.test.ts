/**
 * Replay of the entries behind the evidence-first kind check: each case of
 * `./testdata/replay-cases.json` (the public text of a bug on the board,
 * with the evidence the loop would have held) goes through
 * `checkedKindOf` with a stubbed runner, the plan's files, added lines and
 * commits, and a kept capture written under a temporary root in the shape
 * `packages/rafa/src/suite/run.ts` keeps it. Nothing is run and no
 * tracker is called.
 *
 * The `bug` cases come first, since a check that read everything as the
 * plan's own would pass every own case; a control shows the same text
 * turning `own-gap` once the plan touched the file it names. The own
 * cases follow, each beside a control with its evidence taken away. The
 * last case sends two entries of one recurrence key (the two wordings of
 * #1534) through `routeByKind` over a tracker file, and reads back one
 * repair line.
 */
import type { BaseRunAnswer } from './base-run.js';
import type { KindRouteContext, KindRouteEntry, KindRouteOptions, KindRouting } from './kind-route.js';
import type { KindCheck } from './own-check.js';
import type { BugKind, ReportBug } from '@open-tomato/rafa/report/parse';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { checkedKindOf, routeByKind } from './kind-route.js';
import { LEFTOVER_MARKER } from './leftover-repair.js';

/** What a case expects of the check. */
interface Expected {
  readonly kind: BugKind;
  readonly row: KindCheck['row'];
}

/** One replayed entry and the evidence the loop held for it. */
interface ReplayCase {
  readonly name: string;
  readonly issue: number;
  readonly wording?: number;
  readonly said: BugKind;
  readonly what: string;
  readonly artifact: string | null;
  readonly planFiles: readonly string[];
  readonly added: readonly string[];
  readonly head?: 'red' | 'green';
  readonly capture?: {
    readonly step: string;
    readonly at: 'earlier' | 'foreign';
    readonly output: string;
  };
  readonly expected: Expected;
}

/** The fixture's three groups. */
interface ReplayFixture {
  readonly bugCases: readonly ReplayCase[];
  readonly controls: {
    readonly touchedTestFile: {
      readonly base: number;
      readonly planFilesAdded: readonly string[];
      readonly expected: Expected;
    };
  };
  readonly ownCases: readonly ReplayCase[];
}

const fixture = await Bun.file(new URL('./testdata/replay-cases.json', import.meta.url)).json() as ReplayFixture;

/** The run checkout's head, and the plan's two commits: the head and an earlier one. */
const HEAD_SHA = 'c'.repeat(40);
const EARLIER_SHA = 'b'.repeat(40);
const FOREIGN_SHA = 'f'.repeat(40);
const BASE_SHA = 'a'.repeat(40);
const PLAN_COMMITS = [HEAD_SHA, EARLIER_SHA];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-replay-cases-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A fresh root under the temporary folder. */
function freshRoot(): string {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  return root;
}

/** Writes `replayed`'s capture under `root`'s `.rafa/runs/`, when it has one. */
function keepCapture(root: string, replayed: ReplayCase): void {
  if (replayed.capture === undefined) return;
  const sha = replayed.capture.at === 'earlier'
    ? EARLIER_SHA
    : FOREIGN_SHA;
  const folder = join(root, '.rafa', 'runs', 'session-1', 'suite');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${replayed.capture.step}.${sha}.red.output.txt`), replayed.capture.output);
}

/** The options of a plan whose files and added lines `replayed` holds; the head reads as it says, the base green. */
function optionsOf(replayed: ReplayCase, planFiles: readonly string[] = replayed.planFiles): KindRouteOptions {
  const head: BaseRunAnswer = { answer: replayed.head ?? 'red' };
  return {
    planBase: { ok: true, base: 'main', sha: BASE_SHA },
    head: HEAD_SHA,
    planFiles: { ok: true, files: planFiles, added: replayed.added, addedProblem: null, commits: PLAN_COMMITS, commitsProblem: null },
    runTest: (commit) => Promise.resolve(commit === HEAD_SHA
      ? head
      : { answer: 'green' }),
    retries: 2,
  };
}

/** The entry of `replayed`, public. */
function bugOf(replayed: ReplayCase): ReportBug {
  return { what: replayed.what, artifact: replayed.artifact, security: false, kind: replayed.said, module: null, action: null, reproduce: null, cause: null, extras: [] };
}

/** The check's answer for `replayed` over a fresh root holding its capture. */
async function checkOf(replayed: ReplayCase, options: KindRouteOptions = optionsOf(replayed)): Promise<KindCheck> {
  const root = freshRoot();
  keepCapture(root, replayed);
  return checkedKindOf(bugOf(replayed), options, root);
}

/** The case of `cases` for `issue`, wording `wording` when given. */
function caseFor(cases: readonly ReplayCase[], issue: number, wording?: number): ReplayCase {
  const found = cases.find((one) => one.issue === issue && (wording === undefined || one.wording === wording));
  if (found === undefined) throw new Error(`the fixture holds no case for #${issue}`);
  return found;
}

describe('replay: entries that stay bugs', () => {
  for (const replayed of fixture.bugCases) {
    it(`reads ${replayed.name}`, async () => {
      const checked = await checkOf(replayed);

      expect({ kind: checked.kind, row: checked.row, inherited: checked.inherited }).toEqual({ ...replayed.expected, inherited: false });
    });
  }

  it('control: the #1356 text reads own-gap once the plan touched the test file it names', async () => {
    const { base, planFilesAdded, expected } = fixture.controls.touchedTestFile;
    const replayed = caseFor(fixture.bugCases, base);

    const checked = await checkOf(replayed, optionsOf(replayed, [...replayed.planFiles, ...planFilesAdded]));

    expect({ kind: checked.kind, row: checked.row }).toEqual(expected);
  });

  it('control: the #1527 text reads as a bug even where the plan\'s added lines quote its case', async () => {
    const replayed = caseFor(fixture.bugCases, 1527);

    const checked = await checkOf(replayed);

    expect(replayed.added.some((line) => line.includes('reads a confidence tie in hundredths'))).toBe(true);
    expect(checked.row).toBe('file-outside-plan');
    expect(checked.symbol).toBeNull();
  });
});

describe('replay: entries that are the plan\'s own', () => {
  for (const replayed of fixture.ownCases) {
    it(`reads ${replayed.name}`, async () => {
      const checked = await checkOf(replayed);

      expect({ kind: checked.kind, row: checked.row, inherited: checked.inherited }).toEqual({ ...replayed.expected, inherited: false });
    });
  }

  it('carries the capture #1528 was found by, taken at the plan\'s earlier commit', async () => {
    const checked = await checkOf(caseFor(fixture.ownCases, 1528));

    expect(checked.capture?.sha).toBe(EARLIER_SHA);
    expect(checked.capture?.step).toBe('task');
  });

  it('control: #1528 with no kept capture reads as a bug, its case green on the head', async () => {
    const withoutCapture: ReplayCase = { ...caseFor(fixture.ownCases, 1528), capture: undefined };

    const checked = await checkOf(withoutCapture);

    expect([checked.kind, checked.row]).toEqual(['bug', 'head-not-red']);
  });

  it('control: #1528 with a capture from a commit the plan never held reads as a bug', async () => {
    const replayed = caseFor(fixture.ownCases, 1528);
    const foreign = { ...replayed, capture: { ...replayed.capture!, at: 'foreign' as const } };

    const checked = await checkOf(foreign);

    expect([checked.kind, checked.row]).toEqual(['bug', 'head-not-red']);
  });

  it('control: #1534 reads as a bug where the plan\'s added lines hold none of its symbols', async () => {
    const replayed = caseFor(fixture.ownCases, 1534, 1);

    const checked = await checkOf(replayed, optionsOf({ ...replayed, added: ['export const UNRELATED = 1;'] }));

    expect([checked.kind, checked.row]).toEqual(['bug', 'file-outside-plan']);
  });

  it('names the symbol the plan added for #1534', async () => {
    const checked = await checkOf(caseFor(fixture.ownCases, 1534, 1));

    expect(checked.symbol).toBe('pairBugFixes');
  });
});

/** The plan's tracker: two ticked tasks and one open. */
const TRACKER_TEXT = [
  '# Plan: demo',
  '',
  '- [x] Ship the parser',
  '- [x] Wire the loop  {agent=loop-implementer}',
  '- [ ] Write the docs',
  '',
].join('\n');

/** Routes `replayed` through `routeByKind` over the tracker at `trackerPath`. */
function routeOf(replayed: ReplayCase, trackerPath: string, repoRoot: string, index: number): Promise<KindRouting> {
  const bug = bugOf(replayed);
  const entry: KindRouteEntry = { bug, index, what: replayed.what, redact: (text) => text };
  const context: KindRouteContext = {
    repoRoot,
    trackerPath,
    dispatch: { sessionId: 'session-1', planStub: 'demo', taskLine: 'Wire the loop' },
    outcome: 'done',
    kinds: optionsOf(replayed),
  };
  return routeByKind(entry, context);
}

/** The leftover lines the tracker at `trackerPath` holds. */
function leftoverLines(trackerPath: string): readonly string[] {
  return readFileSync(trackerPath, 'utf8').split('\n')
    .filter((line) => line.includes(LEFTOVER_MARKER));
}

/** A root holding the plan's tracker. */
function trackerRoot(): { readonly root: string; readonly trackerPath: string } {
  const root = freshRoot();
  const trackerPath = join(root, 'PLAN_TRACKER-demo.md');
  writeFileSync(trackerPath, TRACKER_TEXT);
  return { root, trackerPath };
}

describe('replay: two entries of one recurrence key', () => {
  it('leaves one repair line for the two wordings of #1534, the second joining the first', async () => {
    const { root, trackerPath } = trackerRoot();

    const first = await routeOf(caseFor(fixture.ownCases, 1534, 1), trackerPath, root, 0);
    const second = await routeOf(caseFor(fixture.ownCases, 1534, 2), trackerPath, root, 1);

    expect(leftoverLines(trackerPath)).toHaveLength(1);
    expect(first).toMatchObject({ settled: true, row: { action: 'repair', kind: 'own-gap' } });
    expect(first.settled && first.row.joined).toBeUndefined();
    expect(second).toMatchObject({ settled: true, row: { action: 'repair', kind: 'own-gap', joined: true } });
    expect(second.settled && second.row.repairLine).toBe(first.settled
      ? first.row.repairLine
      : -1);
  });

  it('joins on the key alone where no symbol is matched, two wordings of #1536 under one artifact', async () => {
    const { root, trackerPath } = trackerRoot();
    const replayed = caseFor(fixture.ownCases, 1536, 1);

    await routeOf(replayed, trackerPath, root, 0);
    const second = await routeOf({ ...replayed, what: `${replayed.what}, again` }, trackerPath, root, 1);

    expect(leftoverLines(trackerPath)).toHaveLength(1);
    expect(second).toMatchObject({ settled: true, row: { action: 'repair', joined: true } });
  });

  it('control: two entries of different keys and no shared symbol leave two repair lines', async () => {
    const { root, trackerPath } = trackerRoot();

    const first = await routeOf(caseFor(fixture.ownCases, 1536, 1), trackerPath, root, 0);
    const second = await routeOf(caseFor(fixture.ownCases, 1555), trackerPath, root, 1);

    expect(leftoverLines(trackerPath)).toHaveLength(2);
    expect(first).toMatchObject({ settled: true, row: { action: 'repair' } });
    expect(second).toMatchObject({ settled: true, row: { action: 'repair' } });
    expect(second.settled && second.row.joined).toBeUndefined();
  });
});
