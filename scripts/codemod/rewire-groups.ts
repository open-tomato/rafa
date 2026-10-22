/**
 * The four groups of the rewire codemod (#808, pass 3): which importers of
 * a feature package can take it by name from its facade, and which keep
 * their relative paths and why. `rewire-facade.ts` prints the groups and
 * rewrites the first; this module reads and groups, and writes nothing.
 *
 * {@link readPackageFiles} keeps the code files `placeFile` of
 * `scripts/survey/cut-table.ts` puts in the package, tests included. The
 * facade's own `packages/rafa-<name>/index.ts` is one of them, so it is
 * never an importer.
 *
 * {@link readImporters} reads every importer: a code file under `src/`,
 * `scripts/` or `packages/` outside the package that is no test (under
 * `src/` and `packages/`, `classifyFile` of `scripts/survey/files.ts`
 * reads it as `source`; under `scripts/`, its name is no test), with each
 * of its `import` and `export … from` statements whose relative specifier
 * resolves to a package file. A bare specifier, the facade's name
 * included, is never read, nor is a dynamic `import()` or a `require`.
 * Each statement carries its place in the text and the bindings it takes,
 * read by `readFacadeBindings` of `scripts/survey/facade-tables.ts`.
 *
 * {@link groupImporters} puts each importer in the first group of four
 * that holds it:
 *
 *   1. `loadCycle`: the package's non-test files reach it over `value`
 *      edges of the import graph, read transitively, so taking the package
 *      by name would load a module that is still loading;
 *   2. `backEdge`: `placeFile` puts it in a package earlier than the target
 *      in `MOVE_ORDER` of `scripts/survey/coupling.ts`;
 *   3. `declarationGraph`: it is reachable over edges of either kind from
 *      the `include` files of the two declaration builds,
 *      {@link DECLARATION_CONFIGS}, whose `.d.ts` files ship;
 *   4. `rewire`: every other importer.
 *
 * The graph is the one the survey reads through facades,
 * `docs/survey/import-graph.json` unless the caller hands another.
 */

import type { CutRules } from '../survey/cut-table';
import type { FacadeBinding } from '../survey/facade-tables';
import type { ImportEdge, ResolveImport } from '../survey/import-graph';

import { readFileSync } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';

import ts from 'typescript';

import { DEFAULT_GRAPH, MOVE_ORDER, parseGraphEdges } from '../survey/coupling';
import { CUT_RULES, placeFile } from '../survey/cut-table';
import { readFacadeBindings } from '../survey/facade-tables';
import { classifyFile } from '../survey/files';
import { bunResolver } from '../survey/import-graph';

/** The two tsconfig files whose `include` lists open the published declaration graph. */
export const DECLARATION_CONFIGS: readonly string[] = [
  'tsconfig.config-types.json',
  'packages/rafa/tsconfig.types.json',
];

/** The folders an importer is read under, each with its closing `/`. */
export const IMPORTER_ROOTS: readonly string[] = ['src/', 'scripts/', 'packages/'];

const CODE_EXTENSION = /\.(?:ts|tsx|mts|js|mjs)$/;
const TEST_NAME = /\.test\.(?:ts|tsx|mts|js|mjs)$/;
const GLOB_CHARACTER = /[*?{}[\]]/;

/** Whether a statement imports or re-exports. */
export type StatementForm = 'export' | 'import';

/** One `import` or `export … from` statement of an importer that names a package file. */
export interface PackageStatement {
  /** `import` for an import declaration, `export` for an `export … from`. */
  readonly form: StatementForm;
  /** The relative specifier as written, such as `./effort/collect.js`. */
  readonly specifier: string;
  /** The package file it resolves to, repository-relative. */
  readonly target: string;
  /** Whether the statement carries `type` (`import type`, `export type … from`). */
  readonly typeOnly: boolean;
  /** The 1-based line it starts on. */
  readonly line: number;
  /** The offset of its first character in the importer's text, leading comments left out. */
  readonly start: number;
  /** The offset just past its last character. */
  readonly end: number;
  /** Its text, `text.slice(start, end)`. */
  readonly text: string;
  /** The names it takes; empty for a side-effect import. */
  readonly bindings: readonly FacadeBinding[];
}

/** A file outside the package that imports one of its files by relative path. */
export interface Importer {
  /** The repository-relative path. */
  readonly path: string;
  /** Its statements that name a package file, in source order; never empty. */
  readonly statements: readonly PackageStatement[];
}

