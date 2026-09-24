/**
 * Tests for the scope writer (`scaffold.ts`): the two config files it
 * writes, the project and user trees, a rerun leaving every byte and
 * modification time as it was, an existing config never rewritten, the
 * conflicts named before a write, and a write that fails.
 *
 * ## The config files
 *
 * Each file as written sets `version` and nothing else, with no unknown
 * key. Uncommented, every setting line of it resolves every setting from
 * the file to its default, but for {@link VALUELESS}: the two lines that
 * carry a key and no value, whose defaults are read off the repository
 * and cannot be spelled, stay silent uncommented and so are answered by
 * the defaults layer. The control drops one more line and finds exactly
 * that setting answered by the default beside those two, so a setting
 * added to the schema without a line in the template reddens the
 * uncommented case.
 *
 * ## A rerun
 *
 * The rerun cases set the modification time of every path under the
 * scope to one instant in 2001, rerun, and read every path again. A
 * writer that rewrote a file or recreated a directory would move a time
 * off that instant. The control rewrites the config file with the bytes
 * it already holds, and the same reading finds its time moved, so the
 * reading can fail.
 *
 * Every root and home is a directory under this file's own temporary
 * root, and each case asserts the paths written sit there.
 */
import type { ScopeWrite, ScopeWriteKind } from './scaffold.js';

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS, parseConfigText, resolveConfig } from '../config.js';

import {
  CONFIG_SETTINGS_LINES,
  PROJECT_TREE,
  projectConfigText,
  ScaffoldError,
  scaffoldConflicts,
  USER_TREE,
  userConfigText,
  writeProjectScope,
  writeUserScope,
} from './scaffold.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-scaffold-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The instant every path is set to before a rerun: 2001-09-09T01:46:40Z. */
const PAST = new Date(1_000_000_000_000);

/** A fresh directory under the temporary root. */
function freshDir(label: string): string {
  return mkdtempSync(join(tempBase, `${label}-`));
}

/** `text` with every setting line uncommented: the `# ` before a key, nested or not, dropped. */
function uncommented(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^# (?= *[A-Za-z]+:)/, ''))
    .join('\n');
}

/** Every path under `dir`, `dir` first, parents before children. */
function pathsUnder(dir: string): readonly string[] {
  const children = lstatSync(dir).isDirectory()
    ? readdirSync(dir).flatMap((name) => pathsUnder(join(dir, name)))
    : [];
  return [dir, ...children];
}

/** Sets every path under `dir` to {@link PAST}. */
function ageAll(dir: string): void {
  for (const path of [...pathsUnder(dir)].reverse()) utimesSync(path, PAST, PAST);
}

/** Each path under `dir` whose modification time is no longer {@link PAST}. */
function movedSincePast(dir: string): readonly string[] {
  return pathsUnder(dir).filter((path) => lstatSync(path).mtimeMs !== PAST.getTime());
}

/** The write a created path answers. */
function created(path: string, kind: ScopeWriteKind): ScopeWrite {
  return { path, kind, change: 'created' };
}

/**
 * The settings whose template line carries no value, so an uncommented
 * file leaves each to the defaults layer. See the module note.
 */
const VALUELESS: readonly (readonly [string, string])[] = [
  ['prProvider', 'default'],
  ['prBase', 'default'],
  ['roadmapIssue', 'default'],
];

