/**
 * Tests for the package's published shape: the `bin`, `exports`, `files`,
 * `private`, `publishConfig`, `engines` and `module` fields of
 * `package.json`, the dependency keys it does NOT carry, and the `build`
 * script that writes what those fields name.
 *
 * Each of those fields is spelled HERE, as the phase 0 spec gives the
 * first three and phase 1's publishing stage the rest, so a target
 * renamed in the manifest fails a case instead of agreeing with
 * itself. Every other case reads a build: the suite copies the package
 * (its manifest, both tsconfig files, the README, the dev-planner skill
 * and `src/`) into a scratch directory and runs `bun run build` there,
 * the script as the manifest holds it, so nothing is written into the
 * repository's own `dist/`.
 *
 * ## What each clause of the build script is for
 *
 * Each clause answers a reading taken on bun 1.3.14:
 *
 *   - `rm -rf dist` runs first. A chunk is named by its content hash, so
 *     a rebuild after a change writes a new chunk and leaves the old one
 *     in place: measured, `index-whheyr7c.js` survived beside its
 *     successor `index-vt2jdjxh.js`, and `files` would have published
 *     both. An unused export appended to a module changed no chunk at
 *     all, which is why that reading was taken on a change the bundle
 *     keeps.
 *   - `src/rafa.ts` is built on its own, with `--outfile=dist/cli.js`.
 *     The build keeps the dispatcher's `#!/usr/bin/env bun` line and
 *     writes the file executable, which is what lets `bin` point at it.
 *   - The four library entries are built together with `--splitting`.
 *     Without it each entry is a bundle of its own, and `parsePlan`,
 *     `parseReport`, `openSqliteStore` and `EFFORT_KEY_PROJECTIONS` were
 *     each a different value from `dist/index.js` than from their
 *     subpath's bundle, so `src/index.ts`'s rule that a subpath's names
 *     are the root's own bindings held in source only. With it, the
 *     shared code moves into chunks beside `index.js` and all four were
 *     identical. `--root=src` spells out where each entry lands: at its
 *     source's path under `dist/`.
 *   - `src/PROMPT.md`, `src/plan-prompt.md` and
 *     `.claude/skills/dev-planner/SKILL.md` are copied into `dist/`.
 *     `start.ts` and `plan.ts` find them beside themselves through
 *     `import.meta.url`, and a bundle inlining either module answers its
 *     OWN directory. The two built files reading `import.meta.url` are
 *     `cli.js` and `index.js`, both directly in `dist/`. The skill is the
 *     plan format `buildPlanPrompt` inlines into the plan prompt, and a
 *     project running an installed rafa carries no copy of its own.
 *
 * ## The template cases
 *
 * Copying the templates is held by behaviour as well as by bytes: `rafa
 * plan` runs from the build in a scratch repository, under a PATH holding
 * git and a stand-in `claude` that keeps the prompt and the arguments it is
 * handed, and that prompt is held equal to what `buildPlanPrompt` makes of the source
 * template and the source skill. It runs three times: through
 * `dist/cli.js` and through the root bundle's `planCommand`, both inside
 * the scratch package, where the package's own skill also sits one
 * directory above `dist/`, and through a copy of the build outside the
 * package, where only the copy beside `cli.js` exists. Two controls run
 * the same command from a copy of the build outside the package, one
 * without `plan-prompt.md` and one without `SKILL.md`, and each refuses
 * before any session starts, so the check can see a template that is not
 * there.
 *
 * The `dist/cli.js` run also holds the session's argument list to the
 * base arguments and `--setting-sources project,local`, the sources a run
 * with no config resolves to. Its control runs under a user-scope config
 * naming `local,user` and holds those instead, and a config whose sources
 * the loop refuses stops the command before the stand-in is reached.
 *
 * ## The asset-tree clause
 *
 * The three templates above are named files; the pinned resolve plans
 * and the board templates are DIRECTORIES, so the build script ends with
 * a loop over a table of `<source under src>:<name under dist>` pairs.
 * Three readings shape it:
 *
 *   - It copies `*.md` and nothing else. `src/pr/plans/` holds
 *     `load.ts` and `load.test.ts` beside the four plans, and copying
 *     the directory whole would publish both, since `files` publishes
 *     all of `dist`. A case reads `dist/plans` for a `.ts` file and
 *     names the two source modules that would land there.
 *   - A tree lands DIRECTLY under `dist/`, as `dist/plans` and
 *     `dist/templates`, not at its source path. A bundle reading
 *     `import.meta.url` answers its own directory, which is `dist/` for
 *     `cli.js`, so `src/pr/plans/load.ts`'s first candidate is
 *     `<moduleDir>/plans/<name>.md`; `PINNED_PLANS_DIRNAME` is that
 *     name, and a case resolves every pinned plan through
 *     `readPinnedPlan` pointed at `dist/` rather than only comparing
 *     bytes.
 *   - A tree that is not there is SKIPPED, and a tree that is there
 *     with no markdown in it fails the build. `src/board/templates/`
 *     now carries `spec.md`, the spec issue template, and carried no
 *     tracked file when the clause was written: `cp
 *     src/board/templates/*.md` against an absent directory would have
 *     stopped the build, and the guard is what the next empty tree
 *     needs too. Measured
 *     on bun 1.3.14, in a probe package carrying this clause alone:
 *     with the directory absent, the `[ -d ]` guard skipped it and the
 *     run exited 0; with it present and holding no markdown, the `cp`
 *     matched nothing and the run exited 1. So the skip cannot hide a
 *     tree that is there and ships nothing.
 *
 * That last reading is why the board tree's case reads a PLANTED file:
 * `beforeAll` writes {@link PLANTED_BOARD_TEMPLATE} into the scratch
 * package's `src/board/templates/` before the build runs, and it was
 * how the clause was read on a tree with a file in it while this
 * repository carried none. It is kept now that `spec.md` is tracked,
 * since it is the one file in either tree whose presence the case
 * itself guarantees: both tree cases list whatever markdown the scratch
 * package's source tree holds — the real template included — and hold
 * the copy to it byte for byte.
 *
 * Three mutations of the clause were driven on 2026-09-19, one run of
 * this file each, 44 pass before and after and the manifest restored
 * byte-identical (sha256). Dropping the whole loop reddened all five
 * cases below, 39 pass and 5 fail. Dropping only
 * `board/templates:templates` reddened the board tree case and the
 * planted-file case, 2 of 44, and left the plan cases green, so the two
 * table rows are read apart. Copying `*` instead of `*.md` reddened the
 * TypeScript case and the `src/pr/plans` tree case, whose file list no
 * longer matched the markdown it lists, again 2 of 44.
 *
 * ## The describe case
 *
 * `rafa describe` stamps its document with the `version` of
 * `package.json`, which `src/commands/describe.ts` imports by name. The
 * case runs it from a copy of the build outside the scratch package,
 * where no `package.json` sits above the bundle, and holds its output to
 * what `src/rafa.ts` prints and its version to the manifest's. So the
 * version is the one `bun build` inlined, and nothing beside the bundle
 * is read for it.
 *
 * Two mutations of `src/commands/describe.ts` were driven on 2026-09-14,
 * one run of this file each, with the module restored byte-identical
 * (sha256). A version other than the manifest's reddened this case alone.
 * The version read at run time from the `package.json` beside the module
 * reddened every case running the built CLI, 9 of 31 and this one among
 * them: the bundle reads that file when it is imported, and the build has
 * none there.
 *
 * ## The names phase 1 adds
 *
 * The preflight and the PREREQUISITES parser joined `./plan` in phase 1,
 * and scope resolution, the adapter registry and the manifest validator
 * joined the root beside the config resolver it already carried. Those
 * names are spelled here too, so a bundle that lost one fails a case
 * naming it, where the computed case above compares a bundle with a
 * source that could have lost it as well. The root bundle's
 * `PORT_VERSIONS` is held to the source's, its `RUNNING_MANIFEST_SEAMS`
 * to the manifest's `version`, which `src/modules/manifest.ts` imports
 * from `package.json` as `describe` does, and its built `resolveScope`
 * and `validateManifest` are run once each.
 *
 * `README.md` says only `./plan` and `./ports` load under node. The
 * preflight brought `Bun.spawn`, `Bun.which` and `Bun.file` calls into
 * `./plan`, so one case imports `dist/plan/index.js` under node and holds
 * its names to its source's. It imports `dist/index.js` the same way as
 * its control, which node refuses at `bun:sqlite`. The case needs `node`
 * on the suite's PATH, and fails naming it when there is none.
 *
 * Driven on 2026-09-15 with node 22.14.0, one run each over this file,
 * `src/index.test.ts` and `src/plan/index.test.ts`, with 161 pass before
 * and after and every file restored byte-identical (sha256).
 * `resolveScope` dropped from the root reddened the root names case, and
 * so did `CORE_ADAPTER_REGISTRY` dropped. A bare `import 'bun:sqlite';`
 * added to `src/plan/index.ts` left every case green, the node case
 * among them. It is no control: in a scratch build under that mutation,
 * the import landed in `cli.js` and the chunk `index-qebmbvjb.js`, not
 * in `dist/plan/index.js`, and node loaded that entry's twenty names.
 * `Database` re-exported from `bun:sqlite` there instead reddened the
 * node case, which is the control that it can fail.
 *
 * ## The publishing fields phase 1 sets
 *
 * `private: false` with `publishConfig.access: public` is what lets the
 * scoped name reach the registry at all; npm defaults a scoped package to
 * a restricted publish, so the access is spelled out rather than left to
 * the default. `engines` names `bun` alone, against a build that targets
 * bun: the phase 0 manifest declared `engines.node >= 22`, which no
 * reading supported, since the root, `./cli` and `./store` never load
 * under node. `module` moved off `index.ts`, a `console.log` placeholder
 * `bun init` had left at the repository root and `files` never published,
 * onto `./dist/index.js`, the root of the exports map; the case holds the
 * two equal and finds the file in the build, so a `module` naming an
 * entry the build does not write cannot pass.
 *
 * The dependency case reads absence, so it names every key an install
 * would resolve from, not just the two the manifest once carried, and it
 * asserts `devDependencies` is non-empty beside them: a manifest that
 * failed to parse into an object would otherwise satisfy it. What the
 * absence buys was measured on npm 11.1.0, outside this suite, on two
 * probe tarballs differing in that one key: with
 * `peerDependencies: {typescript: ^5}`, `npm install --offline` against
 * an empty cache exited 1 with `npm error code ENOTCACHED` on
 * `https://registry.npmjs.org/typescript` and left `node_modules` empty,
 * and without it the same install exited 0. Against a warm cache the
 * peer-carrying tarball installed 2 packages where the other installed
 * 1, so npm resolves a peer dependency as a real install rather than a
 * hint.
 *
 * The README case reads the install section that ships in the tarball —
 * `files` publishes only `dist`, but npm packs `README.md` regardless,
 * which the pack case above pins. It builds both commands from the
 * manifest's own `name`, so renaming the package reddens it too.
 *
 * ## How the cases were shown to fail
 *
 * Eight mutations of `package.json` were driven against this file, one
 * run each, with the unmutated manifest green before and after them and
 * restored byte-identical. Seven reddened at least one case: `--splitting`
 * dropped (the two binding cases), `rm -rf dist` dropped (the stale chunk
 * case), the template copy dropped (re-measured below), `bin` renamed,
 * the ports entry dropped from the build, the CLI built from
 * `src/index.ts`, and `files` widened to `src`. The eighth, `--root=src`
 * dropped, is equivalent: bun's default root for these four entries is
 * their common directory, `src`, and every case stayed green.
 *
 * Once the skill joined the copy, two mutations of the copy clause were
 * run the same way. Dropping the whole clause reddened all eight template
 * cases that need a copied file: the three byte cases, the three `rafa
 * plan` runs, and both controls, since the file each removes was never
 * written. Dropping only the skill reddened three: its byte case, the
 * run outside the package and the skill control. The two runs inside the
 * scratch package stayed green, because `readPlanFormat` falls back to
 * the package's own skill one directory above `dist/`; that blind spot is
 * why the run outside the package exists.
 *
 * `check-types` skips this file. Checked through a tsconfig outside the
 * repo, it compiled clean, and a planted TS2322 in a second file of the
 * same program was reported.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import * as storeSource from '../effort/store/index.js';
import * as rootSource from '../index.js';
import * as planSource from '../plan/index.js';
import { buildPlanPrompt, planFormatCandidates } from '../plan.js';
import * as portsSource from '../ports/index.js';
import { PINNED_PLAN_CLASSES, pinnedPlanFileName, readPinnedPlan } from '../pr/plans/load.js';

import { plantProjectConfig } from './cli-capture.js';

/** The repository root: this file sits in `src/tests/`. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The binary the manifest maps, as the phase 0 spec gives it. */
const BIN = { rafa: './dist/cli.js' };

