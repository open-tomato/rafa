/**
 * Tests for what a reviewed report does (`./apply.ts`): the plan a row
 * comes to, the three refusals, the writes and moves themselves, and
 * the second `--apply` that changes nothing.
 *
 * Every case plants a whole `<base>/.claude/skills` under a temporary
 * directory of its own and works there: the scope is resolved from that
 * base, so a case's instincts land in its own `<base>/.rafa/instincts`
 * and nothing here reads or writes the real home.
 *
 * ## The controls
 *
 * Three readings would pass on an applier that did nothing at all, so
 * each is paired with one that must change:
 *
 *   - **A refused row moves nothing.** The hash-mismatch case plants
 *     TWO rows, one edited and one not, and asserts the edited one was
 *     left where it is BESIDE the clean one having moved. An applier
 *     that refused the whole run would be red on the second assertion,
 *     and one that ignored the hash red on the first.
 *   - **A record is checked before it is written.** The failing-record
 *     case asserts the instincts directory holds nothing afterwards,
 *     beside a second case over a record that passes and IS written. A
 *     planner that never checked would be red on the first; one that
 *     never wrote would be red on the second.
 *   - **The second apply changes nothing.** It is measured as the
 *     sha256 of every file under the base before and after, beside the
 *     first apply having changed those same hashes. A comparison over
 *     a tree nothing ever writes would pass either way.
 *
 * The original kept under `.rafa/demoted/` is held BYTE-identical to
 * what was planted, not merely present: the whole point of keeping it
 * is that a wrong verdict is a `mv` back.
 */
import type { DemotionReport, DemotionReportRow } from './report.js';
import type { DemotionScope } from './select.js';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { applyDemotion, isLearnedPath, learnedSkillName, planDemotion, takenInstinctIds } from './apply.js';
import { buildDemotionReport } from './draft.js';
import { REVIEWED_STATUS, sourceHash } from './report.js';
import { resolveDemotionScope, selectSources } from './select.js';

