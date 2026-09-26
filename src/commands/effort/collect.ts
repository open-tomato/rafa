/**
 * `rafa effort collect`: session and commit rows appended to the effort
 * store by the phase 0 command in `src/effort/collect.ts`, and the skills
 * each session invoked counted into `skill_invocations`.
 *
 * The spelling is phase 0's, so no alias is needed.
 * `src/effort/collect.ts` reads its own flags through its parser in
 * `src/effort/collect-args.ts` and refuses any other, and the ones
 * declared here are those it reads.
 */
import collect from '../../effort/collect.js';
import { wrapPhaseZeroCommand } from '../wrap.js';

export default wrapPhaseZeroCommand({
  name: 'effort collect',
  subject: 'effort',
  action: 'collect',
  summary: 'collect session and commit rows into the effort store',
  description: 'Reads the Claude Code session logs of this repo and its commit history, and appends every'
    + ' session and commit the effort store does not hold yet to the store `store` in'
    + ' `.rafa/config.yaml` selects, then counts the skills each appended session invoked into'
    + ' `effort.sqlite`. A run over an unchanged history appends nothing. An unrecognised'
    + ' argument, a `--since` that is no date and a config the loop cannot run on are each refused,'
    + ' one line per problem.',
  args: [],
  flags: [
    {
      name: 'since',
      description: 'Collects only the session logs and commits from this date on, as `--since=<date>`.',
      type: 'string',
    },
    {
      name: 'git',
      description: 'Collects commit rows; `--no-git` skips them.',
      type: 'boolean',
      default: true,
    },
    {
      name: 'sessions',
      description: 'Collects session rows; `--no-sessions` skips them. Refused beside `--no-git`,'
        + ' which would leave nothing to collect, unless `--skills` is given.',
      type: 'boolean',
      default: true,
    },
    {
      name: 'skills',
      description: 'Counts the `Skill` calls of every session the store already holds, not only the ones'
        + ' this run appends. Lifts the refusal of `--no-git` beside `--no-sessions`.',
      type: 'boolean',
    },
    {
      name: 'verbose',
      description: 'Prints what each half found before the summary: the logs and plan stubs it read,'
        + ' each session read, and the commits parsed.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa effort collect',
      note: 'Appends every session and commit not stored yet, then prints what each half appended.',
    },
    {
      cmd: 'rafa effort collect --since=2026-09-01 --no-git',
      note: 'Appends the sessions logged since 1 September 2026, and reads no commit.',
    },
  ],
  outputs: ['text', 'json'],
}, collect);
