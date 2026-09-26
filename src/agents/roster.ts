/**
 * The agents a session will see, and the `agent=` names a plan asks for
 * that none of them answers.
 *
 * A task routed `agent=tdd-guide` is dispatched with `--agent
 * tdd-guide`, and a name the CLI cannot resolve STOPS that dispatch:
 * it exits 1 with no JSON at all, before any model call, and prints the
 * roster it could have run on stderr (`context/workflow.md`). That is
 * what this module is for. It answers, without spawning anything, which
 * names a run under its tier settings resolves, so a plan naming an
 * agent no loaded tier serves is refused by the preflight rather than
 * one task into the run.
 *
 * `utils/agent-definition.ts` reads ONE definition, by the name a
 * declaration asked for, for the one question the dispatcher has of it
 * — does it declare an effort. This module reads WHOLE directories,
 * because the question here is the roster rather than one file, and a
 * definition answers under the name its frontmatter carries whatever
 * its file is called. Both ask `schema/frontmatter.ts` for the block
 * itself, so a file either module passes over is one the other passes
 * over too.
 *
 * ## What a session sees, measured
 *
 * Every reading below is Claude Code 2.1.268, taken by asking for an
 * agent no scope defines (`claude -p --agent no-such-agent-zzz`), which
 * exits 1 and lists the agents it could have run. The probes ran in a
 * scratch directory under `/tmp` holding nothing but the
 * `.claude/agents` files each reading names.
 *
 *   - **The built-ins are {@link BUILT_IN_AGENTS}.** In a scratch
 *     directory with no `.claude/agents` at all, under
 *     `--setting-sources project,local`, the list was exactly `claude,
 *     Explore, general-purpose, Plan, statusline-setup`. The reading
 *     could have come out otherwise: the same probe from the same
 *     directory under `user,project,local` listed 65 names, this
 *     machine's `~/.claude/agents` included, so the five are what is
 *     left when no scope holding definitions is loaded.
 *   - **Project definitions need `project` in the sources.** With
 *     `.claude/agents/probe-only-agent.md` planted in the scratch
 *     directory, `project,local` listed `probe-only-agent` and `local`
 *     alone did not.
 *   - **Home definitions need `user`.** From the same directory,
 *     `--setting-sources user` listed 65 names — the 60 definitions of
 *     this machine's `~/.claude/agents` plus the five built-ins — and
 *     not `probe-only-agent`.
 *   - **A definition is keyed by its frontmatter `name`.** A scratch
 *     `weird-file.md` carrying `name: renamed-agent` listed as
 *     `renamed-agent`, and never as `weird-file`. The converse is in
 *     `utils/agent-definition.ts`: a `file-name.md` carrying `name:
 *     other-name` exited 1 on `--agent file-name`.
 *   - **A name appears once.** A scratch project definition carrying
 *     `name: Explore`, a built-in name, left the list one `Explore`
 *     long rather than two. The reading is a control on itself: the
 *     `probe-only-agent.md` beside it did show up in the same list, so
 *     the directory was read.
 *   - **Names are matched case-sensitively.** `--agent explore` was
 *     refused by a CLI whose own list, printed in the same line, held
 *     `Explore`.
 *
 * So the CLI's own order is the project's definitions under `project`,
 * then the home's under `user`, then the built-ins, each name taken once.
 * The roster no longer takes that order from the CLI: rafa decides which
 * holder of a name a session is served (below), and the CLI's order only
 * ever sees the winner.
 *
 * ## Resolved through the three tiers
 *
 * {@link resolveAgentRoster} reads the skills and the agents tree of
 * each tier (`readTrees` in `inventory/trees.ts`: the project's
 * `.claude/{skills,agents}`, rafa's `bundled/{skills,agents}` beside the
 * entry, the home's `.claude/{skills,agents}`) and hands the rows to
 * `resolveTiers` (`tiers/resolve.ts`) under the run's four settings:
 * `loop.settingSources`, `tiers.rafa` and the two pin maps.
 * `start/serving.ts` reads the same trees the same way, with no `PATH`
 * directories, and resolves them under the same settings before every
 * session, so the roster answers what the session will be served. The
 * roster's agents are the agent rows' outcomes; the skill rows are read
 * for the collision check below and decide no agent.
 *
 * A name resolves when it is one of these, and every other name a plan
 * asks for is refused ({@link MissingAgent.reason}):
 *
 *   - **served** by a project or user winner, which Claude Code loads by
 *     itself, or by a rafa winner `serveVerdict` (`tiers/serve.ts`)
 *     admits, which reaches the session through `--agents`. A rafa winner
 *     the verdict refuses is never handed over, so its name is refused
 *     as `not-served`, with the verdict's reason.
 *   - **a built-in** no loaded tier makes a claim on: no row holds the
 *     name, or only tiers the session does not load hold it. A built-in
 *     name a loaded tier holds is that tier's to serve or refuse.
 *
 * The refusals, each a sentence that names the fix:
 *
 *   - `collision`: two loaded tiers hold the name with different bytes.
 *     The sentence is `collisionMessage`'s, naming every path and the
 *     one pin line that settles it.
 *   - `off`: `false` in `tiers.agents` turned the name off. The sentence
 *     names that line, and the pin to serve it instead when a loaded
 *     tier holds it.
 *   - `unloaded`: only tiers the session does not load hold it. The
 *     sentence names each tier with its path and the setting that loads
 *     it; for the user tier it also names `rafa agent vendor <name>`,
 *     which copies the home's definition into the project tier.
 *   - `not-served`: above.
 *   - `unheld`: no tier holds it and no built-in answers it.
 *
 * The vendor command used to be every refusal's fix. Since the rafa tier
 * serves the roster, a name rafa ships resolves without any copy, so the
 * command is named only where it is the fix: a name the user tier alone
 * holds. {@link MissingAgent.fix} carries it there and nowhere else,
 * which is what `rafa init`'s warning (`agents/vendorable.ts`) reads.
 *
 * Under `bun test`, `Bun.main` is the test file, so a caller that leaves
 * {@link AgentRosterRoots.entry} out reads the rafa tier beside that file.
 * A test file directly under `src/` would read the checkout's own
 * `src/bundled/agents`; one deeper reads an absent tier.
 *
 * ## Which names a plan asks for
 *
 * {@link planAgentUses} reads the same markdown a tracker and a plan are
 * both written in — `parsePlan` reads a tracker as the checklist it is
 * — and answers the `agent=` of every task line that is still to run:
 * `- [ ]` and `- [BLOCKED]`, never `- [x]`. A ticked task has already
 * been dispatched, so an agent only it named stops nothing. Each name
 * carries the lines that asked for it, counting from one, as
 * `PlanIssue.line` counts.
 *
 * The lines read are the ones the DISPATCHER will reach, not the ones
 * the plan reads as: `PlanModel.hiddenTasks` is read beside
 * `PlanModel.tasks`, so a task line a `rafa:*` block the document never
 * closed hides is checked like any other. `findNextTask` dispatches
 * such a line — an unclosed fence runs to the end of the document,
 * which is where a plan's remaining tasks sit (`utils/tracker.ts`) — so
 * a name only it asks for would otherwise stop the run one task in,
 * with the dispatch exiting 1 before any model call, which is the
 * failure this module exists to move ahead of the run. A line inside a
 * block that CLOSES is not read here, because the dispatcher skips it
 * too. The two lists are merged by line, so a name is reported against
 * the line that asked for it either way, and the caller names the
 * document: `start/preflight.ts` the checklist it read, `rafa plan
 * validate` the file as typed.
 *
 * ## Which skills a plan asks for, and the refusals they meet
 *
 * {@link planSkillUses} reads the `skills=` names of the same task
 * lines, each with the lines that asked for it, and two checks read
 * them against the roster's resolution, which holds the three skill
 * trees beside the agent ones.
 *
 * {@link collidingPlanSkills} answers those a session under the roster's
 * settings could not be served because two loaded tiers hold them with
 * different contents (`resolveTiers`' `collision`). Nobody serves such a
 * name (`start/serving.ts`), so the task would run on whichever copy
 * Claude Code finds by itself, or on none. The sentence is
 * `collisionMessage`'s, naming every path and the one pin line that
 * settles it, and {@link skillCollisionLine} words it for the preflight
 * and `rafa plan validate`. A pin in `tiers.skills` settles it, as a
 * pin in `tiers.agents` settles an agent's, when it names the copy
 * Claude Code loads; a skill pin that does not is set aside and the
 * sentence says so (`tiers/resolve.ts`).
 *
 * {@link unresolvedPlanSkills} answers every other name `resolveTiers`
 * does not resolve to a winner, each with {@link UnresolvedSkill.reason}
 * and a sentence naming the fix, as an agent's refusal does:
 *
 *   - `unheld`: no tier holds it. This is the name a planner invented,
 *     or one only a plugin or an add-on holds: `resolveTiers` leaves
 *     those rows out, and the skill index the planner names skills from
 *     (`task/skill-index.ts`) lists only tier winners, so a plan naming
 *     one names what the index never offered.
 *   - `off`: `false` in `tiers.skills` turned it off. The sentence names
 *     that line, and the pin to serve it instead when a loaded tier
 *     holds it.
 *   - `unloaded`: only tiers the session does not load hold it. The
 *     sentence names each tier with its path and the setting that loads
 *     it. No vendor command is named: `rafa agent vendor` copies agents.
 *
 * {@link unresolvedSkillLine} words each for the same two callers.
 * `parseSkillList` in `utils/declaration.ts` still leaves membership
 * unchecked, since it reads one declaration and no tier; the refusal is
 * this module's, where the tiers are read. A rafa-tier winner the served
 * directory would skip (`serveVerdict` in `tiers/serve.ts`) is not
 * refused here: `resolveTiers` resolves it, and the verdict is
 * `start/serving.ts`'s to report.
 *
 * Nothing here throws, and nothing here spawns the CLI. An unreadable
 * directory, an unreadable file, a file with no frontmatter and one
 * whose frontmatter carries no usable `name` are each passed over, so a
 * `.claude/agents` holding a README contributes no agent named after
 * it.
 */
