/**
 * Tests for the session classifier.
 *
 * Every prompt here is PLANTED — assembled the way the loop assembles
 * it, never copied out of a real log. Two cases reach outside that: the
 * drift guard reads `start.ts` and `plan-prompt.md`, which is the point
 * of it, and neither reads a session log.
 *
 * The foreign needle is built from fragments in the same style
 * `naming-patterns.ts` uses for the de-origination set, for the same
 * reason and one more: the session logs this collector scans include
 * THIS session's own transcript, so a needle written out contiguously
 * anywhere in a task working on them goes live in the population being
 * measured.
 *
 * Eleven module mutations were driven against this file and every one
 * reddened at least one case, with the restored module green either
 * side: dropping the first-line infix check, widening `startsWith` to
 * `includes`, keying the enqueue scan on record 0 instead of the
 * type/operation pair, removing the window bound, leaking the prompt
 * content onto the classification, altering a shape prefix, collapsing
 * the classifier to a constant `other`, charging blank lines against
 * the budget, searching the whole content instead of its first line,
 * deleting the CI-repair shape, and renaming the task shape's kind.
 * Leg counts are deliberately not recorded — they drift with every
 * case added here, where the legs themselves do not.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { buildCompactionPrompt } from '../start.js';

import {
  classifyPromptContent,
  classifySessionLines,
  classifySessionLog,
  ENQUEUE_SCAN_WINDOW,
  findFirstEnqueue,
  matchesShape,
  PROMPT_SHAPES,
} from './classify.js';

/** A task prompt, assembled as `start.ts` assembles it. */
const TASK_PROMPT = [
  'Your scoped task is: Add `tools/ralph/effort/classify.ts`',
  'Consider tasks listed above this one as completed.',
  '',
  '# Plan: q19',
].join('\n');

/** A plan-generation prompt: `plan-prompt.md` with its slots filled. */
const PLAN_PROMPT = [
  '# Plan-generation instructions',
  '',
  'Create a plan based on the spec provided below.',
].join('\n');

/** A wrap-up prompt, assembled as `preserveProgress` assembles it. */
const WRAPUP_PROMPT = [
  '* Read `@progress.txt` in full.',
  '* If there is anything worth keeping, promote it.',
].join('\n');

/** A compaction prompt, as `buildCompactionPrompt` assembles it. */
const COMPACTION_PROMPT = [
  '* Compact `@progress.txt` per'
  + ' `.claude/skills/progress-hygiene/SKILL.md`, and change NOTHING else.',
  '* This is a MID-RUN compaction, not the end-of-run one.',
].join('\n');

/** A CI-repair prompt, assembled as `repairPullRequest` assembles it. */
const CI_PROMPT = [
  'The pull request for branch `feat/q19-loop-economics` (#61) is'
  + ' not mergeable: checks failed',
  '',
  '* Diagnose the ACTUAL cause before changing anything.',
].join('\n');

/** Hand-driven traffic: what the residue bucket actually looks like. */
const RESIDUE_PROMPT = 'Reply with exactly the word: ok';

/**
 * The reference implementation's phrase-shaped loop needle, assembled
 * from fragments rather than written out. Four fragments joined by a
 * single space; the arity is asserted below so a parser that captured
 * the separator cannot build a same-length needle that matches nothing
 * for the wrong reason.
 */
const FOREIGN_FRAGMENTS = ['your', 'current', 'scoped', 'task'];
const FOREIGN_NEEDLE = FOREIGN_FRAGMENTS.join(' ');

const TASK_SHAPE = PROMPT_SHAPES.find((shape) => shape.kind === 'task');
/** Empty when the table loses its task shape, which reds the cases
 * below rather than letting them pass over a missing prefix. */
const REPO_TASK_PREFIX = TASK_SHAPE?.prefix ?? '';

/** Yields planted lines one at a time, as a stream reader would. */
async function* fromLines(lines: readonly string[]): AsyncGenerator<string> {
  for (const line of lines) {
    yield line;
  }
}

