/**
 * Tests for the since-last-command notice as a command hook (`hook.ts`).
 *
 * Most cases script the reading and the config through the hook's seams
 * and read and write `.rafa/status-seen.json` for real, in a planted
 * project of each case's own, so what `before` answers and what `after`
 * leaves on disk are both read back. Three cases leave a seam out: one
 * reads `status.notice` from a planted `.rafa/config.yaml`, and two take
 * the real reading, over a git repository with one commit and over a
 * directory git refuses.
 *
 * Every case that answers null, calls nothing or writes nothing sits
 * beside one that does not under the same seams, so a hook that did
 * nothing at all would fail a case.
 *
 * Four mutations of `hook.ts` were driven on 2026-09-24, one run each
 * over this file with 23 pass before, each restored sha256-identical,
 * and each reddened at least one case: a mounted `status` read as quiet
 * 1, `after` writing nothing 8, `status.notice` never read 2, and the
 * quiet commands printing like any other 2.
 */
import type { StatusHookConfig, StatusHookSeams } from './hook.js';
import type { SeenInput, SeenReading, SeenSnapshot } from './seen.js';
import type { RafaCommand } from '../cli/command.js';
import type { CommandRoute } from '../cli/route.js';
import type { ProjectFound } from '../project/scope.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { projectConfigText } from '../project/scaffold.js';
import { resolveScope } from '../project/scope.js';
import { plantProjectConfig } from '../tests/cli-capture.js';

import { createStatusHook, isQuietCommand, QUIET_COMMANDS } from './hook.js';
import { CLEANUP_COMMAND, NOTICE_PREFIX, STATUS_COMMAND } from './notice.js';
import { readSeenFile, seenFilePath, SEEN_VERSION, writeSeenFile } from './seen.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-hook-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The home every project passes over. */
const HOME = join(tempBase, 'home');
mkdirSync(HOME, { recursive: true });

/** The settings a scripted config answers, `status.notice` as given. */
function config(statusNotice: boolean): StatusHookConfig {
  return { prBase: 'main', cleanupKeep: [], cleanupStaleDays: 30, cleanupWorktreeIdleDays: 7, statusNotice };
}

/** A snapshot holding `idle` worktrees and `merged` branches, and no session. */
function snapshot(idle: readonly string[] = [], merged: readonly string[] = []): SeenSnapshot {
  return { version: SEEN_VERSION, idleWorktrees: idle, mergedBranches: merged, sessions: {} };
}

/** The number of projects planted so far, naming the next. */
let planted = 0;

/** A project of the case's own under {@link tempBase}, its config planted with `text`. */
function plantProject(text: string = projectConfigText()): ProjectFound {
  planted += 1;
  const root = join(tempBase, `project-${String(planted)}`);
  plantProjectConfig(root, text);
  const scope = resolveScope(root, { home: HOME });
  if (!scope.found) throw new Error(`no project resolved at ${root}`);
  return scope;
}

/** A command of the given name, as `status` and `cleanup` are registered. */
function commandNamed(name: string): RafaCommand {
  return {
    name,
    description: `Runs ${name}.`,
    subject: name,
    action: name,
    summary: name,
    args: [],
    flags: [],
    examples: [{ cmd: `rafa ${name}`, note: 'runs it' }],
    outputs: ['text', 'json'],
    run: async () => undefined,
  };
}

/** A route to a command named `name`, core unless `mounted`. */
function routeTo(name: string, mounted = false): CommandRoute {
  const command = commandNamed(name);
  return {
    kind: 'command',
    command,
    module: mounted
      ? { name: 'linear', entry: '/modules/linear/commands.ts', commands: [command] }
      : null,
    alias: null,
    argv: [],
    line: [],
    label: name,
  };
}

/** A route to a command the notice prints for. */
const PLAIN = routeTo('doctor');

/** A take seam answering `readings` in turn, the last one again once they run out, logging each input. */
function scriptedTake(...readings: SeenReading[]): { take: StatusHookSeams['take']; inputs: SeenInput[] } {
  const inputs: SeenInput[] = [];
  return {
    inputs,
    take: async (input) => {
      inputs.push(input);
      const reading = readings[Math.min(inputs.length, readings.length) - 1];
      if (reading === undefined) throw new Error('no reading scripted');
      return reading;
    },
  };
}

