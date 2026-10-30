/**
 * The nine `issue` commands as declarations: each command less its
 * `run`, with the subject they sit under and the constants their help
 * spells.
 *
 * ## Why the declarations sit apart from the commands
 *
 * A declaration is every field routing, help, `describe` and the spend
 * guard read (`CommandDeclaration`, `@open-tomato/rafa/core/command`).
 * Each module's `createIssue<Action>Command` spreads its declaration
 * under its own `run`, so the command a module exports carries the
 * fields declared here, and a feature list can name, route and render
 * the nine from this file without loading one of their modules.
 *
 * ## What this file imports
 *
 * Types from `@open-tomato/rafa/core/command`, with the one value
 * `HINT_FLAG_SPEC` from the same barrel, and no module under `src/`: a
 * value import of a command's helper would load it with the roster and
 * undo the laziness. `declarations.test.ts` reads this file's imports
 * and holds that.
 *
 * So a constant a declaration spells and a module also reads lives
 * here, and the module imports it from here: `ISSUE_LIST_FLAGS`
 * (`list.ts`, and `src/commands/roadmap.ts`, which declares most of
 * them), `DEFAULT_ISSUE_TYPE` (`create.ts`), `PRIORITY_FLAG`
 * (`edit-priority.ts`), `STAMP_FLAG` (`check.ts`), `READY_YES_FLAG` and
 * `READY_DRY_RUN_FLAG` (`ready.ts`), and `UNBLOCK_ALL_FLAG` and
 * `UNBLOCK_YES_FLAG` (`unblock.ts`).
 *
 * The values a declaration spells from outside `src/commands/`, which
 * no file here may import, are copies, and `declarations-integration.test.ts` holds
 * each equal to its source: `ISSUE_STATE_WORDS`, `ISSUE_TYPE_WORDS` and
 * `ISSUE_PRIORITY_WORDS` are `ISSUE_STATES`, `ISSUE_TYPES` and
 * `ISSUE_PRIORITIES` (`packages/rafa-board/src/adapters/tracker/issue-values.ts`);
 * `ISSUE_TRIAGE_MODULE` is `TRIAGE_MODULE`
 * (`packages/rafa/src/triage/filed-text.ts`);
 * `ISSUE_READY_LABEL`, `ISSUE_NEEDS_WORK_LABEL` and
 * `ISSUE_BLOCKED_LABEL` are `SPEC_READY_LABEL`
 * (`packages/rafa-board/src/board/readiness.ts`), `SPEC_NEEDS_WORK_LABEL`
 * (`packages/rafa-board/src/board/gate.ts`) and `SPEC_BLOCKED_LABEL`
 * (`packages/rafa-board/src/board/blocked.ts`). A module keeps reading the source value for
 * what it checks; the copy is what the help spells.
 *
 * The `--no-hint` flag `issue ready` declares is no copy: it is
 * `HINT_FLAG_SPEC` itself, core's one spelling of it, which the other
 * five commands that end with a hint declare too.
 */
import type { CommandDeclaration, RafaFlagSpec, SubjectSpec } from '@open-tomato/rafa/core/command';

import { HINT_FLAG_SPEC } from '@open-tomato/rafa/core/command';

/** The `issue` subject: its routing word and its roster line. */
export const ISSUE_SUBJECT: SubjectSpec = Object.freeze({
  name: 'issue',
  summary: 'the tracker: list, show, create, edit, comment on and move issues; mark one ready, unblock it and check its references',
});

/** Every issue state, in lifecycle order: a copy of `ISSUE_STATES`; see the module note. */
export const ISSUE_STATE_WORDS: readonly string[] = Object.freeze([
  'backlog',
  'todo',
  'in-progress',
  'in-review',
  'done',
  'released',
  'cancelled',
]);

/** Every issue type, `epic` and `spec` last: a copy of `ISSUE_TYPES`; see the module note. */
export const ISSUE_TYPE_WORDS: readonly string[] = Object.freeze([
  'code',
  'bug',
  'spike',
  'adr',
  'chore',
  'package-api',
  'epic',
  'spec',
]);

