/**
 * Tests for the compaction decision.
 *
 * The subject is a pure function over two numbers, so the whole of
 * the interesting surface is BOUNDARIES: which side of each cap the
 * comparison falls on, and which of the four rules answers when more
 * than one could. Every case therefore names its own zone, and the
 * three the task is defined by — under the cap, AT the cap, over it
 * — are each driven at the exact byte rather than near it.
 *
 * The thresholds are pinned to LITERALS and never to the module's own
 * constants. A case comparing a constant against itself moves with
 * the constant, so it cannot tell a 16,000-byte cap from a
 * 160,000-byte one, and these numbers are not free inventions: the
 * hard cap is the character cap `plan.ts` truncates the injected
 * findings at, and the soft cap is `progress-hygiene`'s own ~8k
 * figure. The literal is the record of what was measured.
 *
 * That copied hard cap is held to its source by a drift guard, which
 * reads `plan.ts` for its own `PROGRESS_CAP_CHARS` and parses the
 * number out. Nothing else ties the two files together — a change
 * there would otherwise leave the loop enforcing a cap the injection
 * no longer has, in either direction, silently. Its own liveness
 * control is a fabricated constant name asserted absent from the same
 * text, so a guard that had stopped finding anything reds.
 *
 * The gitignore claim is asserted rather than stated, for the same
 * reason: the module's TSDoc rests a behavioural conclusion on it (a
 * compaction changes no tracked file, so `commitFinishedTask` reaches
 * `nothing-to-commit` by the ordinary route), and one line of the
 * root `.gitignore` is the whole of what makes it true.
 *
 * Two claims are deliberately NOT here, both because the plan gives
 * them tasks of their own. That the loop dispatches a compaction
 * session exactly once when the cap is crossed and not at all while
 * under it is an INTEGRATION claim about `start.ts`, which this
 * module cannot see; and the skill's own sentence about the cadence
 * is a document, not a function.
 *
 * MUTATION NOTE. Twenty-six legs were driven against this file from
 * a script that restores from a captured copy and asks the runner
 * for case NAMES through `--reporter=json`: 26 applied, 26 red, 0
 * green, the union covering all 41 cases, and both mutated files
 * byte-identical afterwards. Two are worth naming for their shape. A
 * NaN size is refused by TWO rules that shadow each other — the
 * finite check and the `>= 0` — so neither solo leg reddens the
 * not-a-number cases and only the COMPOUND leg dropping the whole
 * guard does. And the drift guard's own control is reachable by no
 * mutation of this module at all: the leg that reddens it renames
 * `PROGRESS_CAP_CHARS` in `plan.ts`, three edits in one leg, which
 * is what says the guard reads its source rather than a copy of it.
 * The first pass ran 21 module-only legs and left seven cases
 * unreddened — two monotonicity properties, two shadowed NaN cases,
 * two size readings and that control — and the five legs that closed
 * it are the two INVERTED comparisons, the compound state guard, the
 * size reader answering zero, and the `plan.ts` rename.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_COMPACTION_THRESHOLDS,
  DUE_REASONS,
  isCompactionDue,
  MIN_TASKS_SINCE_COMPACTION,
  PROGRESS_CADENCE_TASKS,
  PROGRESS_FILE_NAME,
  PROGRESS_HARD_CAP_BYTES,
  PROGRESS_INJECTION_CAP_CHARS,
  PROGRESS_SOFT_CAP_BYTES,
  progressFilePath,
  readProgressSizeBytes,
} from './progress.js';

/** The hard cap, as a literal. */
const HARD = 16_000;

/** The soft cap, as a literal. */
const SOFT = 8_000;

/** The cadence, as a literal. */
const CADENCE = 10;

/** One decision, spelled the way the loop takes it. */
function decide(
  sizeBytes: number,
  tasksSinceCompaction: number,
  overrides: Parameters<typeof isCompactionDue>[1] = {},
) {
  return isCompactionDue({ sizeBytes, tasksSinceCompaction }, overrides);
}

/** Text of a file at the repo root, read from this file's own path. */
function repoText(relative: string): string {
  const url = new URL(`../../../${relative}`, import.meta.url);
  return readFileSync(url, 'utf8');
}

