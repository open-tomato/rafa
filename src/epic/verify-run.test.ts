/**
 * Tests for the verification runner: the git steps it runs in order, the
 * one captured session per check, the verdict each answers, and the
 * worktree's removal whatever the sessions did. Git and Claude are
 * planted: a git runner answering from a script and recording each argv,
 * and a spawner answering from a queue and recording each spawn, so no
 * case starts Claude or reaches a remote. One case runs the same steps
 * through a real git over two repositories under `tmpdir()`, the clone's
 * `origin` a sibling directory, as the control that the planted argv are
 * ones git accepts.
 */
import type { CriterionCheck } from './verify-plan.js';
import type { CheckAnswered, CheckResult, VerifyRunOptions, VerifyRunRan } from './verify-run.js';
import type { GitResult, GitRunner } from '../pr/git.js';
import type { CapturedSession, CapturedSpawnOptions, CapturingSpawner } from '../utils/claude.js';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';
import { WORKTREES_SUBDIR } from '../pr/worktree.js';
import { SESSION_ID_FLAG } from '../start/dispatch.js';
import { claudeArgs } from '../utils/claude.js';

import { splitCriteria } from './verify-plan.js';
import {
  CHECK_PROMPT_PREFIX,
  CHECK_TOOLS,
  checkFlags,
  parseCheckVerdict,
  renderCheckPrompt,
  runVerification,
  VERDICT_BLOCK_FENCE,
  verifyWorktreePath,
} from './verify-run.js';

const HOME = '/home/tester';
const EPIC = 40;
const WORKTREE = join(HOME, '.rafa', 'worktrees', 'epic-40');
const COMMIT = '43c23d33a9e94080c769f3cf960ba3f095b3d9ab';
const SOURCES = ['project', 'local'] as const;

/** Two planned checks, one per criterion. */
const CHECKS: readonly CriterionCheck[] = splitCriteria('- roadmap lists epics\n- epics lists issues').map((criterion) => ({
  kind: 'check',
  criterion,
  check: `Run \`rafa roadmap\` and confirm criterion ${String(criterion.number)} holds.`,
}));

/** The planned check at `index`, or a failed expectation. */
function checkAt(index: number): CriterionCheck {
  const check = CHECKS[index];
  if (check === undefined) throw new Error(`no planned check at ${String(index)}`);
  return check;
}

const FIRST = checkAt(0);
const SECOND = checkAt(1);

/** `body` fenced as a check session's answer, after some prose. */
function answer(body: string, fence = VERDICT_BLOCK_FENCE): string {
  return `I ran the check.\n\n\`\`\`${fence}\n${body}\n\`\`\`\n`;
}

const PASS = answer('result: pass\nevidence: "rafa roadmap printed #40 in-progress 2/3."');
const FAIL = answer('result: fail\nevidence: "rafa roadmap printed #40 with no state."');

/** What a planted git answers for one argv, keyed on its first word. */
type GitScript = Partial<Record<string, GitResult>>;

const OK: GitResult = { ok: true, stdout: '', stderr: '' };

/** A git runner answering from `script` by the argv's first word, recording each argv. */
function plantedGit(script: GitScript = {}): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const defaults: GitScript = { 'rev-parse': { ok: true, stdout: `${COMMIT}\n`, stderr: '' } };
  const git: GitRunner = (args) => {
    calls.push([...args]);
    const key = args[0] === 'worktree'
      ? `worktree ${args[1] ?? ''}`
      : args[0] ?? '';
    return script[key] ?? defaults[key] ?? OK;
  };
  return { git, calls };
}

/** One recorded spawn. */
interface Spawned {
  readonly args: readonly string[];
  readonly prompt: string;
  readonly options: CapturedSpawnOptions | undefined;
}

