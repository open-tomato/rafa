/**
 * Tests for the preflight runner (`src/preflight/run.ts`).
 *
 * Every probe runs the real `/bin/sh` under an environment the case
 * builds: `HOME` is a directory under the case's own temporary directory,
 * and `PATH` holds the case's `bin/`, where stand-in commands are
 * planted, before the system directories or instead of them. Each case
 * that builds one asserts both resolve under that directory. No case waits
 * 30 seconds: the timeout is handed in, and the default is read through
 * the probe runner seam.
 *
 * A reading that could pass on a runner doing nothing sits beside a
 * control proving the fixture could have failed it:
 *
 *   - stdin closed: a child process whose stdin holds a line runs the
 *     probe, and the same probe spawned with stdin inherited reads that
 *     line;
 *   - the process group killed: a shell killed alone leaves the read of
 *     its stderr waiting on the `sleep` still holding it;
 *   - the stderr read stopped at the deadline: the escaped process holds
 *     the read until the deadline, not only until its shell exits;
 *   - the timeout: a probe that finishes in time is not timed out;
 *   - presence: each kind beside the same check failing, the environment
 *     read being the one handed in and not this process's.
 */
import type { OptionalPrerequisiteItem, PrerequisiteItem } from '../config.js';

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { PROBE_TIMEOUT_MS, runPreflight, runShellProbe } from './run.js';

/** The system directories a probe finds `sleep` and `cat` in. */
const SYSTEM_PATH = ['/usr/bin', '/bin'].join(delimiter);

/** This module, as a child process imports it. */
const RUN_MODULE = join(import.meta.dir, 'run.ts');

let scratch = '';
let bin = '';
let home = '';

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-preflight-run-')));
  bin = join(scratch, 'bin');
  home = join(scratch, 'home');
  mkdirSync(bin);
  mkdirSync(home);
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(scratch, { recursive: true, force: true });
});

/** True when `path` sits under the case's temporary directory. */
function isUnderScratch(path: string): boolean {
  const rel = relative(scratch, path);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
}

/** The case's environment: its `HOME`, and `PATH` holding its `bin/` first. */
function scratchEnv(path: string = [bin, SYSTEM_PATH].join(delimiter)): Record<string, string> {
  expect(isUnderScratch(home)).toBe(true);
  expect(isUnderScratch(path.split(delimiter)[0] ?? '')).toBe(true);
  return { HOME: home, PATH: path };
}

/** Writes an executable `/bin/sh` script named `name` into the case's `bin/`. */
function plant(name: string, body: readonly string[]): string {
  const path = join(bin, name);
  writeFileSync(path, ['#!/bin/sh', ...body, ''].join('\n'), 'utf8');
  chmodSync(path, 0o755);
  return path;
}

/** A required item. */
function required(kind: PrerequisiteItem['kind'], name: string, probe: string | null = null): PrerequisiteItem {
  return Object.freeze({ kind, name, probe });
}

/** An optional item. */
function optional(
  kind: PrerequisiteItem['kind'],
  name: string,
  probe: string | null,
  reason: string | null,
): OptionalPrerequisiteItem {
  return Object.freeze({ kind, name, probe, reason });
}

/** True while a process with `pid` exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls `condition` every 20 ms until it holds or `limitMs` passes; answers whether it held. */
async function eventually(condition: () => boolean, limitMs: number): Promise<boolean> {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (condition()) return true;
    await Bun.sleep(20);
  }
  return condition();
}