/** The exports map the manifest carries, as the phase 0 spec gives it. */
const EXPORTS = {
  '.': './dist/index.js',
  './cli': './dist/cli.js',
  './plan': './dist/plan/index.js',
  './store': './dist/effort/store/index.js',
  './ports': './dist/ports/index.js',
};

/** What the manifest publishes. */
const FILES = ['dist'];

/** How the manifest publishes: a scoped name needs the access spelled out. */
const PUBLISH_CONFIG = { access: 'public' };

/** The engine the build targets, and the only one the manifest names. */
const ENGINES = { bun: '>=1.3.14' };

/** The manifest's `module`: the root of the exports map, which the build writes. */
const MODULE = './dist/index.js';

/**
 * Every manifest key an install would resolve packages from. All are
 * absent, which is what lets a packed tarball install with no registry
 * access: measured on npm 11.1.0, a probe tarball carrying only
 * `peerDependencies: {typescript: ^5}` failed `npm install --offline`
 * against an empty cache with `ENOTCACHED` on
 * `https://registry.npmjs.org/typescript` and installed nothing, where
 * the same tarball without that key installed offline, exit 0.
 */
const DEPENDENCY_KEYS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundleDependencies',
  'bundledDependencies',
];

/** The dev-planner skill, from the repository root: the plan format. */
const SKILL = '.claude/skills/dev-planner/SKILL.md';

