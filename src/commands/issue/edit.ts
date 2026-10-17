/**
 * `rafa issue edit <n>`: one issue's body appended to, its body
 * replaced, its title changed or its priority set, after four gates, and
 * the outcome (`.rafa/specs/rafa-812-spec-rafa-issue-edit.md`). The run,
 * its gates and its outcomes live in `./edit-run.ts`, and what
 * `--priority` adds to a run in `./edit-priority.ts`; this module
 * builds the command over its declaration (`./declarations.ts`) and
 * prints what a run came to.
 *
 * It is an atomic action of the `issue` subject: it edits and answers.
 * It never re-plans or refreshes a saved spec copy; a `stale-copy` names
 * `rafa plan create --issue=<n> --refresh` and stops there. The one
 * re-labelling it does is `--priority`'s: the priority swapped and the
 * issue taken out of triage, in the same write.
 *
 * ## What it prints
 *
 * In text mode, the lines `renderEditReport` gives: the outcome's
 * sentence, and under `--dry-run` each gate's reading and the added part
 * before it, which for a priority is the swap, `priority: needs-triage →
 * high`. In json mode the terminal result's `data` is the
 * `IssueEditResult`: the report and the tracker it went through.
 *
 * ## Exit codes
 *
 * `appended`, `replaced`, `already` and `stale-copy` exit 0. A gate's
 * refusal exits 2 (`EditRefusal`), under `--dry-run` too. A line refusal,
 * a config refused, a chain landing nowhere and a read or write the
 * tracker rejected exit 1, as `issue-tracker.ts` words them. A
 * `conflict` exits 1 too, after the run wrote both bodies under
 * `.rafa/scratch/`: as `pr wait` does with a non-zero ending, the report
 * is the message of the `CommandExit`, so the two paths reach the
 * person in either output mode.
 */
import type { EditSeams } from './edit-run.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { ISSUE_EDIT_DECLARATION } from './declarations.js';
import { editIssue, renderEditReport } from './edit-run.js';

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_EDIT_SEAMS: EditSeams = Object.freeze({});

/** The command, reaching the tracker, the trust and the clock through `seams`; see the module note. */
export function createIssueEditCommand(seams: EditSeams = DEFAULT_EDIT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...ISSUE_EDIT_DECLARATION,
    run: async (context) => {
      const made = await editIssue(context, seams);
      // A conflict carries the report itself; see the module note.
      if (made.exitCode !== 0) throw new CommandExit(made.exitCode, renderEditReport(made).join('\n'));
      if (context.outputMode === 'json') {
        context.output.result(made);
        return;
      }
      for (const line of renderEditReport(made)) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createIssueEditCommand();
export default command;
