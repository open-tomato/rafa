/**
 * The package entry exports the names a file outside this package
 * imports from the port, and no other: every name the entry lists is
 * one `src/port.ts` declares and one some importer under `packages/`
 * takes, by the package name or through the hub's re-export alias
 * `packages/rafa-hub/src/store/port.ts`; every name such an importer
 * takes is one the entry lists; and the alias re-exports the entry's
 * names, every one of them.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

/** This package's directory. */
const PACKAGE_DIR = import.meta.dir;

/** The `packages/` directory holding every workspace member. */
const PACKAGES_DIR = resolve(PACKAGE_DIR, '..');

/** The hub's re-export alias of this package. */
const ALIAS_FILE = join(PACKAGES_DIR, 'rafa-hub', 'src', 'store', 'port.ts');

/** This package's name, as an importer names it. */
const PACKAGE_NAME = '@open-tomato/rafa-hub-port';

/** The folders the importer walk never enters. */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['node_modules', '.tsbuild', '.turbo', 'dist']);

/**
 * Parses a TypeScript file.
 *
 * @param file - The absolute path.
 * @returns The source file.
 */
function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

/**
 * The names the `export … from` statements of a file re-export.
 *
 * @param file - The absolute path.
 * @returns The exported names, sorted.
 */
function reExportedNames(file: string): string[] {
  return parse(file).statements
    .filter(ts.isExportDeclaration)
    .flatMap((statement) => statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map((element) => element.name.text)
      : [])
    .sort();
}

/**
 * The names a file declares with `export interface` or `export type`.
 *
 * @param file - The absolute path.
 * @returns The declared names, sorted.
 */
function declaredNames(file: string): string[] {
  const isExportedDeclaration = (statement: ts.Statement): statement is ts.InterfaceDeclaration | ts.TypeAliasDeclaration => {
    const declares = ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
    return declares && (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0;
  };
  return parse(file).statements
    .filter(isExportedDeclaration)
    .map((statement) => statement.name.text)
    .sort();
}

/**
 * Every `.ts` file under a directory, skipped folders left out.
 *
 * @param dir - The absolute directory.
 * @returns The absolute paths.
 */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_FOLDERS.has(entry.name)
        ? []
        : tsFiles(join(dir, entry.name));
    }
    return entry.name.endsWith('.ts')
      ? [join(dir, entry.name)]
      : [];
  });
}

/**
 * Whether an import specifier in a file names this package or the alias.
 *
 * @param file - The importing file's absolute path.
 * @param specifier - The import's module specifier.
 * @returns True for the package name, or a relative path to the alias.
 */
function namesPort(file: string, specifier: string): boolean {
  if (specifier === PACKAGE_NAME) {
    return true;
  }
  return specifier.startsWith('.')
    && resolve(dirname(file), specifier.replace(/\.js$/, '.ts')) === ALIAS_FILE;
}

/**
 * The names every file under `packages/` outside this package imports
 * from the port.
 *
 * @returns The imported names, each once, sorted.
 */
function importedNames(): string[] {
  const files = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && join(PACKAGES_DIR, entry.name) !== PACKAGE_DIR)
    .flatMap((entry) => tsFiles(join(PACKAGES_DIR, entry.name)));
  const names = files.flatMap((file) => parse(file).statements
    .filter(ts.isImportDeclaration)
    .filter((statement) => ts.isStringLiteral(statement.moduleSpecifier) && namesPort(file, statement.moduleSpecifier.text))
    .flatMap((statement) => {
      const bindings = statement.importClause?.namedBindings;
      return bindings !== undefined && ts.isNamedImports(bindings)
        ? bindings.elements.map((element) => (element.propertyName ?? element.name).text)
        : [];
    }));
  return [...new Set(names)].sort();
}

const ENTRY = join(PACKAGE_DIR, 'index.ts');
const PORT = join(PACKAGE_DIR, 'src', 'port.ts');

describe('the package entry', () => {
  it('exports twenty-two names, each one the port declares', () => {
    const exported = reExportedNames(ENTRY);
    expect(exported).toHaveLength(22);
    expect(exported.filter((name) => !declaredNames(PORT).includes(name))).toEqual([]);
  });

  it('leaves out the four names no importer takes', () => {
    const left = declaredNames(PORT).filter((name) => !reExportedNames(ENTRY).includes(name));
    expect(left).toEqual(['HubEmbedding', 'IndexLink', 'IndexOriginPair', 'IndexTableRows']);
  });

  it('exports exactly the names the importers under packages/ take', () => {
    expect(reExportedNames(ENTRY)).toEqual(importedNames());
  });

  it('reads an import through the alias as an import of the port', () => {
    const importer = join(PACKAGES_DIR, 'rafa-hub', 'src', 'server.ts');
    expect(existsSync(importer)).toBe(true);
    expect(namesPort(importer, './store/port.js')).toBe(true);
    expect(namesPort(importer, './identity/port.js')).toBe(false);
  });
});

describe('the hub alias', () => {
  it('re-exports the entry\'s names, every one of them', () => {
    expect(reExportedNames(ALIAS_FILE)).toEqual(reExportedNames(ENTRY));
  });

  it('declares nothing of its own', () => {
    expect(declaredNames(ALIAS_FILE)).toEqual([]);
  });
});
