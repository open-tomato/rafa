/**
 * Tests for scope resolution: the walk up to `.rafa/config.yaml`, the
 * home passed over, the `rafa init` hint and the refusals.
 *
 * Two filesystems drive it. Cases on DISK plant their trees under this
 * file's temporary root and compare every answered root with a real
 * path, because on macOS that root is spelled through `/var`, a link to
 * `/private/var`. Each disk case plants the project its walk stops at
 * inside the temporary root, so no answer depends on what the
 * directories above that root hold. Cases whose walk reaches `/` use an
 * in-memory filesystem that records each path probed, so a walk that
 * found nothing is read against the list of places it looked.
 *
 * No case reads the real home: every home is a directory under the
 * temporary root or a path of the in-memory tree, and each answered
 * user scope is held to sit under it.
 *
 * Each rule is paired with the case that makes it a reading: the home
 * passed over beside the same start with the home pointed elsewhere
 * answering it; a linked start's target climbed beside a project
 * planted at the link's own parent; a directory at the config path
 * found beside a bare `.rafa/` walked past; the user file named in the
 * hint beside a walk that never passed the home; each refusal beside
 * the same seams resolving. Paths are planted at the LITERAL
 * `.rafa/config.yaml`, never through the module's constants.
 *
 * Eighteen module mutations were driven against this file one at a
 * time, each an exact string found once, with `scope.ts` restored
 * sha256-identical after each, and every one reddened at least one
 * case: the start climbed as spelled; the home never passed over, or
 * compared as given; the outermost directory probed first; the walk
 * stopped below `/`; the passed user file left out of the hint; a
 * relative start or home accepted; a home that does not resolve
 * refused; the start refusal's cause dropped, or the raw error
 * rethrown; a default home put back; `SCOPE_DIR` spelled apart from
 * `CONFIG_FILE`; the disk `exists` narrowed to regular files; the start
 * or `rafa init` dropped from the hint; the user scope put under the
 * real home; and the project scope put under the start. That last one
 * first reddened a single case, and only on macOS, where the temporary
 * root is spelled through `/var`, so the nested-subdirectory case pins
 * the project scope too.
 */
import type { ScopeFileSystem, ScopeResolution } from './scope.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '../config-load.js';
import { ConfigError } from '../config.js';

import {
  DISK_FILE_SYSTEM,
  INIT_COMMAND,
  initHint,
  resolveScope,
  SCOPE_DIR,
  ScopeError,
  scopeAt,
} from './scope.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-scope-'));
/** The temporary root's real path, which every root a disk case answers sits under. */
const realTempRoot = realpathSync(tempRoot);
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A fresh directory under the temporary root, spelled as `mkdtempSync` spelled the root. */
function freshDir(): string {
  planted += 1;
  return makeDir(join(tempRoot, `case-${planted}`));
}