/** A spawner answering `sessions` in turn, recording each spawn; `Error`s are thrown. */
function plantedSpawner(sessions: readonly (CapturedSession | Error)[]): { spawn: CapturingSpawner; spawned: Spawned[] } {
  const spawned: Spawned[] = [];
  const queue = [...sessions];
  const spawn: CapturingSpawner = async (args, prompt, options) => {
    spawned.push({ args, prompt, options });
    const next = queue.shift();
    if (next === undefined) throw new Error('the planted spawner has no session left');
    if (next instanceof Error) throw next;
    return next;
  };
  return { spawn, spawned };
}

/** Ids handed out in order: `session-1`, `session-2`, … */
function counter(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `session-${String(n)}`;
  };
}

/** The options every planted run starts from. */
function options(git: GitRunner, spawn: CapturingSpawner, extra: Partial<VerifyRunOptions> = {}): VerifyRunOptions {
  return { epic: EPIC, checks: CHECKS, settingSources: SOURCES, home: HOME, git, spawn, sessionId: counter(), ...extra };
}

/** `outcome` as a run that ran, or a failed expectation. */
function ran(outcome: Awaited<ReturnType<typeof runVerification>>): VerifyRunRan {
  if (outcome.status !== 'ran') throw new Error(`expected a run that ran, got ${outcome.status}`);
  return outcome;
}

/** `result` as an answered check, or a failed expectation. */
function answered(result: CheckResult | undefined): CheckAnswered {
  if (result?.kind !== 'answered') throw new Error(`expected an answered check, got ${result?.kind ?? 'nothing'}`);
  return result;
}

const THE_STEPS = [
  ['fetch', 'origin'],
  ['rev-parse', '--verify', 'origin/main^{commit}'],
  ['worktree', 'add', '--detach', WORKTREE, COMMIT],
  ['worktree', 'remove', '--force', WORKTREE],
];

describe('verifyWorktreePath', () => {
  it('answers <home>/.rafa/worktrees/epic-<n>, under the directory rafa cleanup lists', () => {
    expect(verifyWorktreePath(HOME, EPIC)).toBe(WORKTREE);
    expect(verifyWorktreePath(HOME, EPIC).startsWith(join(HOME, WORKTREES_SUBDIR))).toBe(true);
  });
});

describe('checkFlags', () => {
  it('names the session id, then --tools with Read, Grep, Glob and Bash last', () => {
    expect(checkFlags('abc')).toEqual([SESSION_ID_FLAG, 'abc', '--tools', 'Read,Grep,Glob,Bash']);
    expect(CHECK_TOOLS).toEqual(['Read', 'Grep', 'Glob', 'Bash']);
  });
});

describe('renderCheckPrompt', () => {
  it('opens with the prefix and names the ref and commit', () => {
    const prompt = renderCheckPrompt({ check: 'Run it.', commit: COMMIT, ref: 'origin/main' });
    expect(prompt.split('\n')[0]).toBe(CHECK_PROMPT_PREFIX);
    expect(prompt).toContain(`\`origin/main\` at commit ${COMMIT}`);
    expect(prompt).toContain('```text\nRun it.\n```');
  });

  it('fences a check one backtick longer than its longest run, and inserts it verbatim', () => {
    const check = 'Run `x` and read:\n```\n$& {CHECK}\n```';
    const prompt = renderCheckPrompt({ check, commit: COMMIT, ref: 'origin/main' });
    expect(prompt).toContain(`\`\`\`\`text\n${check}\n\`\`\`\``);
  });

  it('carries an example block the parser reads, as the control that it asks for the shape parsed', () => {
    const prompt = renderCheckPrompt({ check: 'Run it.', commit: COMMIT, ref: 'origin/main' });
    const reading = parseCheckVerdict(prompt);
    expect(reading.present).toBe(true);
  });
});

