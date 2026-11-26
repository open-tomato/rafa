/**
 * The module ingest: the project's tree read into `module_facts`, one row
 * per module, stamped `local.modules`. It reads the files under the
 * project root and nothing else; no git, no `gh`.
 *
 * 1. **Modules.** The modules are the folders `discoverModules`
 *    (`attribute.ts`) finds, the same list the effort ingest attributes
 *    findings, bugs and changes to, so the counts below join on `path`.
 *    `package` is the `name` of the module's own `package.json`, else
 *    NULL.
 * 2. **Files.** Each module's folder is walked whole, passing over the
 *    folders of {@link SKIPPED_FOLDERS} (`node_modules`, `dist`,
 *    `.tsbuild`) and the folder of any other module nested in it, which
 *    counts on its own row; a symbolic link is not followed. Each file
 *    counts in one kind only, the first {@link lineKindOf} finds, by the
 *    rules of the 2026-11-02 count in `demo/src/data/composition.ts`, a
 *    folder named below the module folder and never the module folder
 *    itself:
 *    - `fixtures` (`fixtures_loc`): a file under a `fixtures/`,
 *      `__snapshots__/` or `stubs/` folder, or named `*.snap`,
 *      `*.fixture.*` or `*.stub.*`; a snapshot or fixture is no test;
 *    - `docs` (`docs_loc`): a markdown file, or any file under a `docs/`
 *      folder;
 *    - `test` (`test_files`, `test_loc`): a script file named `*.test.*`
 *      or `*.spec.*`, or one under a `tests/` or `__tests__/` folder;
 *    - `config` (`config_loc`): json, yaml, toml, ini, `.mjs` and `.cjs`
 *      files, a `*.config.*` script, and the named files of
 *      {@link CONFIG_FILE_NAMES} (`Dockerfile`, `.gitignore`, ...);
 *    - `source` (`files`, `loc`): the other files ending in one of
 *      {@link SOURCE_EXTENSIONS} (scripts, `.css`, `.html`).
 *    A file none of these takes (`.txt`, `.xml`, `.jsonl`, images) counts
 *    in no kind. LOC is the lines holding anything but white space.
 * 3. **Imports.** Each script file of the walk ({@link SCRIPT_EXTENSIONS}),
 *    whatever kind it counts in, is read for the
 *    `@open-tomato/<pkg>` specifiers its `from`, `import`, `import(` and
 *    `require(` clauses name, by regex ({@link IMPORT_SPECIFIER}): a
 *    subpath counts as its package. `imports_json` is the packages named,
 *    each once, sorted, as a JSON array, the module's own package left
 *    out. `fan_out` counts the other modules whose `package` is among
 *    them, `fan_in` the other modules naming this module's package; a
 *    package no module of the tree carries is listed and counted by
 *    neither.
 * 4. **Upward edges.** Read from `docs/survey/cut-table.json` when present:
 *    every row of its `edges` lists is an upward import, and a module's
 *    `upward_edges` counts those whose `from` file lies in it. A module
 *    no `packages` folder of the table covers (neither its folder, one
 *    inside it nor one around it) reads NULL, as every module does when
 *    the file is absent, does not parse, or holds no `packages` list;
 *    the stamp is then partial and says so.
 * 5. **Counts.** `bugs`, `findings` and `changes` are left NULL here;
 *    `derive.ts` counts them by module from the effort buckets.
 *
 * The stamp's `as_of` and `read_at` are the build clock: the tree is read
 * as it stands. A tree with no module folder writes no row and is stamped
 * partial, naming the globs.
 */
import type { ReplicaBuild, SourceStamp } from '@open-tomato/atlas-data/replica';
import type { Dirent } from 'node:fs';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_MODULE_GLOBS, discoverModules } from './attribute.js';

/** The `atlas_sources` row `module_facts` is stamped as. */
export const MODULES_SOURCE = 'local.modules';

/** The folders a module's walk passes over. */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['node_modules', 'dist', '.tsbuild']);

/** The file endings a script file carries: read for imports, whatever kind it counts in. */
export const SCRIPT_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** The file endings a source file carries, once the kinds before it have passed it over. */
export const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.css', '.html'];

/** The file endings a config file carries. */
export const CONFIG_EXTENSIONS: readonly string[] = ['.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.mjs', '.cjs'];

