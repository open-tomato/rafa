/**
 * `rafa loop start`: the task loop over a plan, run by the phase 0
 * command in `src/start.ts`.
 *
 * The command is aliased `start`, so the phase 0 spelling
 * `rafa start --plan=<file>` still runs it, after one deprecation line on
 * stderr. `src/start.ts` and `src/start/run-config.ts` read its flags,
 * and the ones declared here are those they read. The CI defaults are
 * the loop's own constants, so the help cannot drift from them.
 */
import { DEFAULT_CI_ATTEMPTS, DEFAULT_CI_TIMEOUT_MIN } from '../../start/pr-lifecycle.js';
import start from '../../start.js';
import { wrapPhaseZeroCommand } from '../wrap.js';

export default wrapPhaseZeroCommand({
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
    + ' record names another branch, and a plan a session is still running.',
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
