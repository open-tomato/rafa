/**
 * The risk reading of a plan: what a run of it may do on this machine
 * and under the person's accounts, read in code and with no model.
 * `rafa plan risk` prints it, and `loop start` and `rafa doctor
 * --plan=` print its one-line total.
 *
 * It is a reading of what the plan, its agents and its skills SAY, not
 * a sandbox, and {@link RISK_FOOTER} says so under every text report.
 *
 * ## What is read
 *
 * The plan goes through `parsePlan`. Its OPEN tasks are read, and no
 * other: every line a run would still dispatch, `- [ ] ` and
 * `- [BLOCKED] ` alike, the tasks a never-closed `rafa:*` block hides
 * included. A blocked line counts because `findNextTask`
 * (`src/utils/tracker.ts`) resumes it AHEAD of every unchecked one; a
 * ticked line has run. Each open task's declaration is the one
 * `parseTaskDeclaration` answered for the line, which `parsePlan` keeps
 * on `PlanTask.declaration`. For each open task:
 *
 * - **What it may use** ({@link taskAccess}). With `agent=` named, the
 *   definition `findAgentDefinition` finds under `loop.settingSources`
 *   decides, because an agent outranks the task's `tools=` and
 *   `model=` (`resolveDeclarationFlags`): its `tools:` line, or every
 *   tool when it has none or no definition answers. With no agent, the
 *   task's `tools=`, else every tool. Every tool is a `high`; a set
 *   holding `Bash` with no `budget=` is a `note`; a narrower set, or
 *   `Bash` under a budget, carries no finding.
 * - **Its task line's code spans**, each read as a command.
 * - **The shell fences of its agent file and of each skill it
 *   declares.** A skill is the first `<name>/SKILL.md` across the
 *   project, rafa and user tiers (`resolveSkillTiers`), in that order.
 *   A skill found in no tier contributes nothing. Each file is read
 *   once however many tasks name it, and the finding carries the file
 *   and its line rather than a task.
 *
 * The plan's own shell fences are read too, once. Its `rafa:*` blocks
 * are prose and fences of their own info string, so neither they nor a
 * code span in them is read as a command. How a command line is found
 * and what it is read for is `risk/commands.ts`'s.
 *
 * Then the four account findings (`risk/accounts.ts`) and one finding
 * per credential-bearing variable NAME (`risk/secrets.ts`): a value is
 * never read, so none can reach a finding or a report.
 *
 * ## Seams
 *
 * The plan arrives as text. Files are read only under the roots
 * {@link RiskSeams} names (the repository, the home and, for the rafa
 * skill tier, the entry); git and `gh` are reached only through its
 * runners; the environment is the object it is handed. A test plants
 * every one of them.
 */
import type { PlanTask } from './parse.js';
import type { ClaudeSettingSource } from '../config.js';
import type { AccountSeams, AccountSettings } from './risk/accounts.js';
import type { CommandFinding, PathSeams, RiskLevel } from './risk/commands.js';
import type { TaskDeclaration } from '../utils/declaration.js';

import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { resolveSkillTiers } from '../schema/tiers.js';
import { findAgentDefinition } from '../utils/agent-definition.js';

import { parsePlan } from './parse.js';
import { readAccounts } from './risk/accounts.js';
import { readBodyCommands, readTaskLineCommands } from './risk/commands.js';
import { scanSecretNames } from './risk/secrets.js';

export type { RiskLevel } from './risk/commands.js';

/** The five kinds of finding, in the order a report reads them. */
export const RISK_KINDS = ['tools', 'destructive', 'outside-path', 'account', 'secret'] as const;

/** One of {@link RISK_KINDS}. */
export type RiskKind = (typeof RISK_KINDS)[number];

/** The line under every text report: what this reading is not. */
export const RISK_FOOTER =
  'This reads what the plan, its agents and its skills SAY, not what a session will decide to do: it is not a sandbox.';

/** The phrase a task that may use anything is reported with. */
export const EVERY_TOOL = 'every tool';

/** The tool whose presence without a budget is a `note`. */
const SHELL_TOOL = 'Bash';

/** How many characters of a task's sentence a text report prints. */
const TASK_EXCERPT = 72;

