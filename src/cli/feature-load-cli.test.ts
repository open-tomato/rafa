/**
 * The bundled features load their command modules when a command runs,
 * and a module loads its adapters when the config names it: read off a
 * fresh process each time, since the modules a process holds loaded are
 * the one thing a second import in this process hides.
 *
 * `feature-load-probe.ts` is spawned with `bun`. In its roster mode it
 * does what `src/rafa.ts` does before dispatching (registers core's
 * config sections, adapters and services, builds
 * `createRosterRegistry()`, renders every help level and
 * `describeRegistry`) and prints the modules of
 * `require.cache` relative to the repository root. The cases hold that:
 *
 *   - none of the modules `src/commands/<subject>/<action>.ts` of a
 *     declared feature action is among them;
 *   - after one feature command's `run` (`--run=claim release`, which
 *     refuses for want of its argument) that command's module is loaded
 *     and no other module of its feature is.
 *
 * In its module mode it loads the modules of a scratch project, with
 * `loadInvocationModules` and `activateModuleAdapters`. With no module
 * configured nothing under `packages/rafa/src/modules/testdata/` is loaded and
 * `CORE_ADAPTER_REGISTRY` holds core's kinds alone; with `sync-fixture`
 * on `modules:` and `allowList:` its `sync.ts` is loaded and its `git`
 * kind resolves.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { configFilePath } from '@open-tomato/rafa/core/config';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';

import { expectExit } from '../tests/cli-capture.js';

/** The repository root: the probe's working directory. */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The probe, as a path the spawned `bun` is handed. */
const PROBE = fileURLToPath(new URL('./feature-load-probe.ts', import.meta.url));

/** The `sync-fixture` module's directory under `packages/rafa/src/modules/testdata/`. */
const FIXTURE_MODULE = fileURLToPath(new URL('../../packages/rafa/src/modules/testdata/sync-fixture', import.meta.url));

/** How long one spawned probe may run. */
const RUN_TIMEOUT = { timeout: 60_000 };

/** The command the run case runs: a `run` feature command that refuses for want of an argument. */
const RUN_COMMAND = { feature: 'run', subject: 'claim', action: 'release' };

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-feature-load-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** One action a bundled feature declares. */
interface FeatureAction {
  readonly feature: string;
  readonly subject: string;
  readonly action: string;
}

/** What the roster mode prints. */
interface RosterReading {
  readonly loaded: readonly string[];
  readonly featureActions: readonly FeatureAction[];
  readonly refusal?: string | null;
}

/** What the module mode prints. */
interface ModulesReading {
  readonly loaded: readonly string[];
  readonly kindsBefore: Readonly<Record<string, readonly string[]>>;
  readonly kindsAfter: Readonly<Record<string, readonly string[]>>;
  readonly syncGitResolves: boolean;
  readonly warnings: readonly string[];
}