/** Creates `path` with its parents and answers it. */
function makeDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/** Plants a config file at the literal `.rafa/config.yaml` under `dir`, and answers its path. */
function plantConfig(dir: string, text = 'version: 1\n'): string {
  const file = join(dir, '.rafa', 'config.yaml');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** The root a resolution found, failing the case when it found none. */
function rootOf(resolution: ScopeResolution): string {
  if (!resolution.found) throw new Error(`expected a project, got the hint: ${resolution.hint}`);
  return resolution.root;
}

/** The hint a resolution answered, failing the case when it found a project. */
function hintOf(resolution: ScopeResolution): string {
  if (resolution.found) throw new Error(`expected the hint, got the project at ${resolution.root}`);
  return resolution.hint;
}

/** A {@link ScopeFileSystem} that also records each path `exists` is asked about. */
interface MemoryFileSystem extends ScopeFileSystem {
  readonly probes: readonly string[];
}

/** What exists in an in-memory tree, and which paths are links to which. */
interface MemoryTree {
  readonly dirs?: readonly string[];
  readonly files?: readonly string[];
  readonly links?: Readonly<Record<string, string>>;
}

/**
 * An in-memory filesystem. A path exists when it, or the target of the
 * link it is, is one of `dirs` or `files`; `realpath` answers that
 * target and throws for anything else, as `realpathSync` does.
 */
function memoryFs({ dirs = [], files = [], links = {} }: MemoryTree): MemoryFileSystem {
  const present = new Set([...dirs, ...files]);
  const probes: string[] = [];
  return {
    probes,
    exists: (path) => {
      probes.push(path);
      return present.has(links[path] ?? path);
    },
    realpath: (path) => {
      const target = links[path] ?? path;
      if (!present.has(target)) throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
      return target;
    },
  };
}

describe('scopeAt and SCOPE_DIR', () => {
  it('places a scope in .rafa under its base, with its config file inside', () => {
    expect(SCOPE_DIR).toBe('.rafa');
    expect(scopeAt('/srv/app')).toEqual({
      dir: '/srv/app/.rafa',
      configFile: '/srv/app/.rafa/config.yaml',
    });
  });
});

describe('resolveScope on disk', () => {
  it('answers the start directory as the root when it holds the config', () => {
    const project = freshDir();
    plantConfig(project);
    const home = join(freshDir(), 'home');

    const resolution = resolveScope(project, { home });

    const root = realpathSync(project);
    expect(resolution).toEqual({
      found: true,
      root,
      home,
      project: { dir: join(root, '.rafa'), configFile: join(root, '.rafa', 'config.yaml') },
      user: { dir: join(home, '.rafa'), configFile: join(home, '.rafa', 'config.yaml') },
    });
    expect(root.startsWith(realTempRoot + sep)).toBe(true);
    expect(home.startsWith(tempRoot + sep)).toBe(true);
  });

  it('climbs from a nested subdirectory to the directory holding the config', () => {
    const project = freshDir();
    plantConfig(project);
    const start = makeDir(join(project, 'a', 'b', 'c'));

    const resolution = resolveScope(start, { home: join(freshDir(), 'home') });

    const root = realpathSync(project);
    expect(rootOf(resolution)).toBe(root);
    if (!resolution.found) return;
    expect(resolution.project).toEqual({
      dir: join(root, '.rafa'),
      configFile: join(root, '.rafa', 'config.yaml'),
    });
  });

  it('probes nearest first and stops at the first directory holding the config', () => {
    const project = freshDir();
    plantConfig(project);
    const start = makeDir(join(project, 'a', 'b'));
    const probes: string[] = [];
    const fs: ScopeFileSystem = {
      exists: (path) => {
        probes.push(path);
        return DISK_FILE_SYSTEM.exists(path);
      },
      realpath: DISK_FILE_SYSTEM.realpath,
    };

    resolveScope(start, { home: join(freshDir(), 'home'), fs });

    const root = realpathSync(project);
    expect(probes).toEqual([
      join(root, 'a', 'b', '.rafa', 'config.yaml'),
      join(root, 'a', '.rafa', 'config.yaml'),
      join(root, '.rafa', 'config.yaml'),
    ]);
  });

  it('answers the nearest project when projects nest, and the outer one beside it', () => {
    const outer = freshDir();
    plantConfig(outer);
    const inner = makeDir(join(outer, 'packages', 'inner'));
    plantConfig(inner);
    const home = join(freshDir(), 'home');

    const fromInner = resolveScope(makeDir(join(inner, 'src')), { home });
    const fromSibling = resolveScope(makeDir(join(outer, 'packages', 'other')), { home });

    expect(rootOf(fromInner)).toBe(realpathSync(inner));
    expect(rootOf(fromSibling)).toBe(realpathSync(outer));
  });

  it('climbs the target of a linked start, not the directory holding the link', () => {
    const base = freshDir();
    const project = join(base, 'project');
    plantConfig(project);
    const target = makeDir(join(project, 'src'));
    const links = makeDir(join(base, 'links'));
    plantConfig(links);
    const link = join(links, 'into-src');
    symlinkSync(target, link);

    expect(rootOf(resolveScope(link, { home: join(freshDir(), 'home') }))).toBe(realpathSync(project));
  });

  it('finds a directory planted at the config path, which loadConfig then refuses', () => {
    const parent = freshDir();
    plantConfig(parent);
    const child = join(parent, 'child');
    makeDir(join(child, '.rafa', 'config.yaml'));

    const resolution = resolveScope(child, { home: join(freshDir(), 'home') });

    expect(rootOf(resolution)).toBe(realpathSync(child));
    if (!resolution.found) return;
    expect(() => loadConfig(resolution, {}, () => {})).toThrow(ConfigError);
  });

  it('walks past a .rafa directory that holds no config file', () => {
    const parent = freshDir();
    plantConfig(parent);
    const child = join(parent, 'child');
    makeDir(join(child, '.rafa', 'plans'));

    expect(rootOf(resolveScope(child, { home: join(freshDir(), 'home') }))).toBe(realpathSync(parent));
  });

  it('passes over the home holding the user config and resolves the project above it', () => {
    const base = freshDir();
    plantConfig(base);
    const home = join(base, 'home');
    plantConfig(home);
    const start = makeDir(join(home, 'work'));

    const underHome = resolveScope(start, { home });
    const elsewhere = resolveScope(start, { home: join(freshDir(), 'home') });

    expect(rootOf(underHome)).toBe(realpathSync(base));
    expect(rootOf(elsewhere)).toBe(realpathSync(home));
  });

  it('passes over a home spelled through a link, keeping the home as given', () => {
    const base = freshDir();
    plantConfig(base);
    const home = join(base, 'home');
    plantConfig(home);
    const start = makeDir(join(home, 'work'));
    const linkedHome = join(freshDir(), 'home-link');
    symlinkSync(home, linkedHome);

    const resolution = resolveScope(start, { home: linkedHome });

    expect(rootOf(resolution)).toBe(realpathSync(base));
    expect(resolution.user).toEqual({
      dir: join(linkedHome, '.rafa'),
      configFile: join(linkedHome, '.rafa', 'config.yaml'),
    });
  });

  it('answers the roots loadConfig reads the project and user files from', () => {
    const project = freshDir();
    plantConfig(project, 'version: 1\nstore: ndjson\n');
    const home = makeDir(join(freshDir(), 'home'));
    const userFile = plantConfig(home, 'version: 1\nplan:\n  inject: task\n');

    const resolution = resolveScope(makeDir(join(project, 'src')), { home });
    if (!resolution.found) throw new Error(resolution.hint);
    const loaded = loadConfig(resolution, {}, () => {});

    expect(loaded.config.store).toBe('ndjson');
    expect(loaded.sources.store).toBe('file');
    expect(loaded.config.inject).toBe('task');
    expect(loaded.sources.inject).toBe('user');
    expect(loaded.path).toBe(join(realpathSync(project), '.rafa', 'config.yaml'));
    expect(loaded.userPath).toBe(userFile);
  });
});

describe('resolveScope without a project', () => {
  const tree: MemoryTree = { dirs: ['/', '/srv', '/srv/app', '/srv/app/src', '/home', '/home/op'] };

  it('answers the init hint after probing every directory up to the filesystem root', () => {
    const fs = memoryFs(tree);

    const resolution = resolveScope('/srv/app/src', { home: '/home/op', fs });

    expect(resolution).toEqual({
      found: false,
      start: '/srv/app/src',
      home: '/home/op',
      user: { dir: '/home/op/.rafa', configFile: '/home/op/.rafa/config.yaml' },
      hint: initHint('/srv/app/src'),
    });
    expect(fs.probes).toEqual([
      '/srv/app/src/.rafa/config.yaml',
      '/srv/app/.rafa/config.yaml',
      '/srv/.rafa/config.yaml',
      '/.rafa/config.yaml',
    ]);
  });

  it('finds a config at the filesystem root, the last directory the walk probes', () => {
    const fs = memoryFs({ ...tree, files: ['/.rafa/config.yaml'] });

    expect(rootOf(resolveScope('/srv/app/src', { home: '/home/op', fs }))).toBe('/');
  });

  it('names the start directory, the config file and rafa init in the hint', () => {
    const hint = hintOf(resolveScope('/srv/app/src', { home: '/home/op', fs: memoryFs(tree) }));

    expect(INIT_COMMAND).toBe('rafa init');
    expect(hint).toContain('/srv/app/src');
    expect(hint).toContain('.rafa/config.yaml');
    expect(hint).toContain('`rafa init`');
    expect(hint).not.toContain('user scope');
  });

  it('names the user config as marking no project when the walk passed over the home', () => {
    const fs = memoryFs({
      dirs: ['/', '/home', '/home/op', '/home/op/work', '/home/other'],
      files: ['/home/op/.rafa/config.yaml'],
    });

    const fromWork = resolveScope('/home/op/work', { home: '/home/op', fs });
    const fromHome = resolveScope('/home/op', { home: '/home/op', fs });
    const homeElsewhere = resolveScope('/home/op/work', { home: '/home/other', fs });

    expect(hintOf(fromWork)).toBe(initHint('/home/op/work', '/home/op/.rafa/config.yaml'));
    expect(hintOf(fromWork)).toContain('/home/op/.rafa/config.yaml is the user scope');
    expect(hintOf(fromHome)).toBe(initHint('/home/op', '/home/op/.rafa/config.yaml'));
    expect(rootOf(homeElsewhere)).toBe('/home/op');
  });

  it('leaves the user config out of the hint when the walk never passed the home', () => {
    const fs = memoryFs({
      dirs: ['/', '/home', '/home/op', '/srv', '/srv/app'],
      files: ['/home/op/.rafa/config.yaml'],
    });

    const hint = hintOf(resolveScope('/srv/app', { home: '/home/op', fs }));

    expect(hint).toBe(initHint('/srv/app'));
    expect(hint).not.toContain('user scope');
  });

  it('names the home as given in the hint when it is spelled through a link', () => {
    const fs = memoryFs({
      dirs: ['/', '/home', '/home/op', '/home/op/work'],
      files: ['/home/op/.rafa/config.yaml'],
      links: { '/Users/op': '/home/op' },
    });

    const hint = hintOf(resolveScope('/home/op/work', { home: '/Users/op', fs }));

    expect(hint).toBe(initHint('/home/op/work', '/Users/op/.rafa/config.yaml'));
  });

  it('reads a home that does not resolve as holding nothing', () => {
    const fs = memoryFs({ dirs: ['/', '/srv', '/srv/app'], files: ['/srv/app/.rafa/config.yaml'] });

    const resolution = resolveScope('/srv/app', { home: '/nowhere', fs });

    expect(rootOf(resolution)).toBe('/srv/app');
    expect(resolution.user.configFile).toBe('/nowhere/.rafa/config.yaml');
  });
});

describe('resolveScope refusals', () => {
  const tree: MemoryTree = { dirs: ['/', '/work', '/home', '/home/op'] };

  it('refuses a relative start directory before probing, and resolves the absolute one', () => {
    const fs = memoryFs(tree);

    expect(() => resolveScope('work', { home: '/home/op', fs })).toThrow(
      'rafa scope: start directory is "work", expected an absolute path',
    );
    expect(fs.probes).toEqual([]);
    expect(hintOf(resolveScope('/work', { home: '/home/op', fs }))).toBe(initHint('/work'));
  });

  it('refuses a relative home before probing, and resolves with the absolute one', () => {
    const fs = memoryFs(tree);

    expect(() => resolveScope('/work', { home: 'home/op', fs })).toThrow(
      'rafa scope: home directory is "home/op", expected an absolute path',
    );
    expect(fs.probes).toEqual([]);
    expect(hintOf(resolveScope('/work', { home: '/home/op', fs }))).toBe(initHint('/work'));
  });

  it('fails loudly when the home is left out', () => {
    const seams = { fs: memoryFs(tree) } as unknown as { home: string };

    expect(() => resolveScope('/work', seams)).toThrow(TypeError);
  });

  it('refuses a start directory that does not resolve, naming it, and resolves it once it exists', () => {
    const project = freshDir();
    plantConfig(project);
    const missing = join(project, 'missing');
    const home = join(freshDir(), 'home');

    let refusal: unknown = null;
    try {
      resolveScope(missing, { home });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ScopeError);
    expect(refusal).toBeInstanceOf(Error);
    const { name, message, cause } = refusal as ScopeError;
    expect(name).toBe('ScopeError');
    expect(message).toStartWith(`rafa scope: start directory ${missing} does not resolve (`);
    expect(cause).toBeInstanceOf(Error);

    makeDir(missing);
    expect(rootOf(resolveScope(missing, { home }))).toBe(realpathSync(project));
  });
});
