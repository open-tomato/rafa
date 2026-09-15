/**
 * Tests for the init root candidates: the base, the monorepo walk, the
 * refusals and the git probe.
 *
 * Most cases run over an in-memory filesystem and a stand-in git
 * probe, because every monorepo walk climbs to `/` and its answer would
 * otherwise depend on what the machine's directories above the
 * temporary root hold. Disk cases measure the defaults: the disk
 * filesystem, the real `git`, and the refusal of the machine's own `/`
 * and `/var`. The disk walk case first reads every directory above the
 * temporary root and requires that none holds a marker, so a stray file
 * there fails that reading by name rather than the case by surprise.
 *
 * No case reads the real home: every home is a path of the in-memory
 * tree or a directory under the temporary root.
 *
 * Each rule is paired with the case that makes it a reading: a refused
 * directory beside a directory under it; a home refused beside the same
 * path with the home pointed elsewhere; an unwritable, missing or
 * non-directory path beside the writable directory; a marker below the
 * outermost beside the tree without the outer one; a directory passed
 * over by name beside the same tree with the home elsewhere; a marker
 * below the toplevel beside one above it; git's no-repository answer
 * beside a broken `.git` file it must not be read as. Marker names,
 * refused paths and reasons are written LITERALLY. The one loop over
 * `REFUSED_ROOTS` and the disk case quoting `HOME_WHY` read constants
 * the first two cases pin to literals.
 *
 * Thirty-two module mutations were driven against this file one at a
 * time, each an exact string found once, with `roots.ts` restored
 * sha256-identical after each, and thirty-one reddened at least one
 * case: the refusal by name kept only for a path that does not
 * resolve; the given path, the refused directories or the home
 * compared as spelled; a refusal by prefix; the home, `/usr`, the
 * directory check or the refusal of a missing path dropped;
 * writability read on the link rather than its target; the walk
 * passing over nothing, climbing from the start, or taking the
 * innermost marker; the marker files read as absent; `package.json`
 * marking without `workspaces`; a broken one thrown, or its warning
 * dropped; git probed from the start as spelled; the toplevel left
 * unresolved, or trimmed; every exit 128 read as no repository; a
 * spawn error read only beside a null status; a monorepo root equal to
 * the base offered twice; a candidate's markers or refusal dropped; a
 * relative start, toplevel or home accepted; the start refusal's cause
 * dropped; the linked reason naming only the given path; and the
 * default git probe replaced. The survivor drops `LC_ALL=C` from the
 * probe: the git measured here printed the same line with
 * `LANGUAGE=de`, so no case can tell a translated line from git's own.
 */
import type { GitToplevelProbe, RootCandidate, RootsFileSystem } from './roots.js';

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  DISK_ROOTS_FILE_SYSTEM,
  gitToplevel,
  HOME_WHY,
  MONOREPO_MARKER_FILES,
  NOT_A_REPOSITORY,
  REFUSED_ROOTS,
  rootCandidates,
  rootRefusal,
  RootsError,
} from './roots.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-roots-'));
/** The temporary root's real path, which every disk candidate sits under. */
const realTempRoot = realpathSync(tempRoot);
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A fresh directory under the temporary root. */
function freshDir(): string {
  planted += 1;
  return makeDir(join(tempRoot, `case-${planted}`));
}

/** Creates `path` with its parents and answers it. */
function makeDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/** Writes `text` to `file`, creating its parents. */
function plantFile(file: string, text = ''): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** Runs git in `cwd` proof against hooks, signing and a missing identity. */
function git(cwd: string, ...args: string[]): void {
  const run = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
}

/** What exists in an in-memory tree. */
interface MemoryTree {
  readonly dirs?: readonly string[];
  /** Each file's path and its text. */
  readonly files?: Readonly<Record<string, string>>;
  /** Paths that are links, each to the path it names. */
  readonly links?: Readonly<Record<string, string>>;
  /** Paths whose `assertWritable` throws. */
  readonly readOnly?: readonly string[];
}

/**
 * An in-memory {@link RootsFileSystem}. A path exists when it, or the
 * target of the link it is, is one of `dirs` or `files`; `realpath`
 * answers that target and throws for anything else, as `realpathSync`
 * does.
 */