import type { SkillTier } from '../schema/tiers.js';
import type { Resolution, TierCollision, TierItem, TierRow, TierSettings } from '../tiers/resolve.js';
import type { TaskDeclaration } from '../utils/declaration.js';
import type { Dirent } from 'node:fs';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readTrees } from '../inventory/trees.js';
import { parsePlan } from '../plan/parse.js';
import { readFrontmatter } from '../schema/frontmatter.js';
import { isSkillTier, SKILL_TIERS } from '../schema/tiers.js';
import { collisionMessage, findTierItem, pinKey, pinLine, readItemBytes, resolveTiers } from '../tiers/resolve.js';
import { serveVerdict } from '../tiers/serve.js';
import { AGENT_DEFINITION_DIR } from '../utils/agent-definition.js';

/**
 * The agents Claude Code answers for with no definition of its own
 * loaded, in the order the CLI printed them. Measured on the version
 * {@link BUILT_IN_AGENTS_CLI_VERSION} names; see this module's note for
 * the probe and its control.
 */
export const BUILT_IN_AGENTS = [
  'claude',
  'Explore',
  'general-purpose',
  'Plan',
  'statusline-setup',
] as const;

/** The Claude Code version {@link BUILT_IN_AGENTS} was measured on. */
export const BUILT_IN_AGENTS_CLI_VERSION = '2.1.268';

