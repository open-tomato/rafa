/**
 * The seven `epic` commands as declarations: each command less its
 * `run`, with the subject they sit under and the constants their help
 * spells.
 *
 * ## Why the declarations sit apart from the commands
 *
 * A declaration is every field routing, help, `describe` and the spend
 * guard read (`CommandDeclaration`, `@open-tomato/rafa/core/command`).
 * Each module's `createEpic<Action>Command` spreads its declaration
 * under its own `run`, so the command a module exports carries the
 * fields declared here, and a feature list can name, route and render
 * the seven from this file without loading one of their modules. The
 * `epic` lasting alias of `epic show`, which keeps `rafa epics` and
 * `rafa epic` running it, and the `spends` of `epic close` ride on
 * their declarations, so they hold before either module is loaded.
 *
 * ## What this file imports
 *
 * Types alone, from `@open-tomato/rafa/core/command`, and no module
 * under `src/`: a value import of a command's helper would load it
 * with the roster and undo the laziness. `declarations.test.ts` reads
 * this file's imports and holds that.
 *
 * So a constant a declaration spells and a module also reads lives
 * here, and the module imports it from here: `TO_FLAG` (read by
 * `horizon-change.ts` and `move.ts`), `DEFER_TARGETS` and
 * `PROMOTE_TARGETS` (`horizon-change.ts`'s two actions),
 * `DEFAULT_HORIZON` (`new.ts`) and `ACCEPT_UNCHECKED_FLAG` (`close.ts`).
 *
 * The values a declaration spells from outside `src/commands/`, which
 * no file here may import, are copies, and `declarations-integration.test.ts` holds
 * each equal to its source: `EPIC_REASON_FLAG` is `REASON_FLAG`
 * (`packages/rafa-board/src/board/epic-trail.ts`), and `EPIC_HORIZON_WORDS` is `HORIZONS`
 * (`packages/rafa-board/src/board/roadmap-epic-rows.ts`). A module keeps reading the source
 * value for what it checks; the copy is what the help spells.
 */
import type { CommandDeclaration, SubjectSpec } from '@open-tomato/rafa/core/command';

/** The `epic` subject: its routing word and its roster line. */
export const EPIC_SUBJECT: SubjectSpec = Object.freeze({
  name: 'epic',
  summary: 'show one epic\'s issues as the Roadmap table; create an epic; defer or promote it; move an issue to it; close it through the gate or cancel it',
});

/** Every horizon, earliest first: a copy of `HORIZONS`; see the module note. */
export const EPIC_HORIZON_WORDS: readonly string[] = Object.freeze(['now', 'next', 'later']);

/** The flag a reason is given with: a copy of `REASON_FLAG`; see the module note. */
export const EPIC_REASON_FLAG = 'reason';

/** The flag naming the horizon an epic moves to, or the epic an issue moves to. */
export const TO_FLAG = 'to';

/** The horizons `epic defer` takes, in horizon order. */
export const DEFER_TARGETS: readonly ['next', 'later'] = Object.freeze(['next', 'later'] as const);

/** The horizons `epic promote` takes, in horizon order. */
export const PROMOTE_TARGETS: readonly ['now', 'next'] = Object.freeze(['now', 'next'] as const);

/** The horizon a new epic takes when the line names none. */
export const DEFAULT_HORIZON = 'later';

/** The `epic close` flag that closes over the criteria no check could be planned for. */
export const ACCEPT_UNCHECKED_FLAG = 'accept-unchecked';