function memoryFs({ dirs = [], files = {}, links = {}, readOnly = [] }: MemoryTree): RootsFileSystem {
  const dirSet = new Set(dirs);
  const target = (path: string): string => links[path] ?? path;
  const present = (path: string): boolean => dirSet.has(path) || Object.hasOwn(files, path);
  return {
    exists: (path) => present(target(path)),
    realpath: (path) => {
      if (!present(target(path))) throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
      return target(path);
    },
    readFile: (path) => {
      const text = files[target(path)];
      if (text === undefined) throw new Error(`EISDIR: illegal operation on a directory, read '${path}'`);
      return text;
    },
    isDirectory: (path) => dirSet.has(target(path)),
    assertWritable: (path) => {
      if (readOnly.includes(target(path))) throw new Error(`EACCES: permission denied, access '${path}'`);
    },
  };
}

/** A git probe answering no repository. */
const noRepository: GitToplevelProbe = () => null;

/** A git probe answering `toplevel`, recording each directory it is asked about. */
function repositoryAt(toplevel: string): GitToplevelProbe & { readonly asked: readonly string[] } {
  const asked: string[] = [];
  const probe = (dir: string): string => {
    asked.push(dir);
    return toplevel;
  };
  return Object.assign(probe, { asked });
}

/** The candidate paths of an answer, in order. */
function pathsOf(candidates: readonly RootCandidate[]): readonly string[] {
  return candidates.map((candidate) => candidate.path);
}

/** Every directory of the spec's refused list, each existing in the in-memory trees. */
const SYSTEM_DIRS = ['/', '/var', '/etc', '/usr', '/home', '/Users'];

/** A tree holding the refused directories, a home and a directory under each. */
const TREE: MemoryTree = {
  dirs: [
    ...SYSTEM_DIRS,
    '/var/folders',
    '/etc/ssh',
    '/usr/local',
    '/home/op',
    '/home/op/work',
    '/Users/op',
    '/srv',
    '/srv/app',
  ],
};

/** A monorepo in the in-memory tree: `/srv/mono/packages/app/src`. */
const MONO_DIRS = ['/', '/srv', '/srv/mono', '/srv/mono/packages', '/srv/mono/packages/app', '/srv/mono/packages/app/src'];

describe('the refused roots and markers', () => {
  it('names the six directories of the spec in its order, each with a reason', () => {
    expect(REFUSED_ROOTS.map((root) => root.path)).toEqual(['/', '/var', '/etc', '/usr', '/home', '/Users']);
    for (const root of REFUSED_ROOTS) expect(root.why.length).toBeGreaterThan(0);
    expect(HOME_WHY).toBe('is the home directory, whose .rafa/ is the user scope');
  });

  it('names the four marker files of the spec and the no-repository line git prints', () => {
    expect([...MONOREPO_MARKER_FILES]).toEqual(['turbo.json', 'pnpm-workspace.yaml', 'nx.json', 'lerna.json']);
    expect('fatal: not a git repository (or any of the parent directories): .git').toStartWith(NOT_A_REPOSITORY);
    expect('fatal: not a git repository: /nowhere/x').not.toStartWith(NOT_A_REPOSITORY);
  });
});

