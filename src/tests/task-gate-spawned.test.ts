/**
 * The task gate, driven as the real `rafa loop start` over one-task
 * fixture plans (`src/tests/loop-scratch.ts`): the unit cases of the
 * gate's parts (`task-gate-lines.ts`, `lint-step.ts`, `suite-step.ts`)
 * hold each part to a seam, and these cases hold the parts together.
 *
 * The fixture project holds one content sweep, `src/hygiene.sweep.test.ts`,
 * which imports no project file and reads `git ls-files` at run time, and
 * an `eslint.config.mjs` that names the one rule the fixture lints with,
 * `jsonc/indent` at two spaces, as the root config does. The default
 * `tests.alwaysRun` glob, `src/**` + `/*.sweep.test.ts`, names the sweep.
 *
 * The fixture's ESLint is a stand-in (`eslint-stand-in.mjs`) copied to its
 * `node_modules/.bin/eslint`, so `bunx eslint` runs a file inside the
 * scratch repository and the cases read nothing outside it: a link to this
 * checkout's `node_modules` made them pass only where that link, or a
 * `node_modules` above the scratch directory, reached a real ESLint, and
 * without both, `bunx` fetched ESLint from the registry. A fixture planted
 * with no ESLint gets an unreachable registry, so its `bunx eslint` has
 * nothing to resolve and fetch.
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
 *   - clean files leave the step green, lint included;
 *   - a fixture with no resolvable ESLint ends at a lint step that could
 *     not run ESLint, which is no ESLint errors in the task's diff;
 *   - a test file that throws while it loads is an error outside any
 *     test: Bun's JUnit file holds nothing for it, so the step names the
 *     file and the error's first line from Bun's stderr, and keeps the
 *     block in `.rafa/runs/<session>/suite/task.output.txt`. It is taken
 *     once more first; thrown again, the run halts on it;
 *   - a file that throws on its first load only, told by a marker file
 *     outside the repository, is the same error on the first take and
 *     none on the retake: the step prints the intermittent line, halts
 *     nothing, and the run reaches its wrap-up.
 *
 * With one task there is no open task to insert a repair above, so a red
 * step's repair goes after it (`start/suite-blocker.ts`); what the step
 * wrote reads from the run output and the run record's task step.
 */
import type { CapturedRun, ScratchPaths } from './cli-capture.js';
import type { Scratch } from './loop-scratch.js';

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';

import { expectExit } from './cli-capture.js';
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

/** The config the stand-in ESLint stands for; the stand-in answers its one rule without reading it. */
const ESLINT_CONFIG_TEXT = [
  'export default [',
  '  { ignores: [\'node_modules/**\', \'.rafa/**\'] },',
  '  { files: [\'**/*.json\'], rules: { \'jsonc/indent\': [\'error\', 2] } },',
  '];',
  '',
].join('\n');

/** The stand-in ESLint, copied into each fixture that holds one. */
const ESLINT_STAND_IN = join(import.meta.dir, 'eslint-stand-in.mjs');

/** A registry nothing answers at, so a `bunx` with no ESLint to resolve has nothing to fetch. */
const UNREACHABLE_REGISTRY = { npm_config_registry: 'http://127.0.0.1:1/' };

/** The files the task session adds, by path, or a function of the planted scratch for files that name a path outside the repository. */
type Payload = Readonly<Record<string, string>> | ((scratch: Scratch) => Readonly<Record<string, string>>);

/** Whether a planted fixture holds an ESLint `bunx` resolves. */
type EslintPlanting = 'stand-in' | 'none';

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

