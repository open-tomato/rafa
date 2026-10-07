/**
 * `rafa stretch end [--dry-run]`: closes a stretch (#816). Run once, it
 * opens the pull request from `stretch/<n>` into the default branch.
 * Run again once that pull request has merged, it puts back the
 * `pr.base` that `rafa stretch start` recorded in `stretch.json`. It
 * replaces the engineer operator's `gh pr create --base main --head
 * stretch/<n>` and its hand edit of `.rafa/config.yaml`.
 *
 * ## What it reads first
 *
 * Before any step runs it refuses, with exit code 1, each of:
 *
 *   - a word after the action;
 *   - a config `loadConfig` refuses;
 *   - a `pr.base` that names no `stretch/<n>` branch (`stretchOfBase`):
 *     the stretch to end is the one `pr.base` points at, so a `pr.base`
 *     already put back leaves nothing to end;
 *   - no `.rafa/stretch/<n>/report.md` ({@link reportPath}), or one that
 *     cannot be read. The report is the pull request's body, and every
 *     run reads it, the one that puts `pr.base` back included;
 *   - a `stretch.json` that is there and does not read as a record.
 *
 * The item ledger (`src/stretch/items.ts`) is read whole, and each
 * malformed line is warned about by its number and skipped.
 *
 * ## The body
 *
 * `report.md` as written, then a blank line and the `Closes` lines of
 * every ledger item, in ledger order with each line once
 * ({@link endBody}). An item merged into the integration branch closes
 * nothing on GitHub, which closes an issue only on a merge into the
 * default branch, so this pull request is the one that carries them. A
 * ledger with no `Closes` line leaves the report as it is.
 *
 * ## The two runs
 *
 * The default branch is the one `stretch.json` records the stretch was
 * pushed from, else the one `origin/HEAD` names (`readRemoteHead`), else
 * `main`. Then the provider is resolved as every `pr` action resolves it
 * (`openPrContext`: a provider that is not `gh` is exit code 2) and its
 * recent merges are read (`listMerged`, the newest 100 on `gh`):
 *
 *   - **No merged pull request from `stretch/<n>`.** The body is written
 *     to `.rafa/stretch/<n>/pr-body.md` ({@link bodyPath}) and handed to
 *     the `pr open` logic (`openPull`, `../pr/open.ts`) as the line
 *     `rafa pr open --head=stretch/<n> --base=<default>
 *     --title="Stretch <n>" --body-file=<pr-body.md>`, which is printed
 *     first. So a pull request already open from `stretch/<n>` is printed
 *     and none is opened, and a second run before the merge is a reading.
 *   - **A merged one.** The `pr.base` recorded in `stretch.json` is set
 *     through `withConfigSetting` (`src/config-set.ts`), every comment
 *     kept, and printed as the `rafa config set pr.base=<value>` line. A
 *     record whose `prBase` is null, a project file that set no
 *     `pr.base` before the start, is put back as the recorded default
 *     branch: `src/config-set.ts` sets a key and never removes one, and
 *     the default branch is what an unset `pr.base` resolved to when the
 *     stretch started; the line says so. No `stretch.json` at all, as
 *     when the branch and `pr.base` were made by hand, is refused with
 *     exit code 1 naming the line to run, since nothing records what to
 *     put back.
 *
 * A merged pull request older than the provider's newest 100 merges is
 * not seen, and the run reads as the first one: the `pr open` logic then
 * finds no open pull request and opens a new one, which `gh` refuses for
 * a branch with no commit past the base. Ending a stretch soon after its
 * merge is what keeps that out of reach.
 *
 * ## `--dry-run`
 *
 * The steps are printed in the same order and none is run: no body file,
 * no pull request and no config edit. The readings that decide which
 * steps there are still run: the config, the report, the ledger,
 * `stretch.json`, `origin/HEAD` and the provider's recent merges.
 *
 * ## Exit codes
 *
 * 0 for a pull request opened, one already open, `pr.base` put back or
 * already back, and a dry run. 1 for each refusal above, for a provider
 * call that rejected and for a `pr.base` edit `src/config-set.ts`
 * refuses. 2 for a provider that is not `gh`, and for a body file or
 * config file that could not be written.
 *
 * It starts no Claude session, so it declares no `spends`. Every effect
 * goes through {@link StretchEndSeams}, so no test reaches git or
 * GitHub.
 */
