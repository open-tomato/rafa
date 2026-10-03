import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { scratchHomeEnv } from '../../src/tests/scratch-home-env.js';

/**
 * The two operator shell scripts: `scripts/stretch/stretch.sh`, which
 * starts the stretch operators on the loop host, and
 * `scripts/device/check.sh`, which takes a gate reading on another device
 * and posts it.
 *
 * Every case runs the real script under bash, in a planted repository
 * with a HOME of its own, under a PATH of stand-ins for `claude`, `tmux`
 * and `gh` ahead of the system directories. No case starts a session, a
 * tmux server or a post: `stretch.sh` cases read `--dry-run`, and the
 * stand-ins record their arguments.
 *
 * `TMPDIR` is passed through on purpose: a spawned run that drops it
 * judges paths by `/tmp` on macOS, which is #708.
 */

const STRETCH_SH = resolve(import.meta.dir, 'stretch.sh');
const DEFAULT_PROMPT = resolve(import.meta.dir, 'engineer-prompt-default.md');
const CHECK_SH = resolve(import.meta.dir, '..', 'device', 'check.sh');
const OPERATOR_AGENTS = ['rafa-stretch-engineer', 'rafa-stretch-watchtower', 'rafa-stretch-analyst'];

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-scripts-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

interface World {
  readonly repo: string;
  readonly home: string;
  readonly bin: string;
}

function writeScript(path: string, body: string): void {
  writeFileSync(path, body, 'utf8');
  chmodSync(path, 0o755);
}

