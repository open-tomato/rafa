/**
 * `rafa plan show <stub>`: one plan under `.plans/` as `parsePlan` reads
 * it, or with `--tracker` the loop's copy of it.
 *
 * ## What is read
 *
 * `PLAN-<stub>.md` in `.plans/` at the git root, or with `--tracker`
 * `PLAN_TRACKER-<stub>.md` beside it: the copy `rafa loop start` makes
 * when it first runs the plan, and ticks as tasks finish. A stub no plan
 * stamp can carry is refused before any file is looked for, so the file
 * named never leaves `.plans/` (`plan-files.ts`). A stub naming no file is
 * refused too, both with exit code 1.
 *
 * ## `--tracker` is typed after the stub
 *
 * `parseArgs` gives a flag the next word as its value unless that word
 * opens with `-`, whatever type the flag declares. So under
 * `rafa plan show --tracker my-plan`, `my-plan` is the value of
 * `--tracker` and the command is handed no stub. The command reads `true`
 * and `false` as the two values of the flag, as `--tracker=true` spells
 * them, and refuses any other with exit code 1, naming the word taken and
 * the order that works: `rafa plan show my-plan --tracker`.
 *
 * ## What it writes
 *
 * In json mode the plan is the terminal result's `data`: `stub`, `file`
 * (absolute), `tracker`, the `header` with each extra key named and its
 * value left out, the plan `context`, the `stages` and `tasks` as
 * `parsePlan` answers them, the task `counts`, and the `issues`. An
 * extra's value is `unknown` to the parser, which never serialises one
 * (`plan/parse.ts`), so only its key is given.
 *
 * In text mode it writes the stub, the file relative to the git root, the
 * issue and spec the header names when it names them, and the counts.
 * Then each task under its stage heading, the tasks above every heading
 * first, with its checkbox as the checklist writes it and its sentence
 * without its declaration. Then the issues, when there are any. The plan
 * and stage contexts are left to json mode and to the file. An issue is
 * shown and never refused: `rafa plan validate` is the check that exits
 * nonzero on one.
 */
import type { RepoRootFinder, TaskCounts } from './plan-files.js';
import type { RafaCommand } from '../../cli/command.js';
import type { PlanIssue, PlanStage, PlanTask } from '../../plan/index.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { parsePlan } from '../../plan/index.js';
import { getRepoRoot } from '../../utils/git.js';
import { isStampableStub } from '../../utils/plan-stamp.js';

import {
  checkbox,
  countTasks,
  expectOneArgument,
  formatCounts,
  isFile,
  issueLine,
  planFileName,
  PLANS_DIR,
} from './plan-files.js';

/** The usage line a refusal names. */
const USAGE = 'rafa plan show <stub> [--tracker]';

/** The `rafa:plan` fields as the command gives them: each extra by its key alone. */
export interface ShownHeader {
  readonly stub: string | null;
  readonly issue: string | null;
  readonly spec: string | null;
  /** The key of each field no header field names, in the order the parser answers. */
  readonly extras: readonly string[];
}

/** One plan, or its tracker, as the command gives it; see the module note. */
export interface ShownPlan {
  /** The stub the line named. */
  readonly stub: string;
  /** The file read, absolute. */
  readonly file: string;
  /** True when the file read is the tracker. */
  readonly tracker: boolean;
  readonly header: ShownHeader;
  /** The body of the plan-wide `rafa:context` block, or null. */
  readonly context: string | null;
  readonly stages: readonly PlanStage[];
  readonly tasks: readonly PlanTask[];
  readonly counts: TaskCounts;
  readonly issues: readonly PlanIssue[];
}

/**
 * The value of `--tracker` as a boolean, or a refusal with exit code 1
 * for a value that is neither `true` nor `false`; see the module note.
 */
export function readTrackerFlag(value: string | boolean | undefined): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(
    1,
    `❌ --tracker takes no value, and read "${value}" as one. Type the stub first: rafa plan show <stub> --tracker`,
  );
}

/** The refusal of a stub naming no file. */
function missingText(stub: string, tracker: boolean, relative: string): string {
  return tracker
    ? `❌ No tracker for plan "${stub}": ${relative} does not exist until rafa loop start first runs the plan.`
    : `❌ No plan "${stub}": ${relative} does not exist. rafa plan list names the plans there are.`;
}

