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
  summary: 'roll the stored session rows up per plan, then tally the task reports and list preflight halts',
  description: 'Rolls the session rows `rafa effort collect` stored up per plan, or per branch for a'
    + ' session no plan claims, then tallies the stored task reports by plan, status and outcome, and'
    + ' lists the runs whose preflight halted, one row per required item that failed. It'
    + ' reads only what is stored, so two runs over an unchanged store print the same bytes. With'
    + ' `--output=json` the report is the data of the terminal result event. With `--skills` it prints'
    + ' the skills report instead: per plan, and per resolver within one, whether each offered skill and'
    + ' injected lesson co-occurred with a recurrence of the failure it should prevent, read from the stored'
    + ' rows and the skills\' frontmatter, never from a session log. With `--trend` it prints the trend'
    + ' report instead: the recent task sessions against a baseline, then one row per loop and the drift'
    + ' of its per-task figures across loops. An unrecognised argument'
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
      name: 'skills',
      description: 'Prints the skills report in place of the session tables: per plan and per resolver,'
        + ' each skill\'s and lesson\'s signal, the skills invoked and never offered, M1, M2 and plan CI.'
        + ' Refused beside `--kind` or `--entrypoint`, which narrow session rows it does not read.',
      type: 'boolean',
    },
    {
      name: 'plan',
      description: 'Keeps only these plan stubs in the skills report, comma-separated, and may be'
        + ' repeated. A stub the store holds no row for reads as no plan. Refused without `--skills`.',
      type: 'string',
    },
    {
      name: 'trend',
      description: 'Prints the trend report in place of the session tables: the task sessions of a recent'
        + ' window against a baseline, per day, the outliers, then one row per loop with the drift of its'
        + ' per-task figures. Refused beside `--skills`, `--kind` or `--entrypoint`.',
      type: 'boolean',
    },
    {
      name: 'days',
      description: 'Days of the trend baseline and of the loop window. 14 when left out. Refused without `--trend`.',
      type: 'string',
    },
    {
      name: 'recent',
      description: 'Days of the trend\'s recent window, the newest session\'s day included. 3 when left out.'
        + ' Refused without `--trend`.',
      type: 'string',
    },
    {
      name: 'loops',
      description: 'Lists the newest n loops, whatever their age, in place of the loop window. Refused without'
        + ' `--trend`.',
      type: 'string',
    },
    {
      name: 'by',
      description: 'Splits each loop row by `effort`, `model` or `agent`. Refused without `--trend`.',
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
      note: 'Prints the per-plan tables, the task report tallies, then the preflight halts.',
    },
    {
      cmd: 'rafa effort report --skills --plan=rafa-24-know-which-skills-earn',
      note: 'Prints one plan\'s skills and lessons with their signals, per resolver, under the fixed'
        + ' co-occurrence line.',
    },
    {
      cmd: 'rafa effort report --trend --loops=10 --by=effort',
      note: 'Prints the trend metrics, then the ten newest loops, each split by effort, and their drift.',
    },
    {
      cmd: 'rafa effort report --entrypoint=sdk-cli --kind=task --output=json',
      note: 'Writes a start event, then a result event whose data is the report of the task sessions'
        + ' the loop ran.',
    },
  ],
  outputs: ['text', 'json'],
}, report);
