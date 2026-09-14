/**
 * Tests for the library's entry: the surface the package root exposes,
 * that it reaches everything the CLI reaches, and that importing it runs
 * nothing.
 *
 * The root's export list is spelled HERE rather than read off the
 * modules, so a name added to the entry or dropped from it fails a case
 * instead of agreeing with itself. Each value is held identical to its
 * module's own, which tells a re-export apart from a copy or a wrapper
 * answering the same thing.
 *
 * The containment cases are computed instead: every runtime name the
 * `./plan` entry, the `./store` entry and the two config modules export is
 * held to be on the root as the same binding. Paired with the spelled
 * list, a name added to a subpath and not to the root reds the
 * containment case, and one added to both reds the spelled list, so
 * neither grows the root unseen.
 *
 * The CLI case reads `src/rafa.ts`'s own imports off its source and
 * holds every binding it imports to be a root export's value, so a
 * sixth command dispatched there and not exported here goes red. The
 * parsed import list is also held to the spelled one, which is what
 * keeps a parser that matched nothing from passing vacuously.
 *
 * The import cases run a probe in a fresh process, from an empty
 * directory outside any repository: import one module by absolute path,
 * then print the process's `SIGINT` and `SIGTERM` listener counts, its
 * exit code and the module's export count. Importing the entry prints
 * that line alone and leaves the directory holding only the probe. The
 * control imports `src/rafa.ts` the same way, which prints the CLI's
 * help above the probe's line: the check can see a module that does
 * something when imported.
 *
 * Ten mutations were driven against this file, one run each, with the
 * unmodified modules green before them and restored byte-identical
 * after, and every one reddened at least one case. Eight changed the
 * entry: `startCommand`'s export dropped, `effortReportCommand` exported
 * as a wrapper, `parseReport` dropped, the SQLite migration function
 * exported as well, `loadConfig` and `resolveConfig` exported under each
 * other's names, and, red on the import probe alone, a `SIGINT`
 * listener, a printed line and an exit code added at import. Two
 * changed `src/rafa.ts`: one more binding imported, and a module
 * imported as a namespace, a form the import reader refuses rather than
 * skips. Each of those two reddened both CLI cases.
 *
 * The type names are not checked here, and `check-types` skips this
 * file. Checked through a tsconfig outside the repo, a probe
 * re-exporting from the entry all sixty-seven type names the `./plan`
 * entry, the `./store` entry and the two config modules export compiled,
 * and
 * one naming `TaskDeclaration`, which the entry leaves out, failed with
 * TS2305.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig, readConfigFile } from './config-load.js';
import * as configLoadModule from './config-load.js';
import {
  CLAUDE_SETTING_SOURCES,
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  CONFIG_VERSIONS,
  ConfigError,
  configFilePath,
  INJECT_MODES,
  MODULE_SOURCE_KINDS,
  OUTPUT_MODES,
  parseConfigText,
  PREREQUISITE_KINDS,
  resolveConfig,
  STORE_BACKENDS,
} from './config.js';
import * as configModule from './config.js';
import effortCollect from './effort/collect.js';
import effortReport from './effort/report.js';
import {
  EFFORT_KEY_PROJECTIONS,
  openNdjsonStore,
  openSqliteStore,
  selectEffortStore,
} from './effort/store/index.js';
import * as storeEntry from './effort/store/index.js';
import {
  FINDING_KINDS,
  FINDING_SIGNALS,
  isRafaBlockKind,
  parsePlan,
  parseReport,
  PLAN_BLOCK_KINDS,
  PLAN_HEADER_FIELDS,
  RAFA_BLOCK_KINDS,
  readRafaBlocks,
  renderInjection,
  REPORT_STATUSES,
} from './plan/index.js';
import * as planEntry from './plan/index.js';
import plan from './plan.js';
import start from './start.js';
import usage from './usage.js';

import * as entry from './index.js';

/** The runtime names the entry exposes, sorted as `sort` sorts them. */
const RUNTIME_EXPORTS = [
  'CLAUDE_SETTING_SOURCES',
  'CONFIG_DEFAULTS',
  'CONFIG_FILE',
  'CONFIG_VERSIONS',
  'ConfigError',
  'EFFORT_KEY_PROJECTIONS',
  'FINDING_KINDS',
  'FINDING_SIGNALS',
  'INJECT_MODES',
  'MODULE_SOURCE_KINDS',
  'OUTPUT_MODES',
  'PLAN_BLOCK_KINDS',
  'PLAN_HEADER_FIELDS',
  'PREREQUISITE_KINDS',
  'RAFA_BLOCK_KINDS',
  'REPORT_STATUSES',
  'STORE_BACKENDS',
  'configFilePath',
  'effortCollectCommand',
  'effortReportCommand',
  'isRafaBlockKind',
  'loadConfig',
  'openNdjsonStore',
  'openSqliteStore',
  'parseConfigText',
  'parsePlan',
  'parseReport',
  'planCommand',
  'readConfigFile',
  'readRafaBlocks',
  'renderInjection',
  'resolveConfig',
  'selectEffortStore',
  'startCommand',
  'usageCommand',
];

