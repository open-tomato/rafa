import type { BuiltFixture, Variant } from './monorepo-fixture';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  buildFixture,
  buildFixtures,
  fixtureFiles,
  installCommand,
  isInsideRepository,
  packagesOf,
  parseArguments,
  TURBO_VERSION,
  VARIANTS,
  YARN_VERSION,
} from './monorepo-fixture';

const SCRIPT = join(import.meta.dir, 'monorepo-fixture.ts');
const REPOSITORY_ROOT = resolve(import.meta.dir, '..', '..');

/** Runs git in a fixture and returns its trimmed stdout, failing on a non-zero exit. */
function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function readJson(root: string, path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;
}

describe('buildFixtures under --no-install', () => {
  let out = '';
  let built: readonly BuiltFixture[] = [];
  const rootOf = (variant: Variant): string => join(out, variant);

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'monorepo-fixture-test-'));
    built = buildFixtures({ variants: VARIANTS, out, install: false });
  });

  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it('builds every variant under its own folder, in order', () => {
    expect(built).toEqual(VARIANTS.map((variant) => ({ variant, root: rootOf(variant) })));
  });

  it.each([...VARIANTS])('commits the %s tree as one commit with nothing left over', (variant) => {
    const root = rootOf(variant);
    expect(git(root, ['rev-list', '--count', 'HEAD'])).toBe('1');
    expect(git(root, ['status', '--porcelain'])).toBe('');
    const tracked = git(root, ['ls-files']).split('\n');
    expect(tracked).toEqual([...fixtureFiles(variant).keys()].sort());
  });

  it.each([...VARIANTS])('writes no install output for %s', (variant) => {
    const root = rootOf(variant);
    expect(existsSync(join(root, 'node_modules'))).toBe(false);
    expect(existsSync(join(root, 'bun.lock'))).toBe(false);
    expect(existsSync(join(root, 'pnpm-lock.yaml'))).toBe(false);
  });

  it.each([...VARIANTS])('gives each %s package a source, a test and a check-types script', (variant) => {
    const root = rootOf(variant);
    for (const name of packagesOf(variant)) {
      const folder = join(root, 'packages', name);
      expect(existsSync(join(folder, 'src', 'index.ts'))).toBe(true);
      expect(existsSync(join(folder, 'src', 'index.test.ts'))).toBe(true);
      const manifest = readJson(folder, 'package.json');
      expect(manifest.name).toBe(`@fixture/${name}`);
      expect(manifest.scripts).toEqual({ 'check-types': 'tsc --noEmit', test: 'bun test' });
    }
  });

  it.each([...VARIANTS])('links %s packages to their siblings through workspace:*', (variant) => {
    const packages = join(rootOf(variant), 'packages');
    expect(readJson(join(packages, 'core'), 'package.json').dependencies).toBeUndefined();
    expect(readJson(join(packages, 'feature'), 'package.json').dependencies)
      .toEqual({ '@fixture/core': 'workspace:*' });
    expect(readJson(join(packages, 'cli'), 'package.json').dependencies)
      .toEqual({ '@fixture/core': 'workspace:*', '@fixture/feature': 'workspace:*' });
  });

  it('holds stray in the turbo variant alone', () => {
    expect(packagesOf('turbo')).toEqual(['core', 'feature', 'cli', 'stray']);
    for (const variant of ['bun', 'pnpm', 'yarn'] as const) {
      expect(packagesOf(variant)).toEqual(['core', 'feature', 'cli']);
      expect(existsSync(join(rootOf(variant), 'packages', 'stray'))).toBe(false);
    }
  });

  it('has stray import core through a tsconfig path with no declared dependency', () => {
    const stray = join(rootOf('turbo'), 'packages', 'stray');
    const manifest = readJson(stray, 'package.json');
    expect(manifest.dependencies).toBeUndefined();
    expect(Object.keys(manifest.devDependencies as object)).not.toContain('@fixture/core');
    const tsconfig = readJson(stray, 'tsconfig.json');
    expect(tsconfig.compilerOptions).toEqual({ paths: { '@fixture/core': ['../core/src/index.ts'] } });
    expect(readFileSync(join(stray, 'src', 'index.ts'), 'utf8')).toContain('from \'@fixture/core\'');
  });

  it('declares the bun workspace and pins bun', () => {
    const manifest = readJson(rootOf('bun'), 'package.json');
    expect(manifest.workspaces).toEqual(['packages/*']);
    expect(manifest.packageManager).toBe(`bun@${Bun.version}`);
  });

  it('declares the pnpm workspace in its own file and pins no manager', () => {
    const root = rootOf('pnpm');
    const manifest = readJson(root, 'package.json');
    expect(manifest.workspaces).toBeUndefined();
    expect(manifest.packageManager).toBeUndefined();
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe('packages:\n  - \'packages/*\'\n');
  });

  it('pins yarn berry with the node-modules linker and an empty lockfile', () => {
    const root = rootOf('yarn');
    const manifest = readJson(root, 'package.json');
    expect(manifest.workspaces).toEqual(['packages/*']);
    expect(manifest.packageManager).toBe(`yarn@${YARN_VERSION}`);
    expect(readFileSync(join(root, '.yarnrc.yml'), 'utf8')).toContain('nodeLinker: node-modules');
    expect(readFileSync(join(root, 'yarn.lock'), 'utf8')).toBe('');
  });

  it('runs turbo as a root devDependency over the bun workspace', () => {
    const root = rootOf('turbo');
    const manifest = readJson(root, 'package.json');
    expect(manifest.workspaces).toEqual(['packages/*']);
    expect(manifest.devDependencies).toEqual({ turbo: TURBO_VERSION });
    expect(manifest.scripts).toEqual({ 'check-types': 'turbo run check-types', test: 'turbo run test' });
    expect(Object.keys(readJson(root, 'turbo.json').tasks as object)).toEqual(['check-types', 'test']);
  });
});