describe('rootRefusal by name', () => {
  const fs = memoryFs(TREE);
  const under: Record<string, string> = {
    '/': '/srv',
    '/var': '/var/folders',
    '/etc': '/etc/ssh',
    '/usr': '/usr/local',
    '/home': '/home/op/work',
    '/Users': '/Users/op',
  };

  for (const { path, why } of REFUSED_ROOTS) {
    it(`refuses ${path} naming its reason, and accepts ${under[path]} under it`, () => {
      expect(rootRefusal(path, { home: '/home/op', fs })).toEqual({ kind: 'system', path, reason: `${path} ${why}` });
      expect(rootRefusal(under[path] ?? '', { home: '/home/op', fs })).toBeNull();
    });
  }

  it('refuses a path resolving to a refused directory, naming both, and accepts a directory under it', () => {
    const linked = memoryFs({
      dirs: ['/', '/private', '/private/var', '/private/var/folders'],
      links: { '/var': '/private/var' },
    });

    expect(rootRefusal('/private/var', { home: '/home/op', fs: linked })).toEqual({
      kind: 'system',
      path: '/private/var',
      reason: '/private/var is the same directory as /var, which holds system state',
    });
    expect(rootRefusal('/var', { home: '/home/op', fs: linked })?.reason).toBe('/var holds system state');
    expect(rootRefusal('/private/var/folders', { home: '/home/op', fs: linked })).toBeNull();
    expect(rootRefusal('/private', { home: '/home/op', fs: linked })).toBeNull();
  });

  it('compares a refused directory that does not resolve as spelled', () => {
    const noHomes = memoryFs({ dirs: ['/', '/srv'] });

    expect(rootRefusal('/home/', { home: '/srv/op', fs: noHomes })).toEqual({
      kind: 'system',
      path: '/home/',
      reason: '/home/ is the same directory as /home, which holds the home directories of every user',
    });
  });

  it('refuses by name before reading permission, where the path is also unwritable', () => {
    const readOnly = memoryFs({ ...TREE, readOnly: ['/', '/usr', '/srv'] });

    expect(rootRefusal('/', { home: '/home/op', fs: readOnly })?.kind).toBe('system');
    expect(rootRefusal('/usr', { home: '/home/op', fs: readOnly })?.kind).toBe('system');
    expect(rootRefusal('/srv', { home: '/home/op', fs: readOnly })?.kind).toBe('unwritable');
  });
});

describe('rootRefusal of the home', () => {
  it('refuses the home directory, and the same path once the home is elsewhere', () => {
    const fs = memoryFs(TREE);

    expect(rootRefusal('/home/op', { home: '/home/op', fs })).toEqual({
      kind: 'home',
      path: '/home/op',
      reason: '/home/op is the home directory, whose .rafa/ is the user scope',
    });
    expect(rootRefusal('/home/op', { home: '/Users/op', fs })).toBeNull();
  });

  it('refuses the directory a linked home resolves to, and accepts a directory under it', () => {
    const fs = memoryFs({ dirs: ['/', '/home', '/home/op', '/home/op/work'], links: { '/Users/op': '/home/op' } });

    expect(rootRefusal('/home/op', { home: '/Users/op', fs })).toEqual({
      kind: 'home',
      path: '/home/op',
      reason: '/home/op is the same directory as /Users/op, which is the home directory, whose .rafa/ is the user scope',
    });
    expect(rootRefusal('/Users/op', { home: '/Users/op', fs })?.kind).toBe('home');
    expect(rootRefusal('/home/op/work', { home: '/Users/op', fs })).toBeNull();
  });

  it('compares a home that does not resolve as spelled', () => {
    const fs = memoryFs({ dirs: ['/', '/srv'] });

    expect(rootRefusal('/srv/op/', { home: '/srv/op', fs })?.kind).toBe('home');
    expect(rootRefusal('/srv', { home: '/srv/op', fs })).toBeNull();
  });
});

