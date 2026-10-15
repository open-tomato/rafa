/**
 * `rafa issue create --title=<text>`: one new issue on the tracker the
 * chain lands on, from the flags of the line.
 *
 * ## The draft
 *
 * Read off the line before the chain is resolved, so a refused line
 * files nothing and runs no preflight:
 *
 *   - `title` from `--title`, required and not blank for every type but
 *     `bug`, whose title is rendered from its fields (see "A bug");
 *   - `body` from `--body`, or from `--body-file` (see below), empty
 *     when both are left out;
 *   - `type` from `--type`, one of the port's types, {@link DEFAULT_ISSUE_TYPE}
 *     (`code`) when left out, the type `github`'s `get` answers for an
 *     issue with no type label;
 *   - `module` from `--module`, not blank, `TRIAGE_MODULE` (`unassigned`)
 *     when left out, the module triage files with and `github`'s `get`
 *     answers for an issue with no module label;
 *   - `priority` from `--priority`, one of the port's priorities, or null
 *     when left out, which the port spells as the adapter applying
 *     `needs-triage`;
 *   - `opt: 0`, no project and no blocking issue, as triage files
 *     (`triage/triage.ts`): rafa keeps no OPT ledger, and each adapter
 *     numbers its own issues.
 *
 * ## A bug
 *
 * A `--type=bug` line is filed as a bug record (`./create-bug.ts`): its
 * fields are read from `--module`, `--action`, `--summary`, `--env`,
 * `--cause`, `--proposed`, `--reproduce`, `--rerun` and `--project`, from
 * the sections of the body, and from a `--title` when one is typed. rafa
 * fills the versions, the place and the error line, renders the title
 * through `issues.titles.bug`, and refuses a record that is not complete,
 * every problem on a line of its own, before the chain is resolved. A
 * line of another type naming one of those flags is refused, so a field
 * typed on the wrong line is never dropped without a word.
 *
 * `--module` has no declared default for that reason: a default would
 * reach the flags of a bug line that names no module, and hide that the
 * record lacks one. A line of another type still files under
 * `TRIAGE_MODULE` when it names none.
 *
 * ## `--dry-run`
 *
 * Makes the draft as the line would file it, a spec's `Blocked by:` line
 * read, then stops: no chain is resolved, no preflight runs and nothing
 * is filed. Text mode prints `--dry-run: nothing was filed.`, the title,
 * a line with the type, the module, the priority and a bug's cause, then
 * the body. Json mode's result is an {@link IssueDryRun}.
 *
 * ## The body file
 *
 * `--body-file=<path>` reads the body from the file at `path`, as its
 * bytes decode to UTF-8 and nothing trimmed; `--body-file=-` reads it
 * from standard input, whole, through the `stdin` seam
 * ({@link IssueSeams}). A relative path is read from the directory rafa
 * runs in. The file is read after every flag is read and before the
 * chain is resolved, so a line naming both `--body` and `--body-file`,
 * or a path that cannot be read (none there, a directory, no
 * permission), is refused without reading the config, running a
 * preflight or filing anything.
 *
 * ## A spec's `Blocked by:` line
 *
 * A `spec` draft whose body carries a `Blocked by: #24 #26` line is
 * filed with `specBlocked`, which the `github` adapter writes as the
 * board's `spec:blocked` label. The line is read through `readBlockedBy`
 * in `./create-blocked.ts`: a line naming no issue is refused before the
 * chain is resolved, and one naming the issue being filed or an issue
 * the board has no number for is refused once the chain has landed and
 * the board's issues are listed, before anything is filed. A board too
 * large to list whole has no id checked, and a `warn` line says so. A
 * draft of another type, or a spec with no such line, is filed as its
 * flags made it.
 *
 * The adapter checks the draft again. `github` refuses a module holding a
 * comma, which `gh` would read as two labels, and makes every label it
 * sends before it files. `local` writes the file `<number>.md` under
 * `.rafa/issues/`, recording why the chain passed over each kind ahead of
 * it (`adapters/tracker/local.ts`).
 *
 * ## What it writes
 *
 * In text mode, `Created <kind> issue <id>.`, then the URL when the
 * tracker gives one. A `warning` on the ref, a step after the filing that
 * failed, is written at `warn` in either mode. In json mode the terminal
 * result's `data` is an {@link IssueCreateResult}: the tracker and the
 * ref.
 *
 * ## The project
 *
 * An issue the `github` tracker filed is added to the repository's
 * project and refreshed there once its own lines are written
 * (`addAndRefreshIssue`, `../../board/project/add-issue.ts`), with
 * `board.project.number` set; unset, or on another tracker, no call is
 * sent. Every line the add or the refresh answers is written at `warn`
 * after the command's own output, and none changes the exit code: the
 * issue is filed, and `rafa board sync` catches the project up. Their
 * runner is opened retrying (`../../board/project/project-runner.ts`):
 * a call that failed on a network error is sent again, each retry an
 * `info` line, `retrying #725 (1 of 3): operation timed out`, or one
 * `retry` event in json mode.
 *
 * ## Refusals
 *
 * Exit code 1, as `issue-tracker.ts` words them: an argument, a
 * `--title` left out or blank, a `--type` or `--priority` outside its
 * set, a blank `--module`, a config refused, a chain landing nowhere, and
 * a `create` that rejects. Two more are this action's own, each naming
 * the usage line: `--body` beside `--body-file`, and a body file that
 * cannot be read, naming the path and the reason the read gave. A third,
 * a spec's `Blocked by:` line read as a fault, names the line and the
 * fault and no usage line, since the fix is in the body; a board listing
 * that rejects is refused as any other tracker call.
 */
