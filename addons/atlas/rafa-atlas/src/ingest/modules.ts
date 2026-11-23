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
 *    counts on its own row. A file counts when its name ends in one of
 *    {@link SOURCE_EXTENSIONS}; a symbolic link is not followed. A file
 *    named `*.test.*` or `*.spec.*` is a test file: `test_files` and
 *    `test_loc` count those, `files` and `loc` the other source files, so
 *    the two sum to the module's whole. LOC is the lines holding anything
 *    but white space.
 * 3. **Imports.** Each source file, tests included, is read for the
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

/** The file endings a source file carries. */
export const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

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

/** True when `name` ends in a source file ending. */
function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** The entries of `folder`; none when it cannot be listed. */
function entriesOf(folder: string): readonly Dirent[] {
  try {
    return readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The source files under `relative` (a folder under `root`), as relative paths; `nested` folders are passed over. */
function sourceFilesUnder(root: string, relative: string, nested: ReadonlySet<string>): readonly string[] {
  return entriesOf(join(root, relative)).flatMap((entry) => {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      return SKIPPED_FOLDERS.has(entry.name) || nested.has(path)
        ? []
        : sourceFilesUnder(root, path, nested);
    }
    return entry.isFile() && isSourceFile(entry.name)
      ? [path]
      : [];
  });
}

/** Read one module's tree; see the module note. */
export function readModuleTree(root: string, path: string, modules: readonly string[]): ModuleTree {
  const nested = new Set(modules.filter((other) => other !== path && other.startsWith(`${path}/`)));
  const ownPackage = packageNameOf(join(root, path));
  const imports = new Set<string>();
  const totals = { files: 0, loc: 0, testFiles: 0, testLoc: 0 };
  for (const file of sourceFilesUnder(root, path, nested)) {
    const text = readFileSync(join(root, file), 'utf8');
    const loc = locOf(text);
    if (TEST_FILE.test(file)) {
      totals.testFiles += 1;
      totals.testLoc += loc;
    } else {
      totals.files += 1;
      totals.loc += loc;
    }
    for (const name of importedPackagesOf(text)) if (name !== ownPackage) imports.add(name);
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
  'path', 'package', 'files', 'loc', 'test_files', 'test_loc', 'fan_in', 'fan_out', 'imports_json', 'upward_edges',
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
      fanIn, targets.get(tree.path)?.size ?? 0, JSON.stringify(tree.imports), upwardEdgesOf(table, tree.path),
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
