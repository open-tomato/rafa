/**
 * Tests for `src/commands/plan/store-check.ts`: the effort-store rules
 * read over a plan planted under a temp root with the PREREQUISITES file
 * beside it, and the refusal `rafa plan create` makes with them.
 *
 * Each refusal is paired with a plan that passes over the same command,
 * the prefixed one and the one with no migration, so a check that never
 * read the plan cannot pass for one that read it and found nothing. The
 * files a refusal moves are read off disk, at both ends of the move.
 */
import type { GeneratedPlan } from '../../ports/index.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { sinkOutput } from '../../tests/output-sinks.js';

import { checkStoreRules, enforceStoreRules } from './store-check.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-store-check-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The command the refused plan's last task runs. */
const ISSUE_CHECK = 'bun src/rafa.ts issue check 639';

/** A plan whose last task runs `command`, carrying migration `plan-ci` when `migration` is true. */
function planWith(command: string, migration: boolean): string {
  const first = migration
    ? '- [ ] Add migration `plan-ci`, additive: a new `plan_ci` table'
    : '- [ ] Add a `plan_ci` column reader to the report';
  return ['# Stage: one', '', first, `- [ ] Check the issue's references: \`${command}\``, ''].join('\n');
}

/** A PREREQUISITES file holding the schema probe under `[auto]`. */
const PROBED_PREREQUISITES = '## Store [auto]\n'
  + '- [ ] The installed rafa can read and write the live store: `rafa effort schema --check`\n';

/** The planner's answer over `plans/PLAN-demo.md`, naming the PREREQUISITES file when one was planted. */
interface Planted {
  readonly root: string;
  readonly generated: GeneratedPlan;
}

/** A fresh root holding `plans/PLAN-demo.md`, and `plans/PREREQUISITES-demo.md` when one is given. */
function plant(plan: string, prerequisites: string | null): Planted {
  const root = mkdtempSync(join(tempBase, 'root-'));
  mkdirSync(join(root, 'plans'));
  writeFileSync(join(root, 'plans', 'PLAN-demo.md'), plan, 'utf8');
  if (prerequisites !== null) writeFileSync(join(root, 'plans', 'PREREQUISITES-demo.md'), prerequisites, 'utf8');
  const prerequisitesPath = prerequisites === null
    ? null
    : 'plans/PREREQUISITES-demo.md';
  return { root, generated: { planPath: 'plans/PLAN-demo.md', prerequisitesPath } };
}

/** What `enforceStoreRules` threw over `planted`, null when it returned, with the lines it wrote. */
function enforce(planted: Planted): { thrown: unknown; info: string[]; warn: string[] } {
  const info: string[] = [];
  const warn: string[] = [];
  const output = sinkOutput({ info: (line) => info.push(line), warn: (line) => warn.push(line) });
  try {
    enforceStoreRules(planted.root, planted.generated, output);
    return { thrown: null, info, warn };
  } catch (error) {
    return { thrown: error, info, warn };
  }
}