/** One finding, in the shape `--output=json` emits. */
export interface RiskFinding {
  /** `high` is what `--strict` refuses on. */
  readonly level: RiskLevel;
  /** Which of the five readings found it. */
  readonly kind: RiskKind;
  /** The line a report prints. */
  readonly text: string;
  /** The task's sentence, declaration taken off, for a finding about one task. */
  readonly task?: string;
  /** The file it was found in: repository-relative, `~/` under the home, else absolute. */
  readonly file?: string;
  /** Its 1-based line in {@link RiskFinding.file}. */
  readonly line?: number;
}

/** How many findings each level holds. */
export interface RiskTotal {
  readonly high: number;
  readonly note: number;
}

/** The whole reading, in the shape `--output=json` emits. */
export interface RiskReport {
  /** The plan, displayed as {@link RiskFinding.file} is. */
  readonly plan: string;
  readonly total: RiskTotal;
  /** Tools, destructive, outside-path, account, secret, each in reading order. */
  readonly findings: readonly RiskFinding[];
}

/** The plan to read. */
export interface RiskPlan {
  /** Its path, absolute or relative to the repository root. */
  readonly path: string;
  /** Its text; this module does not read the plan file. */
  readonly text: string;
}

/** Everything the reading reaches beyond the plan's text. */
export interface RiskSeams {
  /** The repository's root, absolute: agent and project skill files resolve under it. */
  readonly repoRoot: string;
  /** The home directory, absolute: `~`, user agents and user skills resolve under it. */
  readonly home: string;
  /** `loop.settingSources`: user agents are read only when it holds `user`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The environment a run would inherit; only its keys are read. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** What the configuration says about accounts. */
  readonly accounts: AccountSettings;
  /** The git and `gh` runners the accounts reading goes through. */
  readonly runners: AccountSeams;
  /** The entry the rafa skill tier sits beside; `Bun.main` when left out. */
  readonly entry?: string;
}

/** What one task may use, as {@link taskAccess} reads it. */
export interface TaskAccess {
  /** The tools it may use, or null for every tool. */
  readonly tools: readonly string[] | null;
  /** Why it may use what it may, e.g. `agent=x has no tools: line`. */
  readonly source: string;
  /** The model it runs on, or null for the session's default. */
  readonly model: string | null;
  /** Its `budget=` in US dollars, or null for none. */
  readonly budget: number | null;
}

/**
 * The tools an agent definition's `tools:` line names: a comma list
 * (`Read, Bash`) or a YAML list (`["Read", "Bash"]`). Null when the
 * line is absent or names no tool, which leaves the agent every tool.
 */
export function agentTools(frontmatter: Readonly<Record<string, unknown>>): readonly string[] | null {
  const value = frontmatter['tools'];
  let names: readonly string[] = [];
  if (typeof value === 'string') names = value.split(',');
  else if (Array.isArray(value)) names = value.filter((entry): entry is string => typeof entry === 'string');
  const tools = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ''))];
  return tools.length === 0
    ? null
    : tools;
}

/** Whether `tools` holds the shell tool, bare or with a rule (`Bash(git *)`). */
function holdsShell(tools: readonly string[]): boolean {
  return tools.some((tool) => tool === SHELL_TOOL || tool.startsWith(`${SHELL_TOOL}(`));
}