/** A stand-in that appends its arguments to `<bin>/<name>.calls` and exits `code`. */
function standIn(bin: string, name: string, code = 0): void {
  writeScript(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${bin}/${name}.calls'\nexit ${code}\n`);
}

function git(cwd: string, env: Record<string, string>, ...words: string[]): void {
  const run = Bun.spawnSync(['git', ...words], { cwd, env });
  if (run.exitCode !== 0) throw new Error(`git ${words.join(' ')}: ${run.stderr.toString()}`);
}

/** A main checkout with `.rafa/stretch/1/agent.json`, a HOME, and stand-ins. */
function plantWorld(options: { linked?: boolean } = {}): World {
  const repo = join(base, 'repo');
  const home = join(base, 'home');
  const bin = join(base, 'bin');
  for (const dir of [repo, home, bin]) mkdirSync(dir, { recursive: true });
  standIn(bin, 'claude');
  standIn(bin, 'gh');
  writeScript(join(bin, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${bin}/tmux.calls'\n[ "$1" = has-session ] && exit 1\nexit 0\n`);

  const env = spawnEnv({ repo, home, bin });
  git(repo, env, 'init', '-q', '-b', 'main');
  git(repo, env, 'commit', '-q', '--allow-empty', '-m', 'root');
  mkdirSync(join(repo, '.rafa', 'stretch', '1'), { recursive: true });
  writeFileSync(join(repo, '.rafa', 'stretch', '1', 'agent.json'), '{}\n', 'utf8');

  if (options.linked !== false) {
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
    for (const name of OPERATOR_AGENTS) writeFileSync(join(home, '.claude', 'agents', `${name}.md`), '---\n---\n', 'utf8');
  }
  return { repo, home, bin };
}

function spawnEnv(world: World): Record<string, string> {
  const path = [world.bin, '/usr/bin', '/bin', dirname(Bun.which('git') ?? '/usr/bin/git')].join(delimiter);
  return { PATH: path, TMPDIR: tmpdir(), ...scratchHomeEnv(world.home) };
}

function run(world: World, script: string, words: string[], cwd = world.repo): { code: number; out: string } {
  const child = Bun.spawnSync(['bash', script, ...words], { cwd, env: spawnEnv(world) });
  return { code: child.exitCode, out: `${child.stdout.toString()}${child.stderr.toString()}` };
}

/**
 * A stand-in rafa checkout beside the project: a git main checkout with
 * `.rafa/`, the script and both prompts under `scripts/stretch/`, rafa's
 * own prompt marked so a case can tell it from the default, and one
 * operator of each kind. Answers the copied script's path.
 */
function plantRafa(world: World): { readonly root: string; readonly script: string } {
  const root = join(base, 'rafa');
  const stretchDir = join(root, 'scripts', 'stretch');
  mkdirSync(stretchDir, { recursive: true });
  mkdirSync(join(root, '.rafa'), { recursive: true });
  copyFileSync(STRETCH_SH, join(stretchDir, 'stretch.sh'));
  copyFileSync(DEFAULT_PROMPT, join(stretchDir, 'engineer-prompt-default.md'));
  writeFileSync(join(stretchDir, 'engineer-prompt.md'), 'RAFA ONLY: start stretch {{STRETCH}}.\n', 'utf8');
  for (const kind of ['agents', 'skills']) mkdirSync(join(root, 'src/bundled/operators', kind), { recursive: true });
  writeFileSync(join(root, 'src/bundled/operators/agents/rafa-stretch-engineer.md'), 'x', 'utf8');
  mkdirSync(join(root, 'src/bundled/operators/skills/rafa-stretch-sweep'));
  const env = spawnEnv(world);
  git(root, env, 'init', '-q', '-b', 'main');
  git(root, env, 'commit', '-q', '--allow-empty', '-m', 'root');
  return { root, script: join(stretchDir, 'stretch.sh') };
}

function calls(world: World, name: string): string {
  const path = join(world.bin, `${name}.calls`);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8');
}

describe('stretch.sh', () => {
  it('prints its usage for --help and exits 0', () => {
    const world = plantWorld();
    const { code, out } = run(world, STRETCH_SH, ['--help']);

    expect(code).toBe(0);
    expect(out).toContain('stretch.sh start');
    expect(out).toContain('--remote-control');
  });

  it('starts the engineer of the next stretch with its prompt filled in, under a session name', () => {
    const world = plantWorld();
    const { code, out } = run(world, STRETCH_SH, ['engineer', '--dry-run']);

    expect(code).toBe(0);
    expect(out).toContain('claude --agent rafa-stretch-engineer -n stretch\\ 2\\ engineer');
    expect(out).toContain('Start stretch 2.');
    expect(out).toContain('.rafa/stretch/1/report.md');
    expect(out).not.toContain('{{');
    expect(calls(world, 'claude')).toBe('');
  });

  it('names the session through --remote-control instead of -n when asked', () => {
    const world = plantWorld();
    const { code, out } = run(world, STRETCH_SH, ['engineer', '--remote-control', '--dry-run']);

    expect(code).toBe(0);
    expect(out).toContain('--remote-control stretch\\ 2\\ engineer');
    expect(out).not.toContain(' -n ');
  });

  it('starts the watchtower on the newest stretch with an agent.json, with /loop', () => {
    const world = plantWorld();
    const { code, out } = run(world, STRETCH_SH, ['watchtower', '--dry-run']);

    expect(code).toBe(0);
    expect(out).toContain('claude --agent rafa-stretch-watchtower -n stretch\\ 1\\ watchtower /loop');
  });

  it('starts the analyst on that stretch, naming its folder in the opening message', () => {
    const world = plantWorld();
    const { code, out } = run(world, STRETCH_SH, ['analyst', '--dry-run']);

    expect(code).toBe(0);
    expect(out).toContain('claude --agent rafa-stretch-analyst -n stretch\\ 1\\ analyst');
    expect(out).toContain('Read\\ .rafa/stretch/1/');
    expect(out).not.toContain('{{');
  });

  it('opens one tmux session whose watchtower and analyst windows wait for the new stretch', () => {
    const world = plantWorld();
    const { code, out } = run(world, STRETCH_SH, ['start', '--dry-run']);

    expect(code).toBe(0);
    expect(out).toContain('tmux new-session -d -s rafa-stretch-2');
    expect(out).toContain('watchtower\\ --stretch=2');
    expect(out).toContain('analyst\\ --stretch=2');
    expect(out).toContain('dry run: would start stretch 2 in tmux session rafa-stretch-2');
    expect(calls(world, 'tmux')).toBe('has-session -t rafa-stretch-2\n');
  });

  it('refuses in a worktree, naming the main checkout', () => {
    const world = plantWorld();
    const worktree = join(base, 'wt');
    git(world.repo, spawnEnv(world), 'worktree', 'add', '-q', worktree);
    const { code, out } = run(world, STRETCH_SH, ['engineer', '--dry-run'], worktree);

    expect(code).toBe(1);
    expect(out).toContain('run this from the main checkout, not a worktree');
  });

  it('refuses before the operators are linked, naming the link command', () => {
    const world = plantWorld({ linked: false });
    const { code, out } = run(world, STRETCH_SH, ['engineer', '--dry-run']);

    expect(code).toBe(1);
    expect(out).toContain('stretch.sh link');
  });

  it('links each operator from the rafa checkout it runs from, and keeps a file that is not a link', () => {
    const world = plantWorld({ linked: false });
    const rafa = plantRafa(world);
    mkdirSync(join(world.home, '.claude', 'skills'), { recursive: true });
    writeFileSync(join(world.home, '.claude/skills/rafa-stretch-sweep'), 'mine', 'utf8');

    const { code, out } = run(world, rafa.script, ['link']);

    expect(code).toBe(0);
    const engineer = join(world.home, '.claude/agents/rafa-stretch-engineer.md');
    expect(lstatSync(engineer).isSymbolicLink()).toBe(true);
    expect(realpathSync(engineer)).toBe(join(rafa.root, 'src/bundled/operators/agents/rafa-stretch-engineer.md'));
    expect(readFileSync(join(world.home, '.claude/skills/rafa-stretch-sweep'), 'utf8')).toBe('mine');
    expect(out).toContain('kept');
  });

  it('gives another project the default prompt, never rafa\'s own', () => {
    const world = plantWorld();
    const rafa = plantRafa(world);
    const { code, out } = run(world, rafa.script, ['engineer', '--dry-run']);

    expect(code).toBe(0);
    expect(out).toContain('Start stretch 2.');
    expect(out).toContain(`prompt: ${join(rafa.root, 'scripts/stretch/engineer-prompt-default.md')}`);
    expect(out).not.toContain('RAFA ONLY');
  });

  it('gives the rafa checkout its own prompt', () => {
    const world = plantWorld();
    const rafa = plantRafa(world);
    const { code, out } = run(world, rafa.script, ['engineer', '--dry-run'], rafa.root);

    expect(code).toBe(0);
    expect(out).toContain('RAFA\\ ONLY:\\ start\\ stretch\\ 1.');
  });

  it('prefers the project\'s own .rafa/stretch/engineer-prompt.md', () => {
    const world = plantWorld();
    const rafa = plantRafa(world);
    writeFileSync(join(world.repo, '.rafa/stretch/engineer-prompt.md'), 'MINE {{STRETCH}} after {{PREVIOUS}}\n', 'utf8');
    const { code, out } = run(world, rafa.script, ['engineer', '--dry-run']);

    expect(code).toBe(0);
    expect(out).toContain('MINE\\ 2\\ after\\ 1');
    expect(out).not.toContain('Start stretch');
  });

  it('leaves the previous-report line out of a project\'s first stretch', () => {
    const world = plantWorld();
    rmSync(join(world.repo, '.rafa', 'stretch'), { recursive: true });
    const { code, out } = run(world, STRETCH_SH, ['engineer', '--dry-run']);

    expect(code).toBe(0);
    expect(out).toContain('Start stretch 1.');
    expect(out).not.toContain('stretch/0');
    expect(out).not.toContain('{{');
  });
});

/** A bun test log: a passing case, two failures with their output, an unhandled error, and the recap. */
const FAILING_LOG = [
  'src/a.test.ts:',
  '(pass) a > passes [1.00ms]',
  '10 |   expect(x).toBe(4);',
  'error: expect(received).toBe(expected)',
  '(fail) a > counts four [2.00ms]',
  'src/b.test.ts:',
  'error: Executable not found in $PATH: "zsh"',
  '(fail) b > reads the header [3.00ms]',
  '# Unhandled error between tests',
  'SQLiteError: disk I/O error',
  '',
  '2 tests failed:',
  '(fail) a > counts four [2.00ms]',
  '(fail) b > reads the header [3.00ms]',
  '',
  ' 1 pass',
  ' 2 fail',
  ' 1 error',
  'Ran 3 tests across 2 files. [1.00s]',
  '',
].join('\n');

describe('device/check.sh', () => {
  it('builds the report from a saved log: the summary, each failure once, and its own output', () => {
    const world = plantWorld();
    const log = join(base, 'test.log');
    writeFileSync(log, FAILING_LOG, 'utf8');
    const out = join(base, 'out');

    const result = run(world, CHECK_SH, [`--from-log=${log}`, `--out=${out}`]);
    const report = readFileSync(join(out, 'report.md'), 'utf8');

    expect(result.code).toBe(1);
    expect(report).toContain('### bun test: exit 1');
    expect(report).toContain(' 2 fail');
    expect(report).toContain('2 failing cases:');
    expect(report.split('(fail) a > counts four').length - 1).toBe(2);
    expect(report).toContain('error: expect(received).toBe(expected)');
    expect(report).toContain('Executable not found in $PATH: "zsh"');
    expect(report).toContain('SQLiteError: disk I/O error');
    expect(report).not.toContain('(pass)');
    expect(calls(world, 'gh')).toBe('');
  });

  it('exits 0 over a passing log, with no failure section', () => {
    const world = plantWorld();
    const log = join(base, 'test.log');
    writeFileSync(log, '(pass) a > passes [1.00ms]\n\n 1 pass\n 0 fail\nRan 1 test across 1 file. [1.00s]\n', 'utf8');
    const out = join(base, 'out');

    const result = run(world, CHECK_SH, [`--from-log=${log}`, `--out=${out}`]);

    expect(result.code).toBe(0);
    expect(readFileSync(join(out, 'report.md'), 'utf8')).not.toContain('failing cases');
  });

  it('posts the report with gh on the issue --issue names', () => {
    const world = plantWorld();
    const log = join(base, 'test.log');
    writeFileSync(log, FAILING_LOG, 'utf8');
    const out = join(base, 'out');

    const result = run(world, CHECK_SH, [`--from-log=${log}`, `--out=${out}`, '--issue=708']);

    expect(result.out).toContain('posted on #708');
    expect(calls(world, 'gh')).toBe(`issue comment 708 --body-file ${join(out, 'report.md')}\n`);
  });

  it('reads a log that ended before its summary as a failure', () => {
    const world = plantWorld();
    const log = join(base, 'test.log');
    writeFileSync(log, '(pass) a > passes [1.00ms]\nSegmentation fault\n', 'utf8');

    const result = run(world, CHECK_SH, [`--from-log=${log}`, `--out=${join(base, 'out')}`]);

    expect(result.code).toBe(1);
  });

  it('takes relative --from-log and --out from where it was called', () => {
    const world = plantWorld();
    const here = join(base, 'here');
    mkdirSync(here);
    writeFileSync(join(here, 'test.log'), FAILING_LOG, 'utf8');

    const result = run(world, CHECK_SH, ['--from-log=test.log', '--out=out'], here);

    expect(result.code).toBe(1);
    expect(existsSync(join(here, 'out', 'report.md'))).toBe(true);
  });

  it('exits 3 when the gates passed and the post failed', () => {
    const world = plantWorld();
    standIn(world.bin, 'gh', 1);
    const log = join(base, 'test.log');
    writeFileSync(log, ' 1 pass\n 0 fail\nRan 1 test across 1 file. [1.00s]\n', 'utf8');

    const result = run(world, CHECK_SH, [`--from-log=${log}`, `--out=${join(base, 'out')}`, '--issue=708']);

    expect(result.code).toBe(3);
    expect(result.out).toContain('posting on #708 failed');
  });

  it('refuses an --issue that is not a number, with exit 2', () => {
    const world = plantWorld();
    const result = run(world, CHECK_SH, ['--issue=abc']);

    expect(result.code).toBe(2);
    expect(result.out).toContain('--issue takes a number');
  });
});
