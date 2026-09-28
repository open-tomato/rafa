/**
 * Tests for the plan's effort-store rules (`src/plan/store-rules.ts`):
 * a store change pinned by number, a working-tree command with no
 * `RAFA_EFFORT_DIR=`, and a store-changing plan whose PREREQUISITES
 * carries no `rafa effort schema --check` probe.
 *
 * Each rule is pure, so each case hands in a plan's text and a
 * PREREQUISITES text and reads the problems back. Every positive case
 * sits beside a near miss that differs only in the part the rule reads,
 * so a rule refusing everything and a rule refusing nothing both fail
 * here: {@link CLEAN} carries a migration, a prefixed command and the
 * probe, and answers no problem.
 */
import { describe, expect, it } from 'bun:test';

import {
  findStoreRuleProblems,
  STORE_SCHEMA_PROBE_ITEM,
  storeRuleLine,
  unprefixedCommands,
} from './store-rules.js';

/** A PREREQUISITES file holding the probe under `[auto]`. */
const WITH_PROBE = `# Prerequisites\n\n## Store [auto]\n${STORE_SCHEMA_PROBE_ITEM}\n`;

/** The same file with the probe under a `[human]` heading, which nothing runs. */
const PROBE_UNPROBED = `# Prerequisites\n\n## Store [human]\n${STORE_SCHEMA_PROBE_ITEM}\n`;

/** A plan whose `tasks` sit under one stage, lines 3 onward. */
function planWith(...tasks: readonly string[]): string {
  return ['# Stage: One', '', ...tasks, ''].join('\n');
}

/** The task naming a migration by its id. */
const MIGRATION_TASK = '- [ ] Add migration `plan-ci`, additive: a new `plan_ci` table';

/** A plan carrying a migration, a prefixed command and nothing pinned. */
const CLEAN = planWith(
  MIGRATION_TASK,
  '- [ ] Measure it: `RAFA_EFFORT_DIR=/tmp/copy bun src/rafa.ts effort report`',
);

/** Every problem in `plan` as `<kind> <line>`. */
function problemsIn(plan: string, prerequisites: string | null = WITH_PROBE): readonly string[] {
  return findStoreRuleProblems({ plan, prerequisites, prerequisitesName: 'PREREQUISITES-demo.md' })
    .map((problem) => `${problem.kind} ${String(problem.line)}`);
}

describe('a plan that breaks no rule', () => {
  it('answers no problem, so a check refusing everything fails here', () => {
    expect(problemsIn(CLEAN)).toEqual([]);
  });
});

describe('a store change pinned by number', () => {
  it('is refused in a plan carrying no migration as well, naming its line', () => {
    expect(problemsIn(planWith('- [ ] Ship the column as migration 14'), null)).toEqual(['pinned-migration 3']);
    expect(problemsIn(planWith('- [ ] Bump the schema version 9'), null)).toEqual(['pinned-migration 3']);
  });

  it('is not refused for a release number, a code span or a fence', () => {
    const plan = planWith(
      '- [ ] Run the pre-log runtime rafa 0.18.0 over the copy',
      '- [ ] Quote the rule: a spec saying `migration 12` is a gap',
      '```',
      'migration 12',
      '```',
    );
    expect(problemsIn(plan, null)).toEqual([]);
  });

  it('tells the planner to name the migration by its id', () => {
    const [problem] = findStoreRuleProblems({
      plan: planWith('- [ ] Ship migration 14'),
      prerequisites: null,
      prerequisitesName: 'PREREQUISITES-demo.md',
    });
    expect(problem?.text).toBe('pins a store change by number ("migration 14"); name the migration by its id,'
      + ' as migration `<id>`, and never by a version number or an array position');
  });
});

