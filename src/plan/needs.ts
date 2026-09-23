/**
 * What a plan, or a spec, needs from this machine: the agents, skills,
 * MCP servers and programs it names, each read as `present` or
 * `missing` against the inventory, the MCP server configuration and
 * `PATH`. `rafa plan needs` prints it. Nothing here starts a session,
 * starts a server or runs a probe.
 *
 * ## What a plan needs
 *
 * {@link readPlanNeeds} reads every OPEN task of the plan (every line
 * `parsePlan` answers whose status is not `done`, `[BLOCKED]` included,
 * as `findNextTask` reads "open") and takes off its declaration:
 *
 *   - `agent=` names one agent, and `skills=` one skill per entry. Each
 *     is looked up by kind and name in the inventory (`buildInventory`).
 *     Plugin items carry their plugin's prefix, which the declaration
 *     grammar refuses (`agent=alpha:rev` is an `unusable-value`, measured
 *     on 2026-09-24), so a declared name only ever meets a bare one.
 *   - Every `tools=` entry shaped `mcp__<server>__…`, or a bare
 *     `mcp__<server>`, names the MCP server `<server>`, looked up by the
 *     MCP reader (`src/inventory/mcp.ts`). The server segment runs to the
 *     first `__` after the prefix, and is compared as written: how Claude
 *     Code spells a server name holding a character a tool name cannot
 *     was not measured.
 *
 * and two sources that are not task lines:
 *
 *   - **The plan's PREREQUISITES probes.** Every unticked item
 *     `parsePrerequisites` gives a probe (`auto` and `start` items), in
 *     `PREREQUISITES-<stub>.md` beside the plan, is split at `|`, `&&`,
 *     `||` and `;`, and each part's program is its first word as the
 *     skill checker reads one (`toolOf` in `src/check/shell-lines.ts`),
 *     after any leading `!` and `NAME=value` words. A lookup —
 *     `command -v <name>`, `which <name>`, `type <name>`, `hash <name>` —
 *     names `<name>`, the program the probe asks after, and not the
 *     lookup itself. What a probe runs inside `$(…)`, `sh -c '…'` or a
 *     quoted string holding one of the split tokens is not read.
 *   - **The shell fences of every declared skill.** For each declared
 *     skill the inventory holds, its holder's body (the first holder of
 *     the name, whatever its state, since that is the file a fixed
 *     visibility would load) is read exactly as the skill checker reads
 *     it: every command a shell fence names that no function the body
 *     defines answers for. That set is taken from `checkReferences` run
 *     over an empty `PATH`, where every such command reads as
 *     `missing-tool`, so the two readings cannot drift apart.
 *
 * ## What a spec needs
 *
 * {@link readSpecNeeds} reads the spec's text for every name the
 * inventory holds, as a whole word: not touching a letter, digit, `_`
 * or `-` on either side, so `review` is not found in `review-pr`. Each
 * item it finds is marked `mentioned` at its first line, and is present
 * by construction, since the name came from the inventory.
 *
 * ## Present, missing, and visible to a run
 *
 *   - An agent or skill is present when any inventory row of its kind
 *     and name exists. It then carries its holder's source, path and
 *     state, and `visibleToLoop` from the inventory, so a user-only
 *     agent under `loop.settingSources` without `user` is present and
 *     not visible, which `--missing` reports as unmet.
 *   - An MCP server is present when any scope declares it, and visible
 *     when a loop session under `loop.settingSources` would start one
 *     of its declarations (`mcpServerFor`).
 *   - A program is present when a directory of `pathDirs`, in order,
 *     holds an executable file of its name (any exec bit, the checker's
 *     rule). The loop's sessions inherit that `PATH`, so a program has
 *     no separate visibility.
 *
 * {@link isUnmet} is the one test `--missing` applies: missing, or
 * present and not visible to a run.
 *
 * ## Stack tools
 *
 * Beside what the plan names, {@link readPlanNeeds} reads the symbol
 * tool a shell-only subagent needs for the project's stack: a loop
 * session's subagents have no LSP tool, and grep misses re-exports and
 * aliases. {@link STACK_TOOLS} holds one row per stack; TypeScript, read
 * from a `tsconfig.json` file at the project root, is the only row until
 * the add-ons of #29. No other stack reading exists, so a marker file
 * is the whole test, and a reading with no project root has no stack.
 *
 * A detected stack needs two things, each added to the items with a
 * `stack` origin:
 *
 *   - its program, looked up on `pathDirs` like any other program;
 *   - a skill naming that program: a skill whose file (frontmatter
 *     included, as a `description` is where one usually says it) holds
 *     the program's name as a whole word, as a spec mention is read. Of
 *     the skills naming it, one visible to a run is taken first, so a
 *     project skill beside a user-only one reads as met; with none
 *     visible, the first by name stands, present and not visible. With
 *     no skill naming it, no skill item is added, since there is no
 *     name to list, and the stack's own row says so.
 *
 * Each detected stack gets a {@link StackReading} with `met` and, when
 * not met, one `hint` line naming what to install and where. The stack
 * tools are read for a plan only: a spec's needs are what its text
 * mentions.
 *
 * ## Warnings, never gaps
 *
 * An unreadable plugin, settings file, `skillOverrides` entry or MCP
 * file is a warning carried over from its reader, and a declared
 * skill's body that does not read is one more; none drops an item. A
 * plan, spec or PREREQUISITES file that is there and cannot be read is
 * refused instead, with its path: a needs list read off half a plan
 * would answer the wrong question. An absent PREREQUISITES file is no
 * file and no refusal.
 *
 * Nothing here reads the real home or `PATH` unless it is handed them:
 * every location comes from {@link NeedsSeams}.
 */
