/**
 * The bundle guard over literal metafiles, shaped as `bun build
 * --metafile` writes them on bun 1.3.14: each input keyed by its path
 * relative to the build's working directory, each import by the absolute
 * path it reached, or by the bare specifier with `external: true` when
 * bun left it out. A publishable plugin and a private core are the two
 * members; each finding case has a control beside it that reads clean,
 * so no clean reading here is of a guard that could never fail.
 */
import type { BundleMetafile } from './bundle';
import type { WorkspacePackage } from '../../src/release/workspace-packages.js';

import { describe, expect, test } from 'bun:test';

import {
  bundledPackageFiles,
  bundlesFor,
  externalsLine,
  findingLine,
  LIBRARY_ENTRIES,
  parseBundleArgs,
  rootRelative,
} from './bundle';

/** The root every literal metafile's build ran in. */
const ROOT = '/work/repo';

/** A publishable member. */
const PLUGIN: WorkspacePackage = {
  name: '@scope/plugin',
  dir: 'packages/plugin',
  version: '1.0.0',
  isPrivate: false,
  manifestPath: 'packages/plugin/package.json',
};

/** A private member, which stays bundled. */
const CORE: WorkspacePackage = {
  name: '@scope/core',
  dir: 'packages/core',
  version: null,
  isPrivate: true,
  manifestPath: 'packages/core/package.json',
};

/** A member whose `dir` shares a prefix with the plugin's, so a bare prefix match would be wrong. */
const PLUGIN_EXTRA: WorkspacePackage = {
  name: '@scope/plugin-extra',
  dir: 'packages/plugin-extra',
  version: '1.0.0',
  isPrivate: true,
  manifestPath: 'packages/plugin-extra/package.json',
};

/** The metafile of an entry that bundled both members. */
const BUNDLED_BOTH: BundleMetafile = {
  inputs: {
    'src/cli.ts': {
      imports: [
        { path: `${ROOT}/src/plugins/load.ts` },
        { path: `${ROOT}/packages/core/src/index.ts` },
      ],
    },
    'src/plugins/load.ts': { imports: [{ path: `${ROOT}/packages/plugin/src/index.ts` }] },
    'packages/plugin/src/index.ts': { imports: [{ path: `${ROOT}/packages/plugin/src/util.ts` }] },
    'packages/plugin/src/util.ts': { imports: [] },
    'packages/core/src/index.ts': { imports: [] },
  },
};

/** The same entry built with the plugin external: its files are no input. */
const PLUGIN_EXTERNAL: BundleMetafile = {
  inputs: {
    'src/cli.ts': {
      imports: [
        { path: `${ROOT}/src/plugins/load.ts` },
        { path: `${ROOT}/packages/core/src/index.ts` },
      ],
    },
    'src/plugins/load.ts': { imports: [{ path: '@scope/plugin', external: true }] },
    'packages/core/src/index.ts': { imports: [] },
  },
};