describe('a working-tree command in a plan that carries a migration', () => {
  it('is refused for each runner the rule names, where the prefixed form is not', () => {
    for (const runner of ['bun src/rafa.ts', 'bun ./src/rafa.ts', 'bun dist/cli.js', 'node dist/cli.js', 'bun run rafa']) {
      const bare = planWith(MIGRATION_TASK, `- [ ] Collect: \`${runner} effort collect\``);
      const prefixed = planWith(MIGRATION_TASK, `- [ ] Collect: \`RAFA_EFFORT_DIR=/tmp/copy ${runner} effort collect\``);
      expect(problemsIn(bare)).toEqual(['unprefixed-command 4']);
      expect(problemsIn(prefixed)).toEqual([]);
    }
  });

  it('is not refused in a plan that carries no migration', () => {
    expect(problemsIn(planWith('- [ ] Collect: `bun src/rafa.ts effort collect`'), null)).toEqual([]);
  });

  it('reads a placeholder value and other assignments in front of it', () => {
    expect(unprefixedCommands('`RAFA_EFFORT_DIR=<absolute path of that dir> bun src/rafa.ts effort report`')).toEqual([]);
    expect(unprefixedCommands('`TZ=UTC RAFA_EFFORT_DIR="/tmp/a b" bun src/rafa.ts effort report`')).toEqual([]);
    expect(unprefixedCommands('`TZ=UTC bun src/rafa.ts effort report`'))
      .toEqual([{ span: 'TZ=UTC bun src/rafa.ts effort report', runner: 'bun src/rafa.ts' }]);
  });

  it('refuses a second command the assignment does not reach', () => {
    const span = 'RAFA_EFFORT_DIR=/tmp/copy bun src/rafa.ts effort report && bun src/rafa.ts effort collect';
    expect(unprefixedCommands(`\`${span}\``)).toEqual([{ span, runner: 'bun src/rafa.ts' }]);
  });

  it('does not count a span that only names the file, or the installed runtime', () => {
    expect(unprefixedCommands('edit `src/rafa.ts` and `dist/cli.js`')).toEqual([]);
    expect(unprefixedCommands('run `rafa effort report` and `bun ~/.rafa/runtime/0.24.1/cli.js effort report`')).toEqual([]);
  });

  it('lets effort copy through unprefixed, where the command after it is refused', () => {
    expect(unprefixedCommands('`bun src/rafa.ts effort copy --to=.rafa/scratch/demo-effort`')).toEqual([]);
    expect(unprefixedCommands('`bun src/rafa.ts effort copyright`'))
      .toEqual([{ span: 'bun src/rafa.ts effort copyright', runner: 'bun src/rafa.ts' }]);
  });

  it('is not refused on a ticked task, which will not run again', () => {
    expect(problemsIn(planWith(MIGRATION_TASK, '- [x] Collect: `bun src/rafa.ts effort collect`'))).toEqual([]);
  });

  it('spells the copy command with the runner the refused span used', () => {
    expect(unprefixedCommands('`bun run rafa effort collect`')).toEqual([{ span: 'bun run rafa effort collect', runner: 'bun run rafa' }]);
    const [problem] = findStoreRuleProblems({
      plan: planWith(MIGRATION_TASK, '- [ ] Collect: `node dist/cli.js effort collect`'),
      prerequisites: WITH_PROBE,
      prerequisitesName: 'PREREQUISITES-demo.md',
    });
    expect(problem?.text).toContain('copy the store first with `node dist/cli.js effort copy --to=.rafa/scratch/<stub>-effort`');
  });

  it('names the command and the prefixed form to write instead', () => {
    const problems = findStoreRuleProblems({
      plan: planWith(MIGRATION_TASK, '- [ ] Collect: `bun src/rafa.ts effort collect`'),
      prerequisites: WITH_PROBE,
      prerequisitesName: 'PREREQUISITES-demo.md',
    });
    expect(problems.map((problem) => storeRuleLine('PLAN-demo.md', problem))).toEqual([
      'PLAN-demo.md:4: unprefixed-command: runs `bun src/rafa.ts effort collect` without a leading RAFA_EFFORT_DIR=,'
        + ' in a plan that carries a migration; copy the store first with'
        + ' `bun src/rafa.ts effort copy --to=.rafa/scratch/<stub>-effort` and write the command as'
        + ' RAFA_EFFORT_DIR=<absolute path of that dir> bun src/rafa.ts effort collect',
    ]);
  });
});

describe('the schema probe of a plan that carries a migration', () => {
  it('is refused when the PREREQUISITES file lacks it, or is absent, naming the migration task', () => {
    expect(problemsIn(CLEAN, '# Prerequisites\n')).toEqual(['missing-probe 3']);
    expect(problemsIn(CLEAN, null)).toEqual(['missing-probe 3']);
  });

  it('is refused when the probe sits under a heading nothing runs', () => {
    expect(problemsIn(CLEAN, PROBE_UNPROBED)).toEqual(['missing-probe 3']);
  });

  it('is not asked of a plan whose migration is named without its id', () => {
    expect(problemsIn(planWith('- [ ] Add a nullable column to dispatches'), null)).toEqual([]);
  });

  it('tells the planner the item to add and where', () => {
    const [problem] = findStoreRuleProblems({ plan: CLEAN, prerequisites: null, prerequisitesName: 'PREREQUISITES-demo.md' });
    expect(problem?.text).toBe('carries a migration, and PREREQUISITES-demo.md holds no [auto] item probing'
      + ' `rafa effort schema --check`; add - [ ] The installed rafa can read and write the live store:'
      + ' `rafa effort schema --check` under an [auto] heading');
  });
});

describe('the order the problems answer in', () => {
  it('is line order across the three rules', () => {
    const plan = planWith(
      '- [ ] Collect: `bun src/rafa.ts effort collect`',
      MIGRATION_TASK,
      '- [ ] It lands as migration 14',
    );
    expect(problemsIn(plan, null)).toEqual(['unprefixed-command 3', 'missing-probe 4', 'pinned-migration 5']);
  });
});
