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
 *   3. **Every item**, through `runPreflight` (`preflight/run.ts`), as
 *      `loop start` checks them: each probe in the project root with stdin
 *      closed and the 30-second timeout, a presence check for an item with
 *      no probe, and a warning for each optional item that failed, written
 *      as it is found. The environment is the one this invocation was
 *      handed, `process.env` for the registered command.
 *
 * ## What it does not do
 *
 * It starts no run. No run id is generated, no row goes to the store's
 * `preflight` table, and no tracker, branch or session is touched. So
 * `rafa effort report` lists the halts of `loop start` runs alone.
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
 * In text mode, {@link renderDoctor}'s lines: a head naming the plan, or
 * where none was found, and the PREREQUISITES file merged in; one line per
 * check; the steps that file names and nothing checks; and the verdict with
 * any `known-missing:` lines. A halt has no verdict line: it is the
 * refusal, on stderr. In json mode the terminal result's `data` is a
 * {@link DoctorResult}, every path absolute, for a preflight that did not
 * halt. A halt gives no `data`: the terminal event is the `command_exit`
 * error, whose message is the halt naming every failed required item. In
 * either mode each warning is a `warn` line, a `log` event in json mode.
 *
 * ## Seams
 *
 * The project, its home and the environment are the dispatcher's
 * (`cli/dispatch.ts`), so a case names them through its options. How a
 * probe and a service request run, the timeout and the clock are
 * {@link DoctorSeams}, each left out being the runner's own.
 */
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { RafaConfig } from '../config.js';
import type { LegacyStoreReading } from '../effort/store/legacy.js';
import type { PreflightItems, PrerequisiteReminder } from '../preflight/prerequisites-md.js';
import type { PreflightCheck, PreflightOptions, PreflightReport } from '../preflight/run.js';
import type { BinPathReading } from '../project/bin-path.js';
import type { ProjectFound } from '../project/scope.js';

import { basename, relative, resolve, sep } from 'node:path';

import { CommandExit } from '../cli/command.js';
import { loadConfig } from '../config-load.js';
import { messageOf } from '../config-sections.js';
import { ConfigError } from '../config.js';
import { readLegacyStore } from '../effort/store/legacy.js';
import { loadPlanPrerequisites, mergePlanPrerequisites, prerequisitesPathForPlan } from '../preflight/prerequisites-md.js';
import { PROBE_TIMEOUT_MS, runPreflight } from '../preflight/run.js';
import { readBinPath } from '../project/bin-path.js';
import { DEFAULT_PLAN_FILE, resolvePlanPath } from '../start/plan-path.js';

import { isFile, plural } from './plan/plan-files.js';

/** How the checks run; see the module note. Each left out is the runner's own. */
export interface DoctorSeams {
  readonly checks: Pick<PreflightOptions, 'runProbe' | 'request' | 'timeoutMs' | 'now'>;
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
  /** The `known-missing:` line of each failed optional item, as every task prompt would carry it. */
  readonly knownMissing: readonly string[];
  /** The steps the PREREQUISITES file names and nothing checks. */
  readonly reminders: readonly PrerequisiteReminder[];
  /** Where `~/.rafa/bin` sits on the `PATH` handed in. */
  readonly binPath: BinPathReading;
  /** Which store files each effort directory holds; null when they could not be checked. */
  readonly legacyStore: LegacyStoreReading | null;
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
  const report = await runPreflight(items, { ...seams.checks, cwd: project.root, env: context.env, warn });
  return Object.freeze({
    root: project.root,
    plan,
    lookedFor,
    prerequisitesFile: mergedFile(plan),
    report,
    reminders: items.reminders,
  });
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

/** The head line: the plan or where none was found, the file merged in, and how many items were checked. */
function headLine(preflight: DoctorPreflight): string {
  const { root, plan, prerequisitesFile } = preflight;
  const count = preflight.report.checks.length;
  if (plan === null) {
    const where = preflight.lookedFor.map((path) => shownPath(path, root)).join(' or ');
    const checked = count === 0
      ? 'nothing to check'
      : `${plural(count, 'item')} from the config checked`;
    return `Preflight with no plan, none being at ${where}: ${checked}, no run started.`;
  }
  const merged = prerequisitesFile === null
    ? ''
    : `, with ${basename(prerequisitesFile)} merged in`;
  const checked = count === 0
    ? 'nothing to check'
    : `${plural(count, 'item')} checked`;
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

/** The refusal for a halt: the runner's own text, then what `loop start` would do. */
function haltRefusal(halt: string): CommandExit {
  return new CommandExit(1, [
    `rafa doctor: ${halt}`,
    'rafa loop start would halt here, before any session. No run was started and nothing was stored.',
  ].join('\n'));
}

/** The data json mode gives for a preflight that did not halt. */
function resultOf(preflight: DoctorPreflight, install: InstallReadings): DoctorResult {
  return {
    root: preflight.root,
    plan: preflight.plan,
    prerequisitesFile: preflight.prerequisitesFile,
    checks: preflight.report.checks,
    knownMissing: preflight.report.knownMissing,
    reminders: preflight.reminders,
    binPath: install.binPath,
    legacyStore: install.legacyStore,
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
  const install = readInstall(context, project);
  try {
    const preflight = await checkPreflight(context, project, seams);
    if (context.outputMode !== 'json') for (const line of renderDoctor(preflight)) context.output.info(line);
    if (preflight.report.halt !== null) throw haltRefusal(preflight.report.halt);
    if (context.outputMode === 'json') context.output.result(resultOf(preflight, install));
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
      + ' `.rafa/config.yaml`, with the `PREREQUISITES-<stub>.md` beside the plan merged in. The plan is the'
      + ' one `--plan=<file>` names, relative to the project root, or the default plan `rafa loop start`'
      + ` runs. Each probe runs in the project root with stdin closed and a ${String(PROBE_TIMEOUT_MS / 1000)}-second`
      + ' timeout. It exits 1 when a required item fails, naming the item, its probe and its exit code or'
      + ' first line of stderr, where `rafa loop start` would halt, and 0 otherwise. It warns when'
      + ' `.ralph/effort/` holds an effort store and `.rafa/effort/` holds none, and when `~/.rafa/bin` is'
      + ' not on PATH ahead of `~/.bun/bin`; a warning never changes the exit code. With `--output=json` the'
      + ' checks and both readings are the data of the terminal result event, unless a required item failed.',
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
