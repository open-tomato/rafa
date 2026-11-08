/**
 * Test helpers shared by the add-on's test files: temp folders that are
 * removed after each test, and a fake process runner. Imported by tests
 * only.
 */

import type { LoadedConfig } from './config/load.js';
import type { D2cConfig, RunnerConfig, StoreConfig } from './config/read.js';
import type { HostFacts } from './host.js';
import type { ProcessResult, ProcessRunner } from './process.js';
import type { RafaContext } from '@open-tomato/rafa-core/core/command';

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A set of temp folders, each a real path, removed by {@link TempDirs.clean}. */
export class TempDirs {
  private readonly made: string[] = [];

  /** A new empty folder. */
  async make(prefix = 'd2c-'): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    this.made.push(dir);
    return dir;
  }

  /** Removes every folder made. */
  async clean(): Promise<void> {
    await Promise.all(this.made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
}

/** One scripted answer: the argv prefix it matches, and what it answers. */
export type FakeAnswer = readonly [readonly string[], Partial<ProcessResult>];

/** A runner answering the first answer whose argv prefix matches, exit 0 and empty output otherwise; `seen` records every argv. */
export function fakeRunner(answers: readonly FakeAnswer[] = [], seen: string[][] = []): ProcessRunner {
  return (argv) => {
    seen.push([...argv]);
    const match = answers.find(([prefix]) => prefix.every((word, index) => argv[index] === word));
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', ...match?.[1] });
  };
}

/** The pieces of a test project: its root, its package folder and its store folder. */
export interface TestProject {
  readonly root: string;
  readonly packageDir: string;
  readonly storeDir: string;
  readonly loaded: LoadedConfig;
}

/** The suite settings a test project uses. */
const TEST_SUITE = Object.freeze({
  kind: 'storybook-jest' as const,
  package: 'packages/ui',
  snapshots: 'visual/__image_snapshots__',
  diffs: 'visual/__diff_output__',
  report: 'visual-report.json',
  index: 'storybook-static/index.json',
  command: 'bun run test:visual',
});

/**
 * A project with an installed playwright-core at `playwrightVersion` and
 * a side-repo store folder, as a config already loaded. `overrides`
 * replaces the runner, the store kind or the suite command.
 */
export async function makeTestProject(
  temp: TempDirs,
  overrides: { runner?: RunnerConfig; storeKind?: 'local-dir' | 'side-repo' | 'same-repo'; command?: string; playwrightVersion?: string } = {},
): Promise<TestProject> {
  const root = await temp.make('d2c-project-');
  const storeDir = await temp.make('d2c-store-');
  const packageDir = join(root, TEST_SUITE.package);
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, 'package.json'), '{"name":"ui"}');
  await mkdir(join(root, 'node_modules', 'playwright-core'), { recursive: true });
  await writeFile(
    join(root, 'node_modules', 'playwright-core', 'package.json'),
    JSON.stringify({ name: 'playwright-core', version: overrides.playwrightVersion ?? '1.61.1' }),
  );
  const kind = overrides.storeKind ?? 'side-repo';
  const store: StoreConfig = kind === 'same-repo'
    ? { kind, set: 'packages-ui' }
    : { kind, dir: storeDir, set: 'packages-ui' };
  const config: D2cConfig = {
    visual: {
      suite: { ...TEST_SUITE, command: overrides.command ?? TEST_SUITE.command },
      runner: overrides.runner ?? { kind: 'host' },
      store,
    },
  };
  return { root, packageDir, storeDir, loaded: { config, file: join(root, '.rafa', 'd2c.yaml'), root, warnings: [] } };
}

/** Writes PNG-named files holding the given text into `dir`. */
export async function writeShots(dir: string, shots: Readonly<Record<string, string>>): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(shots)) await writeFile(join(dir, name), text);
}

/** The host facts a test runs as. */
export const TEST_HOST: HostFacts = Object.freeze({ platform: 'darwin', arch: 'arm64', os: 'macOS 26.6.2' });

/** A set record for tests: packages-ui at 1.61.1 on the test host. */
export const TEMP_RECORD = Object.freeze({
  set: 'packages-ui',
  playwrightVersion: '1.61.1',
  runner: Object.freeze({ kind: 'host' as const, platform: 'darwin-arm64', os: 'macOS 26.6.2' }),
  projectCommit: 'abc1234',
  projectDirty: false,
  promotedAt: '2026-11-08T14:25:00Z',
  files: 1,
  lastRun: null,
});

/** What a test command printed, by level. */
export interface PrintedLines {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
}

/**
 * A context for running a command in a test: the project at `root`
 * already resolved, the given flags and words after the action, and an
 * output that records every line.
 */
export function testContext(
  root: string,
  options: { flags?: Readonly<Record<string, string | boolean>>; argv?: readonly string[] } = {},
): { context: RafaContext; printed: PrintedLines } {
  const printed: PrintedLines = { info: [], warn: [], error: [] };
  const output = {
    info: (line: string) => printed.info.push(line),
    warn: (line: string) => printed.warn.push(line),
    error: (line: string) => printed.error.push(line),
    debug: () => undefined,
    emit: () => undefined,
    result: () => undefined,
  };
  const context = {
    args: [],
    argv: options.argv ?? [],
    flags: options.flags ?? {},
    env: { HOME: root },
    output,
    outputMode: 'text',
    verbosity: 1,
    signal: new AbortController().signal,
    project: { root },
  } as unknown as RafaContext;
  return { context, printed };
}

/** Writes a project's `.rafa/d2c.yaml` from a config value. */
export async function writeConfigFile(project: TestProject): Promise<void> {
  await mkdir(join(project.root, '.rafa'), { recursive: true });
  await writeFile(project.loaded.file, Bun.YAML.stringify(project.loaded.config));
}

/** Snapshot counts with every field zero, for spreading. */
export const ZERO_COUNTS = Object.freeze({ matched: 0, added: 0, updated: 0, unmatched: 0, total: 0 });

/** Writes the jest report the test project's suite reads, holding `counts` and one passed test per story pair. */
export async function writeReport(
  project: TestProject,
  counts: Partial<Record<'matched' | 'added' | 'updated' | 'unmatched' | 'total', number>>,
  stories: readonly (readonly [string, string, string])[] = [],
): Promise<void> {
  const assertionResults = stories.map(([title, name, status]) => ({ ancestorTitles: [title, name], title: 'smoke-test', status }));
  await writeFile(
    join(project.packageDir, 'visual-report.json'),
    JSON.stringify({ snapshot: { ...ZERO_COUNTS, ...counts }, testResults: [{ assertionResults }] }),
  );
}

/** Writes the story index the test project's suite reads, one story per `[title, name, id]`. */
export async function writeIndex(project: TestProject, stories: readonly (readonly [string, string, string])[]): Promise<void> {
  await mkdir(join(project.packageDir, 'storybook-static'), { recursive: true });
  const entries = Object.fromEntries(stories.map(([title, name, id]) => [id, { type: 'story', id, title, name }]));
  await writeFile(join(project.packageDir, 'storybook-static', 'index.json'), JSON.stringify({ v: 5, entries }));
}
