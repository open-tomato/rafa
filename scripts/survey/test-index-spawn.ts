/**
 * The spawn reading of the test index: whether a file's text spawns a
 * process, read from a TypeScript parse. {@link spawnApis} names each
 * spawning call or import it finds; what counts as one, and how a
 * spawning test's index is counted, is the module note's paragraph on
 * spawning in `test-index.ts`, where the rule is applied. Every mode
 * reads it: `computeTestIndex` calls it on each test and support file
 * the survey, the record and the guard index.
 */

import ts from 'typescript';

const SPAWNING_MEMBERS: ReadonlySet<string> = new Set(['$', 'spawn', 'spawnSync']);
const CHILD_PROCESS: ReadonlySet<string> = new Set(['child_process', 'node:child_process']);

/**
 * Whether an import declaration brings in a binding that runs: not
 * `import type`, and not a named list whose every element is `type`.
 *
 * @param node - An import declaration.
 * @returns `true` when the import survives to run time.
 */
function importsValue(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) {
    return true;
  }
  if (clause.isTypeOnly) {
    return false;
  }
  const bindings = clause.namedBindings;
  if (clause.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings)) {
    return true;
  }
  return bindings.elements.length === 0 || bindings.elements.some((element) => !element.isTypeOnly);
}

/**
 * The spawning call or import a node is, if it is one.
 *
 * @param node - Any node of a parsed source file.
 * @returns How it spawns (`Bun.spawn`, `node:child_process`, …), or `undefined`.
 */
function spawnApiOf(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'Bun'
    && SPAWNING_MEMBERS.has(node.name.text)) {
    return `Bun.${node.name.text}`;
  }
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !importsValue(node)) {
    return undefined;
  }
  const module = node.moduleSpecifier.text;
  if (CHILD_PROCESS.has(module)) {
    return module;
  }
  const bindings = node.importClause?.namedBindings;
  const importsDollar = bindings !== undefined
    && ts.isNamedImports(bindings)
    && bindings.elements.some((element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === '$');
  return module === 'bun' && importsDollar
    ? '$ from bun'
    : undefined;
}

/**
 * The ways a source text spawns a process, read from a TypeScript parse.
 *
 * @param path - The file's path, which picks the parser's script kind.
 * @param text - The file's source text.
 * @returns Each spawning call or import found, sorted, without duplicates.
 */
export function spawnApis(path: string, text: string): string[] {
  const kind = /\.(?:js|mjs)$/.test(path)
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    const api = spawnApiOf(node);
    if (api !== undefined) {
      found.add(api);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found].sort();
}

