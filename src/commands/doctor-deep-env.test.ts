/**
 * Tests for the session-environment reading of `rafa doctor --deep`.
 *
 * Every case plants a home and a project root of its own under this
 * file's temporary directory and hands the reading a shell environment
 * built for the case, so nothing reads the real home or `process.env`.
 * A reader that ignored every settings file would pass each "left out"
 * and "no difference" case here, so each of those sits beside a control
 * that reads the same world, changed in one place, as applied.
 */
import type { SessionEnvSeams } from './doctor-deep-env.js';
import type { ClaudeSettingSource } from '../config-sections.js';
import type { SpawnEnv } from '../utils/session-env.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { bundledBinDirectory } from '../schema/tiers.js';
import { sessionSpawnEnv } from '../utils/session-env.js';

import {
  envDifferences,
  isInvalidEnvName,
  pathDifference,
  readSessionEnv,
  SESSION_ENV_CLI_VERSION,
} from './doctor-deep-env.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-doctor-deep-env-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** A `PATH` value of `dirs`, joined as the platform joins one. */
function pathOf(...dirs: readonly string[]): string {
  return dirs.join(delimiter);
}

/** The shell every case starts from unless it builds its own. */
const SHELL: SpawnEnv = Object.freeze({
  HOME: '/home/someone',
  PATH: pathOf('/usr/local/bin', '/usr/bin', '/bin'),
  TOKEN: 'shell-secret',
});

/** A fresh world: a home and a project root, neither written yet, and seams over them. */
function freshSeams(overrides: Partial<SessionEnvSeams> = {}): SessionEnvSeams {
  planted += 1;
  const base = join(tempBase, `case-${String(planted)}`);
  const projectRoot = join(base, 'project');
  return {
    env: SHELL,
    settingSources: ['project', 'local'],
    home: join(base, 'home'),
    projectRoot,
    cwd: projectRoot,
    ...overrides,
  };
}

/** The three settings files of a world. */
function settingsFiles(seams: SessionEnvSeams): Readonly<Record<ClaudeSettingSource, string>> {
  const root = seams.projectRoot ?? '/nowhere';
  return {
    local: join(root, '.claude/settings.local.json'),
    project: join(root, '.claude/settings.json'),
    user: join(seams.home, '.claude/settings.json'),
  };
}

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Writes a settings file holding `env`. */
function plantEnv(path: string, env: unknown): void {
  write(path, JSON.stringify({ env }));
}

describe('readSessionEnv with no settings file', () => {
  it('answers what sessionSpawnEnv answers for the shell: the entrypoint added, and bundled/bin in front of PATH', () => {
    const seams = freshSeams();

    const reading = readSessionEnv(seams);

    expect(reading.env).toEqual(sessionSpawnEnv(SHELL));
    expect(reading.differences).toEqual([{ key: 'CLAUDE_CODE_ENTRYPOINT', kind: 'added', layer: 'spawn' }]);
    expect(reading.path).toEqual({ layer: 'spawn', added: [bundledBinDirectory()], removed: [], reordered: false });
    expect(reading.warnings).toEqual([]);
  });

  it('reads every scope with a path, nearest first, each empty and marked by the sources', () => {
    const seams = freshSeams();
    const files = settingsFiles(seams);

    const reading = readSessionEnv(seams);

    expect(reading.scopes.map((scope) => [scope.scope, scope.path, scope.loaded, scope.entries.size])).toEqual([
      ['local', files.local, true, 0],
      ['project', files.project, true, 0],
      ['user', files.user, false, 0],
    ]);
  });

  it('carries the working directory, the project root and the sources it was handed', () => {
    const seams = freshSeams();
    const cwd = join(seams.projectRoot ?? '', 'packages', 'sub');

    const reading = readSessionEnv({ ...seams, cwd });

    expect(reading.cwd).toBe(cwd);
    expect(reading.projectRoot).toBe(seams.projectRoot);
    expect(reading.settingSources).toEqual(['project', 'local']);
  });

  it('reads the user scope alone outside a project', () => {
    const seams = freshSeams({ projectRoot: null, settingSources: ['user', 'project', 'local'] });
    plantEnv(settingsFiles(seams).user, { FROM_USER: 'u' });

    const reading = readSessionEnv(seams);

    expect(reading.scopes.map((scope) => scope.scope)).toEqual(['user']);
    expect(reading.env['FROM_USER']).toBe('u');
  });
});

