/**
 * Tests for the pinned resolve-plan loader (`src/pr/plans/load.ts`).
 *
 * Two halves, and they are tested against different things on purpose:
 *
 *  - The LOOKUP is filesystem work, so every case plants its own
 *    `mkdtemp` directory and points the reader at it with `moduleDir`.
 *    Nothing here reads or writes outside that directory except the
 *    shipped-roster cases, which read `src/pr/plans/` itself because
 *    what they measure is that the markdown is there.
 *  - The FILL is a pure function from a template and a triage block to
 *    a string, so those cases are literals.
 *
 * ## What the cases are FOR
 *
 * The three ways this module can be wrong quietly, each with a control
 * that proves the check could have failed:
 *
 *  - Picking the WRONG copy. The two candidates cannot both exist in a
 *    real layout, so a reader that had them backwards would still find a
 *    file in every real tree and never fail. The case therefore plants
 *    BOTH with different bodies and asserts which one wins; the
 *    checkout-layout case then plants only the second, so the
 *    preference is measured rather than inferred from one reading.
 *  - Eating `{agent=loop-implementer}`. Every shipped plan routes its
 *    tasks with that declaration, and a fill treating it as a slot would
 *    either strip it or refuse the plan. Its control is an UPPER_SNAKE
 *    slot on the SAME line, which must be filled in the same pass.
 *  - Rewriting a value through `$&`. A string replacement would expand
 *    it, and the result would still look like a filled plan. The case
 *    drives a value holding `$&`, `` $` ``, `$'` and `$1` and asserts it
 *    comes through byte for byte.
 *
 * The end-to-end cases run over the plans that actually ship, not over
 * fixtures: the filled lockfile plan is handed to `parsePlan` and held
 * to no issues and to its `loop-implementer` agents, so a slot edit that
 * broke the plan format fails here rather than at the first resolve.
 */
import type { TriageBlock } from '../triage/comment.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, test } from 'bun:test';

import { parsePlan } from '../../plan/parse.js';
import { DEPENDENCY_BUMP_SIMPLE_CLASSES, SIMPLE_TRIAGE_CLASSES } from '../triage/classes.js';

import {
  CONFLICT_FILES_SLOT,
  CONFLICT_SENTENCE_SLOT,
  fillPinnedPlan,
  hasPinnedPlan,
  loadPinnedPlan,
  NO_CONFLICT_FILES,
  PINNED_PLAN_CLASSES,
  PINNED_PLANS_DIRNAME,
  pinnedPlanCandidates,
  pinnedPlanFileName,
  pinnedPlanValues,
  readPinnedPlan,
} from './load.js';

/** The checkout directory the plans ship in, which the roster cases read. */
const PLANS_DIR = dirname(fileURLToPath(import.meta.url));

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pinned-plan-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let nextDir = 0;