import type { StretchRecord } from './start.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { GitRunner } from '../../pr/git.js';
import type { MergedPullRequest } from '../../pr/types.js';
import type { StretchItem } from '../../stretch/items.js';
import type { PrSeams } from '../pr/pr-context.js';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readRemoteHead } from '../../cleanup/branches.js';
import { CommandExit } from '../../cli/command.js';
import { describeValue, isMapping, messageOf } from '../../config-sections.js';
import { ConfigSetRefusal, withConfigSetting } from '../../config-set.js';
import { configFilePath } from '../../config.js';
import { DEFAULT_BASE_BRANCH } from '../../next/sources.js';
import { createGitRunner } from '../../pr/git.js';
import { stretchFolder } from '../../stretch/folder.js';
import { malformedItemLines, readItems } from '../../stretch/items.js';
import { lineText } from '../../stretch/launch.js';
import { expectNoArgument, readSwitch, requireProject, resolveProjectConfig } from '../plan/plan-files.js';
import { baseWarning, openPull, renderOpen } from '../pr/open.js';
import { DEFAULT_PR_SEAMS, onProvider, openPrContext } from '../pr/pr-context.js';

import { stretchOfBase } from './item.js';
import { PR_BASE_KEY, STRETCH_BRANCH_PREFIX, stretchBranch, stretchRecordPath } from './start.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa stretch end';

/** The usage line a refusal ends with. */
export const STRETCH_END_USAGE = 'rafa stretch end [--dry-run]';

/** The stretch report, in the stretch folder: the pull request's body. */
export const REPORT_FILE = 'report.md';

/** The body handed to `pr open`, written beside the report. */
export const BODY_FILE = 'pr-body.md';

/** The exit code of a refusal. */
const REFUSED_EXIT = 1;

/** The exit code of a step that failed. */
const FAILED_EXIT = 2;

/** What one line asks for. */
export interface EndLine {
  readonly dryRun: boolean;
}

/** The provider and git the command reaches through; see the module note. */
export interface StretchEndSeams {
  /** How the `pr open` logic reaches the provider. */
  readonly pr: PrSeams;
  /** The git runner for the project root, read for `origin/HEAD`. */
  readonly git: (root: string) => GitRunner;
}

/** `<root>/.rafa/stretch/<n>/report.md`. */
export function reportPath(root: string, n: number): string {
  return join(stretchFolder(root, n), REPORT_FILE);
}

/** `<root>/.rafa/stretch/<n>/pr-body.md`. */
export function bodyPath(root: string, n: number): string {
  return join(stretchFolder(root, n), BODY_FILE);
}

/** The title of the pull request into the default branch. */
export function endTitle(n: number): string {
  return `Stretch ${String(n)}`;
}

/** Every item's `Closes` lines, in ledger order, each line once. */
export function closesLines(items: readonly StretchItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.closes))];
}

/** The body: the report, then a blank line and the `Closes` lines when there are any. */
export function endBody(report: string, closes: readonly string[]): string {
  if (closes.length === 0) return report;
  return `${report.trimEnd()}\n\n${closes.join('\n')}\n`;
}

