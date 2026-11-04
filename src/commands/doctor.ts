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
 *      project's config over the user scope's, over the defaults. A config
 *      `loadConfig` refuses is refused. Its rows follow the load
 *      (`./doctor-config.ts`): a `warn` per warning and a `note` per
 *      `dangerous.*` key passed.
 *   2. **The plan**: the file `--plan=<file>` names, resolved against the
 *      project root, or the default plan `loop start` falls back to
 *      (`start/plan-path.ts`). A plan named on the line that is no file is
 *      refused. A default plan that is not there leaves no plan, and the
 *      config's items are checked alone. A plan named `PLAN-<stub>.md` has
 *      its `PREREQUISITES-<stub>.md` merged in
 *      (`preflight/prerequisites-md.ts`), and one that cannot be read is
 *      refused, as is one holding a malformed `auto` or `start` item, in
 *      the words `loop start` refuses it with. The default plan is named `PLAN.md`, which carries no stub
 *      and so no PREREQUISITES file: `--plan` is how a plan's items reach
 *      the report.
 *   3. **The pull request provider's automatic items**
 *      (`pr/preflight-items.ts`): `gh` on `PATH` and `gh auth status` for
 *      `origin`'s host, both REQUIRED, when the provider resolves to `gh`
 *      (`packages/rafa/src/pr/provider.ts`). They go AHEAD of the configured
 *      required tier, exactly as `runStartPreflight` puts them
 *      (`start/preflight.ts`), because this command answers what `loop start`
 *      would do and would say the wrong thing if it checked a different set in
 *      a different order. A configured `pr.provider: none` contributes none and
 *      reads no remote at all; every other reading spawns the `origin` probe
 *      once.
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
 * ## The board readings
 *
 * A repository that resolves to `pr.provider: gh` also gets four
 * readings of its GitHub board, through one runner opened once
 * (`./doctor-board.ts`, which holds the runner, the order and what the
 * four share): a row per part `rafa init --board` makes, each open
 * `spec:blocked` issue whose `Blocked by:` line is missing or unreadable
 * (`./doctor-blocked.ts`), each issue carrying two `epic:` labels or
 * an `epic:` label no epic carries (`./doctor-epics.ts`), and each board
 * whose owner does not resolve, unlabelled "Roadmap" beside labelled
 * boards, and position slot on a board or epic that no longer stands
 * (`./doctor-boards.ts`).
 *
 * The provider is resolved ONCE per run, by the same reading that
 * decides the automatic items, so `pr.provider: none` costs no `gh`
 * command and no board line. It is read AFTER the preflight, because the
 * `gh` commands it sends are worth nothing on a repository whose `gh` is
 * missing or logged out, and the preflight is what says so. None of the
 * four writes to the board or changes the exit code, and a halt prints
 * them before its refusal.
 *
 * ## The project rows
 *
 * A repository whose provider is `gh` and whose `board.project.number`
 * is set then gets the three rows of its GitHub project — the `project`
 * scope, the project, its five fields — read through the board's runner
 * without reading an item (`./doctor-project.ts`), printed after the
 * board readings. It never changes the exit code.
 *
 * ## The cleanup row
 *
 * Every repository then gets the counts `rafa cleanup` would list, read
 * without fetching (`./doctor-cleanup.ts`, which holds what is read and
 * where), as one row pointing at that command, printed after the
 * board readings and only when any count is above zero. It never
 * changes the exit code.
 *
 * ## The references row
 *
 * Every repository then gets the suspect, dangling and unknown
 * references of every saved copy under `specs.dir`, read without
 * writing (`./doctor-refs.ts`, which holds why an unreadable board
 * reads `unknown` and how each issue is read once per run), printed
 * after the cleanup row when there is any copy, each copy with a
 * suspect or dangling reference naming `rafa issue check <n>` as the
 * fix. It never changes the exit code.
 *
 * A repository whose release is on then gets the `Release:` row
 * (`./doctor-release.ts`), a warning while fragments wait on the base.
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
 * ## The install readings
 *
 * Each is read before the preflight and written after it, whatever it
 * did, a refusal included, by `./doctor-install.ts`:
 *
 *   - A store problem when the effort store directories cannot be checked
 *     (`readLegacyStore` and `readPreInitDirs`), printed as a warning that
 *     the directories could not be checked, and the error.
 *   - `readLegacyStore` (`effort/store/legacy.ts`): `.ralph/effort/` under
 *     the project root holds a store file and `.rafa/effort/` holds none.
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
 *   - `readPreviousCopies` (`./doctor-previous.ts`): the count of previous
 *     copies of issue specs under `specs.dir/previous/`, a warning when it
 *     exceeds fifty, and the note that they are safe to delete.
 *
 * A reading's warning never changes the exit code.
 *
 * ## The effort store schema row
 *
 * Every run that got past the preflight's refusals reads the
 * `effort store schema` row (`./doctor-effort-schema.ts`, whose note
 * says what it reads): `fail` wherever `rafa effort schema --check`
 * fails, `warn` for an unknown additive migration the store logs and
 * for a development build's `applied_by` in the project's own store,
 * and `ok` otherwise. Its line follows the skill tier rows, a halt's
 * included, and a project with no store yet gets none; its warnings are
 * `warn` lines, like the three below.
 *
 * ## The effort sync row
 *
 * Every such run then reads the `effort sync` row
 * (`./doctor-effort-sync.ts`, over the reading of
 * `packages/rafa-effort/src/effort/sync/doctor-reading.ts`, whose note says which registry each
 * kind is selected through): `ok` naming the strategy `effort.sync` names,
 * `local` when it names none, and `fail` when no adapter serves it,
 * naming for `git`, `service` and `p2p` the `modules:` and `allowList:`
 * lines that load a module providing it. Its line follows the effort
 * store schema row on every run, a halt's included.
 *
 * ## The exit code
 *
 * 0 when no required item failed and neither the effort store schema
 * row nor the effort sync row failed, whatever failed among the
 * optional ones and whatever was warned. 1 when a required item failed or timed out,
 * which is when `loop start` would halt before any session: the refusal
 * opens with the runner's halt, which names each such item, its probe,
 * and its exit code with the first line of stderr. 1 when the effort
 * store schema row fails, the refusal naming the store, why this rafa
 * refuses it and its next safe step, after a halt's text when both
 * happen. 1 when the effort sync row fails, its refusal naming the
 * strategy and why no adapter serves it, after the halt's and the
 * schema row's text when those happen. 1 as well, each
 * ending `Nothing was checked.`, for a positional word, a `--plan` with
 * no file, a `--deep` holding a value, a plan named that is no file, a plan path that cannot be
 * checked, such as one under a file (`stat` answers `ENOTDIR`, measured
 * on bun 1.3.14), a config `loadConfig` refuses, and a PREREQUISITES
 * file that cannot be read.
 *
 * ## What it prints
 *
 * In text mode, `rafa <version>` (`packages/rafa/src/core/command/version.ts`) first,
 * printed before anything is checked so a person reads which build
 * answered whatever the preflight then does; then the config rows, when
 * the load warned or passed a `dangerous.*` key; then {@link renderDoctor}'s
 * lines (`./doctor-render.ts`): a head naming the plan, or where none was
 * found, and the PREREQUISITES file merged in; one line per check; the
 * line naming the start-only items a resume passed over; the steps that
 * file names and nothing checks; and the verdict with any
 * `known-missing:` lines; then the risk total of a plan `--plan` names;
 * then `renderDoctorBoard`'s lines (`./doctor-board.ts`) for a repository that has a GitHub board —
 * its rows, then any blocked issues, then any epic labels — and none for
 * one that has not; then the project rows, when `board.project.number` is set; then the cleanup row, when there is anything to
 * clean; then the references row, when there is a saved copy; then the release row, when the release is on; then the
 * stretch row (`./doctor-stretch.ts`), when `pr.base` names a `stretch/*` branch; then the `Skill tiers` rows
 * (`./doctor-tiers.ts`), when there is any; then the effort store schema row, when there is a store; then the
 * effort sync row; then, under `--deep`,
 * `renderDeep`'s sections. A halt
 * has no verdict line: it is the refusal, on stderr. json mode prints no
 * version line, where `rafa describe` gives the same version as data, and
 * the terminal result's `data` is a `DoctorResult` (`./doctor-readings.ts`), every path
 * absolute, for a preflight that did not halt and an effort store schema
 * row and an effort sync row that did not fail. A halt gives no `data`,
 * nor does a failing row: the terminal event is the `command_exit`
 * error, whose message is the halt naming every failed required item,
 * then each failing row's refusal, the schema row's with its next safe
 * step. In either mode each warning is
 * a `warn` line, a `log` event in json mode, and so is the risk total, at
 * `info`.
 *
 * ## Seams
 *
 * The project, its home and the environment are the dispatcher's
 * (`cli/dispatch.ts`), so a case names them through its options. How a
 * probe and a service request run, the timeout, the clock, the
 * `origin` probe the provider is read through, the runner the board
 * readings are read with (`DoctorBoardSeams`), and the git and `gh` the risk
 * total reads the accounts through are {@link DoctorSeams},
 * each left out being the runner's own, and so are the `--deep` reading's
 * (`DeepDoctorSeams`).
 */
