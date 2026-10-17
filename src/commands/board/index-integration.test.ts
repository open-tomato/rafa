/**
 * `BOARD_FEATURE`: the `issue`, `board` and `epic` subjects and their eighteen lazy commands, each spelled
 * as its declaration, in roster order, over a module whose command is
 * that declaration under a `run`.
 *
 * These cases import `index.ts` and the declarations, and so reach core's
 * command types; the cases that read the source of `index.ts` stay in
 * `index.test.ts` beside this file.
 */
import type { CommandDeclaration, RafaCommand } from '@open-tomato/rafa/core/command';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

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

  it.each(DECLARED)('loads from %s the command its declaration spells, that declaration under a run', async (path, declaration) => {
    const loaded = await import(join(HERE, path)) as { default: RafaCommand };

    expect(commandSpelling(loaded.default)).toBe(commandSpelling(declaration));
    expect(lessRun(loaded.default)).toEqual(declaration);
  });
});