import type { IssueSeams, IssueTrackerData, LineFlags } from './issue-tracker.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { IssueDraft, IssueRef, IssueType, Tracker } from '@open-tomato/rafa/ports';

import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { ISSUE_PRIORITIES, ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';
import { addAndRefreshIssue } from '../../board/project/add-issue.js';
import { commandRetrySeams, openProjectRunner } from '../../board/project/project-runner.js';
import { TRIAGE_MODULE } from '../../triage/triage.js';
import { expectNoArgument, readSwitch } from '../plan/plan-files.js';

import { readSpecLine, settleSpecLine } from './create-blocked.js';
import { BUG_FLAGS, readBugLine } from './create-bug.js';
import {
  DEFAULT_ISSUE_SEAMS,
  issueName,
  issueProject,
  issueSubjectConfig,
  lineRefusal,
  onTracker,
  readChoiceFlag,
  readNonBlankFlag,
  readRequiredFlag,
  readTextFlag,
  resolveIssueTracker,
  urlLines,
} from './issue-tracker.js';

/** The usage line a refusal names. */
const USAGE = 'rafa issue create (--title=<text> | --type=bug --summary=<text> --module=<name> --action=<name> --cause=<code>'
  + ' --reproduce=<text>) [--body=<text> | --body-file=<path>] [--type=<type>] [--module=<name>] [--priority=<priority>]'
  + ' [--env=<place>] [--proposed=<code>] [--rerun=<command>] [--project=<name>] [--path=<file>] [--dry-run]';

/** What a refusal of `--dry-run` typed with a value ends with. */
const SWITCH_HINT = `Type it bare: ${USAGE}`;

/** The type whose title is rendered from its fields. */
const BUG_TYPE: IssueType = 'bug';

/** What a draft with no priority is filed as, in a `--dry-run` listing. */
const NO_PRIORITY = 'needs-triage';

/** The `--body-file` value that reads standard input. */
export const STDIN_PATH = '-';

/** The type a draft takes when the line names none; see the module note. */
export const DEFAULT_ISSUE_TYPE: IssueType = 'code';

/** What json mode gives as the terminal result's `data`. */
export interface IssueCreateResult {
  readonly tracker: IssueTrackerData;
  /** The ref the tracker answered for the issue it filed. */
  readonly ref: IssueRef;
}

/** What json mode gives as the terminal result's `data` under `--dry-run`: the draft, and nothing filed. */
export interface IssueDryRun {
  readonly dryRun: true;
  /** The draft the line would file. */
  readonly draft: IssueDraft;
}

/**
 * The path `--body-file` names, or undefined when the line leaves it out;
 * a refusal with exit code 1 for a blank value and for one beside
 * `--body`. See the module note.
 */
export function readBodyFileFlag(flags: LineFlags): string | undefined {
  const path = readNonBlankFlag(flags, 'body-file', USAGE);
  if (path === undefined || flags.body === undefined) return path;
  throw lineRefusal('--body and --body-file cannot be used together: name the body one way', USAGE);
}

/**
 * The title a line names: required for every type but `bug`, whose line
 * may leave it out (`''`); a refusal with exit code 1 for a line of
 * another type naming a flag only a bug reads. See the module note.
 */
function readTitleFlag(flags: LineFlags, type: IssueType): string {
  if (type === BUG_TYPE) return readNonBlankFlag(flags, 'title', USAGE) ?? '';
  const stray = BUG_FLAGS.find((flag) => flags[flag] !== undefined);
  if (stray !== undefined) throw lineRefusal(`--${stray} is read for --type=${BUG_TYPE} only`, USAGE);
  return readRequiredFlag(flags, 'title', USAGE);
}

/**
 * The draft a line's flags make, its body from `--body` alone; a refusal
 * with exit code 1 for a flag refused, `--body` beside `--body-file`
 * among them. {@link readIssueLine} reads the body file. See the module
 * note.
 */
export function readIssueDraft(flags: LineFlags): IssueDraft {
  readBodyFileFlag(flags);
  const type = readChoiceFlag(flags, 'type', ISSUE_TYPES, USAGE) ?? DEFAULT_ISSUE_TYPE;
  return {
    opt: 0,
    title: readTitleFlag(flags, type),
    body: readTextFlag(flags, 'body', USAGE) ?? '',
    type,
    module: readNonBlankFlag(flags, 'module', USAGE) ?? TRIAGE_MODULE,
    priority: readChoiceFlag(flags, 'priority', ISSUE_PRIORITIES, USAGE) ?? null,
    project: null,
    blockedBy: [],
  };
}

/**
 * The body `path` holds, or standard input's through `seams.stdin` for
 * {@link STDIN_PATH}; a refusal with exit code 1 naming the path and the
 * reason when it cannot be read.
 */
export async function readBodyFile(path: string, seams: Pick<IssueSeams, 'stdin'>): Promise<string> {
  const read = path === STDIN_PATH
    ? seams.stdin ?? (() => Bun.stdin.text())
    : () => Bun.file(path).text();
  try {
    return await read();
  } catch (error) {
    const where = path === STDIN_PATH
      ? 'standard input'
      : `"${path}"`;
    throw lineRefusal(`--body-file cannot read ${where}: ${messageOf(error)}`, USAGE);
  }
}

/** The draft a line makes, its body read from `--body-file` when the line names one; see the module note. */
export async function readIssueLine(flags: LineFlags, seams: Pick<IssueSeams, 'stdin'>): Promise<IssueDraft> {
  const draft = readIssueDraft(flags);
  const path = readBodyFileFlag(flags);
  return path === undefined
    ? draft
    : { ...draft, body: await readBodyFile(path, seams) };
}

/** The lines text mode writes once an issue is filed. */
export function renderCreated(ref: IssueRef): string[] {
  return [`Created ${issueName(ref)}.`, ...urlLines(ref)];
}

/** The lines text mode writes under `--dry-run`; see the module note. */
export function renderDryRun(draft: IssueDraft): string[] {
  const facts = [
    `Type: ${draft.type}`,
    `Module: ${draft.module}`,
    `Priority: ${draft.priority ?? NO_PRIORITY}`,
    ...draft.cause === undefined
      ? []
      : [`Cause: ${draft.cause}`],
  ].join(' · ');
  const body = draft.body.trimEnd();
  return [
    '--dry-run: nothing was filed.',
    `Title: ${draft.title}`,
    facts,
    ...body === ''
      ? []
      : ['', ...body.split('\n')],
  ];
}

/** True for a result of `--dry-run`. */
export function isDryRun(result: IssueCreateResult | IssueDryRun): result is IssueDryRun {
  return 'dryRun' in result;
}

/** Files the issue a line describes, or under `--dry-run` answers its draft; see the module note. */
export async function createIssue(context: RafaContext, seams: IssueSeams): Promise<IssueCreateResult | IssueDryRun> {
  expectNoArgument(context.args, USAGE);
  const dryRun = readSwitch('dry-run', context.flags['dry-run'], SWITCH_HINT);
  const base = await readIssueLine(context.flags, seams);
  // Under --dry-run no chain is resolved to write the config's warnings, so they are written here.
  const warn = dryRun
    ? (message: string): void => context.output.warn(message)
    : (): void => undefined;
  const read = base.type === BUG_TYPE
    ? (await readBugLine(context, seams, base, { usage: USAGE, warn })).draft
    : base;
  const blockedLine = readSpecLine(read);
  if (dryRun) return { dryRun: true, draft: read };
  const { tracker, data } = await resolveIssueTracker(context, seams);
  const draft = blockedLine === null
    ? read
    : await settledDraft(read, tracker, context);
  const ref = await onTracker(tracker, 'create the issue', () => tracker.create(draft));
  return { tracker: data, ref };
}

/** The spec draft {@link settleSpecLine} answers, its unchecked sentence written at `warn`. */
async function settledDraft(read: IssueDraft, tracker: Tracker, context: RafaContext): Promise<IssueDraft> {
  const settled = await settleSpecLine(read, tracker);
  if (settled.unchecked !== null) context.output.warn(`issue create: ${settled.unchecked}`);
  return settled.draft;
}

/**
 * The issue number of `ref` when the `github` tracker filed it, else
 * null: only a GitHub issue can be an item of the project.
 */
export function projectIssueNumber(ref: Pick<IssueRef, 'kind' | 'externalId'>): number | null {
  if (ref.kind !== 'github' || !/^[1-9]\d*$/u.test(ref.externalId)) return null;
  const number = Number(ref.externalId);
  return Number.isSafeInteger(number)
    ? number
    : null;
}

/**
 * Adds the issue `ref` names to the project and refreshes it, writing
 * each warning line at `warn`; nothing for an issue another tracker
 * filed, or with `board.project.number` unset. See the module note.
 */
export async function addCreatedToProject(context: RafaContext, seams: IssueSeams, ref: IssueRef): Promise<void> {
  const issue = projectIssueNumber(ref);
  if (issue === null) return;
  const project = issueProject(context);
  // Its warnings dropped: `resolveIssueTracker` already wrote them for the same config.
  const config = await issueSubjectConfig(project, () => undefined);
  const lines = await addAndRefreshIssue({
    config,
    openGh: () => openProjectRunner(seams.gh ?? createGhRunner({ cwd: project.root }), config, commandRetrySeams(context.output, context.outputMode, seams.sleep)),
  }, issue);
  for (const line of lines) context.output.warn(line);
}

/** The command, resolving the chain with `seams`; see the module note. */
export function createIssueCreateCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue create',
    subject: 'issue',
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
        description: `What the issue is for: one of ${ISSUE_TYPES.join(', ')}.`,
        type: 'string',
        default: DEFAULT_ISSUE_TYPE,
      },
      {
        name: 'module',
        description: `The module the issue belongs to; ${TRIAGE_MODULE} when left out. A bug names one, or unknown.`,
        type: 'string',
      },
      {
        name: 'priority',
        description: `How urgent the issue is: one of ${ISSUE_PRIORITIES.join(', ')}. Marked needs-triage when left out.`,
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
    run: async (context) => {
      const created = await createIssue(context, seams);
      if (isDryRun(created)) {
        if (context.outputMode === 'json') context.output.result(created);
        else for (const line of renderDryRun(created.draft)) context.output.info(line);
        return;
      }
      if (created.ref.warning !== undefined) context.output.warn(`${issueName(created.ref)}: ${created.ref.warning}`);
      if (context.outputMode === 'json') context.output.result(created);
      else for (const line of renderCreated(created.ref)) context.output.info(line);
      await addCreatedToProject(context, seams, created.ref);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createIssueCreateCommand();
export default command;
