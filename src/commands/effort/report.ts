/**
 * `rafa effort report`: the stored effort rolled up per plan, printed by
 * the phase 0 command in `src/effort/report.ts`.
 *
 * The spelling is phase 0's, so no alias is needed. `src/effort/report.ts`
 * reads its own flags and refuses any other, and the ones declared here
 * are those it reads: `--json` among them, which the command tree spells
 * `--output=json` once the command writes through the active output.
 */
import report from '../../effort/report.js';
import { wrapPhaseZeroCommand } from '../wrap.js';

export default wrapPhaseZeroCommand({
  name: 'effort report',
  subject: 'effort',
  action: 'report',
  summary: 'roll the stored session rows up per plan, then tally the task reports',
  description: 'Rolls the session rows `rafa effort collect` stored up per plan, or per branch for a'
    + ' session no plan claims, then tallies the stored task reports by plan, status and outcome. It'
    + ' reads only what is stored, so two runs over an unchanged store print the same bytes. An'
    + ' unrecognised argument and a config the loop cannot run on are each refused, one line per problem.',
  args: [],
  flags: [
    {
      name: 'kind',
      description: 'Keeps only the sessions of these kinds, comma-separated, and may be repeated.'
        + ' A value that is no session kind is refused, and the refusal lists the kinds.',
      type: 'string',
    },
    {
      name: 'entrypoint',
      description: 'Keeps only the sessions whose dominant entrypoint is one of these, comma-separated.'
        + ' `sdk-cli` is the loop.',
      type: 'string',
    },
    {
      name: 'json',
      description: 'Prints the report as one JSON document instead of tables.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa effort report',
      note: 'Prints the per-plan tables, then the task report tallies.',
    },
    {
      cmd: 'rafa effort report --entrypoint=sdk-cli --kind=task --json',
      note: 'Prints the task sessions the loop ran as one JSON document.',
    },
  ],
  outputs: ['text'],
}, report);
