/**
 * The `run` feature: the `claim` subject and its four commands, each
 * made by `lazyCommand` over its declaration in `declarations.ts` and a
 * dynamic import of its module.
 *
 * Importing this file loads `declarations.ts` and the core command
 * barrel, and no command module: a command's module is imported when
 * the command runs, and the module loader's cache answers a second run.
 * A load that rejects, or a module whose default export is not the
 * declared command, refuses with exit 1 naming the feature, `run`, and
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
  CLAIM_ACCEPT_DECLARATION,
  CLAIM_HAND_DECLARATION,
  CLAIM_RELEASE_DECLARATION,
  CLAIM_SUBJECT,
  CLAIM_TAKE_DECLARATION,
} from './declarations.js';

/** The feature's name, which a load failure of one of its commands names. */
const FEATURE_NAME = 'run';

/** The `run` feature: the `claim` subject and its four lazy commands, in roster order. */
export const RUN_FEATURE: CommandFeature = Object.freeze({
  name: FEATURE_NAME,
  subjects: Object.freeze([CLAIM_SUBJECT]),
  commands: Object.freeze([
    lazyCommand(CLAIM_RELEASE_DECLARATION, () => import('./release.js'), FEATURE_NAME),
    lazyCommand(CLAIM_HAND_DECLARATION, () => import('./hand.js'), FEATURE_NAME),
    lazyCommand(CLAIM_ACCEPT_DECLARATION, () => import('./accept.js'), FEATURE_NAME),
    lazyCommand(CLAIM_TAKE_DECLARATION, () => import('./take.js'), FEATURE_NAME),
  ]),
});