/** A fresh empty directory under this file's own temporary base. */
function scratchDir(): string {
  nextDir += 1;
  const dir = join(tempBase, `case-${String(nextDir)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A triage block with every field null but the ones a case names. */
function blockWith(fields: Partial<TriageBlock>): TriageBlock {
  return {
    head: null,
    at: null,
    class: null,
    simple: null,
    attempts: null,
    files: null,
    ...fields,
  };
}

/** A sentence standing in for the shared mechanical-conflict one. */
const SENTENCE = 'Resolve MECHANICAL conflicts yourself and keep BOTH sides.';

describe('the pinned plans that ship', () => {
  test('one plan ships for every class a resolve can act on', () => {
    for (const triageClass of PINNED_PLAN_CLASSES) {
      const file = join(PLANS_DIR, pinnedPlanFileName(triageClass));
      expect({ triageClass, exists: existsSync(file) })
        .toEqual({ triageClass, exists: true });
    }
  });

  test('the roster is exactly the two simple lists, from both ends', () => {
    expect(PINNED_PLAN_CLASSES).toEqual([
      'conflict-lockfile',
      'conflict-manifest',
      'ci-install',
      'ci-lint',
    ]);
    expect(PINNED_PLAN_CLASSES)
      .toEqual([...SIMPLE_TRIAGE_CLASSES, ...DEPENDENCY_BUMP_SIMPLE_CLASSES]);
  });

  test('a class outside the roster has no plan and is refused by name', () => {
    expect(hasPinnedPlan('conflict-other')).toBe(false);
    expect(hasPinnedPlan('ci-test')).toBe(false);
    expect(hasPinnedPlan('green')).toBe(false);
    expect(() => readPinnedPlan('conflict-other'))
      .toThrow('No pinned resolve plan ships for conflict-other');
  });

  test('a class inside the roster is one, which is the control', () => {
    expect(hasPinnedPlan('conflict-lockfile')).toBe(true);
    expect(hasPinnedPlan('ci-lint')).toBe(true);
  });

  test('the file name is the class with a resolve prefix', () => {
    expect(pinnedPlanFileName('conflict-lockfile')).toBe('resolve-conflict-lockfile.md');
    expect(pinnedPlanFileName('ci-install')).toBe('resolve-ci-install.md');
  });
});

describe('where a plan is looked for', () => {
  test('the two candidates are the build copy then the checkout copy', () => {
    expect(pinnedPlanCandidates('/somewhere/dist', 'ci-lint')).toEqual([
      join('/somewhere/dist', PINNED_PLANS_DIRNAME, 'resolve-ci-lint.md'),
      join('/somewhere/dist', 'resolve-ci-lint.md'),
    ]);
  });

  test('the build copy beside the bundle wins over one loose in the same directory', () => {
    const dir = scratchDir();
    mkdirSync(join(dir, PINNED_PLANS_DIRNAME));
    writeFileSync(join(dir, PINNED_PLANS_DIRNAME, 'resolve-ci-lint.md'), 'from the build copy');
    writeFileSync(join(dir, 'resolve-ci-lint.md'), 'from the loose copy');

    expect(readPinnedPlan('ci-lint', { moduleDir: dir })).toBe('from the build copy');
  });

  test('the checkout copy is read when no build copy is there', () => {
    const dir = scratchDir();
    writeFileSync(join(dir, 'resolve-ci-lint.md'), 'from the checkout copy');

    expect(readPinnedPlan('ci-lint', { moduleDir: dir })).toBe('from the checkout copy');
  });

  test('neither copy refuses naming both paths it looked at', () => {
    const dir = scratchDir();
    let message = '';
    try {
      readPinnedPlan('ci-lint', { moduleDir: dir });
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    expect(message).toContain(join(dir, PINNED_PLANS_DIRNAME, 'resolve-ci-lint.md'));
    expect(message).toContain(join(dir, 'resolve-ci-lint.md'));
    expect(message).toContain('is missing');
  });

  test('no moduleDir reads the plans beside this module', () => {
    expect(readPinnedPlan('conflict-lockfile'))
      .toBe(readPinnedPlan('conflict-lockfile', { moduleDir: PLANS_DIR }));
    expect(readPinnedPlan('conflict-lockfile')).toContain('# Plan: Resolve lockfile conflict');
  });
});

describe('filling a template', () => {
  test('a slot is replaced by its value, at every occurrence', () => {
    const filled = fillPinnedPlan('a {ONE} b {ONE} c {TWO}', { ONE: 'x', TWO: 'y' });

    expect(filled).toBe('a x b x c y');
  });

  test('an agent declaration is not a slot and survives the fill', () => {
    const template = '- [ ] Repair {CONFLICT_FILES} {agent=loop-implementer}';

    const filled = fillPinnedPlan(template, { [CONFLICT_FILES_SLOT]: '`bun.lock`' });

    expect(filled).toBe('- [ ] Repair `bun.lock` {agent=loop-implementer}');
  });

  test('a lower-case or mixed-case brace token is left alone', () => {
    const template = '{agent=build-error-resolver} {model=opus} {Mixed_Case} {a}';

    expect(fillPinnedPlan(template, {})).toBe(template);
  });

  test('a value holding replacement patterns comes through verbatim', () => {
    const value = '$& and $` and $\' and $1 and $$';

    const filled = fillPinnedPlan('before {ONE} after', { ONE: value });

    expect(filled).toBe(`before ${value} after`);
  });

  test('an unfilled slot is refused by name rather than emptied', () => {
    expect(() => fillPinnedPlan('a {ONE} b {MISSING_ONE}', { ONE: 'x' }))
      .toThrow('The pinned resolve plan has unfilled slots: {MISSING_ONE}');
  });

  test('a value for a slot the template lacks is unused', () => {
    const template = 'a plan with no slots at all {agent=loop-implementer}';

    expect(fillPinnedPlan(template, { [CONFLICT_SENTENCE_SLOT]: SENTENCE })).toBe(template);
  });
});

