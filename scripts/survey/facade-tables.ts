/**
 * The facade tables (#808, pass 3): what each `packages/rafa-<name>/index.ts`
 * re-exports and from where, and what an importer takes from one
 * specifier. The survey reads an import through a facade with both: each
 * name the importer takes is looked up in the entry's table, and the edge
 * goes to the file that name is re-exported from.
 *
 * {@link parseFacadeEntry} parses an entry's text with
 * `ts.createSourceFile`. Each `export { a, b as c, default as d } from './x.js'`
 * and `export type { … } from` gives one {@link FacadeRow} per exported
 * name: the name the entry exports, the file the specifier resolves to
 * (repository-relative), the name it is taken under there (`default` for
 * `default as d`) and the kind, `type` when the statement or the element
 * carries `type`, else `value`. The facade form of pass 2 holds nothing
 * else, so any other statement is refused by name ({@link FacadeRefusal}):
 * an `export *`, a local declaration, a side-effect import, any other
 * import, a local `export { … }` with no specifier, a specifier that
 * resolves to nothing, or a name exported twice.
 *
 * {@link readFacadeBindings} reads the `import` and `export … from`
 * statements of an importer's text that name one specifier, and gives one
 * {@link FacadeBinding} per name taken. A side-effect import takes no
 * name; a dynamic `import()` is not read here.
 *
 * {@link readFacadeTables} reads every `packages/rafa-*\/index.ts` under a
 * root, and beside it the member's commands entry, `commands.ts`, where
 * one exists, into a map keyed by entry path, resolving each specifier
 * with bun from the entry's folder. The commands entry is the package's
 * second entry, `@open-tomato/rafa-<name>/commands`, which carries the
 * feature object alone; it is parsed under the same facade form.
 * {@link facadeEntryOf} names which of the two an entry path is.
 */

import type { EdgeKind, ResolveImport } from './import-graph';

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

import ts from 'typescript';

/** The folder whose `rafa-*` members are facades. */
const PACKAGES_DIR = 'packages';

/** The prefix of a facade member's folder name. */
const FACADE_PREFIX = 'rafa-';

/** The two entries a member may hold: its facade and its commands entry. */
export type FacadeEntryKind = 'commands' | 'index';

/** The file of a member that is each entry. */
const ENTRY_FILES: Readonly<Record<FacadeEntryKind, string>> = {
  commands: 'commands.ts',
  index: 'index.ts',
};

/** The entries, in the path order of their files. */
const ENTRY_KINDS: readonly FacadeEntryKind[] = ['commands', 'index'];

/**
 * Which entry a repository-relative path is: `commands` for
 * `packages/rafa-<name>/commands.ts`, `index` for
 * `packages/rafa-<name>/index.ts`.
 *
 * @param path - A repository-relative path, with `/`.
 * @returns The entry, or `undefined` for any other path.
 */
export function facadeEntryOf(path: string): FacadeEntryKind | undefined {
  const parts = path.split('/');
  if (parts.length !== 3 || parts[0] !== PACKAGES_DIR || !parts[1]!.startsWith(FACADE_PREFIX)) {
    return undefined;
  }
  return ENTRY_KINDS.find((kind) => ENTRY_FILES[kind] === parts[2]);
}

/** One name an entry re-exports. */
export interface FacadeRow {
  /** The name the entry exports. */
  readonly name: string;
  /** The repository-relative file the entry re-exports it from. */
  readonly source: string;
  /** The name it is taken under in `source`: the exported name, or `default`. */
  readonly sourceName: string;
  /** `type` when the statement or the element carries `type`, else `value`. */
  readonly kind: EdgeKind;
}

/** Every entry's rows, keyed by the repository-relative entry path. */
export type FacadeTables = ReadonlyMap<string, readonly FacadeRow[]>;

/** What an entry holds that a facade may not, by name. */
export type FacadeRefusal =
  | 'duplicate name'
  | 'export *'
  | 'import'
  | 'local declaration'
  | 'local export'
  | 'side-effect import'
  | 'statement'
  | 'unresolved source';

/** Thrown by {@link parseFacadeEntry} on an entry that is not of the facade form. */
export class FacadeEntryError extends Error {
  /** The repository-relative entry path. */
  readonly entry: string;
  /** The 1-based line of the refused statement. */
  readonly line: number;
  /** What the statement is. */
  readonly refusal: FacadeRefusal;

