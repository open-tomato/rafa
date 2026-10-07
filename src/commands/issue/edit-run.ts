/**
 * The run of `rafa issue edit <n>`: the line read, the issue read once,
 * the four gates in their order, `--dry-run`, the one write, the re-read
 * and the outcome (`.rafa/specs/rafa-812-spec-rafa-issue-edit.md`). The
 * `RafaCommand` that prints a run lives in `./edit.ts`.
 *
 * ## The line
 *
 * {@link readEditLine} reads the words and flags before anything is
 * opened, so a refused line reads no config and runs no `gh`: one issue
 * number, and an append (`--append-file=<file>` or `--append=<text>`,
 * with a required `--reason`, `--while-in-development` allowed), a
 * replace (`--replace-file=<file>`, `--title` allowed beside it) or a
 * title change (`--title` alone). `--reason` and
 * `--while-in-development` beside anything but an append are refused,
 * as are flags that do not combine and a value that is blank. A file is
 * read as `issue create --body-file` reads one, `-` for standard input
 * ({@link readEditRequest}), and refused when it cannot be read or holds
 * nothing but whitespace. Each refusal exits 1 naming {@link EDIT_USAGE}.
 *
 * ## The order
 *
 * {@link runIssueEdit} reads the issue once through the tracker's
 * `editable`, then weighs four gates, and the first refusal ends the
 * run with nothing written:
 *
 *  1. ownership, who edits: the login `gh api user` answers, weighed
 *     over the project's `BoardTrust` (`readEditorTrust`,
 *     `src/board/trust.ts`). A lookup that fails refuses as
 *     `ownership-unknown`, never as trusted;
 *  2. ownership, whose issue: the issue's author over the SAME trust,
 *     refused with the remedy `plan create` gives, "a member must open
 *     the spec";
 *  3. the text: the leak refusal over the text the edit adds, the new
 *     title included, and the completeness refusal over the whole new
 *     body of a `type:spec` issue that was complete before
 *     (`src/board/issue-edit-text.ts`);
 *  4. spec to code: the labels, the open state and the saved copies under
 *     `specs.dir` (`src/board/issue-edit-state.ts`).
 *
 * A refusal is an {@link EditRefusal}, a `CommandExit` with exit code 2
 * whose message opens `❌ refused <gate>: `, the gate named as
 * {@link EditRefusalName} spells it.
 *
 * On the `local` tracker gates 1 and 2 answer `local` and pass, asking
 * nobody: its issues are files under the project's own `.rafa/issues/`,
 * which whoever runs rafa there can write without it. The rule is keyed
 * on the tracker's kind, never on an empty author, so an adapter
 * answering an empty login by mistake is weighed over `gh` and refused.
 *
 * ## Already, and dry run
 *
 * After the gates pass, an append whose dated block (same day, reason
 * and text) is already the body's last part answers `already` and
 * writes nothing (`carriesUpdateBlock`, `src/board/issue-edit-body.ts`).
 * It is weighed after the gates, so a line run again on an issue since
 * closed or claimed is told so rather than told it is done.
 *
 * `--dry-run` weighs every gate as without it and writes nothing: the
 * report holds the added part, each gate's reading and the outcome the
 * edit would have. A refusal still exits 2, its message opening with the
 * readings of the gates that passed before it.
 *
 * ## After the write
 *
 * The run writes through `edit` and reads the issue again, CRLF read as
 * LF and trailing whitespace at the very end ignored, since GitHub may
 * normalise both. The re-read must hold what was written
 * ({@link writeHeld}): for an append the body read before byte for
 * byte, then the separator and the block and nothing else; for a
 * replace the new body; for a title change the old body; and the new
 * title where one was written. Anything else is `conflict`, exit code
 * 1, with the body read before and the body read after saved as
 * `.rafa/scratch/rafa-<n>-edit-before-<stamp>.md` and
 * `rafa-<n>-edit-after-<stamp>.md` ({@link saveConflictBodies}), and the
 * message naming both paths.
 *
 * The write sends the whole body, so the check finds an edit landing
 * after the write and before the re-read, and a write the tracker did
 * not keep as sent; an edit landing between the first read and the
 * write is overwritten by it and leaves the re-read nothing to see.
 *
 * ## Outcomes
 *
 * {@link EditOutcome}: `appended`, `replaced` (body, title or both),
 * `already` and `stale-copy` exit 0, `conflict` exits 1
 * ({@link editExitCode}). `stale-copy`, an append on a planned issue or
 * on a claimed one under `--while-in-development`, names
 * `rafa plan create --issue=<n> --refresh`, which the run never runs.
 */