/** A scratch directory, removed once the file is done. */
const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-progress-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Plants a file of known content and answers its path. */
function plant(name: string, content: string): string {
  const path = join(tempRoot, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

describe('the thresholds', () => {
  it('caps the file at the injection cap, in bytes', () => {
    expect(PROGRESS_HARD_CAP_BYTES).toBe(16_000);
    expect(PROGRESS_INJECTION_CAP_CHARS).toBe(16_000);
  });

  it('never lets the loop sit above the injection cap', () => {
    expect(PROGRESS_HARD_CAP_BYTES).toBeLessThanOrEqual(
      PROGRESS_INJECTION_CAP_CHARS,
    );
  });

  it('puts the soft cap at the skill\'s own figure', () => {
    expect(PROGRESS_SOFT_CAP_BYTES).toBe(8_000);
    expect(PROGRESS_SOFT_CAP_BYTES).toBeLessThan(PROGRESS_HARD_CAP_BYTES);
  });

  it('rolls every ten tasks, after at least one', () => {
    expect(PROGRESS_CADENCE_TASKS).toBe(10);
    expect(MIN_TASKS_SINCE_COMPACTION).toBe(1);
  });

  it('defaults to exactly those three numbers', () => {
    expect(DEFAULT_COMPACTION_THRESHOLDS).toEqual({
      hardCapBytes: 16_000,
      softCapBytes: 8_000,
      cadenceTasks: 10,
    });
  });

  it('answers due for exactly two reasons', () => {
    expect([...DUE_REASONS]).toEqual(['hard-cap', 'cadence']);
  });
});

describe('the injection cap this one is copied from', () => {
  it('still reads 16,000 characters in plan.ts', () => {
    const source = repoText('tools/ralph/plan.ts');
    const match = source.match(/PROGRESS_CAP_CHARS\s*=\s*([0-9_]+)/);
    const spelled = match?.[1];

    expect(spelled).toBeDefined();
    expect(Number(spelled?.replaceAll('_', ''))).toBe(
      PROGRESS_INJECTION_CAP_CHARS,
    );
  });

  it('proves that guard fails on a constant nothing spells', () => {
    const source = repoText('tools/ralph/plan.ts');

    expect(source).toContain('PROGRESS_CAP_CHARS');
    expect(source).not.toContain('PROGRESS_CAP_KILOBYTES');
  });

  it('keeps progress.txt out of every commit', () => {
    const ignored = repoText('.gitignore').split('\n')
      .map((l) => l.trim());

    expect(ignored).toContain(PROGRESS_FILE_NAME);
    expect(ignored).not.toContain('progress-notes.txt');
  });
});

describe('under the cap', () => {
  it('is not due on an empty file, however many tasks ran', () => {
    const decision = decide(0, CADENCE * 5);

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe('under-soft-cap');
  });

  it('is not due one byte under the soft cap', () => {
    const decision = decide(SOFT - 1, CADENCE);

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe('under-soft-cap');
  });

  it('is not due one byte under the hard cap before the cadence', () => {
    const decision = decide(HARD - 1, CADENCE - 1);

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe('within-cadence');
  });

  it('outranks the cadence with the soft cap, not the other way', () => {
    expect(decide(SOFT - 1, CADENCE * 100).reason).toBe('under-soft-cap');
    expect(decide(SOFT, CADENCE * 100).reason).toBe('cadence');
  });
});

describe('at the cap', () => {
  it('is due at the hard cap exactly', () => {
    const decision = decide(HARD, 1);

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe('hard-cap');
  });

  it('is due at the soft cap exactly, once the cadence comes round', () => {
    const decision = decide(SOFT, CADENCE);

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe('cadence');
  });

  it('is not due at the soft cap one task short of the cadence', () => {
    const decision = decide(SOFT, CADENCE - 1);

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe('within-cadence');
  });

  it('is due on the task that reaches the cadence, not before', () => {
    const sizes = [SOFT, HARD - 1];
    for (const size of sizes) {
      expect(decide(size, CADENCE - 1).due).toBe(false);
      expect(decide(size, CADENCE).due).toBe(true);
    }
  });
});

describe('over the cap', () => {
  it('is due one byte over the hard cap, on the first task', () => {
    const decision = decide(HARD + 1, 1);

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe('hard-cap');
  });

  it('names the hard cap when the cadence would also answer', () => {
    const decision = decide(HARD * 8, CADENCE * 3);

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe('hard-cap');
  });

  it('is not due again until another task has appended', () => {
    const overCap = decide(HARD * 8, 0);

    expect(overCap.due).toBe(false);
    expect(overCap.reason).toBe('no-tasks-since');
    expect(decide(HARD * 8, 1).due).toBe(true);
  });
});

describe('a state it cannot read', () => {
  const unusable: readonly (readonly [string, number, number])[] = [
    ['a size that is not a number', Number.NaN, 1],
    ['an infinite size', Number.POSITIVE_INFINITY, 1],
    ['a negative size', -1, 1],
    ['a counter that is not a number', HARD * 8, Number.NaN],
    ['a negative counter', HARD * 8, -1],
  ];

  it.each(unusable)('is not due on %s', (_label, size, tasks) => {
    const decision = decide(size, tasks);

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe('unreadable-state');
  });

  it('keeps a readable state out of that branch', () => {
    expect(decide(HARD * 8, 1).reason).toBe('hard-cap');
    expect(decide(0, 0).reason).toBe('no-tasks-since');
  });
});

describe('what a decision carries', () => {
  it('echoes the state it decided on', () => {
    const decision = decide(9_001, 3);

    expect(decision.sizeBytes).toBe(9_001);
    expect(decision.tasksSinceCompaction).toBe(3);
    expect(decision.thresholds).toEqual(DEFAULT_COMPACTION_THRESHOLDS);
  });

  it('echoes an unreadable state unchanged', () => {
    const decision = decide(-5, 2);

    expect(decision.sizeBytes).toBe(-5);
    expect(decision.tasksSinceCompaction).toBe(2);
  });

  it('agrees with its own reason about being due', () => {
    const sizes = [0, SOFT - 1, SOFT, HARD - 1, HARD, HARD + 1, HARD * 4];
    const counts = [0, 1, CADENCE - 1, CADENCE, CADENCE + 1];
    const seen = new Set<string>();

    for (const size of sizes) {
      for (const count of counts) {
        const decision = decide(size, count);
        const isDueReason = (DUE_REASONS as readonly string[])
          .includes(decision.reason);
        expect(decision.due).toBe(isDueReason);
        seen.add(decision.reason);
      }
    }

    expect([...seen].sort()).toEqual([
      'cadence',
      'hard-cap',
      'no-tasks-since',
      'under-soft-cap',
      'within-cadence',
    ]);
  });

  it('never becomes less due as the file grows', () => {
    const sizes = [0, SOFT - 1, SOFT, HARD - 1, HARD, HARD * 4];
    for (const count of [1, CADENCE - 1, CADENCE]) {
      const flags = sizes.map((size) => decide(size, count).due);
      const sorted = [...flags].sort((a, b) => Number(a) - Number(b));
      expect(flags).toEqual(sorted);
    }
  });

  it('never becomes less due as tasks accumulate', () => {
    const counts = [0, 1, CADENCE - 1, CADENCE, CADENCE * 4];
    for (const size of [0, SOFT, HARD - 1, HARD]) {
      const flags = counts.map((count) => decide(size, count).due);
      const sorted = [...flags].sort((a, b) => Number(a) - Number(b));
      expect(flags).toEqual(sorted);
    }
  });
});

describe('thresholds a caller supplies', () => {
  it('takes a lower hard cap over the default', () => {
    const decision = decide(SOFT, 1, { hardCapBytes: SOFT });

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe('hard-cap');
    expect(decide(SOFT, 1).due).toBe(false);
  });

  it('takes a shorter cadence over the default', () => {
    const decision = decide(SOFT, 2, { cadenceTasks: 2 });

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe('cadence');
    expect(decide(SOFT, 2).reason).toBe('within-cadence');
  });

  it('merges a partial override onto the defaults', () => {
    const decision = decide(SOFT - 1, 1, { softCapBytes: 100 });

    expect(decision.thresholds).toEqual({
      hardCapBytes: 16_000,
      softCapBytes: 100,
      cadenceTasks: 10,
    });
    expect(decision.reason).toBe('within-cadence');
  });

  it('leaves the module default untouched by an override', () => {
    decide(0, 0, { hardCapBytes: 1, softCapBytes: 1, cadenceTasks: 1 });

    expect(DEFAULT_COMPACTION_THRESHOLDS).toEqual({
      hardCapBytes: 16_000,
      softCapBytes: 8_000,
      cadenceTasks: 10,
    });
  });
});

describe('reading the size off disk', () => {
  it('answers the byte length of the file', () => {
    const path = plant('ascii.txt', 'a'.repeat(1_234));

    expect(readProgressSizeBytes(path)).toBe(1_234);
  });

  it('counts bytes and not characters', () => {
    const content = '— a finding wrapped at 72 —';
    const path = plant('wide.txt', content);
    const bytes = readProgressSizeBytes(path);

    expect(bytes).toBe(Buffer.byteLength(content, 'utf8'));
    expect(bytes).toBeGreaterThan(content.length);
  });

  it('answers zero for a file that is not there', () => {
    expect(readProgressSizeBytes(join(tempRoot, 'absent.txt'))).toBe(0);
  });

  it('answers zero for a directory of that name', () => {
    const path = join(tempRoot, 'a-directory');
    mkdirSync(path, { recursive: true });

    expect(readProgressSizeBytes(path)).toBe(0);
  });

  it('finds progress.txt under a repo root', () => {
    expect(progressFilePath('/tmp/somewhere')).toBe(
      join('/tmp/somewhere', 'progress.txt'),
    );
  });

  it('decides over a planted file the way the loop would', () => {
    const root = join(tempRoot, 'repo');
    mkdirSync(root, { recursive: true });
    const path = progressFilePath(root);
    writeFileSync(path, 'x'.repeat(HARD + 10), 'utf8');

    const state = {
      sizeBytes: readProgressSizeBytes(path),
      tasksSinceCompaction: 1,
    };

    expect(isCompactionDue(state).reason).toBe('hard-cap');
    writeFileSync(path, 'x'.repeat(SOFT - 1), 'utf8');
    expect(isCompactionDue({
      sizeBytes: readProgressSizeBytes(path),
      tasksSinceCompaction: 1,
    }).reason).toBe('under-soft-cap');
  });
});
