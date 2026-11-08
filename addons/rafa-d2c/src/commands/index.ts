/**
 * The commands entry the manifest names: every verb of the visual
 * baselines, each routed by its action under
 * `rafa module exec @open-tomato/rafa-d2c <action>`.
 */
import type { RafaCommand } from '@open-tomato/rafa-core/core/command';

import { checkCommand } from './check.js';
import { seedCommand } from './seed.js';

const commands: RafaCommand[] = [checkCommand, seedCommand];

export default commands;