describe('runShellProbe', () => {
  it('answers exit 0 for a probe that succeeds', async () => {
    const run = await runShellProbe('true', { cwd: scratch, env: scratchEnv(), timeoutMs: 5000 });
    expect(run).toEqual({ exitCode: 0, stderr: '', timedOut: false });
  });

  it('answers the exit code and the stderr of a probe that fails', async () => {
    const run = await runShellProbe('echo first >&2; echo second >&2; exit 3', {
      cwd: scratch,
      env: scratchEnv(),
      timeoutMs: 5000,
    });
    expect(run).toEqual({ exitCode: 3, stderr: 'first\nsecond\n', timedOut: false });
  });

  it('runs through the shell in the directory and environment handed in', async () => {
    plant('mgrep', ['echo "stand-in mgrep $1" >&2']);
    const env = { ...scratchEnv(), PROBE_MARK: 'marked' };
    const run = await runShellProbe('pwd >&2 && echo "$HOME $PROBE_MARK" >&2 && mgrep --version', {
      cwd: scratch,
      env,
      timeoutMs: 5000,
    });
    expect(run.stderr).toBe(`${scratch}\n${home} marked\nstand-in mgrep --version\n`);
    expect(run.exitCode).toBe(0);
  });

  it('answers a shell that cannot start as never run, naming the shell and the directory', async () => {
    const gone = join(scratch, 'gone');
    const run = await runShellProbe('true', { cwd: gone, env: scratchEnv(), timeoutMs: 5000 });
    expect(run.exitCode).toBeNull();
    expect(run.timedOut).toBe(false);
    expect(run.stderr).toStartWith(`could not run /bin/sh in ${gone}: `);
  });

  describe('stdin', () => {
    /** Reads one line of stdin and reports what it got on stderr. */
    const READ_PROBE = 'if read -r line; then echo "read:$line" >&2; else echo "eof" >&2; fi';

    /**
     * Spawns a bun child whose stdin holds a line and which runs
     * {@link READ_PROBE} either through `runShellProbe` or with stdin
     * inherited, answering what the probe wrote.
     */
    async function readThroughChild(mode: 'runner' | 'inherit'): Promise<string> {
      const fixture = join(scratch, 'stdin-fixture.ts');
      writeFileSync(fixture, [
        `import { runShellProbe } from ${JSON.stringify(RUN_MODULE)};`,
        `const probe = ${JSON.stringify(READ_PROBE)};`,
        `const env = ${JSON.stringify(scratchEnv())};`,
        'if (process.argv[2] === "runner") {',
        '  const run = await runShellProbe(probe, { cwd: process.cwd(), env, timeoutMs: 5000 });',
        '  process.stdout.write(run.stderr);',
        '} else {',
        '  const proc = Bun.spawn(["/bin/sh", "-c", probe], { env, stdin: "inherit", stdout: "ignore", stderr: "pipe" });',
        '  process.stdout.write(await new Response(proc.stderr).text());',
        '}',
        '',
      ].join('\n'), 'utf8');
      const child = Bun.spawn([process.execPath, fixture, mode], {
        cwd: scratch,
        env: scratchEnv(),
        stdin: new TextEncoder().encode('a line on stdin\n'),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
      return stdout;
    }

    it('reads end of file where a probe with stdin inherited reads the line', async () => {
      expect(await readThroughChild('inherit')).toBe('read:a line on stdin\n');
      expect(await readThroughChild('runner')).toBe('eof\n');
    });

    it('lets a probe waiting on stdin end at once rather than at the timeout', async () => {
      const started = Date.now();
      const run = await runShellProbe('cat', { cwd: scratch, env: scratchEnv(), timeoutMs: 5000 });
      expect(run).toEqual({ exitCode: 0, stderr: '', timedOut: false });
      expect(Date.now() - started).toBeLessThan(4000);
    });
  });

  describe('timeout', () => {
    it('kills a probe still running at the deadline, answering 128 plus SIGKILL', async () => {
      const started = Date.now();
      const run = await runShellProbe('sleep 5', { cwd: scratch, env: scratchEnv(), timeoutMs: 200 });
      const elapsed = Date.now() - started;
      expect(run).toEqual({ exitCode: 137, stderr: '', timedOut: true });
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(3000);
    });

    it('does not time out a probe that finishes before the deadline', async () => {
      const run = await runShellProbe('sleep 0.05', { cwd: scratch, env: scratchEnv(), timeoutMs: 3000 });
      expect(run).toEqual({ exitCode: 0, stderr: '', timedOut: false });
    });

    it('leaves the read waiting on a grandchild when the shell alone is killed', async () => {
      const started = Date.now();
      const proc = Bun.spawn(['/bin/sh', '-c', 'sleep 1; true'], {
        env: scratchEnv(),
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
      });
      setTimeout(() => {
        proc.kill('SIGKILL');
      }, 100);
      await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      expect(Date.now() - started).toBeGreaterThanOrEqual(800);
    });

    it('kills the whole process group, so a grandchild holding stderr dies with the shell', async () => {
      const pidFile = join(scratch, 'grandchild.pid');
      const started = Date.now();
      const pending = runShellProbe(`sleep 30 & echo $! > '${pidFile}'; wait`, {
        cwd: scratch,
        env: scratchEnv(),
        timeoutMs: 600,
      });

      expect(await eventually(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '', 2000)).toBe(true);
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(isAlive(pid)).toBe(true);

      const run = await pending;
      expect(run.timedOut).toBe(true);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(await eventually(() => !isAlive(pid), 2000)).toBe(true);
    });

    it('stops reading stderr at the deadline when an escaped process holds it past its shell', async () => {
      const spawnEscapee = [
        'const child = Bun.spawn(["sleep", "3"], { detached: true, stdin: "ignore", stdout: "ignore", stderr: "inherit" });',
        'child.unref();',
        'console.error("escaped " + child.pid);',
      ].join(' ');
      const started = Date.now();
      const run = await runShellProbe(`'${process.execPath}' -e '${spawnEscapee}'`, {
        cwd: scratch,
        env: scratchEnv(),
        timeoutMs: 700,
      });
      const elapsed = Date.now() - started;
      const escapee = Number(/escaped (\d+)/.exec(run.stderr)?.[1]);
      if (Number.isInteger(escapee) && isAlive(escapee)) process.kill(escapee, 'SIGKILL');

      expect(run.exitCode).toBe(0);
      expect(run.timedOut).toBe(false);
      expect(run.stderr).toMatch(/^escaped \d+\n$/);
      expect(elapsed).toBeGreaterThanOrEqual(600);
      expect(elapsed).toBeLessThan(2500);
    });
  });
});

describe('runPreflight: presence', () => {
  /** Runs one required item with no probe, answering its check. */
  async function presence(item: PrerequisiteItem, env: Record<string, string>, extra: { timeoutMs?: number } = {}) {
    const report = await runPreflight({ required: [item], optional: [] }, {
      cwd: scratch,
      env,
      warn: () => undefined,
      ...extra,
    });
    return report.checks[0];
  }

  it('passes a tool on the PATH handed in and fails one that is not', async () => {
    plant('mgrep', ['exit 0']);
    const env = scratchEnv(bin);
    expect((await presence(required('tool', 'mgrep'), env))?.outcome).toBe('pass');
    expect(await presence(required('tool', 'nonesuch'), env)).toMatchObject({
      outcome: 'fail',
      failure: 'presence check: nonesuch is not on PATH',
    });
  });

  it('searches the PATH handed in and never this process', async () => {
    expect(Bun.which('sh')).not.toBeNull();
    expect((await presence(required('tool', 'sh'), { HOME: home, PATH: '/bin' }))?.outcome).toBe('pass');
    expect((await presence(required('tool', 'sh'), scratchEnv(bin)))?.outcome).toBe('fail');
    expect((await presence(required('tool', 'sh'), { HOME: home }))?.outcome).toBe('fail');
  });

  it('passes an env variable set to text and fails one unset or empty', async () => {
    const env = { ...scratchEnv(), SET_TOKEN: 'x', EMPTY_TOKEN: '' };
    expect((await presence(required('env', 'SET_TOKEN'), env))?.outcome).toBe('pass');
    expect((await presence(required('env', 'EMPTY_TOKEN'), env))?.failure).toBe('presence check: EMPTY_TOKEN is set but empty');
    expect((await presence(required('env', 'UNSET_TOKEN'), env))?.failure).toBe('presence check: UNSET_TOKEN is not set');
  });

  it('reads the environment handed in and never this process', async () => {
    expect(process.env.PATH).toBeDefined();
    expect((await presence(required('env', 'PATH'), { HOME: home }))?.failure).toBe('presence check: PATH is not set');
  });

  it('passes an lsp whose language server is on the PATH, and fails the bare name', async () => {
    plant('typescript', ['exit 0']);
    const env = scratchEnv(bin);
    expect(await presence(required('lsp', 'typescript'), env)).toMatchObject({
      outcome: 'fail',
      failure: 'presence check: typescript-language-server is not on PATH',
    });
    plant('typescript-language-server', ['exit 0']);
    expect((await presence(required('lsp', 'typescript'), env))?.outcome).toBe('pass');
  });

  it('runs the probe of an item carrying one, and checks no presence', async () => {
    const env = scratchEnv(bin);
    expect((await presence(required('tool', 'nonesuch'), env))?.outcome).toBe('fail');
    expect((await presence(required('tool', 'nonesuch', 'exit 0'), env))?.outcome).toBe('pass');
  });

  describe('service', () => {
    it('passes any answer to a HEAD request, a redirect unfollowed and a 404 included', async () => {
      const methods: string[] = [];
      const server = Bun.serve({
        port: 0,
        fetch: (request) => {
          methods.push(request.method);
          return new URL(request.url).pathname === '/moved'
            ? new Response(null, { status: 301, headers: { location: 'http://127.0.0.1:1/elsewhere' } })
            : new Response('no', { status: 404 });
        },
      });
      try {
        const base = `http://127.0.0.1:${server.port}`;
        expect((await presence(required('service', `${base}/missing`), scratchEnv()))?.outcome).toBe('pass');
        expect((await presence(required('service', `${base}/moved`), scratchEnv()))?.outcome).toBe('pass');
        expect(methods).toEqual(['HEAD', 'HEAD']);
      } finally {
        await server.stop(true);
      }
    });

    it('times out a service that never answers', async () => {
      const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => undefined) });
      try {
        const url = `http://127.0.0.1:${server.port}/`;
        const started = Date.now();
        const check = await presence(required('service', url), scratchEnv(), { timeoutMs: 200 });
        expect(check).toMatchObject({ outcome: 'timeout', failure: `presence check: ${url} did not answer within 0.2s` });
        expect(Date.now() - started).toBeLessThan(3000);
      } finally {
        await server.stop(true);
      }
    });

    it('fails a service refusing the connection and a name that is no URL', async () => {
      const server = Bun.serve({ port: 0, fetch: () => new Response('up') });
      const url = `http://127.0.0.1:${server.port}/`;
      expect((await presence(required('service', url), scratchEnv()))?.outcome).toBe('pass');
      await server.stop(true);

      const refused = await presence(required('service', url), scratchEnv());
      expect(refused?.outcome).toBe('fail');
      expect(refused?.failure).toStartWith(`presence check: ${url} did not answer: `);
      expect((await presence(required('service', 'api.github.com'), scratchEnv()))?.outcome).toBe('fail');
    });
  });
});