/** What {@link groupImporters} groups, all of it passed in as data. */
export interface GroupInput {
  /** The target package's name, such as `rafa-effort`. */
  readonly packageName: string;
  /** The package's files, as {@link readPackageFiles} gives them. */
  readonly packageFiles: readonly string[];
  /** The importers, as {@link readImporters} gives them. */
  readonly importers: readonly Importer[];
  /** The import graph's edges. */
  readonly edges: readonly ImportEdge[];
  /** The `include` files of the declaration builds, as {@link readDeclarationRoots} gives them. */
  readonly declarationRoots: readonly string[];
  /** The packages in the order they move; `MOVE_ORDER` unless a test plants its own. */
  readonly moveOrder?: readonly string[];
  /** The cut rules; `CUT_RULES` unless a test plants its own. */
  readonly rules?: CutRules;
}

/** The importers of one package by group, each list sorted by path. */
export interface ImporterGroups {
  /** The importers that take the package from its facade. */
  readonly rewire: readonly Importer[];
  /** The importers the package's own files reach over value edges. */
  readonly loadCycle: readonly Importer[];
  /** The importers in a package that moves before the target. */
  readonly backEdge: readonly Importer[];
  /** The importers in the published declaration graph. */
  readonly declarationGraph: readonly Importer[];
}

/**
 * Compares two strings by UTF-16 code unit, the order `sort` gives.
 *
 * @param left - One string.
 * @param right - The other.
 * @returns A negative, zero or positive number.
 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right
    ? -1
    : 1;
}

/**
 * The code files a package holds, tests included, by `placeFile`.
 *
 * @param paths - Repository-relative paths, normally the tracked files.
 * @param packageName - The package, such as `rafa-effort`.
 * @param rules - The cut rules; {@link CUT_RULES} unless a test plants its own.
 * @returns The package's code files, sorted and free of duplicates.
 */
export function readPackageFiles(paths: readonly string[], packageName: string, rules: CutRules = CUT_RULES): string[] {
  return [...new Set(paths)]
    .filter((path) => CODE_EXTENSION.test(path) && placeFile(path, rules).package === packageName)
    .sort(compareText);
}

/**
 * Whether a path may import a package as an importer: a code file under
 * one of {@link IMPORTER_ROOTS} that is no test and no test support.
 *
 * @param path - A repository-relative path.
 * @returns `true` when {@link readImporters} reads the file.
 */
export function isImporterCandidate(path: string): boolean {
  if (!CODE_EXTENSION.test(path) || !IMPORTER_ROOTS.some((folder) => path.startsWith(folder))) {
    return false;
  }
  return path.startsWith('scripts/')
    ? !TEST_NAME.test(path)
    : classifyFile(path) === 'source';
}

/** The text of a module specifier, or `undefined` when it is not a string literal. */
function specifierText(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteral(node)
    ? node.text
    : undefined;
}

/** Whether a specifier is relative: `./…` or `../…`. */
function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * The statements of one importer's text that name a package file by
 * relative path, in source order.
 *
 * @param path - The importer's repository-relative path.
 * @param text - Its source text.
 * @param packageFiles - The package's files.
 * @param resolve - Resolves a specifier from `path` to a repository-relative path.
 * @returns The statements; empty when none names a package file.
 */
export function readPackageStatements(
  path: string,
  text: string,
  packageFiles: ReadonlySet<string>,
  resolve: ResolveImport,
): PackageStatement[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const statements: PackageStatement[] = [];
  for (const statement of source.statements) {
    const isImport = ts.isImportDeclaration(statement);
    if (!isImport && !ts.isExportDeclaration(statement)) {
      continue;
    }
    const specifier = specifierText(statement.moduleSpecifier);
    if (specifier === undefined || !isRelative(specifier)) {
      continue;
    }
    const target = resolve(specifier, path);
    if (target === undefined || !packageFiles.has(target)) {
      continue;
    }
    const start = statement.getStart(source);
    const statementText = text.slice(start, statement.end);
    statements.push({
      bindings: readFacadeBindings(statementText, specifier),
      end: statement.end,
      form: isImport
        ? 'import'
        : 'export',
      line: source.getLineAndCharacterOfPosition(start).line + 1,
      specifier,
      start,
      target,
      text: statementText,
      typeOnly: isImport
        ? statement.importClause?.isTypeOnly ?? false
        : statement.isTypeOnly,
    });
  }
  return statements;
}

/**
 * Reads the importers of a package from a tree: each candidate file
 * ({@link isImporterCandidate}) outside the package with at least one
 * statement that names a package file by relative path.
 *
 * @param root - The repository root the paths are read under.
 * @param paths - Repository-relative paths, normally the tracked files.
 * @param packageFiles - The package's files, as {@link readPackageFiles} gives them.
 * @param resolve - The resolver; `bunResolver(root)` unless a test plants its own.
 * @returns The importers, sorted by path.
 * @throws When a candidate file cannot be read.
 */