/** Each runtime name, the entry's value for it, and its module's own. */
const REEXPORTS: readonly (readonly [string, unknown, unknown])[] = [
  ['CLAUDE_SETTING_SOURCES', entry.CLAUDE_SETTING_SOURCES, CLAUDE_SETTING_SOURCES],
  ['CONFIG_DEFAULTS', entry.CONFIG_DEFAULTS, CONFIG_DEFAULTS],
  ['CONFIG_FILE', entry.CONFIG_FILE, CONFIG_FILE],
  ['CONFIG_VERSIONS', entry.CONFIG_VERSIONS, CONFIG_VERSIONS],
  ['ConfigError', entry.ConfigError, ConfigError],
  ['EFFORT_KEY_PROJECTIONS', entry.EFFORT_KEY_PROJECTIONS, EFFORT_KEY_PROJECTIONS],
  ['FINDING_KINDS', entry.FINDING_KINDS, FINDING_KINDS],
  ['FINDING_SIGNALS', entry.FINDING_SIGNALS, FINDING_SIGNALS],
  ['INJECT_MODES', entry.INJECT_MODES, INJECT_MODES],
  ['MODULE_SOURCE_KINDS', entry.MODULE_SOURCE_KINDS, MODULE_SOURCE_KINDS],
  ['OUTPUT_MODES', entry.OUTPUT_MODES, OUTPUT_MODES],
  ['PLAN_BLOCK_KINDS', entry.PLAN_BLOCK_KINDS, PLAN_BLOCK_KINDS],
  ['PLAN_HEADER_FIELDS', entry.PLAN_HEADER_FIELDS, PLAN_HEADER_FIELDS],
  ['PREREQUISITE_KINDS', entry.PREREQUISITE_KINDS, PREREQUISITE_KINDS],
  ['RAFA_BLOCK_KINDS', entry.RAFA_BLOCK_KINDS, RAFA_BLOCK_KINDS],
  ['REPORT_STATUSES', entry.REPORT_STATUSES, REPORT_STATUSES],
  ['STORE_BACKENDS', entry.STORE_BACKENDS, STORE_BACKENDS],
  ['configFilePath', entry.configFilePath, configFilePath],
  ['effortCollectCommand', entry.effortCollectCommand, effortCollect],
  ['effortReportCommand', entry.effortReportCommand, effortReport],
  ['isRafaBlockKind', entry.isRafaBlockKind, isRafaBlockKind],
  ['loadConfig', entry.loadConfig, loadConfig],
  ['openNdjsonStore', entry.openNdjsonStore, openNdjsonStore],
  ['openSqliteStore', entry.openSqliteStore, openSqliteStore],
  ['parseConfigText', entry.parseConfigText, parseConfigText],
  ['parsePlan', entry.parsePlan, parsePlan],
  ['parseReport', entry.parseReport, parseReport],
  ['planCommand', entry.planCommand, plan],
  ['readConfigFile', entry.readConfigFile, readConfigFile],
  ['readRafaBlocks', entry.readRafaBlocks, readRafaBlocks],
  ['renderInjection', entry.renderInjection, renderInjection],
  ['resolveConfig', entry.resolveConfig, resolveConfig],
  ['selectEffortStore', entry.selectEffortStore, selectEffortStore],
  ['startCommand', entry.startCommand, start],
  ['usageCommand', entry.usageCommand, usage],
];

/** The modules whose every runtime name the root also carries. */
const CONTAINED: readonly (readonly [string, Record<string, unknown>])[] = [
  ['the ./plan entry', planEntry],
  ['the ./store entry', storeEntry],
  ['the config module', configModule],
  ['the config loader', configLoadModule],
];

/** The `src/` directory, which the entry and the CLI both sit in. */
const SRC_DIR = fileURLToPath(new URL('./', import.meta.url));

/** The CLI's dispatcher, read as source and imported by the control. */
const CLI_PATH = join(SRC_DIR, 'rafa.ts');

/** The entry under test, as the probe imports it. */
const ENTRY_PATH = join(SRC_DIR, 'index.ts');

/**
 * What `src/rafa.ts` imports, spelled here: each module and the bindings
 * taken from it, `default` for a default import. The order is the
 * source's.
 */
const CLI_IMPORTS: readonly (readonly [string, readonly string[]])[] = [
  ['./effort/collect.js', ['default']],
  ['./effort/report.js', ['default']],
  ['./plan.js', ['default']],
  ['./start.js', ['default']],
  ['./usage.js', ['default']],
];

