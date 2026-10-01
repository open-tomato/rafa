/**
 * `rafa loop start` spawned end to end, over a real `bun test`, proving
 * `taskStepScope`'s ranking (`../suite/scope.ts`'s module note) through
 * the four recorded TASK steps of one plan, each a task line demonstrating
 * one of its answers:
 *
 *   1. A line with no `tests=` whose diff touches one ordinary module
 *      (`lib/greeting.ts`, a source file, never a test) runs `bun test
 *      --changed=<base>` and nothing wider: the step's recorded `scope` is
 *      `affected` and its summary names exactly the one test file Bun's
 *      import graph reaches from it (`lib/greeting.test.ts`), never the
 *      unrelated `lib/other.test.ts` that sits beside it.
 *   2. A line with no `tests=` whose diff touches `bunfig.toml` alone runs
 *      the FULL suite: `bunfig.toml` is one of `tests.fullSuiteTriggers`'
 *      own defaults (`../config-schema-tests.ts`), a file no import graph
 *      reaches a test through, so `--changed` could miss what it changes.
 *   3. A line declaring `{tests=full}` runs the full suite regardless of
 *      what its own diff touches (here, a new `NOTES.md` nothing imports
 *      and no trigger glob matches): `declared` outranks every other rule
 *      in `taskStepScope`'s ranking.
 *   4. A line with no `tests=` whose diff touches a test file directly
 *      (`lib/other.test.ts`) still runs only `bun test --changed=<base>`,
 *      the `affected` default, and the step's summary again names exactly
 *      one file.
 *
 * The four tasks sit in one stage, its plan's only one, so its own stage
 * step never runs: `dueStages` (`./suite-step.ts`) never answers a stage
 * once no task is left open, which is true the moment the fourth task,
 * also the last task of the whole plan, commits. The pre-wrap-up step
 * stands in for it instead, as it does for any last stage
 * (`./suite-step-no-owns-full-suite-tally-integration.test.ts`'s module
 * note says the same). Six suite runs in all — the baseline, the four
 * task steps, and the pre-wrap-up step — read back from the run record's
 * `steps` (`../loop/sessions.ts`) and filtered to the four `task` ones
 * this file is about. None of the four ever fails, so the run reaches its
 * wrap-up with no task blocked. The plan's header names no issue, so
 * `readPlanOwns` (`../suite/owns.ts`) is never even asked for: no stage
 * step here ever reads it.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { plantProjectConfig } from '../tests/cli-capture.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the shell script template below. */
const FENCE = '```';

/** How long the one spawned `loop start` run may take: six real `bun test` runs of a tiny project. */
const RUN_TIMEOUT_MS = 90_000;

/** This file's own test timeout. */
const CASE_TIMEOUT_MS = 120_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'suite-step-task-scope';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** No `tests=`; its diff touches one ordinary module, not a trigger. */
const TASK1 = 'Touch the greeting module alone, an ordinary source file';

/** No `tests=`; its diff touches `bunfig.toml`, a full-suite trigger by itself. */
const TASK2 = 'Touch bunfig.toml, nothing else';

/** Declares `{tests=full}`; its diff touches an ordinary file no trigger matches. */
const TASK3 = 'Touch an ordinary file, declaring the full suite  {tests=full}';

/** No `tests=`; its diff touches a test file directly. */
const TASK4 = 'Touch the standalone test file directly';

/** The plan: one stage, four tasks, so only one stage step follows, after the last. */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  '# Stage: one stage',
  '',
  `- [ ] ${TASK1}`,
  `- [ ] ${TASK2}`,
  `- [ ] ${TASK3}`,
  `- [ ] ${TASK4}`,
  '',
].join('\n');

/** A source file one test file imports and another does not. */
const GREETING_FILE = 'lib/greeting.ts';

/** Imports {@link GREETING_FILE}; the one test Bun's `--changed` reaches from it. */
const GREETING_TEST_FILE = 'lib/greeting.test.ts';