/** `epic show`, less its `run`. */
export const EPIC_SHOW_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'epic show',
  subject: EPIC_SUBJECT.name,
  action: 'show',
  summary: 'list one epic\'s issues as the Roadmap table: the epic numbered, or the first now epic not done',
  description: 'Prints one epic\'s issues as `rafa roadmap` prints its spec lines, with the spec, blocked by,'
    + ' has and refs columns: the unticked lines of the epic\'s checklist in its order, then its open members'
    + ' missing from the checklist by number. The epic is the type:epic issue numbered, or, with no number,'
    + ' the current place\'s epic, the one `rafa switch` moved to; a place naming a board alone, or no'
    + ' position file, takes the first epic that board (with no position file `roadmap.issue`, else the'
    + ' lowest-numbered open type:roadmap board, else the open issue titled Roadmap) names that is open,'
    + ' horizon:now and not done, the one `rafa next` walks into. The table is headed by the epic\'s title,'
    + ' computed state and done/total, and a stored state disagreeing with the computed one is printed'
    + ' under it. No issue of another epic is named. Each label problem about the epic and each reading that'
    + ' failed is warned about; an unreachable board prints the epic unknown with the reason. With'
    + ' `--output=json` the epic, its rows, its problems and the warnings are the data of the terminal result'
    + ' event. `rafa epics` and `rafa epic` are the same command, typed by the subject alone.',
  args: [
    {
      name: 'n',
      description: 'The epic\'s issue number on the GitHub board. Left out, the current place\'s epic, else the first now epic on its board that is not done.',
      type: 'string',
      required: false,
    },
  ],
  flags: [
    {
      name: 'labels',
      description: 'Print each issue\'s labels on a row of their own under it; they are no column.',
      type: 'boolean',
    },
    {
      name: 'texts',
      description: 'Spell the spec and blocked by columns in words instead of symbols, with no legend.',
      type: 'boolean',
      aliases: ['t'],
    },
    {
      name: 'refresh',
      description: 'Read the whole board again instead of only what changed since the listing kept under .rafa/cache/.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa epic show',
      note: 'Prints the issues of the epic `rafa next` is walking: the first now epic on the Roadmap not done.'
        + ' `rafa epics` prints the same.',
    },
    {
      cmd: 'rafa epic show 252',
      note: 'Prints the issues of epic #252, whatever its horizon, in its checklist\'s order, as `rafa epics 252` does.',
    },
    {
      cmd: 'rafa epic show 252 --output=json',
      note: 'Writes a result event whose data holds epic #252 as computed, its rows and its label problems.',
    },
  ],
  outputs: ['text', 'json'],
  aliases: ['epic'],
  lastingAliases: ['epic'],
});

