/**
 * `rafa loop start` spawned end to end, over a real `bun test`, proving
 * that a stage step (`./suite-step.ts`'s `runStageStep`, wired in
 * `./suite-steps-run.ts`) catches a task's breakage the task step never
 * saw, and hands it on to the retried task's prompt.
 *
 * The scratch repository's test file, `shared.test.ts`, imports `dep.ts`
 * and reads `shared-data.json` off disk with `readFileSync` rather than
 * importing it, so Bun's `--changed` dependency graph reaches it from a
 * change to `dep.ts` and never from one to that JSON file alone. The
 * first stage's first task touches `dep.ts` (its step runs
 * `shared.test.ts`, green); its second task flips the JSON's `flag`,
 * breaking that test, and answers `status: done` with no blocker: its own
 * task step, `bun test --changed=<base>`, selects no test file and stays
 * green.
 *
 * That second task is the stage's last. The stage step that follows has
 * no `Owns:` folders to narrow it (`stageStepScope`'s `fallback` answer),
 * so it runs `bun test --changed=<since>` from the stage's own base: the
 * stage's diff holds `dep.ts`, so it selects `shared.test.ts`, catches it
 * failing fresh against the baseline, and is red. It inserts a `[BLOCKED]`
 * repair task carrying its blocker above the next open task — the second
 * stage's only task — which it leaves open and never dispatched
 * (`./suite-blocker.ts`): the first run's assertions are that repair
 * line, naming `shared.test.ts` and declared for `build-error-resolver`,
 * the second stage's task still `[ ]`, and the stand-in called twice.
 *
 * A second `loop start` over the same repository dispatches the repair:
 * the stage's step is already in the ledger, so nothing runs before the
 * dispatch, and the repair is handed the blocker text through
 * `BLOCKER_PROMPT_PREFIX` (`./dispatch.ts`). The second run's assertion
 * reads the stand-in's second captured prompt for that same text and
 * file name, and its arguments for the repair's agent, proving the
 * repair actually carries what blocked it.
 */
import type { CapturedRun } from '../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { expectExit, plantProjectConfig } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';
import { findNextTask } from '../utils/tracker.js';

import { BLOCKER_PROMPT_PREFIX } from './dispatch.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the shell script template below. */
const FENCE = '```';

/** How long one `loop start` run may take before it is killed. */
const RUN_TIMEOUT_MS = 60_000;

/** This file's own test timeout: two spawned runs, each running real `bun test`. */
const CASE_TIMEOUT_MS = 120_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'suite-step-stage-blocker';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The first stage's first task: touches `dep.ts`, which `shared.test.ts` imports, so the stage's diff reaches that test. */
const TASK0 = 'Touch the dependency the shared test imports';

/** The first stage's last task: breaks `shared.test.ts` outside its own `--changed` selection. */
const TASK1 = 'Flip the shared flag, outside this task\'s own diff selection';

/** The second stage's only task: never dispatched until the stage step's repair is done. */
const TASK2 = 'Read the shared flag back, after the flip';

/** The plan: the first stage's last task commits the break; the second stage holds one task. */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  '# Stage: flips the flag',
  '',
  `- [ ] ${TASK0}`,
  `- [ ] ${TASK1}`,
  '',
  '# Stage: reads it back',
  '',
  `- [ ] ${TASK2}`,
  '',
].join('\n');

/** The JSON file `shared.test.ts` reads by `readFileSync`, never by `import`. */
const DATA_FILE = 'shared-data.json';

/** The test file the first task's change breaks, outside Bun's `--changed` import graph. */
const TEST_FILE = 'shared.test.ts';

/** The module `shared.test.ts` imports, so a change to it selects that test under `--changed`. */
const DEP_FILE = 'dep.ts';

/** `shared.test.ts`'s source: reads {@link DATA_FILE} off disk, never imports it. */
const TEST_FILE_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  'import { readFileSync } from \'node:fs\';',
  'import { join } from \'node:path\';',
  '',
  'import { LABEL } from \'./dep\';',
  '',
  'test(\'reads the shared flag\', () => {',
  '  const raw = readFileSync(join(import.meta.dir, \'shared-data.json\'), \'utf8\');',
  '  const data = JSON.parse(raw) as { flag: boolean };',
  '  expect(data.flag).toBe(true);',
  '  expect(LABEL).toBe(\'dep\');',
  '});',
  '',
].join('\n');

/** The flags every `loop start` in this file runs with. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

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

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-suite-step-stage-blocker-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Runs git in `cwd` under `home`'s isolated identity, no gpg signing. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
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

/** Call 1's report: the dependency touched, every test it reaches still green. */
const CALL0_REPORT = reportLines('done', 'touched dep.ts; shared.test.ts still passes');

/** Call 2's report: the task done, having flipped the flag outside its own diff. */
const CALL1_REPORT = reportLines('done', 'flipped shared-data.json; the tests it reaches by --changed stay green');