/** A temporary directory of this file's own. */
const tempBase = mkdtempSync(join(tmpdir(), 'rafa-demote-apply-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A body with one Problem and one Solution and no numbered run. */
function observation(name: string, action: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: A single observation worth keeping.',
    '---',
    '',
    `# ${name}`,
    '',
    '## When to Use',
    '',
    'When a spawned child seems to hang with no output at all.',
    '',
    '## Problem',
    '',
    'The stream is buffered, so the parent sees nothing.',
    '',
    '## Solution',
    '',
    action,
    '',
  ].join('\n');
}

/** A body with a numbered procedure of three consecutive steps. */
function procedure(name: string, origin: string | null = null): string {
  const front = origin === null
    ? ['---', `name: ${name}`, 'description: The release steps, in order.', '---']
    : ['---', `name: ${name}`, 'description: The release steps, in order.', `origin: ${origin}`, '---'];
  return [
    ...front,
    '',
    `# ${name}`,
    '',
    '## Problem',
    '',
    'Releases skip a step.',
    '',
    '## Solution',
    '',
    '1. Bump the version.',
    '2. Run the gates.',
    '3. Tag the commit.',
    '',
  ].join('\n');
}

/** A body carrying no frontmatter, which nothing can classify. */
function unclassifiable(): string {
  return ['# Three', '', 'Some prose and no sections at all.', ''].join('\n');
}

/** Plants one case's tree and answers its base. A key ending in `/` is a directory. */
function plant(files: Readonly<Record<string, string>>): string {
  planted += 1;
  const base = join(tempBase, `case-${String(planted)}`);
  mkdirSync(base, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(base, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return base;
}

/** The scope of a planted base, read as its own home so it is a user scope. */
function scopeOf(base: string): DemotionScope {
  const scope = resolveDemotionScope(join(base, '.claude', 'skills'), base);
  if (scope === null) throw new Error(`the planted base ${base} resolved to no scope`);
  return scope;
}

/** The report a write over `scope` would produce, marked reviewed. */
function reviewedOf(scope: DemotionScope, overrides: Readonly<Record<string, DemotionReportRow['override']>> = {}): DemotionReport {
  const drafted = buildDemotionReport(selectSources(scope), null);
  return {
    status: REVIEWED_STATUS,
    rows: drafted.rows.map((row) => {
      const override = overrides[row.path];
      return override === undefined
        ? row
        : { ...row, override, overrideReason: 'decided by the review' };
    }),
  };
}

/** The seams a case plans with: a fixed clock and no PATH to look a tool up in. */
const SEAMS = { now: () => '2026-09-11T10:00:00Z', pathDirs: [] as readonly string[] };

/** Every file under `dir`, by its relative path, with its sha256. */
function tree(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      found[relative(dir, path)] = sourceHash(readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return found;
}

describe('what a row is planned as', () => {
  it('plans an observation as a record written and an original kept', () => {
    const base = plant({ '.claude/skills/one/SKILL.md': observation('one', 'Read the stream as it comes.') });
    const scope = scopeOf(base);
    const plan = planDemotion(reviewedOf(scope), scope, SEAMS);

    expect(plan.counts).toEqual({ demoted: 1, kept: 0, left: 0, done: 0, refused: 0 });
    expect(plan.actions[0]?.instinctId).toBe('one');
    expect(plan.actions[0]?.write?.path).toBe(join(scope.instinctsDir, 'one.md'));
    expect(plan.actions[0]?.move?.to).toBe(join(scope.demotedDir, 'one', 'SKILL.md'));
  });

  it('plans a procedure skill as kept where it is, and a learned procedure as a move into the registering layout', () => {
    const base = plant({
      '.claude/skills/one/SKILL.md': procedure('one'),
      '.claude/skills/learned/two.md': procedure('two', 'auto-extracted'),
    });
    const scope = scopeOf(base);
    const plan = planDemotion(reviewedOf(scope), scope, SEAMS);

    expect(plan.counts.kept).toBe(2);
    expect(plan.actions.find((action) => action.path === 'one/SKILL.md')?.move).toBeNull();
    expect(plan.actions.find((action) => action.path === 'learned/two.md')?.move?.to)
      .toBe(join(scope.dir, 'two', 'SKILL.md'));
  });

  it('leaves an unclassified row untouched, and acts on the override the review wrote', () => {
    const base = plant({
      '.claude/skills/learned/three.md': unclassifiable(),
      '.claude/skills/learned/four.md': unclassifiable(),
    });
    const scope = scopeOf(base);
    const plan = planDemotion(reviewedOf(scope, { 'learned/four.md': 'procedure' }), scope, SEAMS);

    expect(plan.actions.find((action) => action.path === 'learned/three.md')?.kind).toBe('left');
    expect(plan.actions.find((action) => action.path === 'learned/four.md')?.kind).toBe('kept');
    expect(plan.counts).toEqual({ demoted: 0, kept: 1, left: 1, done: 0, refused: 0 });
  });
});

describe('the refusals, each one row', () => {
  it('refuses the row whose file changed and applies the row beside it', () => {
    const base = plant({
      '.claude/skills/one/SKILL.md': observation('one', 'Read the stream as it comes.'),
      '.claude/skills/two/SKILL.md': observation('two', 'Await the exit code, never the text.'),
    });
    const scope = scopeOf(base);
    const report = reviewedOf(scope);
    writeFileSync(join(scope.dir, 'two', 'SKILL.md'), observation('two', 'Edited after the report.'), 'utf8');

    const plan = planDemotion(report, scope, SEAMS);
    applyDemotion(plan);

    expect(plan.counts).toEqual({ demoted: 1, kept: 0, left: 0, done: 0, refused: 1 });
    expect(plan.actions.find((action) => action.path === 'two/SKILL.md')?.detail)
      .toContain('changed since the report was written');
    expect(statSync(join(scope.dir, 'two', 'SKILL.md')).isFile()).toBe(true);
    expect(statSync(join(scope.demotedDir, 'one', 'SKILL.md')).isFile()).toBe(true);
  });

  it('refuses a record the checker fails, and writes nothing for it', () => {
    const base = plant({
      '.claude/skills/homey/SKILL.md': observation('homey', 'Open `/Users/alice/notes.md` and read it.'),
    });
    const scope = scopeOf(base);
    const plan = planDemotion(reviewedOf(scope), scope, SEAMS);
    applyDemotion(plan);

    expect(plan.counts.refused).toBe(1);
    expect(plan.actions[0]?.detail).toContain('fails the checker');
    expect(plan.actions[0]?.write).toBeNull();
    expect(takenInstinctIds(scope.instinctsDir)).toEqual([]);
  });

  it('writes the record of a file the checker passes, which is the same path the refusal leaves empty', () => {
    const base = plant({ '.claude/skills/clean/SKILL.md': observation('clean', 'Read the stream as it comes.') });
    const scope = scopeOf(base);
    applyDemotion(planDemotion(reviewedOf(scope), scope, SEAMS));

    expect(takenInstinctIds(scope.instinctsDir)).toEqual(['clean']);
  });

  it('refuses a file the conversion cannot make a record of', () => {
    const base = plant({ '.claude/skills/empty/SKILL.md': observation('empty', '') });
    const scope = scopeOf(base);
    const plan = planDemotion(reviewedOf(scope), scope, SEAMS);

    expect(plan.counts.refused).toBe(1);
    expect(plan.actions[0]?.detail).toContain('is refused');
  });

  it('refuses a row whose file is gone with nothing matching where it would have gone', () => {
    const base = plant({ '.claude/skills/one/SKILL.md': observation('one', 'Read the stream as it comes.') });
    const scope = scopeOf(base);
    const report = reviewedOf(scope);
    rmSync(join(scope.dir, 'one', 'SKILL.md'));

    const plan = planDemotion(report, scope, SEAMS);

    expect(plan.counts.refused).toBe(1);
    expect(plan.actions[0]?.detail).toContain('is gone');
  });
});

describe('what applying does to the tree', () => {
  it('writes each record, keeps each original byte-identical, and changes nothing on a second apply', () => {
    const planted = observation('one', 'Read the stream as it comes.');
    const base = plant({
      '.claude/skills/one/SKILL.md': planted,
      '.claude/skills/two/SKILL.md': procedure('two'),
    });
    const scope = scopeOf(base);
    const report = reviewedOf(scope);
    const before = tree(base);

    applyDemotion(planDemotion(report, scope, SEAMS));
    const after = tree(base);

    expect(after).not.toEqual(before);
    expect(readFileSync(join(scope.demotedDir, 'one', 'SKILL.md'), 'utf8')).toBe(planted);
    expect(readFileSync(join(scope.instinctsDir, 'one.md'), 'utf8')).toContain('source: demoted');
    expect(readFileSync(join(scope.dir, 'two', 'SKILL.md'), 'utf8')).toBe(procedure('two'));

    const second = planDemotion(report, scope, SEAMS);
    applyDemotion(second);

    expect(second.counts).toEqual({ demoted: 0, kept: 1, left: 0, done: 1, refused: 0 });
    expect(tree(base)).toEqual(after);
  });

  it('moves a learned file kept as a skill into <dir>/<name>/SKILL.md, and reads it as done after', () => {
    const planted = procedure('two', 'auto-extracted');
    const base = plant({ '.claude/skills/learned/two.md': planted });
    const scope = scopeOf(base);
    const report = reviewedOf(scope);

    applyDemotion(planDemotion(report, scope, SEAMS));

    expect(readFileSync(join(scope.dir, 'two', 'SKILL.md'), 'utf8')).toBe(planted);
    expect(planDemotion(report, scope, SEAMS).counts.done).toBe(1);
  });

  it('gives a second record a suffixed id rather than the name an existing one holds', () => {
    const base = plant({
      '.claude/skills/one/SKILL.md': observation('one', 'Read the stream as it comes.'),
      '.rafa/instincts/one.md': 'planted, and never parsed here\n',
    });
    const scope = scopeOf(base);
    const plan = planDemotion(reviewedOf(scope), scope, SEAMS);

    expect(plan.actions[0]?.instinctId).toBe('one-2');
  });
});

describe('the path arithmetic a row is applied through', () => {
  it('reads a learned path and its skill name, and reads nothing else as one', () => {
    expect(isLearnedPath('learned/bash-shim.md')).toBe(true);
    expect(isLearnedPath('learned/deep/bash-shim.md')).toBe(false);
    expect(isLearnedPath('one/SKILL.md')).toBe(false);
    expect(learnedSkillName('learned/bash-shim.md')).toBe('bash-shim');
  });
});
