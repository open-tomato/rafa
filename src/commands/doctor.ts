/**
 * `rafa doctor`: the preflight `rafa loop start` runs before its first
 * session, checked and printed with no run started, beside two warnings
 * about the install: an effort store left under `.ralph/effort/`, and
 * `~/.rafa/bin` not on `PATH` ahead of `~/.bun/bin`. "Preflight" and
 * "Ports" in `.specs/phase-1-installable.md`.
 *
 * A top-level command, its action spelled as its subject, so it sits
 * directly under `src/commands/`. It wraps no phase 0 command. It runs
 * inside a project, since the config, the plan and both store directories
 * it reads are the project's, so outside one the dispatcher refuses it
 * with the `rafa init` hint.
 *
 * ## What it checks, in order
 *
 *   1. **The config**, as `loop start` resolves it (`config-load.ts`): the
 *      project's `.rafa/config.yaml` over the user scope's, over the
 *      defaults. A config `loadConfig` refuses is refused.
 *   2. **The plan**: the file `--plan=<file>` names, resolved against the
 *      project root, or the default plan `loop start` falls back to
 *      (`start/plan-path.ts`). A plan named on the line that is no file is
 *      refused. A default plan that is not there leaves no plan, and the
 *      config's items are checked alone. A plan named `PLAN-<stub>.md` has
 *      its `PREREQUISITES-<stub>.md` merged in
 *      (`preflight/prerequisites-md.ts`), and one that cannot be read is
 *      refused. The default plan is named `PLAN.md`, which carries no stub
 *      and so no PREREQUISITES file: `--plan` is how a plan's items reach
 *      the report.
 *   3. **The pull request provider's automatic items**
 *      (`pr/preflight-items.ts`): `gh` on `PATH` and `gh auth status`
 *      for `origin`'s host, both REQUIRED, when the provider resolves
 *      to `gh` (`pr/provider.ts`). They go AHEAD of the configured
 *      required tier, exactly as `runStartPreflight` puts them
 *      (`start/preflight.ts`), because this command answers what
 *      `loop start` would do and would say the wrong thing if it
 *      checked a different set in a different order. A configured
 *      `pr.provider: none` contributes none and reads no remote at
 *      all; every other reading spawns the `origin` probe once.
 *   4. **Every item**, through `runPreflight` (`preflight/run.ts`), as
 *      `loop start` checks them: each probe in the project root with stdin
 *      closed and the 30-second timeout, a presence check for an item with
 *      no probe, and a warning for each optional item that failed, written
 *      as it is found. The environment is the one this invocation was
 *      handed, `process.env` for the registered command. A plan's
 *      start-only `[start]` items are the one set left out: `loop start`
 *      probes that tier on a plan's FIRST DISPATCH alone, the reading it
 *      takes off the tracker beside the plan (`start/preflight.ts`,
 *      `preflight/first-dispatch.ts`), and this command starts no run and
 *      reads no tracker, so none of them reaches this report.
 *
 * ## The board rows
 *
 * A repository that resolves to `pr.provider: gh` also gets one row per
 * part of the GitHub board `rafa init --board` makes — the six labels,
 * the spec issue template, the Roadmap issue and `roadmap.issue` — each
 * read through {@link readBoardStatus} (`board/status.ts`) as present,
 * missing or, for a reading that failed, unknown. A run with any row
 * that is not present ends those lines with `rafa init --board` as the
 * fix, which is the one command that would change them.
 *
 * The provider is resolved ONCE per run, by the same reading that
 * decides the automatic items, so `pr.provider: none` costs no `gh`
 * command and no board row. It is read AFTER the preflight, because the
 * two `gh` commands it sends are worth nothing on a repository whose
 * `gh` is missing or logged out, and the preflight is what says so.
 *
 * A board row never changes the exit code, and never changes a byte:
 * this command reports the gaps and makes none of them. A run whose
 * preflight halted prints its rows before the refusal, since they were
 * read by then and a person reading a halt still wants the whole
 * picture.
 *
 * ## What it does not do
 *
 * It starts no run. No run id is generated, no row goes to the store's
 * `preflight` table, and no tracker, branch or session is touched. So
 * `rafa effort report` lists the halts of `loop start` runs alone. It
 * writes nothing to the board either: the rows are read.
 *
 * ## The two warnings
 *
 * Both are read before the preflight and written after it, whatever it
 * did, a refusal included:
 *
 *   - `readLegacyStore` (`effort/store/legacy.ts`): `.ralph/effort/` under
 *     the project root holds a store file and `.rafa/effort/` holds none.
 *     Directories that cannot be checked are warned about instead.
 *   - `readBinPath` (`project/bin-path.ts`): `~/.rafa/bin` of the
 *     project's home is not on the invocation's `PATH` ahead of
 *     `~/.bun/bin`. When it is, text mode says so in an `info` line, so a
 *     person confirming the order reads an answer rather than a silence.
 *
 * A warning never changes the exit code.
 *
 * ## The exit code
 *
 * 0 when no required item failed, whatever failed among the optional ones
 * and whatever was warned. 1 when a required item failed or timed out,
 * which is when `loop start` would halt before any session: the refusal
 * opens with the runner's halt, which names each such item, its probe,
 * and its exit code with the first line of stderr. 1 as well, each
 * ending `Nothing was checked.`, for a positional word, a `--plan` with
 * no file, a plan named that is no file, a plan path that cannot be
 * checked, such as one under a file (`stat` answers `ENOTDIR`, measured
 * on bun 1.3.14), a config `loadConfig` refuses, and a PREREQUISITES
 * file that cannot be read.
 *
 * ## What it prints
 *
 * In text mode, `rafa <version>` (`src/cli/version.ts`) first, printed
 * before anything is checked so a person reads which build answered
 * whatever the preflight then does; then {@link renderDoctor}'s lines: a
 * head naming the plan, or where none was found, and the PREREQUISITES
 * file merged in; one line per check; the steps that file names and
 * nothing checks; and the verdict with any `known-missing:` lines; then
 * {@link renderBoard}'s lines for a repository that has a GitHub board,
 * and none for one that has not. A halt
 * has no verdict line: it is the refusal, on stderr. json mode prints no
 * version line, where `rafa describe` gives the same version as data, and
 * the terminal result's `data` is a {@link DoctorResult}, every path
 * absolute, for a preflight that did not halt. A halt gives no `data`:
 * the terminal event is the `command_exit` error, whose message is the
 * halt naming every failed required item. In either mode each warning is
 * a `warn` line, a `log` event in json mode.
 *
 * ## Seams
 *
 * The project, its home and the environment are the dispatcher's
 * (`cli/dispatch.ts`), so a case names them through its options. How a
 * probe and a service request run, the timeout, the clock, the
 * `origin` probe the provider is read through and the runner the board
 * rows are read with are {@link DoctorSeams}, each left out being the
 * runner's own.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardRow, BoardStatus } from '../board/status.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { PrProvider } from '../config-sections.js';
import type { PrerequisiteItem, RafaConfig } from '../config.js';
import type { LegacyStoreReading } from '../effort/store/legacy.js';
import type { ResolvePrProviderOptions } from '../pr/provider.js';
import type { PreflightItems, PrerequisiteReminder } from '../preflight/prerequisites-md.js';
import type { PreflightCheck, PreflightOptions, PreflightReport, PreflightTiers } from '../preflight/run.js';
import type { BinPathReading } from '../project/bin-path.js';
import type { ProjectFound } from '../project/scope.js';

import { basename, relative, resolve, sep } from 'node:path';

import { createGhRunner } from '../adapters/tracker/github.js';
import { boardGaps, readBoardStatus } from '../board/status.js';
import { CommandExit } from '../cli/command.js';
import { versionLine } from '../cli/version.js';
import { loadConfig } from '../config-load.js';
import { messageOf } from '../config-sections.js';
import { ConfigError } from '../config.js';
import { readLegacyStore } from '../effort/store/legacy.js';
import { ghPreflightItems } from '../pr/preflight-items.js';
import { resolvePrProvider } from '../pr/provider.js';
import { loadPlanPrerequisites, mergePlanPrerequisites, prerequisitesPathForPlan } from '../preflight/prerequisites-md.js';
import { PROBE_TIMEOUT_MS, runPreflight } from '../preflight/run.js';
import { readBinPath } from '../project/bin-path.js';
import { DEFAULT_PLAN_FILE, resolvePlanPath } from '../start/plan-path.js';

import { BOARD_FIX, BOARD_HEADING } from './init-board.js';
import { isFile, plural } from './plan/plan-files.js';

/** How the checks run; see the module note. Each left out is the runner's own. */
export interface DoctorSeams {
  readonly checks: Pick<PreflightOptions, 'runProbe' | 'request' | 'timeoutMs' | 'now'>;
  /** The `origin` probe the provider is read through. `gitRemoteUrl` when left out. */
  readonly readRemote?: ResolvePrProviderOptions['readRemote'];
  /** Opens the runner the board rows are read with. `gh` spawned in the root when left out. */
  readonly openGh?: (root: string) => GhRunner;
}

