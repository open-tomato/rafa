/** `place`: after the suite, say what kind of run it was and stage its new and changed PNGs. */
import type { RafaCommand } from '@open-tomato/rafa-core/core/command';

import { placeVisual } from '../steps/place.js';

import { files } from './seed.js';
import { execLine, prepare, refusing, RUN_FLAG, runFlagOf, runnerKeyOf, SUBJECT } from './shared.js';

export const placeCommand: RafaCommand = {
  name: 'visual place',
  subject: SUBJECT,
  action: 'place',
  summary: 'stage a run\'s new and changed snapshots in the store',
  description: 'Reads the suite\'s jest report, says whether the run seeded, compared or updated (a seed run never reads as a pass), and copies new and changed PNGs into the run\'s staging folder. Never writes the set; promote does, when you run it.',
  args: [],
  flags: [{ ...RUN_FLAG }],
  examples: [
    { cmd: execLine('place'), note: 'places the newest seeded run' },
    { cmd: execLine('place', '--run=20261108T142500Z-a3f9'), note: 'places one run by its id' },
  ],
  outputs: ['text'],
  needsProject: false,
  run: (context) => refusing(context, async () => {
    const env = await prepare(context);
    const runId = runFlagOf(context);
    const result = await placeVisual(env.loaded, { runnerKey: runnerKeyOf(env), ...(runId === undefined
      ? {}
      : { runId }) }, { now: () => new Date(), host: env.host });
    for (const line of result.warnings) context.output.warn(line);
    context.output.info(result.line);
    if (result.staged.length > 0) context.output.info(`staged ${files(result.staged.length)}; promote with: ${execLine('promote', `--run=${result.runId}`)}`);
  }),
};