describe('runPreflight: the report', () => {
  it('answers no halt, no line and no warning when every item passes', async () => {
    const warnings: string[] = [];
    const report = await runPreflight(
      { required: [required('tool', 'sh', 'exit 0')], optional: [optional('tool', 'mgrep', 'exit 0', 'faster search')] },
      { cwd: scratch, env: scratchEnv(), warn: (message) => warnings.push(message) },
    );
    expect(report.halt).toBeNull();
    expect(report.knownMissing).toEqual([]);
    expect(warnings).toEqual([]);
    expect(report.checks.map((check) => [check.tier, check.outcome])).toEqual([['required', 'pass'], ['optional', 'pass']]);
    expect(report.checks.map((check) => check.failure)).toEqual([null, null]);
  });

  it('halts on a failed required probe, naming the item, the probe, the exit code and the first stderr line', async () => {
    plant('bun', ['echo "" >&2', 'echo "  bun: broken install  " >&2', 'echo "second line" >&2', 'exit 7']);
    const report = await runPreflight(
      { required: [required('tool', 'bun', 'bun --version')], optional: [] },
      { cwd: scratch, env: scratchEnv(), warn: () => undefined },
    );
    expect(report.halt).toBe([
      'preflight halted: 1 required item failed',
      '  tool "bun": probe `bun --version` exited 7: bun: broken install',
    ].join('\n'));
    expect(report.checks[0]?.outcome).toBe('fail');
    expect(report.knownMissing).toEqual([]);
  });

  it('names the exit code alone for a probe that wrote nothing to stderr', async () => {
    const report = await runPreflight(
      { required: [required('env', 'GITHUB_TOKEN', 'exit 4')], optional: [] },
      { cwd: scratch, env: scratchEnv(), warn: () => undefined },
    );
    expect(report.halt).toBe('preflight halted: 1 required item failed\n  env "GITHUB_TOKEN": probe `exit 4` exited 4');
  });

  it('halts on a probe killed at its timeout, naming the timeout and the exit code', async () => {
    const report = await runPreflight(
      { required: [required('tool', 'mgrep', 'echo "waiting for login" >&2; sleep 5')], optional: [] },
      { cwd: scratch, env: scratchEnv(), timeoutMs: 300, warn: () => undefined },
    );
    expect(report.checks[0]?.outcome).toBe('timeout');
    expect(report.halt).toBe([
      'preflight halted: 1 required item failed',
      '  tool "mgrep": probe `echo "waiting for login" >&2; sleep 5` timed out after 0.3s and was killed (exit 137): waiting for login',
    ].join('\n'));
  });

  it('halts on a failed required presence check', async () => {
    const report = await runPreflight(
      { required: [required('env', 'GITHUB_TOKEN')], optional: [] },
      { cwd: scratch, env: scratchEnv(), warn: () => undefined },
    );
    expect(report.halt).toBe('preflight halted: 1 required item failed\n  env "GITHUB_TOKEN": presence check: GITHUB_TOKEN is not set');
  });

  it('checks every item after a failed one and names each failure in one halt', async () => {
    const seen: string[] = [];
    const report = await runPreflight(
      {
        required: [required('tool', 'first', 'exit 1'), required('tool', 'second', 'exit 0'), required('tool', 'third', 'exit 2')],
        optional: [optional('tool', 'fourth', 'exit 0', null)],
      },
      {
        cwd: scratch,
        env: scratchEnv(),
        warn: () => undefined,
        runProbe: async (probe, options) => {
          seen.push(probe);
          return runShellProbe(probe, options);
        },
      },
    );
    expect(seen).toEqual(['exit 1', 'exit 0', 'exit 2', 'exit 0']);
    expect(report.halt).toBe([
      'preflight halted: 2 required items failed',
      '  tool "first": probe `exit 1` exited 1',
      '  tool "third": probe `exit 2` exited 2',
    ].join('\n'));
  });

  it('names a shell that could not start as a probe that could not be run', async () => {
    const gone = join(scratch, 'gone');
    const report = await runPreflight(
      { required: [required('tool', 'bun', 'bun --version')], optional: [] },
      { cwd: gone, env: scratchEnv(), warn: () => undefined },
    );
    expect(report.halt).toStartWith(`preflight halted: 1 required item failed\n  tool "bun": probe \`bun --version\` could not be run: could not run /bin/sh in ${gone}: `);
  });

  it('warns and adds a known-missing line for a failed optional item, and does not halt', async () => {
    plant('mgrep', ['echo "mgrep: not logged in" >&2', 'exit 1']);
    const warnings: string[] = [];
    const report = await runPreflight(
      {
        required: [required('tool', 'sh', 'exit 0')],
        optional: [optional('tool', 'mgrep', 'mgrep --version', 'faster search; grep is the fallback')],
      },
      { cwd: scratch, env: scratchEnv(), warn: (message) => warnings.push(message) },
    );
    expect(report.halt).toBeNull();
    expect(report.knownMissing).toEqual(['known-missing: mgrep (faster search; grep is the fallback)']);
    expect(warnings).toEqual([
      'preflight: optional item tool "mgrep" failed: probe `mgrep --version` exited 1: mgrep: not logged in; '
      + 'the run goes on, and each task prompt names it known-missing',
    ]);
  });

  it('warns and adds a known-missing line for an optional probe killed at its timeout', async () => {
    // Inline rather than a planted script: a script written a moment ago
    // can take longer than this timeout to write its first line.
    const probe = 'echo "mgrep: enter your login code" >&2; read -r code < /dev/tty; sleep 5';
    const warnings: string[] = [];
    const report = await runPreflight(
      { required: [], optional: [optional('tool', 'mgrep', probe, 'faster search; grep is the fallback')] },
      { cwd: scratch, env: scratchEnv(), timeoutMs: 300, warn: (message) => warnings.push(message) },
    );
    expect(report.checks[0]?.outcome).toBe('timeout');
    expect(report.halt).toBeNull();
    expect(report.knownMissing).toEqual(['known-missing: mgrep (faster search; grep is the fallback)']);
    expect(warnings).toEqual([
      `preflight: optional item tool "mgrep" failed: probe \`${probe}\` timed out after 0.3s and was killed (exit 137): `
      + 'mgrep: enter your login code; the run goes on, and each task prompt names it known-missing',
    ]);
  });

  it('writes the line without a reason when the item gives none, and on one line when the reason wraps', async () => {
    const report = await runPreflight(
      {
        required: [],
        optional: [optional('lsp', 'typescript', null, null), optional('tool', 'mgrep', 'exit 1', 'faster\n  search;\tgrep is the fallback\n')],
      },
      { cwd: scratch, env: scratchEnv(bin), warn: () => undefined },
    );
    expect(report.knownMissing).toEqual(['known-missing: typescript', 'known-missing: mgrep (faster search; grep is the fallback)']);
  });

  it('adds no known-missing line for a failed required item', async () => {
    const report = await runPreflight(
      { required: [required('tool', 'mgrep', 'exit 1')], optional: [] },
      { cwd: scratch, env: scratchEnv(), warn: () => undefined },
    );
    expect(report.halt).not.toBeNull();
    expect(report.knownMissing).toEqual([]);
  });

  it('writes the warning through the active output when no warn is handed in', async () => {
    const warnings: string[] = [];
    setActiveOutput(sinkOutput({ warn: (message) => warnings.push(message) }));
    await runPreflight(
      { required: [], optional: [optional('env', 'MGREP_TOKEN', null, null)] },
      { cwd: scratch, env: scratchEnv() },
    );
    expect(warnings).toEqual([
      'preflight: optional item env "MGREP_TOKEN" failed: presence check: MGREP_TOKEN is not set; '
      + 'the run goes on, and each task prompt names it known-missing',
    ]);
  });

  it('hands the probe runner 30 seconds, the directory and process.env when none are handed in', async () => {
    expect(PROBE_TIMEOUT_MS).toBe(30_000);
    const seen: unknown[] = [];
    await runPreflight(
      { required: [required('tool', 'bun', 'bun --version')], optional: [] },
      {
        cwd: scratch,
        warn: () => undefined,
        runProbe: async (probe, options) => {
          seen.push({ probe, cwd: options.cwd, timeoutMs: options.timeoutMs, isProcessEnv: options.env === process.env });
          return { exitCode: 0, stderr: '', timedOut: false };
        },
      },
    );
    expect(seen).toEqual([{ probe: 'bun --version', cwd: scratch, timeoutMs: 30_000, isProcessEnv: true }]);
  });

  it('times each check on the clock handed in', async () => {
    const readings = [1000, 1250.4, 2000, 2000];
    const report = await runPreflight(
      { required: [required('env', 'SET_TOKEN')], optional: [optional('env', 'SET_TOKEN', null, null)] },
      { cwd: scratch, env: { ...scratchEnv(), SET_TOKEN: 'x' }, warn: () => undefined, now: () => readings.shift() ?? 0 },
    );
    expect(report.checks.map((check) => check.durationMs)).toEqual([250, 0]);
  });

  it('answers a frozen report', async () => {
    const report = await runPreflight(
      { required: [required('env', 'UNSET_TOKEN')], optional: [optional('env', 'UNSET_TOKEN', null, null)] },
      { cwd: scratch, env: scratchEnv(), warn: () => undefined },
    );
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.checks)).toBe(true);
    expect(Object.isFrozen(report.knownMissing)).toBe(true);
    expect(report.checks.every((check) => Object.isFrozen(check))).toBe(true);
  });
});