describe('readSessionEnv over the settings files', () => {
  it('lets the nearest loaded file decide each key, and farther files keep the keys it leaves', () => {
    const seams = freshSeams({ settingSources: ['user', 'project', 'local'] });
    const files = settingsFiles(seams);
    plantEnv(files.user, { A: 'user', B: 'user', C: 'user' });
    plantEnv(files.project, { B: 'project', C: 'project' });
    plantEnv(files.local, { C: 'local' });

    const reading = readSessionEnv(seams);

    expect([reading.env['A'], reading.env['B'], reading.env['C']]).toEqual(['user', 'project', 'local']);
    expect(reading.differences.filter((difference) => ['A', 'B', 'C'].includes(difference.key))).toEqual([
      { key: 'A', kind: 'added', layer: 'user' },
      { key: 'B', kind: 'added', layer: 'project' },
      { key: 'C', kind: 'added', layer: 'local' },
    ]);
  });

  it('leaves a user-level env out under project,local, and still reads its keys', () => {
    const seams = freshSeams({ settingSources: ['project', 'local'] });
    plantEnv(settingsFiles(seams).user, { FROM_USER: 'u' });

    const reading = readSessionEnv(seams);
    const user = reading.scopes.find((scope) => scope.scope === 'user');

    expect(reading.env['FROM_USER']).toBeUndefined();
    expect(reading.differences.map((difference) => difference.key)).not.toContain('FROM_USER');
    expect(user?.loaded).toBe(false);
    expect([...(user?.entries.keys() ?? [])]).toEqual(['FROM_USER']);
  });

  it('control: the same user-level env is applied once the sources name user', () => {
    const seams = freshSeams({ settingSources: ['user', 'project', 'local'] });
    plantEnv(settingsFiles(seams).user, { FROM_USER: 'u' });

    const reading = readSessionEnv(seams);

    expect(reading.env['FROM_USER']).toBe('u');
    expect(reading.differences).toContainEqual({ key: 'FROM_USER', kind: 'added', layer: 'user' });
  });

  it('leaves out a project file the sources do not name, while the local file still applies', () => {
    const seams = freshSeams({ settingSources: ['local'] });
    const files = settingsFiles(seams);
    plantEnv(files.project, { SHARED: 'project', ONLY_PROJECT: 'p' });
    plantEnv(files.local, { SHARED: 'local' });

    const reading = readSessionEnv(seams);

    expect(reading.env['SHARED']).toBe('local');
    expect(reading.env['ONLY_PROJECT']).toBeUndefined();
  });

  it('sets a settings value over the spawn\'s own entrypoint', () => {
    const seams = freshSeams();
    plantEnv(settingsFiles(seams).local, { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' });

    const reading = readSessionEnv(seams);

    expect(reading.env['CLAUDE_CODE_ENTRYPOINT']).toBe('sdk-ts');
    expect(reading.differences).toContainEqual({ key: 'CLAUDE_CODE_ENTRYPOINT', kind: 'added', layer: 'local' });
  });

  it('reads a key set to the shell\'s own value as no difference', () => {
    const seams = freshSeams();
    plantEnv(settingsFiles(seams).project, { HOME: '/home/someone' });

    const reading = readSessionEnv(seams);

    expect(reading.differences.map((difference) => difference.key)).not.toContain('HOME');
  });

  it('control: another value for the same key is a change, naming the file\'s scope', () => {
    const seams = freshSeams();
    plantEnv(settingsFiles(seams).project, { HOME: '/elsewhere' });

    const reading = readSessionEnv(seams);

    expect(reading.differences).toContainEqual({ key: 'HOME', kind: 'changed', layer: 'project' });
  });

  it('names no value in a difference, while env still holds it', () => {
    const seams = freshSeams();
    plantEnv(settingsFiles(seams).project, { TOKEN: 'settings-secret' });

    const reading = readSessionEnv(seams);

    expect(reading.differences).toContainEqual({ key: 'TOKEN', kind: 'changed', layer: 'project' });
    expect(JSON.stringify(reading.differences)).not.toContain('secret');
    expect(reading.env['TOKEN']).toBe('settings-secret');
  });

  it('writes nothing to the shell it was handed', () => {
    const shell: SpawnEnv = { PATH: '/bin', KEEP: 'shell' };
    const seams = freshSeams({ env: shell });
    plantEnv(settingsFiles(seams).local, { KEEP: 'local', PATH: '/opt/bin' });

    readSessionEnv(seams);

    expect(shell).toEqual({ PATH: '/bin', KEEP: 'shell' });
  });
});

describe('readSessionEnv on the values Claude Code takes', () => {
  it('takes a number and a boolean as String spells them', () => {
    const seams = freshSeams();
    plantEnv(settingsFiles(seams).project, { COUNT: 3, ON: true, OFF: false });

    const reading = readSessionEnv(seams);

    expect([reading.env['COUNT'], reading.env['ON'], reading.env['OFF']]).toEqual(['3', 'true', 'false']);
    expect(reading.warnings).toEqual([]);
  });

  it('ignores a value that is no scalar, with a warning, and keeps the file\'s other entries', () => {
    const seams = freshSeams();
    const path = settingsFiles(seams).project;
    plantEnv(path, { NESTED: { a: 1 }, LIST: ['x'], NOTHING: null, KEPT: 'yes' });

    const reading = readSessionEnv(seams);

    expect(reading.env['KEPT']).toBe('yes');
    expect(['NESTED', 'LIST', 'NOTHING'].map((key) => reading.env[key])).toEqual([undefined, undefined, undefined]);
    expect(reading.warnings.map((warning) => [warning.scope, warning.path, warning.loaded])).toEqual([
      ['project', path, true],
      ['project', path, true],
      ['project', path, true],
    ]);
    expect(reading.warnings[0]?.reason).toStartWith('env "NESTED" is ');
    expect(reading.warnings[0]?.reason).toEndWith('expected a string, a number or a boolean, so Claude Code ignores it');
  });

  it('ignores a name Claude Code refuses and a value holding NUL, each with a warning', () => {
    const seams = freshSeams();
    plantEnv(settingsFiles(seams).local, { '': 'x', 'A=B': 'x', 'BAD\nNAME': 'x', NUL: 'a\0b', GOOD: 'x' });

    const reading = readSessionEnv(seams);
    const local = reading.scopes.find((scope) => scope.scope === 'local');

    expect([...(local?.entries.keys() ?? [])]).toEqual(['GOOD']);
    expect(reading.warnings.map((warning) => warning.reason)).toEqual([
      'env "" is not a valid environment variable name, so Claude Code ignores it',
      'env "A=B" is not a valid environment variable name, so Claude Code ignores it',
      'env "BAD\nNAME" is not a valid environment variable name, so Claude Code ignores it',
      'env "NUL" holds a NUL character, so Claude Code ignores it',
    ]);
  });

  it('pins the Claude Code version the rules were read from', () => {
    expect(SESSION_ENV_CLI_VERSION).toBe('2.1.280');
  });
});

describe('readSessionEnv on a settings file that does not read', () => {
  it('reads a file that cannot be opened as a warning, and the other files still apply', () => {
    const seams = freshSeams();
    const files = settingsFiles(seams);
    mkdirSync(files.local, { recursive: true });
    plantEnv(files.project, { FROM_PROJECT: 'p' });

    const reading = readSessionEnv(seams);

    expect(reading.env['FROM_PROJECT']).toBe('p');
    expect(reading.warnings).toHaveLength(1);
    expect(reading.warnings[0]?.path).toBe(files.local);
    expect(reading.warnings[0]?.reason).toStartWith('does not read: ');
  });

  it('reads a file that is not JSON as a warning', () => {
    const seams = freshSeams();
    write(settingsFiles(seams).project, '{ not json');

    const reading = readSessionEnv(seams);

    expect(reading.warnings.map((warning) => warning.scope)).toEqual(['project']);
    expect(reading.warnings[0]?.reason).toStartWith('is not JSON: ');
  });

  it('reads an env that is no mapping as a warning, and adds nothing', () => {
    const seams = freshSeams();
    plantEnv(settingsFiles(seams).project, ['PATH=/opt/bin']);

    const reading = readSessionEnv(seams);

    expect(reading.warnings.map((warning) => warning.reason)).toEqual(['has env a list, expected a mapping']);
    expect(reading.env).toEqual(sessionSpawnEnv(SHELL));
  });

  it('warns of a file whose scope is left out too, marked as not loaded', () => {
    const seams = freshSeams({ settingSources: ['project', 'local'] });
    write(settingsFiles(seams).user, '{ not json');

    const reading = readSessionEnv(seams);

    expect(reading.warnings.map((warning) => [warning.scope, warning.loaded])).toEqual([['user', false]]);
  });

  it('reads a file with no env as no warning', () => {
    const seams = freshSeams();
    write(settingsFiles(seams).project, JSON.stringify({ skillOverrides: {} }));

    expect(readSessionEnv(seams).warnings).toEqual([]);
  });
});

describe('readSessionEnv on PATH', () => {
  it('reads a project env.PATH as a PATH difference, not as a key difference', () => {
    const seams = freshSeams();
    plantEnv(settingsFiles(seams).project, { PATH: pathOf('/opt/tool/bin', '/usr/bin') });

    const reading = readSessionEnv(seams);

    expect(reading.path).toEqual({
      layer: 'project',
      added: ['/opt/tool/bin'],
      removed: ['/usr/local/bin', '/bin'],
      reordered: false,
    });
    expect(reading.differences.map((difference) => difference.key)).not.toContain('PATH');
  });

  it('takes a $PATH in the value as written, never expanded', () => {
    const seams = freshSeams();
    plantEnv(settingsFiles(seams).project, { PATH: pathOf('/opt/bin', '$PATH') });

    const reading = readSessionEnv(seams);

    expect(reading.path?.added).toEqual(['/opt/bin', '$PATH']);
    expect(reading.path?.removed).toEqual(['/usr/local/bin', '/usr/bin', '/bin']);
  });
});

describe('pathDifference', () => {
  it('answers null for the same directories in the same order', () => {
    expect(pathDifference(pathOf('/a', '/b'), pathOf('/a', '/b'), null)).toBeNull();
  });

  it('control: the same directories in another order are reordered', () => {
    expect(pathDifference(pathOf('/a', '/b'), pathOf('/b', '/a'), 'local')).toEqual({
      layer: 'local',
      added: [],
      removed: [],
      reordered: true,
    });
  });

  it('counts a directory where it is first named, so a later repeat moves nothing', () => {
    expect(pathDifference(pathOf('/a', '/b'), pathOf('/a', '/b', '/a'), null)).toBeNull();
    expect(pathDifference(pathOf('/a', '/b'), pathOf('/b', '/a', '/b'), null)?.reordered).toBe(true);
  });

  it('drops empty entries, as pathDirectories does', () => {
    expect(pathDifference(pathOf('/a', '', '/b'), pathOf('/a', '/b', ''), null)).toBeNull();
  });

  it('reads a PATH only one side has as every directory added or removed', () => {
    expect(pathDifference(undefined, pathOf('/a', '/b'), 'user')).toEqual({
      layer: 'user',
      added: ['/a', '/b'],
      removed: [],
      reordered: false,
    });
    expect(pathDifference(pathOf('/a'), undefined, null)?.removed).toEqual(['/a']);
  });

  it('reads a reorder among the shared directories beside an added one', () => {
    expect(pathDifference(pathOf('/a', '/b'), pathOf('/new', '/b', '/a'), 'project')).toEqual({
      layer: 'project',
      added: ['/new'],
      removed: [],
      reordered: true,
    });
  });
});

describe('envDifferences', () => {
  it('reads an added, a changed and a removed key, by key, PATH left out', () => {
    const shell: SpawnEnv = { GONE: 'g', PATH: '/bin', SAME: 's', SHIFTED: 'old' };
    const session: SpawnEnv = { NEW: 'n', PATH: '/opt/bin', SAME: 's', SHIFTED: 'new' };
    const layers = new Map([['NEW', 'user'], ['SHIFTED', 'local']] as const);

    expect(envDifferences(shell, session, layers)).toEqual([
      { key: 'GONE', kind: 'removed', layer: null },
      { key: 'NEW', kind: 'added', layer: 'user' },
      { key: 'SHIFTED', kind: 'changed', layer: 'local' },
    ]);
  });

  it('reads an entry holding undefined as no value', () => {
    expect(envDifferences({ UNSET: undefined }, { UNSET: undefined }, new Map())).toEqual([]);
    expect(envDifferences({ UNSET: undefined }, { UNSET: 'x' }, new Map())).toEqual([
      { key: 'UNSET', kind: 'added', layer: null },
    ]);
  });
});

describe('isInvalidEnvName', () => {
  it('refuses an empty name, an equals sign, and C0, DEL and C1 controls', () => {
    expect(['', 'A=B', 'A\tB', 'A\u007fB', 'A\u0085B', 'A\u009fB'].map(isInvalidEnvName)).toEqual([
      true, true, true, true, true, true,
    ]);
  });

  it('control: takes ordinary names, lowercase, digits and non-ASCII past C1 included', () => {
    expect(['PATH', 'lower_case', 'X1', 'A-B', 'CAFÉ'].map(isInvalidEnvName)).toEqual([
      false, false, false, false, false,
    ]);
  });
});