import type { IssueSeams, IssueTrackerData, LineFlags } from './issue-tracker.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { EditKind, EditStateInput, EditStateReading } from '../../board/issue-edit-state.js';
import type { BoardTrust, EditorLogin, EditorRefusal, TrustReading } from '../../board/trust.js';
import type { RafaContext } from '../../cli/command.js';
import type { EditableIssue, IssueEdit, IssueRef, Tracker } from '../../ports/index.js';
import type { GitRunner } from '../../pr/git.js';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createGhRunner } from '../../adapters/tracker/github.js';
import {
  appendedBody,
  carriesUpdateBlock,
  originalPartHolds,
  renderUpdateBlock,
  replacedBody,
} from '../../board/issue-edit-body.js';
import {
  editStateRefusalMessage,
  findSavedCopies,
  readEditState,
  refreshCommand,
  staleCopyMessage,
} from '../../board/issue-edit-state.js';
import { completenessApplies, requireEditText } from '../../board/issue-edit-text.js';
import { boardId } from '../../board/naming.js';
import { boardRepoLabel } from '../../board/plan-spec.js';
import {
  createGhEditorLogin,
  editorRefusalMessage,
  ghBoardTrust,
  readBoardTrust,
  readEditorTrust,
  TRUST_REFUSAL_EXIT,
  trustRefusalMessage,
} from '../../board/trust.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { createGitRunner } from '../../pr/git.js';
import { fileStamp } from '../effort/fix-schema.js';

import {
  issueName,
  issueProject,
  issueRef,
  issueSubjectConfig,
  lineRefusal,
  onTracker,
  readNonBlankFlag,
  resolveIssueTracker,
} from './issue-tracker.js';

/** The usage line a line refusal names. */
export const EDIT_USAGE = 'rafa issue edit <n> (--append-file=<file> | --append=<text>) --reason=<text>'
  + ' [--while-in-development] | (--replace-file=<file> [--title=<text>] | --title=<text>) [--dry-run]';

/** The exit code every gate refusal ends with: `TRUST_REFUSAL_EXIT`, `LEAK_REFUSAL_EXIT` and `BOARD_REFUSAL_EXIT` are all 2. */
export const EDIT_REFUSAL_EXIT = TRUST_REFUSAL_EXIT;

/** The exit code a `conflict` ends with. */
export const EDIT_CONFLICT_EXIT = 1;

/** Where a conflict's two bodies are saved, under the project root. */
export const EDIT_SCRATCH_DIR = join('.rafa', 'scratch');

/** The file value that reads standard input. */
const STDIN_PATH = '-';

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** Whitespace closing a string, which the post-write check ignores. */
const TRAILING_WHITESPACE = /\s+$/u;

/** The tracker kind whose gates 1 and 2 answer `local`; see the module note. */
const ACCOUNTLESS_KIND = 'local';

/** What gates 1 and 2 read on the `local` tracker. */
const LOCAL_OWNERSHIP = 'local: the local tracker holds no accounts, so nobody is asked about';

/** The flags of the line, by name. */
const FLAG = Object.freeze({
  appendFile: 'append-file',
  append: 'append',
  reason: 'reason',
  replaceFile: 'replace-file',
  title: 'title',
  dryRun: 'dry-run',
  whileInDevelopment: 'while-in-development',
});

/** Where an edit's text comes from: a file (`-` for standard input), or the line itself. */
export type EditTextSource =
  | { readonly from: 'file'; readonly flag: string; readonly path: string }
  | { readonly from: 'line'; readonly text: string };