/** Every priority, most urgent first: a copy of `ISSUE_PRIORITIES`; see the module note. */
export const ISSUE_PRIORITY_WORDS: readonly string[] = Object.freeze([
  'urgent',
  'high',
  'medium',
  'low',
]);

/** The module an issue filed with no `--module` belongs to: a copy of `TRIAGE_MODULE`; see the module note. */
export const ISSUE_TRIAGE_MODULE = 'unassigned';

/** The label `issue ready` adds: a copy of `SPEC_READY_LABEL`; see the module note. */
export const ISSUE_READY_LABEL = 'spec:ready';

/** The label `issue ready` removes: a copy of `SPEC_NEEDS_WORK_LABEL`; see the module note. */
export const ISSUE_NEEDS_WORK_LABEL = 'spec:needs-work';

/** The label `issue unblock` takes off: a copy of `SPEC_BLOCKED_LABEL`; see the module note. */
export const ISSUE_BLOCKED_LABEL = 'spec:blocked';

/** The type an issue filed with no `--type` is of. */
export const DEFAULT_ISSUE_TYPE = 'code';

/** The flag `issue edit` sets a priority with. */
export const PRIORITY_FLAG = 'priority';

/** The flag `issue check` re-stamps every reference with. */
export const STAMP_FLAG = 'stamp';

/** The `issue ready` flag that marks the issue with no question once every check passes. */
export const READY_YES_FLAG = 'yes';

/** The `issue ready` flag that makes every check and prints it, asking nothing and writing nothing. */
export const READY_DRY_RUN_FLAG = 'dry-run';

/** The `issue unblock` flag that reads every open blocked issue. */
export const UNBLOCK_ALL_FLAG = 'all';

/** The `issue unblock` flag that answers every question yes without putting it. */
export const UNBLOCK_YES_FLAG = 'yes';

/** The flags `issue list` declares, `--roadmap`, `--all`, `--full` and `--check` first. */
export const ISSUE_LIST_FLAGS: readonly RafaFlagSpec[] = Object.freeze([
  {
    name: 'roadmap',
    description: 'List the unticked lines of the Roadmap issue instead, in its order, with the spec, blocked by,'
      + ' has and refs columns, and the epics it names grouped by horizon. Reads the GitHub board whatever'
      + ' tracker the chain lands on.',
    type: 'boolean',
  },
  {
    name: 'all',
    description: 'With --roadmap, keep the ticked lines too, each in its place, and show the epics of every'
      + ' horizon, not only now. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'full',
    description: 'With --roadmap, print each epic\'s issues under its row, on two rows each: number, state and'
      + ' title, then labels and blockers. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'check',
    description: 'With --roadmap, exit 1 when any type:epic issue on the board is open with its work done, or'
      + ' closed with it not done, or when the board could not be read, naming each. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'labels',
    description: 'With --roadmap, print each issue\'s labels on a row of their own under it, and under each --full'
      + ' member; they are no column. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'texts',
    description: 'With --roadmap, spell the spec and blocked by columns in words instead of symbols, with no legend.'
      + ' Refused without --roadmap.',
    type: 'boolean',
    aliases: ['t'],
  },
  {
    name: 'refresh',
    description: 'With --roadmap, read the whole board again instead of only what changed since the listing kept'
      + ' under .rafa/cache/. Refused without --roadmap.',
    type: 'boolean',
  },
  {
    name: 'state',
    description: `Only issues in this state: one of ${ISSUE_STATE_WORDS.join(', ')}. Refused on the github tracker`
      + ' and beside --roadmap.',
    type: 'string',
  },
  {
    name: 'type',
    description: `Only issues of this type: one of ${ISSUE_TYPE_WORDS.join(', ')}.`,
    type: 'string',
  },
  {
    name: 'module',
    description: 'Only issues of this module.',
    type: 'string',
  },
  {
    name: 'search',
    description: 'Only issues whose title or body holds this text.',
    type: 'string',
  },
  {
    name: 'limit',
    description: 'At most this many issues, a positive whole number. The limit of the tracker when left out,'
      + ' and none under --roadmap.',
    type: 'number',
  },
]);

