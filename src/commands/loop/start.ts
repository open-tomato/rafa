/**
 * `rafa loop start`: the task loop over a plan, run by the phase 0
 * command in `src/start.ts`.
 *
 * The command is aliased `start`, so the phase 0 spelling
 * `rafa start --plan=<file>` still runs it, after one deprecation line on
 * stderr. `src/start.ts`, `src/start/run-config.ts` and
 * `src/start/run-setup.ts` read its flags, and the ones declared here
 * are those they read. The CI defaults are the loop's own constants, so
 * the help cannot drift from them.
 *
 * `-d|--detached` is declared so the help does not change when detached
 * runs arrive in phase 6, and `start/run-config.ts` refuses it until
 * then, before anything else is read.
 *
 * `--create-branch` is read by `src/start/run-setup.ts` ahead of its
 * branch guard, and only on `main` or `master`: it answers yes to the question the run
 * would otherwise ask a terminal (`start/branch.ts`). It is declared
 * beside `--any-branch` because the two are the pair an operator on the
 * base chooses between — leave the base, or stay on it deliberately —
 * and `--any-branch` outranks it.
 *
 * `--as-worktree` is declared beside them for the same reason: it is
 * the third answer to that question, the plan's branch in a worktree
 * of its own (`start/worktree.ts`), and `start/run-setup.ts` refuses it
 * beside `--create-branch` before anything else is read but
 * `-d|--detached`.
 *
 * `--hint` is read by none of them, and by nothing before the run: it is
 * this tree's own ({@link HINT_FLAG_SPEC}), and `endingWith` reads it
 * once `start` has returned, to end a finished run by naming the one
 * step that follows — with the pull request pushed, the wait on its
 * checks (`src/next/ending.ts`). A run that refused or was interrupted
 * throws out of the inner run and ends with no hint.
 *
 * `--runtime=<path|version>` is read by `start/runtime.ts`, right after
 * that refusal. A `--runtime` typed ahead of the subject is read by the
 * dispatcher into the context's `flags` and left out of its `argv`, the
 * words `start` is handed, so the command refuses it before it runs
 * `start` rather than let the run go on in this runtime.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';

import { endingWith, HINT_FLAG_SPEC } from '../../next/ending.js';
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
    + ' one fails and naming each failed optional one known-missing in every task prompt, and warns once'
    + ' for each migration the effort store holds that this rafa does not know and that is additive. It'
    + ' refuses to start while `RAFA_EFFORT_DIR` is set, since a loop records to the project\'s own'
    + ' store. Started on'
    + ' `main` or `master` it offers to create the plan\'s `feat/<stub>` from the latest'
    + ' `origin/<base>` and run there, `--create-branch` answering that without asking, and refuses'
    + ' the run when the offer is not taken. `--as-worktree` runs the plan in a worktree of its own on'
    + ' that branch instead, leaving the main checkout as it is, and is refused beside'
    + ' `--create-branch`. Each run writes its session record to `.rafa/runs/<session-id>.json`:'
    + ' the plan, the branch, the pid, the start, the state and the running task, and under `--roadmap`'
    + ' the hop away, when one is. It refuses a plan whose'
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
      name: 'skills-resolver',
      description: 'The resolver that picks the skills each task session is handed: `planner`, `tag`'
        + ' or `none`. Outranks `task.skills` in `.rafa/config.yaml` for this run only.',
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
      name: 'create-branch',
      description: 'On `main` or `master`, creates `feat/<plan-stub>` from the latest `origin/<base>`'
        + ' and runs the plan there without asking, or switches to that branch when it already'
        + ' exists. Refuses rather than move when a tracked file is modified, the fetch fails or the'
        + ' base has diverged from its remote.',
      type: 'boolean',
    },
    {
      name: 'as-worktree',
      description: 'Runs the plan in a linked worktree of its own: `feat/<plan-stub>` from the latest'
        + ' `origin/<base>`, added at `<loop.worktreeDir>/<plan-stub>`, `.rafa/worktrees` unless the'
        + ' config names another. The main checkout keeps its branch and working tree. Refused beside'
        + ' `--create-branch`, which makes the same branch by switching the main checkout.',
      type: 'boolean',
    },
    {
      name: 'any-branch',
      description: 'Runs on `main` or `master`, which the loop otherwise refuses.',
      type: 'boolean',
    },
    {
      name: 'roadmap',
      description: 'Stamps the hop `rafa next --roadmap` is away on, when one is, on the session record as'
        + ' its `hop`: the hop record `.rafa/hop.json` holds, still `away` and its home still the'
        + ' position\'s. What `rafa next --roadmap` passes to the loop it starts.',
      type: 'boolean',
    },
    {
      name: 'detached',
      description: 'Runs the loop in the background. Refused until phase 6, before anything is read:'
        + ' until then a run holds the terminal it starts in.',
      type: 'boolean',
      aliases: ['d'],
    },
    HINT_FLAG_SPEC,
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
    {
      cmd: 'rafa loop start --plan=.rafa/plans/PLAN-my-feature.md --create-branch',
      note: 'Run from `main`, creates `feat/my-feature` from the latest `origin/main` without'
        + ' asking, and runs the plan there.',
    },
  ],
  aliases: ['start'],
  outputs: ['text', 'json', 'events'],
  spends: {
    when: 'always',
    what: 'one session per task, one for the wrap-up and up to `loop.wrapUp.retries` more when it opens no pull request, and repair sessions while CI is red',
  },
}, start);

/** The wrapped command, refusing a `--runtime` its words do not carry before `start` runs; see the module note. */
const loopStart: RafaCommand = Object.freeze({
  ...wrapped,
  run: async (context: RafaContext) => {
    refuseMisplacedRuntime(context.flags, context.argv);
    return wrapped.run(context);
  },
});

export default endingWith(loopStart);