/** The command that copies a user definition into the project. */
export const VENDOR_COMMAND = 'rafa agent vendor';

/** Where a roster name resolves: the tier whose holder is served, or the CLI's own built-ins. */
export type AgentScope = SkillTier | 'built-in';

/** The roots the three agent tiers are read from. */
export interface AgentRosterRoots {
  /** The project root, whose `.claude/agents` is the project tier. */
  readonly repoRoot: string;
  /** The home, whose `.claude/agents` is the user tier. */
  readonly home: string;
  /** The entry the rafa tier's `bundled/agents` sits beside. `Bun.main` when left out. */
  readonly entry?: string;
}

/** One definition file, under the name its frontmatter carries. */
export interface AgentDefinitionFile {
  /** Its frontmatter `name`, which is what `--agent` resolves by. */
  readonly name: string;
  /** The file it was read from. */
  readonly path: string;
}

/** One name a session resolves, and where. */
export interface RosterAgent {
  /** The name `--agent` takes, matched case-sensitively. */
  readonly name: string;
  /** The tier that serves it, or `built-in`. */
  readonly scope: AgentScope;
  /** The file it is served from, or null for a built-in. */
  readonly path: string | null;
}

/** Every name a session under one set of tier settings resolves. */
export interface AgentRoster {
  /** The settings the roster was resolved under. */
  readonly settings: TierSettings;
  /** `resolveTiers` over the three skill and agent trees: every name any tier holds, whatever its outcome. */
  readonly resolution: Resolution;
  /** Each name a session resolves, once: the tier winners in tier order, then the built-ins. */
  readonly agents: readonly RosterAgent[];
  /** Why each rafa winner `serveVerdict` refuses is left out, by name. */
  readonly unserved: ReadonlyMap<string, string>;
  /**
   * The user tier's definitions by name, whether or not the sources load
   * it, so a name only the home holds can be answered with a vendor command.
   */
  readonly userDefinitions: ReadonlyMap<string, string>;
}

