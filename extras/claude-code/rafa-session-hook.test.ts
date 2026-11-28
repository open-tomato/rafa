import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { linesToPrint, resultEventOf } from './rafa-hookify/files/rafa-session-hook';

const HOOK = `${import.meta.dir}/rafa-hookify/files/rafa-session-hook.ts`;

const HUB_LINE = 'hub: reachable, contract 1, project rafa; pulled 312 rows';
const OFFLINE_LINE = 'effort sync: the hub at http://127.0.0.1:9 is unreachable (refused); this command used the local store, and its rows sync on the next contact';
const SKEW_LINE = 'effort sync: this rafa is behind its hub; run rafa self-update, then rafa effort sync';
const LOCAL_LINE = 'effort sync: effort.sync is "local", which syncs with no hub; nothing to sync';

const start = JSON.stringify({ type: 'start', command: 'effort sync', ts: 't' });
const log = (message: string): string => JSON.stringify({ type: 'log', level: 'warn', message, ts: 't' });
const done = (contacted: boolean, lines: string[]): string => JSON.stringify({ type: 'result', ok: true, data: { strategy: 'service', contacted, lines }, ts: 't' });
const failed = (code: string, message: string): string => JSON.stringify({ type: 'result', ok: false, error: { code, message }, ts: 't' });
const stdoutOf = (...events: string[]): string => `${[start, ...events].join('\n')}\n`;

describe('resultEventOf', () => {
  test('reads the result event past the start and log events', () => {
    expect(resultEventOf(stdoutOf(log(HUB_LINE), done(true, [HUB_LINE])))?.ok).toBe(true);
  });

  test('answers null for output holding no result event', () => {
    expect(resultEventOf(`${start}\nnot json\n`)).toBeNull();
    expect(resultEventOf('')).toBeNull();
  });
});

describe('linesToPrint', () => {
  test('prints the lines of a run that contacted a hub', () => {
    expect(linesToPrint(stdoutOf(done(true, [HUB_LINE])))).toEqual([HUB_LINE]);
    expect(linesToPrint(stdoutOf(done(true, [OFFLINE_LINE])))).toEqual([OFFLINE_LINE]);
  });

  test('prints nothing for a run that contacted none', () => {
    expect(linesToPrint(stdoutOf(done(false, [LOCAL_LINE])))).toEqual([]);
  });

  test('prints the lines of a refused contact, carried in the error message', () => {
    expect(linesToPrint(stdoutOf(failed('command_exit', `${SKEW_LINE}\n${OFFLINE_LINE}`)))).toEqual([SKEW_LINE, OFFLINE_LINE]);
  });

  test.each([
    ['the command refusing its own line', 'command_exit', '❌ Expected no argument, got 1: x\nUsage: rafa effort sync'],
    ['no rafa project', 'no_project', 'not inside a rafa project'],
    ['a rafa with no effort sync', 'unknown_action', '"effort" has no action "sync"'],
  ])('prints nothing for %s', (_name, code, message) => {
    expect(linesToPrint(stdoutOf(failed(code, message)))).toEqual([]);
  });

  test('prints nothing for output that is not the command\'s json', () => {
    expect(linesToPrint('rafa: command not found\n')).toEqual([]);
  });
});

describe('the hook, spawned with a stub rafa on PATH', () => {
  let base = '';
  const bunDir = dirname(process.execPath);

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'rafa-session-hook-'));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  /** A bin directory holding a `rafa` that prints `stdout` and exits `exitCode`, and records its arguments. */
  const stubBin = async (name: string, stdout: string, exitCode: number): Promise<string> => {
    const bin = join(base, name);
    await Bun.write(join(bin, 'stdout.txt'), stdout);
    const script = `#!/bin/sh\necho "$@" > "${bin}/args.txt"\n/bin/cat "${bin}/stdout.txt"\nexit ${String(exitCode)}\n`;
    await writeFile(join(bin, 'rafa'), script);
    await chmod(join(bin, 'rafa'), 0o755);
    return bin;
  };

  const runHook = (path: string): { exitCode: number; stdout: string } => {
    const run = Bun.spawnSync([process.execPath, HOOK], {
      cwd: base,
      env: { PATH: path, HOME: base, CLAUDE_PROJECT_DIR: base },
      stdin: new TextEncoder().encode('{"hook_event_name":"SessionStart"}'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: run.exitCode, stdout: run.stdout.toString() };
  };

  test('runs rafa effort sync --output=json and prints the lines of a contact', async () => {
    const bin = await stubBin('contacted', stdoutOf(log(HUB_LINE), done(true, [HUB_LINE])), 0);
    const run = runHook(`${bin}:${bunDir}`);
    expect(run).toEqual({ exitCode: 0, stdout: `${HUB_LINE}\n` });
    expect((await Bun.file(join(bin, 'args.txt')).text()).trim()).toBe('effort sync --output=json');
  });

  test('prints nothing when no hub was contacted', async () => {
    const bin = await stubBin('local', stdoutOf(done(false, [LOCAL_LINE])), 0);
    expect(runHook(`${bin}:${bunDir}`)).toEqual({ exitCode: 0, stdout: '' });
  });

  test('exits 0 and prints the refusal when rafa exits 1', async () => {
    const bin = await stubBin('refused', stdoutOf(log(SKEW_LINE), failed('command_exit', SKEW_LINE)), 1);
    expect(runHook(`${bin}:${bunDir}`)).toEqual({ exitCode: 0, stdout: `${SKEW_LINE}\n` });
  });

  test('exits 0 and prints nothing when rafa exits 1 with nothing to read', async () => {
    const bin = await stubBin('broken', 'boom\n', 1);
    expect(runHook(`${bin}:${bunDir}`)).toEqual({ exitCode: 0, stdout: '' });
  });

  test('exits 0 and prints nothing when no rafa is on PATH', async () => {
    // Control: the bun directory alone holds no rafa, so the hook cannot reach one.
    expect(Bun.which('rafa', { PATH: bunDir })).toBeNull();
    expect(runHook(bunDir)).toEqual({ exitCode: 0, stdout: '' });
  });
});

