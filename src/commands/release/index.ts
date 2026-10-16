/**
 * The `release` feature: the `release` subject and its three commands,
 * each made by `lazyCommand` over its declaration in `declarations.ts`
 * and a dynamic import of its module.
 *
 * Importing this file loads `declarations.ts` and the core command
 * barrel, and no command module: a command's module is imported when
 * the command runs, and the module loader's cache answers a second run.
 * A load that rejects, or a module whose default export is not the
 * declared command, refuses with exit 1 naming the feature, `release`,
 * and the command (`packages/rafa/src/core/command/lazy.ts`).
 *
 * The commands are in roster order, the order `CORE_COMMANDS`
 * (`src/commands/index.ts`) lists them in. `index.test.ts` holds each
 * one's spelling to its declaration's, and each loaded module's command
 * to its declaration.
 */
import type { CommandFeature } from '@open-tomato/rafa/core/command';

import { lazyCommand } from '@open-tomato/rafa/core/command';

import {
  RELEASE_SETTLE_DECLARATION,
  RELEASE_STATUS_DECLARATION,
  RELEASE_SUBJECT,
  RELEASE_TAG_DECLARATION,
} from './declarations.js';

/** The feature's name, which a load failure of one of its commands names. */
const FEATURE_NAME = 'release';

/** The `release` feature: the `release` subject and its three lazy commands, in roster order. */
export const RELEASE_FEATURE: CommandFeature = Object.freeze({
  name: FEATURE_NAME,
  subjects: Object.freeze([RELEASE_SUBJECT]),
  commands: Object.freeze([
    lazyCommand(RELEASE_STATUS_DECLARATION, () => import('./status.js'), FEATURE_NAME),
    lazyCommand(RELEASE_SETTLE_DECLARATION, () => import('./settle.js'), FEATURE_NAME),
    lazyCommand(RELEASE_TAG_DECLARATION, () => import('./tag.js'), FEATURE_NAME),
  ]),
});