/** A reading answering `value`. */
function ok(value: SeenSnapshot): SeenReading {
  return { ok: true, snapshot: value };
}

describe('before', () => {
  it('answers null on a first run, with no file to compare against, and writes none', async () => {
    const project = plantProject();
    const { take, inputs } = scriptedTake(ok(snapshot(['/w/a'])));
    const hook = createStatusHook({ config: () => config(true), take });

    expect(await hook.before(PLAIN, project)).toBeNull();
    expect(inputs).toHaveLength(1);
    expect(existsSync(seenFilePath(project.root))).toBe(false);
  });

  it('answers null when nothing is new since the file', async () => {
    const project = plantProject();
    writeSeenFile(project.root, snapshot(['/w/a']));
    const { take } = scriptedTake(ok(snapshot(['/w/a'])));

    const line = await createStatusHook({ config: () => config(true), take }).before(PLAIN, project);

    expect(line).toBeNull();
  });

  it('answers the line naming rafa cleanup for a worktree gone idle since the file', async () => {
    const project = plantProject();
    writeSeenFile(project.root, snapshot());
    const { take } = scriptedTake(ok(snapshot(['/w/a'])));

    const line = await createStatusHook({ config: () => config(true), take }).before(PLAIN, project);

    expect(line).toBe(`${NOTICE_PREFIX}1 worktree went idle; run ${CLEANUP_COMMAND}`);
  });

  it('answers the line naming rafa status for a loop that stopped since the file', async () => {
    const project = plantProject();
    writeSeenFile(project.root, { ...snapshot(), sessions: { s1: { state: 'running', blocked: [] } } });
    const { take } = scriptedTake(ok({ ...snapshot(), sessions: { s1: { state: 'stopped', blocked: [] } } }));

    const line = await createStatusHook({ config: () => config(true), take }).before(PLAIN, project);

    expect(line).toBe(`${NOTICE_PREFIX}1 loop stopped; run ${STATUS_COMMAND}`);
  });

  it('reads the project root, the home and the config it was handed', async () => {
    const project = plantProject();
    const { take, inputs } = scriptedTake(ok(snapshot()));

    await createStatusHook({ config: () => config(true), take }).before(PLAIN, project);

    expect(inputs).toEqual([{ root: project.root, home: HOME, config: config(true) }]);
  });

  it('leaves the file as it was', async () => {
    const project = plantProject();
    writeSeenFile(project.root, snapshot());
    const before = readFileSync(seenFilePath(project.root), 'utf8');
    const { take } = scriptedTake(ok(snapshot(['/w/a'], ['feat/x'])));

    await createStatusHook({ config: () => config(true), take }).before(PLAIN, project);

    expect(readFileSync(seenFilePath(project.root), 'utf8')).toBe(before);
  });

  it.each(QUIET_COMMANDS.map((name) => [name]))('answers null for %s without taking a reading, where news is waiting', async (name) => {
    const project = plantProject();
    writeSeenFile(project.root, snapshot());
    const { take, inputs } = scriptedTake(ok(snapshot(['/w/a'])));
    const hook = createStatusHook({ config: () => config(true), take });

    expect(await hook.before(routeTo(name), project)).toBeNull();
    expect(inputs).toEqual([]);
    expect(await hook.before(PLAIN, project)).not.toBeNull();
  });

  it('rejects with the detail of a failed reading, so the dispatcher writes it as a debug line', async () => {
    const project = plantProject();
    const { take } = scriptedTake({ ok: false, detail: 'not a git repository' });

    const reading = createStatusHook({ config: () => config(true), take }).before(PLAIN, project);

    await expect(reading).rejects.toThrow('the status reading failed: not a git repository');
  });
});