/** The files the scratch copy of the package takes besides `src/`. */
const PACKAGE_FILES = ['package.json', 'tsconfig.json', 'tsconfig.base.json', 'README.md', SKILL];

/** Each library entry: its path under `dist/`, and its source module. */
const LIBRARY_ENTRIES: [string, Record<string, unknown>][] = [
  ['index.js', rootSource],
  ['plan/index.js', planSource],
  ['effort/store/index.js', storeSource],
  ['ports/index.js', portsSource],
];

/** The subpath bundles whose every name the root bundle carries too. */
const CONTAINED_SUBPATHS = ['plan/index.js', 'effort/store/index.js'];

/**
 * The names phase 1 adds to the `./plan` entry, the preflight and the
 * PREREQUISITES parser, which the root bundle carries too.
 */
const PLAN_PREFLIGHT_NAMES = [
  'PROBE_TIMEOUT_MS',
  'loadPlanPrerequisites',
  'mergePlanPrerequisites',
  'parsePrerequisites',
  'planPrerequisites',
  'prerequisitesPathForPlan',
  'runPreflight',
  'runShellProbe',
];

/**
 * The names phase 1 adds to the root alone, scope resolution, the adapter
 * registry and the manifest validator, with the config resolver the root
 * already carried.
 */
const ROOT_SEAM_NAMES = [
  'CORE_ADAPTER_REGISTRY',
  'DISK_FILE_SYSTEM',
  'FEATURE_TYPES',
  'INIT_COMMAND',
  'MANIFEST_VERSION',
  'OUTPUT_CHANNELS',
  'PORT_VERSIONS',
  'RUNNING_MANIFEST_SEAMS',
  'SCOPE_DIR',
  'ScopeError',
  'createAdapterRegistry',
  'initHint',
  'loadConfig',
  'resolveConfig',
  'resolveScope',
  'scopeAt',
  'selfAndAncestors',
  'validateManifest',
];