import type { DoctorBoardSeams } from './doctor-board.js';
import type { DoctorCleanupSeams } from './doctor-cleanup.js';
import type { DeepDoctorSeams, DeepReading } from './doctor-deep.js';
import type { InstallReadings } from './doctor-install.js';
import type { BoardReadings, DoctorPreflight, DoctorResult, DoctorStartTier } from './doctor-readings.js';
import type { DoctorReleaseSeams } from './doctor-release.js';
import type { DoctorTiersRunSeams } from './doctor-tiers.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { PrerequisiteItem, RafaConfig, ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { PrProvider } from '@open-tomato/rafa/core/config/sections';
import type { PreflightItems } from '@open-tomato/rafa/preflight/prerequisites-md';
import type { PreflightOptions, PreflightTiers } from '@open-tomato/rafa/preflight/run';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';
import type { DoctorRefsSeams } from '@open-tomato/rafa-board';
import type { DoctorEffortSyncSeams } from '@open-tomato/rafa-effort';
import type { AccountSeams, ResolvePrProviderOptions } from '@open-tomato/rafa-pr';

import { basename, resolve } from 'node:path';

import {
  commandRetrySeams,
  readDoctorRefs,
  registryRoster,
  renderDoctorRefs,
} from '@open-tomato/rafa-board';
import { readDoctorEffortSync } from '@open-tomato/rafa-effort';
import { ghPreflightItems, resolvePrProvider } from '@open-tomato/rafa-pr';
import { DEFAULT_PLAN_FILE, announceRiskTotal, isFirstDispatch, resolvePlanPath } from '@open-tomato/rafa-run';