describe('parseCheckVerdict', () => {
  it('reads a pass with its evidence, trimmed', () => {
    expect(parseCheckVerdict(answer('result: pass\nevidence: "  saw it  "'))).toMatchObject({
      present: true,
      result: 'pass',
      evidence: 'saw it',
    });
  });

  it('reads a fail with block-scalar evidence spanning lines', () => {
    const reading = parseCheckVerdict(answer('result: fail\nevidence: |\n  ran rafa roadmap\n  it printed nothing'));
    expect(reading).toMatchObject({ present: true, result: 'fail', evidence: 'ran rafa roadmap\nit printed nothing' });
  });

  it('reads the last block, and never an earlier one when the last is unreadable', () => {
    expect(parseCheckVerdict(`${FAIL}\n${PASS}`)).toMatchObject({ present: true, result: 'pass' });
    const reading = parseCheckVerdict(`${PASS}\n${answer('result: maybe\nevidence: "x"')}`);
    expect(reading).toMatchObject({ present: false, text: 'rafa:verdict block at line 10 has result "maybe", not pass or fail' });
  });

  it('answers an absence for an empty output', () => {
    expect(parseCheckVerdict('')).toEqual({ present: false, text: 'the session output holds no rafa:verdict block', block: null });
  });

  it('ignores a block of another kind', () => {
    expect(parseCheckVerdict(answer('result: pass\nevidence: "x"', 'rafa:verify')).present).toBe(false);
  });

  it('answers an absence for an unclosed block', () => {
    const reading = parseCheckVerdict('```rafa:verdict\nresult: pass\nevidence: "x"\n');
    expect(reading).toMatchObject({ present: false, text: 'rafa:verdict block at line 1 is never closed, so it is not read' });
  });

  it('answers an absence for a block that is not a mapping or not YAML', () => {
    expect(parseCheckVerdict(answer('- pass'))).toMatchObject({ present: false, text: 'rafa:verdict block at line 3 holds a list, not a mapping' });
    const reading = parseCheckVerdict(answer('result: pass\nevidence: a: b'));
    expect(reading.present).toBe(false);
    expect(reading.present
      ? ''
      : reading.text).toStartWith('rafa:verdict block at line 3 is not valid YAML (');
  });

  it('refuses a result that is not exactly pass or fail', () => {
    for (const result of ['PASS', 'passed', 'true', '']) {
      expect(parseCheckVerdict(answer(`result: ${result}\nevidence: "x"`)).present).toBe(false);
    }
  });

  it('refuses a missing, blank or non-string evidence', () => {
    expect(parseCheckVerdict(answer('result: pass'))).toMatchObject({
      present: false,
      text: 'rafa:verdict block at line 3 has evidence nothing, not a non-blank string',
    });
    expect(parseCheckVerdict(answer('result: pass\nevidence: "   "')).present).toBe(false);
    expect(parseCheckVerdict(answer('result: pass\nevidence: 3'))).toMatchObject({
      present: false,
      text: 'rafa:verdict block at line 3 has evidence the number 3, not a non-blank string',
    });
  });
});