import type { InventorySeams } from '../inventory/index.js';
import type { McpReading, McpScope } from '../inventory/mcp.js';
import type { InventoryKind, InventoryRecord, InventorySource, InventoryState } from '../inventory/record.js';

import { statSync } from 'node:fs';
import { join } from 'node:path';

import { checkReferences } from '../check/references.js';
import { toolOf } from '../check/shell-lines.js';
import { messageOf } from '../config-sections.js';
import { buildInventory } from '../inventory/index.js';
import { mcpDeclarationsOf, mcpServerFor, readMcpServers } from '../inventory/mcp.js';
import { parsePrerequisites, prerequisitesPathForPlan } from '../preflight/prerequisites-md.js';
import { readFrontmatterDocument } from '../schema/frontmatter.js';

import { parsePlan } from './parse.js';

/** What a need is for. */
export type NeedKind = InventoryKind | 'mcp' | 'program';

/** The kinds, in the order a reading lists them. */
export const NEED_KINDS: readonly NeedKind[] = ['agent', 'skill', 'mcp', 'program'];

/** Whether this machine holds it. */
export type NeedStatus = 'present' | 'missing';

/** The prefix a tool name carries when an MCP server provides it. */
export const MCP_TOOL_PREFIX = 'mcp__';

/**
 * The words that ask whether a program is there: the program they name
 * is the need, not the word itself.
 */
export const LOOKUP_WORDS: readonly string[] = ['command', 'which', 'type', 'hash'];

/** Where a need was named. Every `line` counts from one. */
export type NeedOrigin =
  /** A task line of the plan declares it. */
  | { readonly by: 'task'; readonly line: number }
  /** A probe of the plan's PREREQUISITES file calls it. */
  | { readonly by: 'prerequisite'; readonly line: number }
  /** A shell fence of the named declared skill calls it. */
  | { readonly by: 'skill'; readonly skill: string }
  /** The spec's text mentions it, first on this line. */
  | { readonly by: 'mentioned'; readonly line: number }
  /** The project's stack needs it; see {@link STACK_TOOLS}. */
  | { readonly by: 'stack'; readonly stack: string };

/** What every need carries. */
interface NeedBase {
  readonly name: string;
  readonly status: NeedStatus;
  /** Where it was named, in reading order, each place once. */
  readonly origins: readonly NeedOrigin[];
}

/** An agent or skill, read against the inventory. */
export interface InventoryNeed extends NeedBase {
  readonly kind: InventoryKind;
  /** The holder's source, or null when missing. */
  readonly source: InventorySource | null;
  /** The holder's definition file, or null when missing. */
  readonly path: string | null;
  /** The holder's state, or null when missing. */
  readonly state: InventoryState | null;
  /** True when a session under `loop.settingSources` resolves it. */
  readonly visibleToLoop: boolean;
}

/** An MCP server, read against the MCP configuration. */
export interface McpNeed extends NeedBase {
  readonly kind: 'mcp';
  /** The scope of its nearest declaration, or null when none declares it. */
  readonly scope: McpScope | null;
  /** The scope a loop session starts it from, or null when none would. */
  readonly loadedFrom: McpScope | null;
  /** True when a loop session under `loop.settingSources` starts it. */
  readonly visibleToLoop: boolean;
}

