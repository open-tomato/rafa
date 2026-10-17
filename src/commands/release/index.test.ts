/**
 * `RELEASE_FEATURE` source: the `release` subject and its three lazy
 * commands, read off `index.ts` as text through the TypeScript parser.
 *
 * The static imports of `index.ts` are read off its source, so a command
 * module imported by value, which would load with the roster, goes red;
 * and each `lazyCommand` call is read off it too, so a loader importing
 * another command's module goes red, with a planted call as the control.
 *
 * The cases over `RELEASE_FEATURE` and the loading of each command module
 * are in `index-integration.test.ts` beside this file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The same pairs as `index.ts` must spell them: each module beside the name of its declaration. */
const LOADED_AS: readonly (readonly [string, string])[] = [
  ['./status.js', 'RELEASE_STATUS_DECLARATION'],
  ['./settle.js', 'RELEASE_SETTLE_DECLARATION'],
  ['./tag.js', 'RELEASE_TAG_DECLARATION'],
];

/**
 * The specifiers of a source's static import declarations, in order.
 *
 * @param path - The source file.
 * @returns Each `import … from` specifier, `import type` included.
 */
function staticImports(path: string): readonly string[] {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
  return source.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);
}

/**
 * Each `lazyCommand` call of a source: the module its loader imports
 * beside the name of the declaration it is given.
 *
 * @param text - The source text.
 * @returns One pair per call, in source order.
 */
function lazyCalls(text: string): readonly (readonly [string, string])[] {
  const calls: (readonly [string, string])[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'lazyCommand') {
      const [declaration, load] = node.arguments;
      const loaded = load !== undefined && ts.isArrowFunction(load) && ts.isCallExpression(load.body)
        ? load.body.arguments[0]
        : undefined;
      const specifier = loaded !== undefined && ts.isStringLiteral(loaded)
        ? loaded.text
        : '';
      const name = declaration !== undefined && ts.isIdentifier(declaration)
        ? declaration.text
        : '';
      calls.push([specifier, name]);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest));
  return calls;
}

describe('RELEASE_FEATURE source', () => {
  it('hands each lazy command the loader of its own module, read off the source', () => {
    expect(lazyCalls(readFileSync(join(HERE, 'index.ts'), 'utf8'))).toEqual(LOADED_AS);
  });

  it('reads a planted call whose loader imports another module as that mismatch, the control', () => {
    const planted = 'lazyCommand(RELEASE_SETTLE_DECLARATION, () => import(\'./tag.js\'), FEATURE_NAME);';

    expect(lazyCalls(planted)).toEqual([['./tag.js', 'RELEASE_SETTLE_DECLARATION']]);
    expect(lazyCalls(planted)).not.toEqual([LOADED_AS[1]]);
  });

  it('imports no command module statically, only the core barrel and the declarations', () => {
    expect(staticImports(join(HERE, 'index.ts'))).toEqual([
      '@open-tomato/rafa/core/command',
      '@open-tomato/rafa/core/command',
      './declarations.js',
    ]);
  });
});