/** The file names that count as config whatever their ending. */
export const CONFIG_FILE_NAMES: ReadonlySet<string> = new Set([
  'Dockerfile', '.dockerignore', '.editorconfig', '.gitattributes', '.gitignore', '.npmignore', '.npmrc', '.nvmrc',
]);

/** The file endings a docs file carries. */
export const DOCS_EXTENSIONS: readonly string[] = ['.md', '.mdx'];

/** The folders whose files count as fixtures. */
const FIXTURE_FOLDERS: ReadonlySet<string> = new Set(['fixtures', '__snapshots__', 'stubs']);

/** The folders whose files count as docs. */
const DOCS_FOLDERS: ReadonlySet<string> = new Set(['docs']);

/** The folders whose script files count as tests. */
const TEST_FOLDERS: ReadonlySet<string> = new Set(['tests', '__tests__']);

/** The five kinds a counted file's lines fall in: see the module note. */
export type LineKind = 'source' | 'test' | 'docs' | 'config' | 'fixtures';

/** A fixture file's name: a snapshot, `<name>.fixture.<ext>` or `<name>.stub.<ext>`. */
const FIXTURE_FILE = /(?:\.snap|\.(?:fixture|stub)\.[^/]+)$/;

/** A config script's name: `<name>.config.<ext>`. */
const CONFIG_SCRIPT = /\.config\.[cm]?[jt]sx?$/;

/** The cut table under the project root. */
export const CUT_TABLE_FILE: string = join('docs', 'survey', 'cut-table.json');

