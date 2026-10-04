/**
 * `rafa loop start` spawned end to end, over a real `bun test`, proving
 * the pre-wrap-up step's repair (`./suite-blocker.ts`'s `writeRepairTask`
 * of kind `pre-wrap-up`, wired in `./suite-steps-run.ts`, the loop turned
 * back in `../start.ts`).
 *
 * The scratch repository's test file, `shared.test.ts`, imports nothing
 * and reads `shared-data.json` off disk with `readFileSync`, so Bun's
 * `--changed` graph never selects it from a change to that JSON file. The
 * plan's one task flips the JSON's `flag`, breaking that test, and
 * answers `status: done` with no blocker: its own task step,
 * `bun test --changed=<base>`, selects no test file and stays green. The
 * baseline, a full run at the seed commit, is green, so the breakage is
 * new when the pre-wrap-up step, the full suite, meets it with no task
 * left open. Both cases run that same start; they differ in what the
 * repair session does.
 *
 * Case one: the repair session restores the flag. The red pre-wrap-up
 * step has inserted a `[BLOCKED]` repair task after the checklist's last
 * task and the loop turned back to dispatch it in the same run, under
 * `build-error-resolver`, handed the blocker through
 * `BLOCKER_PROMPT_PREFIX` (`./dispatch.ts`). The repair is committed and
 * ticked, the pre-wrap-up step runs again and is green, and the wrap-up
 * session starts: one run, three stand-in calls, and a record of five
 * steps, the second pre-wrap-up step with no new failure.
 *
 * Case two: the repair session leaves the flag as it is. The second
 * pre-wrap-up step is red again, finds the ticked pre-wrap-up repair on
 * the tracker, writes its blocker on that line instead of inserting
 * another, reopened as `[BLOCKED]` with its text and commit kept, and the
 * run halts before the wrap-up: two stand-in calls only. A second run
 * dispatches that same repair first, handed the blocker the second red
 * wrote, and halts on a red pre-wrap-up step once more, still holding
 * the one repair line.
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
import { findNextTask } from '../utils/tracker.js';

import { BLOCKER_PROMPT_PREFIX } from './dispatch.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the shell script template below. */
const FENCE = '```';

/** How long one `loop start` run may take before it is killed. */
const RUN_TIMEOUT_MS = 90_000;

/** This file's own test timeout: up to two spawned runs, each running real `bun test`. */
const CASE_TIMEOUT_MS = 180_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'suite-step-pre-wrap-up-repair';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The plan's only task: breaks `shared.test.ts` outside its own `--changed` selection. */
const TASK = 'Flip the shared flag, outside this task\'s own diff selection';

/** The plan: one stage of one task, so the pre-wrap-up step stands in for the stage's own. */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  '# Stage: flips the flag',
  '',
  `- [ ] ${TASK}`,
  '',
].join('\n');

/** The JSON file `shared.test.ts` reads by `readFileSync`, never by `import`. */
const DATA_FILE = 'shared-data.json';

/** The test file the task's change breaks, outside Bun's `--changed` import graph. */
const TEST_FILE = 'shared.test.ts';

/** A tracked file a session can change without touching anything a test reads. */
const NOTES_FILE = 'notes.txt';

/** `shared.test.ts`'s source: reads {@link DATA_FILE} off disk, imports no local file. */
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

/** The project config: `pr.provider: none`, so the wrap-up's push needs no remote and no `gh`. */
const CONFIG = 'pr:\n  provider: none\n';