describe('the config files', () => {
  it.each([['project', projectConfigText()], ['user', userConfigText()]])('sets version 1 and nothing else in the %s file, with no unknown key', (_scope, text) => {
    const file = parseConfigText(text, 'config.yaml');

    expect(Object.entries(file.values).filter(([, value]) => value !== undefined)).toEqual([['version', 1]]);
    expect(file.extras).toEqual([]);
  });

  it.each([['project', projectConfigText()], ['user', userConfigText()]])('resolves every setting of the %s file from the file to its default once uncommented', (_scope, text) => {
    const file = parseConfigText(uncommented(text), 'config.yaml');
    const resolved = resolveConfig({ file });

    expect(resolved.config).toEqual(CONFIG_DEFAULTS);
    expect(Object.entries(resolved.sources).filter(([, source]) => source !== 'file'))
      .toEqual(VALUELESS.map((pair) => [...pair]));
    expect(file.extras).toEqual([]);
  });

  it('answers the one setting whose line is dropped from the default, so the uncommented case sees every line', () => {
    const lines = CONFIG_SETTINGS_LINES.filter((line) => !line.startsWith('#   all:'));
    const resolved = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...lines].join('\n')), 'c.yaml') });

    expect(lines).toHaveLength(CONFIG_SETTINGS_LINES.length - 1);
    expect(Object.entries(resolved.sources).filter(([, source]) => source !== 'file')).toEqual([
      ['trackingAll', 'default'],
      ...VALUELESS.map((pair) => [...pair]),
    ]);
  });

  it('carries the cleanup section at its defaults, which resolve from the file once uncommented', () => {
    const cleanup = CONFIG_SETTINGS_LINES.slice(
      CONFIG_SETTINGS_LINES.indexOf('# cleanup:'),
      CONFIG_SETTINGS_LINES.indexOf('# dangerous:'),
    );
    const resolved = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...cleanup].join('\n')), 'c.yaml') });

    expect(cleanup.map((line) => line.replace(/ {2,}#.*$/, ''))).toEqual([
      '# cleanup:',
      '#   staleDays: 30',
      '#   worktreeIdleDays: 7',
      '#   keep: []',
    ]);
    expect([resolved.config.cleanupStaleDays, resolved.config.cleanupWorktreeIdleDays, resolved.config.cleanupKeep])
      .toEqual([30, 7, []]);
    expect([resolved.sources.cleanupStaleDays, resolved.sources.cleanupWorktreeIdleDays, resolved.sources.cleanupKeep])
      .toEqual(['file', 'file', 'file']);
  });

  it('answers each cleanup setting from the default once its line is dropped, so the reading above can fail', () => {
    const lines = CONFIG_SETTINGS_LINES.filter((line) => !/^# {3}(?:staleDays|worktreeIdleDays|keep):/.test(line));
    const resolved = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...lines].join('\n')), 'c.yaml') });

    expect(lines).toHaveLength(CONFIG_SETTINGS_LINES.length - 3);
    expect(['cleanupStaleDays', 'cleanupWorktreeIdleDays', 'cleanupKeep'].map((setting) => [
      setting,
      resolved.sources[setting as keyof typeof resolved.sources],
    ])).toEqual([
      ['cleanupStaleDays', 'default'],
      ['cleanupWorktreeIdleDays', 'default'],
      ['cleanupKeep', 'default'],
    ]);
  });

  it('carries the dangerous section, off by default, which resolves from the file once uncommented', () => {
    const dangerous = CONFIG_SETTINGS_LINES.slice(
      CONFIG_SETTINGS_LINES.indexOf('# dangerous:'),
      CONFIG_SETTINGS_LINES.indexOf('# status:'),
    );
    const resolved = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...dangerous].join('\n')), 'c.yaml') });

    expect(dangerous.map((line) => line.replace(/ {2,}#.*$/, ''))).toEqual([
      '# dangerous:',
      '#   acceptStaleRefs: false',
    ]);
    expect([resolved.config.dangerousAcceptStaleRefs, resolved.sources.dangerousAcceptStaleRefs]).toEqual([false, 'file']);
  });

  it('turns acceptStaleRefs on once its line is uncommented with true, so the reading above can fail', () => {
    const lines = CONFIG_SETTINGS_LINES.map((line) => line.replace(/^(# {3}acceptStaleRefs:) false/, '$1 true'));
    const dropped = CONFIG_SETTINGS_LINES.filter((line) => !line.startsWith('#   acceptStaleRefs:'));
    const flipped = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...lines].join('\n')), 'c.yaml') });
    const absent = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...dropped].join('\n')), 'c.yaml') });

    expect([flipped.config.dangerousAcceptStaleRefs, flipped.sources.dangerousAcceptStaleRefs]).toEqual([true, 'file']);
    expect([absent.config.dangerousAcceptStaleRefs, absent.sources.dangerousAcceptStaleRefs]).toEqual([false, 'default']);
  });

  it('carries the status section, the notice on by default, which resolves from the file once uncommented', () => {
    const status = CONFIG_SETTINGS_LINES.slice(
      CONFIG_SETTINGS_LINES.indexOf('# status:'),
      CONFIG_SETTINGS_LINES.indexOf('# tiers:'),
    );
    const resolved = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...status].join('\n')), 'c.yaml') });

    expect(status.map((line) => line.replace(/ {2,}#.*$/, ''))).toEqual([
      '# status:',
      '#   notice: true',
    ]);
    expect([resolved.config.statusNotice, resolved.sources.statusNotice]).toEqual([true, 'file']);
  });

  it('turns the notice off once its line is uncommented with false, so the reading above can fail', () => {
    const lines = CONFIG_SETTINGS_LINES.map((line) => line.replace(/^(# {3}notice:) true/, '$1 false'));
    const dropped = CONFIG_SETTINGS_LINES.filter((line) => !line.startsWith('#   notice:'));
    const flipped = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...lines].join('\n')), 'c.yaml') });
    const absent = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...dropped].join('\n')), 'c.yaml') });

    expect([flipped.config.statusNotice, flipped.sources.statusNotice]).toEqual([false, 'file']);
    expect([absent.config.statusNotice, absent.sources.statusNotice]).toEqual([true, 'default']);
  });

  it('carries the tiers section at its defaults, which resolve from the file once uncommented', () => {
    const tiers = CONFIG_SETTINGS_LINES.slice(
      CONFIG_SETTINGS_LINES.indexOf('# tiers:'),
      CONFIG_SETTINGS_LINES.indexOf('# routing:'),
    );
    const resolved = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...tiers].join('\n')), 'c.yaml') });

    expect(tiers.map((line) => line.replace(/ {2,}#.*$/, ''))).toEqual([
      '# tiers:',
      '#   rafa: on',
      '#   skills: {}',
      '#   agents: {}',
    ]);
    expect([resolved.config.tiersRafa, [...resolved.config.tiersSkills], [...resolved.config.tiersAgents]])
      .toEqual(['on', [], []]);
    expect([resolved.sources.tiersRafa, resolved.sources.tiersSkills, resolved.sources.tiersAgents])
      .toEqual(['file', 'file', 'file']);
  });

  it('turns the rafa tier off once its line is uncommented with off, so the reading above can fail', () => {
    const lines = CONFIG_SETTINGS_LINES.map((line) => line.replace(/^(# {3}rafa:) on/, '$1 off'));
    const flipped = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...lines].join('\n')), 'c.yaml') });

    expect([flipped.config.tiersRafa, flipped.sources.tiersRafa]).toEqual(['off', 'file']);
  });

  it('closes on the routing section, one line per default row, which resolves from the file once uncommented', () => {
    const routing = CONFIG_SETTINGS_LINES.slice(CONFIG_SETTINGS_LINES.indexOf('# routing:'));
    const resolved = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...routing].join('\n')), 'c.yaml') });

    expect(routing.map((line) => line.replace(/ {2,}#.*$/, ''))).toEqual([
      '# routing:',
      '#   prose: doc-updater',
      '#   tests: tdd-guide',
      '#   repair: build-error-resolver',
      '#   review: code-reviewer',
      '#   implementation: loop-implementer',
    ]);
    expect([...resolved.config.routing]).toEqual([...CONFIG_DEFAULTS.routing]);
    expect(resolved.sources.routing).toBe('file');
  });

  it('answers routing from the file row by row once a row is dropped, so the reading above can fail', () => {
    const lines = CONFIG_SETTINGS_LINES.filter((line) => !line.startsWith('#   prose:'));
    const resolved = resolveConfig({ file: parseConfigText(uncommented(['version: 1', ...lines].join('\n')), 'c.yaml') });

    expect(resolved.config.routing.has('prose')).toBe(false);
    expect([...resolved.config.routing.keys()]).toEqual(['tests', 'repair', 'review', 'implementation']);
  });

  it('opens each file with its own header and ends it with a line break', () => {
    expect(projectConfigText().split('\n')[0]).toBe('# rafa project config, written by rafa init and left as it is on a rerun.');
    expect(userConfigText().split('\n')[0]).toBe('# rafa user config, read under every project on this machine, written by');
    expect([projectConfigText().endsWith('\n'), userConfigText().endsWith('\n')]).toEqual([true, true]);
  });
});