describe('rootRefusal for writing', () => {
  it('refuses a directory this user may not write, quoting why, and accepts its writable sibling', () => {
    const fs = memoryFs({ dirs: ['/', '/srv', '/srv/locked', '/srv/open'], readOnly: ['/srv/locked'] });

    expect(rootRefusal('/srv/locked', { home: '/home/op', fs })).toEqual({
      kind: 'unwritable',
      path: '/srv/locked',
      reason: '/srv/locked is not writable by this user (EACCES: permission denied, access \'/srv/locked\')',
    });
    expect(rootRefusal('/srv/open', { home: '/home/op', fs })).toBeNull();
  });

  it('refuses a path that does not resolve, and accepts it once it exists', () => {
    const missing = rootRefusal('/srv/new', { home: '/home/op', fs: memoryFs({ dirs: ['/', '/srv'] }) });
    const present = rootRefusal('/srv/new', { home: '/home/op', fs: memoryFs({ dirs: ['/', '/srv', '/srv/new'] }) });

    expect(missing?.kind).toBe('unwritable');
    expect(missing?.reason).toStartWith('/srv/new does not resolve, so no project tree can be written under it (ENOENT');
    expect(present).toBeNull();
  });

  it('refuses a file, and accepts a directory at the same path', () => {
    const file = rootRefusal('/srv/app', { home: '/home/op', fs: memoryFs({ dirs: ['/', '/srv'], files: { '/srv/app': '' } }) });

    expect(file).toEqual({
      kind: 'unwritable',
      path: '/srv/app',
      reason: '/srv/app is not a directory, so no project tree can be written under it',
    });
    expect(rootRefusal('/srv/app', { home: '/home/op', fs: memoryFs(TREE) })).toBeNull();
  });

  it('checks the real path for writing when the path is a link', () => {
    const fs = memoryFs({ dirs: ['/', '/srv', '/srv/locked'], links: { '/srv/link': '/srv/locked' }, readOnly: ['/srv/locked'] });
    const asked: string[] = [];
    const recording: RootsFileSystem = {
      ...fs,
      isDirectory: (path) => {
        asked.push(path);
        return fs.isDirectory(path);
      },
      assertWritable: (path) => {
        asked.push(path);
        fs.assertWritable(path);
      },
    };

    expect(rootRefusal('/srv/link', { home: '/home/op', fs: recording })?.kind).toBe('unwritable');
    expect(asked).toEqual(['/srv/locked', '/srv/locked']);
  });
});

describe('rootRefusal argument checks', () => {
  const fs = memoryFs(TREE);

  it('refuses a relative path, and answers for the absolute one', () => {
    expect(() => rootRefusal('srv/app', { home: '/home/op', fs })).toThrow(
      new RootsError('root is "srv/app", expected an absolute path'),
    );
    expect(rootRefusal('/srv/app', { home: '/home/op', fs })).toBeNull();
  });

  it('refuses a relative home, and answers with the absolute one', () => {
    expect(() => rootRefusal('/srv/app', { home: 'home/op', fs })).toThrow(
      'rafa roots: home directory is "home/op", expected an absolute path',
    );
    expect(rootRefusal('/srv/app', { home: '/home/op', fs })).toBeNull();
  });
});

describe('rootRefusal on disk', () => {
  it('accepts a writable directory under the temporary root, however far under a refused root it sits', () => {
    const dir = freshDir();

    expect(rootRefusal(dir, { home: join(freshDir(), 'home') })).toBeNull();
    expect(rootRefusal(realTempRoot, { home: join(freshDir(), 'home') })).toBeNull();
  });

  it('refuses the machine root and /var by name, through their real paths too', () => {
    const home = join(freshDir(), 'home');

    expect(rootRefusal('/', { home })).toEqual({ kind: 'system', path: '/', reason: '/ is the filesystem root' });
    expect(rootRefusal('/var', { home })?.reason).toBe('/var holds system state');
    expect(rootRefusal(realpathSync('/var'), { home })?.kind).toBe('system');
  });

  it('refuses a scratch home through its real path, and accepts a directory under it', () => {
    const home = makeDir(join(freshDir(), 'home'));
    const work = makeDir(join(home, 'work'));

    expect(rootRefusal(home, { home })?.reason).toBe(`${home} ${HOME_WHY}`);
    expect(rootRefusal(realpathSync(home), { home })?.kind).toBe('home');
    expect(rootRefusal(work, { home })).toBeNull();
  });

  it('refuses a missing path and a file, naming the error for the missing one', () => {
    const dir = freshDir();
    const home = join(freshDir(), 'home');
    const file = plantFile(join(dir, 'file.txt'), 'x');

    expect(rootRefusal(join(dir, 'missing'), { home })?.reason).toStartWith(
      `${join(dir, 'missing')} does not resolve, so no project tree can be written under it (ENOENT`,
    );
    expect(rootRefusal(file, { home })?.reason).toBe(`${file} is not a directory, so no project tree can be written under it`);
  });

  it.skipIf(process.getuid?.() === 0)('refuses a directory without write permission, and accepts it once writable', () => {
    const locked = freshDir();
    const home = join(freshDir(), 'home');
    chmodSync(locked, 0o555);
    try {
      const refusal = rootRefusal(locked, { home });
      expect(refusal?.kind).toBe('unwritable');
      expect(refusal?.reason).toStartWith(`${locked} is not writable by this user (EACCES`);
    } finally {
      chmodSync(locked, 0o755);
    }
    expect(rootRefusal(locked, { home })).toBeNull();
  });
});