describe('after', () => {
  it('writes the fresh reading over the file, for the next command to compare against', async () => {
    const project = plantProject();
    writeSeenFile(project.root, snapshot());
    const { take } = scriptedTake(ok(snapshot(['/w/a'], ['feat/x'])));

    await createStatusHook({ config: () => config(true), take }).after(PLAIN, project);

    expect(readSeenFile(project.root)).toEqual(snapshot(['/w/a'], ['feat/x']));
  });

  it('writes the file on a first run', async () => {
    const project = plantProject();
    const { take } = scriptedTake(ok(snapshot(['/w/a'])));

    await createStatusHook({ config: () => config(true), take }).after(PLAIN, project);

    expect(readSeenFile(project.root)).toEqual(snapshot(['/w/a']));
  });

  it.each(QUIET_COMMANDS.map((name) => [name]))('writes the file after %s as after any other command', async (name) => {
    const project = plantProject();
    const { take } = scriptedTake(ok(snapshot(['/w/a'])));

    await createStatusHook({ config: () => config(true), take }).after(routeTo(name), project);

    expect(readSeenFile(project.root)).toEqual(snapshot(['/w/a']));
  });

  it('makes what the command itself did no news for the next one', async () => {
    const project = plantProject();
    writeSeenFile(project.root, snapshot());
    const { take } = scriptedTake(ok(snapshot(['/w/a'])));
    const hook = createStatusHook({ config: () => config(true), take });

    await hook.after(PLAIN, project);

    expect(await hook.before(PLAIN, project)).toBeNull();
  });

  it('rejects on a failed reading and leaves the file the last command wrote', async () => {
    const project = plantProject();
    writeSeenFile(project.root, snapshot(['/w/old']));
    const { take } = scriptedTake({ ok: false, detail: 'git refused' });

    const writing = createStatusHook({ config: () => config(true), take }).after(PLAIN, project);

    await expect(writing).rejects.toThrow('the status reading failed: git refused');
    expect(readSeenFile(project.root)).toEqual(snapshot(['/w/old']));
  });
});

describe('status.notice false', () => {
  it('answers no line, takes no reading and writes no file, where true does all three', async () => {
    const project = plantProject();
    writeSeenFile(project.root, snapshot());
    const before = readFileSync(seenFilePath(project.root), 'utf8');
    const off = scriptedTake(ok(snapshot(['/w/a'])));
    const hookOff = createStatusHook({ config: () => config(false), take: off.take });

    expect(await hookOff.before(PLAIN, project)).toBeNull();
    await hookOff.after(PLAIN, project);
    expect(off.inputs).toEqual([]);
    expect(readFileSync(seenFilePath(project.root), 'utf8')).toBe(before);

    const on = scriptedTake(ok(snapshot(['/w/a'])));
    const hookOn = createStatusHook({ config: () => config(true), take: on.take });
    expect(await hookOn.before(PLAIN, project)).not.toBeNull();
    await hookOn.after(PLAIN, project);
    expect(on.inputs).toHaveLength(2);
    expect(readSeenFile(project.root)).toEqual(snapshot(['/w/a']));
  });

  it('is read from the project\'s .rafa/config.yaml when the config seam is left out', async () => {
    const off = plantProject(`${projectConfigText()}status:\n  notice: false\n`);
    const on = plantProject();
    const { take, inputs } = scriptedTake(ok(snapshot()));
    const hook = createStatusHook({ take });

    await hook.after(PLAIN, off);
    await hook.after(PLAIN, on);

    expect(existsSync(seenFilePath(off.root))).toBe(false);
    expect(existsSync(seenFilePath(on.root))).toBe(true);
    expect(inputs.map((input) => input.root)).toEqual([on.root]);
  });
});

describe('the real reading, every seam left out', () => {
  it('writes an empty snapshot for a git repository with one commit and nothing to clean', async () => {
    const project = plantProject();
    const git = (...args: string[]): void => {
      const done = Bun.spawnSync(['git', ...args], { cwd: project.root, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
      if (done.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${done.stderr.toString()}`);
    };
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one');
    const hook = createStatusHook();

    expect(await hook.before(PLAIN, project)).toBeNull();
    await hook.after(PLAIN, project);

    expect(readSeenFile(project.root)).toEqual(snapshot());
  });

  it('rejects for a project that is no git repository, and writes nothing', async () => {
    const project = plantProject();

    await expect(createStatusHook().after(PLAIN, project)).rejects.toThrow('the status reading failed');
    expect(existsSync(seenFilePath(project.root))).toBe(false);
  });
});

describe('isQuietCommand', () => {
  it.each([
    ['status', false, true],
    ['cleanup', false, true],
    ['doctor', false, false],
    ['status', true, false],
  ])('answers for %s, mounted %p: %p', (name, mounted, quiet) => {
    expect(isQuietCommand(routeTo(name, mounted))).toBe(quiet);
  });
});