/** Copies the stand-in ESLint to the fixture's `node_modules/.bin/eslint`, which the fixture's `.gitignore` leaves untracked. */
function plantEslint(repo: string): void {
  const bin = join(repo, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  copyFileSync(ESLINT_STAND_IN, join(bin, 'eslint'));
  chmodSync(join(bin, 'eslint'), 0o755);
}

/**
 * Plants the fixture: the sweep and the ESLint config committed on
 * `feat/probe`, the ESLint `eslint` says (the stand-in, or none), a
 * project config with no pull request provider, and a stand-in `claude`
 * whose first call copies `payload` into the repository and saves its
 * prompt, and whose later calls only answer.
 */
function plantFixture(payload: Payload, eslint: EslintPlanting = 'stand-in'): Scratch {
  const scratch = planter.plant({ branch: 'feat/probe', plan: PLAN_OPEN, config: 'pr:\n  provider: none\n' });
  if (eslint === 'stand-in') plantEslint(scratch.repo);
  writeTree(scratch.repo, {
    '.gitignore': 'progress.txt\n.plans/\n.rafa/\nnode_modules\n',
    [SWEEP_PATH]: SWEEP_TEXT,
    'eslint.config.mjs': ESLINT_CONFIG_TEXT,
  });
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'fixture seed');

  const root = dirname(scratch.home);
  const payloadDir = join(root, 'payload');
  writeTree(payloadDir, typeof payload === 'function'
    ? payload(scratch)
    : payload);
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

/** The message the throwing test files throw, which Bun prints as the error's first line. */
const LOAD_ERROR = 'boom while loading';

/** The test file the task commits in the unhandled-error cases. */
const THROWING_PATH = 'src/loadboom.test.ts';

/** A test file that throws every time it loads. */
const ALWAYS_THROWS_TEXT = [
  'import { expect, test } from \'bun:test\';',
  '',
  `throw new Error(${JSON.stringify(LOAD_ERROR)});`,
  '',
  'test(\'never reached\', () => {',
  '  expect(true).toBe(true);',
  '});',
  '',
].join('\n');

/** Where the first-load-only file leaves its marker: beside the scratch HOME, outside the repository. */
function markerOf(scratch: Scratch): string {
  return join(dirname(scratch.home), 'first-load-marker');
}

/** A test file that throws on its first load only, the marker file telling the first load from the next. */
function firstLoadThrowsText(marker: string): string {
  return [
    'import { existsSync, writeFileSync } from \'node:fs\';',
    '',
    'import { expect, test } from \'bun:test\';',
    '',
    `if (!existsSync(${JSON.stringify(marker)})) {`,
    `  writeFileSync(${JSON.stringify(marker)}, 'loaded once');`,
    `  throw new Error(${JSON.stringify(LOAD_ERROR)});`,
    '}',
    '',
    'test(\'passes from the second load on\', () => {',
    '  expect(true).toBe(true);',
    '});',
    '',
  ].join('\n');
}

/** What a run read: the run itself, its output, both streams, and the run record's task step. */
interface Observed {
  readonly run: CapturedRun;
  /** The scratch paths a failing exit assertion names beside the run. */
  readonly scratch: ScratchPaths;
  readonly output: string;
  readonly prompt: string;
  /** The run's session id, which names its `.rafa/runs/<session>/` directory; null when no record was written. */
  readonly sessionId: string | null;
  readonly taskStep: { readonly newFailures: readonly { readonly file: string }[]; readonly scope: string | readonly string[] } | undefined;
}

/** Runs the loop over `scratch` in text mode, with `env` added, and reads what the cases assert on. */
function runAndObserve(scratch: Scratch, env: Readonly<Record<string, string>> = {}): Observed {
  const run = runLoopStart(scratch, 'text', [PLAN_FLAG, ...SESSION_FLAGS.slice(1)], env);
  const [record] = readSessions(scratch.repo);
  return {
    run,
    scratch: { ...scratch },
    output: `${run.stdout}${run.stderr}`,
    prompt: existsSync(promptFileOf(scratch))
      ? readFileSync(promptFileOf(scratch), 'utf8')
      : '',
    sessionId: record?.sessionId ?? null,
    taskStep: record?.steps?.find((step) => step.kind === 'task'),
  };
}

describe('rafa loop start over a one-task fixture plan whose task commits a tracked file naming the old plan directory', () => {
  const observe = (): Observed => runAndObserve(plantFixture({ 'docs/notes.md': `Plans live under ${OLD_PLAN_DIR} in this project.\n` }));

  it('goes red at the task\'s own step on the sweep, which the changed-file selection never reaches', () => {
    const seen = observe();

    expect(seen.output).toContain(`❌ The runner's task step after "${TASK}" found failures the suite baseline does not hold.`);
    // The step ran the sweep alone once more (`tests.retakeRedAlone`, on by default), and it was red there too.
    expect(seen.output).toContain(`New failing test files: ${SWEEP_PATH} (1 test, red again when run alone).`);
    expect(seen.output).not.toContain('Red only in the step');
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

    expectExit(seen.run, 0, seen.scratch);
    expect(seen.output).toContain(`🧹 lint step after "${TASK}": bunx eslint --no-warn-ignored over 2 file(s) exited 0; 0 error(s) in 0 file(s).`);
    expect(seen.output).not.toContain('❌');
    expect(seen.taskStep?.newFailures).toEqual([]);
    expect(seen.prompt).toContain(`Also run \`bun test ./${SWEEP_PATH}\``);
  }, RUN_TIMEOUT);
});

describe('rafa loop start over a one-task fixture plan with no ESLint to resolve', () => {
  it('reports that the lint step could not run ESLint, not that the task\'s diff has errors', () => {
    const seen = runAndObserve(
      plantFixture({ 'data.json': '{\n  "name": "probe"\n}\n' }, 'none'),
      UNREACHABLE_REGISTRY,
    );

    expect(seen.output).toContain(`❌ The runner's lint step after "${TASK}" could not run ESLint: bunx eslint exited`);
    expect(seen.output).toContain('printed no report');
    expect(seen.output).not.toContain('found ESLint errors');
    expect(seen.output).toContain('Stopping here. Run again to retry the blocked task');
  }, RUN_TIMEOUT);
});

describe('rafa loop start over a one-task fixture plan whose task commits a test file that throws while it loads', () => {
  const scratch = plantFixture({ [THROWING_PATH]: ALWAYS_THROWS_TEXT });
  let observed: Observed | undefined;
  /** The one run both cases read, taken on the first call, inside that case's timeout. */
  const run = (): Observed => (observed ??= runAndObserve(scratch));

  it('halts on the file and the first line of its error, which no JUnit file holds', () => {
    const seen = run();

    expect(seen.output).toContain(`❌ The runner's task step after "${TASK}" found failures the suite baseline does not hold. 1 more error(s) outside any test than the baseline`);
    expect(seen.output).toContain(`${THROWING_PATH} threw "error: ${LOAD_ERROR}"`);
    expect(seen.output).not.toContain('Intermittent');
    expect(seen.output).toContain('Stopping here. Run again to retry the blocked task');
    expect(seen.output).not.toContain('Wrap-up session starting');
  }, RUN_TIMEOUT);

  it('keeps the unhandled block in the step\'s output file, under the run\'s suite directory', () => {
    const seen = run();

    expect(seen.sessionId).not.toBeNull();
    const outputFile = join(scratch.repo, '.rafa', 'runs', seen.sessionId ?? '', 'suite', 'task.output.txt');

    expect(existsSync(outputFile)).toBe(true);
    const text = readFileSync(outputFile, 'utf8');
    expect(text).toContain('# Unhandled error between tests');
    expect(text).toContain(THROWING_PATH);
    expect(text).toContain(LOAD_ERROR);
  }, RUN_TIMEOUT);
});

describe('rafa loop start over a one-task fixture plan whose task commits a test file that throws on its first load only', () => {
  const scratch = plantFixture((planted) => ({ [THROWING_PATH]: firstLoadThrowsText(markerOf(planted)) }));
  let observed: Observed | undefined;
  /** The one run both cases read, taken on the first call, inside that case's timeout. */
  const run = (): Observed => (observed ??= runAndObserve(scratch));

  it('prints the intermittent line, naming the file, and halts nothing', () => {
    const seen = run();

    expect(seen.output).toContain(`⚠️  Intermittent: the retake of the task step after "${TASK}" counted no more errors outside any test than the baseline.`);
    expect(seen.output).toContain(`${THROWING_PATH} threw "error: ${LOAD_ERROR}"`);
    expect(seen.output).not.toContain('❌');
    expect(existsSync(markerOf(scratch))).toBe(true);
  }, RUN_TIMEOUT);

  it('reaches the wrap-up and ends the run clean', () => {
    const seen = run();

    expect(seen.output).toContain('🧹 Wrap-up session starting');
    expectExit(seen.run, 0, seen.scratch);
  }, RUN_TIMEOUT);
});