/** One agent name a document asks for, and where it asked. */
export interface AgentUse {
  /** The `agent=` value, exactly as the declaration carried it. */
  readonly name: string;
  /** The task lines that named it, counting from one, in order. */
  readonly lines: readonly number[];
}

/** One skill name a document asks for, and where it asked. */
export interface SkillUse {
  /** One name of a `skills=` value, exactly as the declaration carried it. */
  readonly name: string;
  /** The task lines that named it, counting from one, in order. */
  readonly lines: readonly number[];
}

/** An asked-for skill two loaded tiers hold with different contents. */
export interface SkillCollision extends SkillUse {
  /** The collision `resolveTiers` answered, with every distinct holder and the pin line. */
  readonly collision: TierCollision;
  /** `collisionMessage`'s sentence: every path, then the pin line that settles it. */
  readonly message: string;
}

/** Why an asked-for skill name does not resolve, other than a collision; see the module note. */
export type UnresolvedSkillReason = 'off' | 'unloaded' | 'unheld';

/** An asked-for skill name `resolveTiers` resolves to no winner, and not for a collision. */
export interface UnresolvedSkill extends SkillUse {
  /** Why it does not resolve. */
  readonly reason: UnresolvedSkillReason;
  /** The sentence saying why, naming the paths and the setting or pin line that settles it. */
  readonly message: string;
}

/** Why an asked-for name does not resolve; see the module note. */
export type MissingAgentReason = 'collision' | 'off' | 'unloaded' | 'not-served' | 'unheld';

/** An asked-for name the roster does not resolve. */
export interface MissingAgent extends AgentUse {
  /** Why it does not resolve. */
  readonly reason: MissingAgentReason;
  /** The sentence saying why, naming the paths and the setting or pin line that settles it. */
  readonly message: string;
  /**
   * The vendor command that would copy the home's definition into the
   * project, for a name only the user tier holds; null for every other.
   */
  readonly fix: string | null;
}

/** A file's text, or null when nothing readable sits at `path`. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Whether `entry` under `dir` is a file, following a symbolic link the way
 * Claude Code does: this repository's `.claude/agents/` links into
 * `src/bundled/agents/`, and a dangling link counts as no file.
 */
function isFileEntry(dir: string, entry: Dirent): boolean {
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  return statSync(join(dir, entry.name), { throwIfNoEntry: false })?.isFile() === true;
}

/** The `.md` file names under `dir`, sorted, or none when it is unreadable. */
function markdownFiles(dir: string): readonly string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.name.endsWith('.md') && isFileEntry(dir, entry))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/** The frontmatter `name` of `text`, or null when it carries none usable. */
function definitionName(text: string): string | null {
  const frontmatter = readFrontmatter(text);
  if (frontmatter === null) return null;

  const name = frontmatter['name'];
  return typeof name === 'string' && name.length > 0
    ? name
    : null;
}

/**
 * Every definition directly under `dir`, by the name its frontmatter
 * carries, sorted by that name. A file with no readable text, no
 * frontmatter, or no usable `name` is passed over, and two files
 * carrying one name are both answered — `resolveTiers` is where a name
 * is taken once. `src/inventory/trees.ts` reads each tier's agents
 * through this, rafa's own `bundled/agents` included.
 */
