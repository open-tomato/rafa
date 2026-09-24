/**
 * `rafa roadmap`: the Roadmap issue's lines in its order, as a table —
 * the top-level shortcut for `rafa issue list --roadmap`.
 *
 * A top-level command of its own, its action spelled as its subject, and
 * not an alias of `issue list`: typing an alias prints a deprecation
 * line (`src/cli/dispatch.ts`), and this spelling is not on its way out.
 *
 * ## One run, one flag list
 *
 * Nothing here reads the board or prints a row. The run is
 * `runIssueList` (`./issue/list.ts`) handed the line with `roadmap` set,
 * so every reading, narrowing, refusal, warning and exit code is that
 * command's own, and both spellings print the same bytes for the same
 * line. The flags are `ISSUE_LIST_FLAGS`, the same objects, less the two
 * this command has no use for: `--roadmap`, which it always sets, and
 * `--state`, which `issue list` refuses beside `--roadmap` whatever its
 * value. Typed anyway, `--state` is refused here with that same message,
 * and `--roadmap` changes nothing.
 *
 * A refusal names `issue list`'s usage line, since it is that command's
 * reading of the line that refuses.
 *
 * It starts no session, so it declares no `spends`.
 */
import type { IssueSeams } from './issue/issue-tracker.js';
import type { RafaCommand, RafaFlagSpec } from '../cli/command.js';

import { DEFAULT_ISSUE_SEAMS } from './issue/issue-tracker.js';
import { ISSUE_LIST_FLAGS, runIssueList } from './issue/list.js';

/** The `issue list` flags `rafa roadmap` leaves undeclared: the one it sets, and the one refused beside it. */
const NOT_DECLARED: readonly string[] = ['roadmap', 'state'];

/** The flags `rafa roadmap` declares: `issue list`'s own, in its order, less {@link NOT_DECLARED}. */
export const ROADMAP_FLAGS: readonly RafaFlagSpec[] = Object.freeze(
  ISSUE_LIST_FLAGS.filter((flag) => !NOT_DECLARED.includes(flag.name)),
);

/** The command, reading the board with `seams`; see the module note. */
export function createRoadmapCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'roadmap',
    subject: 'roadmap',
    action: 'roadmap',
    summary: 'list the Roadmap\'s lines in its order, with spec, blocked by, has and refs',
    description: 'Runs `rafa issue list --roadmap` with the flags typed: the unticked lines of the Roadmap issue'
      + ' (`roadmap.issue`, else the open issue titled Roadmap) in its order, read off the GitHub board, as a'
      + ' table with four columns the plain list has not got: spec, whether the body passes the readiness'
      + ' gate; blocked by, each blocker and whether it is open; has, a plan, a branch or a pull request'
      + ' already made for it; and refs, how many references of the issue\'s saved copy under `specs.dir` read'
      + ' suspect or dangling, `-` with no copy. `--all` keeps the ticked lines, and `--type`, `--module`, `--search` and'
      + ' `--limit` narrow the rows, keeping their order. An unreachable board is warned about with the rows'
      + ' still printed. With `--output=json` the roadmap, the rows and the warnings are the data of the'
      + ' terminal result event.',
    args: [],
    flags: [...ROADMAP_FLAGS],
    examples: [
      {
        cmd: 'rafa roadmap',
        note: 'Prints the Roadmap\'s unticked lines in its order, as `rafa issue list --roadmap` does.',
      },
      {
        cmd: 'rafa roadmap --all --type=bug',
        note: 'Prints the bugs on the Roadmap, ticked lines included, in the Roadmap\'s order.',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runIssueList({ ...context, flags: { ...context.flags, roadmap: true } }, seams),
  };
  return Object.freeze(command);
}

export default createRoadmapCommand();
