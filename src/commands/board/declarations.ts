/**
 * The two `board` commands as declarations: each command less its
 * `run`, with the subject they sit under and the flag their help spells.
 *
 * ## Why the declarations sit apart from the commands
 *
 * A declaration is every field routing, help, `describe` and the spend
 * guard read (`CommandDeclaration`, `@open-tomato/rafa/core/command`).
 * `createBoardListCommand` and `createBoardSyncCommand` each spread
 * their declaration under their own `run`, so the command a module
 * exports carries the fields declared here, and `BOARD_FEATURE`
 * (`./index.ts`) can name, route and render the two without loading
 * either module. Neither starts a session, so neither declares `spends`.
 *
 * ## What this file imports
 *
 * Types alone, from `@open-tomato/rafa/core/command`, and no module
 * under `src/`: a value import of a command's helper would load it with
 * the roster and undo the laziness. So the one constant a declaration
 * spells and a module also reads lives here, and the module imports it
 * from here: `BOARD_SYNC_DRY_RUN_FLAG` (`sync.ts`).
 */
import type { CommandDeclaration, SubjectSpec } from '@open-tomato/rafa/core/command';

/** The `board` subject: its routing word and its roster line. */
export const BOARD_SUBJECT: SubjectSpec = Object.freeze({
  name: 'board',
  summary: 'list the boards with their owner, epic count, and which is current and home; sync the GitHub project',
});

/** The flag of `board sync` that reads without writing. */
export const BOARD_SYNC_DRY_RUN_FLAG = 'dry-run';

/** `rafa board list`: see `list.ts` for what it reads and prints. */
export const BOARD_LIST_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'list',
  subject: 'board',
  action: 'list',
  summary: 'list the open boards with their owner, epic count, and the current and home marks',
  description: 'Lists every open type:roadmap board, lowest number first, and the default board when it is an'
    + ' unlabelled issue titled "Roadmap" or the roadmap.issue the project names. Each line holds the board\'s'
    + ' number and title, the owner its Owner: line names (followed by (unresolved) when GitHub knows no such'
    + ' account or team, and by (unknown) when it could not be asked), the number of epics its checklist names,'
    + ' and `current` and `home` on the boards this checkout\'s position holds. With no position file both are'
    + ' the default board. Writes nothing. A board listing that cannot be read is refused with exit code 2.'
    + ' With `--output=json` the rows and the two places are the data of the terminal result event.',
  args: [],
  flags: [],
  examples: [
    {
      cmd: 'rafa board list',
      note: 'Lists the open boards, marking the one this checkout is on and its home.',
    },
    {
      cmd: 'rafa board list --output=json',
      note: 'Gives the same rows, each owner with what GitHub answered for it, as the terminal result.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `rafa board sync [--dry-run]`: see `sync.ts` for what it reads and writes. */
export const BOARD_SYNC_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'sync',
  subject: 'board',
  action: 'sync',
  summary: 'bring the repository\'s GitHub project in step with its issues',
  description: 'Refreshes every item of this repository on the GitHub project board.project.number names, writing'
    + ' only the Stage, Horizon, Rank, Blocked by and Progress values that differ from what rafa reads of the'
    + ' issues, then adds every open issue missing from the project and fills its fields. It repairs what changed'
    + ' outside rafa: a label edited in the web UI, an issue closed by hand, the Roadmap issue\'s order edited in'
    + ' its body. Prints one line per change and per issue added, then a closing count of the changes written'
    + ' and of the issues added and filled. An issue added whose fields could not be filled is counted apart'
    + ' and named in a warning, `#<n> added but not filled: <reason>`; the next run fills it. With `--dry-run` it'
    + ' prints the same lines and writes nothing. With `--output=json` the changes are the data of the terminal'
    + ' result event. An issue whose facts could not be read is named in a warning, `#<n> not refreshed:'
    + ' <reason>`, while the others are synced; the exit code stays 0 and the next run reads it again. Adding'
    + ' the issues, reading their facts and writing their fields each print a start line with the total, a'
    + ' progress line at most every board.project.progressSeconds, as `reading facts: 146/283, 6m 40s`, and an'
    + ' end line; with `--output=json` each is a `progress` event. Refused'
    + ' with exit code 1 when board.project.number is unset, and with exit code 2 when the token lacks the'
    + ' project scope, the number names no project, or the rate limit stopped the writes.',
  args: [],
  flags: [
    {
      name: BOARD_SYNC_DRY_RUN_FLAG,
      description: 'Print each change the sync would make and each issue it would add, and write nothing.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa board sync --dry-run',
      note: 'Shows what drifted on the project since rafa last wrote it, writing nothing.',
    },
    {
      cmd: 'rafa board sync',
      note: 'Writes those changes and adds the open issues the project lacks.',
    },
    {
      cmd: 'rafa board sync --output=json',
      note: 'Gives the changes, the issues added, those of them filled and the counts as the terminal result.',
    },
  ],
  outputs: ['text', 'json'],
});