export function readAgentDirectory(dir: string): readonly AgentDefinitionFile[] {
  const found: AgentDefinitionFile[] = [];

  for (const file of markdownFiles(dir)) {
    const path = join(dir, file);
    const text = readText(path);
    if (text === null) continue;

    const name = definitionName(text);
    if (name === null) continue;

    found.push({ name, path });
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** {@link readAgentDirectory} over `<root>/.claude/agents`. */
export function readAgentDefinitions(root: string): readonly AgentDefinitionFile[] {
  return readAgentDirectory(join(root, AGENT_DEFINITION_DIR));
}

/** Whether `name` is one of {@link BUILT_IN_AGENTS}, matched case-sensitively. */
function isBuiltIn(name: string): boolean {
  return (BUILT_IN_AGENTS as readonly string[]).includes(name);
}

/**
 * The skill rows of the three tiers, then their agent rows, each tier's
 * sorted by name: `start/serving.ts`'s reading, with no `PATH` directories.
 */
function tierRows(roots: AgentRosterRoots): readonly TierRow[] {
  return readTrees({
    home: roots.home,
    projectRoot: roots.repoRoot,
    pathDirs: [],
    ...(roots.entry === undefined
      ? {}
      : { entry: roots.entry }),
  }).flatMap((listing) => listing.items);
}

/** Why each rafa winner of `resolution` is not served, by name. */
function unservedWinners(resolution: Resolution): ReadonlyMap<string, string> {
  const unserved = new Map<string, string>();
  for (const item of resolution.items) {
    if (item.kind !== 'agent' || item.state !== 'served' || item.winner.source !== 'rafa') continue;
    const verdict = serveVerdict(item.winner);
    if (!verdict.ok) unserved.set(item.name, verdict.why);
  }
  return unserved;
}

/** Whether a built-in answers `name`: no loaded tier makes a claim on it. See the module note. */
function builtInAnswers(item: TierItem | undefined, name: string): boolean {
  return isBuiltIn(name) && (item === undefined || item.state === 'unloaded');
}

/**
 * The names a session spawned under `settings` resolves, read from the
 * three agent tiers under `roots` and never from the CLI. See the module
 * note.
 */
export function resolveAgentRoster(roots: AgentRosterRoots, settings: TierSettings): AgentRoster {
  const rows = tierRows(roots);
  const resolution = resolveTiers(rows, settings, readItemBytes);
  const unserved = unservedWinners(resolution);

  const winners = resolution.items.flatMap((item) => item.kind === 'agent'
    && item.state === 'served'
    && !unserved.has(item.name)
    ? [item.winner]
    : []);
  const served: RosterAgent[] = SKILL_TIERS.flatMap((tier) => winners
    .filter((row) => row.source === tier)
    .map((row) => ({ name: row.name, scope: tier, path: row.path })));
  const builtIns: RosterAgent[] = BUILT_IN_AGENTS
    .filter((name) => builtInAnswers(findTierItem(resolution, 'agent', name), name))
    .map((name) => ({ name, scope: 'built-in', path: null }));

  const userDefinitions = new Map<string, string>();
  for (const row of rows) {
    if (row.kind === 'agent' && row.source === 'user' && !userDefinitions.has(row.name)) {
      userDefinitions.set(row.name, row.path);
    }
  }

  return { settings, resolution, agents: [...served, ...builtIns], unserved, userDefinitions };
}

/** True when a session under this roster would resolve `name`. */
export function rosterResolves(roster: AgentRoster, name: string): boolean {
  return roster.agents.some((agent) => agent.name === name);
}

/**
 * The command that would copy the home's definition of `name` into the
 * project, or null when the user tier holds no definition of that name.
 */
export function vendorFixCommand(roster: AgentRoster, name: string): string | null {
  return roster.userDefinitions.has(name)
    ? `${VENDOR_COMMAND} ${name}`
    : null;
}

/** The clause naming why the session does not load `holder`'s tier. */
function unloadedClause(holder: TierRow, settings: TierSettings): string {
  return holder.source === 'rafa'
    ? `the rafa tier (${holder.path}), which tiers.rafa: off unloads`
    : `the user tier (${holder.path}), which loop.settingSources (${settings.settingSources.join(', ')}) leaves out`;
}

/** What would load `holder`'s tier; the vendor command only for an agent, which is all it copies. */
function loadingFix(holder: TierRow): string {
  if (holder.source === 'rafa') return 'set tiers.rafa: on';
  return holder.kind === 'agent'
    ? `add user to loop.settingSources, or run \`${VENDOR_COMMAND} ${holder.name}\``
    : 'add user to loop.settingSources';
}

/** The sentence for a name only unloaded tiers hold. */
function unloadedMessage(item: TierItem, settings: TierSettings): string {
  const clauses = item.holders.map((holder) => unloadedClause(holder, settings)).join(' and ');
  const fixes = item.holders.map(loadingFix).join(', or ');
  return `${item.kind} ${item.name} is held only by ${clauses}: ${fixes}`;
}

/** The sentence for a name `false` switched off. */
function offMessage(item: TierItem): string {
  const off = `${item.kind} ${item.name} is switched off by ${pinKey(item.kind)}: { ${item.name}: false }`;
  const [nearest] = item.loaded;
  return nearest !== undefined && isSkillTier(nearest.source)
    ? `${off}; pin the tier that serves it instead: ${pinLine(item.kind, item.name, nearest.source)}`
    : `${off}; drop that entry to serve it`;
}

/** Why `name` does not resolve and the sentence saying so, or null when it resolves. */
function missingReason(
  roster: AgentRoster,
  name: string,
): Pick<MissingAgent, 'reason' | 'message'> | null {
  const item = findTierItem(roster.resolution, 'agent', name);
  if (builtInAnswers(item, name)) return null;
  if (item === undefined) {
    return {
      reason: 'unheld',
      message: `agent ${name} is held by no tier: no project, rafa or user definition carries it, and it is no built-in agent`,
    };
  }
  if (item.state === 'collision') return { reason: 'collision', message: collisionMessage(item.collision) };
  if (item.state === 'off') return { reason: 'off', message: offMessage(item) };
  if (item.state === 'unloaded') return { reason: 'unloaded', message: unloadedMessage(item, roster.settings) };

  const why = roster.unserved.get(name);
  return why === undefined
    ? null
    : { reason: 'not-served', message: `agent ${name} is held by the rafa tier but not served: ${why} (${item.winner.path})` };
}

/**
 * `use` as a missing agent when a session under `roster` would not
 * resolve its name, or null when it would.
 */
export function missingAgent(roster: AgentRoster, use: AgentUse): MissingAgent | null {
  const missing = missingReason(roster, use.name);
  if (missing === null) return null;
  const fix = missing.reason === 'unloaded'
    ? vendorFixCommand(roster, use.name)
    : null;
  return { ...use, ...missing, fix };
}

/**
 * The names `namesOf` reads off each still-to-run task line of
 * `markdown`, each with the lines that asked, counting from one, in the
 * order they were first named. See {@link planAgentUses}.
 */
function planUses(
  markdown: string,
  namesOf: (declaration: TaskDeclaration) => readonly string[],
): readonly AgentUse[] {
  const lines = new Map<string, number[]>();
  const model = parsePlan(markdown);
  const dispatchable = [...model.tasks, ...model.hiddenTasks].sort((a, b) => a.lineNum - b.lineNum);

  for (const task of dispatchable) {
    if (task.status === 'done' || task.declaration === null) continue;

    for (const name of namesOf(task.declaration)) {
      const seen = lines.get(name);
      if (seen === undefined) lines.set(name, [task.lineNum + 1]);
      else seen.push(task.lineNum + 1);
    }
  }

  return [...lines].map(([name, used]) => ({ name, lines: used }));
}

/**
 * The `agent=` names the still-to-run task lines of `markdown` ask for,
 * each with the lines that asked, counting from one, in the order they
 * were first named. Reads a plan and a tracker alike: both are the
 * checklist `parsePlan` reads, and a ticked line is skipped because its
 * dispatch is behind the run rather than ahead of it. The lines a block
 * never closed hides are read too, the way `findNextTask` reads them;
 * see the module note.
 */
export function planAgentUses(markdown: string): readonly AgentUse[] {
  return planUses(markdown, (declaration) => declaration.agent === null
    ? []
    : [declaration.agent]);
}

/**
 * The `skills=` names the still-to-run task lines of `markdown` ask
 * for, read as {@link planAgentUses} reads `agent=`: each name once,
 * with every line that named it.
 */
export function planSkillUses(markdown: string): readonly SkillUse[] {
  return planUses(markdown, (declaration) => declaration.skills ?? []);
}

/**
 * The `skills=` names `markdown` asks for that two loaded tiers hold
 * with different contents under the roster's settings, each with the
 * collision and its sentence. Empty when every name is served, pinned,
 * or held outside the three tiers; see the module note.
 */
export function collidingPlanSkills(
  markdown: string,
  roster: AgentRoster,
): readonly SkillCollision[] {
  return planSkillUses(markdown).flatMap((use) => {
    const item = findTierItem(roster.resolution, 'skill', use.name);
    return item?.state === 'collision'
      ? [{ ...use, collision: item.collision, message: collisionMessage(item.collision) }]
      : [];
  });
}

/** Why `name` resolves to no skill winner and the sentence saying so, or null for a winner or a collision. */
function unresolvedSkillReason(
  roster: AgentRoster,
  name: string,
): Pick<UnresolvedSkill, 'reason' | 'message'> | null {
  const item = findTierItem(roster.resolution, 'skill', name);
  if (item === undefined) {
    return {
      reason: 'unheld',
      message: `skill ${name} is held by no tier: no project, rafa or user skill carries it; \`rafa skill list\` names the skills a session is served`,
    };
  }
  if (item.state === 'off') return { reason: 'off', message: offMessage(item) };
  if (item.state === 'unloaded') return { reason: 'unloaded', message: unloadedMessage(item, roster.settings) };
  return null;
}

/**
 * The `skills=` names `markdown` asks for that `resolveTiers` resolves
 * to no winner under the roster's settings — held by no tier, switched
 * off, or held only by tiers the session does not load — each with why
 * and what settles it. A collision is {@link collidingPlanSkills}'
 * answer and not this one's; see the module note.
 */
export function unresolvedPlanSkills(
  markdown: string,
  roster: AgentRoster,
): readonly UnresolvedSkill[] {
  return planSkillUses(markdown).flatMap((use) => {
    const unresolved = unresolvedSkillReason(roster, use.name);
    return unresolved === null
      ? []
      : [{ ...use, ...unresolved }];
  });
}

/**
 * The names `markdown` asks for that a session under `roster` would not
 * resolve, each with why and what settles it. Empty for a document whose
 * every open task routes somewhere the run can reach, which is what lets
 * a caller halt on a non-empty answer alone.
 */
export function missingPlanAgents(
  markdown: string,
  roster: AgentRoster,
): readonly MissingAgent[] {
  return planAgentUses(markdown).flatMap((use) => {
    const missing = missingAgent(roster, use);
    return missing === null
      ? []
      : [missing];
  });
}

/** `line 3`, or `lines 3, 5` for more than one. */
function linesClause(lines: readonly number[]): string {
  return lines.length === 1
    ? `line ${lines[0]}`
    : `lines ${lines.join(', ')}`;
}

/**
 * One line naming a missing agent, where it was asked for and why it
 * cannot be dispatched, for the preflight halt and for `rafa plan
 * validate` to print as they print their other refusals.
 */
export function missingAgentLine(missing: MissingAgent): string {
  return `agent "${missing.name}" (${linesClause(missing.lines)}) cannot be dispatched: ${missing.message}`;
}

/**
 * One line naming a colliding skill, where it was asked for, and the
 * paths and pin line of the collision, for the same two callers as
 * {@link missingAgentLine}.
 */
export function skillCollisionLine(colliding: SkillCollision): string {
  return `skill "${colliding.name}" (${linesClause(colliding.lines)}) cannot be served: ${colliding.message}`;
}

/**
 * One line naming a skill no tier resolves, where it was asked for and
 * why, for the same two callers as {@link missingAgentLine}.
 */
export function unresolvedSkillLine(unresolved: UnresolvedSkill): string {
  return `skill "${unresolved.name}" (${linesClause(unresolved.lines)}) cannot be served: ${unresolved.message}`;
}