describe('enforceStoreRules over the plan rafa plan create generated', () => {
  it('refuses a migration plan running bun src/rafa.ts issue check 639 unprefixed, naming the line, and moves both files', () => {
    const planted = plant(planWith(ISSUE_CHECK, true), PROBED_PREREQUISITES);

    const { thrown, info, warn } = enforce(planted);

    expect(thrown).toBeInstanceOf(CommandExit);
    const exit = thrown as CommandExit;
    expect(exit.exitCode).toBe(1);
    expect(exit.message).toStartWith('❌ plans/PLAN-demo.md: 1 broken effort-store rule;');
    expect(exit.message).toContain(`\n   plans/PLAN-demo.md:4: unprefixed-command: runs \`${ISSUE_CHECK}\``
      + ' without a leading RAFA_EFFORT_DIR=, in a plan that carries a migration;');
    expect(exit.message.split('\n')).toHaveLength(2);
    expect([
      existsSync(join(planted.root, 'plans', 'PLAN-demo.md')),
      existsSync(join(planted.root, 'plans', 'PREREQUISITES-demo.md')),
      existsSync(join(planted.root, 'plans', 'rejected', 'PLAN-demo.md')),
      readFileSync(join(planted.root, 'plans', 'rejected', 'PREREQUISITES-demo.md'), 'utf8'),
    ]).toEqual([false, false, true, PROBED_PREREQUISITES]);
    expect(info).toEqual([
      '🗃  Moved plans/PLAN-demo.md to plans/rejected/PLAN-demo.md: the plan breaks the effort-store rules.',
      '🗃  Moved plans/PREREQUISITES-demo.md to plans/rejected/PREREQUISITES-demo.md: the plan breaks the effort-store rules.',
    ]);
    expect(warn).toEqual([]);
  });

  it('passes the same plan with the RAFA_EFFORT_DIR= prefix, leaving both files where they are', () => {
    const planted = plant(planWith(`RAFA_EFFORT_DIR=/tmp/copy ${ISSUE_CHECK}`, true), PROBED_PREREQUISITES);

    const { thrown, info } = enforce(planted);

    expect(thrown).toBeNull();
    expect(info).toEqual([]);
    expect([
      existsSync(join(planted.root, 'plans', 'PLAN-demo.md')),
      existsSync(join(planted.root, 'plans', 'PREREQUISITES-demo.md')),
      existsSync(join(planted.root, 'plans', 'rejected')),
    ]).toEqual([true, true, false]);
  });

  it('passes a plan with no migration running the same command unprefixed, with no PREREQUISITES file', () => {
    const planted = plant(planWith(ISSUE_CHECK, false), null);

    const { thrown } = enforce(planted);

    expect(thrown).toBeNull();
    expect(existsSync(join(planted.root, 'plans', 'PLAN-demo.md'))).toBe(true);
  });

  it('reads the PREREQUISITES file beside the plan, refusing a migration plan with none and moving the plan alone', () => {
    const planted = plant(planWith(`RAFA_EFFORT_DIR=/tmp/copy ${ISSUE_CHECK}`, true), null);

    const { thrown, info } = enforce(planted);

    expect((thrown as CommandExit).exitCode).toBe(1);
    expect((thrown as CommandExit).message).toContain('plans/PLAN-demo.md:3: missing-probe: carries a migration,'
      + ' and PREREQUISITES-demo.md holds no [auto] item probing `rafa effort schema --check`;');
    expect(info).toEqual([
      '🗃  Moved plans/PLAN-demo.md to plans/rejected/PLAN-demo.md: the plan breaks the effort-store rules.',
    ]);
  });
});

describe('enforceStoreRules over a plan the planner answered but did not write', () => {
  it('reads nothing and refuses nothing, where the same answer over the written plan is refused', () => {
    const written = plant(planWith(ISSUE_CHECK, true), PROBED_PREREQUISITES);
    const unwritten = plant(planWith(ISSUE_CHECK, true), PROBED_PREREQUISITES);
    rmSync(join(unwritten.root, 'plans', 'PLAN-demo.md'));

    expect((enforce(written).thrown as CommandExit).exitCode).toBe(1);
    expect(enforce(unwritten)).toEqual({ thrown: null, info: [], warn: [] });
    expect(existsSync(join(unwritten.root, 'plans', 'PREREQUISITES-demo.md'))).toBe(true);
  });
});

describe('checkStoreRules, the reading plan validate shares', () => {
  it('reads the PREREQUISITES file beside an absolute plan path: probed, the prefixed plan breaks nothing', () => {
    const plan = planWith(`RAFA_EFFORT_DIR=/tmp/copy ${ISSUE_CHECK}`, true);
    const probed = plant(plan, PROBED_PREREQUISITES);
    const unprobed = plant(plan, '## Tools [auto]\n');

    expect(checkStoreRules(join(probed.root, 'plans', 'PLAN-demo.md'), plan)).toEqual([]);
    expect(checkStoreRules(join(unprobed.root, 'plans', 'PLAN-demo.md'), plan).map((problem) => problem.kind))
      .toEqual(['missing-probe']);
  });
});
