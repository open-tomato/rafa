/**
 * The monorepo readiness spike's fixture (#804): a throwaway workspace of
 * three packages, built once per variant, that rafa's probes run against.
 * Run from the repository root,
 * `bun scripts/survey/monorepo-fixture.ts [--variant=<v>] [--out=<dir>] [--no-install]`
 * writes one git repository per variant under `<out>/<variant>/` and prints
 * one line per variant, `<variant>` and the fixture root separated by a tab.
 *
 * Every variant holds, under `packages/`, the scope `@fixture/`:
 *
 *   - `core`, depending on nothing;
 *   - `feature`, depending on `core` through `workspace:*`;
 *   - `cli`, depending on `core` and `feature` through `workspace:*`.
 *
 * The turbo variant adds `stray`, which imports `@fixture/core` through a
 * `paths` entry in its own `tsconfig.json` and declares no dependency on
 * it: the shape #895 reports for `rafa-hub` and `rafa-sync-service`, read
 * by probe 12 (does `turbo run test --affected` mark it).
 *
 * Each package has a `src/index.ts`, one test file (`src/index.test.ts`,
 * run by `bun test`) and a `check-types` script (`tsc --noEmit`), with
 * `typescript` and `@types/bun` as its own devDependencies so every package
 * manager puts `tsc` on that script's PATH. The variants differ only at
 * the root:
 *
 *   - `bun`: `workspaces` in `package.json`, installed by `bun install`;
 *   - `pnpm`: `pnpm-workspace.yaml`, installed by `pnpm install`, with no
 *     `packageManager` field (pnpm refuses a project pinned to another
 *     manager);
 *   - `yarn`: `workspaces`, `packageManager` pinned to yarn berry so
 *     `corepack` picks it over yarn classic (which has no `workspace:`
 *     protocol), `nodeLinker: node-modules` so bun resolves the packages,
 *     and an empty `yarn.lock` marking the project root; installed by
 *     `corepack yarn install`, yarn never assumed global;
 *   - `turbo`: the bun variant plus `turbo.json`, `turbo` as a pinned
 *     devDependency of the root (never assumed global), and `stray`.
 *
 * The install runs before the commit, so the lockfile lands in the
 * variant's one commit and `node_modules/` stays out through `.gitignore`.
 * `--no-install` writes and commits the tree alone. The commit names a
 * fixed fixture identity and skips hooks, so neither the operator's git
 * identity nor their hooks reach it.
 *
 * `--out` defaults to a fresh directory under the OS temp directory. An
 * `--out` inside this repository is refused: `src/project/roots.ts` takes
 * the outermost folder holding a monorepo marker, and rafa's own
 * `package.json` has `workspaces`, so a fixture there would report rafa's
 * root. A variant folder that already exists is refused rather than
 * overwritten.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** The variants the fixture is built in, in the order `all` builds them. */
export const VARIANTS = ['bun', 'pnpm', 'yarn', 'turbo'] as const;

/** One fixture variant: the workspace tool its root is set up for. */
export type Variant = (typeof VARIANTS)[number];

/** The npm scope every fixture package is published under. */
export const SCOPE = '@fixture';

/** The yarn release `corepack` installs for the yarn variant. */
export const YARN_VERSION = '4.18.1';

/** The turbo release the turbo variant's root pins as a devDependency. */
export const TURBO_VERSION = '2.11.7';

/** The `typescript` range every fixture package declares. */
const TYPESCRIPT_RANGE = '^5.9.3';

/** The `@types/bun` range every fixture package declares. */
const BUN_TYPES_RANGE = '^1.4.0';

/** The identity the fixture's one commit is written under. */
const FIXTURE_AUTHOR = { email: 'fixture@example.invalid', name: 'rafa fixture' };

/** The repository this script lives in, which `--out` must stay outside. */
const REPOSITORY_ROOT = resolve(import.meta.dir, '..', '..');

/** What one run builds. */
export interface FixtureOptions {
  /** The variants to build, in order. */
  readonly variants: readonly Variant[];
  /** The folder each variant is written under, or `undefined` for a fresh temp folder. */
  readonly out: string | undefined;
  /** Whether each variant's package manager installs before the commit. */
  readonly install: boolean;
}