/** Imports nothing; never reached by a change to {@link GREETING_FILE} alone. */
const OTHER_TEST_FILE = 'lib/other.test.ts';

/** The file whose own change is a full-suite trigger by its name alone. */
const BUNFIG_FILE = 'bunfig.toml';

/** {@link GREETING_FILE}'s seed source. */
const GREETING_SOURCE = [
  'export function greeting(): string {',
  '  return \'hello\';',
  '}',
  '',
].join('\n');

/** {@link GREETING_TEST_FILE}'s source: imports {@link GREETING_FILE}. */
const GREETING_TEST_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  'import { greeting } from \'./greeting\';',
  '',
  'test(\'greets\', () => {',
  '  expect(greeting()).toBe(\'hello\');',
  '});',
  '',
].join('\n');

/** {@link OTHER_TEST_FILE}'s seed source: self-contained, imports nothing. */
const OTHER_TEST_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  '',
  'test(\'stands alone\', () => {',
  '  expect(1).toBe(1);',
  '});',
  '',
].join('\n');

/** {@link OTHER_TEST_FILE}'s source once task 4 has touched it: still green, one more test. */
const OTHER_TEST_SOURCE_TOUCHED = [
  'import { expect, test } from \'bun:test\';',
  '',
  'test(\'stands alone\', () => {',
  '  expect(1).toBe(1);',
  '});',
  '',
  'test(\'still stands alone, touched by task 4\', () => {',
  '  expect(2).toBe(2);',
  '});',
  '',
].join('\n');

/** {@link BUNFIG_FILE}'s seed source: no preload of any kind. */
const BUNFIG_SOURCE = [
  '[test]',
  '# no preload files named',
  '',
].join('\n');

/** The flags every `loop start` in this file runs with. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** The project config: `pr.provider: none`, so the wrap-up's push costs no `gh`. */
const CONFIG = 'pr:\n  provider: none\n';

/** A scratch repository, and what a spawned run reads under it. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly claude: string;
  /** Where the stand-in keeps each call's count, arguments and prompt. */
  readonly calls: string;
  /** The PATH a spawned run gets: the stand-in's `bin/`, git's own directory, then bun's own. */
  readonly path: string;
}

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-suite-step-task-scope-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Runs git in `cwd` under `home`'s isolated identity, no gpg signing. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** `line` as a single-quoted POSIX shell word, any embedded `'` escaped. */
function shQuote(line: string): string {
  return `'${line.replace(/'/g, '\'\\\'\'')}'`;
}

/** `printf '%s\n' <line>` for each of `lines`, one per shell statement. */
function printLines(lines: readonly string[]): readonly string[] {
  return lines.map((line) => `printf '%s\\n' ${shQuote(line)}`);
}

/** A shell heredoc marker, kept out of every file this file writes. */
const HEREDOC_MARKER = 'RAFA_TEST_FILE_EOF';

/** `cat > <path> <<'RAFA_TEST_FILE_EOF' ... RAFA_TEST_FILE_EOF`, writing `content` whole. `content` holds no such marker line. */
function heredocWrite(path: string, content: string): readonly string[] {
  return [`cat > ${path} <<'${HEREDOC_MARKER}'`, content, HEREDOC_MARKER];
}

/** The `rafa:report` block a call answers with, `status` and `feedback` its own. */
function reportLines(status: 'done' | 'blocked', feedback: string): readonly string[] {
  return [
    `${feedback}.`,
    '',
    `${FENCE}rafa:report`,
    `status: ${status}`,
    `feedback: "${feedback}"`,
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    FENCE,
    '',
  ];
}

