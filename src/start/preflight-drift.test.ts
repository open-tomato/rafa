/**
 * Tests for the drift check of the `loop start` preflight
 * (`preflight-drift.ts`): counting the run records, which runs are due,
 * and what a due run and a run that is not due print and read.
 *
 * Each "prints nothing" case has a control beside it, the same seams
 * with the one input changed that makes the run report, so a check that
 * could never print fails the control rather than passing the case.
 */
import type { StartPreflightDrift } from './preflight-drift.js';
import type { BoardIssue, BoardListing } from '../board/roadmap-board.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { typeOfLabels } from '../adapters/tracker/github.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../claims/stale.js';
import { runsDir } from '../loop/sessions.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { countRunRecords, createStartPreflightDrift, isDriftRun, reportStartDrift } from './preflight-drift.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-preflight-drift-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** One row as the listing reads it. */
function row(number: number, labels: readonly string[], body = ''): BoardIssue {
  return { number, title: `Issue ${String(number)}`, body, state: 'OPEN', stateReason: null, labels, type: typeOfLabels(labels), module: 'unassigned' };
}

/** A board whose line for #12 is ticked while #12 still carries `rafa:in-development`. */
const DRIFTED: readonly BoardIssue[] = [row(1, ['type:roadmap'], '- [x] #12'), row(12, [IN_DEVELOPMENT_LABEL])];

/** The same board with the label gone. */
const CLEAN: readonly BoardIssue[] = [row(1, ['type:roadmap'], '- [x] #12'), row(12, [])];

/** The line the drifted board reports. */
const DRIFT_LINE = 'claim drift: #12 is ticked on #1 (line 1) but still labelled rafa:in-development (open)';

/** What one driven report printed. */
interface Reported {
  readonly warn: readonly string[];
  readonly info: readonly string[];
}

/**
 * Seams over `issues` counting `count` run records, with `asked`
 * counting each ask of the listing seam, each listing read, and each
 * branch scan.
 */
function seamsOf(count: number, issues: readonly BoardIssue[] | null, change: Partial<StartPreflightDrift> = {}) {
  const asked = { listing: 0, read: 0, branches: 0 };
  const listing: BoardListing = () => {
    asked.read += 1;
    return Promise.resolve(issues ?? []);
  };
  const seams: StartPreflightDrift = {
    runCount: () => count,
    listing: () => {
      asked.listing += 1;
      return issues === null
        ? null
        : listing;
    },
    boards: [],
    branches: () => {
      asked.branches += 1;
      return { refs: ['refs/heads/feat/rafa-12-a'], problems: [] };
    },
    ...change,
  };
  return { seams, asked };
}

/** Runs {@link reportStartDrift} over `seams` with a sink output. */
async function report(seams: StartPreflightDrift): Promise<Reported> {
  const warn: string[] = [];
  const info: string[] = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      info.push(message);
    },
    warn: (message) => {
      warn.push(message);
    },
  }));
  await reportStartDrift(seams);
  return { warn, info };
}

/** A fresh project root with `names` written under its runs directory. */
function rootWith(...names: readonly string[]): string {
  const root = mkdtempSync(join(tempBase, 'root-'));
  mkdirSync(runsDir(root), { recursive: true });
  for (const name of names) writeFileSync(join(runsDir(root), name), '{}\n');
  return root;
}

describe('countRunRecords', () => {
  it('reads 0 for a project with no runs directory', () => {
    expect(countRunRecords(mkdtempSync(join(tempBase, 'bare-')))).toBe(0);
  });

  it('counts each <id>.json and nothing else under the runs directory', () => {
    const root = rootWith('a1.json', 'b2.json', 'notes.txt', '.hidden.json');
    mkdirSync(join(runsDir(root), 'a1', 'served'), { recursive: true });

    expect(countRunRecords(root)).toBe(2);

    writeFileSync(join(runsDir(root), 'c3.json'), '{}\n');

    expect(countRunRecords(root)).toBe(3);
  });

  it('throws when the runs directory cannot be listed', () => {
    const root = mkdtempSync(join(tempBase, 'file-'));
    mkdirSync(join(runsDir(root), '..'), { recursive: true });
    writeFileSync(runsDir(root), 'not a directory\n');

    expect(() => countRunRecords(root)).toThrow();
  });
});

