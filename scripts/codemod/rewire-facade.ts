/**
 * The rewire codemod (#808, pass 3): rewrites the importers of a feature
 * package that can take it by name so they import it from its facade,
 * `@open-tomato/rafa-<name>`, rather than by relative path. The groups
 * come from `rewire-groups.ts`; this module prints them, rewrites the
 * `rewire` group and leaves the other three byte for byte.
 *
 * For each importer to rewire, {@link rewriteImporter} maps every binding
 * of a package file (a named import, a default import, a named
 * re-export, a default re-export) to the name the facade entry gives that
 * file and that export, read off the entry's rows (`facade-tables.ts`),
 * and merges the importer's statements of the package into at most four:
 *
 *   - one `import { … }` and one `import type { … }` from the facade, a
 *     binding going on the type statement when `ts.transpileModule` of
 *     the importer's text, with the root `tsconfig.json`'s options
 *     ({@link readCompilerOptions}), elides it — the elision bun applies
 *     too, so the survey reads the rewired importer with the edge kinds
 *     the base graph holds;
 *   - one `export { … } from` and one `export type { … } from` the
 *     facade, by the same rule; a re-export is never folded into an
 *     import.
 *
 * A binding is aliased (`collect as collectSessions`) when its local or
 * exported name differs from the facade's name. The imports go where the
 * first import statement of the package stood and the re-exports where
 * the first re-export stood; every other statement of the package is
 * removed with its line. `import/order` decides the final place, so the
 * rewire task runs `eslint --fix` on the changed files afterwards.
 *
 * A binding the facade does not export, a namespace import or re-export
 * (`import * as x`, `export * as x`), an `export *` and a side-effect
 * import of a package file are refused, each naming the importer, its
 * line, the binding and the statement; one refusal anywhere and the run
 * writes nothing at all and exits 1, so the tree is never half rewired.
 *
 * Run from the repository root,
 * `bun scripts/codemod/rewire-facade.ts --package=rafa-<name> [--dry-run] [--graph=<file>]`
 * prints the four groups with their counts, then the refusals, then what
 * it wrote; `--dry-run` prints the same and writes nothing. See {@link main}.
 */

import type { Importer, ImporterGroups, PackageStatement } from './rewire-groups';
import type { CutRules } from '../survey/cut-table';
import type { FacadeNamedBinding, FacadeRow } from '../survey/facade-tables';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { DEFAULT_GRAPH } from '../survey/coupling';
import { readFacadeTables } from '../survey/facade-tables';

import { committableFiles } from './core-package-tree';
import {
  DECLARATION_CONFIGS,
  groupImporters,
  readDeclarationRoots,
  readGraphEdges,
  readImporters,
  readPackageFiles,
} from './rewire-groups';

/** The flag that prints the groups and refusals and writes nothing. */
export const DRY_RUN_FLAG = '--dry-run';

/** The flag that names the package, before its `=`. */
export const PACKAGE_FLAG = '--package';

/** The flag that names another import graph, before its `=`. */
export const GRAPH_FLAG = '--graph';

/** What a wrong command line is answered with. */
export const USAGE: string = `usage: bun scripts/codemod/rewire-facade.ts ${PACKAGE_FLAG}=rafa-<name> [${DRY_RUN_FLAG}] [${GRAPH_FLAG}=<file>]`;

/** The exit code of a run that refused a binding and wrote nothing. */
export const REFUSED_EXIT = 1;

/** The exit code of a command line refused with {@link USAGE}, or a tree the run cannot read. */
export const USAGE_EXIT = 2;

/** The width a merged statement stays on one line within; past it, one binding per line. */
export const ONE_LINE_WIDTH = 100;

const PACKAGE_NAME = /^rafa-[a-z][a-z0-9-]*$/;

/** The command line, read. */
export interface RewireArgs {
  /** The target package, such as `rafa-effort`. */
  readonly packageName: string;
  /** Whether the run writes nothing. */
  readonly dryRun: boolean;
  /** The import graph the load cycle is read over, repository-relative or absolute. */
  readonly graph: string;
}

/** Thrown by {@link parseRewireArgs} on a command line it refuses; the message ends with {@link USAGE}. */
export class RewireUsageError extends Error {
  /** @param reason - What is wrong with the command line. */
  constructor(reason: string) {
    super(`${reason}\n${USAGE}`);
    this.name = 'RewireUsageError';
  }
}