/**
 * The templates the build copies beside its bundles: each one's source,
 * from the repository root, and its name in `dist/`.
 */
const TEMPLATES: [string, string][] = [
  ['src/PROMPT.md', 'PROMPT.md'],
  ['src/plan-prompt.md', 'plan-prompt.md'],
  [SKILL, 'SKILL.md'],
];

/**
 * The asset trees the build copies whole: each one’s directory under the
 * package root, and the directory it lands in under `dist/`. See the module
 * note on the clause.
 */
const ASSET_TREES: [string, string][] = [
  ['src/pr/plans', 'plans'],
  ['src/board/templates', 'templates'],
];

/**
 * The board template planted into the scratch package before the build,
 * beside the tracked `spec.md`; see the module note on why it is kept.
 */
const PLANTED_BOARD_TEMPLATE = 'spec-probe.md';

/** What {@link PLANTED_BOARD_TEMPLATE} holds. */
const PLANTED_BOARD_BODY = '<!-- No local paths. -->\n\n# Spec: a copied board template\n';

/** The modules sitting beside the pinned plans, which the build must not copy. */
const PLAN_READER_MODULES = ['load.ts', 'load.test.ts'];

/** The spec the template cases plan from, and what `rafa plan` is told. */
const SPEC = '# Spec: a build probe\n\nNothing to build.\n';
const PLAN_ARGS = ['--spec=spec.md', '--no-progress'];

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-build-'));

/** The scratch copy of the package the build runs in. */
const PACKAGE_DIR = join(tempRoot, 'package');

/** Where the build writes. */
const DIST = join(PACKAGE_DIR, 'dist');

/** A chunk planted in `dist/` before the build, which the build removes. */
const STALE_CHUNK = join(DIST, 'index-stale000.js');

/** What one command did. */
interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command to its end. */
function run(
  command: readonly string[],
  cwd: string,
  env: Record<string, string | undefined>,
): CommandRun {
  const proc = Bun.spawnSync([...command], { cwd, env });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** This process's environment, with the running bun first on PATH. */
function withBunOnPath(): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: [dirname(process.execPath), process.env['PATH'] ?? ''].join(delimiter),
  };
}

let build: CommandRun;
let plantedBeforeBuild = false;

beforeAll(() => {
  mkdirSync(DIST, { recursive: true });
  for (const file of PACKAGE_FILES) cpSync(join(REPO_ROOT, file), join(PACKAGE_DIR, file));
  cpSync(join(REPO_ROOT, 'src'), join(PACKAGE_DIR, 'src'), { recursive: true });
  const boardTemplates = join(PACKAGE_DIR, 'src', 'board', 'templates');
  mkdirSync(boardTemplates, { recursive: true });
  writeFileSync(join(boardTemplates, PLANTED_BOARD_TEMPLATE), PLANTED_BOARD_BODY, 'utf8');
  writeFileSync(STALE_CHUNK, 'export const stale = true;\n', 'utf8');
  plantedBeforeBuild = existsSync(STALE_CHUNK);
  build = run([process.execPath, 'run', 'build'], PACKAGE_DIR, withBunOnPath());
}, 60_000);

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** The repository's manifest. */
function readManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
}

