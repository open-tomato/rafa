/**
 * Tests for the package's published shape: the `bin`, `exports` and
 * `files` fields of `package.json`, and the `build` script that writes
 * what those fields name.
 *
 * The three fields are spelled HERE, as the phase 0 spec gives them, so a
 * target renamed in the manifest fails a case instead of agreeing with
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
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import * as storeSource from '../effort/store/index.js';
import * as rootSource from '../index.js';
import * as planSource from '../plan/index.js';
import { buildPlanPrompt, planFormatCandidates } from '../plan.js';
import * as portsSource from '../ports/index.js';

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
 * The templates the build copies beside its bundles: each one's source,
 * from the repository root, and its name in `dist/`.
 */
const TEMPLATES: [string, string][] = [
  ['src/PROMPT.md', 'PROMPT.md'],
  ['src/plan-prompt.md', 'plan-prompt.md'],
  [SKILL, 'SKILL.md'],
];

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
  return buildPlanPrompt(template, skill, SPEC, 'spec');
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