/** Why a binding cannot be taken from the facade. */
export type RefusalReason = 'export *' | 'namespace' | 'not in the facade' | 'side-effect import';

/** One binding, or one statement, the rewrite refuses. */
export interface RewireRefusal {
  /** The importer's repository-relative path. */
  readonly importer: string;
  /** The 1-based line the statement starts on. */
  readonly line: number;
  /** The statement on one line, its whitespace runs collapsed. */
  readonly statement: string;
  /** The binding as written (`run`, `default as collect`, `* as effort`), or `-` for a statement with none. */
  readonly binding: string;
  /** The package file the statement names. */
  readonly target: string;
  /** Why it is refused. */
  readonly reason: RefusalReason;
}

/** What {@link rewriteImporter} rewrites, all of it passed in as data. */
export interface RewriteInput {
  /** The importer, as `readImporters` gives it. */
  readonly importer: Importer;
  /** Its source text, the one its statements' offsets point into. */
  readonly text: string;
  /** The facade entry's rows. */
  readonly rows: readonly FacadeRow[];
  /** The facade's package name, such as `@open-tomato/rafa-effort`. */
  readonly facadeSpecifier: string;
  /** The options the elision is read with, as {@link readCompilerOptions} gives them. */
  readonly compilerOptions: ts.CompilerOptions;
}

/** What one importer becomes. */
export interface RewriteResult {
  /** The rewritten text; the text handed in when anything is refused. */
  readonly text: string;
  /** What is refused, in source order; empty when the rewrite stands. */
  readonly refusals: readonly RewireRefusal[];
}

/** One run's groups, refusals and the files it would write. */
export interface RewirePlan {
  /** The importers by group. */
  readonly groups: ImporterGroups;
  /** Every refusal over the `rewire` group, by importer then line. */
  readonly refusals: readonly RewireRefusal[];
  /** The rewritten text of each changed importer, by path. */
  readonly writes: ReadonlyMap<string, string>;
}

/** What {@link readRewirePlan} and {@link main} read that a test may plant. */
export interface RewireOptions {
  /** The tree's files; `committableFiles(root)` unless a test plants its own. */
  readonly paths?: readonly string[];
  /** The cut rules; `CUT_RULES` unless a test plants its own. */
  readonly rules?: CutRules;
  /** The move order; `MOVE_ORDER` unless a test plants its own. */
  readonly moveOrder?: readonly string[];
  /** The declaration builds' configs; {@link DECLARATION_CONFIGS} unless a test plants its own. */
  readonly declarationConfigs?: readonly string[];
}

