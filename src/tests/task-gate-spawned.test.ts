/**
 * The task gate, driven as the real `rafa loop start` over one-task
 * fixture plans (`src/tests/loop-scratch.ts`): the unit cases of the
 * gate's parts (`task-gate-lines.ts`, `lint-step.ts`, `suite-step.ts`)
 * hold each part to a seam, and these cases hold the parts together.
 *
 * The fixture project holds one content sweep, `src/hygiene.sweep.test.ts`,
 * which imports no project file and reads `git ls-files` at run time, and
 * a minimal `eslint.config.mjs` that lints JSON with `jsonc/indent` at two
 * spaces, as the root config does. The default `tests.alwaysRun` glob,
 * `src/**` + `/*.sweep.test.ts`, names the sweep, and the fixture's
 * `node_modules` is a link to this checkout's, so `bunx eslint` resolves
 * the real ESLint without a network.
 *
 * A stand-in `claude` answers the task session: it copies a payload tree
 * into the repository, which the loop then commits, and saves the prompt
 * it was handed. Three payloads, three cases:
 *
 *   - a tracked file naming the old plan directory is red at the task's
 *     own step, on the sweep, a file `bun test --changed=<base>` never
 *     selects, and the prompt names the sweep in its always-run line;
 *   - a JSON file indented by one space is red at the task's step on the
 *     lint, with every test green;
 *   - clean files leave the step green, lint included.
 *
 * With one task there is no open task to insert a repair above, so a red
 * step's repair goes after it (`start/suite-blocker.ts`); what the step
 * wrote reads from the run output and the run record's task step.
 */
import type { Scratch } from './loop-scratch.js';

import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';

import { gitIdentityEnv } from './git-identity.js';
import {
  PLAN_FLAG,
  PLAN_OPEN,
  RUN_TIMEOUT,
  SESSION_FLAGS,
  TASK,
  runLoopStart,
  scratchPlanter,
} from './loop-scratch.js';

const planter = scratchPlanter('rafa-task-gate-spawned-');

afterAll(planter.remove);

/** The sweep the fixture is seeded with: no import of project code, a read of the tracked tree at run time. */
const SWEEP_PATH = 'src/hygiene.sweep.test.ts';

/** The old plan directory the sweep forbids, spelled in two halves so this file does not name it. */
const OLD_PLAN_DIR = `.${'plans'}/`;

const SWEEP_TEXT = [
  'import { execFileSync } from \'node:child_process\';',
  'import { readFileSync } from \'node:fs\';',
  '',
  'import { expect, test } from \'bun:test\';',
  '',
  'test(\'no tracked file outside the tests names the old plan directory\', () => {',
  '  const listing = execFileSync(\'git\', [\'ls-files\', \'-z\'], { encoding: \'utf8\' });',
  '  const tracked = listing.split(\'\\0\').filter((path) => path !== \'\');',
  '  const offenders = tracked.filter((path) => path !== \'.gitignore\'',
  '    && !path.endsWith(\'.test.ts\')',
  `    && readFileSync(path, 'utf8').includes(${JSON.stringify(OLD_PLAN_DIR)}));`,
  '  expect(offenders).toEqual([]);',
  '});',
  '',
].join('\n');

const ESLINT_CONFIG_TEXT = [
  'import jsonc from \'eslint-plugin-jsonc\';',
  'import * as jsoncParser from \'jsonc-eslint-parser\';',
  '',
  'export default [',
  '  { ignores: [\'node_modules/**\', \'.rafa/**\'] },',
  '  {',
  '    files: [\'**/*.json\'],',
  '    languageOptions: { parser: jsoncParser },',
  '    plugins: { jsonc },',
  '    rules: { \'jsonc/indent\': [\'error\', 2] },',
  '  },',
  '];',
  '',
].join('\n');

/** The report the stand-in ends its task session on. */
const STAND_IN_REPORT = [
  '```rafa:report',
  'status: done',
  'feedback: "the stand-in answered"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  '```',
  '',
].join('\n');

/** The checkout's `node_modules`, found through the ESLint this suite resolves. */
function realNodeModules(): string {
  return dirname(dirname(Bun.resolveSync('eslint/package.json', import.meta.dir)));
}

/** Runs git in the fixture repository, throwing what it said when it failed. */
function git(scratch: Scratch, ...args: string[]): void {
  const run = Bun.spawnSync(['git', ...args], {
    cwd: scratch.repo,
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')} in a fixture step: ${run.stderr.toString()}`);
}

/** Writes `files`, each under its relative path, below `root`. */
function writeTree(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, 'utf8');
  }
}

/** Where the stand-in saves the prompt of its first call, beside the HOME. */
function promptFileOf(scratch: Scratch): string {
  return join(dirname(scratch.home), 'task-prompt.txt');
}

/**
 * Plants the fixture: the sweep, the ESLint config and the `node_modules`
 * link committed on `feat/probe`, a project config with no pull request
 * provider, and a stand-in whose first call copies `payload` into the
 * repository and saves its prompt, and whose later calls only answer.
 */
