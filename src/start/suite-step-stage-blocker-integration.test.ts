/**
 * `rafa loop start` spawned end to end, over a real `bun test`, proving
 * that a stage step (`./suite-step.ts`'s `runStageStep`, wired in
 * `./suite-steps-run.ts`) catches a task's breakage the task step never
 * saw, and hands it on to the retried task's prompt.
 *
 * The scratch repository's one test file, `shared.test.ts`, reads
 * `shared-data.json` off disk with `readFileSync` rather than importing
 * it, so Bun's `--changed` dependency graph never reaches it from a
 * change to that JSON file alone (`./suite-step.ts`'s module note). The
 * first task's stand-in session flips the JSON's `flag`, breaking that
 * test, and answers `status: done` with no blocker: its own task step,
 * `bun test --changed=<base>`, runs zero test files and stays green,
 * since `shared-data.json` is outside its `--changed` selection.
 *
 * That task is its stage's only, and so its last, task. The stage step
 * that follows has no `Owns:` folders to narrow it (`stageStepScope`'s
 * `no-owns` answer), so it runs the WHOLE suite regardless of what
 * changed, catches `shared.test.ts` failing fresh against the baseline,
 * and is red. It writes its blocker on the next open task — the second
 * stage's only task — before that task is ever dispatched: the first
 * run's one assertion is that tracker line reading `[BLOCKED]`, naming
 * `shared.test.ts`, and the stand-in never called a second time.
 *
 * A second `loop start` over the same repository retries that task: the
 * stage's step is already in the ledger, so nothing runs before the
 * dispatch, and the task is handed the blocker text through
 * `BLOCKER_PROMPT_PREFIX` (`./dispatch.ts`). The second run's assertion
 * reads the stand-in's second captured prompt for that same text and
 * file name, proving the retry actually carries what blocked it.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantProjectConfig } from '../tests/cli-capture.js';
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

/** The first stage's only task: breaks `shared.test.ts` outside its own `--changed` selection. */
const TASK1 = 'Flip the shared flag, outside this task\'s own diff selection';

/** The second stage's only task: never dispatched until the stage step's blocker is resolved. */
const TASK2 = 'Read the shared flag back, after the flip';

/** The plan: one task per stage, so the first task's commit is its stage's last. */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  '# Stage: flips the flag',
  '',
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

/** `shared.test.ts`'s source: reads {@link DATA_FILE} off disk, never imports it. */
const TEST_FILE_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  'import { readFileSync } from \'node:fs\';',
  'import { join } from \'node:path\';',
  '',
  'test(\'reads the shared flag\', () => {',
  '  const raw = readFileSync(join(import.meta.dir, \'shared-data.json\'), \'utf8\');',
  '  const data = JSON.parse(raw) as { flag: boolean };',
  '  expect(data.flag).toBe(true);',
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

/** Call 1's report: the task done, having flipped the flag outside its own diff. */
const CALL1_REPORT = reportLines('done', 'flipped shared-data.json; the tests it reaches by --changed stay green');

/** Call 2's report: blocked, once the retry has been handed the stage step's failure. */
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

/** The whole prompt the stand-in's `n`th call was given. */
function promptOf(scratch: Scratch, n: number): string {
  return readFileSync(join(scratch.calls, `${n}.prompt`), 'utf8');
}

describe('a stage step blocking the task after the one that broke a file outside its --changed selection', () => {
  it('blocks the next task naming the file, and hands the retry its prompt', async () => {
    const scratch = plant();

    // Run 1: the first task flips the flag, its own task step stays
    // green, and the stage step that follows — the stage's only task is
    // also its last — runs the whole suite, catches `shared.test.ts`
    // fresh against the baseline, and blocks the second task before it
    // is ever dispatched.
    const run1 = runLoopStart(scratch);
    expect(run1.exitCode).toBe(0);
    expect(callCount(scratch)).toBe(1);

    const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);
    const trackerAfterRun1 = readFileSync(trackerPath, 'utf8');
    expect(trackerAfterRun1).toContain(`- [x] ${TASK1}`);

    const blockedTask = findNextTask(trackerAfterRun1);
    expect(blockedTask?.status).toBe('blocked');
    expect(blockedTask?.task).toBe(TASK2);
    expect(blockedTask?.blocker).toContain(TEST_FILE);
    expect(blockedTask?.blocker).toContain('stage step');

    // The first call's prompt carries no blocker: nothing had failed yet
    // when the first task was dispatched.
    expect(promptOf(scratch, 1)).not.toContain(BLOCKER_PROMPT_PREFIX);

    // Run 2: the stage's step is already in the ledger, so nothing runs
    // ahead of the retry, and the second task is dispatched straight
    // away, handed the blocker text the stage step wrote.
    const run2 = runLoopStart(scratch);
    expect(run2.exitCode).toBe(0);
    expect(callCount(scratch)).toBe(2);

    const retryPrompt = promptOf(scratch, 2);
    expect(retryPrompt).toContain(BLOCKER_PROMPT_PREFIX);
    expect(retryPrompt).toContain(TEST_FILE);
    expect(retryPrompt).toContain(blockedTask?.blocker ?? '');
  }, CASE_TIMEOUT_MS);
});