/** The lines and exit code of one CLI run. */
export interface RewireRun {
  readonly exitCode: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

/** One element of a merged statement: the facade's name and the importer's. */
interface Element {
  readonly name: string;
  readonly local: string;
}

/** The four merged statements' elements of one importer. */
interface Merged {
  readonly valueImports: Element[];
  readonly typeImports: Element[];
  readonly valueExports: Element[];
  readonly typeExports: Element[];
}

/** One span of the text to replace. */
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Reads the command line after the script's path.
 *
 * @param args - The arguments.
 * @returns The package, whether the run is dry and the graph.
 * @throws RewireUsageError on a missing, repeated or malformed `--package=`,
 *   a repeated or empty `--graph=`, a repeated `--dry-run`, or any other argument.
 */
export function parseRewireArgs(args: readonly string[]): RewireArgs {
  let packageName: string | undefined;
  let graph: string | undefined;
  let dryRun = false;
  for (const arg of args) {
    if (arg.startsWith(`${PACKAGE_FLAG}=`) && packageName === undefined) {
      packageName = arg.slice(PACKAGE_FLAG.length + 1);
      if (!PACKAGE_NAME.test(packageName)) {
        throw new RewireUsageError(`${arg} names no rafa-<name> package`);
      }
    } else if (arg.startsWith(`${GRAPH_FLAG}=`) && graph === undefined && arg.length > GRAPH_FLAG.length + 1) {
      graph = arg.slice(GRAPH_FLAG.length + 1);
    } else if (arg === DRY_RUN_FLAG && !dryRun) {
      dryRun = true;
    } else {
      throw new RewireUsageError(`refused argument ${arg}`);
    }
  }
  if (packageName === undefined) {
    throw new RewireUsageError(`no ${PACKAGE_FLAG}= given`);
  }
  return { dryRun, graph: graph ?? DEFAULT_GRAPH, packageName };
}

/**
 * The root `tsconfig.json`'s compiler options, as the elision is read
 * with. `moduleResolution` is left out: typescript 5.9.3's
 * `transpileModule` throws `undefined is not an object (evaluating
 * 'path.includes')` on any `export { a as b } from` under `bundler`
 * resolution, and a one-file transpile resolves nothing, so the elision
 * is the same without it.
 *
 * @param root - The repository root.
 * @returns The options.
 * @throws When the config cannot be read or parsed.
 */
export function readCompilerOptions(root: string): ts.CompilerOptions {
  const file = join(root, 'tsconfig.json');
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error(`tsconfig.json: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, file);
  const options: ts.CompilerOptions = { ...parsed.options };
  delete options.moduleResolution;
  return options;
}

/**
 * The import locals and re-exported names `ts.transpileModule` keeps in
 * an importer's text; a binding missing from the set is one the emit
 * elides.
 *
 * @param path - The importer's path, which picks the script kind.
 * @param text - Its source text.
 * @param options - The compiler options.
 * @returns The kept names: each import's local name and each
 *   `export … from` element's exported name.
 */
export function readKeptNames(path: string, text: string, options: ts.CompilerOptions): Set<string> {
  const output = ts.transpileModule(text, { compilerOptions: options, fileName: path, reportDiagnostics: false }).outputText;
  const source = ts.createSourceFile('output.js', output, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const kept = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) {
      const clause = statement.importClause;
      if (clause.name !== undefined) {
        kept.add(clause.name.text);
      }
      if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        clause.namedBindings.elements.forEach((element) => kept.add(element.name.text));
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      statement.exportClause.elements.forEach((element) => kept.add(element.name.text));
    }
  }
  return kept;
}

/** A statement's text on one line, whitespace runs collapsed. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A named binding as written: `run`, or `default as collect`. */
function writtenBinding(binding: FacadeNamedBinding): string {
  return binding.name === binding.local
    ? binding.name
    : `${binding.name} as ${binding.local}`;
}

/** A refusal of one statement of an importer. */
function refusal(importer: string, statement: PackageStatement, binding: string, reason: RefusalReason): RewireRefusal {
  return { binding, importer, line: statement.line, reason, statement: oneLine(statement.text), target: statement.target };
}

/**
 * Renders one merged statement from the facade.
 *
 * @param keyword - `import` or `export`.
 * @param typeOnly - Whether it is the type statement.
 * @param elements - The facade names with the importer's names.
 * @param specifier - The facade's package name.
 * @returns The statement, on one line within {@link ONE_LINE_WIDTH}, else one element per line.
 */
export function renderStatement(keyword: 'export' | 'import', typeOnly: boolean, elements: readonly Element[], specifier: string): string {
  const head = typeOnly
    ? `${keyword} type`
    : keyword;
  const parts = elements.map((element) => element.name === element.local
    ? element.name
    : `${element.name} as ${element.local}`);
  const single = `${head} { ${parts.join(', ')} } from '${specifier}';`;
  return single.length <= ONE_LINE_WIDTH
    ? single
    : `${head} {\n${parts.map((part) => `  ${part},\n`).join('')}} from '${specifier}';`;
}

/** The elements sorted by facade name then local name, each pair once. */
function sortedElements(elements: readonly Element[]): Element[] {
  const unique = new Map(elements.map((element) => [`${element.name}\u0000${element.local}`, element]));
  return [...unique.values()].sort((left, right) => (left.name === right.name
    ? Number(left.local > right.local) - Number(left.local < right.local)
    : Number(left.name > right.name) - Number(left.name < right.name)));
}

/** The span a removed statement takes: its whole line when nothing else stands on it, and one blank line of two around it. */
function removalSpan(text: string, statement: PackageStatement): Edit {
  const lineStart = text.lastIndexOf('\n', statement.start - 1) + 1;
  const after = /^[ \t]*(?:\n|$)/.exec(text.slice(statement.end));
  if (text.slice(lineStart, statement.start).trim() !== '' || after === null) {
    return { end: statement.end, start: statement.start, text: '' };
  }
  const end = statement.end + after[0].length;
  const blankBefore = lineStart >= 2 && text.slice(lineStart - 2, lineStart) === '\n\n';
  const blankAfter = text[end] === '\n';
  return { end: blankBefore && blankAfter
    ? end + 1
    : end, start: lineStart, text: '' };
}

/** The edits that put the merged statements of one form in place of that form's statements. */
function formEdits(text: string, statements: readonly PackageStatement[], rendered: readonly string[]): Edit[] {
  const [first, ...rest] = statements;
  if (first === undefined) {
    return [];
  }
  const replaced: Edit = rendered.length > 0
    ? { end: first.end, start: first.start, text: rendered.join('\n') }
    : removalSpan(text, first);
  return [replaced, ...rest.map((statement) => removalSpan(text, statement))];
}

/** Applies non-overlapping edits to a text, last first. */
function applyEdits(text: string, edits: readonly Edit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((current, edit) => current.slice(0, edit.start) + edit.text + current.slice(edit.end), text);
}

/**
 * Rewrites one importer's statements of the package as statements from
 * its facade (see the module note).
 *
 * @param input - The importer, its text, the facade's rows and name, and the compiler options.
 * @returns The rewritten text, or the text unchanged with every refusal.
 */
export function rewriteImporter(input: RewriteInput): RewriteResult {
  const { importer, text } = input;
  const kept = readKeptNames(importer.path, text, input.compilerOptions);
  const merged: Merged = { typeExports: [], typeImports: [], valueExports: [], valueImports: [] };
  const refusals: RewireRefusal[] = [];
  for (const statement of importer.statements) {
    if (statement.bindings.length === 0) {
      refusals.push(refusal(importer.path, statement, '-', 'side-effect import'));
    }
    for (const binding of statement.bindings) {
      if (binding.shape === 'star') {
        refusals.push(refusal(importer.path, statement, '*', 'export *'));
        continue;
      }
      if (binding.shape === 'namespace') {
        refusals.push(refusal(importer.path, statement, `* as ${binding.local}`, 'namespace'));
        continue;
      }
      const row = input.rows.find((candidate) => candidate.source === statement.target && candidate.sourceName === binding.name);
      if (row === undefined) {
        refusals.push(refusal(importer.path, statement, writtenBinding(binding), 'not in the facade'));
        continue;
      }
      const element: Element = { local: binding.local, name: row.name };
      const isType = binding.kind === 'type' || !kept.has(binding.local);
      const list = statement.form === 'import'
        ? isType
          ? merged.typeImports
          : merged.valueImports
        : isType
          ? merged.typeExports
          : merged.valueExports;
      list.push(element);
    }
  }
  if (refusals.length > 0) {
    return { refusals, text };
  }
  const render = (keyword: 'export' | 'import', types: Element[], values: Element[]): string[] => [
    ...(types.length > 0
      ? [renderStatement(keyword, true, sortedElements(types), input.facadeSpecifier)]
      : []),
    ...(values.length > 0
      ? [renderStatement(keyword, false, sortedElements(values), input.facadeSpecifier)]
      : []),
  ];
  const edits = [
    ...formEdits(text, importer.statements.filter((statement) => statement.form === 'import'), render('import', merged.typeImports, merged.valueImports)),
    ...formEdits(text, importer.statements.filter((statement) => statement.form === 'export'), render('export', merged.typeExports, merged.valueExports)),
  ];
  return { refusals: [], text: applyEdits(text, edits) };
}

/**
 * The facade's package name, read from `packages/<name>/package.json`.
 *
 * @param root - The repository root.
 * @param packageName - The package, such as `rafa-effort`.
 * @returns Its `name`, such as `@open-tomato/rafa-effort`.
 * @throws When the manifest is missing or names nothing.
 */
export function readFacadeSpecifier(root: string, packageName: string): string {
  const manifest = join(root, 'packages', packageName, 'package.json');
  if (!existsSync(manifest)) {
    throw new Error(`packages/${packageName}/package.json: no facade manifest`);
  }
  const name: unknown = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name;
  if (typeof name !== 'string' || name === '') {
    throw new Error(`packages/${packageName}/package.json: no name`);
  }
  return name;
}

/**
 * Reads a tree into the groups of one package, rewrites the `rewire`
 * group in memory and gathers the refusals; writes nothing.
 *
 * @param root - The repository root.
 * @param args - The package and the graph.
 * @param options - The files, rules, move order and declaration configs a test may plant.
 * @returns The plan.
 * @throws When the facade entry, its manifest, the graph, a declaration
 *   config or the root tsconfig cannot be read, or the package is not in
 *   the move order.
 */
export function readRewirePlan(root: string, args: Pick<RewireArgs, 'graph' | 'packageName'>, options: RewireOptions = {}): RewirePlan {
  const entry = `packages/${args.packageName}/index.ts`;
  const rows = readFacadeTables(root).get(entry);
  if (rows === undefined) {
    throw new Error(`${entry}: no facade entry`);
  }
  const facadeSpecifier = readFacadeSpecifier(root, args.packageName);
  const paths = options.paths ?? committableFiles(root);
  const packageFiles = readPackageFiles(paths, args.packageName, options.rules);
  const groups = groupImporters({
    declarationRoots: readDeclarationRoots(root, options.declarationConfigs ?? DECLARATION_CONFIGS),
    edges: readGraphEdges(root, args.graph),
    importers: readImporters(root, paths, packageFiles),
    moveOrder: options.moveOrder,
    packageFiles,
    packageName: args.packageName,
    rules: options.rules,
  });
  const compilerOptions = readCompilerOptions(root);
  const refusals: RewireRefusal[] = [];
  const writes = new Map<string, string>();
  for (const importer of groups.rewire) {
    const text = readFileSync(join(root, importer.path), 'utf8');
    const result = rewriteImporter({ compilerOptions, facadeSpecifier, importer, rows, text });
    refusals.push(...result.refusals);
    if (result.refusals.length === 0 && result.text !== text) {
      writes.set(importer.path, result.text);
    }
  }
  return { groups, refusals, writes };
}

/** One refusal on one line. */
export function renderRefusal(item: RewireRefusal): string {
  const why = item.reason === 'not in the facade'
    ? `the facade exports no ${item.binding} of ${item.target}`
    : item.reason === 'namespace'
      ? `a namespace ${item.binding} of ${item.target} cannot come from the facade`
      : item.reason === 'export *'
        ? `an export * of ${item.target} cannot come from the facade`
        : `a side-effect import of ${item.target} cannot come from the facade`;
  return `${item.importer}:${item.line}: ${why}: ${item.statement}`;
}

/**
 * The report of one run: each group under its heading and count, in the
 * order to rewire, load cycle, back edge, declaration graph; then the
 * refusals; then what was written.
 *
 * @param plan - The plan.
 * @param dryRun - Whether the run wrote nothing by request.
 * @returns The lines.
 */
export function reportLines(plan: RewirePlan, dryRun: boolean): string[] {
  const section = (heading: string, items: readonly string[]): string[] => [`${heading} (${items.length})`, ...items.map((item) => `  ${item}`)];
  const paths = (importers: readonly Importer[]): string[] => importers.map((importer) => importer.path);
  return [
    ...section('to rewire', paths(plan.groups.rewire)),
    ...section('load cycle', paths(plan.groups.loadCycle)),
    ...section('back edge', paths(plan.groups.backEdge)),
    ...section('declaration graph', paths(plan.groups.declarationGraph)),
    ...(plan.refusals.length > 0
      ? section('refused', plan.refusals.map(renderRefusal))
      : []),
    dryRun
      ? 'dry run, nothing written.'
      : plan.refusals.length > 0
        ? 'refused, nothing written.'
        : `wrote ${plan.writes.size} file(s).`,
  ];
}

/**
 * Runs the codemod over a repository.
 *
 * @param root - The repository root.
 * @param args - The arguments after the script's path.
 * @param options - The files, rules, move order and declaration configs a test may plant.
 * @returns The lines and exit code: 0 when the run stands (written, or a
 *   dry run with no refusal), {@link REFUSED_EXIT} when anything is
 *   refused and nothing is written, {@link USAGE_EXIT} with the message on
 *   stderr for a refused command line or a tree the run cannot read.
 */
export function main(root: string, args: readonly string[], options: RewireOptions = {}): RewireRun {
  let parsed: RewireArgs;
  let plan: RewirePlan;
  try {
    parsed = parseRewireArgs(args);
    plan = readRewirePlan(root, parsed, options);
  } catch (error) {
    return { exitCode: USAGE_EXIT, stderr: [(error as Error).message], stdout: [] };
  }
  if (!parsed.dryRun && plan.refusals.length === 0) {
    for (const [path, text] of plan.writes) {
      writeFileSync(join(root, path), text);
    }
  }
  return {
    exitCode: plan.refusals.length > 0
      ? REFUSED_EXIT
      : 0,
    stderr: [],
    stdout: reportLines(plan, parsed.dryRun),
  };
}

if (import.meta.main) {
  const run = main(process.cwd(), process.argv.slice(2));
  for (const line of run.stdout) {
    console.log(line);
  }
  for (const line of run.stderr) {
    console.error(line);
  }
  process.exit(run.exitCode);
}