describe('writeProjectScope', () => {
  it('writes .rafa/, its config file and the project tree, in that order, under the root', () => {
    const root = freshDir('project');

    const writes = writeProjectScope(root);

    expect(PROJECT_TREE).toEqual(['specs', 'plans', 'runs', 'effort', 'instincts']);
    expect(writes).toEqual([
      created(join(root, '.rafa'), 'directory'),
      created(join(root, '.rafa', 'config.yaml'), 'file'),
      ...PROJECT_TREE.map((name) => created(join(root, '.rafa', name), 'directory')),
    ]);
    expect(readFileSync(join(root, '.rafa', 'config.yaml'), 'utf8')).toBe(projectConfigText());
    expect(readdirSync(join(root, '.rafa')).sort((a, b) => a.localeCompare(b)))
      .toEqual(['config.yaml', 'effort', 'instincts', 'plans', 'runs', 'specs']);
    expect(writes.filter((write) => !write.path.startsWith(`${tempBase}/`))).toEqual([]);
  });

  it('changes no byte and no modification time on a rerun, and answers every path unchanged', () => {
    const root = freshDir('rerun');
    writeProjectScope(root);
    const before = pathsUnder(root).map((path) => [path, lstatSync(path).isDirectory()
      ? 'directory'
      : readFileSync(path, 'utf8')]);
    ageAll(root);

    const writes = writeProjectScope(root);

    expect(writes.map((write) => write.change)).toEqual(Array.from({ length: 7 }, () => 'unchanged'));
    expect(movedSincePast(root)).toEqual([]);
    expect(pathsUnder(root).map((path) => [path, lstatSync(path).isDirectory()
      ? 'directory'
      : readFileSync(path, 'utf8')])).toEqual(before);
  });

  it('finds a modification time moved once a file is rewritten with its own bytes, so the rerun reading can fail', () => {
    const root = freshDir('control');
    writeProjectScope(root);
    ageAll(root);
    const config = join(root, '.rafa', 'config.yaml');

    writeFileSync(config, readFileSync(config, 'utf8'));

    expect(movedSincePast(root)).toEqual([config]);
  });

  it('leaves an existing config file as it was and writes the tree missing beside it', () => {
    const root = freshDir('existing');
    mkdirSync(join(root, '.rafa'));
    writeFileSync(join(root, '.rafa', 'config.yaml'), 'store: ndjson\n');

    const writes = writeProjectScope(root);

    expect(writes.slice(0, 2).map((write) => write.change)).toEqual(['unchanged', 'unchanged']);
    expect(writes.slice(2).map((write) => write.change)).toEqual(Array.from({ length: 5 }, () => 'created'));
    expect(readFileSync(join(root, '.rafa', 'config.yaml'), 'utf8')).toBe('store: ndjson\n');
  });

  it('throws a ScaffoldError naming the path it cannot create, with its cause', () => {
    if (process.getuid?.() === 0) return;
    const root = freshDir('locked');
    chmodSync(root, 0o555);
    let thrown: unknown = null;
    try {
      writeProjectScope(root);
    } catch (error) {
      thrown = error;
    } finally {
      chmodSync(root, 0o755);
    }

    expect(thrown).toBeInstanceOf(ScaffoldError);
    expect((thrown as ScaffoldError).message).toStartWith(`rafa init: ${join(root, '.rafa')} cannot be created (`);
    expect((thrown as ScaffoldError).cause).toBeDefined();
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });
});

