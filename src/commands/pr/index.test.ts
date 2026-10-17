/**
 * `PR_FEATURE` source: the `pr` subject and its ten lazy commands, read off `index.ts` as text through the
 * TypeScript parser.
 *
 * The static imports of `index.ts` are read off its source, so a command
 * module imported by value, which would load with the roster, goes red.
 *
 * The cases over `PR_FEATURE` and the loading of each command module are in
 * `index-integration.test.ts` beside this file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));

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

describe('PR_FEATURE source', () => {
  it('imports no command module statically, only the core barrel and the declarations', () => {
    expect(staticImports(join(HERE, 'index.ts'))).toEqual([
      '@open-tomato/rafa/core/command',
      '@open-tomato/rafa/core/command',
      './declarations.js',
    ]);
  });
});