/** The seams the registered command runs with: the runner's own, every one. */
export const DEFAULT_DOCTOR_SEAMS: DoctorSeams = Object.freeze({ checks: Object.freeze({}) });

/** The preflight of one plan, checked with no run started. */
export interface DoctorPreflight {
  /** The project root each probe ran in. */
  readonly root: string;
  /** The plan the items were read for, absolute; null when there is none. */
  readonly plan: string | null;
  /** Where the default plan was looked for, in order, when there is no plan; empty otherwise. */
  readonly lookedFor: readonly string[];
  /** The plan's PREREQUISITES file that was merged in, absolute; null when none was. */
  readonly prerequisitesFile: string | null;
  /** How many of the checked items the pull request provider contributed; 0 or 2. */
  readonly automatic: number;
  /** The pull request provider the project resolves to, which decided those items and the board rows. */
  readonly provider: PrProvider;
  /** Every check, and the halt and the `known-missing:` lines the runner worded. */
  readonly report: PreflightReport;
  /** The steps the PREREQUISITES file names and nothing checks. */
  readonly reminders: readonly PrerequisiteReminder[];
}

/** What json mode gives as the terminal result's `data`, for a preflight that did not halt. */
export interface DoctorResult {
  /** The project root each probe ran in. */
  readonly root: string;
  /** The plan the items were read for, absolute; null when there is none. */
  readonly plan: string | null;
  /** The plan's PREREQUISITES file that was merged in, absolute; null when none was. */
  readonly prerequisitesFile: string | null;
  /** Every check, the required tier first. */
  readonly checks: readonly PreflightCheck[];
  /** How many of them the pull request provider contributed, which are the first of the required tier. */
  readonly automatic: number;
  /** The `known-missing:` line of each failed optional item, as every task prompt would carry it. */
  readonly knownMissing: readonly string[];
  /** The steps the PREREQUISITES file names and nothing checks. */
  readonly reminders: readonly PrerequisiteReminder[];
  /** Where `~/.rafa/bin` sits on the `PATH` handed in. */
  readonly binPath: BinPathReading;
  /** Which store files each effort directory holds; null when they could not be checked. */
  readonly legacyStore: LegacyStoreReading | null;
  /** Every part of the GitHub board as it was read; null for a project with no GitHub board. */
  readonly board: BoardStatus | null;
}

