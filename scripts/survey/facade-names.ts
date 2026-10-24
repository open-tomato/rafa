/**
 * The names files outside a package import from it, value and type, read
 * with the TypeScript checker (#808, pass 2). A facade's `index.ts`
 * re-exports exactly these names, so this reading is what the entry is
 * written from and what its tests hold it to.
 *
 * The universe is the root program: the `fileNames` and options of the
 * root `tsconfig.json` (so `paths` resolves `@open-tomato/rafa/*` into
 * core), built once with `ts.createProgram`, and the files of
 * `packages/` the program reaches from it: a feature package's own files
 * are outside importers of the other packages (effort's of inventory's
 * `bareSkillName`) though the root tsconfig excludes `packages/`. A file is
 * set aside when `classifyFile` reads it as `test` or `test-support`, or
 * when `placeFile` puts it in the package being read. Every other file is an
 * outside importer, a file of an unassigned folder and a file under `scripts/`
 * included.
 *
 * For each outside file the reader walks the `import` and `export … from`
 * statements, resolves each specifier, and goes on only when `placeFile`
 * puts the resolved file in the package:
 *
 *   - a named element records the exported name (`propertyName ?? name`)
 *     with the declaration its alias resolves to. Its kind is `value` when
 *     the declaration's symbol holds `ts.SymbolFlags.Value`, else `type`,
 *     read off the symbol and never off `import type`: a value export
 *     covers a type use, and the facade must stay loadable;
 *   - a default import, or an element named `default`, records the
 *     declaration's own name; an anonymous default is the problem
 *     `anonymous-default`;
 *   - a namespace import or `export *` is the problem `namespace-import`
 *     and records no name;
 *   - two declarations reached under one name are the problem `collision`;
 *   - a dynamic `import()` of a string literal is listed under
 *     `dynamicImports` and is no problem: the facade does not stand for it.
 *
 * A side-effect import (`import './x.js'`) and a type-position
 * `import('./x.js').T` record nothing.
 *
 * A specifier that resolves to a facade entry (`packages/rafa-<name>/index.ts`,
 * or the commands entry beside it, `packages/rafa-<name>/commands.ts`,
 * each placed in the package by its folder) is read through the entry's
 * table of `facade-tables.ts`: each name taken is recorded as if taken
 * from the file the entry re-exports it from, under the name it has there
 * (`default` for `default as d`), so an importer rewired to the facade
 * reads the same as one by relative path and the entry is never a name's
 * `exportedBy`. A name the table lacks records no name and is the problem
 * `unexported-name`, through either entry.
 *
 * Each name records the entry it is taken through, its `entry`:
 * `commands` when every import of it resolves to a commands entry, else
 * `index`. A name taken through both entries, or by path as well as
 * through the commands entry, belongs to the index.
 *
 * Each name's `exportedBy` is the file the entry re-exports it from: the
 * package's own index, `src/<name>/index.ts`, when its exports hold the
 * name for the same declaration; else the declaring file, when it is in
 * the package and exports the declaration under the name or as its
 * default; else the first sorted package file an importer took the name
 * from. An existing index is re-exported from where it covers the names,
 * never widened. `viaDefault` says the entry takes the name as `default`
 * of that file.
 *
 * Run from the repository root,
 * `bun scripts/survey/facade-names.ts --package=<rafa-effort|…> [--json|--entry|--commands]`
 * prints the names (tab-separated), the reading as JSON, the text of the
 * facade's `index.ts`, or the text of its `commands.ts`; see {@link main}.
 */

import type { CutRules } from './cut-table';
import type { FacadeEntryKind, FacadeTables } from './facade-tables';

import { realpathSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import ts from 'typescript';

import { CUT_RULES, placeFile } from './cut-table';
import { facadeEntryOf, readFacadeTables } from './facade-tables';
import { classifyFile } from './files';
import { stableJson } from './import-graph';

/** Whether a name is a value at run time or a type alone. */
export type FacadeNameKind = 'type' | 'value';

/** One name outside files import from the package. */
export interface FacadeName {
  /** The name the entry exports: the exported name, or a default's own name. */
  readonly name: string;
  /** `value` when the declaration's symbol is a value, else `type`. */
  readonly kind: FacadeNameKind;
  /** The repository-relative file that declares it. */
  readonly declaredIn: string;
  /** The repository-relative file the entry re-exports it from. */
  readonly exportedBy: string;
  /** Whether `exportedBy` exports it as `default` rather than by name. */
  readonly viaDefault: boolean;
  /** The outside files that import it, sorted. */
  readonly importers: readonly string[];
  /**
   * The entry it is taken through: `commands` when every import of it
   * resolves to the commands entry, else `index`.
   */
  readonly entry: FacadeEntryKind;
}

/** One declaration, as a problem names it. */
export interface FacadeDeclaration {
  /** The repository-relative file it is in. */
  readonly file: string;
  /** Its own name. */
  readonly name: string;
  /** Its start offset in the file. */
  readonly position: number;
}

/** A default import whose declaration has no name to export it under. */
export interface AnonymousDefaultProblem {
  readonly kind: 'anonymous-default';
  readonly importer: string;
  readonly target: string;
}

/** A namespace import or `export *`, which no list of names stands for. */
export interface NamespaceImportProblem {
  readonly kind: 'namespace-import';
  readonly importer: string;
  readonly target: string;
}

/** Two or more declarations reached under one name. */
export interface CollisionProblem {
  readonly kind: 'collision';
  readonly name: string;
  /** The declarations, sorted by file, then position. */
  readonly declarations: readonly FacadeDeclaration[];
}

/** A name taken through a facade entry, either one, that the entry does not export. */
export interface UnexportedNameProblem {
  readonly kind: 'unexported-name';
  readonly importer: string;
  /** The entry the importer's specifier resolves to. */
  readonly target: string;
  /** The name taken: the exported name, or `default`. */
  readonly name: string;
}

/** What keeps a facade entry from standing for the imports. */
export type FacadeProblem = AnonymousDefaultProblem | CollisionProblem | NamespaceImportProblem | UnexportedNameProblem;

/** A dynamic `import()` from an outside file that lands in the package. */
export interface DynamicImport {
  readonly importer: string;
  readonly target: string;
}

/** What outside files take from one package. */
export interface FacadeReading {
  /** The package read, as `CutRules` names it. */
  readonly package: string;
  /** The names, sorted by UTF-16 code unit; a collided name is left out. */
  readonly names: readonly FacadeName[];
  /** The problems, sorted by kind, then by what they name. */
  readonly problems: readonly FacadeProblem[];
  /** The dynamic imports, sorted by importer, then target. */
  readonly dynamicImports: readonly DynamicImport[];
}

/** What {@link readFacadeNames} reads besides the root and the package. */
export interface FacadeOptions {
  /** The cut rules; {@link CUT_RULES} unless a test plants its own. */
  readonly rules?: CutRules;
  /** The tsconfig, relative to the root; `tsconfig.json` by default. */
  readonly tsconfig?: string;
  /**
   * The facade tables, keyed by entry path; `readFacadeTables(root)`
   * unless a test hands its own.
   */
  readonly facades?: FacadeTables;
}

/** The lines and exit code of one CLI run. */
export interface FacadeRun {
  readonly exitCode: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

/** How the CLI is called. */
export const USAGE = 'usage: bun scripts/survey/facade-names.ts --package=<name> [--json|--entry|--commands]';

/** One import of a name, before the names are grouped. */
interface NameUse {
  readonly exportName: string;
  readonly declaration: FacadeDeclaration;
  readonly isValue: boolean;
  readonly importer: string;
  readonly target: string;
  /** The facade entry the import resolved to, or `undefined` for a file taken by path. */
  readonly entry: FacadeEntryKind | undefined;
}

/** One imported or re-exported element, as an importer's statement names it. */
interface ElementSite {
  readonly importer: string;
  readonly target: string;
  readonly exportName: string;
  readonly location: ts.Node;
}

/** What one walk of the outside files collects. */
interface Collected {
  readonly uses: NameUse[];
  readonly problems: FacadeProblem[];
  readonly dynamicImports: DynamicImport[];
}

/** The program and what each step reads off it. */
interface ReadContext {
  readonly root: string;
  readonly pkg: string;
  readonly rules: CutRules;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly options: ts.CompilerOptions;
  readonly facades: FacadeTables;
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
 * A file's path relative to the root, with `/`.
 *
 * @param root - The real path of the repository root.
 * @param fileName - An absolute path, as the compiler spells it.
 * @returns The relative path; it opens with `..` outside the root.
 */
function repoPath(root: string, fileName: string): string {
  return relative(root, fileName)
    .split(sep)
    .join('/');
}

/** Whether a relative path is a source file of the repository, not a library's. */
function isRepoSource(path: string): boolean {
  return !path.startsWith('../') && !path.includes('node_modules/') && !path.endsWith('.d.ts');
}

/** Whether `placeFile` puts a repository path in the package. */
function inPackage(context: ReadContext, path: string): boolean {
  return isRepoSource(path) && placeFile(path, context.rules).package === context.pkg;
}

/**
 * Reads the tsconfig and builds the program over its files.
 *
 * @throws When the config cannot be read or reports an error.
 */
function buildProgram(root: string, tsconfig: string): { program: ts.Program; options: ts.CompilerOptions; fileNames: readonly string[] } {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(join(root, tsconfig), {}, host);
  if (parsed === undefined) {
    throw new Error(`${tsconfig}: the config could not be read`);
  }
  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'));
    throw new Error(`${tsconfig}: ${messages.join('; ')}`);
  }
  return {
    fileNames: parsed.fileNames,
    options: parsed.options,
    program: ts.createProgram(parsed.fileNames, parsed.options),
  };
}

/**
 * The repository path of the file a module specifier resolves to.
 *
 * @returns The path, or `undefined` when it resolves to nothing.
 */
function resolveSpecifier(context: ReadContext, specifier: ts.Expression, importer: ts.SourceFile): string | undefined {
  const symbol = context.checker.getSymbolAtLocation(specifier);
  const declaration = symbol?.declarations?.[0];
  if (declaration !== undefined && ts.isSourceFile(declaration)) {
    return repoPath(context.root, declaration.fileName);
  }
  if (!ts.isStringLiteralLike(specifier)) {
    return undefined;
  }
  const resolved = ts.resolveModuleName(specifier.text, importer.fileName, context.options, ts.sys).resolvedModule;
  return resolved === undefined
    ? undefined
    : repoPath(context.root, resolved.resolvedFileName);
}

/**
 * The declaration an alias resolves to, with its symbol's value flag.
 *
 * @returns The declaration, or `undefined` when the alias resolves to none.
 */
function resolveAlias(
  context: ReadContext,
  location: ts.Node,
): { declaration: ts.Declaration; symbol: ts.Symbol } | undefined {
  const local = context.checker.getSymbolAtLocation(location);
  if (local === undefined) {
    return undefined;
  }
  const symbol = local.flags & ts.SymbolFlags.Alias
    ? context.checker.getAliasedSymbol(local)
    : local;
  const declaration = symbol.declarations?.[0];
  return declaration === undefined
    ? undefined
    : { declaration, symbol };
}

/**
 * A declaration's own name: the identifier it declares, or for
 * `export default x` the name `x` refers to.
 *
 * @returns The name, or `undefined` for an anonymous declaration.
 */
function ownName(declaration: ts.Declaration): string | undefined {
  const name = ts.getNameOfDeclaration(declaration);
  if (name !== undefined && ts.isIdentifier(name)) {
    return name.text;
  }
  return ts.isExportAssignment(declaration) && ts.isIdentifier(declaration.expression)
    ? declaration.expression.text
    : undefined;
}

/** The declaration as the reading records it. */
function describeDeclaration(context: ReadContext, declaration: ts.Declaration, name: string): FacadeDeclaration {
  return {
    file: repoPath(context.root, declaration.getSourceFile().fileName),
    name,
    position: declaration.getStart(),
  };
}

/**
 * Records one imported or re-exported element: a name use, or the
 * anonymous-default problem.
 */
function recordElement(
  context: ReadContext,
  collected: Collected,
  site: ElementSite & { entry: FacadeEntryKind | undefined },
): void {
  const resolved = resolveAlias(context, site.location);
  if (resolved === undefined) {
    return;
  }
  const isDefault = site.exportName === 'default';
  const name = isDefault
    ? ownName(resolved.declaration)
    : site.exportName;
  if (name === undefined || name === 'default') {
    collected.problems.push({ importer: site.importer, kind: 'anonymous-default', target: site.target });
    return;
  }
  collected.uses.push({
    declaration: describeDeclaration(context, resolved.declaration, ownName(resolved.declaration) ?? name),
    entry: site.entry,
    exportName: site.exportName,
    importer: site.importer,
    isValue: (resolved.symbol.flags & ts.SymbolFlags.Value) !== 0,
    target: site.target,
  });
}

/**
 * Records one element. A target that is a facade entry is read through
 * its table: the name is recorded as taken from the file the entry
 * re-exports it from, under its name there, with the entry it was taken
 * through; a name the table lacks is the problem `unexported-name`. Any
 * other target is recorded as itself, through no entry.
 */
function recordTaken(context: ReadContext, collected: Collected, site: ElementSite): void {
  const rows = context.facades.get(site.target);
  if (rows === undefined) {
    recordElement(context, collected, { ...site, entry: undefined });
    return;
  }
  const row = rows.find((candidate) => candidate.name === site.exportName);
  if (row === undefined) {
    collected.problems.push({ importer: site.importer, kind: 'unexported-name', name: site.exportName, target: site.target });
    return;
  }
  recordElement(context, collected, {
    ...site,
    entry: facadeEntryOf(site.target) ?? 'index',
    exportName: row.sourceName,
    target: row.source,
  });
}

/** Records the bindings of one `import … from` landing in the package. */
function recordImport(context: ReadContext, collected: Collected, clause: ts.ImportClause, importer: string, target: string): void {
  if (clause.name !== undefined) {
    recordTaken(context, collected, { exportName: 'default', importer, location: clause.name, target });
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    return;
  }
  if (ts.isNamespaceImport(bindings)) {
    collected.problems.push({ importer, kind: 'namespace-import', target });
    return;
  }
  for (const element of bindings.elements) {
    const exportName = (element.propertyName ?? element.name).text;
    recordTaken(context, collected, { exportName, importer, location: element.name, target });
  }
}

/** Records the elements of one `export … from` landing in the package. */
function recordReExport(context: ReadContext, collected: Collected, clause: ts.NamedExportBindings | undefined, importer: string, target: string): void {
  if (clause === undefined || ts.isNamespaceExport(clause)) {
    collected.problems.push({ importer, kind: 'namespace-import', target });
    return;
  }
  for (const element of clause.elements) {
    const property = element.propertyName ?? element.name;
    recordTaken(context, collected, { exportName: property.text, importer, location: property, target });
  }
}

/** Records every dynamic `import()` of a string literal in a file that lands in the package. */
function recordDynamicImports(context: ReadContext, collected: Collected, file: ts.SourceFile, importer: string): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        const target = resolveSpecifier(context, argument, file);
        if (target !== undefined && inPackage(context, target)) {
          collected.dynamicImports.push({ importer, target });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/** Walks one outside file's import and export statements. */
function readImporter(context: ReadContext, collected: Collected, file: ts.SourceFile): void {
  const importer = repoPath(context.root, file.fileName);
  for (const statement of file.statements) {
    const isImport = ts.isImportDeclaration(statement);
    if (!isImport && !ts.isExportDeclaration(statement)) {
      continue;
    }
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined) {
      continue;
    }
    const target = resolveSpecifier(context, specifier, file);
    if (target === undefined || !inPackage(context, target)) {
      continue;
    }
    if (isImport) {
      if (statement.importClause !== undefined) {
        recordImport(context, collected, statement.importClause, importer, target);
      }
    } else {
      recordReExport(context, collected, statement.exportClause, importer, target);
    }
  }
  recordDynamicImports(context, collected, file, importer);
}

/** The key two uses of one declaration share. */
function declarationKey(declaration: FacadeDeclaration): string {
  return `${declaration.file}:${declaration.position}`;
}

/**
 * The name under which a module exports a declaration, by name first.
 *
 * @returns `name`, `default`, or `undefined` when it exports it under neither.
 */
function exportedAs(context: ReadContext, path: string, name: string, declaration: FacadeDeclaration): string | undefined {
  const file = context.program.getSourceFile(join(context.root, path));
  const module = file === undefined
    ? undefined
    : context.checker.getSymbolAtLocation(file);
  if (module === undefined) {
    return undefined;
  }
  const exports = context.checker.getExportsOfModule(module);
  const resolvesTo = (exportName: string): boolean => {
    const symbol = exports.find((candidate) => candidate.getName() === exportName);
    if (symbol === undefined) {
      return false;
    }
    const target = symbol.flags & ts.SymbolFlags.Alias
      ? context.checker.getAliasedSymbol(symbol)
      : symbol;
    const found = target.declarations?.[0];
    return found !== undefined
      && repoPath(context.root, found.getSourceFile().fileName) === declaration.file
      && found.getStart() === declaration.position;
  };
  if (resolvesTo(name)) {
    return name;
  }
  return resolvesTo('default')
    ? 'default'
    : undefined;
}

/** The package's own index: `src/<name>/index.ts`, `<name>` its name less `rafa-`. */
function packageIndex(pkg: string): string {
  return `src/${pkg.replace(/^(?:@[^/]+\/)?rafa-/, '')}/index.ts`;
}

/**
 * Where the entry re-exports one name from, and whether as `default`.
 */
function exportSource(context: ReadContext, name: string, uses: readonly NameUse[]): { exportedBy: string; viaDefault: boolean } {
  const declaration = uses[0]!.declaration;
  const index = packageIndex(context.pkg);
  if (inPackage(context, index) && exportedAs(context, index, name, declaration) === name) {
    return { exportedBy: index, viaDefault: false };
  }
  if (inPackage(context, declaration.file)) {
    const as = exportedAs(context, declaration.file, name, declaration);
    if (as !== undefined) {
      return { exportedBy: declaration.file, viaDefault: as === 'default' };
    }
  }
  const first = [...uses].sort((left, right) => compareText(left.target, right.target))[0]!;
  return { exportedBy: first.target, viaDefault: first.exportName === 'default' };
}

/** Groups the uses by name into names and collision problems. */
function groupNames(context: ReadContext, uses: readonly NameUse[]): { names: FacadeName[]; collisions: CollisionProblem[] } {
  const byName = new Map<string, NameUse[]>();
  for (const use of uses) {
    const name = use.exportName === 'default'
      ? use.declaration.name
      : use.exportName;
    byName.set(name, [...(byName.get(name) ?? []), use]);
  }
  const names: FacadeName[] = [];
  const collisions: CollisionProblem[] = [];
  for (const [name, group] of byName) {
    const declarations = new Map(group.map((use) => [declarationKey(use.declaration), use.declaration]));
    if (declarations.size > 1) {
      const sorted = [...declarations.values()]
        .sort((left, right) => compareText(left.file, right.file) || left.position - right.position);
      collisions.push({ declarations: sorted, kind: 'collision', name });
      continue;
    }
    names.push({
      declaredIn: group[0]!.declaration.file,
      entry: group.every((use) => use.entry === 'commands')
        ? 'commands'
        : 'index',
      importers: [...new Set(group.map((use) => use.importer))].sort(compareText),
      kind: group[0]!.isValue
        ? 'value'
        : 'type',
      name,
      ...exportSource(context, name, group),
    });
  }
  return { collisions, names: names.sort((left, right) => compareText(left.name, right.name)) };
}

/** The text a problem is sorted by and printed as. */
export function renderProblem(problem: FacadeProblem): string {
  if (problem.kind === 'collision') {
    const declarations = problem.declarations.map((declaration) => `${declaration.file}:${declaration.name}@${declaration.position}`);
    return ['collision', problem.name, ...declarations].join('\t');
  }
  if (problem.kind === 'unexported-name') {
    return [problem.kind, problem.importer, problem.target, problem.name].join('\t');
  }
  return [problem.kind, problem.importer, problem.target].join('\t');
}

/** Sorts and drops repeated entries by their rendered text. */
function uniqueSorted<T>(items: readonly T[], render: (item: T) => string): T[] {
  const byText = new Map(items.map((item) => [render(item), item]));
  return [...byText.keys()].sort(compareText).map((key) => byText.get(key)!);
}

/** Whether a package name is one the rules hold. */
function isRulePackage(rules: CutRules, pkg: string): boolean {
  return rules.packages.some((rule) => rule.name === pkg);
}

/**
 * Reads the names files outside a package import from it.
 *
 * @param root - The repository root; the tsconfig is read relative to it.
 * @param pkg - The package to read, as `rules` names it (`rafa-effort`).
 * @param options - The rules, the tsconfig and the facade tables;
 *   {@link CUT_RULES}, `tsconfig.json` and `readFacadeTables(root)` by
 *   default.
 * @returns The reading: names sorted by UTF-16 code unit, problems and
 *   dynamic imports sorted, every path repository-relative with `/`.
 * @throws When the rules hold no package of that name, the tsconfig
 *   cannot be read or reports an error, or a facade entry is not of the
 *   facade form.
 */
export function readFacadeNames(root: string, pkg: string, options: FacadeOptions = {}): FacadeReading {
  const rules = options.rules ?? CUT_RULES;
  if (!isRulePackage(rules, pkg)) {
    throw new Error(`no package named ${pkg} in the cut rules`);
  }
  const realRoot = realpathSync(root);
  const { fileNames, options: compilerOptions, program } = buildProgram(realRoot, options.tsconfig ?? 'tsconfig.json');
  const context: ReadContext = {
    checker: program.getTypeChecker(),
    facades: options.facades ?? readFacadeTables(realRoot),
    options: compilerOptions,
    pkg,
    program,
    root: realRoot,
    rules,
  };
  const collected: Collected = { dynamicImports: [], problems: [], uses: [] };
  const packageFiles = program
    .getSourceFiles()
    .map((file) => file.fileName)
    .filter((fileName) => repoPath(realRoot, fileName).startsWith('packages/'));
  for (const fileName of new Set([...fileNames, ...packageFiles])) {
    const path = repoPath(realRoot, fileName);
    const file = program.getSourceFile(fileName);
    if (file === undefined || classifyFile(path) !== 'source' || inPackage(context, path)) {
      continue;
    }
    readImporter(context, collected, file);
  }
  const { collisions, names } = groupNames(context, collected.uses);
  return {
    dynamicImports: uniqueSorted(collected.dynamicImports, (item) => `${item.importer}\t${item.target}`),
    names,
    package: pkg,
    problems: uniqueSorted([...collected.problems, ...collisions], renderProblem),
  };
}

/** The specifier from the facade's folder to a file, ending `.js`. */
function facadeSpecifier(facadeDir: string, path: string): string {
  const relativePath = posix.relative(facadeDir, path)
    .replace(/\.mts$/, '.mjs')
    .replace(/\.tsx?$/, '.js');
  return relativePath.startsWith('.')
    ? relativePath
    : `./${relativePath}`;
}

/** One `export` line, wrapped one name a line when it holds more than one. */
function exportLine(keyword: string, items: readonly string[], specifier: string): string {
  if (items.length === 1) {
    return `${keyword} { ${items[0]} } from '${specifier}';`;
  }
  return [`${keyword} {`, ...items.map((item) => `  ${item},`), `} from '${specifier}';`].join('\n');
}

/**
 * Writes an entry's text: the header, then the re-exports of the names
 * given.
 */
function renderEntry(header: readonly string[], names: readonly FacadeName[], facadeDir: string): string {
  const dir = facadeDir.replace(/\/+$/, '');
  const sources = [...new Set(names.map((name) => name.exportedBy))].sort(compareText);
  const groups = sources.map((source) => {
    const specifier = facadeSpecifier(dir, source);
    const group = names
      .filter((name) => name.exportedBy === source)
      .sort((left, right) => compareText(left.name, right.name));
    const types = group.filter((name) => name.kind === 'type').map((name) => name.name);
    const values = group.filter((name) => name.kind === 'value').map((name) => (name.viaDefault
      ? `default as ${name.name}`
      : name.name));
    return [
      ...(types.length > 0
        ? [exportLine('export type', types, specifier)]
        : []),
      ...(values.length > 0
        ? [exportLine('export', values, specifier)]
        : []),
    ].join('\n');
  });
  return `${[header.join('\n'), ...groups].join('\n\n')}\n`;
}

/**
 * Writes the text of a facade's `index.ts` from a reading: the names taken
 * through the index, never those taken through the commands entry alone.
 * Pure.
 *
 * @param reading - The reading of {@link readFacadeNames}.
 * @param facadeDir - The facade's folder, repository-relative
 *   (`packages/rafa-effort/`).
 * @returns The entry: a header comment, then one group per `exportedBy`
 *   file in sorted order, its type names on an `export type` line and its
 *   values on an `export` line, names sorted inside each, each specifier
 *   relative from `facadeDir` and ending `.js`; closing with a newline.
 */
export function renderFacadeEntry(reading: FacadeReading, facadeDir: string): string {
  const header = [
    '/**',
    ` * The facade of \`${reading.package}\`: every name a file outside the`,
    ' * package imports from it, re-exported from where it lives today.',
    ` * Written by \`bun scripts/survey/facade-names.ts --package=${reading.package} --entry\`.`,
    ' */',
  ];
  return renderEntry(header, reading.names.filter((name) => name.entry === 'index'), facadeDir);
}

/**
 * Writes the text of a facade's `commands.ts` from a reading: the names
 * taken through the commands entry alone. Pure.
 *
 * @param reading - The reading of {@link readFacadeNames}.
 * @param facadeDir - The facade's folder, repository-relative
 *   (`packages/rafa-pr/`).
 * @returns The entry, in the form {@link renderFacadeEntry} writes, under
 *   a header naming the `--commands` flag; the header alone when no name
 *   is taken through the commands entry.
 */
export function renderCommandsEntry(reading: FacadeReading, facadeDir: string): string {
  const header = [
    '/**',
    ` * The commands entry of \`${reading.package}\`: every name a file outside`,
    ' * the package takes through it alone, re-exported from where it lives today.',
    ` * Written by \`bun scripts/survey/facade-names.ts --package=${reading.package} --commands\`.`,
    ' */',
  ];
  return renderEntry(header, reading.names.filter((name) => name.entry === 'commands'), facadeDir);
}

/** The folder of a package's facade: `packages/<name less its scope>/`. */
export function facadeFolder(pkg: string): string {
  return `packages/${pkg.replace(/^@[^/]+\//, '')}/`;
}

/** The parsed arguments of the CLI. */
interface FacadeArgs {
  readonly pkg: string;
  readonly mode: 'commands' | 'entry' | 'json' | 'lines';
}

/** The flags that each pick what the CLI prints, one at most. */
const MODE_FLAGS: readonly string[] = ['--json', '--entry', '--commands'];

/**
 * Reads the arguments after the script's path.
 *
 * @throws When `--package=` is missing or repeated, an argument is
 *   unknown, or more than one of `--json`, `--entry` and `--commands` is
 *   passed; the message holds {@link USAGE}.
 */
function parseFacadeArgs(args: readonly string[]): FacadeArgs {
  let pkg: string | undefined;
  const modes: ('commands' | 'entry' | 'json')[] = [];
  for (const arg of args) {
    if (arg.startsWith('--package=') && pkg === undefined && arg.length > '--package='.length) {
      pkg = arg.slice('--package='.length);
    } else if (MODE_FLAGS.includes(arg)) {
      modes.push(arg.slice(2) as 'commands' | 'entry' | 'json');
    } else {
      throw new Error(`refused argument ${arg}\n${USAGE}`);
    }
  }
  if (pkg === undefined) {
    throw new Error(`no --package= given\n${USAGE}`);
  }
  if (modes.length > 1) {
    throw new Error(`--json, --entry and --commands are one of\n${USAGE}`);
  }
  return { mode: modes[0] ?? 'lines', pkg };
}

/**
 * Runs the CLI over a repository.
 *
 * @param root - The repository root.
 * @param args - The arguments after the script's path.
 * @param options - The rules, tsconfig and facade tables, as
 *   {@link readFacadeNames} takes them.
 * @returns The lines and exit code. With no flag: one tab-separated line
 *   per name (`name`, `kind`, `declaredIn`, `exportedBy`) on stdout, one
 *   line per problem and dynamic import on stderr, exit 0. `--json`: the
 *   reading as `stableJson`. `--entry`: the facade entry, exit 1 with the
 *   problems on stderr when any exists. `--commands`: the commands entry,
 *   refused on the same problems. A refused argument or a package outside
 *   the rules is exit 1 with the message on stderr.
 */
export function main(root: string, args: readonly string[], options: FacadeOptions = {}): FacadeRun {
  let parsed: FacadeArgs;
  let reading: FacadeReading;
  try {
    parsed = parseFacadeArgs(args);
    reading = readFacadeNames(root, parsed.pkg, options);
  } catch (error) {
    return { exitCode: 1, stderr: [(error as Error).message], stdout: [] };
  }
  const problems = reading.problems.map((problem) => `problem\t${renderProblem(problem)}`);
  const dynamics = reading.dynamicImports.map((item) => `dynamic-import\t${item.importer}\t${item.target}`);
  if (parsed.mode === 'json') {
    return { exitCode: 0, stderr: [], stdout: [stableJson(reading).trimEnd()] };
  }
  if (parsed.mode === 'entry' || parsed.mode === 'commands') {
    const render = parsed.mode === 'entry'
      ? renderFacadeEntry
      : renderCommandsEntry;
    return problems.length > 0
      ? { exitCode: 1, stderr: problems, stdout: [] }
      : { exitCode: 0, stderr: [], stdout: [render(reading, facadeFolder(parsed.pkg)).trimEnd()] };
  }
  const lines = reading.names.map((name) => [name.name, name.kind, name.declaredIn, name.exportedBy].join('\t'));
  return { exitCode: 0, stderr: [...problems, ...dynamics], stdout: lines };
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