/** One built variant. */
export interface BuiltFixture {
  /** The variant built. */
  readonly variant: Variant;
  /** The fixture's root: the git repository and workspace root. */
  readonly root: string;
}

/** A fixture package: its folder name under `packages/` and its source. */
interface PackageShape {
  readonly name: string;
  readonly dependencies: readonly string[];
  readonly source: string;
  readonly test: string;
}

const CORE: PackageShape = {
  name: 'core',
  dependencies: [],
  source: [
    '/** The greeting every other fixture package builds on. */',
    'export function greet(name: string): string {',
    '  return `hello, ${name}`;',
    '}',
    '',
  ].join('\n'),
  test: [
    'import { expect, test } from \'bun:test\';',
    '',
    'import { greet } from \'./index\';',
    '',
    'test(\'greet names who it greets\', () => {',
    '  expect(greet(\'core\')).toBe(\'hello, core\');',
    '});',
    '',
  ].join('\n'),
};

const FEATURE: PackageShape = {
  name: 'feature',
  dependencies: ['core'],
  source: [
    `import { greet } from '${SCOPE}/core';`,
    '',
    '/** The core greeting, shouted. */',
    'export function shout(name: string): string {',
    '  return greet(name).toUpperCase();',
    '}',
    '',
  ].join('\n'),
  test: [
    'import { expect, test } from \'bun:test\';',
    '',
    'import { shout } from \'./index\';',
    '',
    'test(\'shout upper-cases the core greeting\', () => {',
    '  expect(shout(\'feature\')).toBe(\'HELLO, FEATURE\');',
    '});',
    '',
  ].join('\n'),
};

const CLI: PackageShape = {
  name: 'cli',
  dependencies: ['core', 'feature'],
  source: [
    `import { greet } from '${SCOPE}/core';`,
    `import { shout } from '${SCOPE}/feature';`,
    '',
    '/** One line built from both siblings. */',
    'export function run(name: string): string {',
    '  return `${greet(name)} / ${shout(name)}`;',
    '}',
    '',
  ].join('\n'),
  test: [
    'import { expect, test } from \'bun:test\';',
    '',
    'import { run } from \'./index\';',
    '',
    'test(\'run joins core and feature\', () => {',
    '  expect(run(\'cli\')).toBe(\'hello, cli / HELLO, CLI\');',
    '});',
    '',
  ].join('\n'),
};

const STRAY: PackageShape = {
  name: 'stray',
  dependencies: [],
  source: [
    `import { greet } from '${SCOPE}/core';`,
    '',
    '/** The core greeting, reached through a tsconfig path alone. */',
    'export function wander(name: string): string {',
    '  return `${greet(name)}?`;',
    '}',
    '',
  ].join('\n'),
  test: [
    'import { expect, test } from \'bun:test\';',
    '',
    'import { wander } from \'./index\';',
    '',
    'test(\'wander reaches core without declaring it\', () => {',
    '  expect(wander(\'stray\')).toBe(\'hello, stray?\');',
    '});',
    '',
  ].join('\n'),
};

/**
 * The packages a variant holds, in dependency order.
 *
 * @param variant - The variant.
 * @returns `core`, `feature`, `cli`, and `stray` for the turbo variant.
 */
export function packagesOf(variant: Variant): readonly string[] {
  return shapesOf(variant).map((shape) => shape.name);
}

function shapesOf(variant: Variant): readonly PackageShape[] {
  return variant === 'turbo'
    ? [CORE, FEATURE, CLI, STRAY]
    : [CORE, FEATURE, CLI];
}

