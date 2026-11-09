/**
 * `issue create` as a declaration: the command less its `run`, with the
 * constants only its help spells.
 *
 * `create.ts`'s `createIssueCreateCommand` spreads
 * {@link ISSUE_CREATE_DECLARATION} under its own `run`, as every `issue`
 * module does with its declaration; why the declarations sit apart from
 * the commands is in `declarations.ts`. This one has a file of its own
 * because it is the longest of the nine, and `declarations.ts` re-exports
 * all three of its names, so a module reading them from there keeps
 * working until it moves to this file.
 *
 * ## What this file imports
 *
 * Types from `@open-tomato/rafa/core/command`, and the subject and the
 * type and priority lists from `declarations-shared.ts`, never from
 * `declarations.ts`, which re-exports this file: importing back would
 * close a cycle. No module under `src/` is reached either way, which
 * `declarations.test.ts` reads off this file's source.
 *
 * `DEFAULT_ISSUE_TYPE` is read by `create.ts` as well. `ISSUE_TRIAGE_MODULE`
 * is a copy of `TRIAGE_MODULE` (`packages/rafa/src/triage/filed-text.ts`),
 * which `declarations-integration.test.ts` holds equal to its source; a
 * module keeps reading the source value for what it checks.
 */
import type { CommandDeclaration } from '@open-tomato/rafa/core/command';

import { ISSUE_PRIORITY_WORDS, ISSUE_SUBJECT, ISSUE_TYPE_WORDS } from './declarations-shared.js';

/** The module an issue filed with no `--module` belongs to: a copy of `TRIAGE_MODULE`; see the module note. */
export const ISSUE_TRIAGE_MODULE = 'unassigned';

/** The type an issue filed with no `--type` is of. */
export const DEFAULT_ISSUE_TYPE = 'code';

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
      description: 'A bug: one command run from the checkout root whose output or exit code shows it; the condition only when no command can. Never unknown.',
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