/** `issue list`, less its `run`. */
export const ISSUE_LIST_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'issue list',
  subject: ISSUE_SUBJECT.name,
  action: 'list',
  summary: 'list the issues on the tracker, or the Roadmap\'s lines in its order, narrowed by type, module or text',
  description: 'Lists the issues on the tracker `tracker.default` names in `.rafa/config.yaml`, or on the first'
    + ' `tracker.fallback` kind whose preflight passes when it fails, each kind passed over warned about.'
    + ' Prints the tracker, then one row per issue: its id, state, type and title; under `--type=bug`, a header'
    + ' and the columns id, state, module, action and summary, read back from each title. Each flag narrows the'
    + ' list, and a flag left out narrows by nothing. The github tracker holds an issue open or closed, so'
    + ' it refuses `--state`, and lists 30 issues unless `--limit` says otherwise. With `--roadmap` it lists'
    + ' the unticked lines of the Roadmap issue (`roadmap.issue`, else the lowest-numbered open type:roadmap'
    + ' board, else the open issue titled Roadmap) in its'
    + ' order instead, read off the GitHub board, as a table adding four columns: spec, whether the issue'
    + ' can be planned (every section of the spec template filled, and the spec:ready label on it), as a'
    + ' symbol; blocked by, the blockers grouped by whether they are still open;'
    + ' has, a plan, a branch or a pull request already made for it; and refs, how many references of the'
    + ' issue\'s saved copy under `specs.dir` read suspect or dangling, `-` with no copy. A legend names each'
    + ' symbol, `--texts` (`-t`) spells them in words, and `--labels` prints the labels on a row under each'
    + ' issue. A Roadmap naming epics prints them alone, grouped by horizon under a `Roadmap #<n> · <horizon>`'
    + ' heading with the columns #, state, done/total, blocked, date and title, the now horizon only unless'
    + ' `--all`, with one line counting the lines naming no epic; `--full` prints each epic\'s issues under'
    + ' its row, and the lines naming no epic as the table. The board listing is kept under .rafa/cache/ and'
    + ' read for what changed since; `--refresh` reads the whole board again. `--check` exits 1 when any'
    + ' type:epic issue\'s stored state'
    + ' disagrees with its computed one. `--type`, `--module`, `--search` and `--limit` then narrow the spec rows, keeping their'
    + ' order, and an unreachable board is warned about with the rows still printed. With `--output=json`'
    + ' the tracker, the query and every issue, or under `--roadmap` the roadmap, the rows, the epics and the'
    + ' warnings, are the data of the terminal result event.',
  args: [],
  flags: [...ISSUE_LIST_FLAGS],
  examples: [
    {
      cmd: 'rafa issue list',
      note: 'Lists the issues on the tracker the chain lands on, one row each.',
    },
    {
      cmd: 'rafa issue list --type=bug --search=timeout',
      note: 'Lists the bugs whose title or body holds the word timeout, in the columns id, state, module, action and summary.',
    },
    {
      cmd: 'rafa issue list --limit=5 --output=json',
      note: 'Writes a start event, then a result event whose data holds the tracker, the query and five issues at most.',
    },
    {
      cmd: 'rafa issue list --roadmap',
      note: 'Prints the Roadmap\'s unticked lines in its order, with the spec, blocked by, has and refs of each.',
    },
    {
      cmd: 'rafa issue list --roadmap --full',
      note: 'Prints the Roadmap\'s now epics with each epic\'s issues underneath, then its spec lines.',
    },
    {
      cmd: 'rafa issue list --roadmap --check',
      note: 'Prints the Roadmap, then exits 1 when an epic is open with its work done or closed with it not done.',
    },
    {
      cmd: 'rafa issue list --roadmap --all --type=bug',
      note: 'Prints the bugs on the Roadmap, ticked lines included, in the Roadmap\'s order, beside its epics of every horizon.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `issue show`, less its `run`. */
export const ISSUE_SHOW_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'issue show',
  subject: ISSUE_SUBJECT.name,
  action: 'show',
  summary: 'show one issue on the tracker: its fields, then its body',
  description: 'Reads one issue on the tracker `tracker.default` names in `.rafa/config.yaml`, or on the first'
    + ' `tracker.fallback` kind whose preflight passes when it fails, each kind passed over warned about.'
    + ' The id is the issue number on that tracker, so on a tracker fallen back to it names a different'
    + ' issue. Prints the tracker, the id, the URL when there is one, the title, state, type, module and'
    + ' priority, then the body. With `--output=json` the tracker and the issue are the data of the'
    + ' terminal result event.',
  args: [
    {
      name: 'id',
      description: 'The issue id on the tracker: a GitHub issue number, or the number of a file under `.rafa/issues/`.',
      type: 'string',
      required: true,
    },
  ],
  flags: [],
  examples: [
    {
      cmd: 'rafa issue show 12',
      note: 'Prints issue 12 on the tracker the chain lands on, its fields and then its body.',
    },
    {
      cmd: 'rafa issue show 12 --output=json',
      note: 'Writes a start event, then a result event whose data holds the tracker and the issue.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `issue create`, less its `run`. */
export const ISSUE_CREATE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'issue create',
  subject: ISSUE_SUBJECT.name,
  action: 'create',
  summary: 'create an issue on the tracker from a title and a body, a bug from its fields',
  description: 'Files one issue on the tracker `tracker.default` names in `.rafa/config.yaml`, or on the first'
    + ' `tracker.fallback` kind whose preflight passes when it fails, each kind passed over warned about.'
    + ' `--title` is required for every type but `bug`. The issue is of type `code` and module `unassigned` unless'
    + ' `--type` and `--module` say otherwise, and with no `--priority` the tracker marks it needs-triage. A'
    + ' `--type=bug` line is filed from its fields: `--module`, `--action`, `--summary`, `--cause` and'
    + ' `--reproduce`, each also read from a section of the body, with rafa filling the versions and the place,'
    + ' rendering the title through `issues.titles.bug` and refusing a record missing a field, naming each. The body is'
    + ' `--body`, or what the file `--body-file` names holds, standard input for `-`. A spec whose body'
    + ' carries a `Blocked by: #24` line is filed blocked, and refused when the line names no issue, the'
    + ' issue itself or an issue the board does not hold. With `board.project.number` set, a GitHub issue is'
    + ' added to the project and its fields filled, any failure there a warning that keeps the exit code. Prints the'
    + ' tracker and id of the issue filed, and its URL when there is one. With `--output=json` the tracker'
    + ' and the ref are the data of the terminal result event. `--dry-run` prints the title and body the line'
    + ' would file, resolves no tracker and files nothing.',
  args: [],
  flags: [
    {
      name: 'title',
      description: 'The title of the issue. Required for every type but bug, whose title is rendered from its fields.',
      type: 'string',
    },
    {
      name: 'body',
      description: 'The body of the issue, as markdown. Empty when left out. Not with --body-file.',
      type: 'string',
    },
    {
      name: 'body-file',
      description: 'A file holding the body of the issue, read whole; `-` reads standard input. Not with --body.',
      type: 'string',
    },
    {
      name: 'type',
      description: `What the issue is for: one of ${ISSUE_TYPE_WORDS.join(', ')}.`,
      type: 'string',
      default: DEFAULT_ISSUE_TYPE,
    },
    {
      name: 'module',
      description: `The module the issue belongs to; ${ISSUE_TRIAGE_MODULE} when left out. A bug names one, or unknown.`,
      type: 'string',
    },
    {
      name: 'priority',
      description: `How urgent the issue is: one of ${ISSUE_PRIORITY_WORDS.join(', ')}. Marked needs-triage when left out.`,
      type: 'string',
    },
    {
      name: 'summary',
      description: 'A bug: one line saying what is wrong, the last part of its title.',
      type: 'string',
    },
    {
      name: 'action',
      description: 'A bug: what was running, a command, a step or a test; or unknown.',
      type: 'string',
    },
    {
      name: 'cause',
      description: 'A bug: its cause code from `rafa bug codes`, or <family>:new-context when no leaf fits.',
      type: 'string',
    },
    {
      name: 'proposed',
      description: 'A bug: beside a new-context cause, the leaf you would have used, as <family>:<leaf>.',
      type: 'string',
    },
    {
      name: 'reproduce',
      description: 'A bug: the steps, or the condition that revealed it. Never unknown.',
      type: 'string',
    },
    {
      name: 'rerun',
      description: 'A bug: one command that shows it again.',
      type: 'string',
    },
    {
      name: 'env',
      description: 'A bug: the place it was seen, one of local, ci, prod, a place `issues.environments` adds, or'
        + ' unknown. Left out, ci when the CI variable is set and local otherwise.',
      type: 'string',
    },
    {
      name: 'project',
      description: 'A bug: the project, where one tracker holds several.',
      type: 'string',
    },
    {
      name: 'path',
      description: 'A bug: the file the error points at, which names the package its Versions section holds. Left'
        + ' out, the first file of the project the artifact names.',
      type: 'string',
    },
    {
      name: 'dry-run',
      description: 'Print the title and the body the line would file, resolve no tracker and file nothing.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa issue create --type=bug --module=loop --action=start --summary="resume does not find the worktree branch"'
        + ' --reproduce="rafa loop start --continue after a stop" --cause=git:new-context --proposed=git:branch-not-found --dry-run',
      note: 'Prints the title `loop - start: resume does not find the worktree branch` and the body of the bug, and files nothing.',
    },
    {
      cmd: 'rafa issue create --title="Document issue move" --priority=low --output=json',
      note: 'Writes a start event, then a result event whose data holds the tracker and the ref of the issue.',
    },
    {
      cmd: 'rafa issue create --title="Faster plan show" --body-file=spec.md',
      note: 'Files an issue whose body is what spec.md holds; --body-file=- reads it from standard input.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `issue comment`, less its `run`. */
export const ISSUE_COMMENT_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'issue comment',
  subject: ISSUE_SUBJECT.name,
  action: 'comment',
  summary: 'comment on one issue on the tracker',
  description: 'Posts `--body` as a comment on one issue on the tracker `tracker.default` names in'
    + ' `.rafa/config.yaml`, or on the first `tracker.fallback` kind whose preflight passes when it fails,'
    + ' each kind passed over warned about. The id is the issue number on that tracker, so on a tracker'
    + ' fallen back to it names a different issue. With `--output=json` the tracker and the ref commented'
    + ' on are the data of the terminal result event.',
  args: [
    {
      name: 'id',
      description: 'The issue id on the tracker: a GitHub issue number, or the number of a file under `.rafa/issues/`.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: 'body',
      description: 'The comment, as markdown. Required.',
      type: 'string',
      required: true,
    },
  ],
  examples: [
    {
      cmd: 'rafa issue comment 12 --body="Seen again after the retry change."',
      note: 'Posts one comment on issue 12 on the tracker the chain lands on.',
    },
    {
      cmd: 'rafa issue comment 12 --body=Reproduced --output=json',
      note: 'Writes a start event, then a result event whose data holds the tracker and the ref commented on.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `issue move`, less its `run`. */
export const ISSUE_MOVE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'issue move',
  subject: ISSUE_SUBJECT.name,
  action: 'move',
  summary: 'move one issue on the tracker to a state',
  description: 'Moves one issue on the tracker `tracker.default` names in `.rafa/config.yaml`, or on the first'
    + ' `tracker.fallback` kind whose preflight passes when it fails, each kind passed over warned about,'
    + ` to one of the states ${ISSUE_STATE_WORDS.join(', ')}. The id is the issue number on that tracker, so on`
    + ' a tracker fallen back to it names a different issue. The github tracker holds an issue open or'
    + ' closed, so it warns for backlog, in-progress, in-review and released, which it cannot hold, and'
    + ' still exits 0. With `--output=json` the tracker, the ref, the state and the warning are the data'
    + ' of the terminal result event.',
  args: [
    {
      name: 'id',
      description: 'The issue id on the tracker: a GitHub issue number, or the number of a file under `.rafa/issues/`.',
      type: 'string',
      required: true,
    },
    {
      name: 'state',
      description: `The state to move the issue to: one of ${ISSUE_STATE_WORDS.join(', ')}.`,
      type: 'string',
      required: true,
    },
  ],
  flags: [],
  examples: [
    {
      cmd: 'rafa issue move 12 done',
      note: 'Moves issue 12 to done, which closes it on the github tracker.',
    },
    {
      cmd: 'rafa issue move 12 in-progress --output=json',
      note: 'Writes a start event, then a result event whose data holds the tracker, the ref, the state and any warning.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `issue ready`, less its `run`. */
export const ISSUE_READY_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'issue ready',
  subject: ISSUE_SUBJECT.name,
  action: 'ready',
  summary: `mark an issue ${ISSUE_READY_LABEL} once its author and its body check out`,
  description: 'Reads the issue on the GitHub board, refuses one opened by an account without write access to'
    + ' the repository, refuses a body that does not fill the spec template, refuses an issue carrying two'
    + ' `epic:` labels (with board.relationships set to labels, the default), and then asks whether to mark it'
    + ` ${ISSUE_READY_LABEL}. On a yes it swaps the labels in one write, adding ${ISSUE_READY_LABEL} and`
    + ` removing ${ISSUE_NEEDS_WORK_LABEL}. \`--yes\` makes the swap with no question once every check passes,`
    + ' with or without a terminal, and refuses everything the checks refuse without it; without a terminal and'
    + ' without `--yes` it prints both readings and adds no label. A run that marks the issue, or finds'
    + ' it marked already, ends by naming the one step that follows, which `--no-hint` turns off.'
    + ' `--dry-run` makes every check and prints both readings, asking nothing and writing nothing whatever'
    + ' the terminal, exits 2 on a check that refuses, and is refused beside `--yes`. With'
    + ' `--output=json` the report is the data of the terminal result event.',
  args: [
    {
      name: 'n',
      description: 'The issue number on the GitHub board.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: READY_YES_FLAG,
      description: `Marks the issue ${ISSUE_READY_LABEL} without asking, once its author and its body check out;`
        + ' a check that refuses still refuses. Needed where standard input is no terminal.',
      type: 'boolean',
    },
    {
      name: READY_DRY_RUN_FLAG,
      description: 'Prints both readings and writes nothing, asking no question whatever the terminal;'
        + ' a check that refuses still exits 2. Not with --yes.',
      type: 'boolean',
    },
    HINT_FLAG_SPEC,
  ],
  examples: [
    {
      cmd: 'rafa issue ready 57',
      note: `Checks #57 and asks whether to mark it ${ISSUE_READY_LABEL}.`,
    },
    {
      cmd: 'rafa issue ready 57 --yes',
      note: `Checks #57 and marks it ${ISSUE_READY_LABEL} with no question, from a script or an agent.`,
    },
    {
      cmd: 'rafa issue ready 57 --dry-run',
      note: 'Checks #57 and reads its status in one line, from a script, an agent or CI, marking nothing.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `issue unblock`, less its `run`. */
export const ISSUE_UNBLOCK_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'issue unblock',
  subject: ISSUE_SUBJECT.name,
  action: 'unblock',
  summary: `take ${ISSUE_BLOCKED_LABEL} off an issue whose blockers have all closed`,
  description: `Reads the "Blocked by: #24 #26" line of an issue labelled ${ISSUE_BLOCKED_LABEL} on the GitHub`
    + ' board, asks the board for each blocker\'s state, and when every blocker is closed asks whether to'
    + ` remove ${ISSUE_BLOCKED_LABEL} and removes it on a yes. With a blocker still open it names it and`
    + ` changes nothing. An issue labelled ${ISSUE_BLOCKED_LABEL} whose "Blocked by:" line is missing, names`
    + ' itself or names an id the board has no issue for is reported and never guessed at. Without a'
    + ' terminal and without `--yes` it asks nothing and writes nothing. `--yes` answers the question yes'
    + ' without putting it, terminal or not, and names the blockers it read closed; it never removes'
    + ` ${ISSUE_BLOCKED_LABEL} from an issue with a blocker open or a line it refuses to guess at.`
    + ' With `--output=json` the outcome of each issue is the'
    + ' data of the terminal result event. With board.relationships set to native it reads nothing and'
    + ' writes nothing: GitHub clears a blocker by itself when the blocking issue closes.',
  args: [
    {
      name: 'n',
      description: 'The issue number on the GitHub board. Left out, `--all` reads every blocked issue.',
      type: 'string',
      required: false,
    },
  ],
  flags: [
    {
      name: UNBLOCK_ALL_FLAG,
      description: `Read every open issue labelled ${ISSUE_BLOCKED_LABEL}, asking about each one in turn.`,
      type: 'boolean',
    },
    {
      name: UNBLOCK_YES_FLAG,
      description: `Answer the question yes without putting it, so ${ISSUE_BLOCKED_LABEL} comes off every issue`
        + ' whose blockers are all closed, with no terminal needed. An open blocker or an unreadable'
        + ' "Blocked by:" line still changes nothing.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa issue unblock 57',
      note: `Asks whether to remove ${ISSUE_BLOCKED_LABEL} from #57 when every issue its "Blocked by:" line names is closed.`,
    },
    {
      cmd: 'rafa issue unblock 57 --yes',
      note: `Removes ${ISSUE_BLOCKED_LABEL} from #57 with no question when every blocker it names is closed.`,
    },
    {
      cmd: 'rafa issue unblock --all',
      note: 'Walks every open blocked issue on the board, asking about each one whose blockers have all closed.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `issue check`, less its `run`. */
export const ISSUE_CHECK_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'issue check',
  subject: ISSUE_SUBJECT.name,
  action: 'check',
  summary: 'read the references a spec\'s saved copy names, each with its state',
  description: 'Reads the saved copy of issue <n> under `specs.dir` and prints every reference it names — an'
    + ' issue, a file, a declared symbol, a command, a flag, a config key — with its state against the'
    + ' stamp the copy keeps: ok, new, dangling, suspect, resolved or unknown. A reference the copy keeps no'
    + ' stamp for is stamped on this read. Exits 0 whatever the states are, and plans nothing. A missing'
    + ' saved copy is refused, naming the `rafa plan create --issue=<n>` that writes one. With'
    + ' `--output=json` every reference, with its kind, line, state and fingerprint, is the data of the'
    + ' terminal result event.',
  args: [
    {
      name: 'n',
      description: 'The issue number on the GitHub board whose saved copy is read.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: STAMP_FLAG,
      description: 'Re-stamp every reference with what its target holds now, so the next check reads each one ok.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa issue check 151',
      note: 'Prints each reference the saved copy of #151 names with its state, and a count per state.',
    },
    {
      cmd: 'rafa issue check 151 --stamp',
      note: 'Prints the same reading, then re-stamps every reference as reviewed without planning.',
    },
    {
      cmd: 'rafa issue check 151 --output=json',
      note: 'Writes a start event, then a result event whose data lists every reference with its kind, line, state and fingerprint.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `issue edit`, less its `run`. */
export const ISSUE_EDIT_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'issue edit',
  subject: ISSUE_SUBJECT.name,
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
      description: `The new priority, one of ${ISSUE_PRIORITY_WORDS.join(', ')}: it replaces the one the issue holds and takes`
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
});