  /**
   * @param entry - The repository-relative entry path.
   * @param line - The 1-based line of the refused statement.
   * @param refusal - What the statement is.
   * @param detail - What it names, such as the specifier or the name.
   */
  constructor(entry: string, line: number, refusal: FacadeRefusal, detail: string) {
    super(`${entry}:${line}: a facade entry holds re-exports only, not ${refusal} (${detail})`);
    this.name = 'FacadeEntryError';
    this.entry = entry;
    this.line = line;
    this.refusal = refusal;
  }
}

/** A name an importer takes from a specifier by name, `default` included. */
export interface FacadeNamedBinding {
  readonly shape: 'named';
  /** The name taken from the specifier: the exported name, or `default`. */
  readonly name: string;
  /** The name the importer binds it to, or re-exports it as. */
  readonly local: string;
  /** `type` when the statement or the binding carries `type`, else `value`. */
  readonly kind: EdgeKind;
}

/** A namespace taken whole: `import * as n` or `export * as n`. */
export interface FacadeNamespaceBinding {
  readonly shape: 'namespace';
  /** The namespace's local or exported name. */
  readonly local: string;
  /** `type` when the statement carries `type`, else `value`. */
  readonly kind: EdgeKind;
}

/** Every name re-exported unnamed: `export * from`. */
export interface FacadeStarBinding {
  readonly shape: 'star';
  /** `type` when the statement carries `type`, else `value`. */
  readonly kind: EdgeKind;
}

/** One binding an importer takes from one specifier. */
export type FacadeBinding = FacadeNamedBinding | FacadeNamespaceBinding | FacadeStarBinding;

/** The kind of a statement or element by whether it carries `type`. */
function kindOf(typeOnly: boolean): EdgeKind {
  return typeOnly
    ? 'type'
    : 'value';
}

/** The 1-based line a node starts on. */
function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** The text of a module specifier, or `undefined` when it is not a string literal. */
function specifierText(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteral(node)
    ? node.text
    : undefined;
}

/** What a statement that is not a named re-export is, for the refusal. */
function refusalOf(statement: ts.Statement): FacadeRefusal {
  if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
    return ts.isImportDeclaration(statement) && statement.importClause === undefined
      ? 'side-effect import'
      : 'import';
  }
  if (ts.isExportDeclaration(statement)) {
    return statement.exportClause === undefined || ts.isNamespaceExport(statement.exportClause)
      ? 'export *'
      : 'local export';
  }
  if (ts.isExpressionStatement(statement) || ts.isEmptyStatement(statement) || ts.isBlock(statement)) {
    return 'statement';
  }
  return 'local declaration';
}

/**
 * Parses a facade entry into its rows, one per re-exported name, in source
 * order.
 *
 * @param text - The entry's source text.
 * @param entryPath - The entry's repository-relative path, which
 *   specifiers are resolved from and refusals are named by.
 * @param resolve - Resolves a specifier from the entry to a
 *   repository-relative path.
 * @returns The rows.
 * @throws FacadeEntryError on a statement that is not a named re-export, a
 *   specifier that resolves to nothing, or a name exported twice.
 */
