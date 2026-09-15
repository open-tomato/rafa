/**
 * Four readings of the preflight stage, each beside the passing control
 * that proves the fixture could have failed it.
 *
 * The first two run the real CLI: `loop start` is spawned in a scratch
 * repository under a stand-in `claude`, exactly as `task-report.test.ts`
 * and `loop-output.test.ts` do, with `.rafa/config.yaml` naming the
 * prerequisite the case is about. Every path a spawned run reads sits
 * under this file's own temporary directory; no case reads the real
 * home. `start/preflight.test.ts` and `src/preflight/run.test.ts` already
 * drive every seam of `runStartPreflight` and `runPreflight` directly;
 * what is new here is the join those files leave to a comment: that a
 * failed required item really stops `loop start` before the stand-in is
 * ever called, that `rafa effort report` really reads the rows a halted
 * run left behind, and that a failed optional item's `known-missing:`
 * line really reaches the bytes a session receives on stdin.
 *
 * The third cannot run through the CLI at all: `loop start` exposes no
 * flag for the probe timeout, and the default is 30 seconds, which no
 * case here spends. So it drives `runStartPreflight` directly, the
 * module `loop start` calls, with the timeout shortened through its own
 * seam, over a probe built the way `preflight/run.test.ts` builds one
 * that waits for input it will never get: a login prompt, a read of
 * `/dev/tty`, then a sleep, so the case reads a real failure and not a
 * `cat` answering the closed stdin's end-of-file at once.
 *
 * The fourth drives `forkWorktree` (`preflight/fork.ts`) directly, since
 * phase 1 forks no worktree and so no case can reach it through the CLI.
 * A required item's probe stands in for the fork's first task: its own
 * `bun.lock` is committed, a stand-in `bun` logs every call, and the
 * probe logs the directory it ran in, so the append order of one log
 * file is the order the fork ran them in.
 */
import type { PrerequisiteItem } from '../config.js';
import type { PrerequisiteSettings } from '../preflight/prerequisites-md.js';
import type { PreflightTiers } from '../preflight/run.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { forkWorktree } from '../preflight/fork.js';
import { KNOWN_MISSING_SENTENCE, runStartPreflight } from '../start/preflight.js';

import { plantProjectConfig } from './cli-capture.js';
import { sinkOutput } from './output-sinks.js';

/** The CLI entry every spawned case runs. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long a spawned run may take before it is killed. */
const KILL_AFTER_MS = 45_000;

/** How long a case driving one spawned run may take, over the kill above. */
const RUN_TIMEOUT = { timeout: 60_000 };

/** git's own directory, resolved once and appended to every scratch PATH beside a stand-in. */
const GIT_DIR = (() => {
  const found = Bun.which('git');
  if (found === null) throw new Error('git is not on the PATH this suite runs under');
  return dirname(found);
})();

/** Runs git for a fixture's own setup, inheriting this process's environment. */
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/**
 * ## The two `loop start` scenarios
 *
 * Each plants a scratch repository on its own feature branch, holding a
 * plan of one task, with a stand-in `claude` that numbers its calls from
 * 1, keeps the full prompt of each on stdin, and answers with no
 * `rafa:report` block, so a case reads exactly what the loop sent and
 * nothing about how the loop reads a report.
 */
const cliRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-preflight-halts-cli-')));

afterAll(() => {
  rmSync(cliRoot, { recursive: true, force: true });
});

let cliPlanted = 0;

/** One scratch repository a `loop start` or `effort report` case runs in. */
interface CliScratch {
  readonly repo: string;
  readonly home: string;
  readonly path: string;
  readonly claude: string;
  /** Outside the repository: where the stand-in keeps its call count and every captured prompt. */
  readonly calls: string;
}

/**
 * Plants a scratch repository on `branch`, its `.rafa/config.yaml`
 * holding `config` beside a plan of one `task`; see the module note.
 */