/** `epic new`, less its `run`. */
export const EPIC_NEW_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'epic new',
  subject: EPIC_SUBJECT.name,
  action: 'new',
  summary: 'create an epic: the issue from the epic template, its line on the current board, and in labels mode its epic:<slug> label',
  description: 'Creates one epic. The label epic:<slug> is created when the repository does not hold it, then'
    + ' the epic issue, titled as given, its body the epic template (acceptance criteria, estimate, date,'
    + ' Owns: and an empty checklist), labelled type:epic, epic:<slug> and horizon:<horizon> in the same'
    + ' command, and last its `- [ ] #<n> <title>` line on the current board, the one `rafa switch` moved'
    + ' to, else the default board. The horizon is later unless `--horizon` says now or next, so a new'
    + ' epic is not picked by the loop unasked. A slug that is not a kebab word (lowercase letters and'
    + ' digits joined by single hyphens) or that an issue already carries as epic:<slug> is refused with'
    + ' exit code 2 before anything is created, as is a board that cannot be read. With `--output=json`'
    + ' the epic, its labels and the board line are the data of the terminal result event. With'
    + ' board.relationships native an epic is named by its number and title: no slug is needed or read, no'
    + ' epic:<slug> label is created or checked, and the issue is labelled type:epic and horizon:<horizon> only.',
  args: [
    {
      name: 'title',
      description: 'The epic\'s title, quoted: one line.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: 'slug',
      description: 'The epic\'s slug, a kebab word such as sign-in: its members carry epic:<slug>. Required in'
        + ' labels mode; not used with board.relationships native.',
      type: 'string',
      required: true,
    },
    {
      name: 'horizon',
      description: `The epic's horizon: one of ${EPIC_HORIZON_WORDS.join(', ')}.`,
      type: 'string',
      default: DEFAULT_HORIZON,
    },
  ],
  examples: [
    {
      cmd: 'rafa epic new "Sign-in without passwords" --slug=passwordless',
      note: 'Creates the label epic:passwordless and the epic, horizon later, and adds its line to the current board.',
    },
    {
      cmd: 'rafa epic new "Billing v2" --slug=billing-v2 --horizon=next',
      note: 'Creates the epic with horizon:next.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `epic defer`, less its `run`. */
export const EPIC_DEFER_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'epic defer',
  subject: EPIC_SUBJECT.name,
  action: 'defer',
  summary: 'move an epic to a later horizon, commenting the reason; ask whether to keep its open work',
  description: 'Swaps the epic\'s horizon: label for horizon:next or horizon:later in one edit and comments'
    + ' "Moved <from> → <to>: <reason>" on it. The reason is --reason, or asked once where there is a'
    + ' terminal; with neither, nothing changes and the question is printed. When the epic is in progress'
    + ' its members\' open branches and pull requests are named and it asks whether to keep them: a no'
    + ' closes each pull request with a comment and deletes no branch, and with no terminal they are kept.'
    + ' An issue that is not an open epic, a target equal to its horizon and one that is not later than it'
    + ' are refused with exit code 2 before anything is written. With `--output=json` the move, the work'
    + ' and what became of it are the data of the terminal result event.',
  args: [
    {
      name: 'n',
      description: 'The epic\'s issue number.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: TO_FLAG,
      description: `The horizon it moves to: one of ${DEFER_TARGETS.join(', ')}. Required.`,
      type: 'string',
      required: true,
    },
    {
      name: EPIC_REASON_FLAG,
      description: 'Why it moves, commented on the epic. Asked once when left out.',
      type: 'string',
    },
  ],
  examples: [
    {
      cmd: 'rafa epic defer 40 --to=later --reason="waiting on #118"',
      note: 'Swaps horizon:now for horizon:later on #40 and comments "Moved now → later: waiting on #118".',
    },
  ],
  outputs: ['text', 'json'],
});

/** `epic promote`, less its `run`. */
export const EPIC_PROMOTE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'epic promote',
  subject: EPIC_SUBJECT.name,
  action: 'promote',
  summary: 'move an epic to an earlier horizon, commenting the reason',
  description: 'Swaps the epic\'s horizon: label for horizon:now or horizon:next in one edit and comments'
    + ' "Moved <from> → <to>: <reason>" on it. The reason is --reason, or asked once where there is a'
    + ' terminal; with neither, nothing changes and the question is printed. An issue that is not an open'
    + ' epic, a target equal to its horizon and one that is not earlier than it are refused with exit code'
    + ' 2 before anything is written. With `--output=json` the move is the data of the terminal result'
    + ' event.',
  args: [
    {
      name: 'n',
      description: 'The epic\'s issue number.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: TO_FLAG,
      description: `The horizon it moves to: one of ${PROMOTE_TARGETS.join(', ')}. Required.`,
      type: 'string',
      required: true,
    },
    {
      name: EPIC_REASON_FLAG,
      description: 'Why it moves, commented on the epic. Asked once when left out.',
      type: 'string',
    },
  ],
  examples: [
    {
      cmd: 'rafa epic promote 40 --to=now --reason="the customer asked"',
      note: 'Swaps horizon:next for horizon:now on #40 and comments "Moved next → now: the customer asked".',
    },
  ],
  outputs: ['text', 'json'],
});