/** A program, read against `PATH`. */
export interface ProgramNeed extends NeedBase {
  readonly kind: 'program';
  /** The first `pathDirs` directory holding it, or null when missing. */
  readonly directory: string | null;
}

/** One thing a plan or spec needs. */
export type Need = InventoryNeed | McpNeed | ProgramNeed;

/** One file, key or entry a reader could not use. */
export interface NeedsWarning {
  readonly path: string;
  /** Why, as one sentence fragment. */
  readonly reason: string;
}

/**
 * One stack's symbol tool: what marks the stack, the program a
 * shell-only subagent traces symbols with, and where to get it.
 */
export interface StackTool {
  /** The stack, as one lowercase word. */
  readonly stack: string;
  /** Files at the project root, any one of which marks the stack. */
  readonly markers: readonly string[];
  /** The program, looked up on `PATH`. */
  readonly program: string;
  /** What to install when the program is missing, as a sentence fragment. */
  readonly install: string;
}

/** One row per stack; see the module note. */
export const STACK_TOOLS: readonly StackTool[] = [
  {
    stack: 'typescript',
    markers: ['tsconfig.json'],
    program: 'ts-symbols',
    install: 'install `ts-symbols` (def, refs, type and outline over the TypeScript language service) on PATH',
  },
];

/** One detected stack's symbol tool, read against the machine. */
export interface StackReading {
  readonly stack: string;
  /** The marker file that detected it, an absolute path. */
  readonly marker: string;
  readonly program: string;
  /** The skill naming the program that was taken, or null when none names it. */
  readonly skill: string | null;
  /** True when the program is present and the skill is present and visible to a run. */
  readonly met: boolean;
  /** One line naming what to install and where, or null when met. */
  readonly hint: string | null;
}

/** Every need, by kind in {@link NEED_KINDS} order and then by name. */
export interface NeedsReading {
  readonly items: readonly Need[];
  /** One per stack {@link STACK_TOOLS} detects; always empty for a spec. */
  readonly stacks: readonly StackReading[];
  readonly warnings: readonly NeedsWarning[];
}

/**
 * What the needs are read against: the inventory's own seams, whose
 * `pathDirs` is also the `PATH` a program is looked up in and whose
 * `settingSources` also decides which MCP server a run starts.
 */
export type NeedsSeams = InventorySeams;

/** One need named once, before it is read against the machine. */
interface Named {
  readonly kind: NeedKind;
  readonly name: string;
  readonly origin: NeedOrigin;
}

/** The text at `path`, or null when nothing is there; refuses anything else. */
async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch (error) {
    const isAbsent = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
    if (isAbsent) return null;
    throw new Error(`${path}: cannot be read (${messageOf(error)})`, { cause: error });
  }
}

/** The text at `path`, refusing an absent file too. */
async function readRequired(path: string): Promise<string> {
  const text = await readIfPresent(path);
  if (text === null) throw new Error(`${path}: no such file`);
  return text;
}

