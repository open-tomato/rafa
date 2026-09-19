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

import { PINNED_PLAN_CLASSES, readPinnedPlan } from './load.js';

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