/**
 * The stand-in `claude`: keeps each call's count, its arguments and its
 * whole prompt outside the repository, then answers by call number.
 *
 *   1. Appends a harmless comment to {@link GREETING_FILE}, changing no
 *      behaviour `greeting.test.ts` asserts on.
 *   2. Appends a harmless comment to {@link BUNFIG_FILE}, still valid TOML.
 *   3. Writes a new `NOTES.md`, imported by nothing and matching no
 *      trigger glob; its task line's own `{tests=full}` is what runs the
 *      full suite.
 *   4. Rewrites {@link OTHER_TEST_FILE} whole, adding one more passing test.
 *   5. The wrap-up's own session, once the tracker holds no task left:
 *      writes nothing, since `preserveProgress` never reads its output
 *      with no lesson to promote, which this scratch repository never
 *      holds.
 */
function standInScript(calls: string): string {
  return [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    'for arg in "$@"; do printf \'%s\\n\' "$arg"; done > "$calls/$n.args"',
    '/bin/cat > "$calls/$n.prompt"',
    'if [ "$n" -eq 1 ]; then',
    `  printf '%s\\n' '// touched by task 1, behaviour unchanged' >> ${GREETING_FILE}`,
    ...printLines(reportLines('done', 'touched the greeting module alone')),
    'elif [ "$n" -eq 2 ]; then',
    `  printf '%s\\n' '# touched by task 2' >> ${BUNFIG_FILE}`,
    ...printLines(reportLines('done', 'touched bunfig.toml alone')),
    'elif [ "$n" -eq 3 ]; then',
    '  printf \'%s\\n\' \'Notes for task 3.\' > NOTES.md',
    ...printLines(reportLines('done', 'touched an ordinary file, declaring tests=full')),
    'elif [ "$n" -eq 4 ]; then',
    ...heredocWrite(OTHER_TEST_FILE, OTHER_TEST_SOURCE_TOUCHED),
    ...printLines(reportLines('done', 'touched the standalone test file directly')),
    'else',
    ...printLines(reportLines('done', 'wrap-up: nothing left to preserve')),
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

/**
 * A scratch git repository on {@link BRANCH}, its own HOME and `bin/`
 * beside it, holding `.rafa/config.yaml` (`pr.provider: none`),
 * {@link PLAN} at `.plans/PLAN-<stub>.md`, and, in its seed commit,
 * {@link GREETING_FILE}, {@link GREETING_TEST_FILE}, {@link OTHER_TEST_FILE}
 * and {@link BUNFIG_FILE}. The stand-in `claude` is written to
 * `bin/claude`. `.plans/`, `.rafa/` and `progress.txt` are gitignored, as a
 * real project's are.
 */
function plant(): Scratch {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const calls = join(root, 'calls');
  for (const dir of [repo, bin, home, calls]) mkdirSync(dir, { recursive: true });

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const bunBinary = Bun.which('bun');
  if (bunBinary === null) throw new Error('bun is not on the PATH this suite runs under');

  const claude = join(bin, 'claude');
  writeFileSync(claude, standInScript(calls), 'utf8');
  chmodSync(claude, 0o755);

  const scratch: Scratch = {
    repo,
    home,
    claude,
    calls,
    path: [bin, dirname(gitBinary), dirname(bunBinary)].join(delimiter),
  };

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, 'lib'));
  writeFileSync(join(repo, GREETING_FILE), GREETING_SOURCE, 'utf8');
  writeFileSync(join(repo, GREETING_TEST_FILE), GREETING_TEST_SOURCE, 'utf8');
  writeFileSync(join(repo, OTHER_TEST_FILE), OTHER_TEST_SOURCE, 'utf8');
  writeFileSync(join(repo, BUNFIG_FILE), BUNFIG_SOURCE, 'utf8');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');
  plantProjectConfig(repo, CONFIG);

  return scratch;
}

/** What one `rafa loop start` run did. */
interface LoopRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `rafa loop start` over {@link RUN_FLAGS} in `scratch`'s repository, waiting for it to finish. */
function runLoopStart(scratch: Scratch): LoopRun {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, 'loop', 'start', ...RUN_FLAGS], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    timeout: RUN_TIMEOUT_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** The call count the stand-in has recorded so far, or `0` before any call. */
function callCount(scratch: Scratch): number {
  try {
    return Number(readFileSync(join(scratch.calls, 'count'), 'utf8').trim());
  } catch {
    return 0;
  }
}