/** What a line asks for, its text read: what {@link runIssueEdit} is handed. */
export interface EditRequest {
  readonly issue: number;
  readonly kind: EditKind;
  /** The text an append adds, or the body a replace writes; null for a title change. */
  readonly text: string | null;
  /** The reason of an append; null otherwise. */
  readonly reason: string | null;
  /** The new title, or null when the title stays. */
  readonly title: string | null;
  readonly whileInDevelopment: boolean;
  readonly dryRun: boolean;
}

/** What a line asks for, its text not yet read: where it comes from in its place. */
export interface EditLine extends Omit<EditRequest, 'text'> {
  /** Where an append's text or a replace's body comes from; null for a title change. */
  readonly source: EditTextSource | null;
}

/** The four gates, as a reading names them. */
export type EditGate = 'editor' | 'author' | 'text' | 'state';

/** One gate's reading, as `--dry-run` prints it. */
export interface EditGateReading {
  readonly gate: EditGate;
  /** The sentence the reading is printed as. */
  readonly line: string;
}

/** What `refused <gate>` names: the gate a refusal came from, by its reason. */
export type EditRefusalName = EditorRefusal | 'text' | 'closed' | 'in-development' | 'spec-ready' | 'planned';

/** What one run came to; a refusal throws an {@link EditRefusal} instead. */
export type EditOutcome = 'appended' | 'replaced' | 'already' | 'stale-copy' | 'conflict';

/** The two bodies a `conflict` saved, as paths under the project root. */
export interface ConflictBodies {
  readonly before: string;
  readonly after: string;
}

/** What one run came to, and the lines it is reported with. */
export interface EditReport {
  readonly issue: number;
  readonly outcome: EditOutcome;
  /** {@link editExitCode} of the outcome. */
  readonly exitCode: number;
  readonly dryRun: boolean;
  /** True when the tracker was written to. */
  readonly written: boolean;
  /** The added part: an append's block, a replace's body, a new title. */
  readonly added: string;
  /** Each gate's reading, in order. */
  readonly readings: readonly EditGateReading[];
  /** `rafa plan create --issue=<n> --refresh` for a `stale-copy`, or null. */
  readonly refresh: string | null;
  /** The loop's branch an append under `--while-in-development` landed beside, or null. */
  readonly branch: string | null;
  /** The bodies a `conflict` saved, or null. */
  readonly scratch: ConflictBodies | null;
  /** The sentence the outcome is printed as. */
  readonly message: string;
}

/** A gate's refusal: exit code 2, its message opening `❌ refused <gate>: `. */
export class EditRefusal extends CommandExit {
  /** The gate, by the reason it refused. */
  readonly refusal: EditRefusalName;
  /** The readings of the gates that passed before it. */
  readonly readings: readonly EditGateReading[];

  constructor(refusal: EditRefusalName, sentence: string, readings: readonly EditGateReading[], dryRun: boolean) {
    const passed = dryRun
      ? readings.map(renderReading)
      : [];
    super(EDIT_REFUSAL_EXIT, [...passed, `❌ refused ${refusal}: ${sentence}`].join('\n'));
    this.refusal = refusal;
    this.readings = readings;
  }
}

/** The exit code `outcome` ends with: 1 for `conflict`, 0 for the rest. */
export function editExitCode(outcome: EditOutcome): number {
  return outcome === 'conflict'
    ? EDIT_CONFLICT_EXIT
    : 0;
}

/** A reading as one printed line. */
export function renderReading(reading: EditGateReading): string {
  return `${reading.gate}: ${reading.line}`;
}

// ---------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------

/** Whether a switch is on: bare or `=true`; a value other than `true` or `false` is refused. */
function readSwitch(flags: LineFlags, name: string): boolean {
  const value = flags[name];
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw lineRefusal(`--${name} takes no value, and read "${value}" as one`, EDIT_USAGE);
}

/** The one issue number the words name. */
function readEditIssue(args: readonly string[]): number {
  if (args.length > 1) {
    throw lineRefusal(`Expected one issue number, got ${String(args.length)}: ${args.join(' ')}`, EDIT_USAGE);
  }
  const word = args[0];
  if (word === undefined) throw lineRefusal('Name the issue number to edit', EDIT_USAGE);
  if (!ISSUE_NUMBER.test(word)) {
    throw lineRefusal(`"${word}" is no issue number, which is a whole number from 1`, EDIT_USAGE);
  }
  return Number(word);
}

