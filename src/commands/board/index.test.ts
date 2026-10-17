/**
 * `BOARD_FEATURE` source: the `issue`, `board` and `epic` subjects and their eighteen lazy commands, read off `index.ts` as text through the
 * TypeScript parser.
 *
 * The static imports of `index.ts` are read off its source, so a command
 * module imported by value, which would load with the roster, goes red;
 * and each `lazyCommand` call is read off it too, so a loader importing
 * another command's module goes red, with a planted call as the control.
 *
 * The cases over `BOARD_FEATURE` and the loading of each command module are in
 * `index-integration.test.ts` beside this file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The same pairs as `index.ts` must spell them: each module beside the name of its declaration. */
const LOADED_AS: readonly (readonly [string, string])[] = [
  ['../issue/list.js', 'ISSUE_LIST_DECLARATION'],
  ['../issue/show.js', 'ISSUE_SHOW_DECLARATION'],
  ['../issue/create.js', 'ISSUE_CREATE_DECLARATION'],
  ['../issue/comment.js', 'ISSUE_COMMENT_DECLARATION'],
  ['../issue/move.js', 'ISSUE_MOVE_DECLARATION'],
  ['../issue/ready.js', 'ISSUE_READY_DECLARATION'],
  ['../issue/unblock.js', 'ISSUE_UNBLOCK_DECLARATION'],
  ['../issue/check.js', 'ISSUE_CHECK_DECLARATION'],
  ['../issue/edit.js', 'ISSUE_EDIT_DECLARATION'],
  ['./list.js', 'BOARD_LIST_DECLARATION'],
  ['./sync.js', 'BOARD_SYNC_DECLARATION'],
  ['../epic/show.js', 'EPIC_SHOW_DECLARATION'],
  ['../epic/new.js', 'EPIC_NEW_DECLARATION'],
  ['../epic/defer.js', 'EPIC_DEFER_DECLARATION'],
  ['../epic/promote.js', 'EPIC_PROMOTE_DECLARATION'],
  ['../epic/move.js', 'EPIC_MOVE_DECLARATION'],
  ['../epic/close.js', 'EPIC_CLOSE_DECLARATION'],
  ['../epic/cancel.js', 'EPIC_CANCEL_DECLARATION'],
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

describe('BOARD_FEATURE source', () => {
  it('hands each lazy command the loader of its own module, read off the source', () => {
    expect(lazyCalls(readFileSync(join(HERE, 'index.ts'), 'utf8'))).toEqual(LOADED_AS);
  });

  it('reads a planted call whose loader imports another module as that mismatch, the control', () => {
    const planted = 'lazyCommand(BOARD_LIST_DECLARATION, () => import(\'./sync.js\'), FEATURE_NAME);';

    expect(lazyCalls(planted)).toEqual([['./sync.js', 'BOARD_LIST_DECLARATION']]);
    expect(lazyCalls(planted)).not.toEqual([LOADED_AS[9]]);
  });

  it('imports no command module statically, only the core barrel and the three declaration files', () => {
    expect(staticImports(join(HERE, 'index.ts'))).toEqual([
      '@open-tomato/rafa/core/command',
      '@open-tomato/rafa/core/command',
      '../epic/declarations.js',
      '../issue/declarations.js',
      './declarations.js',
    ]);
  });

  it('reads in board/declarations.ts a single import, a type from the core command barrel', () => {
    expect(staticImports(join(HERE, 'declarations.ts'))).toEqual(['@open-tomato/rafa/core/command']);
  });
});
