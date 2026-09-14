/**
 * `rafa plan create`: a plan, and its prerequisites, generated from a
 * spec by the phase 0 command in `src/plan.ts`.
 *
 * The command is aliased `plan`, so the phase 0 spelling
 * `rafa plan --spec=<file>` still runs it, after one deprecation line on
 * stderr. An alias spelled as a subject also catches a line under `plan`
 * whose next word is no action of it, `rafa plan` alone included
 * (`src/cli/route.ts`). `src/plan.ts` reads its own flags, and the ones
 * declared here are those it reads.
 */
import plan from '../../plan.js';
import { wrapPhaseZeroCommand } from '../wrap.js';

export default wrapPhaseZeroCommand({
  name: 'plan create',
  subject: 'plan',
  action: 'create',
  summary: 'generate a plan, and its prerequisites, from a spec',
  description: 'Hands the spec to a Claude Code session that writes `.plans/PLAN-<stub>.md`, and'
    + ' `.plans/PREREQUISITES-<stub>.md` when the spec needs setup no task can do. The stub is the'
    + ' basename of the spec unless `--stub` names one, and the command refuses when that plan already'
    + ' exists. The findings in `progress.txt` are handed to the session as advisory context unless'
    + ' `--no-progress` is given. The session loads the setting sources `loop.settingSources` names,'
    + ' and a config the loop cannot run on refuses the command before any session starts.',
  args: [],
  flags: [
    {
      name: 'spec',
      description: 'The spec to plan from, relative to the repo root.',
      type: 'string',
      required: true,
    },
    {
      name: 'stub',
      description: 'The plan stub, which names `PLAN-<stub>.md`. Defaults to the basename of the spec.',
      type: 'string',
    },
    {
      name: 'progress',
      description: 'Hands the findings in `progress.txt` to the session; `--no-progress` leaves them out.',
      type: 'boolean',
      default: true,
    },
  ],
  examples: [
    {
      cmd: 'rafa plan create --spec=.specs/my-feature.md',
      note: 'Writes .plans/PLAN-my-feature.md from the spec.',
    },
    {
      cmd: 'rafa plan create --spec=.specs/my-feature.md --stub=my-feature-v2 --no-progress',
      note: 'Writes .plans/PLAN-my-feature-v2.md, without the findings in progress.txt.',
    },
  ],
  aliases: ['plan'],
  outputs: ['text'],
}, plan);