/** True when none of `command`'s entries is a `--changed=` argument. */
function hasNoChangedFlag(command: readonly string[]): boolean {
  return !command.some((arg) => arg.startsWith('--changed='));
}

/** True when none of `command`'s entries is a bare path argument, as a `full` run takes none. */
function hasNoPathArguments(command: readonly string[]): boolean {
  return !command.some((arg) => arg.startsWith('./') || arg.startsWith('../'));
}

describe('the four answers taskStepScope ranks, over one real bun test --changed', () => {
  it('records affected, full (trigger), full (declared) and affected again, each on its own task step', () => {
    const scratch = plant();
    const run = runLoopStart(scratch);

    expect(run.exitCode).toBe(0);
    // Four task sessions, one per task, and the wrap-up's own: five real
    // Claude calls, none of them retried.
    expect(callCount(scratch)).toBe(5);

    const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);
    const tracker = readFileSync(trackerPath, 'utf8');
    expect(tracker).toContain(`- [x] ${TASK1}`);
    expect(tracker).toContain(`- [x] ${TASK2}`);
    expect(tracker).toContain(`- [x] ${TASK3}`);
    expect(tracker).toContain(`- [x] ${TASK4}`);
    expect(tracker).not.toContain('[BLOCKED]');

    const [record] = readSessions(scratch.repo);
    if (record === undefined) throw new Error('the run wrote no session record at all');
    const steps = record.steps ?? [];

    // Baseline, the four task steps, and the pre-wrap-up step standing in
    // for the plan's only (and last) stage's own, since no task is left
    // open once the fourth task, also the plan's last, commits.
    expect(steps.map((step) => step.kind)).toEqual([
      'baseline',
      'task',
      'task',
      'task',
      'task',
      'pre-wrap-up',
    ]);

    for (const step of steps) expect(step.newFailures).toEqual([]);

    const taskSteps = steps.filter((step) => step.kind === 'task');
    expect(taskSteps).toHaveLength(4);
    const [task1Step, task2Step, task3Step, task4Step] = taskSteps;
    if (task1Step === undefined || task2Step === undefined || task3Step === undefined || task4Step === undefined) {
      throw new Error('fewer than four task steps were recorded');
    }

    // 1. No tests=, a diff touching one ordinary module: affected, and
    // Bun's own summary names exactly the one test file its import graph
    // reaches, never the unrelated one beside it.
    expect(task1Step.scope).toBe('affected');
    expect(task1Step.command.some((arg) => arg.startsWith('--changed='))).toBe(true);
    expect(task1Step.summary).toContain('across 1 file');

    // 2. No tests=, a diff touching bunfig.toml alone: the full suite,
    // since that file is one of tests.fullSuiteTriggers' own defaults and
    // no import graph reaches a test through it.
    expect(task2Step.scope).toBe('full');
    expect(hasNoChangedFlag(task2Step.command)).toBe(true);
    expect(hasNoPathArguments(task2Step.command)).toBe(true);

    // 3. {tests=full} declared: the full suite regardless of what its own
    // diff touches (here, a new file no trigger glob matches and no test
    // imports).
    expect(task3Step.scope).toBe('full');
    expect(hasNoChangedFlag(task3Step.command)).toBe(true);
    expect(hasNoPathArguments(task3Step.command)).toBe(true);

    // 4. No tests=, a diff touching a test file directly: still only the
    // affected default, and again exactly one file in Bun's summary.
    expect(task4Step.scope).toBe('affected');
    expect(task4Step.command.some((arg) => arg.startsWith('--changed='))).toBe(true);
    expect(task4Step.summary).toContain('across 1 file');
  }, CASE_TIMEOUT_MS);
});