function plantCliScratch(config: readonly string[], task: string, branch: string): CliScratch {
  cliPlanted += 1;
  const root = join(cliRoot, `run-${cliPlanted}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const calls = join(root, 'calls');
  for (const dir of [repo, bin, home, calls]) mkdirSync(dir, { recursive: true });

  const claude = join(bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    '/bin/cat > "$calls/$n.prompt"',
    'echo "Done, and nothing to report."',
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  git(repo, 'init', '-q', '.');
  git(repo, 'config', 'user.email', 'loop@example.test');
  git(repo, 'config', 'user.name', 'Rafa Loop');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, 'checkout', '-q', '-b', branch);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', 'PLAN-halts.md'), `# Plan: halts\n\n- [ ] ${task}\n`, 'utf8');
  plantProjectConfig(repo, [...config, ''].join('\n'));

  return { repo, home, claude, calls, path: [bin, GIT_DIR].join(delimiter) };
}

/** Throws unless `claude` resolves to the scratch's own stand-in, so no case can reach a real session. */
function assertStandIn(scratch: CliScratch): void {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
}

/** What one spawned run wrote, and how it ended. */
interface SpawnRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `rafa loop start` in `scratch`, over its own PATH and HOME alone. */
function runLoopStart(scratch: CliScratch, flags: readonly string[]): SpawnRun {
  assertStandIn(scratch);
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, 'loop', 'start', ...flags], {
    cwd: scratch.repo,
    env: { PATH: scratch.path, HOME: scratch.home },
    timeout: KILL_AFTER_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** Runs `rafa effort report` in `scratch`, over the same PATH and HOME. */
function runEffortReport(scratch: CliScratch): SpawnRun {
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, 'effort', 'report'], {
    cwd: scratch.repo,
    env: { PATH: scratch.path, HOME: scratch.home },
    timeout: KILL_AFTER_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** The path of one file the stand-in wrote outside the repository. */
function callsFile(scratch: CliScratch, name: string): string {
  return join(scratch.calls, name);
}

/** The flag naming the plan every scratch repository plants. */
const PLAN_FLAG = '--plan=.plans/PLAN-halts.md';

describe('a required prerequisite probe that fails', () => {
  const TASK = 'A task nothing should run for it';
  const FAILING_PROBE = 'echo "sh: needed: not found" >&2; exit 127';

  /** Config lines naming one required tool, checked by `probe`. */
  function config(probe: string): string[] {
    return ['prerequisites:', '  required:', '    - tool: needed', `      probe: '${probe}'`];
  }

  it(
    'halts loop start before any session, its rows stored, and the halt listed by `rafa effort report`,'
      + ' beside a control whose session runs and whose report lists no halt',
    () => {
      const failing = plantCliScratch(config(FAILING_PROBE), TASK, 'feat/required-fail');
      const passing = plantCliScratch(config('exit 0'), TASK, 'feat/required-pass');

      const failedStart = runLoopStart(failing, [PLAN_FLAG, '--no-ci-wait']);
      const passedStart = runLoopStart(passing, [PLAN_FLAG, '--no-ci-wait']);

      expect(failedStart.exitCode).toBe(1);
      // The preflight prints before it halts, so stdout is not empty; what
      // it never carries is any sign a task session ran.
      expect(failedStart.stdout).not.toContain('Executing task');
      expect(failedStart.stderr).toContain('❌ preflight halted: 1 required item failed');
      expect(failedStart.stderr).toContain(`tool "needed": probe \`${FAILING_PROBE}\` exited 127: sh: needed: not found`);
      expect(failedStart.stderr).toContain('and `rafa effort report` lists the halt.');
      // No session was spawned: the stand-in never ran, so it never wrote a call count.
      expect(existsSync(callsFile(failing, 'count'))).toBe(false);

      // The control: the same plant, its probe passing, does spawn a session (and the wrap-up's).
      expect(passedStart.exitCode).toBe(0);
      expect(existsSync(callsFile(passing, 'count'))).toBe(true);

      const failedReport = runEffortReport(failing);
      const passedReport = runEffortReport(passing);

      expect(failedReport.exitCode).toBe(0);
      expect(failedReport.stderr).toBe('');
      expect(failedReport.stdout).toContain('preflight halts: 1 run, by run and failed required item');
      expect(failedReport.stdout).toContain('tool "needed"');

      // The control's preflight passed, so its rows are stored but list no halt.
      expect(passedReport.exitCode).toBe(0);
      expect(passedReport.stdout).not.toContain('preflight halts:');
    },
    RUN_TIMEOUT,
  );
});

describe('an optional prerequisite probe that fails', () => {
  const TASK = 'A task whose prompt is captured';
  const FAILING_PROBE = 'echo "mgrep: login required" >&2; exit 3';
  const REASON = 'faster search; grep is the fallback';

  /** Config lines naming one optional tool, checked by `probe`, giving a reason. */
  function config(probe: string): string[] {
    return [
      'prerequisites:',
      '  optional:',
      '    - tool: mgrep',
      `      probe: '${probe}'`,
      `      reason: "${REASON}"`,
    ];
  }

  it(
    'closes the captured task prompt with its known-missing line and the sentence,'
      + ' beside a control prompt carrying neither',
    () => {
      const failing = plantCliScratch(config(FAILING_PROBE), TASK, 'feat/optional-fail');
      const passing = plantCliScratch(config('exit 0'), TASK, 'feat/optional-pass');

      const failedStart = runLoopStart(failing, [PLAN_FLAG, '--no-ci-wait']);
      const passedStart = runLoopStart(passing, [PLAN_FLAG, '--no-ci-wait']);

      expect(failedStart.exitCode).toBe(0);
      expect(passedStart.exitCode).toBe(0);

      const failedPrompt = readFileSync(callsFile(failing, '1.prompt'), 'utf8');
      const passedPrompt = readFileSync(callsFile(passing, '1.prompt'), 'utf8');

      expect(failedPrompt).toContain(`known-missing: mgrep (${REASON})`);
      expect(failedPrompt).toContain(KNOWN_MISSING_SENTENCE);

      // The control's probe passed, so nothing is known-missing and the sentence never appears.
      expect(passedPrompt).not.toContain('known-missing:');
      expect(passedPrompt).not.toContain(KNOWN_MISSING_SENTENCE);
    },
    RUN_TIMEOUT,
  );
});

/**
 * ## The stdin-timeout scenario
 *
 * Driven through `runStartPreflight` directly, with the timeout
 * shortened through its own seam: `loop start` names no flag for it, and
 * its default is 30 seconds, which this case does not spend.
 */
const libRoot = mkdtempSync(join(tmpdir(), 'rafa-preflight-halts-lib-'));

afterAll(() => {
  rmSync(libRoot, { recursive: true, force: true });
});

let libRooted = 0;

/** A fresh repo root under this file's own scratch, holding `.plans/`. */
function freshLibRoot(): string {
  libRooted += 1;
  const root = join(libRoot, `root-${libRooted}`);
  mkdirSync(join(root, '.plans'), { recursive: true });
  return root;
}

/** The plan path a driven run's `PREREQUISITES-<stub>.md` would sit beside; need not exist. */
function libPlanPath(root: string): string {
  return join(root, '.plans', 'PLAN-lib.md');
}

/** One required tool item whose probe is `probe`. */
function requiredItem(probe: string): PrerequisiteItem {
  return Object.freeze({ kind: 'tool', name: 'mgrep', probe });
}

/** One required item and no optional ones. */
function requiredOnly(probe: string): PrerequisiteSettings {
  return { prerequisitesRequired: [requiredItem(probe)], prerequisitesOptional: [] };
}

/** Enough PATH for the probe's `sleep` to resolve; nothing carried over from this process. */
const PROBE_ENV = { PATH: ['/usr/bin', '/bin'].join(delimiter) };

describe('a required probe waiting on stdin', () => {
  /**
   * Echoes a login prompt, tries to read a code from the terminal, then
   * sleeps: with stdin closed the read answers at once, so the `sleep`
   * is what actually holds the probe past its timeout, as a login flow
   * that never gets its input does.
   */
  const WAITING_PROBE = 'echo "mgrep: enter your login code" >&2; read -r code < /dev/tty; sleep 5';

  /** Far under the runner's 30-second default, so this case never waits anywhere near it. */
  const SHORT_TIMEOUT_MS = 300;

  it(
    'halts within its own short timeout rather than the runner\'s 30s default, beside a control that passes at once',
    async () => {
      const failingRoot = freshLibRoot();
      const passingRoot = freshLibRoot();

      setActiveOutput(sinkOutput({}));
      let refusal: CommandExit | null = null;
      const failStarted = Date.now();
      try {
        await runStartPreflight({
          repoRoot: failingRoot,
          planPath: libPlanPath(failingRoot),
          settings: requiredOnly(WAITING_PROBE),
          checks: { timeoutMs: SHORT_TIMEOUT_MS, env: PROBE_ENV },
        });
      } catch (error) {
        if (!(error instanceof CommandExit)) throw error;
        refusal = error;
      }
      const failElapsed = Date.now() - failStarted;

      const passStarted = Date.now();
      const passed = await runStartPreflight({
        repoRoot: passingRoot,
        planPath: libPlanPath(passingRoot),
        settings: requiredOnly('exit 0'),
        checks: { timeoutMs: SHORT_TIMEOUT_MS, env: PROBE_ENV },
      });
      const passElapsed = Date.now() - passStarted;
      setActiveOutput(null);

      expect(refusal).not.toBeNull();
      expect(refusal?.exitCode).toBe(1);
      expect(refusal?.message).toContain(`timed out after ${SHORT_TIMEOUT_MS / 1000}s and was killed (exit 137)`);
      expect(failElapsed).toBeGreaterThanOrEqual(SHORT_TIMEOUT_MS - 100);
      // Nowhere near the runner's own 30-second default: the seam, not the default, decided this.
      expect(failElapsed).toBeLessThan(5000);

      expect(passed.report.halt).toBeNull();
      expect(passElapsed).toBeLessThan(5000);
    },
    10_000,
  );
});

/**
 * ## The worktree fork scenario
 *
 * `forkWorktree` (`preflight/fork.ts`) is driven directly: phase 1 forks
 * no worktree, so no case can reach it through the CLI. A required
 * item's probe stands in for the fork's first task, and a stand-in `bun`
 * logs every call it gets, both into the same log file, so its append
 * order is the order the fork ran them in.
 */
const forkRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-preflight-halts-fork-')));

afterAll(() => {
  rmSync(forkRoot, { recursive: true, force: true });
});

let forkPlanted = 0;

/** A git repository at `<base>/repo`, `files` committed on `main`. */
function forkRepoWith(base: string, files: Readonly<Record<string, string>>): string {
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'fork@example.test');
  git(repo, 'config', 'user.name', 'Rafa Fork');
  for (const [name, content] of Object.entries(files)) writeFileSync(join(repo, name), content, 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'fixture');
  return repo;
}

/** Plants a stand-in `bun` in `bin` that appends its words and directory to `log`. */
function plantForkBun(bin: string, log: string): void {
  const path = join(bin, 'bun');
  writeFileSync(path, [
    '#!/bin/sh',
    `echo "bun $* in $(pwd)" >> '${log}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(path, 0o755);
}

/** A required item standing in for the fork's first task: it logs where it ran, then passes. */
function firstTaskItem(log: string): PrerequisiteItem {
  return Object.freeze({ kind: 'tool', name: 'first-task', probe: `echo "first task in $(pwd)" >> '${log}'; exit 0` });
}

/** The two tiers a fork checks: one required item standing in for the first task, nothing optional. */
function forkTiers(required: PrerequisiteItem): PreflightTiers {
  return Object.freeze({ required: [required], optional: [] });
}

/** Every non-blank line of `log`, in append order; empty when nothing was ever written. */
function forkLogLines(log: string): string[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

/** What one fork case plants beyond the repository. */
interface ForkCase {
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;
  readonly log: string;
  readonly worktree: string;
}

/** Plants one fork case's repository, its stand-in `bun` and its environment. */
function plantForkCase(files: Readonly<Record<string, string>>): ForkCase {
  forkPlanted += 1;
  const base = join(forkRoot, `case-${forkPlanted}`);
  const bin = join(base, 'bin');
  const home = join(base, 'home');
  const log = join(base, 'fork.log');
  const worktree = join(base, 'worktree');
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  plantForkBun(bin, log);
  const root = forkRepoWith(base, files);
  return { root, env: { HOME: home, PATH: [bin, GIT_DIR].join(delimiter) }, log, worktree };
}

describe('a worktree fork\'s install', () => {
  it(
    'runs before the probe standing in for the fork\'s first task, beside a control root with no'
      + ' lockfile that skips the install and runs the probe straight away',
    async () => {
      const withLock = plantForkCase({ 'package.json': '{}\n', 'bun.lock': '{}\n' });
      const withLockResult = await forkWorktree({
        root: withLock.root,
        path: withLock.worktree,
        branch: 'fork/first-task',
        items: forkTiers(firstTaskItem(withLock.log)),
        env: withLock.env,
        checks: { warn: () => undefined, timeoutMs: 5000 },
      });

      expect(withLockResult.halt).toBeNull();
      expect(withLockResult.install).toBe('passed');
      expect(forkLogLines(withLock.log)).toEqual([
        `bun install --frozen-lockfile in ${withLock.worktree}`,
        `first task in ${withLock.worktree}`,
      ]);

      // The control: the same shape of fork, its root holding no bun.lock,
      // so the install is skipped and the probe alone reaches the log.
      const noLock = plantForkCase({ 'package.json': '{}\n' });
      const noLockResult = await forkWorktree({
        root: noLock.root,
        path: noLock.worktree,
        branch: 'fork/first-task',
        items: forkTiers(firstTaskItem(noLock.log)),
        env: noLock.env,
        checks: { warn: () => undefined, timeoutMs: 5000 },
      });

      expect(noLockResult.halt).toBeNull();
      expect(noLockResult.install).toBe('skipped');
      expect(forkLogLines(noLock.log)).toEqual([`first task in ${noLock.worktree}`]);
    },
    RUN_TIMEOUT,
  );
});