/** Spawns the probe fresh with `args` and answers the JSON line it printed. */
async function probe<T>(args: readonly string[], home: string): Promise<T> {
  const child = Bun.spawn(['bun', PROBE, ...args], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, RAFA_TEST: '1', TMPDIR: tmpdir(), ...scratchHomeEnv(home) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expectExit({ exitCode, stdout, stderr }, 0);
  return JSON.parse(stdout.trim()) as T;
}

/** A scratch directory of its own under {@link tempBase}. */
function scratchDir(name: string): string {
  const dir = join(tempBase, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The path of the module a feature action's command lives in, relative to the repository root. */
function modulePath(action: FeatureAction): string {
  return `src/commands/${action.subject}/${action.action}.ts`;
}

/** A project holding `config`, and a home beside it, as {@link probe} takes them. */
function plantProject(name: string, config: string): { project: string; home: string } {
  const project = scratchDir(`${name}-project`);
  mkdirSync(dirname(configFilePath(project)), { recursive: true });
  writeFileSync(configFilePath(project), config, 'utf8');
  return { project, home: scratchDir(`${name}-home`) };
}

describe('the roster in a fresh process', () => {
  it('loads no feature command module, though the features, their declarations and every help level are read', async () => {
    const reading = await probe<RosterReading>([], scratchDir('roster-home'));

    expect(reading.featureActions.length).toBeGreaterThan(0);
    const modules = reading.featureActions.map(modulePath);
    expect(reading.loaded.filter((path) => modules.includes(path))).toEqual([]);
    // Controls: the reading sees the declarations and a core command, so an empty answer is no blind one.
    expect(reading.loaded).toContain('src/commands/claim/declarations.ts');
    expect(reading.loaded).toContain('packages/rafa-pr/src/commands/pr/declarations.ts');
    expect(reading.loaded).toContain('src/commands/plan/list.ts');
  }, RUN_TIMEOUT);

  it('names all four features among the actions it declares', async () => {
    const reading = await probe<RosterReading>([], scratchDir('features-home'));

    expect([...new Set(reading.featureActions.map((action) => action.feature))].sort())
      .toEqual(['board', 'pr', 'release', 'run']);
  }, RUN_TIMEOUT);

  it('loads the module of a feature command once it runs, and no other module of its feature', async () => {
    const reading = await probe<RosterReading>([`--run=${RUN_COMMAND.subject} ${RUN_COMMAND.action}`], scratchDir('run-home'));

    const ran = reading.featureActions.find((action) => action.subject === RUN_COMMAND.subject && action.action === RUN_COMMAND.action);
    expect(ran?.feature).toBe(RUN_COMMAND.feature);
    expect(reading.refusal).toContain('rafa claim release');
    expect(reading.refusal).not.toContain('failed to load');
    const siblings = reading.featureActions.filter((action) => action.feature === RUN_COMMAND.feature && action !== ran);
    expect(siblings.length).toBeGreaterThan(0);
    expect(reading.loaded).toContain('src/commands/claim/release.ts');
    expect(reading.loaded.filter((path) => siblings.map(modulePath).includes(path))).toEqual([]);
  }, RUN_TIMEOUT);

  it('leaves the other features\' command modules unloaded when one runs', async () => {
    const reading = await probe<RosterReading>([`--run=${RUN_COMMAND.subject} ${RUN_COMMAND.action}`], scratchDir('others-home'));

    const others = reading.featureActions.filter((action) => action.feature !== RUN_COMMAND.feature).map(modulePath);
    expect(reading.loaded.filter((path) => others.includes(path))).toEqual([]);
  }, RUN_TIMEOUT);
});

describe('the modules of a scratch project in a fresh process', () => {
  it('loads nothing under packages/rafa/src/modules/testdata/ and leaves core\'s kinds alone when no module is configured', async () => {
    const { project, home } = plantProject('none', 'version: 1\n');

    const reading = await probe<ModulesReading>([`--project=${project}`, `--home=${home}`], home);

    expect(reading.warnings).toEqual([]);
    expect(reading.loaded.filter((path) => path.startsWith('packages/rafa/src/modules/testdata/'))).toEqual([]);
    expect(reading.kindsBefore['sync']?.length).toBeGreaterThan(0);
    expect(reading.kindsAfter).toEqual(reading.kindsBefore);
    expect(reading.kindsBefore['sync']).not.toContain('git');
    expect(reading.syncGitResolves).toBe(false);
  }, RUN_TIMEOUT);

  it('loads the entry of sync-fixture and resolves its kind when the allowList names it', async () => {
    const config = ['version: 1', 'modules:', `  - path: ${FIXTURE_MODULE}`, 'allowList:', '  - sync-fixture', ''].join('\n');
    const { project, home } = plantProject('fixture', config);

    const reading = await probe<ModulesReading>([`--project=${project}`, `--home=${home}`], home);

    expect(reading.warnings).toEqual([]);
    expect(reading.loaded).toContain('packages/rafa/src/modules/testdata/sync-fixture/sync.ts');
    expect(reading.syncGitResolves).toBe(true);
    expect(reading.kindsAfter['sync']).toEqual([...(reading.kindsBefore['sync'] ?? []), 'git']);
  }, RUN_TIMEOUT);
});
