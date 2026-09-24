/**
 * The agent-roster preflight, read end to end over one scratch project
 * and one scratch home: a planted tracker naming an agent the project
 * does not carry halts `loop start` before any session, `rafa plan
 * validate` refuses the same plan for the same reason, `rafa agent
 * vendor` copies the home's definition into the project once and
 * refuses a second copy without `--force`, and the same `loop start`,
 * run again on the same branch, then passes and reaches its stand-in
 * `claude`.
 *
 * `agents/roster.test.ts`, `start/preflight.test.ts`,
 * `commands/plan/validate.test.ts` and `commands/agent/vendor.test.ts`
 * already drive every seam of the four pieces on their own. What is new
 * here is the join between them, read as one operator would meet it: the
 * fix command a halt names is the command that actually clears it, over
 * the CLI those four suites exercise apart.
 *
 * The story runs over one scratch git repository and one scratch home,
 * mutated in place across its steps as an operator's own checkout would
 * be, never removed until every step has run:
 *
 *   1. `loop start` halts on the tracker's `agent=refactor-cleaner`, which
 *      only the home holds, naming the user tier and the vendor command,
 *      before any session, and the project is left exactly as planted.
 *   2. `rafa plan validate` on the plan file names the same agent and the
 *      same fix, and starts no session either.
 *   3. `rafa agent vendor refactor-cleaner` copies the home's definition in.
 *   4. The same vendor call, run again with no `--force`, is refused: the
 *      file it would overwrite is already there.
 *   5. `loop start`, run again on the same branch, now resolves the name
 *      and reaches its stand-in `claude`.
 *
 * No case here spawns the real `claude`: a stand-in sits first on the
 * PATH, logging one file per call, so "dispatching nothing" and
 * "reaches its stand-in `claude`" are read off that log rather than
 * inferred from an exit code alone.
 */
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

import { plantProjectConfig } from './cli-capture.js';

/** The CLI entry every spawned case runs. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long a spawned run may take before it is killed. */
const KILL_AFTER_MS = 45_000;

/** How long the one case in this file may take, over the kill above. */
const RUN_TIMEOUT = { timeout: 60_000 };

/** git's own directory, appended to the scratch PATH beside the stand-in. */
const GIT_DIR = (() => {
  const found = Bun.which('git');
  if (found === null) throw new Error('git is not on the PATH this suite runs under');
  return dirname(found);
})();

/** Runs git for the fixture's own setup, inheriting this process's environment. */
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/**
 * The plan's stub, and the agent its one task names: a user-level agent
 * rafa's own tier does not ship. The spawned CLI is this checkout's
 * `src/rafa.ts`, whose rafa tier is `src/bundled/agents`, so a name that
 * tier carries, `tdd-guide` among them, resolves without any copy and
 * would halt nothing.
 */
const STUB = 'agent-roster-preflight';
const AGENT = 'refactor-cleaner';

/** The task line every planting of the plan and the tracker shares. */
const TASK_LINE = `- [ ] Write the tests  {agent=${AGENT}}`;

/** The plan text: one open task naming an agent the project starts without. */
const PLAN_TEXT = `# Plan: ${STUB}\n\n${TASK_LINE}\n`;

/** The flag naming the plan every run in this file uses. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The scratch directory this whole file plants under, removed once every case has run. */
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-agent-roster-preflight-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** One scratch repository, its home, and the stand-in `claude`'s call log. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly calls: string;
  /** The stand-in `claude` this file planted; nothing else may resolve under this name. */
  readonly claude: string;
  readonly path: string;
  /** The plan file relative to `repo`, as a line would type it. */
  readonly planFile: string;
}

/**
 * Plants one scratch repository on its own feature branch, holding the
 * plan AND an already-existing tracker of the same one task (so `loop
 * start` resumes it rather than creating it fresh), beside a scratch
 * home whose `~/.claude/agents` carries the agent the project does not.
 */
function plantScratch(): Scratch {
  const repo = join(tempRoot, 'repo');
  const bin = join(tempRoot, 'bin');
  const home = join(tempRoot, 'home');
  const calls = join(tempRoot, 'calls');
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
  git(repo, 'checkout', '-q', '-b', `feat/${STUB}`);

  mkdirSync(join(repo, '.plans'), { recursive: true });
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN_TEXT, 'utf8');
  // Planted directly, rather than left for `loop start` to create, so the
  // preflight's tracker-first read (`agents/roster.ts`'s `agentSourcePath`)
  // is what this case exercises.
  writeFileSync(join(repo, '.plans', `PLAN_TRACKER-${STUB}.md`), PLAN_TEXT, 'utf8');
  plantProjectConfig(repo);

  const agentsDir = join(home, '.claude', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, `${AGENT}.md`), `---\nname: ${AGENT}\n---\nThe agent body.\n`, 'utf8');

  return {
    repo,
    home,
    calls,
    claude,
    path: [bin, GIT_DIR].join(delimiter),
    planFile: `.plans/PLAN-${STUB}.md`,
  };
}