/** The repair task's line, a pre-wrap-up step's, in any checkbox, with the blocker comment it may carry. */
const REPAIR_LINE = /^- \[(?: |x|BLOCKED)\] Repair the red pre-wrap-up step at commit [0-9a-f]{12} {2}\{agent=build-error-resolver\}(?: {2}<!-- blocked: .* -->)?$/gm;

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

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-suite-step-pre-wrap-up-repair-')));
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
function reportLines(feedback: string): readonly string[] {
  return [
    `${feedback}.`,
    '',
    `${FENCE}rafa:report`,
    'status: done',
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
 * whole prompt outside the repository, then answers by call number. Call
 * 1, the task, flips {@link DATA_FILE}'s flag as a tracked change,
 * breaking {@link TEST_FILE} outside its own `--changed` selection. Call
 * 2, the pre-wrap-up repair, restores the flag when `repairFixes` and
 * otherwise only appends to {@link NOTES_FILE}, as does every later call
 * but the wrap-up's own, which writes nothing.
 */
function standInScript(calls: string, repairFixes: boolean): string {
  const repair = repairFixes
    ? `printf '%s\\n' '{"flag": true}' > ${DATA_FILE}`
    : `printf '%s\\n' 'tried' >> ${NOTES_FILE}`;
  const later = repairFixes
    ? ['else', ...printLines(reportLines('wrap-up: nothing left to preserve'))]
    : ['else', `  printf '%s\\n' 'tried again' >> ${NOTES_FILE}`, ...printLines(reportLines('tried again'))];
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
    ...printLines(reportLines('flipped shared-data.json; the tests it reaches by --changed stay green')),
    'elif [ "$n" -eq 2 ]; then',
    `  ${repair}`,
    ...printLines(reportLines(repairFixes
      ? 'restored the flag'
      : 'tried a repair that leaves the flag as it is')),
    ...later,
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
function plant(repairFixes: boolean): Scratch {
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
  writeFileSync(claude, standInScript(calls, repairFixes), 'utf8');
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
  writeFileSync(join(repo, NOTES_FILE), 'seed\n', 'utf8');
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

/** The whole prompt the stand-in's `n`th call was given. */
function promptOf(scratch: Scratch, n: number): string {
  return readFileSync(join(scratch.calls, `${n}.prompt`), 'utf8');
}

/** The tracker as it stands. */
function trackerOf(scratch: Scratch): string {
  return readFileSync(join(scratch.repo, '.plans', TRACKER_NAME), 'utf8');
}

/** The kinds of the steps the run recorded, oldest first. */
function stepKinds(scratch: Scratch): readonly string[] {
  const [record] = readSessions(scratch.repo);
  return (record?.steps ?? []).map((step) => step.kind);
}

describe('a pre-wrap-up step red on a task\'s breakage outside its --changed selection', () => {
  it('inserts a repair, dispatches it in the same run, and starts the wrap-up once the step is green again', () => {
    const scratch = plant(true);
    const run = runLoopStart(scratch);

    expect(run.exitCode).toBe(0);
    // The task, the pre-wrap-up repair, and the wrap-up's own session.
    expect(callCount(scratch)).toBe(3);

    const tracker = trackerOf(scratch);
    expect(tracker).toContain(`- [x] ${TASK}`);
    expect(tracker).not.toContain('[BLOCKED]');
    const repairLines = tracker.match(REPAIR_LINE) ?? [];
    expect(repairLines).toHaveLength(1);
    expect(repairLines[0]).toStartWith('- [x] ');

    // The repair is handed the blocker the red step wrote, under its declared agent.
    const repairPrompt = promptOf(scratch, 2);
    expect(repairPrompt).toContain(BLOCKER_PROMPT_PREFIX);
    expect(repairPrompt).toContain(`Run bun test ./${TEST_FILE} `);
    expect(readFileSync(join(scratch.calls, '2.args'), 'utf8')).toContain('--agent\nbuild-error-resolver\n');
    // The wrap-up's prompt carries no blocker: the step was green when it started.
    expect(promptOf(scratch, 3)).not.toContain(BLOCKER_PROMPT_PREFIX);

    const [record] = readSessions(scratch.repo);
    const steps = record?.steps ?? [];
    expect(steps.map((step) => step.kind)).toEqual(['baseline', 'task', 'pre-wrap-up', 'task', 'pre-wrap-up']);
    const [, , firstRed, , secondGreen] = steps;
    expect(firstRed?.scope).toBe('full');
    expect(firstRed?.newFailures.map((failure) => failure.file)).toEqual([TEST_FILE]);
    expect(secondGreen?.scope).toBe('full');
    expect(secondGreen?.newFailures).toEqual([]);
    expect(run.stdout).toContain('Dispatching that repair task now');
  }, CASE_TIMEOUT_MS);

  it('writes the second red\'s blocker on the repair\'s own line and halts before the wrap-up', () => {
    const scratch = plant(false);

    // Run 1: the task, then the pre-wrap-up repair, which leaves the flag
    // as it is. The step runs a second time, red again, and blocks the
    // ticked repair rather than inserting another.
    const run1 = runLoopStart(scratch);
    expect(run1.exitCode).toBe(0);
    expect(callCount(scratch)).toBe(2);
    expect(run1.stdout + run1.stderr).toContain('the pre-wrap-up step is red again after its repair');

    const trackerAfterRun1 = trackerOf(scratch);
    expect(trackerAfterRun1).toContain(`- [x] ${TASK}`);
    const repairLines = trackerAfterRun1.match(REPAIR_LINE) ?? [];
    expect(repairLines).toHaveLength(1);
    expect(repairLines[0]).toStartWith('- [BLOCKED] ');

    const blockedTask = findNextTask(trackerAfterRun1);
    expect(blockedTask?.status).toBe('blocked');
    expect(blockedTask?.task).toMatch(/^Repair the red pre-wrap-up step at commit [0-9a-f]{12} {2}\{agent=build-error-resolver\}$/);
    expect(blockedTask?.blocker).toContain(`Run bun test ./${TEST_FILE} `);
    expect(blockedTask?.blocker).toContain('pre-wrap-up step');
    expect(stepKinds(scratch)).toEqual(['baseline', 'task', 'pre-wrap-up', 'task', 'pre-wrap-up']);

    // Run 2: the blocked repair is dispatched first, handed the blocker
    // the second red wrote, and the step is red a third time: the same
    // line is blocked again and the tracker still holds one repair.
    const run2 = runLoopStart(scratch);
    expect(run2.exitCode).toBe(0);
    expect(callCount(scratch)).toBe(3);

    const retryPrompt = promptOf(scratch, 3);
    expect(retryPrompt).toContain(BLOCKER_PROMPT_PREFIX);
    expect(retryPrompt).toContain(blockedTask?.blocker ?? '');
    expect(readFileSync(join(scratch.calls, '3.args'), 'utf8')).toContain('--agent\nbuild-error-resolver\n');

    const trackerAfterRun2 = trackerOf(scratch);
    const repairsAfterRun2 = trackerAfterRun2.match(REPAIR_LINE) ?? [];
    expect(repairsAfterRun2).toHaveLength(1);
    expect(repairsAfterRun2[0]).toStartWith('- [BLOCKED] ');
  }, CASE_TIMEOUT_MS);
});
