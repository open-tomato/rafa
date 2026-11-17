/** `orphans`: list the set's files no story owns any more; writes nothing. */
import type { RafaCommand } from '@open-tomato/rafa-core/core/command';

import { join } from 'node:path';

import { listOrphans } from '../steps/orphans.js';
import { readPlaywrightVersion } from '../store/key.js';

import { prepare, refusing, runnerKeyOf, SUBJECT, execLine } from './shared.js';

export const orphansCommand: RafaCommand = {
  name: 'visual orphans',
  subject: SUBJECT,
  action: 'orphans',
  summary: 'list baseline files that belong to no story',
  description: 'Lists the set\'s files whose story id the storybook build\'s index.json no longer holds, at this run\'s key. Writes nothing.',
  args: [],
  flags: [],
  examples: [{ cmd: execLine('orphans'), note: 'lists the orphaned baseline files' }],
  outputs: ['text'],
  needsProject: false,
  run: (context) => refusing(context, async () => {
    const env = await prepare(context);
    const { suite } = env.loaded.config.visual;
    const playwrightVersion = readPlaywrightVersion(join(env.loaded.workRoot, suite.package));
    const { orphans, total } = await listOrphans(env.loaded, { playwrightVersion, runnerKey: runnerKeyOf(env) });
    context.output.info(`${orphans.length} of ${total} files belong to no story in ${join(suite.package, suite.index)}`);
    for (const file of orphans) context.output.info(file);
  }),
};