/** Every file the build wrote, relative to `dist/`, sorted. */
function builtFiles(): string[] {
  return readdirSync(DIST, { recursive: true, encoding: 'utf8' })
    .filter((file) => statSync(join(DIST, file)).isFile())
    .sort();
}

/** A module of the build, imported into this process. */
async function importBuilt(path: string): Promise<Record<string, unknown>> {
  return await import(join(DIST, path)) as Record<string, unknown>;
}

/** What an import probe printed, and what its directory holds afterwards. */
interface ProbeRun extends CommandRun {
  readonly files: string[];
}

/**
 * Imports one module in a fresh process, from an empty directory of its
 * own, then prints the process's `SIGINT` and `SIGTERM` listener counts
 * and its exit code.
 */
function probeImport(modulePath: string): ProbeRun {
  const cwd = mkdtempSync(join(tempRoot, 'probe-'));
  writeFileSync(join(cwd, 'probe.ts'), [
    `await import(${JSON.stringify(modulePath)});`,
    'console.log(JSON.stringify([',
    '  process.listenerCount(\'SIGINT\'),',
    '  process.listenerCount(\'SIGTERM\'),',
    '  process.exitCode ?? null,',
    ']));',
    '',
  ].join('\n'), 'utf8');
  const probe = run([process.execPath, 'probe.ts'], cwd, process.env);
  return { ...probe, files: readdirSync(cwd).sort() };
}

/** Everything one `rafa plan` run lives in. */
interface PlanScratch {
  readonly root: string;
  /** The repository the command runs in. */
  readonly repo: string;
  /** Where the stand-in keeps the prompt it is handed, outside the repository. */
  readonly prompt: string;
  /** Where the stand-in keeps the arguments it is handed, one per line. */
  readonly args: string;
  /** The stand-in, then git, on PATH, and a HOME of its own. */
  readonly env: Record<string, string>;
}

/**
 * A scratch repository holding the spec, beside a stand-in `claude` that
 * keeps its prompt and exits 0 having written no plan.
 */
