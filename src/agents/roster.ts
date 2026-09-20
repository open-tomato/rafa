/**
 * The agents a session will see, and the `agent=` names a plan asks for
 * that none of them answers.
 *
 * A task routed `agent=tdd-guide` is dispatched with `--agent
 * tdd-guide`, and a name the CLI cannot resolve STOPS that dispatch:
 * it exits 1 with no JSON at all, before any model call, and prints the
 * roster it could have run on stderr (`context/workflow.md`). That is
 * what this module is for. It answers, without spawning anything, which
 * names a run under a given `loop.settingSources` resolves, so a plan
 * naming an agent the project does not carry is refused by the
 * preflight rather than one task into the run.
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
 * So the roster is the project's definitions under `project`, then the
 * home's under `user`, then the built-ins, each name taken once and the
 * first scope to hold it the one that answers. A project file SHADOWS a
 * user-level definition of the same name rather than merging with it,
 * and {@link RosterAgent.shadows} is where that is visible: the roster
 * itself shows one entry, as the CLI shows one name.
 *
 * ## The home is read whatever the sources say
 *
 * {@link AgentRoster.userDefinitions} holds `~/.claude/agents` even
 * under the loop's default `project,local`, where none of it resolves.
 * That is the fix command's evidence and not the roster's: a name the
 * run cannot resolve but the home defines is one `rafa agent vendor
 * <name>` can copy into the project, and a name no user file carries
 * has no such fix ({@link vendorFixCommand}). Under sources naming
 * `user` the question never arises, since a home name resolves and is
 * therefore never missing.
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
 * Nothing here throws, and nothing here spawns the CLI. An unreadable
 * directory, an unreadable file, a file with no frontmatter and one
 * whose frontmatter carries no usable `name` are each passed over, so a
 * `.claude/agents` holding a README contributes no agent named after
 * it.
 */
import type { ClaudeSettingSource } from '../config.js';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePlan } from '../plan/parse.js';
import { readFrontmatter } from '../schema/frontmatter.js';
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

/** Where a roster name resolves. */
export type AgentScope = 'project' | 'user' | 'built-in';

/** The two roots definitions are read from. */
export interface AgentRosterRoots {
  /** The project root, whose `.claude/agents` loads under `project`. */
  readonly repoRoot: string;
  /** The home, whose `.claude/agents` loads under `user`. */
  readonly home: string;
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
  /** The scope that answers for it. */
  readonly scope: AgentScope;
  /** The file it was read from, or null for a built-in. */
  readonly path: string | null;
  /**
   * The user-level file this project definition shadows, or null: for a
   * project entry with no home file of the same name, for every entry
   * when the sources leave `user` out, and for every entry that is not
   * a project one.
   */
  readonly shadows: string | null;
}