describe('bundledPackageFiles', () => {
  test('finds each input under a publishable dir with its importers, and no input under a private one', () => {
    expect(bundledPackageFiles(BUNDLED_BOTH, [CORE, PLUGIN], ROOT)).toEqual([
      { file: 'packages/plugin/src/index.ts', packageName: '@scope/plugin', importers: ['src/plugins/load.ts'] },
      { file: 'packages/plugin/src/util.ts', packageName: '@scope/plugin', importers: ['packages/plugin/src/index.ts'] },
    ]);
  });

  test('finds nothing once the publishable package is external', () => {
    expect(bundledPackageFiles(PLUGIN_EXTERNAL, [CORE, PLUGIN], ROOT)).toEqual([]);
  });

  test('finds nothing under the plugin when it is private, the control on the private reading', () => {
    expect(bundledPackageFiles(BUNDLED_BOTH, [CORE, { ...PLUGIN, isPrivate: true }], ROOT)).toEqual([]);
  });

  test('makes an absolute input path relative to the root before matching', () => {
    const metafile: BundleMetafile = {
      inputs: {
        'src/cli.ts': { imports: [{ path: `${ROOT}/packages/plugin/src/index.ts` }] },
        [`${ROOT}/packages/plugin/src/index.ts`]: { imports: [] },
      },
    };
    expect(bundledPackageFiles(metafile, [PLUGIN], ROOT)).toEqual([
      { file: 'packages/plugin/src/index.ts', packageName: '@scope/plugin', importers: ['src/cli.ts'] },
    ]);
  });

  test('names an importer whose import is spelled relative to the root', () => {
    const metafile: BundleMetafile = {
      inputs: {
        'src/a.ts': { imports: [{ path: 'packages/plugin/src/index.ts' }] },
        'src/b.ts': { imports: [{ path: `${ROOT}/packages/plugin/src/index.ts` }] },
        'src/c.ts': { imports: [{ path: `${ROOT}/src/a.ts` }] },
        'packages/plugin/src/index.ts': { imports: [] },
      },
    };
    expect(bundledPackageFiles(metafile, [PLUGIN], ROOT)).toEqual([
      { file: 'packages/plugin/src/index.ts', packageName: '@scope/plugin', importers: ['src/a.ts', 'src/b.ts'] },
    ]);
  });

  test('does not take a sibling dir sharing the prefix for the package', () => {
    const metafile: BundleMetafile = {
      inputs: {
        'src/cli.ts': { imports: [{ path: `${ROOT}/packages/plugin-extra/src/index.ts` }] },
        'packages/plugin-extra/src/index.ts': { imports: [] },
      },
    };
    expect(bundledPackageFiles(metafile, [PLUGIN, PLUGIN_EXTRA], ROOT)).toEqual([]);
    expect(bundledPackageFiles(metafile, [PLUGIN, { ...PLUGIN_EXTRA, isPrivate: false }], ROOT)).toEqual([
      { file: 'packages/plugin-extra/src/index.ts', packageName: '@scope/plugin-extra', importers: ['src/cli.ts'] },
    ]);
  });
});

describe('rootRelative', () => {
  test('makes an absolute path relative and leaves a relative one', () => {
    expect(rootRelative(`${ROOT}/packages/plugin/src/index.ts`, ROOT)).toBe('packages/plugin/src/index.ts');
    expect(rootRelative('./src/cli.ts', ROOT)).toBe('src/cli.ts');
    expect(rootRelative('src/cli.ts', ROOT)).toBe('src/cli.ts');
  });
});

describe('the lines', () => {
  test('a finding names the bundle, the file, the package and every importer', () => {
    const line = findingLine('dist/cli.js', {
      file: 'packages/plugin/src/index.ts',
      packageName: '@scope/plugin',
      importers: ['src/plugins/load.ts', 'src/rafa.ts'],
    });
    expect(line).toBe('dist/cli.js bundles packages/plugin/src/index.ts of @scope/plugin, imported by src/plugins/load.ts, src/rafa.ts');
  });

  test('a clean bundle names its externals, or none', () => {
    expect(externalsLine('dist/cli.js', ['@scope/a', '@scope/b'])).toBe('dist/cli.js built with externals: @scope/a, @scope/b');
    expect(externalsLine('dist/', [])).toBe('dist/ built with externals: none');
  });
});

describe('bundlesFor', () => {
  test('builds the CLI to <out>/cli.js and the six library entries with splitting into <out>/', () => {
    const [cli, library] = bundlesFor('dist/', '/abs/dist');
    expect(cli).toEqual({ label: 'dist/cli.js', args: ['src/rafa.ts', '--target=bun', '--outfile=/abs/dist/cli.js'] });
    expect(library).toEqual({
      label: 'dist/',
      args: [...LIBRARY_ENTRIES, '--target=bun', '--splitting', '--root=src', '--outdir=/abs/dist'],
    });
    expect(LIBRARY_ENTRIES).toHaveLength(6);
  });
});

describe('parseBundleArgs', () => {
  test('defaults to the working directory, dist and the externals', () => {
    expect(parseBundleArgs([], '/cwd')).toEqual({ ok: true, root: '/cwd', out: 'dist', externals: true });
  });

  test('reads --root, --out and --no-externals', () => {
    expect(parseBundleArgs(['--root', '/r', '--no-externals', '--out', 'build'], '/cwd'))
      .toEqual({ ok: true, root: '/r', out: 'build', externals: false });
  });

  test('refuses an unknown argument and a flag with no value', () => {
    expect(parseBundleArgs(['--splitting'], '/cwd')).toEqual({ ok: false, problem: 'unknown argument --splitting' });
    expect(parseBundleArgs(['--root'], '/cwd')).toEqual({ ok: false, problem: '--root needs a value' });
    expect(parseBundleArgs(['--out', '--no-externals'], '/cwd')).toEqual({ ok: false, problem: '--out needs a value' });
  });
});