/** The server an `mcp__<server>__…` tool names, or null for any other tool. */
export function mcpServerOfTool(tool: string): string | null {
  if (!tool.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = tool.slice(MCP_TOOL_PREFIX.length);
  const end = rest.indexOf('__');
  const server = end === -1
    ? rest
    : rest.slice(0, end);
  return server === ''
    ? null
    : server;
}

/** The program one part of a probe calls; see the module note. */
function programOfPart(part: string): string | null {
  const words = part.trim()
    .split(/\s+/)
    .filter((word) => word !== '' && word !== '!');
  const first = words.findIndex((word) => !word.includes('='));
  if (first === -1) return null;

  const [word, ...args] = words.slice(first);
  if (word !== undefined && LOOKUP_WORDS.includes(word)) {
    const target = args.find((arg) => !arg.startsWith('-'));
    return target === undefined
      ? null
      : toolOf(target);
  }
  return toolOf(words.slice(first).join(' '));
}

/** The programs one probe calls, each once, in order; see the module note. */
export function probePrograms(probe: string): readonly string[] {
  const programs = probe.split(/\|\||&&|[|;]/).map(programOfPart);
  return [...new Set(programs.filter((program): program is string => program !== null))];
}

/** The commands a skill body's shell fences call, as the checker reads them. */
export function fencePrograms(text: string): readonly string[] {
  const body = readFrontmatterDocument(text)?.body ?? text;
  const { issues } = checkReferences(body, { projectRoot: null, skillDir: null, pathDirs: [], stack: null });
  return issues.filter((issue) => issue.code === 'missing-tool').map((issue) => issue.reference.text);
}

/** The first directory of `pathDirs` holding an executable file `name`. */
export function programDirectory(name: string, pathDirs: readonly string[]): string | null {
  return pathDirs.find((dir) => {
    try {
      const stats = statSync(join(dir, name));
      return stats.isFile() && (stats.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }) ?? null;
}

/** The first row of each kind and name: its holder, the rows being in precedence order. */
function holdersOf(records: readonly InventoryRecord[]): ReadonlyMap<string, InventoryRecord> {
  const holders = new Map<string, InventoryRecord>();
  for (const record of records) {
    const key = needKey(record.kind, record.name);
    if (!holders.has(key)) holders.set(key, record);
  }
  return holders;
}

/** The key a need is merged under. */
function needKey(kind: NeedKind, name: string): string {
  return `${kind}\u0000${name}`;
}

/** Whether two origins name the same place. */
function sameOrigin(a: NeedOrigin, b: NeedOrigin): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Each kind and name once, its origins merged in reading order. */
function merged(named: readonly Named[]): readonly Named[][] {
  const groups = new Map<string, Named[]>();
  for (const entry of named) {
    const key = needKey(entry.kind, entry.name);
    const group = groups.get(key) ?? [];
    if (!group.some((seen) => sameOrigin(seen.origin, entry.origin))) group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Needs named by one reader, and what it could not read. */
interface NamedNeeds {
  readonly named: readonly Named[];
  readonly warnings: readonly NeedsWarning[];
}

/** What the machine was read into, once per reading. */
interface Machine {
  readonly holders: ReadonlyMap<string, InventoryRecord>;
  readonly records: readonly InventoryRecord[];
  readonly mcp: McpReading;
  readonly seams: NeedsSeams;
}

/** One named need read against the machine. */
function resolveNeed(kind: NeedKind, name: string, origins: readonly NeedOrigin[], machine: Machine): Need {
  if (kind === 'program') {
    const directory = programDirectory(name, machine.seams.pathDirs);
    const status: NeedStatus = directory === null
      ? 'missing'
      : 'present';
    return { kind, name, status, origins, directory };
  }
  if (kind === 'mcp') {
    const scope = mcpDeclarationsOf(machine.mcp, name)[0]?.scope ?? null;
    const loadedFrom = mcpServerFor(machine.mcp, name, machine.seams.settingSources)?.scope ?? null;
    const status: NeedStatus = scope === null
      ? 'missing'
      : 'present';
    return { kind, name, status, origins, scope, loadedFrom, visibleToLoop: loadedFrom !== null };
  }

  const holder = machine.holders.get(needKey(kind, name));
  const visibleToLoop = isVisible(machine, kind, name);
  return {
    kind,
    name,
    origins,
    status: holder === undefined
      ? 'missing'
      : 'present',
    source: holder?.source ?? null,
    path: holder?.path ?? null,
    state: holder?.state ?? null,
    visibleToLoop,
  };
}

/** Needs by kind, then name. */
function inListingOrder(items: readonly Need[]): readonly Need[] {
  return [...items].sort((a, b) => NEED_KINDS.indexOf(a.kind) - NEED_KINDS.indexOf(b.kind)
    || a.name.localeCompare(b.name));
}

/** Every warning the readers answered, each path and reason once. */
function readerWarnings(
  inventory: ReturnType<typeof buildInventory>,
  mcp: McpReading,
  own: readonly NeedsWarning[],
): readonly NeedsWarning[] {
  const all = [...inventory.warnings, ...inventory.overrideWarnings, ...mcp.warnings, ...own];
  const seen = new Set<string>();
  return all.flatMap(({ path, reason }) => {
    const key = `${path}\u0000${reason}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ path, reason }];
  });
}

/** Needs a reader named, the stacks it detected, and what it could not read. */
interface NamedWithStacks extends NamedNeeds {
  readonly stacks: readonly DetectedStack[];
}

/** The machine read once, and the named needs resolved against it. */
async function readAgainstMachine(
  seams: NeedsSeams,
  name: (machine: Machine) => Promise<NamedWithStacks>,
): Promise<NeedsReading> {
  const inventory = buildInventory(seams);
  const mcp = readMcpServers(seams);
  const machine: Machine = { holders: holdersOf(inventory.records), records: inventory.records, mcp, seams };

  const { named, stacks, warnings } = await name(machine);
  const items = merged(named).flatMap((group) => {
    const [first] = group;
    if (first === undefined) return [];
    return [resolveNeed(first.kind, first.name, group.map((entry) => entry.origin), machine)];
  });
  return {
    items: inListingOrder(items),
    stacks: stacks.map((detected) => stackReading(detected, items)),
    warnings: readerWarnings(inventory, mcp, warnings),
  };
}

/** The needs every open task of `markdown` declares. */
function taskNeeds(markdown: string): readonly Named[] {
  return parsePlan(markdown).tasks
    .filter((task) => task.status !== 'done' && task.declaration !== null)
    .flatMap((task): Named[] => {
      const origin: NeedOrigin = { by: 'task', line: task.lineNum + 1 };
      const declaration = task.declaration;
      if (declaration === null) return [];

      const agents = declaration.agent === null
        ? []
        : [{ kind: 'agent' as const, name: declaration.agent, origin }];
      const skills = (declaration.skills ?? []).map((name) => ({ kind: 'skill' as const, name, origin }));
      const servers = (declaration.tools ?? []).flatMap((tool) => {
        const server = mcpServerOfTool(tool);
        return server === null
          ? []
          : [{ kind: 'mcp' as const, name: server, origin }];
      });
      return [...agents, ...skills, ...servers];
    });
}

/** The programs the probes of a PREREQUISITES file call. */
function prerequisiteNeeds(content: string | null): readonly Named[] {
  if (content === null) return [];
  return parsePrerequisites(content).flatMap((item) => {
    if (item.probe === null) return [];
    const origin: NeedOrigin = { by: 'prerequisite', line: item.lineIndex + 1 };
    return probePrograms(item.probe).map((name) => ({ kind: 'program' as const, name, origin }));
  });
}

/** The programs the shell fences of every declared skill the inventory holds call. */
async function skillFenceNeeds(
  skills: readonly string[],
  machine: Machine,
): Promise<NamedNeeds> {
  const named: Named[] = [];
  const warnings: NeedsWarning[] = [];
  for (const skill of skills) {
    const holder = machine.holders.get(needKey('skill', skill));
    if (holder === undefined) continue;
    try {
      const text = await Bun.file(holder.path).text();
      const origin: NeedOrigin = { by: 'skill', skill };
      named.push(...fencePrograms(text).map((name) => ({ kind: 'program' as const, name, origin })));
    } catch (error) {
      warnings.push({ path: holder.path, reason: `cannot be read (${messageOf(error)})` });
    }
  }
  return { named, warnings };
}

/** A stack {@link STACK_TOOLS} detected, and the skill naming its program, if any. */
interface DetectedStack {
  readonly tool: StackTool;
  readonly marker: string;
  readonly skill: string | null;
}

/** The marker of `tool` at `projectRoot`, or null when none is a file there. */
function stackMarker(tool: StackTool, projectRoot: string | null): string | null {
  if (projectRoot === null) return null;
  const found = tool.markers.map((marker) => join(projectRoot, marker)).find((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
  return found ?? null;
}

/** Whether a session under `loop.settingSources` resolves any row of this kind and name. */
function isVisible(machine: Machine, kind: InventoryKind, name: string): boolean {
  return machine.records.some((record) => record.kind === kind && record.name === name && record.visibleToLoop);
}

/** Every skill whose holder's file names `program` as a whole word, by name. */
async function skillsNaming(
  program: string,
  machine: Machine,
): Promise<{ readonly skills: readonly string[]; readonly warnings: readonly NeedsWarning[] }> {
  const pattern = wholeWord(program);
  const skills: string[] = [];
  const warnings: NeedsWarning[] = [];
  for (const holder of machine.holders.values()) {
    if (holder.kind !== 'skill') continue;
    try {
      if (pattern.test(await Bun.file(holder.path).text())) skills.push(holder.name);
    } catch (error) {
      warnings.push({ path: holder.path, reason: `cannot be read (${messageOf(error)})` });
    }
  }
  return { skills, warnings };
}

/** The stacks the project root marks, and the program and skill each needs. */
async function stackNeeds(machine: Machine): Promise<NamedWithStacks> {
  const named: Named[] = [];
  const stacks: DetectedStack[] = [];
  const warnings: NeedsWarning[] = [];
  for (const tool of STACK_TOOLS) {
    const marker = stackMarker(tool, machine.seams.projectRoot);
    if (marker === null) continue;

    const origin: NeedOrigin = { by: 'stack', stack: tool.stack };
    const naming = await skillsNaming(tool.program, machine);
    const skill = naming.skills.find((name) => isVisible(machine, 'skill', name)) ?? naming.skills[0] ?? null;
    named.push({ kind: 'program', name: tool.program, origin });
    if (skill !== null) named.push({ kind: 'skill', name: skill, origin });
    stacks.push({ tool, marker, skill });
    warnings.push(...naming.warnings);
  }
  return { named, stacks, warnings };
}

/** The hint for a stack whose program or skill is unmet, as one line. */
function stackHint(tool: StackTool, program: Need | undefined, skill: Need | undefined): string | null {
  const parts: string[] = [];
  if (program === undefined || program.status === 'missing') parts.push(tool.install);
  if (skill === undefined) {
    parts.push(`add a skill naming \`${tool.program}\` under .claude/skills/ in this project`);
  } else if (isUnmet(skill)) {
    const source = 'source' in skill
      ? skill.source
      : null;
    parts.push(`make the skill \`${skill.name}\` (${source ?? 'unknown'} source) visible to a run: `
      + 'move it under .claude/skills/ in this project, or add `user` to loop.settingSources');
  }
  return parts.length === 0
    ? null
    : `${tool.stack}: ${parts.join('; ')}`;
}

/** A detected stack read against the resolved items. */
function stackReading(detected: DetectedStack, items: readonly Need[]): StackReading {
  const { tool, marker, skill } = detected;
  const program = items.find((item) => item.kind === 'program' && item.name === tool.program);
  const skillNeed = skill === null
    ? undefined
    : items.find((item) => item.kind === 'skill' && item.name === skill);
  const hint = stackHint(tool, program, skillNeed);
  return { stack: tool.stack, marker, program: tool.program, skill, met: hint === null, hint };
}

/**
 * What the plan at `planPath` needs: its open tasks' agents, skills and
 * MCP servers, its PREREQUISITES probes' programs and its declared
 * skills' fence programs, and the stack tools of the project root (see
 * {@link STACK_TOOLS}), each read against the machine `seams` names.
 * Refuses a plan, or a PREREQUISITES file, that is there and does not
 * read. See the module note.
 */
export async function readPlanNeeds(planPath: string, seams: NeedsSeams): Promise<NeedsReading> {
  const markdown = await readRequired(planPath);
  const prerequisitesPath = prerequisitesPathForPlan(planPath);
  const prerequisites = prerequisitesPath === null
    ? null
    : await readIfPresent(prerequisitesPath);

  return readAgainstMachine(seams, async (machine) => {
    const tasks = taskNeeds(markdown);
    const skills = [...new Set(tasks.filter((entry) => entry.kind === 'skill').map((entry) => entry.name))];
    const fences = await skillFenceNeeds(skills, machine);
    const stacks = await stackNeeds(machine);
    return {
      named: [...tasks, ...prerequisiteNeeds(prerequisites), ...fences.named, ...stacks.named],
      stacks: stacks.stacks,
      warnings: [...fences.warnings, ...stacks.warnings],
    };
  });
}

/** `name` as a pattern matching it as a whole word; see the module note. */
function wholeWord(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`);
}

/** The line, from one, `name` first appears on as a whole word, or null. */
function firstMention(lines: readonly string[], name: string): number | null {
  const pattern = wholeWord(name);
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1
    ? null
    : index + 1;
}

/**
 * What the spec at `specPath` needs: every inventory name its text
 * mentions as a whole word, marked `mentioned` at its first line. Refuses
 * a spec that is not there or does not read. See the module note.
 */
export async function readSpecNeeds(specPath: string, seams: NeedsSeams): Promise<NeedsReading> {
  const lines = (await readRequired(specPath)).split('\n');

  return readAgainstMachine(seams, (machine) => {
    const named = [...machine.holders.values()].flatMap((holder): Named[] => {
      const line = firstMention(lines, holder.name);
      return line === null
        ? []
        : [{ kind: holder.kind, name: holder.name, origin: { by: 'mentioned', line } }];
    });
    return Promise.resolve({ named, stacks: [], warnings: [] });
  });
}

/** Whether `need` is one `--missing` reports: missing, or not visible to a run. */
export function isUnmet(need: Need): boolean {
  if (need.status === 'missing') return true;
  return need.kind !== 'program' && !need.visibleToLoop;
}
