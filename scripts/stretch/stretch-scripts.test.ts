import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { scratchHomeEnv } from '../../src/tests/scratch-home-env.js';

/**
 * The two operator shell scripts: `scripts/stretch/stretch.sh`, the
 * deprecated wrapper that runs `rafa stretch start`, and
 * `scripts/device/check.sh`, which takes a gate reading on another device
 * and posts it.
 *
 * Every case runs the real script under bash, in a planted repository
 * with a HOME of its own, under a PATH of stand-ins for `rafa` and `gh`
 * ahead of the system directories. No case starts a session or a post:
 * the stand-ins record their arguments, `rafa` one word to a line so a
 * case reads exactly the words the wrapper passed.
 *
 * `TMPDIR` is passed through on purpose: a spawned run that drops it
 * judges paths by `/tmp` on macOS, which is #708.
 */

const STRETCH_SH = resolve(import.meta.dir, 'stretch.sh');
const CHECK_SH = resolve(import.meta.dir, '..', 'device', 'check.sh');

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

/** A stand-in `rafa` that writes each argument on its own line, then `--end--`, to `<bin>/rafa.calls`, and exits `code`. */
function rafaStandIn(bin: string, code = 0): void {
  writeScript(join(bin, 'rafa'), `#!/bin/sh\nfor word in "$@"; do printf '%s\\n' "$word" >> '${bin}/rafa.calls'; done\necho --end-- >> '${bin}/rafa.calls'\nexit ${code}\n`);
}

/** A repository, a HOME, and a bin of stand-ins for `rafa` and `gh`, unless `rafa` is false. */
function plantWorld(options: { rafa?: boolean } = {}): World {
  const repo = join(base, 'repo');
  const home = join(base, 'home');
  const bin = join(base, 'bin');
  for (const dir of [repo, home, bin]) mkdirSync(dir, { recursive: true });
  if (options.rafa !== false) rafaStandIn(bin);
  standIn(bin, 'gh');
  return { repo, home, bin };
}

function spawnEnv(world: World): Record<string, string> {
  const path = [world.bin, '/usr/bin', '/bin', dirname(Bun.which('git') ?? '/usr/bin/git')].join(delimiter);
  return { PATH: path, TMPDIR: tmpdir(), ...scratchHomeEnv(world.home) };
}

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function run(world: World, script: string, words: string[], cwd = world.repo): Run & { readonly all: string } {
  const child = Bun.spawnSync(['bash', script, ...words], { cwd, env: spawnEnv(world) });
  const out = child.stdout.toString();
  const err = child.stderr.toString();
  return { code: child.exitCode, out, err, all: `${out}${err}` };
}

function calls(world: World, name: string): string {
  const path = join(world.bin, `${name}.calls`);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8');
}

/** The argument lists the stand-in `rafa` was called with, one list per call. */
function rafaCalls(world: World): string[][] {
  const text = calls(world, 'rafa');
  if (text === '') return [];
  const lists = text.split('--end--\n').filter((call) => call !== '');
  return lists.map((call) => call.split('\n').filter((word) => word !== ''));
}

describe('stretch.sh', () => {
  it('prints its usage for --help and exits 0, running nothing', () => {
    const world = plantWorld();
    const { code, all } = run(world, STRETCH_SH, ['--help']);

    expect(code).toBe(0);
    expect(all).toContain('rafa stretch start --role=engineer');
    expect(all).toContain('--stretch=<n>');
    expect(rafaCalls(world)).toEqual([]);
  });

  it('prints its usage with exit 2 when given no command', () => {
    const world = plantWorld();
    const { code, all } = run(world, STRETCH_SH, []);

    expect(code).toBe(2);
    expect(all).toContain('deprecated');
    expect(rafaCalls(world)).toEqual([]);
  });

  it('runs rafa stretch start for start, with a deprecation line on stderr naming that line', () => {
    const world = plantWorld();
    const { code, out, err } = run(world, STRETCH_SH, ['start', '--dry-run']);

    expect(code).toBe(0);
    expect(rafaCalls(world)).toEqual([['stretch', 'start', '--dry-run']]);
    expect(err).toContain('stretch.sh is deprecated');
    expect(err).toContain('run: rafa stretch start --dry-run');
    expect(out).toBe('');
  });

  for (const role of ['engineer', 'watchtower', 'analyst']) {
    it(`passes --role=${role} for ${role}`, () => {
      const world = plantWorld();
      const { code } = run(world, STRETCH_SH, [role]);

      expect(code).toBe(0);
      expect(rafaCalls(world)).toEqual([['stretch', 'start', `--role=${role}`]]);
    });
  }

  it('passes --stretch=<n> as --n=<n>, and --remote-control and --dry-run as they are, in order', () => {
    const world = plantWorld();
    const { code } = run(world, STRETCH_SH, ['watchtower', '--stretch=5', '--remote-control', '--dry-run']);

    expect(code).toBe(0);
    expect(rafaCalls(world)).toEqual([['stretch', 'start', '--role=watchtower', '--n=5', '--remote-control', '--dry-run']]);
  });

  it('passes any other flag on word for word, leaving its refusal to rafa', () => {
    const world = plantWorld();
    const { code } = run(world, STRETCH_SH, ['start', '--frobnicate', '--odd=two words']);

    expect(code).toBe(0);
    expect(rafaCalls(world)).toEqual([['stretch', 'start', '--frobnicate', '--odd=two words']]);
  });

  it('exits with rafa\'s exit code', () => {
    const world = plantWorld();
    rafaStandIn(world.bin, 3);
    const { code } = run(world, STRETCH_SH, ['engineer']);

    expect(code).toBe(3);
    expect(rafaCalls(world)).toEqual([['stretch', 'start', '--role=engineer']]);
  });

  it('refuses an unknown command with exit 1, running nothing', () => {
    const world = plantWorld();
    const { code, all } = run(world, STRETCH_SH, ['link']);

    expect(code).toBe(1);
    expect(all).toContain('unknown command: link');
    expect(rafaCalls(world)).toEqual([]);
  });

  it('refuses with exit 1 when no rafa is on PATH, naming the line to run', () => {
    const world = plantWorld({ rafa: false });
    expect(Bun.which('rafa', { PATH: spawnEnv(world).PATH })).toBeNull();
    const { code, all } = run(world, STRETCH_SH, ['analyst', '--stretch=2']);

    expect(code).toBe(1);
    expect(all).toContain('rafa is not on PATH');
    expect(all).toContain('rafa stretch start --role=analyst --n=2');
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

    expect(result.all).toContain('posted on #708');
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
    expect(result.all).toContain('posting on #708 failed');
  });

  it('refuses an --issue that is not a number, with exit 2', () => {
    const world = plantWorld();
    const result = run(world, CHECK_SH, ['--issue=abc']);

    expect(result.code).toBe(2);
    expect(result.all).toContain('--issue takes a number');
  });
});