function plantFixture(payload: Readonly<Record<string, string>>): Scratch {
  const scratch = planter.plant({ branch: 'feat/probe', plan: PLAN_OPEN, config: 'pr:\n  provider: none\n' });
  symlinkSync(realNodeModules(), join(scratch.repo, 'node_modules'));
  writeTree(scratch.repo, {
    '.gitignore': 'progress.txt\n.plans/\n.rafa/\nnode_modules\n',
    [SWEEP_PATH]: SWEEP_TEXT,
    'eslint.config.mjs': ESLINT_CONFIG_TEXT,
  });
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'fixture seed');

  const root = dirname(scratch.home);
  const payloadDir = join(root, 'payload');
  writeTree(payloadDir, payload);
  const reportFile = join(root, 'report.txt');
  writeFileSync(reportFile, STAND_IN_REPORT, 'utf8');
  const firstCall = join(root, 'first-call');
  writeFileSync(scratch.claude, [
    '#!/bin/sh',
    `echo called >> '${scratch.callLog}'`,
    `if [ ! -e '${firstCall}' ]; then`,
    `  : > '${firstCall}'`,
    `  /bin/cat > '${promptFileOf(scratch)}'`,
    `  /bin/cp -R '${payloadDir}/.' '${scratch.repo}/'`,
    'else',
    '  /bin/cat > /dev/null',
    'fi',
    `/bin/cat '${reportFile}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(scratch.claude, 0o755);
  return scratch;
}

/** What a run read: its output, both streams, and the run record's task step. */
interface Observed {
  readonly exitCode: number | null;
  readonly output: string;
  readonly prompt: string;
  readonly taskStep: { readonly newFailures: readonly { readonly file: string }[]; readonly scope: string } | undefined;
}

/** Runs the loop over `scratch` in text mode and reads what the cases assert on. */
function runAndObserve(scratch: Scratch): Observed {
  const run = runLoopStart(scratch, 'text', [PLAN_FLAG, ...SESSION_FLAGS.slice(1)]);
  const [record] = readSessions(scratch.repo);
  return {
    exitCode: run.exitCode,
    output: `${run.stdout}${run.stderr}`,
    prompt: existsSync(promptFileOf(scratch))
      ? readFileSync(promptFileOf(scratch), 'utf8')
      : '',
    taskStep: record?.steps?.find((step) => step.kind === 'task'),
  };
}

describe('rafa loop start over a one-task fixture plan whose task commits a tracked file naming the old plan directory', () => {
  const observe = (): Observed => runAndObserve(plantFixture({ 'docs/notes.md': `Plans live under ${OLD_PLAN_DIR} in this project.\n` }));

  it('goes red at the task\'s own step on the sweep, which the changed-file selection never reaches', () => {
    const seen = observe();

    expect(seen.output).toContain(`❌ The runner's task step after "${TASK}" found failures the suite baseline does not hold.`);
    expect(seen.output).toContain(`New failing test files: ${SWEEP_PATH} (1 test).`);
    expect(seen.output).not.toContain('found ESLint errors');
    expect(seen.taskStep?.scope).toBe('affected');
    expect(seen.taskStep?.newFailures.map((failure) => failure.file)).toEqual([SWEEP_PATH]);
  }, RUN_TIMEOUT);

  it('lists the sweep in the task prompt, as the files tests.alwaysRun matches', () => {
    const seen = observe();

    expect(seen.prompt).toContain(`Also run \`bun test ./${SWEEP_PATH}\``);
    expect(seen.prompt).toContain('`tests.alwaysRun` files');
  }, RUN_TIMEOUT);
});

describe('rafa loop start over a one-task fixture plan whose task commits a JSON file indented by one space', () => {
  it('goes red at the task\'s step on the lint, with every test green', () => {
    const seen = runAndObserve(plantFixture({ 'data.json': '{\n "name": "probe"\n}\n' }));

    expect(seen.output).toContain(`❌ The runner's lint step after "${TASK}" found ESLint errors in the task's diff.`);
    expect(seen.output).toContain('Files with errors: data.json (1 error).');
    expect(seen.output).toContain('data.json:2:1 Expected indentation of 2 spaces but found 1. (jsonc/indent)');
    expect(seen.output).not.toContain('found failures the suite baseline does not hold');
    expect(seen.taskStep?.newFailures).toEqual([]);
  }, RUN_TIMEOUT);
});

describe('rafa loop start over a one-task fixture plan whose task commits clean files', () => {
  it('stays green at the task\'s step, lint included', () => {
    const seen = runAndObserve(plantFixture({
      'docs/notes.md': 'Plans live under .rafa/plans in this project.\n',
      'data.json': '{\n  "name": "probe"\n}\n',
    }));

    expect(seen.exitCode).toBe(0);
    expect(seen.output).toContain(`🧹 lint step after "${TASK}": bunx eslint --no-warn-ignored over 2 file(s) exited 0; 0 error(s) in 0 file(s).`);
    expect(seen.output).not.toContain('❌');
    expect(seen.taskStep?.newFailures).toEqual([]);
    expect(seen.prompt).toContain(`Also run \`bun test ./${SWEEP_PATH}\``);
  }, RUN_TIMEOUT);
});