describe('gitToplevel on disk', () => {
  it('answers the real toplevel from a subdirectory, and null from a directory in no repository', () => {
    const repo = freshDir();
    git(repo, 'init', '-q');
    const sub = makeDir(join(repo, 'a', 'b'));
    const plain = freshDir();

    expect(gitToplevel(sub)).toBe(realpathSync(repo));
    expect(gitToplevel(plain)).toBeNull();
  });

  it('keeps a toplevel with non-ASCII and spaced names byte for byte', () => {
    const repo = makeDir(join(freshDir(), 'répo with space '));
    git(repo, 'init', '-q');

    expect(gitToplevel(makeDir(join(repo, 'sub')))).toBe(realpathSync(repo));
  });

  it('throws for a .git file naming a missing directory, and answers null once it is gone', () => {
    const dir = freshDir();
    const gitFile = plantFile(join(dir, '.git'), 'gitdir: /nowhere/rafa-roots\n');

    expect(() => gitToplevel(dir)).toThrow(RootsError);
    expect(() => gitToplevel(dir)).toThrow('exit 128: fatal: not a git repository: /nowhere/rafa-roots');
    rmSync(gitFile);
    expect(gitToplevel(dir)).toBeNull();
  });

  it('throws when git cannot run in a directory that does not exist', () => {
    const missing = join(freshDir(), 'missing');

    expect(() => gitToplevel(missing)).toThrow(`rafa roots: git could not run in ${missing} (`);
  });
});