/** A test file's name: `<name>.test.<ext>` or `<name>.spec.<ext>`. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** An `@open-tomato/<pkg>` specifier a `from`, `import` or `require` clause names; group 1 is the package. */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](@open-tomato\/[a-z0-9][a-z0-9._-]*)(?:\/[^'"\s]*)?['"]/g;

/** One module's tree, as the walk read it. */
export interface ModuleTree {
  readonly path: string;
  readonly package: string | null;
  readonly files: number;
  readonly loc: number;
  readonly testFiles: number;
  readonly testLoc: number;
  readonly docsLoc: number;
  readonly configLoc: number;
  readonly fixturesLoc: number;
  /** The `@open-tomato/<pkg>` packages its files name, each once, sorted, its own left out. */
  readonly imports: readonly string[];
}

/** What one cut-table read gave: the upward edges by module, or why there are none. */
export type CutTableRead =
  | {
    readonly ok: true;
    /** The `packages` rows' folders, each ending in `/`. */
    readonly folders: readonly string[];
    /** The `from` file of every upward edge. */
    readonly edgeSources: readonly string[];
  }
  | { readonly ok: false; readonly reason: string };

/** What one module ingest did. */
export interface ModuleIngest {
  readonly modules: number;
  /** False when no cut table was read; every `upward_edges` then reads NULL. */
  readonly cutTableRead: boolean;
  readonly stamps: readonly SourceStamp[];
}

/** What one module ingest is handed. */
export interface ModuleIngestOptions {
  /** The project root: the main checkout, whose tree is read. */
  readonly root: string;
  /** The globs the modules are found by; defaults to {@link DEFAULT_MODULE_GLOBS}. */
  readonly globs?: readonly string[];
  /** The build clock: the stamp's `as_of` and `read_at`; defaults to the system clock. */
  readonly now?: () => Date;
}

/** True for a plain object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The message of a thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** The lines of `text` holding anything but white space. */
export function locOf(text: string): number {
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

/** The `@open-tomato/<pkg>` packages `text` imports, each once, in the order first named. */
export function importedPackagesOf(text: string): readonly string[] {
  return [...new Set([...text.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? ''))].filter((name) => name !== '');
}

/** The `name` of the `package.json` in `folder`, or null. */
function packageNameOf(folder: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as unknown;
    return isRecord(manifest) && typeof manifest['name'] === 'string' && manifest['name'] !== ''
      ? manifest['name']
      : null;
  } catch {
    return null;
  }
}

/** True when `name` ends in one of `extensions`. */
function endsInOneOf(name: string, extensions: readonly string[]): boolean {
  return extensions.some((extension) => name.endsWith(extension));
}

/**
 * The kind `file`'s lines count in, or null for a file no kind takes; see
 * the module note. `file` is relative to its module folder, so a folder
 * the module itself is named after is never read as one of the kinds'.
 */
export function lineKindOf(file: string): LineKind | null {
  const segments = file.split('/');
  const name = segments.at(-1) ?? '';
  const folders = new Set(segments.slice(0, -1));
  const under = (kinds: ReadonlySet<string>): boolean => [...kinds].some((folder) => folders.has(folder));
  const script = endsInOneOf(name, SCRIPT_EXTENSIONS);
  if (under(FIXTURE_FOLDERS) || FIXTURE_FILE.test(name)) return 'fixtures';
  if (under(DOCS_FOLDERS) || endsInOneOf(name, DOCS_EXTENSIONS)) return 'docs';
  if (script && (TEST_FILE.test(name) || under(TEST_FOLDERS))) return 'test';
  if (CONFIG_FILE_NAMES.has(name) || endsInOneOf(name, CONFIG_EXTENSIONS) || CONFIG_SCRIPT.test(name)) return 'config';
  return endsInOneOf(name, SOURCE_EXTENSIONS)
    ? 'source'
    : null;
}

/** The entries of `folder`; none when it cannot be listed. */
function entriesOf(folder: string): readonly Dirent[] {
  try {
    return readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The files under `relative` (a folder under `root`), as relative paths; `nested` folders are passed over. */
function filesUnder(root: string, relative: string, nested: ReadonlySet<string>): readonly string[] {
  return entriesOf(join(root, relative)).flatMap((entry) => {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      return SKIPPED_FOLDERS.has(entry.name) || nested.has(path)
        ? []
        : filesUnder(root, path, nested);
    }
    return entry.isFile()
      ? [path]
      : [];
  });
}

/** The line totals of one module, by the columns they fill. */
type Totals = Pick<ModuleTree, 'files' | 'loc' | 'testFiles' | 'testLoc' | 'docsLoc' | 'configLoc' | 'fixturesLoc'>;

/** `totals` with one file of `kind` and `loc` lines added. */
function addFile(totals: Totals, kind: LineKind, loc: number): Totals {
  switch (kind) {
    case 'source':
      return { ...totals, files: totals.files + 1, loc: totals.loc + loc };
    case 'test':
      return { ...totals, testFiles: totals.testFiles + 1, testLoc: totals.testLoc + loc };
    case 'docs':
      return { ...totals, docsLoc: totals.docsLoc + loc };
    case 'config':
      return { ...totals, configLoc: totals.configLoc + loc };
    case 'fixtures':
      return { ...totals, fixturesLoc: totals.fixturesLoc + loc };
  }
}

/** Read one module's tree; see the module note. */
export function readModuleTree(root: string, path: string, modules: readonly string[]): ModuleTree {
  const nested = new Set(modules.filter((other) => other !== path && other.startsWith(`${path}/`)));
  const ownPackage = packageNameOf(join(root, path));
  const imports = new Set<string>();
  let totals: Totals = { files: 0, loc: 0, testFiles: 0, testLoc: 0, docsLoc: 0, configLoc: 0, fixturesLoc: 0 };
  for (const file of filesUnder(root, path, nested)) {
    const kind = lineKindOf(file.slice(path.length + 1));
    const script = endsInOneOf(file, SCRIPT_EXTENSIONS);
    if (kind === null && !script) continue;
    const text = readFileSync(join(root, file), 'utf8');
    if (kind !== null) totals = addFile(totals, kind, locOf(text));
    if (script) for (const name of importedPackagesOf(text)) if (name !== ownPackage) imports.add(name);
  }
  return { path, package: ownPackage, ...totals, imports: [...imports].sort() };
}

/** Parse the cut table's text: its `packages` rows' folders and edges; see the module note. */
export function parseCutTable(text: string): CutTableRead {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, reason: `${CUT_TABLE_FILE} does not parse as JSON (${messageOf(error)})` };
  }
  const packages = isRecord(payload)
    ? payload['packages']
    : undefined;
  if (!Array.isArray(packages)) return { ok: false, reason: `${CUT_TABLE_FILE} holds no packages list` };
  const rows = (packages as readonly unknown[]).filter(isRecord);
  const folders = rows.flatMap((row) => (Array.isArray(row['folders'])
    ? (row['folders'] as readonly unknown[])
    : []))
    .filter((folder): folder is string => typeof folder === 'string' && folder !== '')
    .map((folder) => (folder.endsWith('/')
      ? folder
      : `${folder}/`));
  const edgeSources = rows.flatMap((row) => (Array.isArray(row['edges'])
    ? (row['edges'] as readonly unknown[])
    : []))
    .map((edge) => (isRecord(edge)
      ? edge['from']
      : undefined))
    .filter((from): from is string => typeof from === 'string');
  return { ok: true, folders, edgeSources };
}

/** Read the cut table under `root`; see the module note. */
export function readCutTable(root: string): CutTableRead {
  const path = join(root, CUT_TABLE_FILE);
  if (!existsSync(path)) return { ok: false, reason: `no file at ${CUT_TABLE_FILE}` };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { ok: false, reason: `${CUT_TABLE_FILE} cannot be read (${messageOf(error)})` };
  }
  return parseCutTable(text);
}