/** A refusal of two flags typed together. */
function notTogether(first: string, second: string, why: string): CommandExit {
  return lineRefusal(`--${first} and --${second} cannot be used together: ${why}`, EDIT_USAGE);
}

/** The flags a line names, each read as its text. */
type EditFlags = ReturnType<typeof readEditFlags>;

/** Every flag of the line, each refused alone for its own shape. */
function readEditFlags(flags: LineFlags) {
  return {
    appendFile: readNonBlankFlag(flags, FLAG.appendFile, EDIT_USAGE),
    append: readNonBlankFlag(flags, FLAG.append, EDIT_USAGE),
    reason: readNonBlankFlag(flags, FLAG.reason, EDIT_USAGE),
    replaceFile: readNonBlankFlag(flags, FLAG.replaceFile, EDIT_USAGE),
    title: readNonBlankFlag(flags, FLAG.title, EDIT_USAGE),
    whileInDevelopment: readSwitch(flags, FLAG.whileInDevelopment),
    dryRun: readSwitch(flags, FLAG.dryRun),
  };
}

/** An append line from `read`, whose `--append-file` or `--append` is set. */
function appendLine(issue: number, read: EditFlags): EditLine {
  if (read.appendFile !== undefined && read.append !== undefined) {
    throw notTogether(FLAG.appendFile, FLAG.append, 'name the added text one way');
  }
  if (read.title !== undefined) throw notTogether(FLAG.title, FLAG.append, 'a title changes under the gates of a replace');
  if (read.reason === undefined) {
    throw lineRefusal(`--${FLAG.reason} is required with an append: --${FLAG.reason}=<text>`, EDIT_USAGE);
  }
  const source: EditTextSource = read.appendFile === undefined
    ? { from: 'line', text: read.append ?? '' }
    : { from: 'file', flag: FLAG.appendFile, path: read.appendFile };
  return { ...lineOf(issue, read, 'append', source), reason: read.reason, whileInDevelopment: read.whileInDevelopment };
}

/** A line of `kind` with no reason and no opening of a claim. */
function lineOf(issue: number, read: EditFlags, kind: EditKind, source: EditTextSource | null): EditLine {
  return { issue, kind, source, reason: null, title: read.title ?? null, whileInDevelopment: false, dryRun: read.dryRun };
}

/**
 * What the line asks for, its files not yet read; a refusal with exit
 * code 1 naming {@link EDIT_USAGE} for every rule the module note lists.
 */
export function readEditLine(args: readonly string[], flags: LineFlags): EditLine {
  const issue = readEditIssue(args);
  const read = readEditFlags(flags);
  const appending = read.appendFile !== undefined || read.append !== undefined;

  if (appending && read.replaceFile !== undefined) {
    const appendFlag = read.appendFile === undefined
      ? FLAG.append
      : FLAG.appendFile;
    throw notTogether(appendFlag, FLAG.replaceFile, 'an edit either appends or replaces');
  }
  if (appending) return appendLine(issue, read);

  if (read.reason !== undefined) {
    throw lineRefusal(`--${FLAG.reason} goes with an append only: a replace and a title change take none`, EDIT_USAGE);
  }
  if (read.whileInDevelopment) {
    throw lineRefusal(
      `--${FLAG.whileInDevelopment} goes with an append only: a spec under way is never replaced or retitled`,
      EDIT_USAGE,
    );
  }
  if (read.replaceFile !== undefined) {
    return lineOf(issue, read, 'replace', { from: 'file', flag: FLAG.replaceFile, path: read.replaceFile });
  }
  if (read.title !== undefined) return lineOf(issue, read, 'title', null);
  throw lineRefusal(
    `Name the edit: --${FLAG.appendFile}, --${FLAG.append}, --${FLAG.replaceFile} or --${FLAG.title}`,
    EDIT_USAGE,
  );
}

/** What reads a line's text: standard input, whole. */
export type EditStdin = () => Promise<string>;