describe('rootCandidates over the in-memory tree', () => {
  it('answers the start itself outside a repository, as its only candidate', () => {
    const fs = memoryFs({ dirs: ['/', '/srv', '/srv/app', '/srv/app/src'] });

    expect(rootCandidates('/srv/app/src', { home: '/home/op', fs, gitToplevel: noRepository })).toEqual({
      start: '/srv/app/src',
      candidates: [{ path: '/srv/app/src', source: 'directory', markers: [], refusal: null }],
      warnings: [],
    });
  });

  it('answers the real start outside a repository when the start is a link', () => {
    const fs = memoryFs({ dirs: ['/', '/srv', '/srv/app'], links: { '/link': '/srv/app' } });

    const answer = rootCandidates('/link', { home: '/home/op', fs, gitToplevel: noRepository });

    expect(answer.start).toBe('/link');
    expect(pathsOf(answer.candidates)).toEqual(['/srv/app']);
  });

  it('answers the git toplevel inside a repository, probing git from the real start', () => {
    const fs = memoryFs({ dirs: ['/', '/srv', '/srv/app', '/srv/app/src'], links: { '/link': '/srv/app/src' } });
    const probe = repositoryAt('/srv/app');

    const answer = rootCandidates('/link', { home: '/home/op', fs, gitToplevel: probe });

    expect(answer.candidates).toEqual([{ path: '/srv/app', source: 'git-toplevel', markers: [], refusal: null }]);
    expect(probe.asked).toEqual(['/srv/app/src']);
  });

  it('answers the real path of a toplevel the probe spells through a link', () => {
    const fs = memoryFs({ dirs: ['/', '/srv', '/srv/app', '/srv/app/src'], links: { '/app-link': '/srv/app' } });

    const answer = rootCandidates('/srv/app/src', { home: '/home/op', fs, gitToplevel: repositoryAt('/app-link') });

    expect(pathsOf(answer.candidates)).toEqual(['/srv/app']);
  });

  it('offers the outermost monorepo root beside the base, passing over a marker below it', () => {
    const files = {
      '/srv/mono/pnpm-workspace.yaml': 'packages: []\n',
      '/srv/mono/packages/turbo.json': '{}',
    };
    const seams = { home: '/home/op', gitToplevel: repositoryAt('/srv/mono/packages/app') };

    const both = rootCandidates('/srv/mono/packages/app/src', { ...seams, fs: memoryFs({ dirs: MONO_DIRS, files }) });
    const innerOnly = rootCandidates('/srv/mono/packages/app/src', {
      ...seams,
      fs: memoryFs({ dirs: MONO_DIRS, files: { '/srv/mono/packages/turbo.json': '{}' } }),
    });

    expect(both.candidates).toEqual([
      { path: '/srv/mono/packages/app', source: 'git-toplevel', markers: [], refusal: null },
      { path: '/srv/mono', source: 'monorepo', markers: ['pnpm-workspace.yaml'], refusal: null },
    ]);
    expect(pathsOf(innerOnly.candidates)).toEqual(['/srv/mono/packages/app', '/srv/mono/packages']);
  });

  for (const marker of ['turbo.json', 'pnpm-workspace.yaml', 'nx.json', 'lerna.json']) {
    it(`reads ${marker} alone as a marker`, () => {
      const fs = memoryFs({ dirs: MONO_DIRS, files: { [`/srv/mono/${marker}`]: '' } });

      const answer = rootCandidates('/srv/mono/packages/app', { home: '/home/op', fs, gitToplevel: noRepository });

      expect(answer.candidates[1]).toEqual({ path: '/srv/mono', source: 'monorepo', markers: [marker], refusal: null });
    });
  }

  it('lists every marker at a directory, package.json first and the rest in the spec order', () => {
    const fs = memoryFs({
      dirs: MONO_DIRS,
      files: {
        '/srv/mono/lerna.json': '{}',
        '/srv/mono/nx.json': '{}',
        '/srv/mono/pnpm-workspace.yaml': '',
        '/srv/mono/turbo.json': '{}',
        '/srv/mono/package.json': '{"workspaces":["packages/*"]}',
      },
    });

    const answer = rootCandidates('/srv/mono/packages/app', { home: '/home/op', fs, gitToplevel: noRepository });

    expect(answer.candidates[1]?.markers).toEqual(['package.json', 'turbo.json', 'pnpm-workspace.yaml', 'nx.json', 'lerna.json']);
  });

  it('reads a package.json as a marker only when it parses to an object with a workspaces key', () => {
    const outcome = (text: string): readonly string[] => {
      const fs = memoryFs({ dirs: MONO_DIRS, files: { '/srv/mono/package.json': text } });
      return pathsOf(rootCandidates('/srv/mono/packages/app', { home: '/home/op', fs, gitToplevel: noRepository }).candidates);
    };
    const marked = ['/srv/mono/packages/app', '/srv/mono'];
    const unmarked = ['/srv/mono/packages/app'];

    expect(outcome('{"workspaces":["packages/*"]}')).toEqual(marked);
    expect(outcome('{"workspaces":{"packages":["packages/*"]}}')).toEqual(marked);
    expect(outcome('{"workspaces":null}')).toEqual(marked);
    expect(outcome('{"name":"mono","private":true}')).toEqual(unmarked);
    expect(outcome('["workspaces"]')).toEqual(unmarked);
    expect(outcome('"workspaces"')).toEqual(unmarked);
    expect(outcome('null')).toEqual(unmarked);
  });

  it('answers one candidate carrying its markers when the outermost marker is at the base', () => {
    const fs = memoryFs({ dirs: MONO_DIRS, files: { '/srv/mono/turbo.json': '{}' } });

    const answer = rootCandidates('/srv/mono/packages', { home: '/home/op', fs, gitToplevel: repositoryAt('/srv/mono') });

    expect(answer.candidates).toEqual([{ path: '/srv/mono', source: 'git-toplevel', markers: ['turbo.json'], refusal: null }]);
  });

  it('warns about a package.json that does not parse or cannot be read, and walks on above it', () => {
    const fs = memoryFs({
      dirs: [...MONO_DIRS, '/srv/mono/packages/package.json'],
      files: { '/srv/mono/packages/app/package.json': '{ nope', '/srv/mono/nx.json': '{}' },
    });

    const answer = rootCandidates('/srv/mono/packages/app', { home: '/home/op', fs, gitToplevel: noRepository });

    expect(pathsOf(answer.candidates)).toEqual(['/srv/mono/packages/app', '/srv/mono']);
    expect(answer.warnings).toHaveLength(2);
    expect(answer.warnings[0]).toStartWith('/srv/mono/packages/app/package.json was not read as a monorepo marker (');
    expect(answer.warnings[1]).toBe(
      '/srv/mono/packages/package.json was not read as a monorepo marker '
      + '(EISDIR: illegal operation on a directory, read \'/srv/mono/packages/package.json\')',
    );
  });

  it('passes over the home and the refused directories, and takes the home once it is elsewhere', () => {
    const tree: MemoryTree = {
      dirs: ['/', '/home', '/home/op', '/home/op/work', '/home/op/work/mono', '/home/op/work/mono/app', '/Users', '/Users/op'],
      files: {
        '/turbo.json': '{}',
        '/home/lerna.json': '{}',
        '/home/op/package.json': '{"workspaces":[]}',
        '/home/op/work/mono/nx.json': '{}',
      },
    };
    const fs = memoryFs(tree);
    const start = '/home/op/work/mono/app';

    const underHome = rootCandidates(start, { home: '/home/op', fs, gitToplevel: noRepository });
    const homeElsewhere = rootCandidates(start, { home: '/Users/op', fs, gitToplevel: noRepository });

    expect(pathsOf(underHome.candidates)).toEqual([start, '/home/op/work/mono']);
    expect(homeElsewhere.candidates[1]).toEqual({
      path: '/home/op',
      source: 'monorepo',
      markers: ['package.json'],
      refusal: null,
    });
  });

  it('passes over a refused directory it reaches through its real path', () => {
    const fs = memoryFs({
      dirs: ['/', '/private', '/private/var', '/private/var/folders', '/private/var/folders/app'],
      files: { '/private/var/turbo.json': '{}', '/private/nx.json': '{}' },
      links: { '/var': '/private/var' },
    });

    const answer = rootCandidates('/private/var/folders/app', { home: '/home/op', fs, gitToplevel: noRepository });

    expect(pathsOf(answer.candidates)).toEqual(['/private/var/folders/app', '/private']);
  });

  it('offers a monorepo root this user may not write, carrying its refusal', () => {
    const fs = memoryFs({ dirs: MONO_DIRS, files: { '/srv/mono/turbo.json': '{}' }, readOnly: ['/srv/mono'] });

    const answer = rootCandidates('/srv/mono/packages/app', { home: '/home/op', fs, gitToplevel: noRepository });

    expect(answer.candidates[0].refusal).toBeNull();
    expect(answer.candidates[1]?.refusal?.kind).toBe('unwritable');
    expect(answer.candidates[1]?.refusal?.path).toBe('/srv/mono');
  });

  it('offers the home as a refused base when the start is the home, reading no marker there', () => {
    const fs = memoryFs({ ...TREE, files: { '/home/op/turbo.json': '{}' } });

    const answer = rootCandidates('/home/op', { home: '/home/op', fs, gitToplevel: noRepository });

    expect(answer.candidates).toEqual([{
      path: '/home/op',
      source: 'directory',
      markers: [],
      refusal: { kind: 'home', path: '/home/op', reason: '/home/op is the home directory, whose .rafa/ is the user scope' },
    }]);
  });

  it('offers only the refused home when the home is the git toplevel above the start', () => {
    const fs = memoryFs(TREE);

    const answer = rootCandidates('/home/op/work', { home: '/home/op', fs, gitToplevel: repositoryAt('/home/op') });

    expect(pathsOf(answer.candidates)).toEqual(['/home/op']);
    expect(answer.candidates[0].refusal?.kind).toBe('home');
  });

  it('walks from the base and not the start, so a marker below the toplevel is no marker', () => {
    const dirs = ['/', '/srv', '/srv/repo', '/srv/repo/pkg', '/srv/repo/pkg/a'];
    const seams = { home: '/home/op', gitToplevel: repositoryAt('/srv/repo') };

    const below = rootCandidates('/srv/repo/pkg/a', { ...seams, fs: memoryFs({ dirs, files: { '/srv/repo/pkg/turbo.json': '{}' } }) });
    const above = rootCandidates('/srv/repo/pkg/a', { ...seams, fs: memoryFs({ dirs, files: { '/srv/turbo.json': '{}' } }) });

    expect(pathsOf(below.candidates)).toEqual(['/srv/repo']);
    expect(pathsOf(above.candidates)).toEqual(['/srv/repo', '/srv']);
  });
});