/** Call 3's report: blocked, once the retry has been handed the stage step's failure. */
const CALL2_REPORT = reportLines('blocked', 'read the stage step blocker the retry prompt carried');

/**
 * The stand-in `claude`: keeps each call's count, its arguments and its
 * whole prompt outside the repository, then answers by call number. Call
 * 1 flips {@link DATA_FILE}'s flag as a tracked change, breaking
 * {@link TEST_FILE} outside its own `--changed` selection, and answers
 * {@link CALL1_REPORT}. Every later call touches nothing and answers
 * {@link CALL2_REPORT}, so a second task dispatched more than once still
 * reads as blocked rather than looping the run.
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
    `  printf '%s\\n' '// touched' >> ${DEP_FILE}`,
    ...printLines(CALL0_REPORT),
    'elif [ "$n" -eq 2 ]; then',
    `  printf '%s\\n' '{"flag": false}' > ${DATA_FILE}`,
    ...printLines(CALL1_REPORT),
    'else',
    ...printLines(CALL2_REPORT),
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

/**
 * A scratch git repository on {@link BRANCH}, its own HOME and `bin/`
 * beside it, holding `.rafa/config.yaml`, {@link PLAN} at
 * `.plans/PLAN-<stub>.md` and, in its seed commit, {@link TEST_FILE}
 * passing against {@link DATA_FILE} as it stands (`flag: true`). The
 * stand-in `claude` is written to `bin/claude`. `.plans/`, `.rafa/` and
 * `progress.txt` are gitignored, as a real project's are.
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
  writeFileSync(join(repo, DATA_FILE), '{"flag": true}\n', 'utf8');
  writeFileSync(join(repo, DEP_FILE), 'export const LABEL = \'dep\';\n', 'utf8');
  writeFileSync(join(repo, TEST_FILE), TEST_FILE_SOURCE, 'utf8');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');
  plantProjectConfig(repo);

  return scratch;
}

/** Runs `rafa loop start` over {@link RUN_FLAGS} in `scratch`'s repository, waiting for it to finish. */
function runLoopStart(scratch: Scratch): CapturedRun {
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

/** The whole prompt the stand-in's `n`th call was given. */
function promptOf(scratch: Scratch, n: number): string {
  return readFileSync(join(scratch.calls, `${n}.prompt`), 'utf8');
}

describe('a stage step after a task that broke a file outside its --changed selection', () => {
  it('inserts a repair task naming the file above the next task, and hands the repair its prompt', async () => {
    const scratch = plant();

    // Run 1: the second task flips the flag, its own task step stays
    // green, and the stage step that follows — that task is the stage's
    // last — runs `--changed=<since>`, catches `shared.test.ts`
    // fresh against the baseline, and inserts a blocked repair task
    // above the second task, which is never dispatched.
    const run1 = runLoopStart(scratch);
    expectExit(run1, 0, { ...scratch });
    expect(callCount(scratch)).toBe(2);

    const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);
    const trackerAfterRun1 = readFileSync(trackerPath, 'utf8');
    expect(trackerAfterRun1).toContain(`- [x] ${TASK0}`);
    expect(trackerAfterRun1).toContain(`- [x] ${TASK1}`);

    expect(trackerAfterRun1).toContain(`- [ ] ${TASK2}`);

    const blockedTask = findNextTask(trackerAfterRun1);
    expect(blockedTask?.status).toBe('blocked');
    expect(blockedTask?.task).toMatch(/^Repair the red stage step at commit [0-9a-f]{12} {2}\{agent=build-error-resolver\}$/);
    expect(blockedTask?.blocker).toContain(TEST_FILE);
    expect(blockedTask?.blocker).toContain('stage step');

    // The stage step ran the no-`Owns:` fallback, and its record says so.
    const [record] = readSessions(scratch.repo);
    const stageStep = record?.steps?.find((step) => step.kind === 'stage');
    expect(stageStep?.scope).toBe('affected');
    expect(stageStep?.reason).toBe('fallback');

    // The first call's prompt carries no blocker: nothing had failed yet
    // when the first task was dispatched.
    expect(promptOf(scratch, 2)).not.toContain(BLOCKER_PROMPT_PREFIX);

    // Run 2: the stage's step is already in the ledger, so nothing runs
    // ahead of the repair, which is dispatched straight away under its
    // declared agent, handed the blocker text the stage step wrote.
    const run2 = runLoopStart(scratch);
    expectExit(run2, 0, { ...scratch });
    expect(callCount(scratch)).toBe(3);

    const retryPrompt = promptOf(scratch, 3);
    expect(retryPrompt).toContain(BLOCKER_PROMPT_PREFIX);
    expect(retryPrompt).toContain(TEST_FILE);
    expect(retryPrompt).toContain(blockedTask?.blocker ?? '');
    expect(readFileSync(join(scratch.calls, '3.args'), 'utf8')).toContain('--agent\nbuild-error-resolver\n');
  }, CASE_TIMEOUT_MS);
});
