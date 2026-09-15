/**
 * The commands entry of the `seam-fixture` module, a well-behaved
 * fixture `src/tests/module-seams.test.ts` drives end to end: mounted
 * under `module/seam-fixture` once `allowList:` names it, its one action
 * reached as `rafa module exec seam-fixture ping`.
 */
import type { RafaCommand } from '../../../cli/command.js';

const pingCommand: RafaCommand = {
  name: 'seam ping',
  subject: 'seam',
  action: 'ping',
  summary: 'answer pong',
  description: 'Answers pong, proving the module seam mounts and routes its command.',
  args: [],
  flags: [],
  examples: [{ cmd: 'rafa module exec seam-fixture ping', note: 'answers pong' }],
  outputs: ['text'],
  needsProject: false,
  run: async (context) => {
    context.output.info('pong');
  },
};

export default [pingCommand];