/** Throws unless `claude` resolves to the scratch's own stand-in, so no case can reach a real session. */
function assertStandIn(scratch: Scratch): void {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
}

/** What one spawned `rafa` call wrote, and how it ended. */
interface SpawnRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawns `rafa <words>` in the scratch repository, over its own PATH and HOME alone. */
function runRafa(scratch: Scratch, words: readonly string[]): SpawnRun {
  assertStandIn(scratch);
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, ...words], {
    cwd: scratch.repo,
    env: { PATH: scratch.path, HOME: scratch.home },
    timeout: KILL_AFTER_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** The stand-in's call count, or null before it has ever been called. */
function callCount(scratch: Scratch): string | null {
  const path = join(scratch.calls, 'count');
  return existsSync(path)
    ? readFileSync(path, 'utf8').trim()
    : null;
}

/**
 * What `missingAgentLine` words after the lines for {@link AGENT}, which
 * only the scratch home holds: the user tier's file, the sources that
 * leave it out, and the vendor command the story then runs.
 */
function homeOnly(scratch: Scratch): string {
  return `cannot be dispatched: agent ${AGENT} is held only by the user tier`
    + ` (${join(scratch.home, '.claude', 'agents', `${AGENT}.md`)}),`
    + ' which loop.settingSources (project, local) leaves out:'
    + ` add user to loop.settingSources, or run \`rafa agent vendor ${AGENT}\``;
}

/** `<repo>/.claude/agents/<AGENT>.md`, whether or not it exists yet. */
function vendoredAgentFile(scratch: Scratch): string {
  return join(scratch.repo, '.claude', 'agents', `${AGENT}.md`);
}

/**
 * The agent every case below names; no scratch home in this file
 * defines it under any name, so it never resolves.
 */
const FENCE_AGENT = 'agent-roster-fence-ghost';

/** What `missingAgentLine` words after the lines for {@link FENCE_AGENT}, which no tier holds. */
const FENCE_AGENT_UNHELD = `cannot be dispatched: agent ${FENCE_AGENT} is held by no tier:`
  + ' no project, rafa or user definition carries it, and it is no built-in agent';

/** The stub, and the task line, of the never-closed-fence case. */
const UNCLOSED_STUB = 'agent-roster-unclosed-context';
const UNCLOSED_TASK_LINE = `- [ ] Write the tests  {agent=${FENCE_AGENT}}`;

/**
 * A plan whose `rafa:context` fence is never closed, with the task line
 * that names {@link FENCE_AGENT} sitting after it, at line 6: `parsePlan`
 * reads that line as the never-closed block's body (`plan/parse.ts`'s
 * "Where the two readers disagree" note) and does not carry it into
 * {@link import('../plan/parse.js').PlanModel.tasks}, while `findNextTask`
 * dispatches it regardless.
 */
const UNCLOSED_PLAN_TEXT = [
  `# Plan: ${UNCLOSED_STUB}`,
  '',
  '```rafa:context',
  'Context prose the fence never closes.',
  '',
  UNCLOSED_TASK_LINE,
  '',
].join('\n');

/** The stub, and the task line, of the closed-fence control. */
const CLOSED_STUB = 'agent-roster-closed-context';
const CLOSED_TASK_LINE = `- [ ] Write the tests  {agent=${FENCE_AGENT}}`;

/**
 * The control: the same `rafa:context` block, closed, with the same task
 * line sitting after it, at line 7, outside every block and therefore
 * read as an ordinary open task today.
 */
const CLOSED_PLAN_TEXT = [
  `# Plan: ${CLOSED_STUB}`,
  '',
  '```rafa:context',
  'Context prose that closes normally.',
  '```',
  '',
  CLOSED_TASK_LINE,
  '',
].join('\n');

/**
 * Plants one scratch repository holding `planText` as its only plan, no
 * tracker (so the preflight's tracker-first read falls back to the plan
 * itself) and a scratch home defining no agent at all, so
 * {@link FENCE_AGENT} resolves under no loaded scope.
 */
function plantFenceScratch(stub: string, planText: string): Scratch {
  const repo = join(tempRoot, `repo-${stub}`);
  const bin = join(tempRoot, `bin-${stub}`);
  const home = join(tempRoot, `home-${stub}`);
  const calls = join(tempRoot, `calls-${stub}`);
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
  git(repo, 'checkout', '-q', '-b', `feat/${stub}`);

  mkdirSync(join(repo, '.plans'), { recursive: true });
  writeFileSync(join(repo, '.plans', `PLAN-${stub}.md`), planText, 'utf8');
  plantProjectConfig(repo);

  return {
    repo,
    home,
    calls,
    claude,
    path: [bin, GIT_DIR].join(delimiter),
    planFile: `.plans/PLAN-${stub}.md`,
  };
}

describe('the agent roster preflight, over a plan naming an unresolvable agent behind a rafa:* fence', () => {
  it('refuses loop start before dispatching for the closed-fence control, today', () => {
    const scratch = plantFenceScratch(CLOSED_STUB, CLOSED_PLAN_TEXT);

    const start = runRafa(scratch, ['loop', 'start', `--plan=${scratch.planFile}`, '--no-ci-wait']);

    expect(start.exitCode).toBe(1);
    expect(start.stderr).toContain(
      `❌ Refusing to start: PLAN-${CLOSED_STUB}.md names 1 agent(s) no loaded tier serves`,
    );
    expect(start.stderr).toContain(`agent "${FENCE_AGENT}" (line 7) ${FENCE_AGENT_UNHELD}`);
    expect(start.stderr).toContain('Nothing was checked and nothing was dispatched.');
    expect(callCount(scratch)).toBeNull();
  });

  it('refuses loop start before dispatching when the naming task line sits after a fence never closed', () => {
    const scratch = plantFenceScratch(UNCLOSED_STUB, UNCLOSED_PLAN_TEXT);

    const start = runRafa(scratch, ['loop', 'start', `--plan=${scratch.planFile}`, '--no-ci-wait']);

    expect(start.exitCode).toBe(1);
    expect(start.stderr).toContain(
      `❌ Refusing to start: PLAN-${UNCLOSED_STUB}.md names 1 agent(s) no loaded tier serves`,
    );
    expect(start.stderr).toContain(`agent "${FENCE_AGENT}" (line 6) ${FENCE_AGENT_UNHELD}`);
    expect(start.stderr).toContain('Nothing was checked and nothing was dispatched.');
    expect(callCount(scratch)).toBeNull();
  });
});

describe('the agent roster preflight, end to end over one scratch project and home', () => {
  it(
    'halts loop start naming the agent and dispatching nothing, fails plan validate the same way,'
      + ' refuses a second vendor without --force, then lets the same loop start through and dispatch',
    () => {
      const scratch = plantScratch();

      // 1. A planted tracker naming an agent only the home holds halts
      // the preflight, naming that agent, its tier and the vendor
      // command, before any session.
      const firstStart = runRafa(scratch, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);

      expect(firstStart.exitCode).toBe(1);
      expect(firstStart.stderr).toContain(
        `❌ Refusing to start: PLAN_TRACKER-${STUB}.md names 1 agent(s) no loaded tier serves`,
      );
      expect(firstStart.stderr).toContain(`agent "${AGENT}" (line 3) ${homeOnly(scratch)}`);
      expect(firstStart.stderr).toContain('Nothing was checked and nothing was dispatched.');
      expect(callCount(scratch)).toBeNull();
      expect(existsSync(vendoredAgentFile(scratch))).toBe(false);

      // 2. `rafa plan validate` on the same plan file names the same
      // agent and the same reason, and starts no session either.
      const validate = runRafa(scratch, ['plan', 'validate', scratch.planFile]);

      expect(validate.exitCode).toBe(1);
      expect(validate.stdout).toContain(`error: ${scratch.planFile}: agent "${AGENT}" (line 3) ${homeOnly(scratch)}`);
      expect(validate.stderr).toBe(
        `❌ ${scratch.planFile}: 1 unresolvable agent; no session would be dispatched\n`,
      );
      expect(callCount(scratch)).toBeNull();

      // 3. `rafa agent vendor` copies the home's definition in, once.
      const vendored = runRafa(scratch, ['agent', 'vendor', AGENT]);

      expect(vendored.exitCode).toBe(0);
      expect(vendored.stdout).toBe(`✅ ${AGENT}: ${vendoredAgentFile(scratch)}\n`);
      expect(existsSync(vendoredAgentFile(scratch))).toBe(true);
      const firstCopy = readFileSync(vendoredAgentFile(scratch), 'utf8');
      expect(firstCopy).toContain('<!-- vendored by rafa from');

      // 4. The same vendor call, run again with no `--force`, is
      // refused: the file it would overwrite is already there, and it
      // is left exactly as the first copy wrote it.
      const vendoredAgain = runRafa(scratch, ['agent', 'vendor', AGENT]);

      expect(vendoredAgain.exitCode).toBe(1);
      expect(vendoredAgain.stderr).toContain(
        `agent "${AGENT}": ${vendoredAgentFile(scratch)} is already there; pass --force to replace it`,
      );
      expect(vendoredAgain.stderr).toContain('Nothing was written.');
      expect(readFileSync(vendoredAgentFile(scratch), 'utf8')).toBe(firstCopy);

      // 5. The same `loop start`, run again on the same branch, now
      // resolves the name and reaches its stand-in `claude`: the halt is
      // gone, and the stand-in was actually called, for the task whose
      // agent it names (a clean exit with no `rafa:report` block still
      // ticks the task, `start/commit.ts`, so the wrap-up follows it and
      // the log ends up with two calls rather than one).
      const secondStart = runRafa(scratch, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);

      expect(secondStart.exitCode).toBe(0);
      expect(secondStart.stderr).not.toContain('Refusing to start');
      expect(secondStart.stderr).not.toContain(`agent "${AGENT}"`);
      expect(callCount(scratch)).not.toBeNull();
      expect(readFileSync(join(scratch.calls, '1.prompt'), 'utf8')).toContain('Write the tests');
    },
    RUN_TIMEOUT,
  );
});