/** The upward edges leaving `path`, or null when the table does not cover it; see the module note. */
export function upwardEdgesOf(table: CutTableRead, path: string): number | null {
  if (!table.ok) return null;
  const folder = `${path}/`;
  const covered = table.folders.some((each) => each.startsWith(folder) || folder.startsWith(each));
  return covered
    ? table.edgeSources.filter((from) => from.startsWith(folder)).length
    : null;
}

/** The `module_facts` columns written, in the order {@link moduleRows} binds them. */
const MODULE_COLUMNS: readonly string[] = [
  'path', 'package', 'files', 'loc', 'test_files', 'test_loc', 'docs_loc', 'config_loc', 'fixtures_loc',
  'fan_in', 'fan_out', 'imports_json', 'upward_edges',
];

/** Each module's row, in {@link MODULE_COLUMNS} order. */
export function moduleRows(trees: readonly ModuleTree[], table: CutTableRead): (string | number | null)[][] {
  const byPackage = new Map(trees
    .filter((tree): tree is ModuleTree & { readonly package: string } => tree.package !== null)
    .map((tree) => [tree.package, tree.path]));
  const targetsOf = (tree: ModuleTree): ReadonlySet<string> => new Set(tree.imports
    .map((name) => byPackage.get(name))
    .filter((path): path is string => path !== undefined && path !== tree.path));
  const targets = new Map(trees.map((tree) => [tree.path, targetsOf(tree)]));
  return trees.map((tree) => {
    const fanIn = trees.filter((other) => targets.get(other.path)?.has(tree.path) === true).length;
    return [
      tree.path, tree.package, tree.files, tree.loc, tree.testFiles, tree.testLoc,
      tree.docsLoc, tree.configLoc, tree.fixturesLoc, fanIn, targets.get(tree.path)?.size ?? 0, JSON.stringify(tree.imports), upwardEdgesOf(table, tree.path),
    ];
  });
}

/** The `local.modules` stamp: partial when no module was found or no cut table read. */
function modulesStamp(readAt: string, rows: number, globs: readonly string[], table: CutTableRead): SourceStamp {
  const reasons = [
    ...(rows === 0
      ? [`the module globs ${globs.join(', ')} name no folder under the root`]
      : []),
    ...(table.ok
      ? []
      : [`no cut table read: ${table.reason}; upward_edges reads NULL`]),
  ];
  return {
    source: MODULES_SOURCE,
    asOf: readAt,
    readAt,
    rows,
    partial: reasons.length > 0,
    reason: reasons.length === 0
      ? null
      : reasons.join('; '),
  };
}

/** Read the root's modules into `module_facts` and stamp {@link MODULES_SOURCE}; see the module note. */
export function ingestModules(build: ReplicaBuild, options: ModuleIngestOptions): ModuleIngest {
  const readAt = (options.now ?? (() => new Date()))().toISOString();
  const globs = options.globs ?? DEFAULT_MODULE_GLOBS;
  const modules = discoverModules(options.root, globs);
  const trees = modules.map((path) => readModuleTree(options.root, path, modules));
  const table = readCutTable(options.root);
  const insert = build.database.prepare<unknown, (string | number | null)[]>(
    `INSERT INTO module_facts (${MODULE_COLUMNS.join(', ')}) VALUES (${MODULE_COLUMNS.map(() => '?').join(', ')})`,
  );
  const rows = moduleRows(trees, table);
  build.database.transaction(() => {
    for (const row of rows) insert.run(...row);
  })();
  const stamps = [modulesStamp(readAt, rows.length, globs, table)];
  stamps.forEach((stamp) => build.stampSource(stamp));
  return { modules: rows.length, cutTableRead: table.ok, stamps };
}
