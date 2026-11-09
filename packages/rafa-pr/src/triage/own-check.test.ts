/**
 * Tests for the kind check (`own-check.ts`), one `describe` per row of
 * its decision table, the rows that answer `bug` for an `own-` claim
 * first. The check is pure, so every case is a literal entry, literal
 * readings and a literal file list. A check answering `bug` for
 * everything would pass each negative row, so each negative row keeps a
 * control: the same entry, one reading or file changed, answering the
 * `own-` kind.
 */
import type { BaseRunAnswer } from './base-run.js';
import type { KindCheckEntry, KindCheckInput, NamedTestReadings } from './own-check.js';
import type { PlanFilesReading } from './plan-commits.js';
import type { BugKind } from '@open-tomato/rafa/report/parse';

import { describe, expect, it } from 'bun:test';

import { checkKind, namedTestOf } from './own-check.js';

/** A `file > case` line naming the case every test row reads. */
const CASE_LINE = 'src/a.test.ts > outer > fails';

/** The case {@link CASE_LINE} names. */
const CASE_NAME = 'outer > fails';

const GREEN: BaseRunAnswer = { answer: 'green' };
const RED: BaseRunAnswer = { answer: 'red' };
const UNRUNNABLE: BaseRunAnswer = { answer: 'unrunnable', problem: 'src/a.test.ts does not exist at 0123456789ab.' };

/** The plan's files every file row reads, unless it names others. */
const PLAN_FILES: PlanFilesReading = { ok: true, files: ['src/edited.ts', 'src/a.test.ts', 'docs/guide.md'] };

/** An entry said to be `kind`, with `what` and `artifact`. */
function entry(kind: BugKind, what: string, artifact: string | null = null): KindCheckEntry {
  return { kind, what, artifact };
}

/** An entry said to be `kind` that names {@link CASE_LINE} in its artifact. */
function testEntry(kind: BugKind): KindCheckEntry {
  return entry(kind, 'a test went red', CASE_LINE);
}

/** What `checkKind` reads, the plan's files defaulting to {@link PLAN_FILES}. */
function input(checked: KindCheckEntry, readings: NamedTestReadings | null, planFiles = PLAN_FILES): KindCheckInput {
  return { entry: checked, readings, planFiles };
}

describe('checkKind: an own- claim the head does not confirm', () => {
  it('reads an own-fallout claim whose case is green on the head as a bug', () => {
    const checked = checkKind(input(testEntry('own-fallout'), { base: GREEN, head: GREEN }));

    expect(checked).toEqual({
      kind: 'bug',
      inherited: false,
      row: 'head-not-red',
      reason: `The case ${CASE_NAME} is not red on the head, so it reads as a bug. It was green.`,
    });
  });

  it('reads a case the head could not run as a bug, naming the problem', () => {
    const checked = checkKind(input(testEntry('own-gap'), { base: GREEN, head: UNRUNNABLE }));

    expect([checked.kind, checked.row]).toEqual(['bug', 'head-not-red']);
    expect(checked.reason).toContain(UNRUNNABLE.problem);
  });

  it('confirms the same claim once the head is red: the control', () => {
    const checked = checkKind(input(testEntry('own-fallout'), { base: GREEN, head: RED }));

    expect([checked.kind, checked.row]).toEqual(['own-fallout', 'fallout']);
  });
});

describe('checkKind: a path outside the plan\'s commits', () => {
  it('reads an own-gap claim naming a file the plan did not touch as a bug', () => {
    const checked = checkKind(input(entry('own-gap', 'src/neighbour.ts drops a line'), null));

    expect(checked).toEqual({
      kind: 'bug',
      inherited: false,
      row: 'file-outside-plan',
      reason: 'src/neighbour.ts is not one of the plan\'s files, so it reads as a bug.',
    });
  });

  it('reads an entry naming one plan file and one neighbour as a bug', () => {
    const checked = checkKind(input(entry('own-gap', 'src/edited.ts calls src/neighbour.ts wrong'), null));

    expect([checked.kind, checked.row]).toEqual(['bug', 'file-outside-plan']);
  });

  it('confirms the claim when the file named is the plan\'s: the control', () => {
    const checked = checkKind(input(entry('own-gap', 'src/edited.ts drops a line'), null));

    expect([checked.kind, checked.row]).toEqual(['own-gap', 'plan-files']);
  });
});

/** The plan's files the path-shape cases read: a nested source file, a `.tsx` and a `.mts`. */
const SHAPE_FILES: PlanFilesReading = {
  ok: true,
  files: ['packages/rafa-pr/src/triage/base-run.ts', 'src/view/panel.tsx', 'src/build/emit.mts'],
};

