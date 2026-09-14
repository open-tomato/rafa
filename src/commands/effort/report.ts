/**
 * `rafa effort report`: the stored effort rolled up per plan, written by
 * the phase 0 command in `src/effort/report.ts`.
 *
 * The spelling is phase 0's, so no alias is needed. `src/effort/report.ts`
 * reads its own flags and refuses any other, and the ones declared here
 * are those it reads. `--json` among them is phase 0's spelling of json
 * mode, kept for one release as a deprecated spelling of `--output=json`:
 * typed, it writes one deprecation line to stderr, and the dispatcher
 * reads it as `--output=json` (`src/cli/dispatch.ts`).
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
    + ' reads only what is stored, so two runs over an unchanged store print the same bytes. With'
    + ' `--output=json` the report is the data of the terminal result event. An unrecognised argument'
    + ' and a config the loop cannot run on are each refused, one line per problem.',
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
      description: 'Deprecated: the phase 0 spelling of `--output=json`, read as that flag after one'
        + ' deprecation line on stderr.',
      type: 'boolean',
      deprecated: { use: '--output=json' },
    },
  ],
  examples: [
    {
      cmd: 'rafa effort report',
      note: 'Prints the per-plan tables, then the task report tallies.',
    },
    {
      cmd: 'rafa effort report --entrypoint=sdk-cli --kind=task --output=json',
      note: 'Writes a start event, then a result event whose data is the report of the task sessions'
        + ' the loop ran.',
    },
  ],
  outputs: ['text', 'json'],
}, report);
