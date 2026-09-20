/**
 * `rafa plan validate` over the pinned resolve plans, run as the command
 * itself rather than through `parsePlan` directly: `load.test.ts` already
 * holds the FILLED plans to no issues by handing them to the parser, but
 * that leaves the command's other check, the `agent=` roster, untried
 * against the files that actually ship in `src/pr/plans/`.
 *
 * Each pinned plan is read RAW, `{SLOT}` tokens and all — the command
 * never fills them, and nothing it checks reads inside a `rafa:context`
 * block, so an unfilled slot there is not a reading either way. What is
 * read is `parsePlan`'s issues and the `agent=` of every still-to-run
 * task, exactly what `rafa loop start`'s preflight halts on, and every
 * pinned plan is held to zero of each: `plan validate` is the check a
 * task's own author never wants to fail on the plan they just wrote.
 *
 * The project each case dispatches in carries its own `.claude/agents`
 * definitions for `loop-implementer` and `build-error-resolver`, the two
 * names the four pinned plans route to, planted the same way
 * `validate.test.ts` plants them; nothing here reads this machine's
 * `~/.claude/agents` or `.claude/agents/build-error-resolver.md` in the
 * checkout.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPlanValidateCommand } from '../../commands/plan/validate.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';
import { DEPENDENCY_BUMP_SIMPLE_CLASSES } from '../triage/classes.js';
import type { TriageBlock } from '../triage/comment.js';

import { PINNED_PLAN_CLASSES, pinnedPlanValues, readPinnedPlan } from './load.js';

/** The subject `plan validate` routes under. */
const SUBJECTS = [{ name: 'plan', summary: 'plans' }];

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pinned-plan-validate-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The two agent names the four pinned plans route their tasks to. */
const ROUTED_AGENTS = ['loop-implementer', 'build-error-resolver'];

/** Writes `<root>/.claude/agents/<name>.md` carrying that name as its frontmatter. */
function plantAgent(root: string, name: string): void {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\n---\nThe agent body.\n`, 'utf8');
}

describe('rafa plan validate over the pinned resolve plans', () => {
  for (const triageClass of PINNED_PLAN_CLASSES) {
    it(`holds ${triageClass}'s pinned plan clean`, async () => {
      const scope = mkdtempSync(join(tempBase, 'scope-'));
      const project = plantProject(scope);
      for (const name of ROUTED_AGENTS) plantAgent(project.root, name);
      writeFileSync(join(project.root, 'plan.md'), readPinnedPlan(triageClass), 'utf8');

      const run = await dispatchInProject(
        ['plan', 'validate', 'plan.md'],
        SUBJECTS,
        [createPlanValidateCommand(() => project.root)],
        project,
      );

      expect(run.stderr).toBe('');
      expect(run.stdout.startsWith('✅ plan.md: no issues;')).toBe(true);
      expect(run.exitCode).toBe(0);
    });
  }
});

/**
 * The same `{SLOT}` shape `load.ts`'s own `SLOT_PATTERN` matches
 * (UPPER_SNAKE inside braces, `{agent=…}` excluded by its lower-case
 * head); not exported from there, so read again here rather than
 * loosened into a public constant only this file would use.
 */
const SLOT_PATTERN = /\{[A-Z][A-Z0-9_]*\}/g;

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

/** Every `{SLOT}` name a raw plan template carries, deduplicated. */
function slotsIn(template: string): string[] {
  const found = template.match(SLOT_PATTERN) ?? [];
  return [...new Set(found.map((token) => token.slice(1, -1)))];
}

describe('the slots a pinned plan carries are covered by its fill', () => {
  for (const triageClass of PINNED_PLAN_CLASSES) {
    it(`covers every slot ${triageClass}'s pinned plan carries`, () => {
      const raw = readPinnedPlan(triageClass);
      const values = {
        ...pinnedPlanValues({ block: blockWith({ class: triageClass, files: ['bun.lock'] }) }),
        FAILING_LOG: 'npm ERR! code ENOTFOUND',
      };

      const slots = slotsIn(raw);
      const uncovered = slots.filter((slot) => values[slot] === undefined);

      expect(uncovered).toEqual([]);
    });
  }

  for (const ciClass of DEPENDENCY_BUMP_SIMPLE_CLASSES) {
    it(`holds a failing-log slot on ${ciClass}'s pinned plan`, () => {
      const raw = readPinnedPlan(ciClass);

      expect(slotsIn(raw)).toContain('FAILING_LOG');
    });
  }
});
