/**
 * `rafa plan validate <file>`: a plan file read by `parsePlan`, every
 * issue the parser reports written out, and exit code 1 when there is
 * one.
 *
 * ## What is read
 *
 * The one file the line names, resolved against the working directory as
 * a shell completes it, wherever it sits: the command reads no config and
 * no repository, though the dispatcher runs it only inside a project, as
 * it runs every command but `module exec`, `init` and `describe`. It reads that file and
 * nothing else, and starts no
 * Claude Code session: `validate.test.ts` runs it with a stand-in `claude`
 * first on the PATH and finds the stand-in never called, where
 * `rafa plan create` under the same planting calls it.
 *
 * What is checked is what `parsePlan` reports in `PlanModel.issues`, each
 * issue carrying one `PlanIssueReason`. A task declaration's own issues
 * sit on the task, in `TaskDeclaration.issues`, not in that list, and are
 * not checked here.
 *
 * ## What it writes
 *
 * With no issue, json mode gives the terminal result `data`: `file`
 * (absolute), the number of `stages`, the task counts under `tasks`, and
 * an empty `issues`. Text mode writes one line naming the file as typed,
 * its stages and its counts.
 *
 * With issues, each is written at `error`, in line order, as
 * `<file>:<line>: <reason>: <text>`, with the file as typed and the line
 * counting from one: a `log` event in json mode, an `error: ` line on
 * stdout in text mode. The command then throws `CommandExit` with exit
 * code 1 and a message counting them, which text mode writes to stderr
 * and json mode carries in the terminal result.
 *
 * A line naming no file or more than one, and a path that is no file,
 * are refused with exit code 1 before anything is parsed.
 */
import type { TaskCounts } from './plan-files.js';
import type { RafaCommand } from '../../cli/command.js';
import type { PlanIssue } from '../../plan/index.js';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { parsePlan } from '../../plan/index.js';

import { countTasks, expectOneArgument, formatCounts, isFile, issueLine, plural } from './plan-files.js';

/** The usage line a refusal names. */
const USAGE = 'rafa plan validate <file>';

/** Answers the directory a typed path is resolved against: the process's, unless a test hands another. */
export type WorkingDirectory = () => string;

/** A plan file read; see the module note. */
export interface PlanValidation {
  /** The file read, absolute. */
  readonly file: string;
  /** How many `# Stage:` headings it holds. */
  readonly stages: number;
  /** Its tasks, counted by checkbox. */
  readonly tasks: TaskCounts;
  /** Every issue `parsePlan` reported, in line order. */
  readonly issues: readonly PlanIssue[];
}

/** The plan at the absolute path `file`, read, or a refusal with exit code 1 when it is no file. */
export function validatePlan(file: string): PlanValidation {
  if (!isFile(file)) throw new CommandExit(1, `❌ Plan file not found: ${file}`);
  const model = parsePlan(readFileSync(file, 'utf8'));
  return { file, stages: model.stages.length, tasks: countTasks(model.tasks), issues: model.issues };
}

/** The command, resolving the typed path against `workingDirectory`; see the module note. */
export function createPlanValidateCommand(workingDirectory: WorkingDirectory = () => process.cwd()): RafaCommand {
  const command: RafaCommand = {
    name: 'plan validate',
    subject: 'plan',
    action: 'validate',
    summary: 'check that a plan file reads as written, starting no session',
    description: 'Reads one plan file with the plan parser, the rafa:* blocks and the checklist, and starts'
      + ' no session. When the parser reads the whole file as written it prints the stages and the tasks'
      + ' counted by checkbox. Otherwise it writes every issue the parser reported as an error line naming'
      + ' the file, the line and the reason, then exits 1. The path is read relative to the working'
      + ' directory, and no repository is needed. With `--output=json` each issue is an error log event,'
      + ' and a plan with none is the data of the terminal result event.',
    args: [
      {
        name: 'file',
        description: 'The plan file to read, relative to the working directory.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa plan validate .plans/PLAN-my-feature.md',
        note: 'Prints one line when the plan reads as written, or one error line per issue and exits 1.',
      },
      {
        cmd: 'rafa plan validate .plans/PLAN-my-feature.md --output=json',
        note: 'Writes a start event, an error log event per issue, then a result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const typed = expectOneArgument(context.args, USAGE);
      const validation = validatePlan(resolve(workingDirectory(), typed));
      const { issues, stages, tasks } = validation;
      if (issues.length > 0) {
        for (const issue of issues) context.output.error(issueLine(typed, issue));
        throw new CommandExit(1, `❌ ${typed}: ${plural(issues.length, 'issue')}; the plan does not read as written`);
      }
      if (context.outputMode === 'json') {
        context.output.result(validation);
        return;
      }
      context.output.info(`✅ ${typed}: no issues; ${plural(stages, 'stage')}, tasks ${formatCounts(tasks)}`);
    },
  };
  return Object.freeze(command);
}

export default createPlanValidateCommand();