/** JSON as the fixture writes it: two-space indent and a final newline. */
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function packageManifest(shape: PackageShape): string {
  const dependencies = Object.fromEntries(
    shape.dependencies.map((name) => [`${SCOPE}/${name}`, 'workspace:*']),
  );
  return json({
    name: `${SCOPE}/${shape.name}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: { '.': './src/index.ts' },
    scripts: { 'check-types': 'tsc --noEmit', test: 'bun test' },
    ...(shape.dependencies.length > 0
      ? { dependencies }
      : {}),
    devDependencies: { '@types/bun': BUN_TYPES_RANGE, typescript: TYPESCRIPT_RANGE },
  });
}

function packageTsconfig(shape: PackageShape): string {
  const paths = shape === STRAY
    ? { paths: { [`${SCOPE}/core`]: ['../core/src/index.ts'] } }
    : {};
  return json({
    extends: '../../tsconfig.base.json',
    compilerOptions: paths,
    include: ['src'],
  });
}

const BASE_TSCONFIG = json({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: ['bun'],
  },
});

const GITIGNORE = ['node_modules/', '.turbo/', '.yarn/', '.pnp.*', ''].join('\n');

/** The root `package.json` fields one variant adds to the common ones. */
function rootFields(variant: Variant): Record<string, unknown> {
  const workspaces = { workspaces: ['packages/*'] };
  switch (variant) {
    case 'bun':
      return { ...workspaces, packageManager: `bun@${Bun.version}` };
    case 'pnpm':
      return {};
    case 'yarn':
      return { ...workspaces, packageManager: `yarn@${YARN_VERSION}` };
    case 'turbo':
      return {
        ...workspaces,
        packageManager: `bun@${Bun.version}`,
        devDependencies: { turbo: TURBO_VERSION },
      };
  }
}

function rootScripts(variant: Variant): Record<string, string> {
  return variant === 'turbo'
    ? { 'check-types': 'turbo run check-types', test: 'turbo run test' }
    : { test: 'bun test' };
}

function rootManifest(variant: Variant): string {
  return json({
    name: `${SCOPE}/root`,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: rootScripts(variant),
    ...rootFields(variant),
  });
}

/** The root files one variant adds beside `package.json`. */
function variantRootFiles(variant: Variant): ReadonlyArray<readonly [string, string]> {
  switch (variant) {
    case 'bun':
      return [];
    case 'pnpm':
      return [['pnpm-workspace.yaml', 'packages:\n  - \'packages/*\'\n']];
    case 'yarn':
      return [
        ['.yarnrc.yml', 'nodeLinker: node-modules\nenableTelemetry: false\n'],
        ['yarn.lock', ''],
      ];
    case 'turbo':
      return [['turbo.json', json({
        $schema: 'https://turborepo.com/schema.json',
        tasks: {
          'check-types': { dependsOn: ['^check-types'] },
          test: { dependsOn: ['^test'] },
        },
      })]];
  }
}

/**
 * Every file a variant's tree holds, before any install.
 *
 * @param variant - The variant.
 * @returns Each file's path relative to the fixture root, with `/`
 *   between segments, mapped to its content.
 */
export function fixtureFiles(variant: Variant): ReadonlyMap<string, string> {
  const files: Array<readonly [string, string]> = [
    ['.gitignore', GITIGNORE],
    ['package.json', rootManifest(variant)],
    ['tsconfig.base.json', BASE_TSCONFIG],
    ...variantRootFiles(variant),
  ];
  for (const shape of shapesOf(variant)) {
    const folder = `packages/${shape.name}`;
    files.push(
      [`${folder}/package.json`, packageManifest(shape)],
      [`${folder}/tsconfig.json`, packageTsconfig(shape)],
      [`${folder}/src/index.ts`, shape.source],
      [`${folder}/src/index.test.ts`, shape.test],
    );
  }
  return new Map(files);
}

/**
 * The command that installs a variant, run from its root.
 *
 * @param variant - The variant.
 * @returns The command and its arguments.
 */
export function installCommand(variant: Variant): readonly string[] {
  switch (variant) {
    case 'bun':
    case 'turbo':
      return ['bun', 'install'];
    case 'pnpm':
      return ['pnpm', 'install'];
    case 'yarn':
      return ['corepack', 'yarn', 'install'];
  }
}

function isVariant(value: string): value is Variant {
  return (VARIANTS as readonly string[]).includes(value);
}

function parseVariants(value: string): readonly Variant[] {
  if (value === 'all') {
    return VARIANTS;
  }
  if (isVariant(value)) {
    return [value];
  }
  throw new Error(`Unknown --variant=${value}: expected ${VARIANTS.join(', ')} or all`);
}

/**
 * Reads the script's arguments.
 *
 * @param argv - The arguments after the script's path.
 * @returns What to build; every variant when `--variant` is absent.
 * @throws When an argument is unknown, empty or names an unknown variant.
 */
export function parseArguments(argv: readonly string[]): FixtureOptions {
  let variants: readonly Variant[] = VARIANTS;
  let out: string | undefined;
  let install = true;
  for (const arg of argv) {
    if (arg === '--no-install') {
      install = false;
    } else if (arg.startsWith('--variant=')) {
      variants = parseVariants(arg.slice('--variant='.length));
    } else if (arg.startsWith('--out=') && arg.length > '--out='.length) {
      out = resolve(arg.slice('--out='.length));
    } else {
      throw new Error(`Unknown argument ${arg}: expected --variant=<v>, --out=<dir> or --no-install`);
    }
  }
  return { variants, out, install };
}

/**
 * Whether a folder lies inside this repository, the repository root
 * included.
 *
 * @param folder - An absolute path.
 * @param repositoryRoot - The repository's root.
 * @returns `true` when the folder is the root or below it.
 */
export function isInsideRepository(folder: string, repositoryRoot: string = REPOSITORY_ROOT): boolean {
  const path = relative(repositoryRoot, folder);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/** Runs a command in `cwd`, failing with its output on a non-zero exit. */
function run(command: readonly string[], cwd: string): void {
  const result = Bun.spawnSync([...command], {
    cwd,
    env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error([
      `${command.join(' ')} exited ${result.exitCode} in ${cwd}`,
      result.stdout.toString(),
      result.stderr.toString(),
    ].join('\n'));
  }
}

function writeTree(variant: Variant, root: string): void {
  for (const [path, content] of fixtureFiles(variant)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function commitTree(variant: Variant, root: string): void {
  run(['git', 'init', '--quiet', '--initial-branch=main'], root);
  run(['git', 'add', '--all'], root);
  run([
    'git',
    '-c', `user.name=${FIXTURE_AUTHOR.name}`,
    '-c', `user.email=${FIXTURE_AUTHOR.email}`,
    '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '--no-verify', '-m', `fixture: ${variant} workspace`,
  ], root);
}

/**
 * Builds one variant at `root`: writes the tree, installs unless told not
 * to, and commits everything not ignored as the repository's one commit.
 *
 * @param variant - The variant.
 * @param root - The fixture's root; must not exist yet.
 * @param install - Whether the variant's package manager installs first.
 * @throws When `root` exists, or when the install or git fails.
 */
export function buildFixture(variant: Variant, root: string, install: boolean): void {
  if (existsSync(root)) {
    throw new Error(`Refusing to overwrite ${root}: the fixture folder already exists`);
  }
  mkdirSync(root, { recursive: true });
  writeTree(variant, root);
  if (install) {
    run(installCommand(variant), root);
  }
  commitTree(variant, root);
}

/**
 * Builds every variant the options name, each under `<out>/<variant>`.
 *
 * @param options - What to build.
 * @returns Each variant built and its root, in the order built.
 * @throws When `out` lies inside this repository, or a build fails.
 */
export function buildFixtures(options: FixtureOptions): readonly BuiltFixture[] {
  const out = options.out ?? mkdtempSync(join(tmpdir(), 'rafa-monorepo-fixture-'));
  if (isInsideRepository(out)) {
    throw new Error(
      `Refusing --out=${out}: it lies inside ${REPOSITORY_ROOT}, whose own workspaces would be read as the fixture's root`,
    );
  }
  return options.variants.map((variant) => {
    const root = join(out, variant);
    buildFixture(variant, root, options.install);
    return { variant, root };
  });
}

if (import.meta.main) {
  try {
    for (const { variant, root } of buildFixtures(parseArguments(process.argv.slice(2)))) {
      console.log(`${variant}\t${root}`);
    }
  } catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(1);
  }
}
