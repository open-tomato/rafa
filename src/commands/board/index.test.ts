/**
 * `BOARD_FEATURE`: the `issue`, `board` and `epic` subjects and their
 * eighteen lazy commands, each spelled as its declaration, in roster
 * order, over a module whose command is that declaration under a `run`.
 *
 * The static imports of `index.ts` are read off its source, so a command
 * module imported by value, which would load with the roster, goes red.
 */
import type { CommandDeclaration, RafaCommand } from '@open-tomato/rafa/core/command';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { commandProblem, commandSpelling } from '@open-tomato/rafa/core/command';

import {
  EPIC_CANCEL_DECLARATION,
  EPIC_CLOSE_DECLARATION,
  EPIC_DEFER_DECLARATION,
  EPIC_MOVE_DECLARATION,
  EPIC_NEW_DECLARATION,
  EPIC_PROMOTE_DECLARATION,
  EPIC_SHOW_DECLARATION,
  EPIC_SUBJECT,
} from '../epic/declarations.js';
import {
  ISSUE_CHECK_DECLARATION,
  ISSUE_COMMENT_DECLARATION,
  ISSUE_CREATE_DECLARATION,
  ISSUE_EDIT_DECLARATION,
  ISSUE_LIST_DECLARATION,
  ISSUE_MOVE_DECLARATION,
  ISSUE_READY_DECLARATION,
  ISSUE_SHOW_DECLARATION,
  ISSUE_SUBJECT,
  ISSUE_UNBLOCK_DECLARATION,
} from '../issue/declarations.js';

import { BOARD_LIST_DECLARATION, BOARD_SUBJECT, BOARD_SYNC_DECLARATION } from './declarations.js';

import { BOARD_FEATURE } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Each declaration in roster order, beside the module its command is the default export of. */
const DECLARED: readonly (readonly [string, CommandDeclaration])[] = [
  ['../issue/list.js', ISSUE_LIST_DECLARATION],
  ['../issue/show.js', ISSUE_SHOW_DECLARATION],
  ['../issue/create.js', ISSUE_CREATE_DECLARATION],
  ['../issue/comment.js', ISSUE_COMMENT_DECLARATION],
  ['../issue/move.js', ISSUE_MOVE_DECLARATION],
  ['../issue/ready.js', ISSUE_READY_DECLARATION],
  ['../issue/unblock.js', ISSUE_UNBLOCK_DECLARATION],
  ['../issue/check.js', ISSUE_CHECK_DECLARATION],
  ['../issue/edit.js', ISSUE_EDIT_DECLARATION],
  ['./list.js', BOARD_LIST_DECLARATION],
  ['./sync.js', BOARD_SYNC_DECLARATION],
  ['../epic/show.js', EPIC_SHOW_DECLARATION],
  ['../epic/new.js', EPIC_NEW_DECLARATION],
  ['../epic/defer.js', EPIC_DEFER_DECLARATION],
  ['../epic/promote.js', EPIC_PROMOTE_DECLARATION],
  ['../epic/move.js', EPIC_MOVE_DECLARATION],
  ['../epic/close.js', EPIC_CLOSE_DECLARATION],
  ['../epic/cancel.js', EPIC_CANCEL_DECLARATION],
];

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

/**
 * A command's fields less its `run`.
 *
 * @param command - The command.
 * @returns The rest of it.
 */
function lessRun(command: RafaCommand): CommandDeclaration {
  return Object.fromEntries(Object.entries(command).filter(([field]) => field !== 'run')) as CommandDeclaration;
}

describe('BOARD_FEATURE', () => {
  it('is the board feature, declaring the issue, board and epic subjects', () => {
    expect(BOARD_FEATURE.name).toBe('board');
    expect(BOARD_FEATURE.subjects).toEqual([ISSUE_SUBJECT, BOARD_SUBJECT, EPIC_SUBJECT]);
    expect(BOARD_FEATURE.subjects.map((subject) => subject.name)).toEqual(['issue', 'board', 'epic']);
  });

  it('spells each lazy command as its declaration, in roster order', () => {
    expect(BOARD_FEATURE.commands).toHaveLength(18);
    expect(BOARD_FEATURE.commands.map(commandSpelling)).toEqual(DECLARED.map(([, declaration]) => commandSpelling(declaration)));
    expect(BOARD_FEATURE.commands.map(commandSpelling)).toEqual([
      'issue list',
      'issue show',
      'issue create',
      'issue comment',
      'issue move',
      'issue ready',
      'issue unblock',
      'issue check',
      'issue edit',
      'board list',
      'board sync',
      'epic show',
      'epic new',
      'epic defer',
      'epic promote',
      'epic move',
      'epic close',
      'epic cancel',
    ]);
  });

  it('makes each command its declaration under a run of its own', () => {
    BOARD_FEATURE.commands.forEach((command, position) => {
      const [, declaration] = DECLARED[position] ?? [];

      expect(commandProblem(command)).toBeNull();
      expect(lessRun(command)).toEqual(declaration as CommandDeclaration);
    });
  });

  it('keeps the epic lasting alias of epic show on its lazy command', () => {
    const epicShow = BOARD_FEATURE.commands.find((command) => commandSpelling(command) === 'epic show');

    expect(epicShow?.lastingAliases).toEqual(['epic']);
  });

  it('hands each lazy command the loader of its own module, read off the source', () => {
    expect(lazyCalls(readFileSync(join(HERE, 'index.ts'), 'utf8'))).toEqual(LOADED_AS);
  });

  it('reads a planted call whose loader imports another module as that mismatch, the control', () => {
    const planted = 'lazyCommand(BOARD_LIST_DECLARATION, () => import(\'./sync.js\'), FEATURE_NAME);';

    expect(lazyCalls(planted)).toEqual([['./sync.js', 'BOARD_LIST_DECLARATION']]);
    expect(lazyCalls(planted)).not.toEqual([LOADED_AS[9]]);
  });

  it.each(DECLARED)('loads from %s the command its declaration spells, that declaration under a run', async (path, declaration) => {
    const loaded = await import(join(HERE, path)) as { default: RafaCommand };

    expect(commandSpelling(loaded.default)).toBe(commandSpelling(declaration));
    expect(lessRun(loaded.default)).toEqual(declaration);
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