describe('rootCandidates refusals', () => {
  const fs = memoryFs({ dirs: ['/', '/srv', '/srv/app'] });

  it('refuses a relative start or home before probing git, and answers for absolute ones', () => {
    const probe = repositoryAt('/srv/app');

    expect(() => rootCandidates('srv/app', { home: '/home/op', fs, gitToplevel: probe })).toThrow(
      'rafa roots: start directory is "srv/app", expected an absolute path',
    );
    expect(() => rootCandidates('/srv/app', { home: 'home/op', fs, gitToplevel: probe })).toThrow(
      'rafa roots: home directory is "home/op", expected an absolute path',
    );
    expect(probe.asked).toEqual([]);
    expect(pathsOf(rootCandidates('/srv/app', { home: '/home/op', fs, gitToplevel: probe }).candidates)).toEqual(['/srv/app']);
  });

  it('fails loudly when the home is left out', () => {
    const seams = { fs, gitToplevel: noRepository } as unknown as { home: string };

    expect(() => rootCandidates('/srv/app', seams)).toThrow(TypeError);
  });

  it('refuses a start that does not resolve, naming it, with the cause kept', () => {
    let refusal: unknown = null;
    try {
      rootCandidates('/srv/gone', { home: '/home/op', fs, gitToplevel: noRepository });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(RootsError);
    const { name, message, cause } = refusal as RootsError;
    expect(name).toBe('RootsError');
    expect(message).toStartWith('rafa roots: start directory /srv/gone does not resolve (ENOENT');
    expect(cause).toBeInstanceOf(Error);
  });

  it('refuses a toplevel the probe answers relative or unresolved', () => {
    expect(() => rootCandidates('/srv/app', { home: '/home/op', fs, gitToplevel: () => 'app' })).toThrow(
      'rafa roots: git toplevel is "app", expected an absolute path',
    );
    expect(() => rootCandidates('/srv/app', { home: '/home/op', fs, gitToplevel: () => '/gone' })).toThrow(
      'rafa roots: git toplevel /gone does not resolve (ENOENT',
    );
  });

  it('lets a fault the probe throws through', () => {
    const fault = new RootsError('git could not run in /srv/app (spawn failed)');

    expect(() => rootCandidates('/srv/app', {
      home: '/home/op',
      fs,
      gitToplevel: () => {
        throw fault;
      },
    })).toThrow(fault);
  });
});

describe('rootCandidates on disk', () => {
  it('reads no marker in any directory above the temporary root, the precondition of the next cases', () => {
    const above: string[] = [];
    for (let dir = dirname(realTempRoot); ; dir = dirname(dir)) {
      for (const name of ['package.json', 'turbo.json', 'pnpm-workspace.yaml', 'nx.json', 'lerna.json']) {
        if (existsSync(join(dir, name))) above.push(join(dir, name));
      }
      if (dir === dirname(dir)) break;
    }

    expect(above).toEqual([]);
  });

  it('offers a git package inside a monorepo fixture, and the monorepo root above it', () => {
    const mono = freshDir();
    plantFile(join(mono, 'package.json'), '{"private":true,"workspaces":["packages/*"]}\n');
    const app = makeDir(join(mono, 'packages', 'app'));
    git(app, 'init', '-q');
    const start = makeDir(join(app, 'src'));

    const answer = rootCandidates(start, { home: join(freshDir(), 'home') });

    expect(answer).toEqual({
      start,
      candidates: [
        { path: realpathSync(app), source: 'git-toplevel', markers: [], refusal: null },
        { path: realpathSync(mono), source: 'monorepo', markers: ['package.json'], refusal: null },
      ],
      warnings: [],
    });
    expect(realpathSync(mono).startsWith(realTempRoot + sep)).toBe(true);
  });

  it('offers the real start itself outside a repository', () => {
    const start = makeDir(join(freshDir(), 'plain'));

    const answer = rootCandidates(start, { home: join(freshDir(), 'home'), fs: DISK_ROOTS_FILE_SYSTEM });

    expect(answer.candidates).toEqual([{ path: realpathSync(start), source: 'directory', markers: [], refusal: null }]);
  });
});
