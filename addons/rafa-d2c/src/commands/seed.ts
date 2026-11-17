/** `seed`: check, then put the store's set in the package's snapshot folder. */
import type { RafaCommand } from '@open-tomato/rafa-core/core/command';

import { join } from 'node:path';

import { checkVisual } from '../steps/check.js';
import { seedVisual } from '../steps/seed.js';

import { execLine, prepare, printCheck, refusing, SUBJECT } from './shared.js';

/** `1 file` or `2 files`. */
export function files(count: number): string {
  return `${count} ${count === 1
    ? 'file'
    : 'files'}`;
}

export const seedCommand: RafaCommand = {
  name: 'visual seed',
  subject: SUBJECT,
  action: 'seed',
  summary: 'copy the store\'s set into the package\'s snapshot folder',
  description: 'Runs check, then moves what the package\'s snapshot folder holds into a new run folder in the store\'s staging area and copies the set in, so the suite compares against the set. Deletes nothing.',
  args: [],
  flags: [],
  examples: [{ cmd: execLine('seed'), note: 'seeds the snapshots from the store and prints the run id' }],
  outputs: ['text'],
  needsProject: false,
  run: (context) => refusing(context, async () => {
    const env = await prepare(context);
    const report = await checkVisual(env.loaded, env);
    printCheck(context, report);
    const result = await seedVisual(env.loaded, report, { run: env.run, now: () => new Date(), random: Math.random });
    const { suite } = env.loaded.config.visual;
    if (result.previousMoved > 0) context.output.info(`moved ${files(result.previousMoved)} the snapshot folder held into ${result.runDir}`);
    context.output.info(`seeded ${files(result.seeded)} into ${join(suite.package, suite.snapshots)} (run ${result.runId})`);
  }),
};
