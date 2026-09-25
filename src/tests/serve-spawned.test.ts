/**
 * `rafa loop start` spawned over a one-task plan, with a stand-in
 * `claude` first on its PATH that records what each session was given.
 *
 * The stand-in writes one file per call under a directory outside the
 * repository: the first line of its prompt, its `PATH`, and its
 * arguments one per line (the `--agents` JSON holds no newline, so it
 * stays one line). It ends on the same report the loop-sessions suite's
 * stand-in does, so the task is ticked and the run reaches its wrap-up.
 *
 * Held here:
 *   - the task session and the wrap-up session each receive the served
 *     flags: `--add-dir <repo>/.rafa/runs/<run>/served` (the
 *     delivery `SKILL_DELIVERY` records) and `--agents <json>`;
 *   - the served directory holds the skills under `.claude/skills`;
 *   - each session's `PATH` opens with the running entry's `bundled/bin`;
 *   - nothing is written under the project's `.claude/`, nor under the
 *     `HOME` given the run.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { SKILL_DELIVERY } from '../tiers/delivery.js';
import { SKILL_DELIVERY_FLAG, SERVED_SKILLS_PATH } from '../tiers/serve.js';

import { plantProjectConfig } from './cli-capture.js';

const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));
const BUNDLED_BIN = join(dirname(RAFA_ENTRY), 'bundled', 'bin');

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-serve-spawned-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const FENCE = '```';
const STUB = 'serve-demo';
const BRANCH = `feat/${STUB}`;
const TASK = 'The only task for the stand-in';
const RUN_TIMEOUT = 90_000;
const SPAWN_KILL_MS = 60_000;

const STAND_IN_REPORT = [
  `${FENCE}rafa:report`,
  'status: done',
  'feedback: "the stand-in answered"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  FENCE,
  '',
].join('\n');

/** One recorded stand-in call. */
interface Call {
  readonly prompt: string;
  readonly path: string;
  readonly args: readonly string[];
}

/** The scratch project, and where the stand-in records. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly calls: string;
  readonly path: string;
}

function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** Plants the repository, the stand-in `claude`, and the plan. */
function plant(): Scratch {
  const root = join(tempRoot, 'run');
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const calls = join(root, 'calls');
  for (const dir of [repo, bin, home, calls]) mkdirSync(dir, { recursive: true });

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');

  const reportPath = join(root, 'report.txt');
  writeFileSync(reportPath, STAND_IN_REPORT, 'utf8');
  const claude = join(bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'IFS= read -r first',
    'while read -r _line; do :; done',
    `out='${calls}'/$$.txt`,
    'printf \'%s\\n\' "$first" > "$out"',
    'printf \'%s\\n\' "$PATH" >> "$out"',
    'printf \'%s\\n\' "$@" >> "$out"',
    `/bin/cat '${reportPath}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), `# Plan: ${STUB}\n\n- [ ] ${TASK}\n`, 'utf8');
  plantProjectConfig(repo);

  return { repo, home, calls, path: [bin, dirname(gitBinary)].join(delimiter) };
}

/** Every call the stand-in recorded. */
function recordedCalls(scratch: Scratch): readonly Call[] {
  return readdirSync(scratch.calls).sort()
    .map((file) => {
      const [prompt = '', path = '', ...args] = readFileSync(join(scratch.calls, file), 'utf8').split('\n');
      return { prompt, path, args: args.slice(0, -1) };
    });
}

/** The value following `flag` in `args`, or undefined. */
function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1
    ? undefined
    : args[at + 1];
}

describe('rafa loop start, spawned with a recording stand-in claude', () => {
  it('hands a task and a wrap-up session the served flags and PATH, and writes nothing under .claude/', () => {
    const scratch = plant();

    const proc = Bun.spawnSync(
      [process.execPath, RAFA_ENTRY, 'loop', 'start', `--plan=.plans/PLAN-${STUB}.md`, '--no-ci-wait', '--inject=full'],
      { cwd: scratch.repo, env: { PATH: scratch.path, HOME: scratch.home }, timeout: SPAWN_KILL_MS },
    );
    expect(proc.exitCode).toBe(0);

    const sessions = readSessions(scratch.repo);
    expect(sessions).toHaveLength(1);
    const served = join(scratch.repo, '.rafa', 'runs', sessions[0]?.sessionId ?? '', 'served');

    const calls = recordedCalls(scratch);
    const task = calls.filter((call) => call.args.includes('--session-id'));
    const wrapUp = calls.filter((call) => !call.args.includes('--session-id'));
    expect(task).toHaveLength(1);
    expect(wrapUp).toHaveLength(1);

    for (const call of [...task, ...wrapUp]) {
      expect(valueOf(call.args, SKILL_DELIVERY_FLAG[SKILL_DELIVERY])).toBe(served);
      const agents = JSON.parse(valueOf(call.args, '--agents') ?? 'null') as Record<string, unknown> | null;
      expect(Object.keys(agents ?? {})).toContain('tdd-guide');
      expect(call.path.split(delimiter)[0]).toBe(BUNDLED_BIN);
    }

    expect(existsSync(join(served, SERVED_SKILLS_PATH[SKILL_DELIVERY], 'git-workflow', 'SKILL.md'))).toBe(true);

    expect(existsSync(join(scratch.repo, '.claude'))).toBe(false);
    expect(existsSync(join(scratch.home, '.claude'))).toBe(false);
  }, RUN_TIMEOUT);
});
