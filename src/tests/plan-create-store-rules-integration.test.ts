/**
 * Integration test for the effort-store rules `rafa plan create` enforces
 * (`enforceStoreRules`, `src/commands/plan/store-check.ts`), end to end in
 * a child process: a fixture planner, handed to the command in place of
 * core's, writes a plan carrying an effort-store migration whose last task
 * runs `bun src/rafa.ts issue check 639`, and the PREREQUISITES file with
 * the schema probe, so the command's own verdict is the one rule it is
 * about.
 *
 * Two runs over the same fixture, which differ in that command alone:
 *
 *  - unprefixed: exit 1, the refusal naming the line exactly as
 *    `rafa plan validate` names it (`storeRuleLine`, read here off
 *    `checkStoreRules` over the same plan text), both files moved under
 *    `rejected/`, and no "Plan ready" line;
 *  - with the `RAFA_EFFORT_DIR=` prefix: exit 0, "Plan ready", both files
 *    where the planner put them.
 *
 * The child follows `src/plan.test.ts`: the declaration of
 * `src/commands/plan/create.ts` wrapped around `plan()` with the fixture
 * registry, dispatched as `src/rafa.ts` dispatches it. No `claude` is
 * reachable on its PATH.
 */
import { mkdirSync, mkdtempSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';
import { findStoreRuleProblems, storeRuleLine } from '../plan/store-rules.js';
import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig } from './cli-capture.js';
import { scratchHomeEnv } from './scratch-home-env.js';

/** `src/`, where the modules the probe imports sit. */
const SRC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const UNPREFIXED = 'bun src/rafa.ts issue check 639';
const PREFIXED = `RAFA_EFFORT_DIR=/tmp/rafa-scratch-copy ${UNPREFIXED}`;

/** The plan's text for a last task running `command`, carrying migration `plan-ci`. */
function planText(command: string): string {
  return [
    '# Plan: spec',
    '',
    '```rafa:plan',
    'stub: spec',
    '```',
    '',
    '## Stage: one',
    '',
    '- [ ] Add migration `plan-ci`, additive: a new `plan_ci` table',
    `- [ ] Check the issue's references: \`${command}\``,
    '',
  ].join('\n');
}

/** The PREREQUISITES file holding the schema probe under `[auto]`. */
const PREREQUISITES = '## Store [auto]\n'
  + '- [ ] The installed rafa can read and write the live store: `rafa effort schema --check`\n';

/** The child: a fixture planner writing the plan and PREREQUISITES it reads from the environment. */
const PROBE = [
  'import { mkdirSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  `import { createAdapterRegistry } from ${JSON.stringify(join(SRC_DIR, 'adapters', 'registry.ts'))};`,
  `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
  `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
  `import declared from ${JSON.stringify(join(SRC_DIR, 'commands', 'plan', 'create.ts'))};`,
  `import { wrapPhaseZeroCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'wrap.ts'))};`,
  `import plan from ${JSON.stringify(join(SRC_DIR, 'plan.ts'))};`,
  '',
  'const registry = createAdapterRegistry([{',
  '  port: "planner",',
  '  kind: "claude",',
  '  portVersion: 1,',
  '  create: (context) => ({',
  '    create: async (request) => {',
  '      const planPath = context.planDir + "/PLAN-" + request.stub + ".md";',
  '      const prerequisitesPath = context.planDir + "/PREREQUISITES-" + request.stub + ".md";',
  '      mkdirSync(join(context.repoRoot, context.planDir), { recursive: true });',
  '      writeFileSync(join(context.repoRoot, planPath), process.env.FAKE_PLAN);',
  '      writeFileSync(join(context.repoRoot, prerequisitesPath), process.env.FAKE_PREREQUISITES);',
  '      return { planPath, prerequisitesPath };',
  '    },',
  '  }),',
  '}]);',
  'const command = wrapPhaseZeroCommand(declared, (words, root) => plan(words, root, registry));',
  'const commands = createCommandRegistry({ subjects: [{ name: "plan", summary: "plans" }], commands: [command] });',
  'const { exitCode } = await dispatch(["plan", "create", ...process.argv.slice(2)], { registry: commands });',
  'process.exitCode = exitCode;',
  '',
].join('\n');

let tempDir = '';
let planted = 0;

beforeAll(() => {
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-create-store-rules-')));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

interface Run {
  readonly repo: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `plan create --spec=spec.md` in a fresh scratch repository whose fixture planner writes a plan running `command`. */
function runPlanCreate(command: string): Run {
  planted += 1;
  const root = join(tempDir, `run-${String(planted)}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });
  writeDismissed(home, NOTICE_IDS);

  const init = Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: repo });
  if (init.exitCode !== 0) throw new Error(`git init: ${init.stderr.toString()}`);
  writeFileSync(join(repo, 'spec.md'), '# Spec: a store probe\n\nNothing to build.\n', 'utf8');
  plantProjectConfig(repo, projectConfigText());
  const probe = join(root, 'probe.ts');
  writeFileSync(probe, PROBE, 'utf8');

  const git = Bun.which('git');
  if (git === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, dirname(process.execPath), dirname(git)].join(delimiter);
  const proc = Bun.spawnSync(
    [process.execPath, probe, '--spec=spec.md', '--no-progress', '--skip-review'],
    {
      cwd: repo,
      env: {
        TMPDIR: tmpdir(),
        PATH: path,
        FAKE_PLAN: planText(command),
        FAKE_PREREQUISITES: PREREQUISITES,
        ...scratchHomeEnv(home),
      },
    },
  );
  return { repo, exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const PLAN = '.rafa/plans/PLAN-spec.md';
const REJECTED_PLAN = '.rafa/plans/rejected/PLAN-spec.md';
const PREREQUISITES_PATH = '.rafa/plans/PREREQUISITES-spec.md';
const REJECTED_PREREQUISITES = '.rafa/plans/rejected/PREREQUISITES-spec.md';

describe('rafa plan create over a migration plan running a store command', () => {
  it('refuses the unprefixed command, naming the line as plan validate does, and moves both files under rejected/', () => {
    const run = runPlanCreate(UNPREFIXED);

    const problems = findStoreRuleProblems({
      plan: planText(UNPREFIXED),
      prerequisites: PREREQUISITES,
      prerequisitesName: 'PREREQUISITES-spec.md',
    });
    expect(problems).toHaveLength(1);
    const line = storeRuleLine(PLAN, problems[0]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(line);
    expect(run.stderr).toContain(UNPREFIXED);
    expect(run.stdout).not.toContain('Plan ready');
    expect(existsSync(join(run.repo, PLAN))).toBe(false);
    expect(existsSync(join(run.repo, PREREQUISITES_PATH))).toBe(false);
    expect(readFileSync(join(run.repo, REJECTED_PLAN), 'utf8')).toBe(planText(UNPREFIXED));
    expect(existsSync(join(run.repo, REJECTED_PREREQUISITES))).toBe(true);
  }, 30_000);

  it('plans the same migration with the RAFA_EFFORT_DIR= prefix, keeping both files', () => {
    const run = runPlanCreate(PREFIXED);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Plan ready: ${PLAN}`);
    expect(run.stderr).not.toContain('effort-store rule');
    expect(readFileSync(join(run.repo, PLAN), 'utf8')).toContain(PREFIXED);
    expect(existsSync(join(run.repo, PREREQUISITES_PATH))).toBe(true);
    expect(existsSync(join(run.repo, REJECTED_PLAN))).toBe(false);
  }, 30_000);
});
