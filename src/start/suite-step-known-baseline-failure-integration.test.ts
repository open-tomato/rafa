/**
 * `rafa loop start` spawned end to end, over a real `bun test`, proving
 * that a test already red BEFORE the run starts (`./suite-step.ts`'s
 * "A red baseline blocks nothing: that is what lets a run starting on a
 * red `main` go on.") is recorded as a KNOWN failure by every suite
 * step the run takes, and blocks no task.
 *
 * The scratch repository's seed commit holds `always-red.test.ts`,
 * failing already, beside the plan's two stages of one task each. Every
 * task line carries `{tests=full}`, so its own task step, like the
 * stage step and the pre-wrap-up step, runs the WHOLE project rather
 * than only what the task's own diff reaches — the one way to be sure
 * every step this file names actually re-runs `always-red.test.ts`
 * rather than skipping a file neither task ever touches. Neither task
 * changes that file: each writes a companion test of its own that
 * passes, so the plan's tasks both commit clean and the run reaches its
 * wrap-up.
 *
 * `always-red.test.ts` is exactly the baseline's own failure — the
 * first full run this file's baseline step makes reads it off the seed
 * commit and holds it from then on — so `splitFailures` (`./suite/
 * baseline.ts`) puts it in `known` at every later step and never in
 * `fresh`. One assertion reads the run record's `steps`
 * (`../loop/sessions.ts`) for the five entries this two-stage, one-task
 * plan takes — baseline, the first task, the first stage (after the
 * first task, its stage's only one), the second task, and the
 * pre-wrap-up step standing in for the second (and last) stage's own —
 * and checks each one names `always-red.test.ts` among its `failures`
 * and none of them among its `newFailures`. A second assertion reads
 * the tracker once the run has finished: both tasks ticked `[x]`, and
 * no line ever marked `[BLOCKED]`.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { plantProjectConfig } from '../tests/cli-capture.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the shell script template below. */
const FENCE = '```';

/** A shell heredoc marker, kept out of every file this file writes. */
const HEREDOC_MARKER = 'RAFA_TEST_FILE_EOF';

/** How long the one spawned `loop start` run may take: three real `bun test` runs of a tiny project. */
const RUN_TIMEOUT_MS = 90_000;

/** This file's own test timeout. */
const CASE_TIMEOUT_MS = 120_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'suite-step-known-baseline-failure';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The first stage's only task: `tests=full` so its own task step re-runs {@link ALWAYS_RED_FILE}. */
const TASK1 = 'Add a companion test beside the one already red  {tests=full}';

/** The second stage's only task, its `tests=full` for the same reason. */
const TASK2 = 'Add a second companion test  {tests=full}';

/** The plan: two stages, one task each, so a stage step runs after the first task commits. */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  '# Stage: first stage',
  '',
  `- [ ] ${TASK1}`,
  '',
  '# Stage: second stage',
  '',
  `- [ ] ${TASK2}`,
  '',
].join('\n');

/** The test file red already at the seed commit, untouched by either task. */
const ALWAYS_RED_FILE = 'always-red.test.ts';

/** The full name of {@link ALWAYS_RED_FILE}'s one test, as Bun's JUnit report names it: no `describe`, so its own name alone. */
const ALWAYS_RED_TEST_NAME = 'is always red';

/** {@link ALWAYS_RED_FILE}'s source: one test, always failing. */
const ALWAYS_RED_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  '',
  `test('${ALWAYS_RED_TEST_NAME}', () => {`,
  '  expect(1).toBe(2);',
  '});',
  '',
].join('\n');

/** The companion test file the first task writes: passes, and never touches {@link ALWAYS_RED_FILE}. */
const COMPANION1_FILE = 'companion-one.test.ts';

/** The companion test file the second task writes: passes, and never touches {@link ALWAYS_RED_FILE}. */
const COMPANION2_FILE = 'companion-two.test.ts';

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

/** The flags every `loop start` in this file runs with: no CI wait, and `pr.provider: none` so the wrap-up push costs no `gh`. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** The project config: `pr.provider: none`, so the wrap-up's push is the run's only reach for a remote, and it never throws without one. */
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

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-suite-step-known-failure-')));
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
 * Call 1 (the first task) writes {@link COMPANION1_FILE}; call 2 (the
 * second task) writes {@link COMPANION2_FILE}; call 3 (the wrap-up, its
 * own session once the tracker holds no task left) writes nothing —
 * `preserveProgress` never reads its output at all when the run holds
 * no lesson to promote, which this scratch repository never does.
 * Neither task ever writes {@link ALWAYS_RED_FILE}.
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
    ...heredocWrite(COMPANION1_FILE, companionSource('the first companion, always green')),
    ...printLines(reportLines('done', 'added the first companion test; always-red.test.ts is untouched')),
    'elif [ "$n" -eq 2 ]; then',
    ...heredocWrite(COMPANION2_FILE, companionSource('the second companion, always green')),
    ...printLines(reportLines('done', 'added the second companion test; always-red.test.ts is untouched')),
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
 * {@link ALWAYS_RED_FILE} already failing. The stand-in `claude` is
 * written to `bin/claude`. `.plans/`, `.rafa/` and `progress.txt` are
 * gitignored, as a real project's are.
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
  writeFileSync(join(repo, ALWAYS_RED_FILE), ALWAYS_RED_SOURCE, 'utf8');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed, already red');
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
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, HOME: scratch.home },
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

describe('a test already red before the run starts', () => {
  it('is known to every suite step the run takes, and blocks no task', () => {
    const scratch = plant();
    const run = runLoopStart(scratch);

    expect(run.exitCode).toBe(0);
    // Three real Claude calls: the first task's session, the second
    // task's, and the wrap-up's, none of them retried.
    expect(callCount(scratch)).toBe(3);

    const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);
    const tracker = readFileSync(trackerPath, 'utf8');
    expect(tracker).toContain(`- [x] ${TASK1}`);
    expect(tracker).toContain(`- [x] ${TASK2}`);
    expect(tracker).not.toContain('[BLOCKED]');

    // `announce()` (`./suite-step.ts`) prints one `known:` line per step
    // for a failure held by the baseline: one per step, five in all,
    // never counted as a reason to stop.
    const knownLine = `known: ${ALWAYS_RED_FILE} > ${ALWAYS_RED_TEST_NAME}`;
    expect(run.stdout.split('\n').filter((line) => line.trim() === knownLine)).toHaveLength(5);
    expect(run.stdout).not.toContain('New failing test files');

    const [record] = readSessions(scratch.repo);
    if (record === undefined) throw new Error('the run wrote no session record at all');
    const steps = record.steps ?? [];
    expect(steps.map((step) => step.kind)).toEqual(['baseline', 'task', 'stage', 'task', 'pre-wrap-up']);

    for (const step of steps) {
      expect(step.failures).toContainEqual({ file: ALWAYS_RED_FILE, name: ALWAYS_RED_TEST_NAME });
      expect(step.newFailures).toEqual([]);
    }
  }, CASE_TIMEOUT_MS);
});