/** The text `source` names, refusing a file that cannot be read and a text holding nothing but whitespace. */
async function readEditText(source: EditTextSource, stdin: EditStdin): Promise<string> {
  if (source.from === 'line') return source.text;
  const where = source.path === STDIN_PATH
    ? 'standard input'
    : `"${source.path}"`;
  let text: string;
  try {
    text = source.path === STDIN_PATH
      ? await stdin()
      : await Bun.file(source.path).text();
  } catch (error) {
    throw lineRefusal(`--${source.flag} cannot read ${where}: ${messageOf(error)}`, EDIT_USAGE);
  }
  if (text.trim() === '') throw lineRefusal(`--${source.flag} read nothing but whitespace from ${where}`, EDIT_USAGE);
  return text;
}

/** What `line` asks for with its text read; see the module note's line. */
export async function readEditRequest(line: EditLine, stdin: EditStdin): Promise<EditRequest> {
  const { source, ...rest } = line;
  if (source === null) return { ...rest, text: null };
  return { ...rest, text: await readEditText(source, stdin) };
}

// ---------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------

/** The tracker an edit goes through: one holding the optional pair. */
export type EditingTracker = Tracker & Required<Pick<Tracker, 'editable' | 'edit'>>;

/** `tracker` when it holds `editable` and `edit`, or a refusal with exit code 1 naming its kind. */
export function requireEditingTracker(tracker: Tracker): EditingTracker {
  if (holdsEditing(tracker)) return tracker;
  throw new CommandExit(1, `❌ The ${tracker.kind} tracker cannot edit an issue: it reads and writes no issue body.`);
}

/** True when `tracker` holds both members of the optional pair. */
function holdsEditing(tracker: Tracker): tracker is EditingTracker {
  return tracker.editable !== undefined && tracker.edit !== undefined;
}

/** What {@link runIssueEdit} reads and writes through. */
export interface EditRunOptions {
  readonly request: EditRequest;
  readonly tracker: EditingTracker;
  /** The project root `specs.dir` and `.rafa/scratch/` are read against. */
  readonly root: string;
  /** `specs.dir`, where a saved copy is looked for. */
  readonly specsDir: string;
  /** Makes the trust gates 1 and 2 weigh over; never called on the `local` tracker. */
  readonly trust: () => BoardTrust;
  /** Reads the login running the edit; never called on the `local` tracker. */
  readonly editor: EditorLogin;
  /** The clock the block's day and the conflict stamp are read off. */
  readonly now: () => Date;
}

/** The body, the added part and the write one request makes over the issue as read. */
interface PlannedEdit {
  /** The added text gate 3 reads: an append's text, a replace's body, a new title. */
  readonly added: string;
  /** What the report calls the added part. */
  readonly shown: string;
  /** The block an append adds, or null. */
  readonly block: string | null;
  /** The whole body after the edit. */
  readonly after: string;
  /** True when an append's block is already the body's last part. */
  readonly already: boolean;
  /** What `edit` is handed. */
  readonly change: IssueEdit;
}

/** The edit `request` makes over `found`, read at `now`. */
function planEdit(request: EditRequest, found: EditableIssue, now: Date): PlannedEdit {
  const titled = request.title === null
    ? {}
    : { title: request.title };
  if (request.kind === 'append') {
    const block = renderUpdateBlock(now, request.reason ?? '', request.text ?? '');
    const already = carriesUpdateBlock(found.body, block);
    const after = already
      ? found.body
      : appendedBody(found.body, block);
    return { added: request.text ?? '', shown: block, block, after, already, change: { body: after } };
  }
  if (request.kind === 'replace') {
    const body = replacedBody(request.text ?? '');
    const added = [request.title, body].filter((part) => part !== null).join('\n\n');
    return { added, shown: added, block: null, after: body, already: false, change: { body, ...titled } };
  }
  const title = request.title ?? '';
  return { added: title, shown: title, block: null, after: found.body, already: false, change: { title } };
}

/** The sentence a trusted reading is printed as. */
function trustedLine(reading: TrustReading, repo: string): string {
  return reading.source === 'allow-list'
    ? `${reading.login}, listed in board.trustedAuthors`
    : `${reading.login}, who has write access to ${repo}`;
}