describe('writeUserScope', () => {
  it('writes .rafa/, its config file and instincts/ under a home, creating a home that does not exist', () => {
    const home = join(freshDir('user'), 'not-yet');

    const writes = writeUserScope(home);

    expect(USER_TREE).toEqual(['instincts']);
    expect(writes).toEqual([
      created(join(home, '.rafa'), 'directory'),
      created(join(home, '.rafa', 'config.yaml'), 'file'),
      created(join(home, '.rafa', 'instincts'), 'directory'),
    ]);
    expect(readFileSync(join(home, '.rafa', 'config.yaml'), 'utf8')).toBe(userConfigText());
    expect(home.startsWith(`${tempBase}/`)).toBe(true);
  });

  it('leaves a user scope already there as it was, byte and time', () => {
    const home = freshDir('user-rerun');
    mkdirSync(join(home, '.rafa'));
    writeFileSync(join(home, '.rafa', 'config.yaml'), 'tracking:\n  all: true\n');
    writeUserScope(home);
    ageAll(home);

    const writes = writeUserScope(home);

    expect(writes.map((write) => write.change)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(movedSincePast(home)).toEqual([]);
    expect(readFileSync(join(home, '.rafa', 'config.yaml'), 'utf8')).toBe('tracking:\n  all: true\n');
  });
});

describe('scaffoldConflicts', () => {
  it('names nothing for a fresh root and home, and nothing once both scopes are written', () => {
    const root = freshDir('clean-root');
    const home = freshDir('clean-home');

    const before = scaffoldConflicts(root, home);
    writeProjectScope(root);
    writeUserScope(home);

    expect([before, scaffoldConflicts(root, home)]).toEqual([[], []]);
  });

  it('names a .rafa that is a file alone, and the writer then fails at it', () => {
    const root = freshDir('file-scope');
    const home = freshDir('file-scope-home');
    writeFileSync(join(root, '.rafa'), 'not a directory');

    expect(scaffoldConflicts(root, home)).toEqual([`${join(root, '.rafa')} is not a directory`]);
    expect(() => writeProjectScope(root)).toThrow(ScaffoldError);
  });

  it('names a tree directory that is a file, and one that is a link to nothing', () => {
    const root = freshDir('tree');
    const home = freshDir('tree-home');
    mkdirSync(join(root, '.rafa'));
    writeFileSync(join(root, '.rafa', 'runs'), '');
    symlinkSync(join(root, 'nowhere'), join(root, '.rafa', 'effort'));

    expect(scaffoldConflicts(root, home)).toEqual([
      `${join(root, '.rafa', 'runs')} is not a directory`,
      `${join(root, '.rafa', 'effort')} is a link to nothing`,
    ]);
  });

  it('names a config path that is a link to nothing, and accepts a .rafa that links to a directory', () => {
    const root = freshDir('links');
    const home = freshDir('links-home');
    const target = freshDir('links-target');
    symlinkSync(target, join(root, '.rafa'));
    symlinkSync(join(root, 'nowhere.yaml'), join(target, 'config.yaml'));

    expect(scaffoldConflicts(root, home)).toEqual([`${join(root, '.rafa', 'config.yaml')} is a link to nothing`]);
  });

  it('names a user scope that is a file under the home', () => {
    const root = freshDir('user-file');
    const home = freshDir('user-file-home');
    writeFileSync(join(home, '.rafa'), '');

    expect(scaffoldConflicts(root, home)).toEqual([`${join(home, '.rafa')} is not a directory`]);
  });
});