describe('isDriftRun', () => {
  it('is due on every second run and on no other', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(isDriftRun)).toEqual([false, false, true, false, true, false, true]);
  });
});

describe('reportStartDrift', () => {
  it('warns each drift line on a due run, and reads nothing on the run before it', async () => {
    const first = seamsOf(1, DRIFTED);
    const second = seamsOf(2, DRIFTED);

    const skipped = await report(first.seams);
    const due = await report(second.seams);

    expect(skipped).toEqual({ warn: [], info: [] });
    expect(first.asked).toEqual({ listing: 0, read: 0, branches: 0 });
    expect(due.warn).toEqual([DRIFT_LINE]);
    expect(due.info).toEqual([]);
    expect(second.asked.read).toBe(1);
  });

  it('prints nothing for a due run over a board with no drift, where the drifted board prints its line', async () => {
    expect((await report(seamsOf(4, CLEAN).seams)).warn).toEqual([]);
    expect((await report(seamsOf(4, DRIFTED).seams)).warn).toEqual([DRIFT_LINE]);
  });

  it('reads no board and prints nothing when the board is not gh', async () => {
    const none = seamsOf(2, null);

    expect(await report(none.seams)).toEqual({ warn: [], info: [] });
    expect(none.asked).toEqual({ listing: 1, read: 0, branches: 0 });
  });

  it('compares the boards handed in beside the labelled ones', async () => {
    const unlabelled = [row(3, [], '- [x] #13'), row(13, [CLAIMED_LABEL])];
    const withBoard = seamsOf(2, unlabelled, {
      boards: [3],
      branches: () => ({ refs: ['refs/heads/feat/rafa-13-b'], problems: [] }),
    });
    const without = seamsOf(2, unlabelled, { branches: withBoard.seams.branches });

    expect((await report(without.seams)).warn).toEqual([]);
    expect((await report(withBoard.seams)).warn).toEqual([
      'claim drift: #13 is ticked on #3 (line 1) but still labelled rafa:claimed (open)',
    ]);
  });

  it('warns once and reads nothing when the run records cannot be counted', async () => {
    const broken = seamsOf(2, DRIFTED, {
      runCount: () => {
        throw new Error('EACCES: permission denied');
      },
    });

    const reported = await report(broken.seams);

    expect(reported.warn).toEqual(['claim drift: the run records could not be counted, so no drift was checked: EACCES: permission denied']);
    expect(broken.asked).toEqual({ listing: 0, read: 0, branches: 0 });
  });

  it('warns the notice and resolves when the board cannot be read', async () => {
    const failing = seamsOf(2, DRIFTED, {
      listing: () => () => Promise.reject(new Error('error connecting to api.github.com')),
    });

    expect((await report(failing.seams)).warn).toEqual([
      'claim drift: the board could not be read, so no drift was checked: error connecting to api.github.com',
    ]);
  });

  it('warns once and resolves when resolving the board throws', async () => {
    const throwing = seamsOf(2, DRIFTED, {
      listing: () => {
        throw new Error('origin could not be read');
      },
    });

    expect((await report(throwing.seams)).warn).toEqual([
      'claim drift: the check could not run, so no drift was checked: origin could not be read',
    ]);
  });
});

describe('createStartPreflightDrift', () => {
  it('counts the project\'s run records and names roadmap.issue as a board', () => {
    const root = rootWith('a1.json', 'b2.json');

    const seams = createStartPreflightDrift(root, { prProvider: 'none', roadmapIssue: 31 });

    expect(seams.runCount()).toBe(2);
    expect(seams.boards).toEqual([31]);
    expect(createStartPreflightDrift(root, { prProvider: 'none', roadmapIssue: null }).boards).toEqual([]);
  });

  it('answers no listing under pr.provider: none, and a listing under gh', () => {
    const root = rootWith();

    expect(createStartPreflightDrift(root, { prProvider: 'none', roadmapIssue: null }).listing()).toBeNull();
    expect(typeof createStartPreflightDrift(root, { prProvider: 'gh', roadmapIssue: null }).listing()).toBe('function');
  });
});
