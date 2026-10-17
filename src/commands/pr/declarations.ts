/**
 * The ten `pr` commands as declarations: each command less its `run`,
 * with the subject they sit under and the constants their help spells.
 *
 * ## Why the declarations sit apart from the commands
 *
 * A declaration is every field routing, help, `describe` and the spend
 * guard read (`CommandDeclaration`, `@open-tomato/rafa/core/command`).
 * `index.ts` beside this file builds `PR_FEATURE` from these, each
 * command made by `lazyCommand` over a dynamic import of its module, so
 * the roster names, routes and renders the ten without loading one. Each
 * module's `createPr<Action>Command` spreads its declaration under its
 * own `run`, so the command a module exports and the one the feature
 * declares carry the same fields: `index.test.ts` holds every loaded
 * command, less its `run`, equal to its declaration.
 *
 * ## What this file imports
 *
 * Types from `@open-tomato/rafa/core/command` and
 * `@open-tomato/rafa/core/config`, the one value `HINT_FLAG_SPEC` from
 * the command barrel, and no module under `src/`: a value import of a
 * command's helper would load it with the roster and undo the laziness.
 * `declarations.test.ts` reads this file's imports and holds that.
 *
 * So a constant a declaration spells and a module also reads lives here,
 * and the module imports it from here: `PR_SHOW_JSON_FIELDS` (`show.ts`),
 * `WAIT_TIMEOUT_FLAG` and `DEFAULT_WAIT_TIMEOUT_MIN` (`wait.ts`),
 * `ALLOW_LOCAL_CONFIG_FLAG` (`triage.ts`, `triage-config-trust.ts`),
 * `DEFAULT_MAX_ATTEMPTS` (`triage.ts`) and `MERGE_DANGEROUS_PHRASES`,
 * the `dangerous` field of `pr merge`, read by `merge-guard.ts`'s note.
 *
 * The `--no-hint` flag `pr wait`, `pr merge` and `pr triage` declare is
 * `HINT_FLAG_SPEC` itself, core's one spelling of it, which the other
 * three commands that end with a hint declare too.
 *
 * One value is a copy of a value outside `src/commands/`, which no file
 * here may import, and `declarations.test.ts` holds it equal to its
 * source: `DEFAULT_WAIT_TIMEOUT_MIN` is the loop's own CI deadline,
 * `DEFAULT_CI_TIMEOUT_MIN` (`src/start/pr-lifecycle.ts`).
 */
import type { CommandDeclaration, SubjectSpec } from '@open-tomato/rafa/core/command';
import type { DangerousPhrases } from '@open-tomato/rafa/core/config';

import { HINT_FLAG_SPEC } from '@open-tomato/rafa/core/command';

/** The `pr` subject: its routing word and its roster line. */
export const PR_SUBJECT: SubjectSpec = Object.freeze({
  name: 'pr',
  summary: 'the pull request of a branch: one line, in full or in the browser; open, list, wait on, merge and triage them',
});

/**
 * The keys of `pr show`'s json result `data`, in the order its
 * description names them: `PrShowResult`'s own keys (`show.ts`), which
 * `show.test.ts` holds this list to.
 */
export const PR_SHOW_JSON_FIELDS: readonly ['detail', 'bodyCloses', 'checks', 'checksProblem', 'triage', 'triageProblem', 'text'] = Object.freeze([
  'detail',
  'bodyCloses',
  'checks',
  'checksProblem',
  'triage',
  'triageProblem',
  'text',
] as const);

/** The flag `pr wait`'s deadline is typed with. */
export const WAIT_TIMEOUT_FLAG = 'timeout';

/**
 * Minutes a `pr wait` line that types no `--timeout` waits: the loop's
 * own CI deadline, `DEFAULT_CI_TIMEOUT_MIN`, copied; see the module note.
 */
export const DEFAULT_WAIT_TIMEOUT_MIN: number = 20;

