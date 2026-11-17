/** `check`: readiness and the run ahead, writing nothing. */
import type { RafaCommand } from '@open-tomato/rafa-core/core/command';

import { checkVisual } from '../steps/check.js';

import { execLine, prepare, printCheck, refusing, SUBJECT } from './shared.js';

export const checkCommand: RafaCommand = {
  name: 'visual check',
  subject: SUBJECT,
  action: 'check',
  summary: 'check that the visual baselines can run, and name the run ahead',
  description: 'Checks the config, the runner, the store (git and git-lfs for a side repo, the remote when one is set) and playwright-core, naming every gap with its fix in one pass, then prints whether the next run compares against a set or seeds one. Writes nothing; exits 1 on a gap.',
  args: [],
  flags: [],
  examples: [{ cmd: execLine('check'), note: 'checks readiness and names the run ahead' }],
  outputs: ['text'],
  needsProject: false,
  run: (context) => refusing(context, async () => {
    const env = await prepare(context);
    printCheck(context, await checkVisual(env.loaded, env));
  }),
};
