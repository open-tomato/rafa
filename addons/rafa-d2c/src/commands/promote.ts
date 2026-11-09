/** `promote`: the person's step; a placed run's staged snapshots become the set. */
import type { RafaCommand } from '@open-tomato/rafa-core/core/command';

import { promoteVisual } from '../steps/promote.js';

import { files } from './seed.js';
import { execLine, prepare, refusing, RUN_FLAG, runFlagOf, runnerKeyOf, SUBJECT } from './shared.js';

export const promoteCommand: RafaCommand = {
  name: 'visual promote',
  subject: SUBJECT,
  action: 'promote',
  summary: 'make a placed run\'s staged snapshots the set',
  description: 'Copies a placed run\'s staged PNGs into the set and writes its set.json; in a side repo, makes one commit. Warns, listing the files, when the set changed since the run was seeded. Never pushes.',
  args: [],
  flags: [{ ...RUN_FLAG }],
  examples: [
    { cmd: execLine('promote'), note: 'promotes the newest placed run' },
    { cmd: execLine('promote', '--run=20261108T142500Z-a3f9'), note: 'promotes one run by its id' },
  ],
  outputs: ['text'],
  needsProject: false,
  run: (context) => refusing(context, async () => {
    const env = await prepare(context);
    const runId = runFlagOf(context);
    const runnerKey = runnerKeyOf(env);
    const result = await promoteVisual(env.loaded, { runnerKey, ...(runId === undefined
      ? {}
      : { runId }) }, { run: env.run, now: () => new Date() });
    const { store } = env.loaded.config.visual;
    if (result.overlap.length > 0) {
      context.output.warn(`the set changed since run ${result.runId} was seeded; these files were also changed by another run: ${result.overlap.join(', ')}`);
    }
    context.output.info(`promoted ${files(result.promoted)} into ${store.set} @ ${runnerKey}`);
    if (result.commit !== null && store.kind !== 'same-repo') {
      context.output.info(`committed in the store; push it yourself when ready: git -C ${store.dir} push`);
    }
  }),
};