describe('the values a triage block answers', () => {
  test('the conflict sentence is passed through as handed in', () => {
    const values = pinnedPlanValues({ block: blockWith({}), conflictSentence: SENTENCE });

    expect(values[CONFLICT_SENTENCE_SLOT]).toBe(SENTENCE);
  });

  test('the conflicting files are backticked and comma-joined', () => {
    const block = blockWith({ files: ['bun.lock', 'package.json'] });

    const values = pinnedPlanValues({ block, conflictSentence: SENTENCE });

    expect(values[CONFLICT_FILES_SLOT]).toBe('`bun.lock`, `package.json`');
  });

  test('one file is rendered without a separator', () => {
    const block = blockWith({ files: ['bun.lock'] });

    expect(pinnedPlanValues({ block, conflictSentence: SENTENCE })[CONFLICT_FILES_SLOT])
      .toBe('`bun.lock`');
  });

  test('files the block never recorded become a sentence, not an empty string', () => {
    const forNull = pinnedPlanValues({ block: blockWith({ files: null }), conflictSentence: SENTENCE });
    const forEmpty = pinnedPlanValues({ block: blockWith({ files: [] }), conflictSentence: SENTENCE });

    expect(forNull[CONFLICT_FILES_SLOT]).toBe(NO_CONFLICT_FILES);
    expect(forEmpty[CONFLICT_FILES_SLOT]).toBe(NO_CONFLICT_FILES);
    expect(NO_CONFLICT_FILES.length).toBeGreaterThan(0);
  });
});

describe('loading a plan that ships', () => {
  const fill = {
    block: blockWith({ class: 'conflict-lockfile', files: ['bun.lock'] }),
    conflictSentence: SENTENCE,
  };

  test('the lockfile plan carries the sentence and the files and no slot', () => {
    const plan = loadPinnedPlan('conflict-lockfile', fill);

    expect(plan).toContain(SENTENCE);
    expect(plan).toContain('`bun.lock`');
    expect(plan).not.toContain(`{${CONFLICT_SENTENCE_SLOT}}`);
    expect(plan).not.toContain(`{${CONFLICT_FILES_SLOT}}`);
    expect(plan).toContain('{agent=loop-implementer}');
  });

  test('the manifest plan carries the same sentence, from the same source', () => {
    const plan = loadPinnedPlan('conflict-manifest', {
      block: blockWith({ files: ['package.json'] }),
      conflictSentence: SENTENCE,
    });

    expect(plan).toContain(SENTENCE);
    expect(plan).toContain('`package.json`');
    expect(plan).toContain('the higher version where both bumped one');
  });

  test('the filled plan still parses clean and keeps its agents', () => {
    const model = parsePlan(loadPinnedPlan('conflict-lockfile', fill));

    expect(model.issues).toEqual([]);
    expect(model.header.stub).toBe('resolve-conflict-lockfile');
    expect(model.tasks.length).toBeGreaterThan(0);
    expect(model.tasks.map((task) => task.declaration?.agent ?? null))
      .toEqual(model.tasks.map(() => 'loop-implementer'));
  });

  test('a plan with no slots comes back byte-identical to the file', () => {
    const loaded = loadPinnedPlan('ci-install', fill);

    expect(loaded).toBe(readPinnedPlan('ci-install'));
    expect(parsePlan(loaded).tasks.map((task) => task.declaration?.agent ?? null))
      .toEqual(['build-error-resolver']);
  });

  test('a class with no plan is refused before any file is read', () => {
    expect(() => loadPinnedPlan('ci-types', fill))
      .toThrow('No pinned resolve plan ships for ci-types');
  });
});