/** A reading collector and the refusal it throws. */
interface Gates {
  readonly readings: EditGateReading[];
  pass: (gate: EditGate, line: string) => void;
  refuse: (refusal: EditRefusalName, sentence: string) => never;
}

/** A fresh collector for `request`. */
function gatesFor(request: EditRequest): Gates {
  const readings: EditGateReading[] = [];
  return {
    readings,
    pass: (gate, line) => {
      readings.push({ gate, line });
    },
    refuse: (refusal, sentence) => {
      throw new EditRefusal(refusal, sentence, [...readings], request.dryRun);
    },
  };
}

/** Gates 1 and 2: the editor, then the issue's author, over one trust. */
async function weighOwnership(options: EditRunOptions, found: EditableIssue, gates: Gates): Promise<void> {
  const { request, tracker } = options;
  if (tracker.kind === ACCOUNTLESS_KIND) {
    gates.pass('editor', LOCAL_OWNERSHIP);
    gates.pass('author', LOCAL_OWNERSHIP);
    return;
  }

  const trust = options.trust();
  const item = { kind: 'issue' as const, number: request.issue, repo: trust.repo };
  const editor = await readEditorTrust(trust, options.editor);
  if (!editor.trusted || editor.reading === null) {
    gates.refuse(editor.refusal ?? 'ownership-unknown', editorRefusalMessage(item, editor));
  }
  gates.pass('editor', trustedLine(editor.reading, trust.repo));

  const author = await readBoardTrust(trust, found.author);
  if (!author.trusted) {
    const refusal = author.refusal === 'lookup-failed'
      ? 'ownership-unknown'
      : 'ownership';
    gates.refuse(refusal, trustRefusalMessage(item, author));
  }
  gates.pass('author', `#${String(request.issue)} was opened by ${trustedLine(author, trust.repo)}`);
}

/** Gate 3: the added text, and the whole new body of a complete spec. */
function weighText(request: EditRequest, found: EditableIssue, planned: PlannedEdit, gates: Gates): void {
  try {
    requireEditText({
      issue: request.issue,
      labels: found.labels,
      before: found.body,
      added: planned.added,
      after: planned.after,
    });
  } catch (error) {
    if (error instanceof CommandExit) gates.refuse('text', error.message);
    throw error;
  }
  const complete = completenessApplies(found.labels, found.body)
    ? ', and the edited body still fills the spec template'
    : '';
  gates.pass('text', `the added text names no machine path or credential${complete}`);
}

/** The sentence a passing gate 4 reading is printed as. */
function stateLine(input: EditStateInput, reading: EditStateReading): string {
  if (reading.branch !== null) {
    return `a loop holds it on ${reading.branch}; --while-in-development lets the append through`;
  }
  if (input.savedCopies.length > 0) return `planned, its saved copy at ${input.savedCopies.join(', ')}`;
  return input.labels.length === 0
    ? 'open, with no plan and no loop building from it'
    : `open, labelled ${input.labels.join(', ')}, with no saved copy and no loop building from it`;
}

/** Gate 4: the state of the issue, answering the passing reading. */
function weighState(options: EditRunOptions, found: EditableIssue, gates: Gates): EditStateReading {
  const { request } = options;
  const input: EditStateInput = {
    issue: request.issue,
    title: found.title,
    open: found.open,
    labels: found.labels,
    savedCopies: findSavedCopies(options.root, options.specsDir, request.issue),
    kind: request.kind,
    whileInDevelopment: request.whileInDevelopment,
  };
  const reading = readEditState(input);
  if (!reading.pass) gates.refuse(reading.refusal, editStateRefusalMessage(input, reading));
  gates.pass('state', stateLine(input, reading));
  return reading;
}

/** `text` with CRLF read as LF and its trailing whitespace dropped. */
function normalised(text: string): string {
  return text.replace(/\r\n/gu, '\n').replace(TRAILING_WHITESPACE, '');
}

/**
 * True when `reread`, the issue read after the write, holds what
 * `planned` wrote over `found`; see the module note's after the write.
 */