/** The two readings about the install, read before the preflight. */
interface InstallReadings {
  readonly binPath: BinPathReading;
  readonly legacyStore: LegacyStoreReading | null;
  /** Why the effort directories could not be checked, as a warning; null when they were. */
  readonly storeProblem: string | null;
}

/** The line every refusal before a check ends with. */
const NOTHING_CHECKED = 'Nothing was checked.';

/** A refusal with exit code 1 of `lines`, ending with {@link NOTHING_CHECKED}. */
function refusal(lines: readonly string[]): CommandExit {
  return new CommandExit(1, [...lines, NOTHING_CHECKED].join('\n'));
}

/** Refuses a line handing `doctor` a positional word. */
function expectNoArgument(args: readonly string[]): void {
  if (args.length === 0) return;
  const got = `${String(args.length)}: ${args.join(' ')}`;
  throw refusal([`rafa doctor: expected no argument, got ${got}; name a plan with --plan=<file>`]);
}

/** The file `--plan` names, or null without the flag, refusing the flag with no file. */
export function readPlanFlag(value: string | boolean | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string' && value !== '') return value;
  throw refusal(['rafa doctor: --plan needs a file: --plan=<file>']);
}

/** The config as it resolves for the project, refusing one `loadConfig` refuses. */
function resolvedConfig(project: ProjectFound, warn: (message: string) => void): RafaConfig {
  try {
    return loadConfig({ root: project.root, home: project.home }, {}, warn).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw refusal(['rafa doctor: the config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)]);
  }
}

/** Where the default plan is looked for, in `resolvePlanPath`'s order, each once. */
function defaultPlanPaths(root: string, planDir: string): readonly string[] {
  return [...new Set([resolve(root, planDir, DEFAULT_PLAN_FILE), resolve(root, DEFAULT_PLAN_FILE)])];
}

/** Whether `path` is a file, refusing a path that cannot be checked. */
function planFileAt(path: string): boolean {
  try {
    return isFile(path);
  } catch (error) {
    throw refusal([`rafa doctor: the plan at ${path} cannot be checked (${messageOf(error)})`]);
  }
}

/** The plan the line names, the default plan, or none; see the module note. */
function choosePlan(root: string, config: RafaConfig, named: string | null): Pick<DoctorPreflight, 'plan' | 'lookedFor'> {
  const path = resolvePlanPath(root, config.planDir, named ?? undefined);
  if (planFileAt(path)) return { plan: path, lookedFor: [] };
  if (named !== null) throw refusal([`rafa doctor: no plan file at ${path}`]);
  return { plan: null, lookedFor: defaultPlanPaths(root, config.planDir) };
}

/** The items for `plan`, or the refusal of a PREREQUISITES file that cannot be read. */
async function loadItems(plan: string | null, config: RafaConfig): Promise<PreflightItems> {
  if (plan === null) return mergePlanPrerequisites(config, null);
  try {
    return await loadPlanPrerequisites(plan, config);
  } catch (error) {
    throw refusal(['rafa doctor: the plan\'s prerequisites cannot be read:', `  ${messageOf(error)}`]);
  }
}

/** The PREREQUISITES file merged in for `plan`, or null when there is none. */
function mergedFile(plan: string | null): string | null {
  const file = plan === null
    ? null
    : prerequisitesPathForPlan(plan);
  return file !== null && isFile(file)
    ? file
    : null;
}

/** No automatic item, for a provider that contributes none. */
const NO_AUTOMATIC_ITEMS: readonly PrerequisiteItem[] = Object.freeze([]);

/** The provider and the REQUIRED items it contributes, read in one go. */
interface ProviderReading {
  readonly provider: PrProvider;
  readonly items: readonly PrerequisiteItem[];
}

/**
 * The project's pull request provider and the REQUIRED items it
 * contributes, as `runStartPreflight` builds them; see the module note.
 * Read once per run: the board rows read the provider off this rather
 * than probing `origin` a second time.
 */
function readProvider(root: string, config: RafaConfig, seams: DoctorSeams): ProviderReading {
  const configured = config.prProvider ?? null;
  if (configured === 'none') return { provider: 'none', items: NO_AUTOMATIC_ITEMS };

  const reading = resolvePrProvider({ configured, dir: root, readRemote: seams.readRemote });
  return { provider: reading.provider, items: ghPreflightItems(reading) };
}

/** Checks the preflight of the plan the line names; see the module note. */
async function checkPreflight(context: RafaContext, project: ProjectFound, seams: DoctorSeams): Promise<DoctorPreflight> {
  expectNoArgument(context.args);
  const named = readPlanFlag(context.flags['plan']);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = resolvedConfig(project, warn);
  const { plan, lookedFor } = choosePlan(project.root, config, named);
  const items = await loadItems(plan, config);
  const automatic = readProvider(project.root, config, seams);
  const tiers: PreflightTiers = { required: [...automatic.items, ...items.required], optional: items.optional };
  const report = await runPreflight(tiers, { ...seams.checks, cwd: project.root, env: context.env, warn });
  return Object.freeze({
    root: project.root,
    plan,
    lookedFor,
    prerequisitesFile: mergedFile(plan),
    automatic: automatic.items.length,
    provider: automatic.provider,
    report,
    reminders: items.reminders,
  });
}

/**
 * Every part of the GitHub board as it stands, or null for a project
 * whose provider is not `gh` and so has no board. Reads and writes
 * nothing of its own; see the module note.
 */
async function checkBoard(preflight: DoctorPreflight, seams: DoctorSeams): Promise<BoardStatus | null> {
  if (preflight.provider !== 'gh') return null;
  const root = preflight.root;
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  return readBoardStatus({ gh: openGh(root), root });
}

/** Both readings about the install; a store that cannot be checked is a warning, not a failure. */
function readInstall(context: RafaContext, project: ProjectFound): InstallReadings {
  const binPath = readBinPath(context.env['PATH'], project.home);
  try {
    return { binPath, legacyStore: readLegacyStore(project.root), storeProblem: null };
  } catch (error) {
    const storeProblem = `rafa doctor: the effort store directories could not be checked: ${messageOf(error)}`;
    return { binPath, legacyStore: null, storeProblem };
  }
}

/** Writes each warning the readings carry, and in text mode the line saying the `PATH` order holds. */
function writeInstall(context: RafaContext, install: InstallReadings): void {
  const { binPath, legacyStore, storeProblem } = install;
  if (storeProblem !== null) context.output.warn(storeProblem);
  if (legacyStore !== null && legacyStore.warning !== null) context.output.warn(legacyStore.warning);
  if (binPath.warning !== null) {
    context.output.warn(binPath.warning);
    return;
  }
  if (context.outputMode !== 'json') {
    context.output.info(`${binPath.rafaBin} is on PATH, and ${binPath.bunBin} is not ahead of it.`);
  }
}

/** A path as a line shows it: relative under the root, absolute elsewhere. */
function shownPath(path: string, root: string): string {
  return path.startsWith(`${root}${sep}`)
    ? relative(root, path)
    : path;
}

/**
 * How many items were checked: nothing, `count` of them with `whose`
 * naming where they came from, or, once the pull request provider
 * contributed any, how many of the `count` were its.
 */
function checkedPhrase(count: number, automatic: number, whose: string): string {
  if (count === 0) return 'nothing to check';
  if (automatic === 0) return `${plural(count, 'item')} ${whose}checked`;
  return `${plural(count, 'item')} checked, ${String(automatic)} of them for the pull request provider`;
}

/** The head line: the plan or where none was found, the file merged in, and how many items were checked. */
function headLine(preflight: DoctorPreflight): string {
  const { root, plan, prerequisitesFile, automatic } = preflight;
  const count = preflight.report.checks.length;
  if (plan === null) {
    const where = preflight.lookedFor.map((path) => shownPath(path, root)).join(' or ');
    const checked = checkedPhrase(count, automatic, 'from the config ');
    return `Preflight with no plan, none being at ${where}: ${checked}, no run started.`;
  }
  const merged = prerequisitesFile === null
    ? ''
    : `, with ${basename(prerequisitesFile)} merged in`;
  const checked = checkedPhrase(count, automatic, '');
  return `Preflight for ${shownPath(plan, root)}${merged}: ${checked}, no run started.`;
}

/** One check as a line: its outcome, its tier, the item, how it was checked and how long it took. */
function checkLine(check: PreflightCheck): string {
  const how = check.item.probe === null
    ? 'presence check'
    : `probe \`${check.item.probe}\``;
  const item = `${check.item.kind} ${JSON.stringify(check.item.name)}`;
  return `  ${check.outcome.padEnd(7)} ${check.tier.padEnd(8)} ${item}, ${how}, ${String(check.durationMs)} ms`;
}

/** The steps the PREREQUISITES file names and nothing checks, under a line naming the file. */
function reminderLines(preflight: DoctorPreflight): readonly string[] {
  const { reminders, prerequisitesFile } = preflight;
  if (reminders.length === 0 || prerequisitesFile === null) return [];
  return [
    `${basename(prerequisitesFile)} names ${plural(reminders.length, 'step')} the preflight does not check:`,
    ...reminders.map((reminder) => `  line ${String(reminder.line)}: ${reminder.description}`),
  ];
}

/** The verdict of a preflight that did not halt, with its `known-missing:` lines; none for a halt. */
function verdictLines(report: PreflightReport): readonly string[] {
  if (report.halt !== null) return [];
  if (report.knownMissing.length === 0) return ['Preflight passed: rafa loop start would go on to its first session.'];
  const named = plural(report.knownMissing.length, 'optional item');
  return [
    `Preflight passed: rafa loop start would go on, naming ${named} known-missing in every task prompt:`,
    ...report.knownMissing.map((line) => `  ${line}`),
  ];
}

/** The lines text mode writes for a preflight; see the module note. */
export function renderDoctor(preflight: DoctorPreflight): readonly string[] {
  return [
    headLine(preflight),
    ...preflight.report.checks.map(checkLine),
    ...reminderLines(preflight),
    ...verdictLines(preflight.report),
  ];
}

/** How wide a board row's outcome column is: `present`, `missing` and `unknown` are each seven. */
const OUTCOME_WIDTH = 7;

/** A row as a line names it: a label under `label <name>`, anything else under its own name. */
function rowName(row: BoardRow): string {
  return row.kind === 'label'
    ? `label ${row.name}`
    : row.name;
}

/**
 * One board row as a line. A row that is present says nothing more —
 * "present" is the whole of it — and every other carries the sentence
 * that made it: what was not there, or what could not be read.
 */
export function boardRowLine(row: BoardRow): string {
  const line = `  ${row.outcome.padEnd(OUTCOME_WIDTH, ' ')}  ${rowName(row)}`;
  return row.outcome === 'present'
    ? line
    : `${line}: ${row.detail}`;
}

/** The lines text mode writes for the board: the heading, a row each, and the fix when any row is not present. */
export function renderBoard(board: BoardStatus | null): readonly string[] {
  if (board === null) return [];
  const gaps = boardGaps(board);
  const fix = gaps.length === 0
    ? []
    : [`Run ${BOARD_FIX} to set up ${plural(gaps.length, 'part')} of the board this run did not find.`];
  return [BOARD_HEADING, ...board.rows.map(boardRowLine), ...fix];
}

/** The refusal for a halt: the runner's own text, then what `loop start` would do. */
function haltRefusal(halt: string): CommandExit {
  return new CommandExit(1, [
    `rafa doctor: ${halt}`,
    'rafa loop start would halt here, before any session. No run was started and nothing was stored.',
  ].join('\n'));
}

/** The data json mode gives for a preflight that did not halt. */
function resultOf(preflight: DoctorPreflight, install: InstallReadings, board: BoardStatus | null): DoctorResult {
  return {
    root: preflight.root,
    plan: preflight.plan,
    prerequisitesFile: preflight.prerequisitesFile,
    checks: preflight.report.checks,
    automatic: preflight.automatic,
    knownMissing: preflight.report.knownMissing,
    reminders: preflight.reminders,
    binPath: install.binPath,
    legacyStore: install.legacyStore,
    board,
  };
}

/** The project the dispatcher resolved, which a command needing one is always handed. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa doctor runs inside a project, and was handed none');
  return context.project;
}

/** Runs `doctor` with `seams`; see the module note. */
async function runDoctor(context: RafaContext, seams: DoctorSeams): Promise<void> {
  const project = projectOf(context);
  if (context.outputMode !== 'json') context.output.info(versionLine());
  const install = readInstall(context, project);
  try {
    const preflight = await checkPreflight(context, project, seams);
    const board = await checkBoard(preflight, seams);
    if (context.outputMode !== 'json') {
      for (const line of [...renderDoctor(preflight), ...renderBoard(board)]) context.output.info(line);
    }
    if (preflight.report.halt !== null) throw haltRefusal(preflight.report.halt);
    if (context.outputMode === 'json') context.output.result(resultOf(preflight, install, board));
  } finally {
    writeInstall(context, install);
  }
}

/** The command, reading `seams`; see the module note. */
export function createDoctorCommand(seams: DoctorSeams = DEFAULT_DOCTOR_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'doctor',
    subject: 'doctor',
    action: 'doctor',
    summary: 'check the prerequisites rafa loop start checks, and the install, starting no run',
    description: 'Checks the prerequisites `rafa loop start` checks before its first session and prints each'
      + ' check, starting no run and storing nothing: the required and optional items of'
      + ' `.rafa/config.yaml`, with the `PREREQUISITES-<stub>.md` beside the plan merged in, and, when the'
      + ' repository resolves to `pr.provider: gh`, the two required items that provider adds ahead of them:'
      + ' `gh` on PATH and `gh auth status` for the remote\'s host. The plan is the'
      + ' one `--plan=<file>` names, relative to the project root, or the default plan `rafa loop start`'
      + ` runs. Each probe runs in the project root with stdin closed and a ${String(PROBE_TIMEOUT_MS / 1000)}-second`
      + ' timeout. It exits 1 when a required item fails, naming the item, its probe and its exit code or'
      + ' first line of stderr, where `rafa loop start` would halt, and 0 otherwise. It warns when'
      + ' `.ralph/effort/` holds an effort store and `.rafa/effort/` holds none, and when `~/.rafa/bin` is'
      + ' not on PATH ahead of `~/.bun/bin`; a warning never changes the exit code. On a repository whose'
      + ' provider is `gh` it also reads the GitHub board `rafa init --board` sets up and prints one row per'
      + ' part — the six labels, the spec issue template, the Roadmap issue and `roadmap.issue` — as present,'
      + ' missing, or unknown for a reading that failed, naming `rafa init --board` as the fix; it writes'
      + ' nothing to the board and a row never changes the exit code. With `--output=json` the'
      + ' checks, both readings and those rows are the data of the terminal result event, unless a required'
      + ' item failed.',
    args: [],
    flags: [
      {
        name: 'plan',
        description: 'The plan whose `PREREQUISITES-<stub>.md` is merged in, relative to the project root.'
          + ' The default plan `rafa loop start` runs when left out.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa doctor',
        note: 'Checks the prerequisites of the config and the install, starting no run.',
      },
      {
        cmd: 'rafa doctor --plan=.rafa/plans/PLAN-my-feature.md',
        note: 'Also checks the items of `PREREQUISITES-my-feature.md` beside the plan, and lists its other steps.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runDoctor(context, seams),
  };
  return Object.freeze(command);
}

export default createDoctorCommand();