import { CommandExit , versionLine } from '@open-tomato/rafa/core/command';
import { ConfigError } from '@open-tomato/rafa/core/config';
import { loadConfig } from '@open-tomato/rafa/core/config/load';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { isFile , trackerPathFor } from '@open-tomato/rafa/core/plan';
import {
  loadPlanPrerequisites,
  malformedPrerequisiteLines,
  mergePlanPrerequisites,
  prerequisitesPathForPlan,
} from '@open-tomato/rafa/preflight/prerequisites-md';
import { runPreflight } from '@open-tomato/rafa/preflight/run';

import { boardRunner, readDoctorBoard, relationsResultOf, renderDoctorBoard } from './doctor-board.js';
import { readDoctorCleanup, renderDoctorCleanup } from './doctor-cleanup.js';
import { loadDoctorConfig } from './doctor-config.js';
import { readDeep, renderDeep } from './doctor-deep.js';
import { DOCTOR_DESCRIPTION } from './doctor-description.js';
import { effortSchemaRefusal, readDoctorEffortSchema, writeDoctorEffortSchema } from './doctor-effort-schema.js';
import { effortSyncRefusal, renderDoctorEffortSync } from './doctor-effort-sync.js';
import { readInstall, writeInstall } from './doctor-install.js';
import { readDoctorProject, renderDoctorProject } from './doctor-project.js';
import { readDoctorRelease, writeDoctorRelease } from './doctor-release.js';
import { renderDoctor } from './doctor-render.js';
import { writeDoctorStretch } from './doctor-stretch.js';
import { checkDoctorTiers, renderDoctorTiers } from './doctor-tiers.js';

/**
 * How the checks run; see the module note. Each left out is the
 * runner's own. The `--deep` reading's own seams — the directory a
 * session runs in, the runner its provider probes go through, and how
 * its inventory is built — are {@link DeepDoctorSeams} (`./doctor-deep.ts`).
 */
export interface DoctorSeams extends DeepDoctorSeams, DoctorBoardSeams, DoctorCleanupSeams, DoctorEffortSyncSeams,
  DoctorRefsSeams, DoctorReleaseSeams, DoctorTiersRunSeams {
  readonly checks: Pick<PreflightOptions, 'runProbe' | 'request' | 'timeoutMs' | 'now'>;
  /** The `origin` probe the provider is read through. `gitRemoteUrl` when left out. */
  readonly readRemote?: ResolvePrProviderOptions['readRemote'];
  /** git and `gh` for the plan's risk total, at a root. Both spawned there when left out. */
  readonly riskRunners?: (root: string) => AccountSeams;
}

