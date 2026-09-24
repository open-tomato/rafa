/**
 * `rafa doctor`: the preflight `rafa loop start` runs before its first
 * session, checked and printed with no run started, beside two warnings
 * about the install: an effort store left under `.ralph/effort/`, and
 * `~/.rafa/bin` not on `PATH` ahead of `~/.bun/bin`. See the phase 1
 * installable spec for "Preflight" and "Ports".
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
 *   4. **The plan's start-only `[start]` items**
 *      (`preflight/prerequisites-md.ts`), between the provider's items
 *      and the configured required tier, exactly where
 *      `runStartPreflight` puts them (`start/preflight.ts`). `loop start`
 *      probes that tier on a plan's FIRST DISPATCH alone, and this
 *      command reads that one bit the way a run does: `isFirstDispatch`
 *      (`preflight/first-dispatch.ts`) off the TRACKER beside the plan,
 *      a `PLAN_TRACKER-<stub>.md` already holding a ticked task making
 *      the next run a resume. Reading it starts nothing and writes
 *      nothing: the tracker is a document this command opens, not a run
 *      of its own. On a resume none of those items is checked, counted
 *      or able to change the exit code, and one line names how many the
 *      report passed over and the tracker that decided it, since on a
 *      resume nothing else in the report would say they exist.
 *   5. **Every item**, through `runPreflight` (`preflight/run.ts`), as
 *      `loop start` checks them: each probe in the project root with stdin
 *      closed and the 30-second timeout, a presence check for an item with
 *      no probe, and a warning for each optional item that failed, written
 *      as it is found. The environment is the one this invocation was
 *      handed, `process.env` for the registered command.
 *
 * ## The board rows
 *
 * A repository that resolves to `pr.provider: gh` also gets one row per
 * part of the GitHub board `rafa init --board` makes — the seven labels,
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
 * ## The blocked issues
 *
 * That same repository gets one more reading, through the same runner:
 * every open issue labelled `spec:blocked` whose `Blocked by:` line is
 * missing or unreadable, named under `Blocked issues:`
 * (`./doctor-blocked.ts`, which holds the `gh` commands, the lines and
 * why they are a module of their own). It is the report half of a
 * dependency the spec keeps as data and refuses to guess at, and like a
 * board row it writes nothing and never changes the exit code.
 *
 * ## The cleanup row
 *
 * Every repository then gets the counts `rafa cleanup` would list, read
 * without fetching (`./doctor-cleanup.ts`, which holds what is read and
 * where), as one row pointing at that command, printed after the
 * blocked issues and only when any count is above zero. It never
 * changes the exit code.
 *
 * ## The risk total
 *
 * A plan `--plan` names also gets the one line `loop start` prints before
 * its notices (`start/risk-total.ts`), e.g.
 * `🛡  Risk: 2 high, 6 notes — rafa plan risk .rafa/plans/PLAN-x.md`:
 * the reading `rafa plan risk` totals, of the plan's text, the resolved
 * config and the environment's keys, never its values. It follows the
 * plan's lines, a halt's included, and precedes the board rows. A reading
 * that throws is a warning naming the plan. Neither changes the exit code.
 * The default plan gets no line: `--plan` is how a plan asks for one.
 *
 * ## The deep sections
 *
 * `--deep` adds the machine as a loop session sees it, read once per run
 * by `readDeep` (`./doctor-deep.ts`, which holds what each section reads
 * and under which environment): Environment, Settings, Providers and
 * Stack tools, and Plan needs for a plan `--plan` names, the default plan
 * getting none. They are read after the blocked issues and printed after
 * them, a halt's included, so a halt prints them before its refusal. It
 * is code alone and starts no Claude session. Every row is `ok`, `warn`
 * or `note`, none is a preflight item, and none changes the exit code.
 * Without the flag nothing of it is read.
 *
 * ## What it does not do
 *
 * It starts no run. No run id is generated, no row goes to the store's
 * `preflight` table, and no tracker, branch or session is touched. So
 * `rafa effort report` lists the halts of `loop start` runs alone. It
 * writes nothing to the board either: the rows are read.
 *
 * ## The three warnings
 *
 * Each is read before the preflight and written after it, whatever it
 * did, a refusal included, by `./doctor-install.ts`:
 *
 *   - `readLegacyStore` (`effort/store/legacy.ts`): `.ralph/effort/` under
 *     the project root holds a store file and `.rafa/effort/` holds none.
 *     Directories that cannot be checked are warned about instead.
 *   - `readBinPath` (`project/bin-path.ts`): `~/.rafa/bin` of the
 *     project's home is not on the invocation's `PATH` ahead of
 *     `~/.bun/bin`. When it is, text mode says so in an `info` line, so a
 *     person confirming the order reads an answer rather than a silence.
 *   - `readPreInitDirs` (`project/pre-init-dirs.ts`): `plan.dir` or
 *     `specs.dir` still names the top-level directory rafa used before it
 *     had defaults of its own. A project resolving to the defaults is
 *     warned about in neither mode, so it reads no line at all. The
 *     config this reads is loaded on its own and its problems are left to
 *     the preflight, which refuses a config `loadConfig` will not give.
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
 * no file, a `--deep` holding a value, a plan named that is no file, a plan path that cannot be
 * checked, such as one under a file (`stat` answers `ENOTDIR`, measured
 * on bun 1.3.14), a config `loadConfig` refuses, and a PREREQUISITES
 * file that cannot be read.
 *
 * ## What it prints
 *
 * In text mode, `rafa <version>` (`src/cli/version.ts`) first, printed
 * before anything is checked so a person reads which build answered
 * whatever the preflight then does; then {@link renderDoctor}'s lines
 * (`./doctor-render.ts`): a head naming the plan, or where none was
 * found, and the PREREQUISITES file merged in; one line per check; the
 * line naming the start-only items a resume passed over; the steps that
 * file names and nothing checks; and the verdict with any
 * `known-missing:` lines; then the risk total of a plan `--plan` names;
 * then `renderBoard`'s lines (`./doctor-render.ts`) for a repository that has a GitHub board,
 * and none for one that has not; then {@link renderBlockedIssues}'s
 * lines, which a board holding no issue labelled `spec:blocked` has
 * none of either; then the cleanup row, when there is anything to
 * clean; then, under `--deep`, `renderDeep`'s sections. A halt
 * has no verdict line: it is the refusal, on stderr. json mode prints no
 * version line, where `rafa describe` gives the same version as data, and
 * the terminal result's `data` is a {@link DoctorResult}, every path
 * absolute, for a preflight that did not halt. A halt gives no `data`:
 * the terminal event is the `command_exit` error, whose message is the
 * halt naming every failed required item. In either mode each warning is
 * a `warn` line, a `log` event in json mode, and so is the risk total, at
 * `info`.
 *
 * ## Seams
 *
 * The project, its home and the environment are the dispatcher's
 * (`cli/dispatch.ts`), so a case names them through its options. How a
 * probe and a service request run, the timeout, the clock, the
 * `origin` probe the provider is read through, the runner the board rows
 * and the blocked issues are read with, and the git and `gh` the risk
 * total reads the accounts through are {@link DoctorSeams},
 * each left out being the runner's own, and so are the `--deep` reading's
 * (`DeepDoctorSeams`).
 */