describe('install.ts, run in a temporary git repository', () => {
  const INSTALL = `${import.meta.dir}/rafa-hookify/install.ts`;
  const MIN_TIMEOUT_SECONDS = 90;
  let repo = '';

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rafa-session-install-'));
    await Bun.write(join(repo, '.rafa/config.yaml'), 'effort:\n  sync: local\n');
    const init = Bun.spawnSync(['git', 'init', '-q'], { cwd: repo });
    expect(init.exitCode).toBe(0);
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const install = (...args: string[]): { exitCode: number; stdout: string } => {
    const run = Bun.spawnSync([process.execPath, INSTALL, ...args], { cwd: repo, stdout: 'pipe', stderr: 'pipe' });
    return { exitCode: run.exitCode, stdout: run.stdout.toString() };
  };

  const settingsOf = async (): Promise<{ hooks: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]> }> => JSON.parse(await Bun.file(join(repo, '.claude/settings.json')).text());

  test('--dry-run lists every entry and writes nothing', async () => {
    const run = install('--dry-run');
    expect(run.exitCode).toBe(0);
    const rows = run.stdout.split('\n').filter((line) => line.startsWith('  '));
    expect(rows.map((row) => row.trim().split(/\s+/)
      .slice(1)
      .join(' '))).toEqual([
      '.claude/skills/rafa-tooling/SKILL.md',
      '.claude/skills/rafa-tooling/help-tree.ts',
      '.claude/hooks/rafa-tooling-hook.ts',
      '.claude/hooks/rafa-session-hook.ts',
      '.claude/settings.json PreToolUse',
      '.claude/settings.json SessionStart',
      'CLAUDE.md',
    ]);
    expect(rows.every((row) => row.includes('added'))).toBe(true);
    expect(await Bun.file(join(repo, '.claude/settings.json')).exists()).toBe(false);
  });

  test('writes the SessionStart entry with a timeout above 90 seconds', async () => {
    expect(install().exitCode).toBe(0);
    const settings = await settingsOf();
    const entries = settings.hooks.SessionStart ?? [];
    expect(entries).toHaveLength(1);
    const hook = entries[0]?.hooks[0];
    expect(hook?.command).toContain('rafa-session-hook.ts');
    expect(hook?.timeout).toBeGreaterThan(MIN_TIMEOUT_SECONDS);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(await Bun.file(join(repo, '.claude/hooks/rafa-session-hook.ts')).exists()).toBe(true);
  });

  test('a second install changes nothing', async () => {
    const before = await Bun.file(join(repo, '.claude/settings.json')).text();
    const run = install();
    expect(run.exitCode).toBe(0);
    const rows = run.stdout.split('\n').filter((line) => line.startsWith('  '));
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.includes('unchanged'))).toBe(true);
    expect(run.stdout).toContain('Everything was already in place.');
    expect(await Bun.file(join(repo, '.claude/settings.json')).text()).toBe(before);
  });
});

describe('the hook under effort.sync: local', () => {
  test('prints nothing and the stub never reaches a hub', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rafa-session-local-'));
    try {
      await Bun.write(join(dir, '.rafa/config.yaml'), 'effort:\n  sync: local\n');
      const bin = join(dir, 'bin');
      const contact = join(dir, 'contact.txt');
      // The stub reads the config as rafa would: it touches `contact.txt` only for a hub strategy.
      const script = `#!/bin/sh\nif /usr/bin/grep -q 'sync: local' "${dir}/.rafa/config.yaml"; then\n  echo '${done(false, [LOCAL_LINE])}'\nelse\n  echo hub > "${contact}"\n  echo '${done(true, [HUB_LINE])}'\nfi\n`;
      await Bun.write(join(bin, 'rafa'), script);
      await chmod(join(bin, 'rafa'), 0o755);
      const run = Bun.spawnSync([process.execPath, HOOK], {
        cwd: dir,
        env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, CLAUDE_PROJECT_DIR: dir },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toBe('');
      expect(await Bun.file(contact).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
