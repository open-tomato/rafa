/**
 * `rafa instinct check <dir>`: the checker over an instincts
 * directory, `~/.rafa/instincts` or a project's `.rafa/instincts`.
 *
 * The same five checks `rafa skill check` runs, with the instinct
 * schema in place of the skill one: the required fields, `confidence`
 * in range, and `evidence` non-empty for a record carrying
 * `source: task-report`. The layout rule is the only one instincts
 * have — a record is `<dir>/<id>.md`, flat, and a `.md` below the top
 * level is named `nested-instinct-file`. The directory also holds the
 * local Learning adapter's `instincts.ndjson` and `flags.ndjson`,
 * which are no records and are passed over without a word.
 *
 * ## It declares no flag
 *
 * `--fix` fills `tags` and `stack`, which are a skill's fields and not
 * a record's, so there is nothing here for it to fill. `--project` is
 * left out with it: an instinct body is a trigger and an action, not a
 * procedure naming a checkout's files, so every project-looking path
 * one holds is counted `unchecked-path`, a warning that never reaches
 * the exit code. A record naming a tool in a fenced shell command
 * still has that tool looked up on `PATH`, and one naming an absolute
 * path under a home still fails locality: neither needs a project.
 *
 * ## The exit code
 *
 * The number of failing records, capped at 255. Exit code 1 is a
 * refusal: no directory on the line, a second word, or a path that is
 * no directory.
 */
import type { RafaCommand } from '../../cli/command.js';
import type { CheckCommandSeams } from '../check-report.js';

import { checkCommandRun, DEFAULT_CHECK_SEAMS, INSTINCT_CHECK_USAGE } from '../check-report.js';

/** The command, resolving relative paths through `seams`. See the module note. */
export function createInstinctCheckCommand(seams: CheckCommandSeams = DEFAULT_CHECK_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'instinct check',
    subject: 'instinct',
    action: 'check',
    summary: 'check every record under an instincts directory against the instinct schema',
    description: 'Runs the checker over an instincts directory, `~/.rafa/instincts` or a project\'s'
      + ' `.rafa/instincts`, with every check run on every record so one run names every rule a record'
      + ' breaks: layout (a record is `<dir>/<id>.md`, flat, and its frontmatter `id` is its file name),'
      + ' the instinct schema (the required fields, `confidence` in range, and `evidence` non-empty for'
      + ' `source: task-report`), and the resolution and locality of what its body names. The Learning'
      + ' adapter\'s `instincts.ndjson` and `flags.ndjson` are no records and are passed over. The exit'
      + ' code is the number of failing records, capped at 255, and warnings never count. It declares no'
      + ' flag: `--fix` fills a skill\'s fields, and with no project root a project-looking path is left'
      + ' unchecked. With `--output=json` a clean run gives the reports as the data of the terminal result'
      + ' event.',
    args: [
      {
        name: 'dir',
        description: 'The instincts directory to check: `~/.rafa/instincts`, or a project\'s `.rafa/instincts`.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa instinct check .rafa/instincts',
        note: 'Checks this project\'s records, exiting with the number that broke a rule.',
      },
      {
        cmd: 'rafa instinct check ~/.rafa/instincts --output=json',
        note: 'Writes a start event, then a result event whose data is the reports, when none of them failed.',
      },
    ],
    outputs: ['text', 'json'],
    needsProject: false,
    run: checkCommandRun({ kind: 'instinct', usage: INSTINCT_CHECK_USAGE, writes: false }, seams),
  };
  return Object.freeze(command);
}

export default createInstinctCheckCommand();