/** A string frontmatter field, or null. */
function frontmatterString(frontmatter: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = frontmatter[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : null;
}

/**
 * What a task declaring `declaration` may use. See the module note for
 * the order the tool set is decided in.
 *
 * @param declaration - The task's declaration, or null for none.
 * @param seams - The roots and setting sources an agent resolves under.
 */
export function taskAccess(
  declaration: TaskDeclaration | null,
  seams: Pick<RiskSeams, 'repoRoot' | 'home' | 'settingSources'>,
): TaskAccess {
  const budget = declaration?.budget ?? null;
  const agent = declaration?.agent ?? null;
  if (agent === null) {
    const tools = declaration?.tools ?? null;
    return {
      tools,
      source: tools === null
        ? 'no agent= and no tools='
        : 'tools=',
      model: declaration?.model ?? null,
      budget,
    };
  }

  const definition = findAgentDefinition(agent, { repoRoot: seams.repoRoot, home: seams.home }, seams.settingSources);
  if (definition === null) {
    return { tools: null, source: `agent=${agent} resolves to no definition`, model: null, budget };
  }
  const tools = agentTools(definition.frontmatter);
  return {
    tools,
    source: tools === null
      ? `agent=${agent} has no tools: line`
      : `agent=${agent}`,
    model: frontmatterString(definition.frontmatter, 'model'),
    budget,
  };
}

/** The `tools` finding one open task carries, or null when it carries none. */
function toolsFinding(task: PlanTask, plan: string, seams: RiskSeams): RiskFinding | null {
  const access = taskAccess(task.declaration, seams);
  const model = `model ${access.model ?? 'the session default'}`;
  const budget = access.budget === null
    ? 'no budget='
    : `budget $${String(access.budget)}`;
  const where = { task: task.text, file: plan, line: task.lineNum + 1 };

  if (access.tools === null) {
    return { level: 'high', kind: 'tools', text: `${EVERY_TOOL} — ${access.source}; ${model}; ${budget}`, ...where };
  }
  if (holdsShell(access.tools) && access.budget === null) {
    const listed = access.tools.join(', ');
    return { level: 'note', kind: 'tools', text: `${SHELL_TOOL} with no budget= — ${access.source}: ${listed}; ${model}`, ...where };
  }
  return null;
}

/**
 * `path` as a report shows it: relative to the repository when inside
 * it, `~/`-prefixed under the home, else as given.
 */
export function displayPath(path: string, seams: Pick<RiskSeams, 'repoRoot' | 'home'>): string {
  const absolute = isAbsolute(path)
    ? path
    : join(seams.repoRoot, path);
  const within = (root: string): string | null => {
    const step = relative(root, absolute);
    return step === '' || step.startsWith('..') || isAbsolute(step)
      ? null
      : step;
  };
  const inRepo = within(seams.repoRoot);
  if (inRepo !== null) return inRepo;
  const inHome = within(seams.home);
  return inHome === null
    ? absolute
    : `~/${inHome}`;
}

/** A command finding, located in `file`. */
function located(finding: CommandFinding, file: string, task?: string): RiskFinding {
  const base = { level: finding.level, kind: finding.kind, text: finding.text };
  return task === undefined
    ? { ...base, file, line: finding.line }
    : { ...base, task, file, line: finding.line };
}

/** A file's text, or null when nothing readable sits at `path`. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The first `<name>/SKILL.md` across the skill tiers, or null. */
function findSkillFile(name: string, seams: RiskSeams): string | null {
  const tiers = resolveSkillTiers({ home: seams.home, projectRoot: seams.repoRoot, entry: seams.entry });
  for (const { dir } of tiers) {
    const path = join(dir, name, 'SKILL.md');
    if (readText(path) !== null) return path;
  }
  return null;
}

/** The files one task pulls in: its agent's definition and its skills'. */
function taskFiles(declaration: TaskDeclaration | null, seams: RiskSeams): readonly string[] {
  if (declaration === null) return [];
  const agent = declaration.agent === null
    ? null
    : findAgentDefinition(declaration.agent, { repoRoot: seams.repoRoot, home: seams.home }, seams.settingSources);
  const skills = (declaration.skills ?? []).map((name) => findSkillFile(name, seams));
  return [agent?.path ?? null, ...skills].filter((path): path is string => path !== null);
}

/** Every command finding: the plan's fences, then per task its line and its files. */
function commandFindings(
  plan: RiskPlan,
  display: string,
  tasks: readonly PlanTask[],
  seams: RiskSeams,
): readonly RiskFinding[] {
  const paths: PathSeams = { repoRoot: seams.repoRoot, home: seams.home };
  const found = readBodyCommands(plan.text, paths).map((finding) => located(finding, display));
  const read = new Set<string>();
  const lines = plan.text.split('\n');

  for (const task of tasks) {
    const spans = readTaskLineCommands(lines[task.lineNum] ?? '', task.lineNum + 1, paths);
    found.push(...spans.map((finding) => located(finding, display, task.text)));
    for (const file of taskFiles(task.declaration, seams)) {
      if (read.has(file)) continue;
      read.add(file);
      const shown = displayPath(file, seams);
      found.push(...readBodyCommands(readText(file) ?? '', paths).map((finding) => located(finding, shown)));
    }
  }
  return found;
}

/** The tasks a run would still dispatch, unchecked and blocked, in source order. */
export function openTasks(tasks: readonly PlanTask[], hidden: readonly PlanTask[]): readonly PlanTask[] {
  return [...tasks, ...hidden]
    .filter((task) => task.status !== 'done')
    .sort((a, b) => a.lineNum - b.lineNum);
}

/** How many findings each level holds. */
export function riskTotal(findings: readonly RiskFinding[]): RiskTotal {
  return {
    high: findings.filter((finding) => finding.level === 'high').length,
    note: findings.filter((finding) => finding.level === 'note').length,
  };
}

/**
 * Reads what a run of `plan` may do. Never throws on what the plan,
 * the files it names or git and `gh` answer: a missing agent, skill or
 * remote is an answer in a finding or no finding.
 *
 * @param plan - The plan's path and text.
 * @param seams - Everything reached beyond the text; see the module note.
 * @returns The report, findings in {@link RISK_KINDS} order.
 */
export async function assessPlanRisk(plan: RiskPlan, seams: RiskSeams): Promise<RiskReport> {
  const model = parsePlan(plan.text);
  const display = displayPath(plan.path, seams);
  const tasks = openTasks(model.tasks, model.hiddenTasks);

  const tools = tasks.flatMap((task) => toolsFinding(task, display, seams) ?? []);
  const commands = commandFindings(plan, display, tasks, seams);
  const accounts = (await readAccounts(seams.accounts, seams.runners))
    .map(({ level, kind, text }): RiskFinding => ({ level, kind, text }));
  const secrets = scanSecretNames(seams.environment)
    .map(({ level, kind, text }): RiskFinding => ({ level, kind, text }));

  const findings = [...tools, ...commands, ...accounts, ...secrets];
  return { plan: display, total: riskTotal(findings), findings };
}

/** `count` with `word`, pluralised with an `s` when it is not one. */
function counted(count: number, word: string): string {
  return count === 1
    ? `${String(count)} ${word}`
    : `${String(count)} ${word}s`;
}

/**
 * The one-line total `loop start` and `rafa doctor --plan=` print, e.g.
 * `🛡  Risk: 2 high, 6 notes — rafa plan risk .rafa/plans/PLAN-x.md`.
 */
export function riskTotalLine(report: Pick<RiskReport, 'plan' | 'total'>): string {
  return `🛡  Risk: ${String(report.total.high)} high, ${counted(report.total.note, 'note')} — rafa plan risk ${report.plan}`;
}

/** The widest kind, which the kind column is padded to. */
const KIND_WIDTH = Math.max(...RISK_KINDS.map((kind) => kind.length));

/** A task's sentence cut to {@link TASK_EXCERPT} characters. */
function excerpt(task: string): string {
  return task.length > TASK_EXCERPT
    ? `${task.slice(0, TASK_EXCERPT - 1)}…`
    : task;
}

/** The lines one finding renders as: its text, then where it is. */
function findingLines(finding: RiskFinding): readonly string[] {
  const head = `  ${finding.kind.padEnd(KIND_WIDTH)}  ${finding.text}`;
  const place = finding.file === undefined
    ? null
    : `${finding.file}${finding.line === undefined
      ? ''
      : `:${String(finding.line)}`}`;
  const task = finding.task === undefined
    ? null
    : excerpt(finding.task);
  const where = [place, task].filter((part): part is string => part !== null).join(' — ');
  return where === ''
    ? [head]
    : [head, `  ${' '.repeat(KIND_WIDTH)}  ${where}`];
}

/** One level's group: its heading and its findings, or `none`. */
function groupLines(level: RiskLevel, findings: readonly RiskFinding[]): readonly string[] {
  const own = findings.filter((finding) => finding.level === level);
  const body = own.length === 0
    ? ['  none']
    : own.flatMap(findingLines);
  return [`${level} (${String(own.length)})`, ...body];
}

/**
 * The text report: `high` findings, then `note` ones, each with its
 * file, line and task where it has them, then the total line and
 * {@link RISK_FOOTER}.
 */
export function renderRiskText(report: RiskReport): string {
  return [
    `Risk reading of ${report.plan}`,
    '',
    ...groupLines('high', report.findings),
    '',
    ...groupLines('note', report.findings),
    '',
    riskTotalLine(report),
    RISK_FOOTER,
  ].join('\n');
}