/** The seams the registered command runs with: the runner's own, every one. */
export const DEFAULT_DOCTOR_SEAMS: DoctorSeams = Object.freeze({ checks: Object.freeze({}) });

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
async function resolvedConfig(project: ProjectFound, warn: (message: string) => void): Promise<ResolvedConfig> {
  try {
    return await loadConfig({ root: project.root, home: project.home }, {}, warn);
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

/**
 * Refuses a plan whose PREREQUISITES file holds a malformed `auto` or
 * `start` item, in the words `loop start` refuses it with; see the
 * module note.
 */
function refuseMalformedItems(plan: string | null, items: PreflightItems): void {
  if (plan === null || items.malformed.length === 0) return;
  const file = basename(prerequisitesPathForPlan(plan) ?? plan);
  const [head = '', ...rest] = malformedPrerequisiteLines(file, items.malformed);
  throw refusal([
    `rafa doctor: ${head}`,
    ...rest,
    'rafa loop start would refuse here, before any probe. No run was started and nothing was stored.',
  ]);
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
  const resolved = await loadDoctorConfig(context, async (sink) => resolvedConfig(project, sink));
  const { config } = resolved;
  const { plan, lookedFor } = choosePlan(project.root, config, named);
  const items = await loadItems(plan, config);
  refuseMalformedItems(plan, items);
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
 * The refusal for a halt, a failing `effort store schema` or
 * `effort sync` row, or any of them together: the runner's own text and
 * what `loop start` would do, then each failing row's refusal in that
 * order; null for none.
 */
function doctorRefusal(halt: string | null, rows: readonly (string | null)[]): CommandExit | null {
  const failed = rows.filter((row): row is string => row !== null);
  const halted = [
    `rafa doctor: ${String(halt)}`,
    'rafa loop start would halt here, before any session. No run was started and nothing was stored.',
  ];
  const lines = halt === null
    ? []
    : halted;
  const all = [...lines, ...failed];
  return all.length === 0
    ? null
    : new CommandExit(1, all.join('\n'));
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

/** The data json mode gives for a run `doctor` exits 0 from. */
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
    epics: readings.epics,
    boards: readings.boards,
    ...relationsResultOf(readings),
    project: readings.project,
    cleanup: readings.cleanup,
    refs: readings.refs,
    release: readings.release,
    tiers: readings.tiers,
    effortSchema: readings.effortSchema,
    effortSync: readings.effortSync,
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
  const install = await readInstall(context, project);
  try {
    const preflight = await checkPreflight(context, project, seams);
    const gh = boardRunner(preflight.provider, preflight.root, seams);
    const cleanup = await readDoctorCleanup({ root: project.root, home: project.home, config: preflight.config, gh }, seams);
    const roster = registryRoster(context.registry);
    const refs = await readDoctorRefs({ root: project.root, specsDir: preflight.config.specsDir, gh, roster, env: context.env }, seams);
    const release = readDoctorRelease({ root: project.root, config: preflight.config }, seams);
    const tiers = await checkDoctorTiers({ project, env: context.env, resolved: preflight.resolved, plan: null }, seams);
    const effortSchema = readDoctorEffortSchema(project.root, context.env);
    const effortSync = await readDoctorEffortSync({ root: project.root, home: project.home, resolved: preflight.resolved }, seams);
    const modeSet = preflight.resolved.sources.boardRelationships !== 'default';
    const board = await readDoctorBoard(gh, project.root, preflight.config.roadmapIssue, preflight.config.boardRelationships, modeSet);
    const { boardProjectNumber: number, boardProjectTemplate: template } = preflight.config;
    const projectRows = await readDoctorProject({ gh, number, template, config: preflight.config, retry: commandRetrySeams(context.output, context.outputMode) });
    const readings: BoardReadings = { ...board, project: projectRows, cleanup, refs, release, tiers, effortSchema, effortSync };
    writeText(context, renderDoctor(preflight));
    await announceRisk(context, preflight, seams);
    const repository = [...renderDoctorBoard(readings), ...renderDoctorProject(projectRows), ...renderDoctorCleanup(readings.cleanup)];
    writeText(context, [...repository, ...renderDoctorRefs(readings.refs)]);
    writeDoctorRelease(context, release);
    writeDoctorStretch(context, project.root, preflight.config.prBase);
    writeText(context, renderDoctorTiers(readings.tiers));
    writeDoctorEffortSchema(context, effortSchema);
    writeText(context, renderDoctorEffortSync(effortSync));
    const deep = await checkDeep(context, preflight, seams);
    writeText(context, deep === null
      ? []
      : renderDeep(deep));
    const refusal = doctorRefusal(preflight.report.halt, [effortSchemaRefusal(effortSchema), effortSyncRefusal(effortSync)]);
    if (refusal !== null) throw refusal;
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
    description: DOCTOR_DESCRIPTION,
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

const command: RafaCommand = createDoctorCommand();
export default command;
