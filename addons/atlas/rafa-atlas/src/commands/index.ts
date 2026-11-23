/**
 * The commands entry the manifest names: the three Atlas actions, each
 * routed by its action under `rafa module exec @open-tomato/rafa-atlas
 * <action>`; `rafa atlas` routes nothing.
 */
import type { RafaCommand } from '@open-tomato/rafa-core/core/command';

import { buildCommand } from './build.js';
import { describeCommand } from './describe.js';
import { serveCommand } from './serve.js';

const commands: RafaCommand[] = [buildCommand, serveCommand, describeCommand];

export default commands;