/**
 * The plan `stub` names under `.plans/` in the repository at `root`, or
 * its tracker; a refusal with exit code 1 for a stub no plan stamp can
 * carry and for one naming no file. See the module note.
 */
export function showPlan(root: string, stub: string, tracker: boolean): ShownPlan {
  if (!isStampableStub(stub)) {
    throw new CommandExit(1, `❌ "${stub}" is no plan stub: a stub is letters, digits, ".", "_" and "-"`);
  }
  const name = planFileName(stub, tracker);
  const file = join(root, PLANS_DIR, name);
  if (!isFile(file)) throw new CommandExit(1, missingText(stub, tracker, join(PLANS_DIR, name)));

  const model = parsePlan(readFileSync(file, 'utf8'));
  const { header } = model;
  return {
    stub,
    file,
    tracker,
    header: {
      stub: header.stub,
      issue: header.issue,
      spec: header.spec,
      extras: header.extras.map((extra) => extra.key),
    },
    context: model.context,
    stages: model.stages,
    tasks: model.tasks,
    counts: countTasks(model.tasks),
    issues: model.issues,
  };
}

/** A task as text mode writes it. */
function taskLine(task: PlanTask): string {
  return `  ${checkbox(task.status)} ${task.text}`;
}

/** The lines text mode writes for a plan; see the module note. */
export function renderShownPlan(shown: ShownPlan): string[] {
  const relative = join(PLANS_DIR, planFileName(shown.stub, shown.tracker));
  const fileLabel = shown.tracker
    ? 'Tracker'
    : 'File';
  const lines = [`Plan: ${shown.stub}`, `${fileLabel}: ${relative}`];
  if (shown.header.issue !== null) lines.push(`Issue: ${shown.header.issue}`);
  if (shown.header.spec !== null) lines.push(`Spec: ${shown.header.spec}`);
  lines.push(`Tasks: ${formatCounts(shown.counts)}`);

  const unstaged = shown.tasks.filter((task) => task.stage === null);
  if (unstaged.length > 0) lines.push('', ...unstaged.map(taskLine));
  for (const [index, stage] of shown.stages.entries()) {
    lines.push('', `Stage: ${stage.name}`, ...shown.tasks.filter((task) => task.stage === index).map(taskLine));
  }
  if (shown.issues.length > 0) {
    lines.push('', 'Issues:', ...shown.issues.map((issue) => `  ${issueLine(relative, issue)}`));
  }
  return lines;
}

/** The command, reading the repository `findRepoRoot` answers; see the module note. */
export function createPlanShowCommand(findRepoRoot: RepoRootFinder = getRepoRoot): RafaCommand {
  const command: RafaCommand = {
    name: 'plan show',
    subject: 'plan',
    action: 'show',
    summary: 'show one plan, or its tracker, stage by stage',
    description: 'Reads `.plans/PLAN-<stub>.md` at the git root with the plan parser and prints its stub,'
      + ' the issue and spec its rafa:plan block names, and its tasks counted by checkbox, then each'
      + ' task under its stage heading and every issue the parser reported. With `--tracker` it reads'
      + ' `PLAN_TRACKER-<stub>.md` instead, the copy the loop ticks as tasks finish. Type `--tracker`'
      + ' after the stub: typed before it, the stub is read as the value of the flag and refused. With'
      + ' `--output=json` the plan is the data of the terminal result event.',
    args: [
      {
        name: 'stub',
        description: 'The plan stub, which names `.plans/PLAN-<stub>.md`.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'tracker',
        description: 'Reads `PLAN_TRACKER-<stub>.md`, the copy the loop ticks, instead of the plan.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa plan show my-feature',
        note: 'Prints .plans/PLAN-my-feature.md stage by stage.',
      },
      {
        cmd: 'rafa plan show my-feature --tracker --output=json',
        note: 'Writes a start event, then a result event whose data is the tracker as the plan parser reads it.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const tracker = readTrackerFlag(context.flags.tracker);
      const stub = expectOneArgument(context.args, USAGE);
      const shown = showPlan(findRepoRoot(), stub, tracker);
      if (context.outputMode === 'json') {
        context.output.result(shown);
        return;
      }
      for (const line of renderShownPlan(shown)) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

export default createPlanShowCommand();