export function parseFacadeEntry(text: string, entryPath: string, resolve: ResolveImport): FacadeRow[] {
  const source = ts.createSourceFile(entryPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rows: FacadeRow[] = [];
  const seen = new Set<string>();
  for (const statement of source.statements) {
    const specifier = ts.isExportDeclaration(statement)
      ? specifierText(statement.moduleSpecifier)
      : undefined;
    const clause = ts.isExportDeclaration(statement)
      ? statement.exportClause
      : undefined;
    if (!ts.isExportDeclaration(statement) || specifier === undefined || clause === undefined || !ts.isNamedExports(clause)) {
      throw new FacadeEntryError(entryPath, lineOf(source, statement), refusalOf(statement), statement.getText(source).split('\n')[0] ?? '');
    }
    const target = resolve(specifier, entryPath);
    if (target === undefined) {
      throw new FacadeEntryError(entryPath, lineOf(source, statement), 'unresolved source', specifier);
    }
    for (const element of clause.elements) {
      const name = element.name.text;
      if (seen.has(name)) {
        throw new FacadeEntryError(entryPath, lineOf(source, element), 'duplicate name', name);
      }
      seen.add(name);
      rows.push({
        kind: kindOf(statement.isTypeOnly || element.isTypeOnly),
        name,
        source: target,
        sourceName: (element.propertyName ?? element.name).text,
      });
    }
  }
  return rows;
}

/** The bindings of one import declaration's clause. */
function importBindings(clause: ts.ImportClause): FacadeBinding[] {
  const bindings: FacadeBinding[] = [];
  if (clause.name !== undefined) {
    bindings.push({ kind: kindOf(clause.isTypeOnly), local: clause.name.text, name: 'default', shape: 'named' });
  }
  const named = clause.namedBindings;
  if (named !== undefined && ts.isNamespaceImport(named)) {
    bindings.push({ kind: kindOf(clause.isTypeOnly), local: named.name.text, shape: 'namespace' });
  } else if (named !== undefined) {
    for (const element of named.elements) {
      bindings.push({
        kind: kindOf(clause.isTypeOnly || element.isTypeOnly),
        local: element.name.text,
        name: (element.propertyName ?? element.name).text,
        shape: 'named',
      });
    }
  }
  return bindings;
}

/** The bindings of one `export … from` declaration. */
function exportBindings(statement: ts.ExportDeclaration): FacadeBinding[] {
  const clause = statement.exportClause;
  if (clause === undefined) {
    return [{ kind: kindOf(statement.isTypeOnly), shape: 'star' }];
  }
  if (ts.isNamespaceExport(clause)) {
    return [{ kind: kindOf(statement.isTypeOnly), local: clause.name.text, shape: 'namespace' }];
  }
  return clause.elements.map((element) => ({
    kind: kindOf(statement.isTypeOnly || element.isTypeOnly),
    local: element.name.text,
    name: (element.propertyName ?? element.name).text,
    shape: 'named' as const,
  }));
}

/**
 * The bindings an importer's text takes from one specifier, over every
 * `import` and `export … from` statement that names it, in source order.
 *
 * @param text - The importer's source text.
 * @param specifier - The specifier as written, such as
 *   `@open-tomato/rafa-effort`.
 * @returns The bindings; empty when no statement names the specifier or
 *   the only ones are side-effect imports.
 */
export function readFacadeBindings(text: string, specifier: string): FacadeBinding[] {
  const source = ts.createSourceFile('importer.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const bindings: FacadeBinding[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && specifierText(statement.moduleSpecifier) === specifier) {
      bindings.push(...(statement.importClause === undefined
        ? []
        : importBindings(statement.importClause)));
    } else if (ts.isExportDeclaration(statement) && specifierText(statement.moduleSpecifier) === specifier) {
      bindings.push(...exportBindings(statement));
    }
  }
  return bindings;
}

/**
 * A resolver from an entry under `root` that asks bun and returns a
 * repository-relative path, each side brought to its real path first.
 *
 * @param root - The repository root.
 * @returns The resolver.
 */
function entryResolver(root: string): ResolveImport {
  const realRoot = realpathSync.native(root);
  return (specifier, from) => {
    try {
      const resolved = Bun.resolveSync(specifier, dirname(join(root, from)));
      if (!resolved.startsWith('/')) {
        return resolved;
      }
      const real = realpathSync.native(resolved);
      return real.startsWith(`${realRoot}/`)
        ? real.slice(realRoot.length + 1)
        : real;
    } catch {
      return undefined;
    }
  };
}

/**
 * Reads every facade entry of a tree, `packages/rafa-*\/index.ts`, and each
 * commands entry beside one, `packages/rafa-*\/commands.ts`, and parses
 * each with {@link parseFacadeEntry}.
 *
 * @param root - The repository root.
 * @returns The rows of each entry, keyed by entry path, in path order (a
 *   member's commands entry before its index); empty when the tree has no
 *   `packages/` folder.
 * @throws FacadeEntryError on an entry that is not of the facade form.
 */
export function readFacadeTables(root: string): Map<string, FacadeRow[]> {
  const tables = new Map<string, FacadeRow[]>();
  const packagesDir = join(root, PACKAGES_DIR);
  if (!existsSync(packagesDir)) {
    return tables;
  }
  const resolve = entryResolver(root);
  const members = readdirSync(packagesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory() && dirent.name.startsWith(FACADE_PREFIX))
    .map((dirent) => dirent.name)
    .sort();
  for (const member of members) {
    for (const kind of ENTRY_KINDS) {
      const entryPath = `${PACKAGES_DIR}/${member}/${ENTRY_FILES[kind]}`;
      const absolute = join(root, entryPath);
      if (existsSync(absolute)) {
        tables.set(entryPath, parseFacadeEntry(readFileSync(absolute, 'utf8'), entryPath, resolve));
      }
    }
  }
  return tables;
}