export function readImporters(
  root: string,
  paths: readonly string[],
  packageFiles: readonly string[],
  resolve: ResolveImport = bunResolver(root),
): Importer[] {
  const inPackage = new Set(packageFiles);
  const importers: Importer[] = [];
  const candidates = [...new Set(paths)].filter((path) => !inPackage.has(path) && isImporterCandidate(path)).sort(compareText);
  for (const path of candidates) {
    const statements = readPackageStatements(path, readFileSync(join(root, path), 'utf8'), inPackage, resolve);
    if (statements.length > 0) {
      importers.push({ path, statements });
    }
  }
  return importers;
}

/**
 * The `include` files of the declaration builds, each repository-relative.
 *
 * @param root - The repository root.
 * @param configs - The tsconfig files to read; {@link DECLARATION_CONFIGS} unless a test plants its own.
 * @returns The files, sorted and free of duplicates.
 * @throws When a config cannot be read or parsed, holds no `include` list,
 *   or names a pattern rather than a file.
 */
export function readDeclarationRoots(root: string, configs: readonly string[] = DECLARATION_CONFIGS): string[] {
  const roots = new Set<string>();
  for (const config of configs) {
    const read = ts.readConfigFile(join(root, config), ts.sys.readFile);
    if (read.error !== undefined) {
      throw new Error(`${config}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
    }
    const include: unknown = (read.config as { include?: unknown }).include;
    if (!Array.isArray(include) || include.some((entry) => typeof entry !== 'string')) {
      throw new Error(`${config}: no include list of strings`);
    }
    for (const entry of include as string[]) {
      if (GLOB_CHARACTER.test(entry) || !CODE_EXTENSION.test(entry)) {
        throw new Error(`${config}: include entry ${entry} is not a code file; the reader takes files only`);
      }
      roots.add(posix.normalize(posix.join(posix.dirname(config), entry)));
    }
  }
  return [...roots].sort(compareText);
}

/**
 * The edges of an import graph file, `docs/survey/import-graph.json`
 * unless the caller names another.
 *
 * @param root - The repository root a relative `graph` is read against.
 * @param graph - The graph file, repository-relative or absolute.
 * @returns Its edges.
 * @throws When the file cannot be read or holds no edges of the graph's shape.
 */
export function readGraphEdges(root: string, graph: string = DEFAULT_GRAPH): ImportEdge[] {
  const path = isAbsolute(graph)
    ? graph
    : join(root, graph);
  return parseGraphEdges(readFileSync(path, 'utf8'), graph);
}

/**
 * Every node reached from the starting files over the edges `follow`
 * keeps, the starting files included.
 *
 * @param starts - The files the walk starts from.
 * @param edges - The graph's edges.
 * @param follow - Which edges the walk takes.
 * @returns The reached files.
 */
function reachedFrom(
  starts: Iterable<string>,
  edges: readonly ImportEdge[],
  follow: (edge: ImportEdge) => boolean,
): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of edges.filter(follow)) {
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }
  const reached = new Set(starts);
  const queue = [...reached];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const to of next.get(file) ?? []) {
      if (!reached.has(to)) {
        reached.add(to);
        queue.push(to);
      }
    }
  }
  return reached;
}

/**
 * Puts each importer in the first group that holds it: load cycle, back
 * edge, declaration graph, else to rewire (see the module note).
 *
 * @param input - The package, its files and importers, the graph and the declaration roots.
 * @returns The four groups, each sorted by path.
 * @throws When the package is not in the move order.
 */
export function groupImporters(input: GroupInput): ImporterGroups {
  const order = input.moveOrder ?? MOVE_ORDER;
  const rules = input.rules ?? CUT_RULES;
  const rank = order.indexOf(input.packageName);
  if (rank === -1) {
    throw new Error(`${input.packageName} is not in the move order (${order.join(', ')})`);
  }
  const ownSources = input.packageFiles.filter((path) => !TEST_NAME.test(path));
  const loaded = reachedFrom(ownSources, input.edges, (edge) => edge.kind === 'value');
  const declared = reachedFrom(input.declarationRoots, input.edges, () => true);
  const isBackEdge = (path: string): boolean => {
    const owner = placeFile(path, rules).package;
    const ownerRank = owner === undefined
      ? -1
      : order.indexOf(owner);
    return ownerRank !== -1 && ownerRank < rank;
  };
  const groups = { backEdge: [] as Importer[], declarationGraph: [] as Importer[], loadCycle: [] as Importer[], rewire: [] as Importer[] };
  const sorted = [...input.importers].sort((left, right) => compareText(left.path, right.path));
  for (const importer of sorted) {
    if (loaded.has(importer.path)) {
      groups.loadCycle.push(importer);
    } else if (isBackEdge(importer.path)) {
      groups.backEdge.push(importer);
    } else if (declared.has(importer.path)) {
      groups.declarationGraph.push(importer);
    } else {
      groups.rewire.push(importer);
    }
  }
  return groups;
}