/** One enqueue record carrying the given prompt content. */
function enqueue(content: unknown): string {
  return JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    content,
  });
}

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-classify-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Writes a planted log and returns its path. */
function plantLog(name: string, lines: readonly string[]): string {
  const path = join(tempRoot, name);
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

describe('classifyPromptContent over the five shapes', () => {
  it('reads a scoped-task prompt as a task session', () => {
    expect(classifyPromptContent(TASK_PROMPT)).toBe('task');
  });

  it('reads the plan template as a plan-generation session', () => {
    expect(classifyPromptContent(PLAN_PROMPT)).toBe('plan-generation');
  });

  it('reads the progress prompt as a wrap-up session', () => {
    expect(classifyPromptContent(WRAPUP_PROMPT)).toBe('wrap-up');
  });

  it('reads the mergeability prompt as a CI-repair session', () => {
    expect(classifyPromptContent(CI_PROMPT)).toBe('ci-repair');
  });

  it('reads the mid-run prompt as a compaction session', () => {
    expect(classifyPromptContent(COMPACTION_PROMPT)).toBe('compaction');
  });

  it('keeps the wrap-up and compaction shapes apart', () => {
    // Both prompts are bullet lists opening on `@progress.txt`, and the
    // wrap-up's own list carries a compaction bullet further down. Only
    // the FIRST line separates them, which is what this pins.
    expect(WRAPUP_PROMPT).toContain('@progress.txt');
    expect(COMPACTION_PROMPT).toContain('@progress.txt');
    expect(classifyPromptContent(WRAPUP_PROMPT)).toBe('wrap-up');
    expect(classifyPromptContent(COMPACTION_PROMPT)).toBe('compaction');
  });

  it('buckets hand-driven traffic as other, not as a fault', () => {
    expect(classifyPromptContent(RESIDUE_PROMPT)).toBe('other');
  });

  it('reads an absent or empty prompt as other', () => {
    expect(classifyPromptContent(null)).toBe('other');
    expect(classifyPromptContent(undefined)).toBe('other');
    expect(classifyPromptContent('')).toBe('other');
  });

  it('anchors every shape at the start of the content', () => {
    const buried = `Please note:\n${TASK_PROMPT}`;

    expect(classifyPromptContent(buried)).toBe('other');
  });
});

describe('the shape table', () => {
  it('names each kind exactly once', () => {
    const kinds = PROMPT_SHAPES.map((shape) => shape.kind);

    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toHaveLength(5);
  });

  it('holds no prefix that is a prefix of another', () => {
    const overlaps: string[] = [];
    for (const a of PROMPT_SHAPES) {
      for (const b of PROMPT_SHAPES) {
        if (a === b) continue;
        if (a.prefix.startsWith(b.prefix)) overlaps.push(a.kind);
      }
    }

    expect(overlaps).toEqual([]);
  });

  it('keeps every prefix live in the source that injects it', () => {
    const misses: string[] = [];
    for (const shape of PROMPT_SHAPES) {
      const url = new URL(`../../../${shape.source}`, import.meta.url);
      const source = readFileSync(url, 'utf8');
      if (!source.includes(shape.prefix)) misses.push(shape.kind);
      if (shape.firstLineInfix !== null
        && !source.includes(shape.firstLineInfix)) {
        misses.push(`${shape.kind}:infix`);
      }
    }

    expect(misses).toEqual([]);
  });

  it('anchors the compaction prefix at line 1 of its own builder', () => {
    // The guard above is `source.includes(prefix)` over the WHOLE file,
    // so a bullet PREPENDED above the compaction prompt's first line
    // keeps it green while re-bucketing every later compaction session
    // as residue — measured, that leg reddens nothing here. Driving the
    // real builder is what closes it: this reads the prompt the loop
    // would actually send, and `startsWith` is the same test
    // `classifyPromptContent` applies to it. The other four shapes have
    // no equivalent leg; theirs are string literals with no builder to
    // call.
    const shape = PROMPT_SHAPES.find((s) => s.kind === 'compaction');
    const prompt = buildCompactionPrompt({
      due: true,
      reason: 'hard-cap',
      sizeBytes: 20_000,
      tasksSinceCompaction: 1,
      thresholds: {
        hardCapBytes: 16_000,
        softCapBytes: 8_000,
        cadenceTasks: 10,
      },
    });

    expect(shape?.prefix).toBeDefined();
    expect(prompt.split('\n')[0]).toContain(shape?.prefix ?? '');
    expect(prompt.startsWith(shape?.prefix ?? '')).toBe(true);
    expect(classifyPromptContent(prompt)).toBe('compaction');
  });

  it('proves that guard fails on a prefix nothing injects', () => {
    const source = readFileSync(
      new URL('../start.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain(REPO_TASK_PREFIX);
    expect(source).not.toContain('Your unscoped errand is: ');
  });

  it('needs the infix as well as the prefix for CI repair', () => {
    const shape = PROMPT_SHAPES.find((s) => s.kind === 'ci-repair');
    const prefixOnly = 'The pull request for branch `x` was merged';

    expect(shape?.firstLineInfix).not.toBeNull();
    expect(classifyPromptContent(prefixOnly)).toBe('other');
    expect(classifyPromptContent(CI_PROMPT)).toBe('ci-repair');
  });

  it('keeps the infix on the first line, not anywhere', () => {
    const late = 'The pull request for branch `x` is fine\n'
      + 'but it is not mergeable: later';

    expect(classifyPromptContent(late)).toBe('other');
  });
});

describe('the reference implementation loop needle', () => {
  it('is four fragments, so no separator was captured', () => {
    expect(FOREIGN_FRAGMENTS).toHaveLength(4);
    expect(FOREIGN_NEEDLE.split(' ')).toHaveLength(4);
  });

  it('is a near neighbour of this repo\'s own task prefix', () => {
    // Both phrases carry the same two words, so the zero below is a
    // guard discriminating rather than a needle made of nonsense.
    const shared = ['scoped', 'task'].join(' ');

    expect(FOREIGN_NEEDLE).toContain(shared);
    expect(REPO_TASK_PREFIX.toLowerCase()).toContain(shared);
    expect(FOREIGN_NEEDLE).not.toBe(REPO_TASK_PREFIX.toLowerCase());
  });

  it('matches none of the five shapes, either way round', () => {
    const hits: string[] = [];
    for (const shape of PROMPT_SHAPES) {
      const prefix = shape.prefix.toLowerCase();
      if (prefix.includes(FOREIGN_NEEDLE)) hits.push(shape.kind);
      if (FOREIGN_NEEDLE.includes(prefix)) hits.push(`${shape.kind}:rev`);
      if (matchesShape(FOREIGN_NEEDLE, shape)) hits.push(`${shape.kind}:m`);
    }

    expect(hits).toEqual([]);
  });

  it('collects nothing from a prompt built around it', () => {
    const foreign = `Continue with ${FOREIGN_NEEDLE}: ship the thing.`;

    expect(classifyPromptContent(foreign)).toBe('other');
    expect(classifyPromptContent(foreign.replace(/^./, 'C'))).toBe('other');
  });

  it('leaves this repo\'s own prefix matching, as the control', () => {
    // Same matcher, same call, non-zero answer: without this leg the
    // zero above is satisfied by a classifier that matches nothing.
    expect(classifyPromptContent(TASK_PROMPT)).toBe('task');
    expect(classifyPromptContent(PLAN_PROMPT)).toBe('plan-generation');
    expect(classifyPromptContent(WRAPUP_PROMPT)).toBe('wrap-up');
    expect(classifyPromptContent(CI_PROMPT)).toBe('ci-repair');
    expect(classifyPromptContent(COMPACTION_PROMPT)).toBe('compaction');
  });
});

describe('findFirstEnqueue', () => {
  it('finds the enqueue when it is record 0', async () => {
    const found = await findFirstEnqueue(fromLines([enqueue(TASK_PROMPT)]));

    expect(found.content).toBe(TASK_PROMPT);
    expect(found.recordIndex).toBe(0);
    expect(found.linesScanned).toBe(1);
  });

  it('finds it at record 2 behind mode and latch records', async () => {
    // The measured shape for a desktop-driven session: a reader keyed
    // on record 0 reports these as having no prompt at all.
    const lines = [
      JSON.stringify({ type: 'mode', mode: 'default' }),
      JSON.stringify({ type: 'atis-latch', value: 1 }),
      enqueue(RESIDUE_PROMPT),
    ];
    const found = await findFirstEnqueue(fromLines(lines));

    expect(found.recordIndex).toBe(2);
    expect(found.content).toBe(RESIDUE_PROMPT);
  });

  it('takes the FIRST enqueue when a session has several', async () => {
    const lines = [enqueue(TASK_PROMPT), enqueue(RESIDUE_PROMPT)];
    const found = await findFirstEnqueue(fromLines(lines));

    expect(found.content).toBe(TASK_PROMPT);
    expect(found.linesScanned).toBe(1);
  });

  it('gives up when the enqueue sits past the window', async () => {
    const filler = JSON.stringify({ type: 'system', subtype: 'x' });
    const lines = [...Array<string>(12).fill(filler), enqueue(TASK_PROMPT)];
    const found = await findFirstEnqueue(fromLines(lines));

    expect(found.content).toBeNull();
    expect(found.recordIndex).toBeNull();
    expect(found.linesScanned).toBe(ENQUEUE_SCAN_WINDOW);
  });

  it('honours a window a caller widens', async () => {
    const filler = JSON.stringify({ type: 'system', subtype: 'x' });
    const lines = [...Array<string>(12).fill(filler), enqueue(TASK_PROMPT)];
    const found = await findFirstEnqueue(fromLines(lines), 20);

    expect(found.content).toBe(TASK_PROMPT);
    expect(found.recordIndex).toBe(12);
  });

  it('charges an unparseable line against the budget', async () => {
    const lines = ['{not json', '[1, 2]', enqueue(TASK_PROMPT)];
    const found = await findFirstEnqueue(fromLines(lines), 3);

    // Two junk lines cost two of three, and the record INDEX still
    // counts records: the enqueue is record 0, on line 3.
    expect(found.content).toBe(TASK_PROMPT);
    expect(found.recordIndex).toBe(0);
    expect(found.linesScanned).toBe(3);
  });

  it('skips blank lines without charging the budget', async () => {
    const lines = ['', '   ', enqueue(TASK_PROMPT)];
    const found = await findFirstEnqueue(fromLines(lines), 1);

    expect(found.content).toBe(TASK_PROMPT);
    expect(found.linesScanned).toBe(1);
  });

  it('answers null content for an enqueue carrying no string', async () => {
    const found = await findFirstEnqueue(fromLines([enqueue({ a: 1 })]));

    // recordIndex separates this from no enqueue record at all.
    expect(found.content).toBeNull();
    expect(found.recordIndex).toBe(0);
  });

  it('ignores a queue-operation that is not an enqueue', async () => {
    const lines = [
      JSON.stringify({
        type: 'queue-operation',
        operation: 'dequeue',
        content: TASK_PROMPT,
      }),
    ];
    const found = await findFirstEnqueue(fromLines(lines));

    expect(found.content).toBeNull();
    expect(found.recordIndex).toBeNull();
  });

  it('answers an empty lookup for an empty source', async () => {
    const found = await findFirstEnqueue(fromLines([]));

    expect(found).toEqual({
      content: null,
      recordIndex: null,
      linesScanned: 0,
    });
  });
});

describe('classifySessionLines', () => {
  it('classifies from the line source it is handed', async () => {
    const result = await classifySessionLines(
      fromLines([enqueue(WRAPUP_PROMPT)]),
    );

    expect(result.kind).toBe('wrap-up');
    expect(result.enqueueRecordIndex).toBe(0);
  });

  it('carries no prompt content into the classification', async () => {
    const secret = 'Your scoped task is: DO-NOT-STORE-THIS-TEXT';
    const result = await classifySessionLines(fromLines([enqueue(secret)]));

    expect(result.kind).toBe('task');
    expect(JSON.stringify(result)).not.toContain('DO-NOT-STORE-THIS-TEXT');
  });

  it('reads a session with no enqueue as other', async () => {
    const lines = [JSON.stringify({ type: 'assistant' })];
    const result = await classifySessionLines(fromLines(lines));

    expect(result.kind).toBe('other');
    expect(result.enqueueRecordIndex).toBeNull();
  });
});

describe('classifySessionLog', () => {
  it('classifies a planted log on disk', async () => {
    const path = plantLog('task.jsonl', [
      enqueue(TASK_PROMPT),
      JSON.stringify({ type: 'assistant', message: { model: 'm' } }),
    ]);
    const result = await classifySessionLog(path);

    expect(result.kind).toBe('task');
    expect(result.enqueueRecordIndex).toBe(0);
  });

  it('reads the head only, never the whole log', async () => {
    const padding = 'y'.repeat(2048);
    const lines = [enqueue(PLAN_PROMPT)];
    for (let i = 0; i < 2_000; i++) {
      lines.push(JSON.stringify({ type: 'assistant', padding }));
    }
    const path = plantLog('long.jsonl', lines);
    const result = await classifySessionLog(path);

    expect(lines.join('\n').length).toBeGreaterThan(4_000_000);
    expect(result.kind).toBe('plan-generation');
    expect(result.linesScanned).toBe(1);
  });

  it('agrees with the in-memory fold over the same lines', async () => {
    const lines = [
      JSON.stringify({ type: 'mode', mode: 'default' }),
      enqueue(CI_PROMPT),
    ];
    const path = plantLog('ci.jsonl', lines);

    expect(await classifySessionLog(path))
      .toEqual(await classifySessionLines(fromLines(lines)));
  });
});