describe('runVerification', () => {
  it('reaches neither git nor Claude when handed no check', async () => {
    const { git, calls } = plantedGit();
    const { spawn, spawned } = plantedSpawner([]);
    expect(await runVerification(options(git, spawn, { checks: [] }))).toEqual({ status: 'nothing-to-check' });
    expect(calls).toEqual([]);
    expect(spawned).toEqual([]);
  });

  it('fetches, adds a detached worktree at the resolved commit, runs each check in it and removes it', async () => {
    const { git, calls } = plantedGit();
    const { spawn, spawned } = plantedSpawner([
      { exitCode: 0, stdout: PASS },
      { exitCode: 0, stdout: FAIL },
    ]);
    const outcome = ran(await runVerification(options(git, spawn)));

    expect(calls).toEqual(THE_STEPS);
    expect(outcome.commit).toBe(COMMIT);
    expect(outcome.worktree).toBe(WORKTREE);
    expect(outcome.removal).toEqual({ id: 'remove', ok: true, command: `git worktree remove --force ${WORKTREE}`, said: '' });

    expect(spawned.map((each) => each.args)).toEqual([
      claudeArgs(SOURCES, [SESSION_ID_FLAG, 'session-1', '--tools', 'Read,Grep,Glob,Bash']),
      claudeArgs(SOURCES, [SESSION_ID_FLAG, 'session-2', '--tools', 'Read,Grep,Glob,Bash']),
    ]);
    expect(spawned.map((each) => each.options)).toEqual([{ cwd: WORKTREE }, { cwd: WORKTREE }]);
    expect(spawned.map((each) => each.prompt)).toEqual([
      renderCheckPrompt({ check: FIRST.check, commit: COMMIT, ref: 'origin/main' }),
      renderCheckPrompt({ check: SECOND.check, commit: COMMIT, ref: 'origin/main' }),
    ]);
    expect(spawned[1]?.prompt).not.toContain(FIRST.check);

    expect(outcome.results).toEqual([
      { kind: 'answered', check: FIRST, sessionId: 'session-1', result: 'pass', evidence: 'rafa roadmap printed #40 in-progress 2/3.' },
      { kind: 'answered', check: SECOND, sessionId: 'session-2', result: 'fail', evidence: 'rafa roadmap printed #40 with no state.' },
    ]);
  });

  it('reads a session that answers nothing as unanswered, runs the next check and still removes the worktree', async () => {
    const { git, calls } = plantedGit();
    const { spawn, spawned } = plantedSpawner([
      { exitCode: 0, stdout: '' },
      { exitCode: 0, stdout: PASS },
    ]);
    const outcome = ran(await runVerification(options(git, spawn)));

    expect(outcome.results[0]).toEqual({
      kind: 'unanswered',
      check: FIRST,
      sessionId: 'session-1',
      reason: 'the session output holds no rafa:verdict block',
    });
    expect(answered(outcome.results[1]).result).toBe('pass');
    expect(spawned).toHaveLength(2);
    expect(calls.at(-1)).toEqual(['worktree', 'remove', '--force', WORKTREE]);
  });

  it('reads a session that exited non-zero as unanswered even when it wrote a pass', async () => {
    const { git } = plantedGit();
    const { spawn } = plantedSpawner([{ exitCode: 1, stdout: PASS }, { exitCode: 0, stdout: PASS }]);
    const outcome = ran(await runVerification(options(git, spawn)));
    expect(outcome.results[0]).toMatchObject({ kind: 'unanswered', reason: 'the check session exited 1, so its answer is not read' });
  });

  it('removes the worktree when the spawner throws, and rejects with the throw', async () => {
    const { git, calls } = plantedGit();
    const { spawn, spawned } = plantedSpawner([{ exitCode: 0, stdout: PASS }, new Error('spend refused')]);
    let caught: unknown;
    try {
      await runVerification(options(git, spawn));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('spend refused');
    expect(spawned).toHaveLength(2);
    expect(calls).toEqual(THE_STEPS);
  });

  it('reports a removal git refused and keeps every result', async () => {
    const refused: GitResult = { ok: false, stdout: '', stderr: `fatal: '${WORKTREE}' is not a working tree\n` };
    const { git } = plantedGit({ 'worktree remove': refused });
    const { spawn } = plantedSpawner([{ exitCode: 0, stdout: PASS }, { exitCode: 0, stdout: PASS }]);
    const outcome = ran(await runVerification(options(git, spawn)));
    expect(outcome.removal).toEqual({
      id: 'remove',
      ok: false,
      command: `git worktree remove --force ${WORKTREE}`,
      said: `fatal: '${WORKTREE}' is not a working tree`,
    });
    expect(outcome.results.map((result) => answered(result).result)).toEqual(['pass', 'pass']);
  });

  it('stops at a refused fetch with no worktree, no session and no removal', async () => {
    const refused: GitResult = { ok: false, stdout: '', stderr: 'fatal: \'origin\' does not appear to be a git repository\n' };
    const { git, calls } = plantedGit({ fetch: refused });
    const { spawn, spawned } = plantedSpawner([]);
    expect(await runVerification(options(git, spawn))).toEqual({
      status: 'not-run',
      step: { id: 'fetch', ok: false, command: 'git fetch origin', said: 'fatal: \'origin\' does not appear to be a git repository' },
      worktree: WORKTREE,
    });
    expect(calls).toEqual([['fetch', 'origin']]);
    expect(spawned).toEqual([]);
  });

  it('stops at a base that resolves to no commit', async () => {
    const refused: GitResult = { ok: false, stdout: '', stderr: 'fatal: Needed a single revision\n' };
    const { git, calls } = plantedGit({ 'rev-parse': refused });
    const { spawn, spawned } = plantedSpawner([]);
    const outcome = await runVerification(options(git, spawn));
    expect(outcome).toMatchObject({ status: 'not-run', step: { id: 'resolve', said: 'fatal: Needed a single revision' } });
    expect(calls).toHaveLength(2);
    expect(spawned).toEqual([]);
  });

  it('stops at a refused add, removing nothing it did not make', async () => {
    const refused: GitResult = { ok: false, stdout: '', stderr: `fatal: '${WORKTREE}' already exists\n` };
    const { git, calls } = plantedGit({ 'worktree add': refused });
    const { spawn, spawned } = plantedSpawner([]);
    const outcome = await runVerification(options(git, spawn));
    expect(outcome).toMatchObject({
      status: 'not-run',
      step: { id: 'add', command: `git worktree add --detach ${WORKTREE} ${COMMIT}` },
    });
    expect(calls).toEqual(THE_STEPS.slice(0, 3));
    expect(spawned).toEqual([]);
  });

  it('fetches and checks out the remote and base the caller names', async () => {
    const { git, calls } = plantedGit();
    const { spawn, spawned } = plantedSpawner([{ exitCode: 0, stdout: PASS }, { exitCode: 0, stdout: PASS }]);
    await runVerification(options(git, spawn, { remote: 'upstream', base: 'trunk' }));
    expect(calls.slice(0, 2)).toEqual([['fetch', 'upstream'], ['rev-parse', '--verify', 'upstream/trunk^{commit}']]);
    expect(spawned[0]?.prompt).toContain('`upstream/trunk` at commit');
  });
});

describe('runVerification over a real git', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-verify-run-')));

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  /** Runs git in `cwd` with a fixed identity and no hooks or signing, throwing on a refusal. */
  function setupGit(cwd: string, args: readonly string[]): string {
    const identity = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
    const result = spawnSync('git', [...identity, ...args], { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout;
  }

  it('checks out the remote main, not the clone\'s own, and leaves only the main worktree behind', async () => {
    const remote = join(base, 'remote');
    const clone = join(base, 'clone');
    setupGit(base, ['init', '-q', '-b', 'main', remote]);
    writeFileSync(join(remote, 'a.txt'), 'one\n');
    setupGit(remote, ['add', 'a.txt']);
    setupGit(remote, ['commit', '-q', '--no-verify', '-m', 'one']);
    setupGit(base, ['clone', '-q', remote, clone]);
    writeFileSync(join(remote, 'a.txt'), 'two\n');
    setupGit(remote, ['commit', '-q', '--no-verify', '-am', 'two']);
    const remoteHead = setupGit(remote, ['rev-parse', 'HEAD']).trim();

    const home = join(base, 'home');
    const seen: string[] = [];
    const spawn: CapturingSpawner = async (_args, _prompt, spawnOptions) => {
      const cwd = spawnOptions?.cwd ?? '';
      seen.push(readFileSync(join(cwd, 'a.txt'), 'utf8'));
      writeFileSync(join(cwd, 'left-behind.txt'), 'by-product\n');
      return { exitCode: 0, stdout: PASS };
    };
    const git = createGitRunner(clone);
    const outcome = ran(await runVerification({ epic: 7, checks: CHECKS.slice(0, 1), settingSources: SOURCES, home, git, spawn }));

    expect(outcome.commit).toBe(remoteHead);
    expect(seen).toEqual(['two\n']);
    expect(readFileSync(join(clone, 'a.txt'), 'utf8')).toBe('one\n');
    expect(outcome.removal.ok).toBe(true);
    expect(existsSync(verifyWorktreePath(home, 7))).toBe(false);
    const listed = setupGit(clone, ['worktree', 'list', '--porcelain']);
    expect(listed.match(/^worktree /gmu)).toHaveLength(1);
  });
});
