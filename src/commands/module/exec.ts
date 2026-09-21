/**
 * `rafa module exec <module> <action>`: the action through which a
 * module's commands are reached.
 *
 * The modules and addons spec puts a module's actions under
 * `rafa module exec <name> <action>`, mounted by the dispatcher under
 * `module/<name>`. This command declares `exec`, so the router reads on
 * past it (`src/cli/route.ts`): the next word names a mount and the word
 * after it one of that mount's actions, which is what runs, and
 * `--help` after them renders that action's help with the core renderer.
 * `describe` lists each mounted action after the actions of `module`.
 *
 * ## What runs here
 *
 * Only the line naming no module: `rafa module exec` alone. It refuses
 * with exit code 1, naming each mounted module with its actions, or
 * saying none is mounted and how one is. A module word naming no mount,
 * and a mount with no action or an unknown one, are the router's
 * refusals and never reach this command.
 *
 * It declares `needsProject: false`, so the refusal reads the same
 * outside a project, where no module is mounted. A mounted action
 * declares its own.
 */
import type { RafaCommand } from '../../cli/command.js';

import { CommandExit } from '../../cli/command.js';
import { mountKey } from '../../cli/registry.js';

/** The usage line a refusal names. */
const USAGE = 'rafa module exec <module> <action> [args] [flags]';

/** The command; see the module note. */
const execCommand: RafaCommand = {
  name: 'module exec',
  subject: 'module',
  action: 'exec',
  summary: 'run an action of a mounted module',
  description: 'Runs the action a mounted module provides: `rafa module exec <module> <action>`, with'
    + ' the arguments and flags that action declares after it. A module is mounted when `allowList:`'
    + ' in the config names it and `modules:` gives its `path` source; `rafa module list` shows each'
    + ' one and what it came to. `--help` after the action prints that action\'s help. Typed with no'
    + ' module, it refuses with exit code 1 and names every mounted module with its actions.',
  args: [
    { name: 'module', description: 'The name of a mounted module, as `allowList:` names it.', type: 'string' },
    { name: 'action', description: 'One of the actions the module provides.', type: 'string' },
  ],
  flags: [],
  examples: [
    {
      cmd: 'rafa module exec linear next',
      note: 'Runs the action next of the module linear, once allowList: names it.',
    },
    {
      cmd: 'rafa module exec linear next --help',
      note: 'Prints the help of that action, rendered as any core action\'s help is.',
    },
  ],
  outputs: ['text', 'json'],
  exec: true,
  needsProject: false,
  run: async (context) => {
    const mounts = context.registry.mounts();
    const mounted = mounts.length === 0
      ? 'none is mounted; a module is mounted when allowList: names it and modules: gives its path source'
      : mounts
        .map((mount) => `${mount.name} (${context.registry.actionsOf(mountKey(mount.name)).map((held) => held.action)
          .join(', ')})`)
        .join(', ');
    throw new CommandExit(1, `❌ Expected a module and one of its actions; mounted: ${mounted}\nUsage: ${USAGE}`);
  },
};

export default Object.freeze(execCommand);