/** A refusal with exit code 1 naming `why`. */
function refusal(why: string): CommandExit {
  return new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** A failure with exit code 2 naming `why`. */
function failure(why: string): CommandExit {
  return new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** Reads the line; see the module note. */
export function readEndLine(context: RafaContext): EndLine {
  expectNoArgument(context.args, STRETCH_END_USAGE);
  return { dryRun: readSwitch('dry-run', context.flags['dry-run'], `Usage: ${STRETCH_END_USAGE}`) };
}

/** The stretch `pr.base` names; a refusal for one naming no `stretch/<n>` branch. */
function requireStretchBase(prBase: string | null): number {
  const n = stretchOfBase(prBase);
  if (n !== null) return n;
  const found = prBase === null
    ? 'not set'
    : `"${prBase}"`;
  throw refusal(`${PR_BASE_KEY} is ${found}, expected a ${STRETCH_BRANCH_PREFIX}<n> branch: the stretch to end is the one`
    + ` ${PR_BASE_KEY} points at, and a ${PR_BASE_KEY} already put back leaves none to end. Nothing was run.`);
}

/** What `report.md` holds; a refusal when there is none or it cannot be read. */
function readReport(root: string, n: number): string {
  const path = reportPath(root, n);
  if (!existsSync(path)) {
    throw refusal(`there is no ${path}: write the stretch report first, since it is the pull request's body. Nothing was run.`);
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw refusal(`${path} could not be read: ${messageOf(error)}. Nothing was run.`);
  }
}

/** The text field `name` of `record`, or a refusal naming the file. */
function recordText(record: Readonly<Record<string, unknown>>, name: string, path: string): string {
  const value = record[name];
  if (typeof value === 'string' && value !== '') return value;
  throw refusal(`${path} holds ${name} ${describeValue(value)}, expected a branch name. Nothing was run.`);
}

/** `stretch.json` of stretch `n`, or null when there is none; a refusal for one that does not read as a record. */
export function readStretchRecord(root: string, n: number): StretchRecord | null {
  const path = stretchRecordPath(root, n);
  if (!existsSync(path)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw refusal(`${path} could not be read as JSON: ${messageOf(error)}. Nothing was run.`);
  }
  if (!isMapping(value)) throw refusal(`${path} holds ${describeValue(value)}, expected an object. Nothing was run.`);
  const prBase = value['prBase'];
  if (prBase !== null && (typeof prBase !== 'string' || prBase === '')) {
    throw refusal(`${path} holds prBase ${describeValue(prBase)}, expected a branch name or null. Nothing was run.`);
  }
  const startedAt = value['startedAt'];
  return {
    stretch: n,
    branch: recordText(value, 'branch', path),
    defaultBranch: recordText(value, 'defaultBranch', path),
    prBase,
    startedAt: typeof startedAt === 'string'
      ? startedAt
      : '',
  };
}

/** The ledger's items, each malformed line warned about. */
function ledgerItems(context: RafaContext, root: string, n: number): readonly StretchItem[] {
  let reading;
  try {
    reading = readItems(root, n);
  } catch (error) {
    throw refusal(`the item ledger could not be read: ${messageOf(error)}. Nothing was run.`);
  }
  for (const line of malformedItemLines(root, n, reading.malformed)) context.output.warn(line);
  return reading.items;
}

/** What both runs share once the readings are made. */
interface EndInput {
  readonly root: string;
  readonly n: number;
  readonly defaultBranch: string;
  readonly record: StretchRecord | null;
  readonly dryRun: boolean;
}

/** The second run: `pr.base` put back once the pull request from `stretch/<n>` has merged; see the module note. */
function putBack(context: RafaContext, input: EndInput, merged: MergedPullRequest): void {
  const info = (text: string): void => context.output.info(text);
  const branch = stretchBranch(input.n);
  info(`#${String(merged.number)} from ${branch} merged at ${merged.mergedAt}`);
  const { record } = input;
  if (record === null) {
    throw refusal(`no ${stretchRecordPath(input.root, input.n)} records the ${PR_BASE_KEY} to put back, as when the branch`
      + ` and ${PR_BASE_KEY} were made by hand. Set it yourself: rafa config set ${PR_BASE_KEY}=<branch>. Nothing was set.`);
  }
  const value = record.prBase ?? record.defaultBranch;
  if (record.prBase === null) {
    info(`${stretchRecordPath(input.root, input.n)} records no ${PR_BASE_KEY}, so it is put back as ${value}, the branch the stretch was pushed from`);
  }
  const path = configFilePath(input.root);
  let edit;
  try {
    edit = withConfigSetting(readFileSync(path, 'utf8'), PR_BASE_KEY, value, path);
  } catch (error) {
    const why = error instanceof ConfigSetRefusal
      ? `${PR_BASE_KEY} cannot be set: ${error.message}`
      : `${path} could not be read: ${messageOf(error)}`;
    throw refusal(`${why}. Nothing was set.`);
  }
  if (!edit.changed) {
    info(`${path} already reads ${PR_BASE_KEY}: ${value}`);
    return;
  }
  // Written out rather than through `lineText`, as `stretch start` writes its own `config set` line.
  info(`rafa config set ${PR_BASE_KEY}=${value}`);
  if (input.dryRun) {
    info(`dry run: would put ${PR_BASE_KEY} back to ${value}; nothing was run`);
    return;
  }
  try {
    writeFileSync(path, edit.text, 'utf8');
  } catch (error) {
    throw failure(`${path} could not be written: ${messageOf(error)}. ${PR_BASE_KEY} still reads ${branch}.`);
  }
  info(`${PR_BASE_KEY}: ${branch} → ${value}; stretch ${String(input.n)} is ended`);
}

/** The first run: the body written and the `pr open` logic run over it; see the module note. */
async function openEnd(context: RafaContext, input: EndInput, body: string, seams: StretchEndSeams): Promise<void> {
  const info = (text: string): void => context.output.info(text);
  const path = bodyPath(input.root, input.n);
  const flags = {
    head: stretchBranch(input.n),
    base: input.defaultBranch,
    title: endTitle(input.n),
    'body-file': path,
  };
  info(`write ${path}: ${REPORT_FILE} with the ledger's Closes lines`);
  info(lineText(['rafa', 'pr', 'open', ...Object.entries(flags).map(([name, value]) => `--${name}=${value}`)]));
  if (input.dryRun) {
    info(`dry run: would open ${flags.head} into ${flags.base}, or print the pull request already open from it; nothing was run`);
    return;
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
  } catch (error) {
    throw failure(`${path} could not be written: ${messageOf(error)}. No pull request was opened.`);
  }
  const result = await openPull({ ...context, args: [], flags }, seams.pr);
  const warning = baseWarning(result);
  if (warning !== null) context.output.warn(warning);
  info(renderOpen(result));
  info(`once #${String(result.pull.number)} has merged, run rafa stretch end again to put ${PR_BASE_KEY} back`);
}

/** Runs the line; see the module note. */
export async function runStretchEnd(context: RafaContext, seams: StretchEndSeams): Promise<void> {
  const line = readEndLine(context);
  const project = requireProject(context, COMMAND_NAME);
  const { root } = project;
  const config = resolveProjectConfig(project, COMMAND_NAME, (text) => context.output.warn(text));
  const n = requireStretchBase(config.prBase);
  const report = readReport(root, n);
  const closes = closesLines(ledgerItems(context, root, n));
  const record = readStretchRecord(root, n);
  const defaultBranch = record?.defaultBranch ?? readRemoteHead(seams.git(root)) ?? DEFAULT_BASE_BRANCH;

  context.output.info(`stretch end: stretch ${String(n)} (${stretchBranch(n)} into ${defaultBranch}), ${String(closes.length)}`
    + ` Closes line(s) from the ledger${line.dryRun
      ? ', dry run: each step is printed and none is run'
      : ''}`);
  const pr = openPrContext(context, seams.pr);
  const merges = await onProvider('read the merged pull requests', () => pr.pulls.listMerged());
  const input: EndInput = { root, n, defaultBranch, record, dryRun: line.dryRun };
  const merged = merges.find((pull) => pull.headRefName === stretchBranch(n));
  if (merged !== undefined) {
    putBack(context, input, merged);
    return;
  }
  await openEnd(context, input, endBody(report, closes), seams);
}

/** The real provider and git. */
export function defaultStretchEndSeams(): StretchEndSeams {
  return { pr: DEFAULT_PR_SEAMS, git: createGitRunner };
}

/** The command over `seams`, the real ones made when it runs unless a case hands its own. */
export function createStretchEndCommand(seams?: StretchEndSeams): RafaCommand {
  const command: RafaCommand = {
    name: 'stretch end',
    subject: 'stretch',
    action: 'end',
    summary: 'open the stretch branch into the default branch, then put pr.base back once it has merged',
    description: 'Ends the stretch `pr.base` names, refusing a `pr.base` that names no `stretch/<n>` branch and'
      + ' a stretch with no `.rafa/stretch/<n>/report.md`. Run before the merge, it writes the report with every'
      + ' `Closes` line of the item ledger appended to `.rafa/stretch/<n>/pr-body.md` and opens `stretch/<n>` into'
      + ' the default branch through the `pr open` logic, printing the pull request already open from it instead'
      + ' when there is one. Run once that pull request has merged, it sets `pr.base` back to what'
      + ' `.rafa/stretch/<n>/stretch.json` recorded, with every comment kept. `--dry-run` prints every step in'
      + ' order and runs none. Exit code 1 for a refusal, 2 for a provider that is not `gh` or a file that could'
      + ' not be written. Starts no session.',
    args: [],
    flags: [
      { name: 'dry-run', description: 'Print every step in order, and run none of them.', type: 'boolean' },
    ],
    examples: [
      { cmd: 'rafa stretch end --dry-run', note: 'Prints the body file and the pr open line, or the pr.base edit after the merge.' },
      { cmd: 'rafa stretch end', note: 'Opens stretch/<n> into the default branch; run again after the merge to put pr.base back.' },
    ],
    outputs: ['text'],
    run: async (context) => runStretchEnd(context, seams ?? defaultStretchEndSeams()),
  };
  return Object.freeze(command);
}

export default createStretchEndCommand();