/** A static relative import, possibly spanning lines, type-only or not. */
const IMPORT_PATTERN = /^import\s+(type\s+)?([\s\S]+?)\s+from\s+'(\.\.?\/[^']+)';$/gm;

/** One import's clause read as the bindings it takes. */
function bindingsOf(clause: string): string[] {
  const named = /^(?:(\w+)\s*,\s*)?\{([^}]*)\}$/.exec(clause);
  if (named !== null) {
    const names = (named[2] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => part.split(/\s+as\s+/)[0] ?? part);
    return named[1] === undefined
      ? names
      : ['default', ...names];
  }
  if (/^\w+$/.test(clause)) return ['default'];
  throw new Error(`the CLI imports with a clause this test does not read: ${clause}`);
}

/** The CLI's runtime imports, read off its source. */
function readCliImports(): [string, string[]][] {
  const source = readFileSync(CLI_PATH, 'utf8');
  return [...source.matchAll(IMPORT_PATTERN)]
    .filter((match) => match[1] === undefined)
    .map((match) => [match[3] ?? '', bindingsOf(match[2] ?? '')]);
}

/** What the probe printed and left behind. */
interface ProbeRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** What the probe's directory holds afterwards, sorted. */
  files: string[];
}

/** The line the probe prints once the module is imported. */
interface ProbeReading {
  sigint: number;
  sigterm: number;
  exitCode: unknown;
  exports: number;
}

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-entry-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/**
 * Imports one module in a fresh process from an empty directory of its
 * own, and reports what that process printed and left behind.
 */
function probeImport(modulePath: string): ProbeRun {
  const cwd = mkdtempSync(join(tempBase, 'probe-'));

  writeFileSync(join(cwd, 'probe.ts'), [
    `const loaded = await import(${JSON.stringify(modulePath)});`,
    'console.log(JSON.stringify({',
    '  sigint: process.listenerCount(\'SIGINT\'),',
    '  sigterm: process.listenerCount(\'SIGTERM\'),',
    '  exitCode: process.exitCode ?? null,',
    '  exports: Object.keys(loaded).length,',
    '}));',
    '',
  ].join('\n'));

  const run = Bun.spawnSync([process.execPath, 'probe.ts'], { cwd, env: process.env });
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
    files: readdirSync(cwd).sort(),
  };
}

/** The probe's reading, from the last line it printed. */
function readingOf(run: ProbeRun): ProbeReading {
  const lines = run.stdout.trimEnd().split('\n');
  return JSON.parse(lines[lines.length - 1] ?? '') as ProbeReading;
}

describe('the package root entry', () => {
  it('exports exactly the runtime names it declares', () => {
    expect(Object.keys(entry).sort()).toEqual(RUNTIME_EXPORTS);
  });

  it.each(REEXPORTS)('re-exports %s itself, not a copy or a wrapper', (_name, value, own) => {
    expect(value).toBe(own);
  });

  it.each(CONTAINED)('carries every runtime name of %s, as the same binding', (_label, module) => {
    const names = Object.keys(module);
    const onRoot: Record<string, unknown> = entry;
    const missing = names.filter((name) => !(name in onRoot) || onRoot[name] !== module[name]);

    expect(names.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe('what the CLI reaches, through the entry', () => {
  it('reads the imports src/rafa.ts takes as the ones spelled here', () => {
    expect(readCliImports()).toEqual(CLI_IMPORTS.map(([from, names]) => [from, [...names]]));
  });

  it('reaches every binding src/rafa.ts imports as a root export', async () => {
    const rootValues = new Set<unknown>(Object.values(entry));
    const unreached: string[] = [];

    for (const [from, names] of readCliImports()) {
      const module = await import(join(SRC_DIR, from)) as Record<string, unknown>;
      for (const name of names) {
        if (!rootValues.has(module[name])) unreached.push(`${name} from ${from}`);
      }
    }

    expect(unreached).toEqual([]);
  });
});

describe('importing the entry', () => {
  it('prints nothing, listens for no signal, sets no exit code and writes nothing', () => {
    const run = probeImport(ENTRY_PATH);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(readingOf(run)).toEqual({
      sigint: 0,
      sigterm: 0,
      exitCode: null,
      exports: RUNTIME_EXPORTS.length,
    });
    expect(run.files).toEqual(['probe.ts']);
  });

  it('is told apart from the CLI, which prints its help when imported', () => {
    const run = probeImport(CLI_PATH);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.startsWith('ralph — agent task loop\n')).toBe(true);
    expect(run.stdout.trimEnd().split('\n').length).toBeGreaterThan(1);
    expect(readingOf(run)).toMatchObject({ exports: 0 });
  });
});