describe('checkKind: path shapes that name no plan file', () => {
  it('does not read a neighbour\'s folder as a plan file: a bug claim naming one stays a bug', () => {
    const checked = checkKind(input(entry('bug', 'packages/rafa-effort drops a row'), null, SHAPE_FILES));

    expect([checked.kind, checked.row]).toEqual(['bug', 'nothing-named']);
  });

  it('names the neighbour\'s file, not its folder, when both are named', () => {
    const what = 'packages/rafa-effort breaks packages/rafa-effort/src/store.ts';
    const checked = checkKind(input(entry('own-gap', what), null, SHAPE_FILES));

    expect(checked.reason).toBe('packages/rafa-effort/src/store.ts is not one of the plan\'s files, so it reads as a bug.');
  });

  it('reads a .js specifier of a file outside the plan as a bug', () => {
    for (const what of ['imports ../neighbour.js', 'imports ./triage/neighbour.js', 'imports neighbour.js']) {
      const checked = checkKind(input(entry('own-gap', what), null, SHAPE_FILES));

      expect([what, checked.kind, checked.row]).toEqual([what, 'bug', 'file-outside-plan']);
    }
  });

  it('matches a relative specifier only at a segment boundary', () => {
    expect(checkKind(input(entry('own-gap', 'imports ./un-base-run.js'), null, SHAPE_FILES)).kind).toBe('bug');
  });

  it('does not read a plain path as a suffix: only a relative one', () => {
    expect(checkKind(input(entry('own-gap', 'triage/base-run.ts drops a line'), null, SHAPE_FILES)).kind).toBe('bug');
  });

  it('does not read a .ts specifier as a .js file of the plan', () => {
    const plan: PlanFilesReading = { ok: true, files: ['src/emitted.js'] };

    expect(checkKind(input(entry('own-gap', 'imports ./emitted.ts'), null, plan)).kind).toBe('bug');
  });
});

describe('checkKind: path shapes that name a plan file', () => {
  it('takes a folder named beside a plan file out of the file rows: the folder control', () => {
    const checked = checkKind(input(entry('bug', 'packages/rafa-effort calls ../base-run.js'), null, SHAPE_FILES));

    expect([checked.kind, checked.row]).toEqual(['own-gap', 'plan-files']);
  });

  it('reads a .js, .jsx or .mjs specifier as the plan\'s .ts, .tsx or .mts file', () => {
    const texts = [
      'imports ../base-run.js',
      'imports ./src/triage/base-run.js',
      'imports ../../view/panel.jsx',
      'imports ./emit.mjs',
      'base-run.js drops a line',
      'packages/rafa-pr/src/triage/base-run.js drops a line',
    ];
    for (const what of texts) {
      const checked = checkKind(input(entry('bug', what), null, SHAPE_FILES));

      expect([what, checked.kind]).toEqual([what, 'own-gap']);
    }
  });

  it('still reads a .js file of the plan as written', () => {
    const plan: PlanFilesReading = { ok: true, files: ['scripts/build.js'] };

    expect(checkKind(input(entry('bug', 'imports ../build.js'), null, plan)).kind).toBe('own-gap');
  });
});

describe('checkKind: a case that cannot be run on the base', () => {
  it('reads a case red on the head and unrunnable on the base as a bug, naming the problem', () => {
    const checked = checkKind(input(testEntry('own-fallout'), { base: UNRUNNABLE, head: RED }));

    expect(checked).toEqual({
      kind: 'bug',
      inherited: false,
      row: 'base-unrunnable',
      reason: `The case ${CASE_NAME} could not be run on the plan's base, so it reads as a bug. ${UNRUNNABLE.problem}`,
    });
  });

  it('reads a named case given no readings as a bug', () => {
    const checked = checkKind(input(testEntry('own-fallout'), null));

    expect([checked.kind, checked.row]).toEqual(['bug', 'base-unrunnable']);
  });

  it('reads a case named with no test file as a bug, whatever readings came with it', () => {
    const noFile = entry('own-fallout', 'a test went red', '(fail) outer > fails [0.19ms]');

    expect(namedTestOf(noFile)).toBeNull();
    const checked = checkKind(input(noFile, { base: GREEN, head: RED }));

    expect([checked.kind, checked.row]).toEqual(['bug', 'base-unrunnable']);
  });

  it('confirms the claim once the base runs green: the control', () => {
    const checked = checkKind(input(testEntry('own-fallout'), { base: GREEN, head: RED }));

    expect(checked.kind).toBe('own-fallout');
  });
});

describe('checkKind: a case red on the base and the head', () => {
  it('reads it as inherited, its kind bug, whatever the session said', () => {
    for (const said of ['bug', 'own-fallout', 'own-gap'] as const) {
      const checked = checkKind(input(testEntry(said), { base: RED, head: RED }));

      expect([said, checked]).toEqual([said, {
        kind: 'bug',
        inherited: true,
        row: 'red-on-both',
        reason: `The case ${CASE_NAME} is red on the plan's base and its head, so the plan inherited it.`,
      }]);
    }
  });
});