import type { BlockedIssuesReport } from './doctor-blocked.js';
import type { DoctorCleanupReading, DoctorCleanupSeams } from './doctor-cleanup.js';
import type { DeepDoctorSeams, DeepReading } from './doctor-deep.js';
import type { InstallReadings } from './doctor-install.js';
import type { PreviousCopiesReading } from './doctor-previous.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardStatus } from '../board/status.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { PrProvider } from '../config-sections.js';
import type { PrerequisiteItem, RafaConfig, ResolvedConfig } from '../config.js';
import type { LegacyStoreReading } from '../effort/store/legacy.js';
import type { AccountSeams } from '../plan/risk/accounts.js';
import type { ResolvePrProviderOptions } from '../pr/provider.js';
import type { PreflightItems, PrerequisiteReminder } from '../preflight/prerequisites-md.js';
import type { PreflightCheck, PreflightOptions, PreflightReport, PreflightTiers } from '../preflight/run.js';
import type { BinPathReading } from '../project/bin-path.js';
import type { PreInitDirsReading } from '../project/pre-init-dirs.js';
import type { ProjectFound } from '../project/scope.js';

import { basename, resolve } from 'node:path';

import { createGhRunner } from '../adapters/tracker/github.js';
import { readBoardStatus } from '../board/status.js';
import { CommandExit } from '../cli/command.js';
import { versionLine } from '../cli/version.js';
import { loadConfig } from '../config-load.js';
import { messageOf } from '../config-sections.js';
import { ConfigError } from '../config.js';
import { ghPreflightItems } from '../pr/preflight-items.js';
import { resolvePrProvider } from '../pr/provider.js';
import { isFirstDispatch } from '../preflight/first-dispatch.js';
import { loadPlanPrerequisites, mergePlanPrerequisites, prerequisitesPathForPlan } from '../preflight/prerequisites-md.js';
import { PROBE_TIMEOUT_MS, runPreflight } from '../preflight/run.js';
import { DEFAULT_PLAN_FILE, resolvePlanPath } from '../start/plan-path.js';
import { announceRiskTotal } from '../start/risk-total.js';
import { trackerPathFor } from '../utils/tracker.js';