export function writeHeld(
  found: EditableIssue,
  planned: Pick<PlannedEdit, 'block' | 'change'>,
  reread: EditableIssue,
): boolean {
  const { change } = planned;
  if (change.title !== undefined && reread.title !== change.title) return false;
  const before = found.body.replace(/\r\n/gu, '\n');
  const after = reread.body.replace(/\r\n/gu, '\n');
  if (planned.block !== null) return originalPartHolds(before, after, normalised(planned.block));
  return normalised(after) === normalised(change.body ?? found.body);
}

/** The two scratch paths for issue `issue` at `stamp`, with `-<attempt>` past the first. */
function conflictPaths(issue: number, stamp: string, attempt: number): ConflictBodies {
  const suffix = attempt === 1
    ? ''
    : `-${String(attempt)}`;
  const name = (side: string): string => join(EDIT_SCRATCH_DIR, `${boardId(issue)}-edit-${side}-${stamp}${suffix}.md`);
  return { before: name('before'), after: name('after') };
}

/**
 * Writes the body read before the write and the body read after it under
 * `<root>/.rafa/scratch/`, answering both paths as they sit under
 * `root`. A pair already there, from a conflict in the same second, is
 * never overwritten: the next free `-<attempt>` suffix is taken.
 */
export function saveConflictBodies(root: string, issue: number, now: Date, before: string, after: string): ConflictBodies {
  mkdirSync(join(root, EDIT_SCRATCH_DIR), { recursive: true });
  const stamp = fileStamp(now);
  let attempt = 1;
  let paths = conflictPaths(issue, stamp, attempt);
  while (existsSync(join(root, paths.before)) || existsSync(join(root, paths.after))) {
    attempt += 1;
    paths = conflictPaths(issue, stamp, attempt);
  }
  writeFileSync(join(root, paths.before), before, { flag: 'wx' });
  writeFileSync(join(root, paths.after), after, { flag: 'wx' });
  return paths;
}

/** The outcome a write that held comes to. */
function heldOutcome(request: EditRequest, state: EditStateReading): EditOutcome {
  if (request.kind !== 'append') return 'replaced';
  return state.pass && state.staleCopy
    ? 'stale-copy'
    : 'appended';
}

/** The sentence a held or would-be `outcome` is printed as. */
function outcomeMessage(request: EditRequest, outcome: EditOutcome, branch: string | null, name: string): string {
  switch (outcome) {
    case 'appended':
      return `Appended an update to ${name}; the original part is unchanged.`;
    case 'stale-copy':
      return `Appended an update to ${name}. ${staleCopyMessage(request.issue, branch)}`;
    case 'already':
      return `${name} already ends with this update; nothing was written.`;
    case 'replaced': {
      if (request.text === null) return `Changed the title of ${name}.`;
      return request.title === null
        ? `Replaced the body of ${name}.`
        : `Replaced the body and the title of ${name}.`;
    }
    case 'conflict':
      throw new TypeError('issue edit: a conflict is worded with the paths it saved');
  }
}

/** The sentence a `--dry-run` that passed every gate is printed as. */
function dryRunMessage(issue: number, due: EditOutcome, branch: string | null): string {
  const stale = due === 'stale-copy'
    ? ` ${staleCopyMessage(issue, branch)}`
    : '';
  return `--dry-run: nothing was written; the edit would answer ${due}.${stale}`;
}

/** The sentence a `conflict` is printed as, naming the two bodies it saved. */
function conflictMessage(name: string, scratch: ConflictBodies): string {
  return `The edit was written, but ${name} read back otherwise: somebody changed it around the write. `
    + `The body read before is at ${scratch.before} and the body read after at ${scratch.after}; `
    + 'compare the two and make the edit again over the body as it stands.';
}

/** The report of one run; a conflict adds the bodies it saved. */
function report(
  request: EditRequest,
  planned: PlannedEdit,
  readings: readonly EditGateReading[],
  fields: Pick<EditReport, 'outcome' | 'written' | 'branch' | 'message'>,
): EditReport {
  return Object.freeze({
    ...fields,
    issue: request.issue,
    exitCode: editExitCode(fields.outcome),
    dryRun: request.dryRun,
    added: planned.shown,
    readings,
    refresh: fields.outcome === 'stale-copy'
      ? refreshCommand(request.issue)
      : null,
    scratch: null,
  });
}

