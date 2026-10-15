/**
 * `rafa issue edit <n>`: one issue's body appended to, its body
 * replaced, its title changed or its priority set, after four gates, and
 * the outcome (`.rafa/specs/rafa-812-spec-rafa-issue-edit.md`). The run,
 * its gates and its outcomes live in `./edit-run.ts`, and what
 * `--priority` adds to a run in `./edit-priority.ts`; this module
 * declares the command and prints what a run came to.
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

import { ISSUE_PRIORITIES } from '../../adapters/tracker/issue-values.js';

import { PRIORITY_FLAG } from './edit-priority.js';
import { editIssue, renderEditReport } from './edit-run.js';

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_EDIT_SEAMS: EditSeams = Object.freeze({});

/** The command, reaching the tracker, the trust and the clock through `seams`; see the module note. */
export function createIssueEditCommand(seams: EditSeams = DEFAULT_EDIT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue edit',
    subject: 'issue',
    action: 'edit',
    summary: 'append a dated update to an issue body, or replace its body or title, after four gates',
    description: 'Edits one issue on the tracker the chain lands on, after four gates weighed in order, the first'
      + ' refusal ending the run with nothing written and exit code 2: the account editing must have write'
      + ' access or be in board.trustedAuthors; so must the issue\'s author; the text added must leak nothing,'
      + ' and a complete spec must stay complete; and the issue must be open, its labels and saved spec copies'
      + ' allowing the edit. An append (`--append-file` or `--append`, with `--reason`) adds a block'
      + ' `**Updated <YYYY-MM-DD>, <reason>:**` below the body, leaving the original part byte for byte; the'
      + ' same block already closing the body answers `already`. `--replace-file` replaces the body and'
      + ' `--title` the title. `--priority` sets the priority, removes every other and takes the issue out'
      + ' of triage in one write, alone or beside `--title`, weighed by the gates as a title change; a priority'
      + ' the issue already holds alone answers `already`. After the write the issue is read again: a body that no longer holds what was'
      + ' written answers `conflict` with exit code 1, the bodies read before and after saved under'
      + ' `.rafa/scratch/`. An append on an issue already planned answers `stale-copy` and names'
      + ' `rafa plan create --issue=<n> --refresh`, which it never runs. `--dry-run` prints each gate\'s'
      + ' reading and the added part and writes nothing. With `--output=json` the report and the tracker are'
      + ' the data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The issue number on the tracker.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'append-file',
        description: 'A file holding the text to append, read whole; `-` reads standard input.'
          + ' Needs --reason. Not with --append, --replace-file, --title or --priority.',
        type: 'string',
      },
      {
        name: 'append',
        description: 'The text to append. Needs --reason. Not with --append-file, --replace-file, --title or --priority.',
        type: 'string',
      },
      {
        name: 'reason',
        description: 'Why the update was made, written into its heading. Required with an append, refused otherwise.',
        type: 'string',
      },
      {
        name: 'replace-file',
        description: 'A file holding the new body, read whole; `-` reads standard input. Not with an append or --priority.',
        type: 'string',
      },
      {
        name: 'title',
        description: 'The new title, alone or beside --replace-file or --priority. Not with an append.',
        type: 'string',
      },
      {
        name: PRIORITY_FLAG,
        description: `The new priority, one of ${ISSUE_PRIORITIES.join(', ')}: it replaces the one the issue holds and takes`
          + ' the issue out of triage. Alone or beside --title. Not with an append or --replace-file.',
        type: 'string',
      },
      {
        name: 'while-in-development',
        description: 'Allows an append on an issue a loop has claimed, answering stale-copy. Only with an append.',
        type: 'boolean',
      },
      {
        name: 'dry-run',
        description: 'Prints the added part and each gate\'s reading and writes nothing; a refusal still exits 2.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa issue edit 57 --append-file=update.md --reason="scope narrowed"',
        note: 'Appends what update.md holds to #57 below a dated heading naming the reason.',
      },
      {
        cmd: 'rafa issue edit 57 --append="Also covers --dry-run." --reason=clarified --dry-run',
        note: 'Prints each gate\'s reading and the block it would append, and writes nothing.',
      },
      {
        cmd: 'rafa issue edit 57 --title="Faster plan show"',
        note: 'Changes the title of #57 and leaves its body alone.',
      },
      {
        cmd: 'rafa issue edit 57 --priority=high --dry-run',
        note: 'Prints each gate\'s reading and the swap, such as `priority: needs-triage → high`, and writes nothing.',
      },
      {
        cmd: 'rafa issue edit 57 --replace-file=spec.md --output=json',
        note: 'Replaces the body of #57; the report and the tracker are the data of the result event.',
      },
    ],
    outputs: ['text', 'json'],
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