describe('checkKind: a case green on the base and red on the head', () => {
  it('reads it as own-fallout, a bug the session called one included', () => {
    for (const said of ['bug', 'own-fallout', 'own-gap'] as const) {
      const checked = checkKind(input(testEntry(said), { base: GREEN, head: RED }));

      expect([said, checked]).toEqual([said, {
        kind: 'own-fallout',
        inherited: false,
        row: 'fallout',
        reason: `The case ${CASE_NAME} is green on the plan's base and red on its head.`,
      }]);
    }
  });

  it('reads the test rows before the file rows: a named case outside the plan\'s files is still fallout', () => {
    const outside = entry('bug', 'a test went red', 'src/other.test.ts > outer > fails');

    expect(checkKind(input(outside, { base: GREEN, head: RED })).kind).toBe('own-fallout');
  });
});

describe('checkKind: the plan\'s files not read', () => {
  it('reads an entry naming a path as a bug, naming the problem', () => {
    const unread: PlanFilesReading = { ok: false, problem: 'Could not list the files changed between abc and HEAD.' };
    const checked = checkKind(input(entry('own-gap', 'src/edited.ts drops a line'), null, unread));

    expect(checked).toEqual({
      kind: 'bug',
      inherited: false,
      row: 'files-unread',
      reason: 'The plan\'s files were not read, so it reads as a bug. Could not list the files changed between abc and HEAD.',
    });
  });
});

describe('checkKind: every path named one of the plan\'s files', () => {
  it('reads a bug the session called one as own-gap', () => {
    const checked = checkKind(input(entry('bug', 'src/edited.ts drops a line'), null));

    expect(checked).toEqual({
      kind: 'own-gap',
      inherited: false,
      row: 'plan-files',
      reason: 'Every path the entry names is one of the plan\'s files.',
    });
  });

  it('matches a path through ./, a position, an absolute checkout path and a bare file name', () => {
    const texts = [
      'see ./src/edited.ts',
      'see `src/edited.ts:12:3`.',
      'at /home/someone/rafa/src/edited.ts:4',
      'edited.ts drops a line',
    ];
    for (const what of texts) {
      expect([what, checkKind(input(entry('bug', what), null)).kind]).toEqual([what, 'own-gap']);
    }
  });

  it('reads both the what and the artifact', () => {
    const inArtifact = entry('bug', 'drops a line', 'src/neighbour.ts:3');

    expect(checkKind(input(inArtifact, null)).kind).toBe('bug');
    expect(checkKind(input(entry('bug', 'drops a line', 'src/edited.ts:3'), null)).kind).toBe('own-gap');
  });

  it('reads a test file named with no case by the file rows', () => {
    const fileOnly = entry('bug', 'src/a.test.ts:246 asserts the old title');

    expect(namedTestOf(fileOnly)).toBeNull();
    expect(checkKind(input(fileOnly, null)).row).toBe('plan-files');
  });

  it('does not take a different file of the same folder for one of the plan\'s', () => {
    expect(checkKind(input(entry('own-gap', 'src/edited.tsx drops a line'), null)).kind).toBe('bug');
    expect(checkKind(input(entry('own-gap', 'lib/src/edited.ts drops a line'), null)).kind).toBe('bug');
  });
});

describe('checkKind: neither a test case nor a path named', () => {
  it('takes each checked kind as said', () => {
    for (const said of ['bug', 'own-fallout', 'own-gap'] as const) {
      const checked = checkKind(input(entry(said, 'the title reads wrong'), null));

      expect([said, checked]).toEqual([said, {
        kind: said,
        inherited: false,
        row: 'nothing-named',
        reason: 'The entry names no test case and no path, so it is taken as said.',
      }]);
    }
  });
});

describe('checkKind: a kind the check does not read', () => {
  it('takes convention, docs and machine as said, a red case and a plan file named', () => {
    for (const said of ['convention', 'docs', 'machine'] as const) {
      const checked = checkKind(input(entry(said, 'src/edited.ts is long', CASE_LINE), { base: GREEN, head: RED }));

      expect([said, checked]).toEqual([said, {
        kind: said,
        inherited: false,
        row: 'as-said',
        reason: `The kind ${said} is not checked, so it is taken as said.`,
      }]);
    }
  });
});

describe('namedTestOf', () => {
  it('answers the file and case an entry names', () => {
    expect(namedTestOf(testEntry('bug'))).toEqual({ file: 'src/a.test.ts', name: CASE_NAME });
  });

  it('answers null for an entry naming no case', () => {
    expect(namedTestOf(entry('bug', 'src/edited.ts drops a line'))).toBeNull();
  });
});
