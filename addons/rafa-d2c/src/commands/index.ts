/**
 * The commands entry the manifest names: every verb of the visual
 * baselines, each routed by its action under
 * `rafa module exec @open-tomato/rafa-d2c <action>`.
 */
import type { RafaCommand } from '@open-tomato/rafa-core/core/command';

import { checkCommand } from './check.js';
import { orphansCommand } from './orphans.js';
import { placeCommand } from './place.js';
import { promoteCommand } from './promote.js';
import { runCommand } from './run.js';
import { seedCommand } from './seed.js';

const commands: RafaCommand[] = [runCommand, checkCommand, seedCommand, placeCommand, promoteCommand, orphansCommand];

export default commands;