/** `epic move`, less its `run`. */
export const EPIC_MOVE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'epic move',
  subject: EPIC_SUBJECT.name,
  action: 'move',
  summary: 'move an issue to another epic, its label, its checklist line and a comment with the reason',
  description: 'Swaps the issue\'s epic: label for the target epic\'s in one edit, moves its checklist line from'
    + ' the old epic\'s body to the new one\'s keeping every other byte, and comments "Moved from epic #A to #B:'
    + ' <reason>" on the issue, naming its open branches and pull requests, which stay as they are. The issue is'
    + ' never recreated or closed. The reason is --reason, or asked once where there is a terminal; with neither,'
    + ' nothing changes and the question is printed. An issue with no epic: label, a target that is not an open'
    + ' epic and a move to its own epic are refused with exit code 2 before anything is written. With'
    + ' `--output=json` the move and what each write did are the data of the terminal result event. With'
    + ' board.relationships set to native it sets the issue\'s parent to the target epic in one edit instead,'
    + ' and no label or checklist line is read or written; the comment is the same.',
  args: [
    {
      name: 'issue',
      description: 'The number of the issue that moves.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: TO_FLAG,
      description: 'The number of the open epic it moves to. Required.',
      type: 'string',
      required: true,
    },
    {
      name: EPIC_REASON_FLAG,
      description: 'Why it moves, commented on the issue. Asked once when left out.',
      type: 'string',
    },
  ],
  examples: [
    {
      cmd: 'rafa epic move 12 --to=40 --reason="belongs with sign-in"',
      note: 'Swaps #12\'s epic: label for #40\'s, moves its line into #40\'s checklist and comments the move on #12.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `epic close`, less its `run`. */
export const EPIC_CLOSE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'epic close',
  subject: EPIC_SUBJECT.name,
  action: 'close',
  summary: 'close an epic through the gate: every member closed, then its criteria checked against main',
  description: 'Refuses with exit code 2, naming them, while any member of the epic is open. Then one session'
    + ' plans a check for each acceptance criterion, or names it uncheckable with a reason, and each check runs'
    + ' as its own session in a detached worktree of origin/main. Any uncheckable criterion refuses the close'
    + ` before a check runs, unless --${ACCEPT_UNCHECKED_FLAG} is passed; each failed check is filed as a bug, or`
    + ' added as a line to the release\'s stale-docs issue when its criterion names only documentation, and'
    + ' refuses the close. Otherwise the epic is closed as completed with a comment naming each criterion, and'
    + ' what its members cost, summed from the effort store, is printed beside its estimate. With'
    + ' `--output=json` the close is the data of the terminal result event.',
  args: [
    {
      name: 'n',
      description: 'The epic\'s issue number.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: ACCEPT_UNCHECKED_FLAG,
      description: 'Close over the criteria the verification plan could not turn into checks, naming each in the comment.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa epic close 40',
      note: 'Checks #40\'s criteria against origin/main and closes it when every check passes.',
    },
    {
      cmd: `rafa epic close 40 --${ACCEPT_UNCHECKED_FLAG}`,
      note: 'The same, closing over any criterion that could not be turned into a check.',
    },
  ],
  outputs: ['text', 'json'],
  spends: { when: 'always', what: 'one verification planning session and one session per check' },
});

/** `epic cancel`, less its `run`. */
export const EPIC_CANCEL_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'epic cancel',
  subject: EPIC_SUBJECT.name,
  action: 'cancel',
  summary: 'cancel an epic, asking what becomes of each issue outside it that its open members block',
  description: 'Lists every open issue outside the epic whose "Blocked by:" line names one of its open members,'
    + ' and asks for each one: move it to another epic (the same move as rafa epic move), unblock it (an'
    + ' "Updated" note below its body, spec:blocked taken off when nothing else it names is open, and a'
    + ' comment), or cancel it (closed as not planned with a comment). Every answer is taken before any write.'
    + ' Then the epic is closed as not planned with a comment naming what became of each issue; an epic closed'
    + ' as not planned already is not closed again. With no terminal and an issue to ask about, the list is'
    + ' printed and nothing changes. An issue that is not an epic, and an epic closed as completed, are refused'
    + ' with exit code 2. With `--output=json` what each write did is the data of the terminal result event.',
  args: [
    {
      name: 'n',
      description: 'The epic\'s issue number.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: EPIC_REASON_FLAG,
      description: 'Why the epic is cancelled, written in its closing comment.',
      type: 'string',
    },
  ],
  examples: [
    {
      cmd: 'rafa epic cancel 40 --reason="sign-in moved to the platform team"',
      note: 'Asks about each issue #40\'s open members block, then closes #40 as not planned.',
    },
  ],
  outputs: ['text', 'json'],
});