function plantPlanScratch(name: string): PlanScratch {
  const root = join(tempRoot, `plan-${name}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });

  const prompt = join(root, 'prompt.md');
  const args = join(root, 'args.txt');
  const claude = join(bin, 'claude');
  const keepArgs = `for arg in "$@"; do printf '%s\\n' "$arg"; done > '${args}'`;
  writeFileSync(claude, ['#!/bin/sh', keepArgs, `/bin/cat > '${prompt}'`, 'exit 0', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  const init = Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: repo });
  if (init.exitCode !== 0) throw new Error(`git init: ${init.stderr.toString()}`);
  writeFileSync(join(repo, 'spec.md'), SPEC, 'utf8');
  plantProjectConfig(repo);

  const git = Bun.which('git');
  if (git === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, dirname(git)].join(delimiter);
  const resolved = Bun.which('claude', { PATH: path });
  if (resolved !== claude) throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);

  return { root, repo, prompt, args, env: { PATH: path, HOME: home } };
}

/** The arguments the stand-in keeps for a plan session under `sources`, one per line. */
function planSessionArgs(sources: string): string {
  return ['-p', '--dangerously-skip-permissions', '--setting-sources', sources, ''].join('\n');
}

/** Writes `text` as the user scope's `.rafa/config.yaml` under the scratch HOME. */
function plantUserConfig(scratch: PlanScratch, text: string): void {
  const home = scratch.env['HOME'] ?? '';
  expect(home.startsWith(tempRoot)).toBe(true);
  mkdirSync(join(home, '.rafa'), { recursive: true });
  writeFileSync(join(home, '.rafa', 'config.yaml'), text, 'utf8');
}

/**
 * A copy of the build at `dist/` under a scratch root, outside the
 * scratch package, with `removed` taken out of it.
 */
function copyBuildOutsidePackage(scratch: PlanScratch, removed: string | null): string {
  const copy = join(scratch.root, 'dist');
  cpSync(DIST, copy, { recursive: true });
  if (removed !== null) rmSync(join(copy, removed));
  return copy;
}

/** The candidates `readPlanFormat` would find from `moduleDir`. */
function presentPlanFormats(moduleDir: string): string[] {
  return planFormatCandidates(moduleDir).filter((candidate) => existsSync(candidate));
}

/** The prompt `rafa plan` builds from the source template and skill for {@link SPEC}. */
function expectedPlanPrompt(): string {
  const template = readFileSync(join(REPO_ROOT, 'src', 'plan-prompt.md'), 'utf8');
  const skill = readFileSync(join(REPO_ROOT, SKILL), 'utf8');
  return buildPlanPrompt(template, skill, SPEC, 'spec', '.rafa/plans');
}

describe('the package manifest', () => {
  it('maps the rafa binary to the built CLI', () => {
    expect(readManifest()['bin']).toEqual(BIN);
  });

  it('maps the root and the four subpaths to their builds, and nothing else', () => {
    expect(readManifest()['exports']).toEqual(EXPORTS);
  });

  it('publishes the build directory and nothing else', () => {
    expect(readManifest()['files']).toEqual(FILES);
  });

  it('is publishable, and publishes the scoped name publicly', () => {
    const manifest = readManifest();

    expect(manifest['private']).toBe(false);
    expect(manifest['publishConfig']).toEqual(PUBLISH_CONFIG);
    expect(String(manifest['name']).startsWith('@')).toBe(true);
  });

  it('names bun as its engine, and no node version', () => {
    expect(readManifest()['engines']).toEqual(ENGINES);
  });

  it('points module at the built root export, not at a source placeholder', () => {
    expect(readManifest()['module']).toBe(MODULE);
    expect(MODULE).toBe(EXPORTS['.']);
    expect(existsSync(join(PACKAGE_DIR, MODULE))).toBe(true);
  });

  it('declares no runtime dependency, so an install resolves nothing but the package', () => {
    const manifest = readManifest();

    expect(DEPENDENCY_KEYS.filter((key) => key in manifest)).toEqual([]);
    expect(Object.keys(manifest['devDependencies'] as Record<string, unknown>).length).toBeGreaterThan(0);
  });
});

describe('the README', () => {
  it('gives both global install commands, each naming the package the manifest does', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const name = String(readManifest()['name']);
    const commands = [`npm i -g ${name}`, `bun add -g ${name}`];

    expect(commands.filter((command) => !readme.includes(command))).toEqual([]);
  });
});

describe('the build script, run in a copy of the package', () => {
  it('exits 0', () => {
    expect(build.exitCode).toBe(0);
  });

  it('writes every file the binary and the exports map name', () => {
    const targets = [...new Set([...Object.values(BIN), ...Object.values(EXPORTS)])];
    const missing = targets.filter((target) => !existsSync(join(PACKAGE_DIR, target)));

    expect(targets).toHaveLength(5);
    expect(missing).toEqual([]);
  });

  it('clears dist before it writes, so an earlier build leaves no chunk behind', () => {
    expect(plantedBeforeBuild).toBe(true);
    expect(existsSync(STALE_CHUNK)).toBe(false);
  });

  it('packs the manifest, the README and the build, and nothing else', () => {
    const pack = run([process.execPath, 'pm', 'pack', '--dry-run'], PACKAGE_DIR, withBunOnPath());
    const packed = [...pack.stdout.matchAll(/^packed \S+ (.+)$/gm)]
      .map((match) => match[1] ?? '')
      .sort();
    const expected = ['README.md', 'package.json', ...builtFiles().map((file) => `dist/${file}`)].sort();

    expect(pack.exitCode).toBe(0);
    expect(expected.length).toBeGreaterThan(2);
    expect(packed).toEqual(expected);
  }, 30_000);
});

describe('the built CLI', () => {
  it('keeps the bun shebang and runs as the binary, answering as src/rafa.ts does', () => {
    const cli = join(DIST, 'cli.js');
    const fromSource = run([process.execPath, join(REPO_ROOT, 'src', 'rafa.ts'), '--help'], tempRoot, withBunOnPath());
    const fromBuild = run([cli, '--help'], tempRoot, withBunOnPath());

    expect(readFileSync(cli, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env bun');
    expect(fromSource.exitCode).toBe(0);
    expect(fromSource.stdout).toContain('rafa <subject> <action> [args] [flags]\n');
    expect(fromBuild).toEqual(fromSource);
  }, 30_000);

  it('gives the roster from a copy of the build outside the package as src/rafa.ts does, stamped with the manifest version', () => {
    const copy = join(tempRoot, 'describe-outside', 'dist');
    cpSync(DIST, copy, { recursive: true });
    const env = {
      ...Object.fromEntries(Object.entries(withBunOnPath()).filter(([name]) => !name.startsWith('RAFA_'))),
      HOME: tempRoot,
    };
    const fromSource = run([process.execPath, join(REPO_ROOT, 'src', 'rafa.ts'), 'describe'], tempRoot, env);
    const fromBuild = run([process.execPath, join(copy, 'cli.js'), 'describe'], tempRoot, env);

    expect(fromSource.exitCode).toBe(0);
    expect(existsSync(join(copy, '..', 'package.json'))).toBe(false);
    expect((JSON.parse(fromBuild.stdout) as { version?: unknown }).version).toBe(readManifest()['version']);
    expect(fromBuild).toEqual(fromSource);
  }, 30_000);

  it('prints its help when imported and sets the exit code it answers, which the import probe can see', () => {
    const probe = probeImport(join(DIST, 'cli.js'));

    expect(probe.exitCode).toBe(0);
    expect(probe.stdout).toContain('rafa <subject> <action> [args] [flags]\n');
    expect(probe.stdout.endsWith('\n[0,0,0]\n')).toBe(true);
  }, 30_000);
});

describe('the built library entries', () => {
  it.each(LIBRARY_ENTRIES)('export from dist/%s the runtime names their source does', async (path, source) => {
    expect(Object.keys(await importBuilt(path)).sort()).toEqual(Object.keys(source).sort());
  });

  it.each(CONTAINED_SUBPATHS)('keep every name of dist/%s the root bundle binding itself', async (subpath) => {
    const root = await importBuilt('index.js');
    const bundle = await importBuilt(subpath);
    const names = Object.keys(bundle);
    const copied = names.filter((name) => root[name] !== bundle[name]);

    expect(names.length).toBeGreaterThan(0);
    expect(copied).toEqual([]);
  });

  it.each(LIBRARY_ENTRIES)('import dist/%s in a fresh process without running anything', (path) => {
    expect(probeImport(join(DIST, path))).toEqual({
      exitCode: 0,
      stdout: '[0,0,null]\n',
      stderr: '',
      files: ['probe.ts'],
    });
  }, 30_000);
});

describe('the names phase 1 adds, in the built entries', () => {
  it('carries the preflight and the PREREQUISITES parser in dist/plan/index.js, as the same bindings in dist/index.js', async () => {
    const plan = await importBuilt('plan/index.js');
    const root = await importBuilt('index.js');

    expect(PLAN_PREFLIGHT_NAMES.filter((name) => !(name in plan))).toEqual([]);
    expect(PLAN_PREFLIGHT_NAMES.filter((name) => root[name] !== plan[name])).toEqual([]);
  });

  it('carries the config resolver, scope resolution, the adapter registry and the manifest validator in dist/index.js', async () => {
    const root = await importBuilt('index.js');
    const start = mkdtempSync(join(tempRoot, 'scope-'));
    const resolveScope = root['resolveScope'] as (start: string, seams: { home: string }) => unknown;
    const validateManifest = root['validateManifest'] as (raw: unknown) => { ok: boolean };

    expect(ROOT_SEAM_NAMES.filter((name) => !(name in root))).toEqual([]);
    expect(root['PORT_VERSIONS']).toEqual(rootSource.PORT_VERSIONS);
    expect(root['RUNNING_MANIFEST_SEAMS']).toEqual({
      rafaVersion: readManifest()['version'],
      portVersions: rootSource.PORT_VERSIONS,
    });
    expect(resolveScope(start, { home: tempRoot })).toMatchObject({ found: false, start, home: tempRoot });
    expect(validateManifest({})).toMatchObject({ ok: false });
  });

  it('loads dist/plan/index.js under node with the names its source exports, where node refuses dist/index.js', () => {
    const node = Bun.which('node');
    if (node === null) throw new Error('node is not on the PATH this suite runs under');
    const load = (path: string) => run([
      node,
      '--input-type=module',
      '-e',
      `console.log(JSON.stringify(Object.keys(await import(${JSON.stringify(pathToFileURL(path).href)})).sort()));`,
    ], tempRoot, process.env);

    expect(load(join(DIST, 'plan', 'index.js'))).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify(Object.keys(planSource).sort())}\n`,
      stderr: '',
    });
    const root = load(join(DIST, 'index.js'));
    expect(root.exitCode).not.toBe(0);
    expect(root.stderr).toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME');
    expect(root.stderr).toContain('bun:');
  }, 30_000);
});