/** The flag that lets a head's own config through; declared on `pr triage`. */
export const ALLOW_LOCAL_CONFIG_FLAG = 'allow-local-config';

/** How many `--resolve` runs a pull request gets when the line names no cap. */
export const DEFAULT_MAX_ATTEMPTS = 2;

/**
 * What `pr merge` does under each `dangerous.*` key it reads, its
 * `RafaCommand.dangerous`: the phrase the loader's one pass line for the
 * key ends with (`packages/rafa/src/core/config/dangerous.ts`), read in
 * `merge-guard.ts`'s note.
 */
export const MERGE_DANGEROUS_PHRASES: DangerousPhrases = Object.freeze({
  'dangerous.acceptVersionCollision': 'a release guard reading collision merges anyway',
});

/** `pr current`, less its `run`. */
export const PR_CURRENT_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr current',
  subject: PR_SUBJECT.name,
  action: 'current',
  summary: 'show the open pull request of the current branch on one line',
  description: 'Reads the open pull request whose head is the branch checked out at the project root, and'
    + ' prints one line carrying its number, title, state, the verdict over its checks, and its URL.'
    + ' A part the provider answered nothing for is left out, so a pull request that only answers a URL'
    + ' prints as that URL alone. When the checks cannot be read at all the verdict is left out and what'
    + ' the GitHub CLI said is warned about, where a pull request with no checks prints `checks none`.'
    + ' With `--output=json` the branch, the line, the parts it was built from and any checks problem are'
    + ' the data of the terminal result event. Refuses with exit code 2 where `pr.provider` is not `gh`.',
  args: [],
  flags: [],
  examples: [
    {
      cmd: 'rafa pr current',
      note: 'Prints one line for the open pull request of the branch checked out at the project root.',
    },
    {
      cmd: 'rafa pr current --output=json',
      note: 'Writes a start event, then a result event holding the branch, the line and each part of it.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `pr show`, less its `run`. */
export const PR_SHOW_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr show',
  subject: PR_SUBJECT.name,
  action: 'show',
  summary: 'show one pull request in detail, with its checks and its last triage',
  description: 'Reads one pull request in full and prints its number and title, its state, author, head branch,'
    + ' base branch and mergeability, its URL, the issues it closes, every check with its state and its link, and'
    + ' the last rafa triage comment made on it. The closes line marks an issue the provider links that the body'
    + ' names by no closing keyword, and an issue the body names by keyword that the provider does not link.'
    + ' Without a number it reads the open pull request whose head is the branch checked out'
    + ' at the project root. The checks and the triage comment are read separately, and one that cannot be read'
    + ' says so in its own section rather than refusing the command, where a pull request with no checks reads'
    + ' `checks none`. With `--output=json` the data of the terminal result event holds the fields '
    + PR_SHOW_JSON_FIELDS.map((field) => `\`${field}\``).join(', ')
    + ': the pull request, the issues its body closes by keyword, the checks, the triage and the rendered text,'
    + ' each read that failed carrying its problem. Refuses with exit code 2 where `pr.provider` is not `gh`.',
  args: [
    {
      name: 'n',
      description: 'The pull request number. The open pull request of the current branch when it is left out.',
      type: 'number',
    },
  ],
  flags: [],
  examples: [
    {
      cmd: 'rafa pr show',
      note: 'Shows the open pull request of the branch checked out at the project root.',
    },
    {
      cmd: 'rafa pr show 41',
      note: 'Shows pull request 41, whatever branch is checked out.',
    },
    {
      cmd: 'rafa pr show 41 --output=json',
      note: 'Writes a start event, then a result event holding the pull request, its checks and its last triage.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `pr view`, less its `run`. */
export const PR_VIEW_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr view',
  subject: PR_SUBJECT.name,
  action: 'view',
  summary: 'open a pull request in the browser',
  description: 'Hands one pull request to the GitHub CLI to open in the browser, and writes one line naming what'
    + ' was opened. Without a number it opens the open pull request whose head is the branch checked out at the'
    + ' project root, and the line carries that pull request\'s URL; with a number it opens that pull request and'
    + ' names it alone, reading nothing else about it. A GitHub CLI that could not open it — absent,'
    + ' unauthenticated, or holding no such pull request — refuses with exit code 1 carrying what it said. With'
    + ' `--output=json` the number, where it came from, the branch, the URL and the line are the data of the'
    + ' terminal result event. Refuses with exit code 2 where `pr.provider` is not `gh`.',
  args: [
    {
      name: 'n',
      description: 'The pull request number. The open pull request of the current branch when it is left out.',
      type: 'number',
    },
  ],
  flags: [],
  examples: [
    {
      cmd: 'rafa pr view',
      note: 'Opens the open pull request of the branch checked out at the project root.',
    },
    {
      cmd: 'rafa pr view 41',
      note: 'Opens pull request 41, whatever branch is checked out.',
    },
    {
      cmd: 'rafa pr view 41 --output=json',
      note: 'Writes a start event, then a result event naming the pull request that was opened.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `pr open`, less its `run`. */
export const PR_OPEN_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr open',
  subject: PR_SUBJECT.name,
  action: 'open',
  summary: 'open a pull request from a pushed branch, or print the one already open on it',
  description: 'Opens a pull request from the branch `--head` into the branch `--base`, titled `--title`,'
    + ' its body what the file `--body-file` holds, and prints its number, title, branches and URL. The'
    + ' head is a branch already pushed: nothing is pushed for it. When the head already has an open pull'
    + ' request, that pull request is printed and none is opened, with a warning when it is into another'
    + ' base. Exit code 1, with nothing opened, for a flag left out or blank, a head equal to the base,'
    + ' and a body file that cannot be read or holds nothing but whitespace. With `--output=json` whether'
    + ' it opened one, the two branches and the pull request are the data of the terminal result event.'
    + ' Refuses with exit code 2 where `pr.provider` is not `gh`. Starts no session.',
  args: [],
  flags: [
    { name: 'head', description: 'The branch to open the pull request from, already pushed.', type: 'string' },
    { name: 'base', description: 'The branch to open the pull request into.', type: 'string' },
    { name: 'title', description: 'The title of the pull request.', type: 'string' },
    {
      name: 'body-file',
      description: 'The file holding the body, as markdown; read from the directory rafa runs in.',
      type: 'string',
    },
  ],
  examples: [
    {
      cmd: 'rafa pr open --head=feat/rafa-9 --base=stretch/9 --title="rafa-9: one item" --body-file=body.md',
      note: 'Opens feat/rafa-9 into stretch/9, or prints the pull request already open on feat/rafa-9.',
    },
    {
      cmd: 'rafa pr open --head=feat/rafa-9 --base=main --title="rafa-9" --body-file=body.md --output=json',
      note: 'Gives whether one was opened, the two branches and the pull request as the terminal result.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `pr retarget`, less its `run`. */
export const PR_RETARGET_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr retarget',
  subject: PR_SUBJECT.name,
  action: 'retarget',
  summary: 'move a pull request onto another base branch',
  description: 'Moves the pull request `<n>` onto the branch `--base` and prints one line naming it and'
    + ' both bases. A pull request already on that base is left alone: nothing is sent, a line says so,'
    + ' and the exit code is 0. Exit code 1, with nothing sent, for a line naming no number or more than'
    + ' one, a `--base` left out or blank, and a pull request the repository does not hold, and 1 for an'
    + ' edit the provider refused. With `--output=json` the number, whether it was retargeted and the two'
    + ' bases are the data of the terminal result event. Refuses with exit code 2 where `pr.provider` is'
    + ' not `gh`. Starts no session.',
  args: [{ name: 'n', description: 'The number of the pull request to retarget.', type: 'number', required: true }],
  flags: [
    { name: 'base', description: 'The branch to move the pull request onto.', type: 'string' },
  ],
  examples: [
    {
      cmd: 'rafa pr retarget 41 --base=stretch/9',
      note: 'Moves #41 onto stretch/9, or says it is already there.',
    },
    {
      cmd: 'rafa pr retarget 41 --base=main --output=json',
      note: 'Gives the number, whether it was retargeted and both bases as the terminal result.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `pr close`, less its `run`. */
export const PR_CLOSE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr close',
  subject: PR_SUBJECT.name,
  action: 'close',
  summary: 'close a pull request without merging it',
  description: 'Closes the open pull request `<n>` without merging it, leaving `--reason` as its closing'
    + ' comment. It prints the title, the head branch and the issues a merge would have closed, which stay'
    + ' open, then asks `Close #<n> without merging? [y/N]`; `--yes` skips the question, and without a'
    + ' terminal and without `--yes` it refuses. An answer that is not yes closes nothing and the exit code'
    + ' is 0. The head branch stays on the remote unless `--delete-branch` is on the line. Exit code 1, with'
    + ' nothing closed, for a line naming no number or more than one, a `--reason` left out or blank, a pull'
    + ' request the repository does not hold, one already merged and one already closed, and 1 for a close'
    + ' the provider refused. With `--output=json` the number, the title, the head branch, those issues,'
    + ' whether it was closed and whether the branch was deleted are the data of the terminal result event.'
    + ' Refuses with exit code 2 where `pr.provider` is not `gh`. Starts no session.',
  args: [{ name: 'n', description: 'The number of the pull request to close.', type: 'number', required: true }],
  flags: [
    {
      name: 'reason',
      description: 'Why the pull request is closed unmerged. Posted as its closing comment.',
      type: 'string',
    },
    {
      name: 'delete-branch',
      description: 'Delete the head branch with the close, on the remote and in this checkout.'
        + ' The branch stays when it is left out.',
      type: 'boolean',
    },
    {
      name: 'yes',
      description: 'Close without asking. Needed where standard input is no terminal.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa pr close 41 --reason="Replaced by #52 on the new base."',
      note: 'Shows #41 and the issues that stay open, asks, then closes it with that comment.',
    },
    {
      cmd: 'rafa pr close 41 --reason="Replaced by #52." --delete-branch --yes',
      note: 'Closes #41 without asking and deletes its head branch.',
    },
    {
      cmd: 'rafa pr close 41 --reason="Replaced by #52." --yes --output=json',
      note: 'Gives the number, the title, the head, the issues left open and both outcomes as the terminal result.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `pr list`, less its `run`. */
export const PR_LIST_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr list',
  subject: PR_SUBJECT.name,
  action: 'list',
  summary: 'list the open pull requests with their checks, mergeability and release forecast',
  description: 'Lists every open pull request of the repository at the project root, one row each carrying its'
    + ' number, its title, the branch it is from, how long ago it last moved, the verdict over its checks and'
    + ' whether it merges. The checks and the mergeability are read per pull request, so the command sends one'
    + ' GitHub CLI command for the list and two more for each row; a read that failed leaves its cell as `?` and'
    + ' says what the CLI reported on a line under the table rather than refusing the whole list. A pull request'
    + ' GitHub ran nothing for reads `checks none`. Where the release is on, a last column shows the release forecast'
    + ' the pull request body carries, marked `(base moved)` when the base branch, as last fetched, holds another'
    + ' version or other waiting fragments than the forecast was computed against, with a line under the table'
    + ' naming both; it fetches nothing and sends no further command. With `--output=json` every row and the rendered table are the'
    + ' data of the terminal result event. Refuses with exit code 2 where `pr.provider` is not `gh`.',
  args: [],
  flags: [],
  examples: [
    {
      cmd: 'rafa pr list',
      note: 'Lists the open pull requests of the repository at the project root.',
    },
    {
      cmd: 'rafa pr list --output=json',
      note: 'Writes a start event, then a result event holding every row and the rendered table.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `pr wait`, less its `run`. */
export const PR_WAIT_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr wait',
  subject: PR_SUBJECT.name,
  action: 'wait',
  summary: 'wait for one pull request\'s checks to settle, and answer what they came to',
  description: 'Polls the checks of one pull request until they settle or the deadline passes, printing a line'
    + ' per poll, and then prints the verdict with every check under it. Without a number it waits on the open'
    + ' pull request whose head is the branch checked out at the project root. It writes nothing: no comment,'
    + ' no label, no merge and no repair session. A pull request with no check at all is polled again while'
    + ' its head commit is less than two minutes old, since a push\'s checks take some seconds to register,'
    + ' and is answered at once when the head is older. Green exits 0; a red pull request and one with no'
    + ' check registered exit 1, and the report says the pull request does not merge cleanly only when it'
    + ' reads as conflicting; a deadline that passes with checks still running exits 3. The report is'
    + ' printed once: with `--output=json` a green'
    + ' wait gives the verdict, the checks, the polls and the rendered text as the data of the terminal'
    + ' result event, and every other ending carries the report as the message of that event instead.'
    + ' Refuses with exit code 2 where `pr.provider` is not `gh`.',
  args: [
    {
      name: 'n',
      description: 'The pull request number. The open pull request of the current branch when it is left out.',
      type: 'number',
    },
  ],
  flags: [
    {
      name: WAIT_TIMEOUT_FLAG,
      description: `How many minutes to wait before giving up. ${DEFAULT_WAIT_TIMEOUT_MIN} when it is left out.`,
      type: 'string',
    },
    HINT_FLAG_SPEC,
  ],
  examples: [
    {
      cmd: 'rafa pr wait',
      note: 'Waits on the open pull request of the branch checked out at the project root.',
    },
    {
      cmd: 'rafa pr wait 41 --timeout=5',
      note: 'Waits up to five minutes on pull request 41, then exits 3 if its checks are still running.',
    },
    {
      cmd: 'rafa pr wait 41 --output=json',
      note: 'Writes a start event, a line per poll, then a result event holding the verdict and the checks'
        + ' when they are green, and the report as its error message when they are not.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `pr merge`, less its `run`. */
export const PR_MERGE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr merge',
  subject: PR_SUBJECT.name,
  action: 'merge',
  summary: 'merge a pull request and clean up both branches',
  description: 'Merges one pull request through the GitHub CLI and then, in code, switches to the base branch,'
    + ' pulls it fast-forward only, deletes the head branch locally and on the remote where it is still there,'
    + ' and prunes, reporting each step; a head branch this checkout has no local branch for is reported as a'
    + ' skipped local delete, and the rest still run. Refuses before it asks anything on a tracked change in the working tree or an'
    + ' untracked path the pull request\'s head or the base\'s remote-tracking branch holds, on a pull'
    + ' request that is not green or does not merge, and on a head branch checked out in another worktree, except a'
    + ' clean, ended loop worktree under `loop.worktreeDir`, which it removes after copying its two plan files out. It'
    + ' shows the pull request, its branches and the method and asks `Merge? [y/N]`; `--yes` skips the question,'
    + ' and without a terminal and without `--yes` it refuses. A pull request that reports no checks at all is'
    + ' refused unless `--skip-checks` is given, which is refused on any pull request that does report checks;'
    + ' with it the command reads how many workflows the repository defines, prints a warning for that case, asks'
    + ' `Merge #<n> with no checks? [y/N]` (which `--yes` answers only where the repository defines no workflow, or'
    + ' where no workflow file on the base has a `pull_request` trigger naming it),'
    + ' and after the merge posts one comment on the pull request saying so. Where the release runs, the release'
    + ' guard reads the branch before the question: a `collision` is refused unless'
    + ' `dangerous.acceptVersionCollision` is true, and `pr.versionCollision` sets whether a `missing` or'
    + ' `stale` branch merges silently, with a warning, after its own question, or not at all. A step that fails never undoes the merge: it'
    + ' prints what is left as commands to paste and exits 1. After the merge it ticks the `Closes #<n>` line of'
    + ' every issue the pull request closes, first on the checklist of the open epic that issue\'s `epic:` label'
    + ' names, printing one line per epic, then on every open board whose checklist lists it, or on the roadmap'
    + ' issue while no issue carries `type:roadmap`, warning rather than failing when one of those writes'
    + ' does not land. It ends by reading every open issue whose "Blocked by:" line names an issue this pull'
    + ' request closes, asking whether to remove `spec:blocked` from each one whose blockers have all closed;'
    + ' `--yes` does not answer that question, and every failure of that reading is a warning. With'
    + ' board.relationships set to native it ticks no epic checklist and, in place of that reading, prints the'
    + ' open issues the merge freed, whose blockers GitHub clears by itself, asking nothing and writing nothing. With'
    + ' `--output=json` the pull request, the method, the steps that ran, the follow-ups, the roadmap tick and'
    + ' the unblock reading, or the freed issues in native mode, are the data of the terminal result event;'
    + ' the tick of each closed issue\'s epic checklist is one line per epic and no key of that data, and under'
    + ' native there is none. Refuses with exit code 2 where'
    + ' `pr.provider` is not `gh`.',
  args: [
    {
      name: 'n',
      description: 'The pull request number. The open pull request of the current branch when it is left out.',
      type: 'number',
    },
  ],
  flags: [
    {
      name: 'yes',
      description: 'Merge without asking. Needed where standard input is no terminal.',
      type: 'boolean',
    },
    {
      name: 'skip-checks',
      description: 'Merge a pull request that reports no checks at all, after a warning and its own question.'
        + ' Refused where the pull request reports any check; `--yes` beside it is refused where the repository'
        + ' defines a workflow that may run on pull requests into the base, or its workflow count could not be read.',
      type: 'boolean',
    },
    {
      name: 'method',
      description: 'How to merge: squash, merge or rebase. `pr.mergeMethod` when it is left out.',
      type: 'string',
    },
    HINT_FLAG_SPEC,
  ],
  examples: [
    {
      cmd: 'rafa pr merge',
      note: 'Asks, then merges the open pull request of the branch checked out at the project root.',
    },
    {
      cmd: 'rafa pr merge 41 --yes',
      note: 'Merges pull request 41 without asking, then runs the clean-up.',
    },
    {
      cmd: 'rafa pr merge 41 --skip-checks',
      note: 'Warns that nothing on GitHub tested pull request 41, asks, merges it and comments that it had no checks.',
    },
    {
      cmd: 'rafa pr merge 41 --method=rebase --output=json',
      note: 'Merges by rebase and writes a result event holding each clean-up step and the follow-ups.',
    },
  ],
  outputs: ['text', 'json'],
  dangerous: MERGE_DANGEROUS_PHRASES,
});

/** `pr triage`, less its `run`. */
export const PR_TRIAGE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'pr triage',
  subject: PR_SUBJECT.name,
  action: 'triage',
  summary: 'assess a pull request: its class, the evidence, and a follow-up prompt',
  description: 'Assesses one pull request in code — no session is started and no model is asked. It reads the pull'
    + ' request, its checks, the failing job logs and, for a head that does not merge, the conflicting files from'
    + ' `git merge-tree`, and classifies it as one of `green`, `pending`, `conflict-lockfile`, `conflict-manifest`,'
    + ' `conflict-other`, `conflict-version` (the release guard read a stamped version), `ci-install`, `ci-lint`,'
    + ' `ci-types`, `ci-test` or `ci-other`. It prints the class, the'
    + ' evidence it was read from with the failing log capped at 40 lines, and a follow-up prompt carrying all of'
    + ' it, so a session handed that prompt assesses nothing again. It leaves one triage comment per pull request'
    + ' and edits that comment on every later assessment; a pull request whose head has not moved since it was'
    + ' assessed is shown its stored triage and assessed again by nothing. Without a number it assesses the open'
    + ' pull request of the branch checked out at the project root; with no pull request there it takes the red'
    + ' ones, assessing one, or the two or three of them that moved in the last 72 hours, and listing more than'
    + ' three with the command for each. With `--resolve` a pull request whose class is simple is handed to the'
    + ' ordinary loop over the pinned plan for that class, in a worktree under `~/.rafa/worktrees/pr-<n>` removed'
    + ' on success, each session capped at `pr.resolveBudget`; it waits on the checks after every attempt and, at'
    + ' `--max-attempts` or on an attempt ending as the one before it, updates the comment, removes the worktree,'
    + ' prints the follow-up prompt and exits 3. A `conflict-version` pull request is not handed to the loop:'
    + ' `--resolve` converts it in code, with no session and no attempt spent, turning the stamped changelog section'
    + ' into a release fragment and setting the version file and the changelog back to the merge base\'s in one'
    + ' commit it pushes to the branch, and exits 3 when the conversion or the push is refused.'
    + ' It reads the triage comment only from an author holding write'
    + ' access to the repository or listed in `board.trustedAuthors`, and ignores and reports one written by'
    + ' anybody else. A cross-repository pull request, more than one candidate, and under `--resolve` a pull'
    + ' request whose author is neither trusted nor a known dependency-bump bot, are refused with exit code 2;'
    + ' under `--resolve` a head carrying a `rafa.config.ts` or `rafa.config.mjs` that `origin/<base>` does not hold'
    + ' as the same file is refused with exit code 1 unless `--allow-local-config` is passed. With `--output=json` the selection, every'
    + ' reading, what `--resolve` came to and the rendered text are the data of the terminal result event.'
    + ' Refuses with exit code 2 where `pr.provider` is not `gh`.',
  args: [
    {
      name: 'n',
      description: 'The pull request number. The open pull request of the current branch when it is left out.',
      type: 'number',
    },
  ],
  flags: [
    {
      name: 'comment',
      description: 'Leave the triage as a comment on the pull request; `--no-comment` reads one and writes none.',
      type: 'boolean',
      default: true,
    },
    {
      name: 'resolve',
      description: 'Run the pinned plan for a simple class in a worktree of its own, waiting on CI after each'
        + ' attempt, or convert a `conflict-version` stamp into a release fragment with no session. Exits 3 when'
        + ' the attempt guard gives up or the conversion is refused.',
      type: 'boolean',
    },
    {
      name: ALLOW_LOCAL_CONFIG_FLAG,
      description: 'Under `--resolve`, run a head whose `rafa.config.ts` or `rafa.config.mjs` `origin/<base>` does'
        + ' not hold as the same file, printing one warning line; without it such a head is refused with exit 1.',
      type: 'boolean',
    },
    {
      name: 'max-attempts',
      description: 'How many resolve runs a pull request gets. An assessment spends none and reports the count.',
      type: 'number',
      default: DEFAULT_MAX_ATTEMPTS,
    },
    HINT_FLAG_SPEC,
  ],
  examples: [
    {
      cmd: 'rafa pr triage',
      note: 'Assesses the open pull request of the branch checked out at the project root, or the red ones.',
    },
    {
      cmd: 'rafa pr triage 41 --no-comment',
      note: 'Assesses pull request 41 and writes nothing to it, reading the triage comment already there.',
    },
    {
      cmd: 'rafa pr triage 41 --output=json',
      note: 'Writes a result event holding the class, the evidence and the follow-up prompt.',
    },
    {
      cmd: 'rafa pr triage 41 --resolve --max-attempts=3',
      note: 'Runs the pinned plan for a simple class in ~/.rafa/worktrees/pr-41, up to three attempts.',
    },
  ],
  outputs: ['text', 'json'],
  spends: { when: 'with', flag: '--resolve', what: 'runs a small fixed plan through the loop' },
});
