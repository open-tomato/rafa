/**
 * `rafa usage`: the Claude usage bar, printed by the phase 0 command in
 * `src/usage.ts`.
 *
 * A top-level command, its action spelled as its subject, so it sits
 * directly under `src/commands/` rather than in a subject's directory.
 * It reads no flag.
 */
import usage from '../usage.js';

import { wrapPhaseZeroCommand } from './wrap.js';

export default wrapPhaseZeroCommand({
  name: 'usage',
  subject: 'usage',
  action: 'usage',
  summary: 'show how much of the Claude usage limit is spent',
  description: 'Prints the Claude usage percentage beside a bar and a level: OK below 70%, ELEVATED'
    + ' from 70%, HIGH from 80% and CRITICAL from 90%. No live source is wired in yet, so the reading'
    + ' is `CLAUDE_USAGE_PERCENT` when it is set, and unavailable otherwise.',
  args: [],
  flags: [],
  examples: [
    {
      cmd: 'rafa usage',
      note: 'Prints the usage bar, or says the reading is unavailable.',
    },
  ],
  outputs: ['text'],
}, usage);
