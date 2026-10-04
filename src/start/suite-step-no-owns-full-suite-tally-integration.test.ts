/**
 * `rafa loop start` spawned end to end, over a real `bun test`, proving
 * that a plan of two stages of two tasks each, with no `Owns:` folders
 * to read (its plan header names no issue, so `readPlanOwns` answers
 * `no-issue` without a `gh` call at all — `./suite-step.ts`'s module
 * note and `../suite/owns.ts`'s), runs the FULL suite exactly twice
 * over the whole run: the baseline and the pre-wrap-up step standing in
 * for the second (and last) stage's own. Every other step falls back to
 * `affected` (`bun test --changed=<base>`, or `<since>` for a stage
 * step), never the whole project.
 *
 * Of the four task lines, the first of each stage says `tests=module`,
 * which needs an `Owns:` folder to narrow to: with none, its step
 * records `scope: 'affected'`, `reason: 'fallback'`. The other two carry
 * no `tests=` of their own, so each defaults to `affected`, reason
 * `declared`. The stage step with no `Owns:` folder records `affected`,
 * `fallback` too.
 *
 * Each of the four tasks writes one companion test file of its own,
 * always green, and never touches another task's file, so all four
 * commit clean and the run reaches its wrap-up. The scratch repository's
 * seed commit holds one test file, a `tests.alwaysRun` sweep importing
 * nothing, so no changed file ever selects it: only the fallback's
 * second run over the always-run files reaches it. The baseline itself
 * holds no failure and every later step's `newFailures` stays empty.
 *
 * The sweep sleeps past {@link SLOW_SWEEP_SECONDS}'s limit while a flag
 * file is present. The first task's stand-in session plants the flag, so
 * that task's step runs the sweep slow, and the second task's session
 * removes it, so no later step does: the run's output carries exactly
 * the one slow-sweep line (`./sweep-timing.ts`), naming the sweep, which
 * proves the fallback's always-run run passes through the slow-sweep
 * guard.
 *
 * One assertion reads the run record's `steps` (`../loop/sessions.ts`)
 * for the seven entries this two-stage, two-task plan takes — baseline,
 * the first stage's two task steps, that stage's own stage step (its
 * last task's commit is also the stage's last), the second stage's two
 * task steps, and the pre-wrap-up step in place of the second stage's
 * own (`dueStages` never answers a stage once no task is left open) —
 * and checks their `scope` and `reason`. A second assertion reads the
 * tracker once the run has finished: all four tasks ticked `[x]`, and no
 * line ever marked `[BLOCKED]`.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { plantProjectConfig } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { SLOW_SWEEP_SECONDS } from './sweep-timing.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the shell script template below. */
const FENCE = '```';

/** How long the one spawned `loop start` run may take: seven real `bun test` runs of a tiny project, one sweep sleeping past the slow limit. */
const RUN_TIMEOUT_MS = 120_000;

/** This file's own test timeout. */
const CASE_TIMEOUT_MS = 150_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'suite-step-no-owns-full-suite-tally';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The first stage's two tasks: the first says `tests=module`, with no `Owns:` folder to narrow to; the second has no `tests=`, so it defaults to `affected`. */
const TASK1 = 'Add the first stage\'s first companion test';
const TASK2 = 'Add the first stage\'s second companion test';

/** The second stage's two tasks, the same pair. */
const TASK3 = 'Add the second stage\'s first companion test';
const TASK4 = 'Add the second stage\'s second companion test';

/** The declaration suffix of a task line that says `tests=module`. */
const MODULE_DECLARATION = '  {tests=module}';

/** The `tests.alwaysRun` sweep: imports nothing, so no changed file selects it. */
const SWEEP_FILE = 'always-run.sweep.test.ts';

/** The flag file whose presence makes the sweep sleep past the slow limit; gitignored, planted and removed by the stand-in. */
const SLOW_FLAG = '.slow-sweep-flag';

/** How long the sweep sleeps while the flag is present, just past {@link SLOW_SWEEP_SECONDS}. */
const SLOW_SLEEP_MS = Math.round((SLOW_SWEEP_SECONDS + 0.6) * 1000);

/** The sweep's source: green always, slow only while {@link SLOW_FLAG} is present beside it; its own timeout clears bun's 5 s default. */
const SWEEP_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  'import { existsSync } from \'node:fs\';',
  'import { join } from \'node:path\';',
  '',
  'test(\'the sweep stays green, slow while the flag is present\', async () => {',
  `  if (existsSync(join(import.meta.dir, '${SLOW_FLAG}'))) await Bun.sleep(${SLOW_SLEEP_MS});`,
  '  expect(1).toBe(1);',
  `}, ${SLOW_SLEEP_MS * 2});`,
  '',
].join('\n');

/**
 * The plan: two stages of two tasks each, and no `rafa:plan` header
 * block naming an issue at all — the plan header carries no `issue`
 * field, so `readPlanOwns` (`../suite/owns.ts`) answers `no-issue`
 * before it ever reaches for `gh`, and every stage step runs the whole
 * suite narrowed by `--changed`; the first task of each stage says
 * `tests=module`, which also falls back.
 */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  '# Stage: first stage',
  '',
  `- [ ] ${TASK1}${MODULE_DECLARATION}`,
  `- [ ] ${TASK2}`,
  '',
  '# Stage: second stage',
  '',
  `- [ ] ${TASK3}${MODULE_DECLARATION}`,
  `- [ ] ${TASK4}`,
  '',
].join('\n');