import { readBlockedIssues, renderBlockedIssues } from './doctor-blocked.js';
import { readDoctorCleanup, renderDoctorCleanup } from './doctor-cleanup.js';
import { readDeep, renderDeep } from './doctor-deep.js';
import { readInstall, writeInstall } from './doctor-install.js';
import { renderBoard, renderDoctor } from './doctor-render.js';
import { isFile } from './plan/plan-files.js';

/**
 * How the checks run; see the module note. Each left out is the
 * runner's own. The `--deep` reading's own seams — the directory a
 * session runs in, the runner its provider probes go through, and how
 * its inventory is built — are {@link DeepDoctorSeams} (`./doctor-deep.ts`).
 */
export interface DoctorSeams extends DeepDoctorSeams, DoctorCleanupSeams {
  readonly checks: Pick<PreflightOptions, 'runProbe' | 'request' | 'timeoutMs' | 'now'>;
  /** The `origin` probe the provider is read through. `gitRemoteUrl` when left out. */
  readonly readRemote?: ResolvePrProviderOptions['readRemote'];
  /** Opens the runner both board readings go through. `gh` spawned in the root when left out. */
  readonly openGh?: (root: string) => GhRunner;
  /** git and `gh` for the plan's risk total, at a root. Both spawned there when left out. */
  readonly riskRunners?: (root: string) => AccountSeams;
}

/** The seams the registered command runs with: the runner's own, every one. */
export const DEFAULT_DOCTOR_SEAMS: DoctorSeams = Object.freeze({ checks: Object.freeze({}) });

/**
 * How a report read the plan's start-only `[start]` items: probed on a
 * first dispatch, passed over on a resume. See the module note.
 */
export interface DoctorStartTier {
  /** How many of them were checked: the plan's own on a first dispatch, none on a resume. */
  readonly checked: number;
  /** How many of them this resume passed over unchecked; 0 on a first dispatch. */
  readonly skipped: number;
  /** The tracker whose ticked task made this a resume, by its base name; null on a first dispatch. */
  readonly tracker: string | null;
}

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
  /** How the plan's start-only `[start]` items were read, and how many of the checked items are theirs. */
  readonly startTier: DoctorStartTier;
  /** Every check, and the halt and the `known-missing:` lines the runner worded. */
  readonly report: PreflightReport;
  /** The steps the PREREQUISITES file names and nothing checks. */
  readonly reminders: readonly PrerequisiteReminder[];
  /** The config the preflight resolved, which the plan's risk total reads too. */
  readonly config: RafaConfig;
  /** That config with where each key came from, which the `--deep` reading reads. */
  readonly resolved: ResolvedConfig;
  /** Whether the line asked for the `--deep` sections. */
  readonly deep: boolean;
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
  /** How the plan's start-only `[start]` items were read: how many were checked, and how many a resume passed over. */
  readonly startTier: DoctorStartTier;
  /** The `known-missing:` line of each failed optional item, as every task prompt would carry it. */
  readonly knownMissing: readonly string[];
  /** The steps the PREREQUISITES file names and nothing checks. */
  readonly reminders: readonly PrerequisiteReminder[];
  /** Where `~/.rafa/bin` sits on the `PATH` handed in. */
  readonly binPath: BinPathReading;
  /** Which store files each effort directory holds; null when they could not be checked. */
  readonly legacyStore: LegacyStoreReading | null;
  /** Which of `plan.dir` and `specs.dir` still name a pre-init directory; null for a config that could not be loaded. */
  readonly preInitDirs: PreInitDirsReading | null;
  /** How many previous copies `previous/` under `specs.dir` holds; null when they could not be counted. */
  readonly previousCopies: PreviousCopiesReading | null;
  /** Every part of the GitHub board as it was read; null for a project with no GitHub board. */
  readonly board: BoardStatus | null;
  /** Every open issue labelled `spec:blocked`, read; null for a project with no GitHub board. */
  readonly blocked: BlockedIssuesReport | null;
  /** How many rows each group `rafa cleanup` lists holds, read without fetching, or why git refused. */
  readonly cleanup: DoctorCleanupReading;
  /** Every `--deep` section as it was read; null without `--deep`. */
  readonly deep: DeepReading | null;
}