/** Every name a session under one config resolves. */
export interface AgentRoster {
  /** The sources the roster was resolved under. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** Each name once, project first, then user, then the built-ins. */
  readonly agents: readonly RosterAgent[];
  /**
   * The home's definitions by name, read whatever the sources say, so a
   * name the run cannot resolve can still be answered with a vendor
   * command.
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

/** An asked-for name the roster does not resolve. */
export interface MissingAgent extends AgentUse {
  /**
   * The command that would make the name resolve, or null when no user
   * definition carries it and there is therefore nothing to copy.
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

/** The `.md` file names under `dir`, sorted, or none when it is unreadable. */
function markdownFiles(dir: string): readonly string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
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
 * Every definition under `<root>/.claude/agents`, by the name its
 * frontmatter carries, sorted by that name. A file with no readable
 * text, no frontmatter, or no usable `name` is passed over, and two
 * files carrying one name are both answered — {@link resolveAgentRoster}
 * is where a name is taken once.
 */
export function readAgentDefinitions(root: string): readonly AgentDefinitionFile[] {
  const dir = join(root, AGENT_DEFINITION_DIR);
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

/** The first file answering for each name, in the order they were read. */
function firstByName(files: readonly AgentDefinitionFile[]): Map<string, string> {
  const byName = new Map<string, string>();
  for (const file of files) {
    if (!byName.has(file.name)) byName.set(file.name, file.path);
  }
  return byName;
}

/**
 * The names a session spawned under `settingSources` resolves, read
 * from `roots` and never from the CLI.
 */
export function resolveAgentRoster(
  roots: AgentRosterRoots,
  settingSources: readonly ClaudeSettingSource[],
): AgentRoster {
  const loadsProject = settingSources.includes('project');
  const loadsUser = settingSources.includes('user');
  const userDefinitions = firstByName(readAgentDefinitions(roots.home));
  const projectDefinitions = loadsProject
    ? firstByName(readAgentDefinitions(roots.repoRoot))
    : new Map<string, string>();

  const agents: RosterAgent[] = [];
  const taken = new Set<string>();

  for (const [name, path] of projectDefinitions) {
    taken.add(name);
    agents.push({
      name,
      scope: 'project',
      path,
      shadows: loadsUser
        ? userDefinitions.get(name) ?? null
        : null,
    });
  }

  if (loadsUser) {
    for (const [name, path] of userDefinitions) {
      if (taken.has(name)) continue;
      taken.add(name);
      agents.push({ name, scope: 'user', path, shadows: null });
    }
  }

  for (const name of BUILT_IN_AGENTS) {
    if (taken.has(name)) continue;
    taken.add(name);
    agents.push({ name, scope: 'built-in', path: null, shadows: null });
  }

  return { settingSources, agents, userDefinitions };
}

/** True when a session under this roster would resolve `name`. */
export function rosterResolves(roster: AgentRoster, name: string): boolean {
  return roster.agents.some((agent) => agent.name === name);
}

/**
 * The command that would make `name` resolve in the project, or null
 * when `~/.claude/agents` carries no definition of that name and there
 * is therefore nothing to copy.
 */
export function vendorFixCommand(roster: AgentRoster, name: string): string | null {
  return roster.userDefinitions.has(name)
    ? `${VENDOR_COMMAND} ${name}`
    : null;
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
  const lines = new Map<string, number[]>();
  const model = parsePlan(markdown);
  const dispatchable = [...model.tasks, ...model.hiddenTasks].sort((a, b) => a.lineNum - b.lineNum);

  for (const task of dispatchable) {
    if (task.status === 'done') continue;

    const name = task.declaration?.agent ?? null;
    if (name === null) continue;

    const seen = lines.get(name);
    if (seen === undefined) lines.set(name, [task.lineNum + 1]);
    else seen.push(task.lineNum + 1);
  }

  return [...lines].map(([name, used]) => ({ name, lines: used }));
}

/**
 * The names `markdown` asks for that a session under `roster` would not
 * resolve, each with the command that would fix it or null when there
 * is none. Empty for a document whose every open task routes somewhere
 * the run can reach, which is what lets a caller halt on a non-empty
 * answer alone.
 */
export function missingPlanAgents(
  markdown: string,
  roster: AgentRoster,
): readonly MissingAgent[] {
  return planAgentUses(markdown)
    .filter((use) => !rosterResolves(roster, use.name))
    .map((use) => ({ ...use, fix: vendorFixCommand(roster, use.name) }));
}

/**
 * One line naming a missing agent, where it was asked for and what to
 * run about it, for the preflight halt and for `rafa plan validate` to
 * print as they print their other refusals.
 */
export function missingAgentLine(missing: MissingAgent): string {
  const where = missing.lines.length === 1
    ? `line ${missing.lines[0]}`
    : `lines ${missing.lines.join(', ')}`;
  const fix = missing.fix === null
    ? 'no definition under ~/.claude/agents to vendor'
    : `run \`${missing.fix}\``;

  return `agent "${missing.name}" (${where}) resolves under no loaded scope: ${fix}`;
}