/**
 * Edits the issue `options.request` names, in the order the module note
 * gives: one read, four gates, the `already` reading, the write and the
 * re-read. Throws an {@link EditRefusal} for a gate's refusal, and a
 * `CommandExit` with exit code 1 for a read or a write the tracker
 * rejected; answers a report for every outcome, `conflict` included.
 */
export async function runIssueEdit(options: EditRunOptions): Promise<EditReport> {
  const { request, tracker } = options;
  const ref: IssueRef = issueRef(tracker, String(request.issue));
  const name = issueName(ref);
  const now = options.now();
  const found = await onTracker(tracker, `read ${name}`, () => tracker.editable(ref));
  const gates = gatesFor(request);

  await weighOwnership(options, found, gates);
  const planned = planEdit(request, found, now);
  weighText(request, found, planned, gates);
  const state = weighState(options, found, gates);
  const { branch } = state;
  function done(outcome: EditOutcome, written: boolean, message: string): EditReport {
    return report(request, planned, gates.readings, { outcome, written, branch, message });
  }

  const due = planned.already
    ? 'already'
    : heldOutcome(request, state);
  if (request.dryRun) return done(due, false, dryRunMessage(request.issue, due, branch));
  if (planned.already) return done('already', false, outcomeMessage(request, 'already', branch, name));

  await onTracker(tracker, `edit ${name}`, () => tracker.edit(ref, planned.change));
  const reread = await onTracker(tracker, `read ${name} again after the edit was written`, () => tracker.editable(ref));
  if (writeHeld(found, planned, reread)) return done(due, true, outcomeMessage(request, due, branch, name));

  const scratch = saveConflictBodies(options.root, request.issue, now, found.body, reread.body);
  return Object.freeze({ ...done('conflict', true, conflictMessage(name, scratch)), scratch });
}

/** Every line a report prints in text mode: under `--dry-run` the readings and the added part first. */
export function renderEditReport(made: EditReport): string[] {
  if (!made.dryRun) return [made.message];
  return [...made.readings.map(renderReading), 'added:', made.added, made.message];
}

// ---------------------------------------------------------------------
// From a line
// ---------------------------------------------------------------------

/** How the tracker, the trust and the clock are reached; each left out is the system's own. */
export interface EditSeams extends IssueSeams {
  /** Opens the runner the repository label is read through. `git` spawned in the project root when left out. */
  readonly openGit?: (root: string) => GitRunner;
  /** The clock. `new Date()` when left out. */
  readonly now?: () => Date;
}

/** What json mode gives as the terminal result's `data`: the report and the tracker it went through. */
export interface IssueEditResult extends EditReport {
  readonly tracker: IssueTrackerData;
}

/**
 * Runs the edit a line asks for: the line and its text read first, then
 * the tracker through the chain, the project's `specs.dir` and
 * `board.trustedAuthors`, and {@link runIssueEdit} over them, the trust
 * read over `seams.gh` (the tracker's own runner) and the repository
 * label over `seams.openGit`.
 */
export async function editIssue(context: RafaContext, seams: EditSeams): Promise<IssueEditResult> {
  const line = readEditLine(context.args, context.flags);
  const request = await readEditRequest(line, seams.stdin ?? ((): Promise<string> => Bun.stdin.text()));
  const project = issueProject(context);
  const { tracker, data } = await resolveIssueTracker(context, seams);
  const editing = requireEditingTracker(tracker);
  // The chain read the config and wrote its warnings once; this read is for two keys and stays quiet.
  const config = issueSubjectConfig(project, () => undefined);
  const gh: GhRunner = seams.gh ?? createGhRunner({ cwd: project.root });
  const openGit = seams.openGit ?? createGitRunner;

  const made = await runIssueEdit({
    request,
    tracker: editing,
    root: project.root,
    specsDir: config.specsDir,
    trust: () => ghBoardTrust({
      gh,
      trustedAuthors: config.boardTrustedAuthors,
      repo: boardRepoLabel(openGit(project.root)),
    }),
    editor: createGhEditorLogin({ gh }),
    now: seams.now ?? ((): Date => new Date()),
  });
  return Object.freeze({ ...made, tracker: data });
}