/** A trivial passing test file, its one test named `name`. */
function companionSource(name: string): string {
  return [
    'import { expect, test } from \'bun:test\';',
    '',
    `test('${name}', () => {`,
    '  expect(1).toBe(1);',
    '});',
    '',
  ].join('\n');
}

/** The companion test file each task writes, one per call. */
const COMPANION_FILES = [
  'companion-stage1-task1.test.ts',
  'companion-stage1-task2.test.ts',
  'companion-stage2-task1.test.ts',
  'companion-stage2-task2.test.ts',
] as const;

/** The flags every `loop start` in this file runs with: no CI wait, and `pr.provider: none` so the wrap-up push costs no `gh`. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** The project config: `pr.provider: none`, so the wrap-up's push is the run's only reach for a remote, and it never throws without one; and the sweep in `tests.alwaysRun`. */
const CONFIG = `pr:\n  provider: none\ntests:\n  alwaysRun: [${SWEEP_FILE}]\n`;

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

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-suite-step-no-owns-tally-')));
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

/** Call 1 plants {@link SLOW_FLAG}, so its task step runs the sweep slow; call 2 removes it, so no later step does. */
function flagLines(n: number): readonly string[] {
  if (n === 1) return [`: > ${SLOW_FLAG}`];
  if (n === 2) return [`/bin/rm -f ${SLOW_FLAG}`];
  return [];
}

/**
 * The stand-in `claude`: keeps each call's count, its arguments and its
 * whole prompt outside the repository, then answers by call number.
 * Calls 1 through 4, one per task, each write that task's own companion
 * file ({@link COMPANION_FILES}) and answer `status: done`, call 1
 * planting {@link SLOW_FLAG} and call 2 removing it; call 5, the
 * wrap-up's own session once the tracker holds no task left, writes
 * nothing — `preserveProgress` never reads its output at all when the
 * run holds no lesson to promote, which this scratch repository never
 * does.
 */
function standInScript(calls: string): string {
  const taskBranches = COMPANION_FILES.map((file, index) => {
    const n = index + 1;
    const keyword = n === 1
      ? 'if'
      : 'elif';
    return [
      `${keyword} [ "$n" -eq ${n} ]; then`,
      ...heredocWrite(file, companionSource(`companion ${n}, always green`)),
      ...flagLines(n),
      ...printLines(reportLines('done', `added companion ${n}`)),
    ];
  }).flat();

  return [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    'for arg in "$@"; do printf \'%s\\n\' "$arg"; done > "$calls/$n.args"',
    '/bin/cat > "$calls/$n.prompt"',
    ...taskBranches,
    'else',
    ...printLines(reportLines('done', 'wrap-up: nothing left to preserve')),
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

/**
 * A scratch git repository on {@link BRANCH}, its own HOME and `bin/`
 * beside it, holding `.rafa/config.yaml` (`pr.provider: none`) and
 * {@link PLAN} at `.plans/PLAN-<stub>.md`. The seed commit holds the
 * always-run sweep alone, green while its flag is absent, so the baseline
 * itself finds nothing red. The stand-in
 * `claude` is written to `bin/claude`. `.plans/`, `.rafa/` and
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
  writeFileSync(join(repo, '.gitignore'), `progress.txt\n.plans/\n.rafa/\n${SLOW_FLAG}\n`, 'utf8');
  writeFileSync(join(repo, 'README.md'), `# ${STUB}\n`, 'utf8');
  writeFileSync(join(repo, SWEEP_FILE), SWEEP_SOURCE, 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed, the always-run sweep as its only test file');
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

describe('a plan of two stages of two tasks each, with no Owns: folders to read', () => {
  it('runs the full suite only for the baseline and the pre-wrap-up step, every other step recording the affected fallback', () => {
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

    // Baseline, the first stage's two task steps, that stage's own stage
    // step (due once its second task, also its last, commits), the
    // second stage's two task steps, and the pre-wrap-up step standing
    // in for the second stage's own, since no task is left open by then.
    expect(steps.map((step) => step.kind)).toEqual([
      'baseline',
      'task',
      'task',
      'stage',
      'task',
      'task',
      'pre-wrap-up',
    ]);

    for (const step of steps) expect(step.newFailures).toEqual([]);

    // Exactly two full-suite runs — the baseline and the pre-wrap-up step.
    // With no `Owns:` folder every other step falls back to `--changed`.
    const fullSteps = steps.filter((step) => step.scope === 'full');
    expect(fullSteps.map((step) => step.kind)).toEqual(['baseline', 'pre-wrap-up']);

    const stageStep = steps.find((step) => step.kind === 'stage');
    expect(stageStep?.scope).toBe('affected');
    expect(stageStep?.reason).toBe('fallback');

    // The `tests=module` tasks have no folder to narrow to: `fallback`.
    // The two default tasks are `declared` `affected`.
    const taskSteps = steps.filter((step) => step.kind === 'task');
    expect(taskSteps.map((step) => [step.scope, step.reason])).toEqual([
      ['affected', 'fallback'],
      ['affected', 'declared'],
      ['affected', 'fallback'],
      ['affected', 'declared'],
    ]);

    // The fallback's always-run run passes through the slow-sweep guard:
    // the one step the sweep ran slow in, the first task's, is named, and
    // no other step is.
    const slowLines = run.stdout.split('\n').filter((line) => line.includes('🐢'));
    expect(slowLines).toHaveLength(1);
    expect(slowLines[0]).toContain(`1 tests.alwaysRun file(s) took over ${SLOW_SWEEP_SECONDS}s in the task step: ${SWEEP_FILE}`);
  }, CASE_TIMEOUT_MS);
});
