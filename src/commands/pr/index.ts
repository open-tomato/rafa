/**
 * The `pr` feature: the `pr` subject and its ten commands, each made by
 * `lazyCommand` over its declaration in `declarations.ts` and a dynamic
 * import of its module.
 *
 * Importing this file loads `declarations.ts` and the core command
 * barrel, and no command module: a command's module is imported when
 * the command runs, and the module loader's cache answers a second run.
 * A load that rejects, or a module whose default export is not the
 * declared command, refuses with exit 1 naming the feature, `pr`, and
 * the command (`packages/rafa/src/core/command/lazy.ts`).
 *
 * The commands are in roster order, the order `createRosterRegistry`
 * (`src/commands/index.ts`) registers them in. `index-integration.test.ts` holds
 * each one's spelling to its declaration's, and each loaded module's
 * command to its declaration.
 */
import type { CommandFeature } from '@open-tomato/rafa/core/command';

import { lazyCommand } from '@open-tomato/rafa/core/command';

import {
  PR_CLOSE_DECLARATION,
  PR_CURRENT_DECLARATION,
  PR_LIST_DECLARATION,
  PR_MERGE_DECLARATION,
  PR_OPEN_DECLARATION,
  PR_RETARGET_DECLARATION,
  PR_SHOW_DECLARATION,
  PR_SUBJECT,
  PR_TRIAGE_DECLARATION,
  PR_VIEW_DECLARATION,
  PR_WAIT_DECLARATION,
} from './declarations.js';

/** The feature's name, which a load failure of one of its commands names. */
const FEATURE_NAME = 'pr';

/** The `pr` feature: its subject and its ten lazy commands, in roster order. */
export const PR_FEATURE: CommandFeature = Object.freeze({
  name: FEATURE_NAME,
  subjects: Object.freeze([PR_SUBJECT]),
  commands: Object.freeze([
    lazyCommand(PR_CURRENT_DECLARATION, () => import('./current.js'), FEATURE_NAME),
    lazyCommand(PR_SHOW_DECLARATION, () => import('./show.js'), FEATURE_NAME),
    lazyCommand(PR_VIEW_DECLARATION, () => import('./view.js'), FEATURE_NAME),
    lazyCommand(PR_OPEN_DECLARATION, () => import('./open.js'), FEATURE_NAME),
    lazyCommand(PR_RETARGET_DECLARATION, () => import('./retarget.js'), FEATURE_NAME),
    lazyCommand(PR_CLOSE_DECLARATION, () => import('./close.js'), FEATURE_NAME),
    lazyCommand(PR_LIST_DECLARATION, () => import('./list.js'), FEATURE_NAME),
    lazyCommand(PR_WAIT_DECLARATION, () => import('./wait.js'), FEATURE_NAME),
    lazyCommand(PR_MERGE_DECLARATION, () => import('./merge.js'), FEATURE_NAME),
    lazyCommand(PR_TRIAGE_DECLARATION, () => import('./triage.js'), FEATURE_NAME),
  ]),
});
