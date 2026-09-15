/**
 * `rafa loop start`: the task loop over a plan, run by the phase 0
 * command in `src/start.ts`.
 *
 * The command is aliased `start`, so the phase 0 spelling
 * `rafa start --plan=<file>` still runs it, after one deprecation line on
 * stderr. `src/start.ts` and `src/start/run-config.ts` read its flags,
 * and the ones declared here are those they read. The CI defaults are
 * the loop's own constants, so the help cannot drift from them.
 *
 * `-d|--detached` is declared so the help does not change when detached
 * runs arrive in phase 6, and `start/run-config.ts` refuses it until
 * then, before anything else is read.
 *
 * `--runtime=<path|version>` is read by `start/runtime.ts`, right after
 * that refusal. A `--runtime` typed ahead of the subject is read by the
 * dispatcher into the context's `flags` and left out of its `argv`, the
 * words `start` is handed, so the command refuses it before it runs
 * `start` rather than let the run go on in this runtime.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';

import { DEFAULT_CI_ATTEMPTS, DEFAULT_CI_TIMEOUT_MIN } from '../../start/pr-lifecycle.js';
import { refuseMisplacedRuntime } from '../../start/runtime.js';
import start from '../../start.js';
import { wrapPhaseZeroCommand } from '../wrap.js';

const wrapped = wrapPhaseZeroCommand({
  name: 'loop start',
  subject: 'loop',
  action: 'start',
  summary: 'run a plan task by task, then wrap up, open the PR and wait for CI',
  description: 'Walks the tracker of a plan one task at a time, each in a Claude Code session whose work'
    + ' is committed once it exits, and retries blocked tasks first. After the last task a wrap-up'
    + ' session promotes findings, syncs with main, pushes and opens or updates the PR, and the loop'
    + ' then waits on its checks, spending repair sessions on a red or conflicting PR. With no'
    + ' `--plan` it runs `PLAN.md` in `plan.dir`, `.rafa/plans` unless the config names another, or'
    + ' `PLAN.md` at the project root when that one does not exist. Before any session it checks the'
    + ' prerequisites the config and the plan\'s `PREREQUISITES-<stub>.md` name, halting when a required'
    + ' one fails and naming each failed optional one known-missing in every task prompt. It refuses to'
    + ' run on `main` or `master`. Each run writes its session record to `.rafa/runs/<session-id>.json`:'
    + ' the plan, the branch, the pid, the start, the state and the running task. It refuses a plan whose'
    + ' record names another branch, and a plan a session is still running. `rafa loop stop`, `pause`,'
    + ' `resume`, `status` and `list` reach the run through that record. A run holds its terminal: until'
    + ' phase 6 it refuses `--detached`. With `--runtime` the whole run goes on in that installed rafa,'
    + ' never in a `src/` directory.',
  args: [],
  flags: [
    {
      name: 'plan',
      description: 'The plan to run, relative to the project root. `PLAN-<stub>.md` is tracked in'
        + ' `PLAN_TRACKER-<stub>.md` beside it.',
      type: 'string',
    },
    {
      name: 'start-at',
      description: 'Waits until this local time of day, as `HH:MM`, before the first task.',
      type: 'string',
    },
    {
      name: 'inject',
      description: 'How much of the plan each task session is handed: `full`, `stage` or `task`.'
        + ' Outranks `plan.inject` in `.rafa/config.yaml`. The wrap-up is handed the whole plan.',
      type: 'string',
    },
    {
      name: 'runtime',
      description: 'The installed rafa the run goes on in: a version under `~/.rafa/runtime/`, or a path'
        + ' against the working directory to a `cli.js` or the directory holding it. Refused inside the'
        + ' `src/` of the working directory or the project root. Typed after `loop start`.',
      type: 'string',
    },
    {
      name: 'ci-wait',
      description: 'Waits on the checks of the PR once it is pushed; `--no-ci-wait` finishes at the push.',
      type: 'boolean',
      default: true,
    },
    {
      name: 'ci-timeout',
      description: 'Minutes to wait for the checks to settle.',
      type: 'number',
      default: DEFAULT_CI_TIMEOUT_MIN,
    },
    {
      name: 'ci-attempts',
      description: 'Repair sessions to spend on a red or conflicting PR before escalating;'
        + ' 0 spends none and still reports the verdict.',
      type: 'number',
      default: DEFAULT_CI_ATTEMPTS,
    },
    {
      name: 'any-branch',
      description: 'Runs on `main` or `master`, which the loop otherwise refuses.',
      type: 'boolean',
    },
    {
      name: 'detached',
      description: 'Runs the loop in the background. Refused until phase 6, before anything is read:'
        + ' until then a run holds the terminal it starts in.',
      type: 'boolean',
      aliases: ['d'],
    },
  ],
  examples: [
    {
      cmd: 'rafa loop start --plan=.rafa/plans/PLAN-my-feature.md',
      note: 'Runs the plan from its first open task, then opens the PR and waits on its checks.',
    },
    {
      cmd: 'rafa loop start --plan=.rafa/plans/PLAN-my-feature.md --start-at=23:00 --inject=task --no-ci-wait',
      note: 'Starts at 23:00, hands each task session the plan context and its own task line,'
        + ' and finishes at the push.',
    },
  ],
  aliases: ['start'],
  outputs: ['text', 'json'],
}, start);

/** The wrapped command, refusing a `--runtime` its words do not carry before `start` runs; see the module note. */
const loopStart: RafaCommand = Object.freeze({
  ...wrapped,
  run: async (context: RafaContext) => {
    refuseMisplacedRuntime(context.flags, context.argv);
    return wrapped.run(context);
  },
});

export default loopStart;