describe('installCommand', () => {
  it('never assumes yarn or turbo on the PATH', () => {
    expect(installCommand('yarn')).toEqual(['corepack', 'yarn', 'install']);
    expect(installCommand('turbo')).toEqual(['bun', 'install']);
    expect(installCommand('pnpm')).toEqual(['pnpm', 'install']);
    expect(installCommand('bun')).toEqual(['bun', 'install']);
  });
});

describe('buildFixture refusals', () => {
  let out = '';

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'monorepo-fixture-refusal-'));
  });

  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it('refuses a fixture folder that already exists', () => {
    const root = join(out, 'bun');
    mkdirSync(root);
    expect(() => buildFixture('bun', root, false)).toThrow('already exists');
  });

  it('refuses an --out inside this repository', () => {
    const inside = join(REPOSITORY_ROOT, 'scratch-fixture');
    expect(() => buildFixtures({ variants: ['bun'], out: inside, install: false }))
      .toThrow('Refusing --out=');
    expect(existsSync(inside)).toBe(false);
  });

  it('reads a folder as inside the repository only when it is the root or below it', () => {
    expect(isInsideRepository('/repo', '/repo')).toBe(true);
    expect(isInsideRepository('/repo/a/b', '/repo')).toBe(true);
    expect(isInsideRepository('/repository', '/repo')).toBe(false);
    expect(isInsideRepository('/tmp/fixture', '/repo')).toBe(false);
  });
});

describe('parseArguments', () => {
  it('builds every variant with install by default', () => {
    expect(parseArguments([])).toEqual({ variants: VARIANTS, out: undefined, install: true });
  });

  it('reads one variant, all, --out and --no-install', () => {
    expect(parseArguments(['--variant=yarn', '--out=/tmp/x', '--no-install']))
      .toEqual({ variants: ['yarn'], out: '/tmp/x', install: false });
    expect(parseArguments(['--variant=all']).variants).toEqual(VARIANTS);
  });

  it('refuses an unknown variant, an empty --out and an unknown flag', () => {
    expect(() => parseArguments(['--variant=npm'])).toThrow('Unknown --variant=npm');
    expect(() => parseArguments(['--out='])).toThrow('Unknown argument --out=');
    expect(() => parseArguments(['--install'])).toThrow('Unknown argument --install');
  });
});

describe('the script run as a command', () => {
  let out = '';

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'monorepo-fixture-cli-'));
  });

  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it('prints each variant and its fixture root, tab-separated', () => {
    const result = Bun.spawnSync(
      ['bun', SCRIPT, '--variant=pnpm', `--out=${out}`, '--no-install'],
      { stderr: 'pipe', stdout: 'pipe' },
    );
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(`pnpm\t${join(out, 'pnpm')}\n`);
    expect(git(join(out, 'pnpm'), ['rev-list', '--count', 'HEAD'])).toBe('1');
  });

  it('exits 1 naming an unknown variant', () => {
    const result = Bun.spawnSync(['bun', SCRIPT, '--variant=npm', '--no-install'], { stderr: 'pipe', stdout: 'pipe' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('Unknown --variant=npm');
    expect(result.stdout.toString()).toBe('');
  });
});
