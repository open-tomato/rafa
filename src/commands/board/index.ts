/**
 * The `board` feature: the `issue`, `board` and `epic` subjects and
 * their eighteen commands, each made by `lazyCommand` over its
 * declaration (`../issue/declarations.ts`, `./declarations.ts`,
 * `../epic/declarations.ts`) and a dynamic import of its module.
 *
 * Importing this file loads the three declaration files and the core
 * command barrel, and no command module: a command's module is imported
 * when the command runs, and the module loader's cache answers a second
 * run. A load that rejects, or a module whose default export is not the
 * declared command, refuses with exit 1 naming the feature, `board`, and
 * the command (`packages/rafa/src/core/command/lazy.ts`).
 *
 * The subjects and the commands are in roster order, the order
 * `ROSTER_SUBJECTS` lists the subjects in and `createRosterRegistry`
 * (`src/commands/index.ts`) registers the commands in. `index-integration.test.ts`
 * holds each command's spelling to its declaration's, and each loaded
 * module's command to its declaration.
 */
import type { CommandFeature } from '@open-tomato/rafa/core/command';

import { lazyCommand } from '@open-tomato/rafa/core/command';

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

/** The feature's name, which a load failure of one of its commands names. */
const FEATURE_NAME = 'board';

/** The `board` feature: its three subjects and its eighteen lazy commands, in roster order. */
export const BOARD_FEATURE: CommandFeature = Object.freeze({
  name: FEATURE_NAME,
  subjects: Object.freeze([ISSUE_SUBJECT, BOARD_SUBJECT, EPIC_SUBJECT]),
  commands: Object.freeze([
    lazyCommand(ISSUE_LIST_DECLARATION, () => import('../issue/list.js'), FEATURE_NAME),
    lazyCommand(ISSUE_SHOW_DECLARATION, () => import('../issue/show.js'), FEATURE_NAME),
    lazyCommand(ISSUE_CREATE_DECLARATION, () => import('../issue/create.js'), FEATURE_NAME),
    lazyCommand(ISSUE_COMMENT_DECLARATION, () => import('../issue/comment.js'), FEATURE_NAME),
    lazyCommand(ISSUE_MOVE_DECLARATION, () => import('../issue/move.js'), FEATURE_NAME),
    lazyCommand(ISSUE_READY_DECLARATION, () => import('../issue/ready.js'), FEATURE_NAME),
    lazyCommand(ISSUE_UNBLOCK_DECLARATION, () => import('../issue/unblock.js'), FEATURE_NAME),
    lazyCommand(ISSUE_CHECK_DECLARATION, () => import('../issue/check.js'), FEATURE_NAME),
    lazyCommand(ISSUE_EDIT_DECLARATION, () => import('../issue/edit.js'), FEATURE_NAME),
    lazyCommand(BOARD_LIST_DECLARATION, () => import('./list.js'), FEATURE_NAME),
    lazyCommand(BOARD_SYNC_DECLARATION, () => import('./sync.js'), FEATURE_NAME),
    lazyCommand(EPIC_SHOW_DECLARATION, () => import('../epic/show.js'), FEATURE_NAME),
    lazyCommand(EPIC_NEW_DECLARATION, () => import('../epic/new.js'), FEATURE_NAME),
    lazyCommand(EPIC_DEFER_DECLARATION, () => import('../epic/defer.js'), FEATURE_NAME),
    lazyCommand(EPIC_PROMOTE_DECLARATION, () => import('../epic/promote.js'), FEATURE_NAME),
    lazyCommand(EPIC_MOVE_DECLARATION, () => import('../epic/move.js'), FEATURE_NAME),
    lazyCommand(EPIC_CLOSE_DECLARATION, () => import('../epic/close.js'), FEATURE_NAME),
    lazyCommand(EPIC_CANCEL_DECLARATION, () => import('../epic/cancel.js'), FEATURE_NAME),
  ]),
});