describe('the prompt templates in the build', () => {
  it.each(TEMPLATES)('copies %s into dist as %s, unchanged', (source, name) => {
    const built = join(DIST, name);

    expect(existsSync(built)).toBe(true);
    expect(readFileSync(built, 'utf8')).toBe(readFileSync(join(REPO_ROOT, source), 'utf8'));
  });

  it('writes every built file that reads import.meta.url directly into dist', () => {
    const readers = builtFiles()
      .filter((file) => file.endsWith('.js'))
      .filter((file) => readFileSync(join(DIST, file), 'utf8').includes('import.meta.url'));

    expect(readers.length).toBeGreaterThan(0);
    expect(readers.filter((file) => file.includes('/'))).toEqual([]);
  });

  it('hands rafa plan the template beside dist/cli.js', () => {
    const scratch = plantPlanScratch('cli');
    const plan = run([process.execPath, join(DIST, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(readFileSync(scratch.prompt, 'utf8')).toBe(expectedPlanPrompt());
    expect(readFileSync(scratch.args, 'utf8')).toBe(planSessionArgs('project,local'));
    expect(plan.exitCode).toBe(1);
  }, 30_000);

  it('spawns rafa plan under the setting sources a user config names', () => {
    const scratch = plantPlanScratch('sources');
    plantUserConfig(scratch, 'loop:\n  settingSources: local,user\n');
    const plan = run([process.execPath, join(DIST, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(readFileSync(scratch.args, 'utf8')).toBe(planSessionArgs('local,user'));
    expect(readFileSync(scratch.prompt, 'utf8')).toBe(expectedPlanPrompt());
    expect(plan.exitCode).toBe(1);
  }, 30_000);

  it('refuses rafa plan on a config it cannot run on, before any session starts', () => {
    const scratch = plantPlanScratch('refused-config');
    plantUserConfig(scratch, 'loop:\n  settingSources: everyone\n');
    const plan = run([process.execPath, join(DIST, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(plan.exitCode).toBe(1);
    expect(plan.stderr).toContain('Refusing to generate a plan on this configuration');
    expect(plan.stderr).toContain('loop.settingSources is "everyone"');
    expect(existsSync(scratch.prompt)).toBe(false);
    expect(existsSync(scratch.args)).toBe(false);
  }, 30_000);

  it('hands planCommand the template beside dist/index.js', () => {
    const scratch = plantPlanScratch('library');
    const probe = join(scratch.root, 'probe.ts');
    writeFileSync(probe, [
      `const { planCommand } = await import(${JSON.stringify(join(DIST, 'index.js'))});`,
      `await planCommand(${JSON.stringify(PLAN_ARGS)}, ${JSON.stringify(scratch.repo)});`,
      '',
    ].join('\n'), 'utf8');
    const plan = run([process.execPath, probe], scratch.repo, scratch.env);

    expect(readFileSync(scratch.prompt, 'utf8')).toBe(expectedPlanPrompt());
    expect(plan.exitCode).toBe(1);
  }, 30_000);

  it('hands rafa plan the format from a copy of the build outside the package', () => {
    const scratch = plantPlanScratch('outside');
    const copy = copyBuildOutsidePackage(scratch, null);
    const plan = run([process.execPath, join(copy, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(presentPlanFormats(copy)).toEqual([join(copy, 'SKILL.md')]);
    expect(readFileSync(scratch.prompt, 'utf8')).toBe(expectedPlanPrompt());
    expect(plan.exitCode).toBe(1);
  }, 30_000);

  it('refuses before any session when the template is missing beside the bundle', () => {
    const scratch = plantPlanScratch('control');
    const bare = copyBuildOutsidePackage(scratch, 'plan-prompt.md');
    const plan = run([process.execPath, join(bare, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(plan.exitCode).not.toBe(0);
    expect(plan.stderr).toContain('ENOENT');
    expect(plan.stderr).toContain('plan-prompt.md');
    expect(existsSync(scratch.prompt)).toBe(false);
  }, 30_000);

  it('refuses before any session when the skill is missing beside a bundle outside the package', () => {
    const scratch = plantPlanScratch('control-skill');
    const bare = copyBuildOutsidePackage(scratch, 'SKILL.md');
    const plan = run([process.execPath, join(bare, 'cli.js'), 'plan', ...PLAN_ARGS], scratch.repo, scratch.env);

    expect(presentPlanFormats(bare)).toEqual([]);
    expect(plan.exitCode).not.toBe(0);
    expect(plan.stderr).toContain('The plan format is missing');
    expect(plan.stderr).toContain(join(bare, 'SKILL.md'));
    expect(existsSync(scratch.prompt)).toBe(false);
  }, 30_000);
});

describe('the asset trees in the build', () => {
  it.each(ASSET_TREES)('copies every markdown file of %s into dist/%s, unchanged', (tree, name) => {
    const source = join(PACKAGE_DIR, tree);
    const built = join(DIST, name);
    const names = readdirSync(source)
      .filter((file) => file.endsWith('.md'))
      .sort();
    const differing = names.filter(
      (file) => !existsSync(join(built, file))
        || readFileSync(join(built, file), 'utf8') !== readFileSync(join(source, file), 'utf8'),
    );

    expect(names.length).toBeGreaterThan(0);
    expect(differing).toEqual([]);
    expect(readdirSync(built).sort()).toEqual(names);
  });

  it('copies the planted board template, so the board tree is read on a tree with a file in it', () => {
    const built = join(DIST, 'templates', PLANTED_BOARD_TEMPLATE);

    expect(existsSync(built)).toBe(true);
    expect(readFileSync(built, 'utf8')).toBe(PLANTED_BOARD_BODY);
  });

  it('copies no TypeScript out of src/pr/plans, so the reader modules stay unpublished', () => {
    const source = readdirSync(join(PACKAGE_DIR, 'src/pr/plans')).sort();
    const copied = readdirSync(join(DIST, 'plans')).filter((file) => file.endsWith('.ts'));

    expect(PLAN_READER_MODULES.filter((module) => !source.includes(module))).toEqual([]);
    expect(copied).toEqual([]);
  });

  it('lands each pinned plan where readPinnedPlan looks for it from a bundle in dist', () => {
    const differing = PINNED_PLAN_CLASSES.filter(
      (triageClass) => readPinnedPlan(triageClass, { moduleDir: DIST })
        !== readFileSync(join(PACKAGE_DIR, 'src/pr/plans', pinnedPlanFileName(triageClass)), 'utf8'),
    );

    expect(PINNED_PLAN_CLASSES.length).toBeGreaterThan(0);
    expect(differing).toEqual([]);
  });
});