/** Both readings of the GitHub board, each null for a project that has none, and the cleanup counts. */
interface BoardReadings {
  readonly board: BoardStatus | null;
  readonly blocked: BlockedIssuesReport | null;
  readonly cleanup: DoctorCleanupReading;
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

/** Whether the line asks for the `--deep` sections, refusing `--deep` holding a value. */
export function readDeepFlag(value: string | boolean | undefined): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw refusal([`rafa doctor: --deep takes no value, and read "${value}" as one; name a plan with --plan=<file>`]);
}

/** The config as it resolves for the project, refusing one `loadConfig` refuses. */
function resolvedConfig(project: ProjectFound, warn: (message: string) => void): ResolvedConfig {
  try {
    return loadConfig({ root: project.root, home: project.home }, {}, warn);
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

/** No item at all, for a tier that contributes none. */
const NO_ITEMS: readonly PrerequisiteItem[] = Object.freeze([]);

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
  if (configured === 'none') return { provider: 'none', items: NO_ITEMS };

  const reading = resolvePrProvider({ configured, dir: root, readRemote: seams.readRemote });
  return { provider: reading.provider, items: ghPreflightItems(reading) };
}

/** No start-only item read at all, for a run with no plan and a plan carrying none. */
const NO_START_TIER: DoctorStartTier = Object.freeze({ checked: 0, skipped: 0, tracker: null });

/** The start-only items this report probes, and how they were read. */
interface StartReading {
  readonly tier: DoctorStartTier;
  readonly items: readonly PrerequisiteItem[];
}

/**
 * The plan's start-only `[start]` items this report probes: the plan's
 * own on a first dispatch, and none on a resume, which is what the
 * tracker beside the plan says (`preflight/first-dispatch.ts`). See the
 * module note.
 */
function readStartTier(plan: string | null, items: PreflightItems): StartReading {
  const start = items.startRequired;
  if (plan === null || start.length === 0) return { tier: NO_START_TIER, items: NO_ITEMS };
  if (isFirstDispatch(plan)) return { tier: { checked: start.length, skipped: 0, tracker: null }, items: start };

  const tracker = basename(trackerPathFor(plan));
  return { tier: { checked: 0, skipped: start.length, tracker }, items: NO_ITEMS };
}

/** Checks the preflight of the plan the line names; see the module note. */
async function checkPreflight(context: RafaContext, project: ProjectFound, seams: DoctorSeams): Promise<DoctorPreflight> {
  expectNoArgument(context.args);
  const named = readPlanFlag(context.flags['plan']);
  const deep = readDeepFlag(context.flags['deep']);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const resolved = resolvedConfig(project, warn);
  const { config } = resolved;
  const { plan, lookedFor } = choosePlan(project.root, config, named);
  const items = await loadItems(plan, config);
  const automatic = readProvider(project.root, config, seams);
  const start = readStartTier(plan, items);
  const tiers: PreflightTiers = {
    required: [...automatic.items, ...start.items, ...items.required],
    optional: items.optional,
  };
  const report = await runPreflight(tiers, { ...seams.checks, cwd: project.root, env: context.env, warn });
  return Object.freeze({
    root: project.root,
    plan,
    lookedFor,
    prerequisitesFile: mergedFile(plan),
    automatic: automatic.items.length,
    provider: automatic.provider,
    startTier: start.tier,
    report,
    reminders: items.reminders,
    config,
    resolved,
    deep,
  });
}

/**
 * The runner both board readings go through, opened once, or null for
 * a project whose provider is not `gh` and so has no board.
 */
function boardRunner(preflight: DoctorPreflight, seams: DoctorSeams): GhRunner | null {
  if (preflight.provider !== 'gh') return null;
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  return openGh(preflight.root);
}

/**
 * Every part of the GitHub board as it stands, or null for a project
 * that has none. Reads and writes nothing of its own; see the module
 * note.
 */
async function checkBoard(preflight: DoctorPreflight, gh: GhRunner | null): Promise<BoardStatus | null> {
  if (gh === null) return null;
  return readBoardStatus({ gh, root: preflight.root });
}

/**
 * Every open issue labelled `spec:blocked`, read, or null for a project
 * that has no board; see the module note and `./doctor-blocked.ts`.
 */
async function checkBlocked(gh: GhRunner | null): Promise<BlockedIssuesReport | null> {
  if (gh === null) return null;
  return readBlockedIssues({ gh });
}

/** The refusal for a halt: the runner's own text, then what `loop start` would do. */
function haltRefusal(halt: string): CommandExit {
  return new CommandExit(1, [
    `rafa doctor: ${halt}`,
    'rafa loop start would halt here, before any session. No run was started and nothing was stored.',
  ].join('\n'));
}

/**
 * Every `--deep` section, read once, or null without the flag; see
 * `./doctor-deep.ts`. The plan is the one `--plan` names alone, as the
 * default plan gets no Plan needs section.
 */
async function checkDeep(context: RafaContext, preflight: DoctorPreflight, seams: DoctorSeams): Promise<DeepReading | null> {
  if (!preflight.deep) return null;
  const plan = context.flags['plan'] === undefined
    ? null
    : preflight.plan;
  return readDeep({ project: projectOf(context), env: context.env, resolved: preflight.resolved, plan }, seams);
}

/** The data json mode gives for a preflight that did not halt. */
function resultOf(preflight: DoctorPreflight, install: InstallReadings, readings: BoardReadings, deep: DeepReading | null): DoctorResult {
  return {
    root: preflight.root,
    plan: preflight.plan,
    prerequisitesFile: preflight.prerequisitesFile,
    checks: preflight.report.checks,
    automatic: preflight.automatic,
    startTier: preflight.startTier,
    knownMissing: preflight.report.knownMissing,
    reminders: preflight.reminders,
    binPath: install.binPath,
    legacyStore: install.legacyStore,
    preInitDirs: install.preInitDirs,
    previousCopies: install.previousCopies,
    board: readings.board,
    blocked: readings.blocked,
    cleanup: readings.cleanup,
    deep,
  };
}

/** The project the dispatcher resolved, which a command needing one is always handed. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa doctor runs inside a project, and was handed none');
  return context.project;
}

/** Writes `lines` at `info` in text mode, and nothing in json mode. */
function writeText(context: RafaContext, lines: readonly string[]): void {
  if (context.outputMode === 'json') return;
  for (const line of lines) context.output.info(line);
}

/**
 * The plan's risk total, for a plan `--plan` names: the line
 * `loop start` prints, or a warning when it cannot be read. See the
 * module note.
 */
async function announceRisk(context: RafaContext, preflight: DoctorPreflight, seams: DoctorSeams): Promise<void> {
  if (preflight.plan === null || context.flags['plan'] === undefined) return;
  const { root, plan, config } = preflight;
  const home = projectOf(context).home;
  const input = { repoRoot: root, home, planPath: plan, config, environment: context.env };
  await announceRiskTotal(input, { output: context.output, runners: seams.riskRunners });
}

/** Runs `doctor` with `seams`; see the module note. */
async function runDoctor(context: RafaContext, seams: DoctorSeams): Promise<void> {
  const project = projectOf(context);
  if (context.outputMode !== 'json') context.output.info(versionLine());
  const install = readInstall(context, project);
  try {
    const preflight = await checkPreflight(context, project, seams);
    const gh = boardRunner(preflight, seams);
    const cleanup = await readDoctorCleanup({ root: project.root, home: project.home, config: preflight.config, gh }, seams);
    const readings: BoardReadings = { board: await checkBoard(preflight, gh), blocked: await checkBlocked(gh), cleanup };
    writeText(context, renderDoctor(preflight));
    await announceRisk(context, preflight, seams);
    const repository = [...renderBoard(readings.board), ...renderBlockedIssues(readings.blocked)];
    writeText(context, [...repository, ...renderDoctorCleanup(readings.cleanup)]);
    const deep = await checkDeep(context, preflight, seams);
    writeText(context, deep === null
      ? []
      : renderDeep(deep));
    if (preflight.report.halt !== null) throw haltRefusal(preflight.report.halt);
    if (context.outputMode === 'json') context.output.result(resultOf(preflight, install, readings, deep));
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
      + ' `gh` on PATH and `gh auth status` for the remote\'s host. A plan\'s `[start]` items are checked'
      + ' after those and ahead of the configured tiers, on a first dispatch alone: a'
      + ' `PLAN_TRACKER-<stub>.md` beside the plan already holding a ticked task makes the next run a'
      + ' resume, which checks none of them and says in one line how many it passed over.'
      + ' The plan is the'
      + ' one `--plan=<file>` names, relative to the project root, or the default plan `rafa loop start`'
      + ` runs. Each probe runs in the project root with stdin closed and a ${String(PROBE_TIMEOUT_MS / 1000)}-second`
      + ' timeout. It exits 1 when a required item fails, naming the item, its probe and its exit code or'
      + ' first line of stderr, where `rafa loop start` would halt, and 0 otherwise. It warns when'
      + ' `.ralph/effort/` holds an effort store and `.rafa/effort/` holds none, and when `~/.rafa/bin` is'
      + ' not on PATH ahead of `~/.bun/bin`, and when `previous/` under `specs.dir` holds more than fifty'
      + ' previous copies of issue specs, which are safe to delete; a warning never changes the exit code. On a repository whose'
      + ' provider is `gh` it also reads the GitHub board `rafa init --board` sets up and prints one row per'
      + ' part — the seven labels, the spec issue template, the Roadmap issue and `roadmap.issue` — as present,'
      + ' missing, or unknown for a reading that failed, naming `rafa init --board` as the fix; it writes'
      + ' nothing to the board and a row never changes the exit code. It then names, under `Blocked'
      + ' issues:`, every open issue labelled `spec:blocked` whose `Blocked by:` line is missing, names no'
      + ' issue, names itself, or names an id the board has no issue for, with what an author does about'
      + ' it; that reading writes nothing and never changes the exit code either. It then counts, without'
      + ' fetching, the branches and worktrees `rafa cleanup` would list, and prints them in one row naming'
      + ' `rafa cleanup` when any group holds one. With `--output=json` the'
      + ' checks, both readings, those rows and those issues are the data of the terminal result event,'
      + ' unless a required item failed. A plan `--plan` names also gets the one-line risk total'
      + ' `rafa loop start` prints before its notices, which never changes the exit code. With `--deep` it'
      + ' also prints the machine as a loop session sees it, starting no session: the session\'s'
      + ' Environment and working directory against the shell\'s, the Settings each agent, skill and MCP'
      + ' server is read from and whether a session sees it, the Providers `gh` answers under the session\'s'
      + ' environment, and the Stack tools the project\'s stack needs, with Plan needs for a plan `--plan`'
      + ' names; each row is ok, warn or note with its fix, printed after the blocked issues and before a'
      + ' refusal, and none changes the exit code. With `--output=json` they are the `deep` of the data.',
    args: [],
    flags: [
      {
        name: 'plan',
        description: 'The plan whose `PREREQUISITES-<stub>.md` is merged in and whose risk total is printed,'
          + ' relative to the project root. The default plan `rafa loop start` runs when left out.',
        type: 'string',
      },
      {
        name: 'deep',
        description: 'Also print the Environment, Settings, Providers and Stack tools a loop session sees, and'
          + ' Plan needs for a plan `--plan` names. Starts no session and never changes the exit code.',
        type: 'boolean',
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
      {
        cmd: 'rafa doctor --deep',
        note: 'Also reads the environment, settings, providers and stack tools as a loop session sees them.',
      },
      {
        cmd: 'rafa doctor --deep --plan=.rafa/plans/PLAN-my-feature.md',
        note: 'Also lists what that plan needs that a loop session would not have.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runDoctor(context, seams),
  };
  return Object.freeze(command);
}

export default createDoctorCommand();
