/**
 * The MCP server configuration reader: every server declared in
 * `.mcp.json`, `~/.claude.json` and the settings files that switch them
 * off, and which one a loop session loads under a given
 * `loop.settingSources`.
 *
 * It answers "is an MCP server of this name configured, and would a run
 * start it", which `rafa plan needs` asks of every `mcp__<server>__…`
 * tool a plan declares. It starts no server and checks no command: a
 * declared server whose program is absent still reads as declared.
 *
 * ## The three scopes, as Claude Code 2.1.280 reads them
 *
 * Nothing here is taken from documentation. Every rule below was
 * measured on 2026-09-24 against the Claude Code {@link MCP_CLI_VERSION}
 * binary, under a scratch `HOME` holding no credentials. `claude mcp
 * get` gave the interactive readings. For the loop's own reading, `claude -p
 * --dangerously-skip-permissions --setting-sources …` was run against a
 * dead API endpoint, with a server whose command writes a marker file.
 * Each rule was read both ways (marker written and not written), so no
 * rule rests on a probe that could not fail.
 *
 *   - **Where each scope lives.** `project` is the `mcpServers` mapping
 *     of `.mcp.json` at the project root. `local` is the `mcpServers` of
 *     the project's own entry under `projects` in `~/.claude.json`,
 *     keyed by the root exactly as handed; a trusted PARENT entry was
 *     measured to count for nothing, so ancestors are not read. `user`
 *     is the top-level `mcpServers` of `~/.claude.json`.
 *   - **A scope loads only under its own setting source.** A `local`
 *     server started under `--setting-sources local` and not under
 *     `project` or `user`. A `project` server started under `project`
 *     and not under `user`. A `user` server started under `user` and not
 *     under `project`. So {@link McpScope} and `ClaudeSettingSource`
 *     are the same three words.
 *   - **Nearest first: `local`, `project`, `user`**
 *     ({@link MCP_SCOPES}). With one name in all three, `claude mcp get`
 *     answers the local one. With one name in `project` and `user`, it
 *     answers the project one only when that one is approved: a pending
 *     or rejected `.mcp.json` server does not hold its name, and the
 *     user one answers.
 *   - **`disabledMcpjsonServers` rejects a `.mcp.json` server**, and only
 *     one, from any of the three settings files: `.claude/settings.local.json`,
 *     `.claude/settings.json` and `~/.claude/settings.json`. A file
 *     counts only when its own setting source is on: a rejection in the
 *     user file stopped the server under `user,project,local` and not
 *     under `project` alone, and a rejection in the local file stopped it
 *     under `project,local` and not under `project` alone.
 *   - **`disabledMcpServers` disables a server of any scope for this
 *     project.** It sits in the project's entry in `~/.claude.json`, and
 *     it applied whatever the setting sources were: a `project` server
 *     it names did not start under `--setting-sources project`.
 *   - **Under `-p`, a pending `.mcp.json` server is approved.** Nothing
 *     approved it: no `enabledMcpjsonServers`, no
 *     `enableAllProjectMcpServers`, no trust. It started all the same,
 *     where `claude mcp get` read it `Pending approval`. The loop always
 *     runs `-p` (`CLAUDE_BASE_ARGS` in `utils/claude.ts`), so approval
 *     is not read here at all. An interactive session approves by
 *     `enabledMcpjsonServers` and `enableAllProjectMcpServers`, the local and
 *     project files counting only in a trusted workspace. That is
 *     measured but not modelled, and nothing here answers for an
 *     interactive session.
 *
 * Plugin servers, claude.ai connectors, managed (`managed-mcp.json`)
 * servers and `--mcp-config` are not read: the task this module serves
 * names the three files above, and the loop passes no `--mcp-config`.
 *
 * ## An unreadable file is a warning, never a gap
 *
 * As in `disabled.ts`, whose {@link readSettings} this reuses: an absent
 * file or key is no reading and no warning. A file that exists and does
 * not read, or holds a key of the wrong shape, is one {@link McpWarning}
 * and contributes nothing from that key. A single server entry that is not a
 * mapping, or a list item that is not a string, is a warning for that
 * entry alone and the rest still count. Claude Code refuses a whole
 * `.mcp.json` that does not parse (`[Failed to parse] Project config`),
 * which reads the same here. How it treats one malformed entry was not
 * measured, so skipping only that entry is this reader's choice.
 *
 * Nothing here throws, and nothing reads the real home unless it is
 * handed it: every path comes from {@link McpSeams}.
 */
import type { OverrideSeams } from './disabled.js';
import type { ClaudeSettingSource, Mapping } from '../config-sections.js';

import { join } from 'node:path';

import { describeValue, isMapping } from '../config-sections.js';

import { overrideSettingsPath, readSettings } from './disabled.js';

/** The Claude Code version the scope and switch rules were measured on. */
export const MCP_CLI_VERSION = '2.1.280';

/** The project file holding the `project` scope. */
export const MCP_JSON_FILE = '.mcp.json';

/** The home file holding the `user` and `local` scopes. */
export const CLAUDE_JSON_FILE = '.claude.json';

/** The key every scope holds its servers under. */
export const MCP_SERVERS_KEY = 'mcpServers';

/** The `~/.claude.json` key holding one entry per project. */
export const PROJECTS_KEY = 'projects';

/** The settings key that rejects a `.mcp.json` server. */
export const REJECT_KEY = 'disabledMcpjsonServers';

/** The project-entry key that disables a server of any scope. */
export const DISABLE_KEY = 'disabledMcpServers';

/** The scopes a server is declared in, nearest first. */
export const MCP_SCOPES: readonly ClaudeSettingSource[] = ['local', 'project', 'user'];

/** One MCP scope, which is also the setting source that loads it. */
export type McpScope = ClaudeSettingSource;

/** What the files are resolved against. */
export type McpSeams = OverrideSeams;

/** One server declaration, in one scope. */
export interface McpDeclaration {
  readonly name: string;
  readonly scope: McpScope;
  /** The file that declares it. */
  readonly path: string;
  /** Named by `disabledMcpServers` in the project's `~/.claude.json` entry. */
  readonly disabled: boolean;
  /**
   * The settings files whose `disabledMcpjsonServers` names it, nearest
   * first. Always empty outside the `project` scope.
   */
  readonly rejectedBy: readonly ClaudeSettingSource[];
}

/** One file, key or entry the reader could not use. */
export interface McpWarning {
  readonly path: string;
  /** Why, as one sentence fragment. */
  readonly reason: string;
}

/** Every declaration, nearest scope first and each file's own order within one. */
export interface McpReading {
  readonly servers: readonly McpDeclaration[];
  readonly warnings: readonly McpWarning[];
}

/** A key's value read as a list of strings; non-strings are one warning each. */
function readNames(
  holder: Mapping,
  key: string,
  path: string,
  warnings: McpWarning[],
): readonly string[] {
  if (!Object.hasOwn(holder, key)) return [];

  const raw = holder[key];
  if (!Array.isArray(raw)) {
    warnings.push({ path, reason: `has ${key} ${describeValue(raw)}, expected a list of names` });
    return [];
  }
  return raw.flatMap((item: unknown, index) => {
    if (typeof item === 'string') return [item];
    warnings.push({ path, reason: `${key}[${index}] is ${describeValue(item)}, expected a name` });
    return [];
  });
}

/** A value read as a mapping, or a warning when it is present and is not one. */
function readMapping(
  holder: Mapping,
  key: string,
  path: string,
  warnings: McpWarning[],
): Mapping | null {
  if (!Object.hasOwn(holder, key)) return null;

  const raw = holder[key];
  if (isMapping(raw)) return raw;
  warnings.push({ path, reason: `has ${key} ${describeValue(raw)}, expected a mapping` });
  return null;
}

/** A file's parsed mapping, or null with a warning pushed when it does not read. */
function readFile(path: string, warnings: McpWarning[]): Mapping | null {
  const read = readSettings(path);
  if (typeof read !== 'string') return read;
  warnings.push({ path, reason: read });
  return null;
}

/** The server names in one `mcpServers` holder, entries that are not mappings warned and left out. */
function serverNames(holder: Mapping | null, path: string, warnings: McpWarning[]): readonly string[] {
  if (holder === null) return [];

  const servers = readMapping(holder, MCP_SERVERS_KEY, path, warnings);
  if (servers === null) return [];
  return Object.entries(servers).flatMap(([name, entry]) => {
    if (isMapping(entry)) return [name];
    warnings.push({ path, reason: `${MCP_SERVERS_KEY} "${name}" is ${describeValue(entry)}, expected a mapping` });
    return [];
  });
}

/** The names each settings file rejects, keyed by its setting source. */
function readRejections(seams: McpSeams, warnings: McpWarning[]): ReadonlyMap<ClaudeSettingSource, readonly string[]> {
  const rejections = new Map<ClaudeSettingSource, readonly string[]>();
  for (const source of MCP_SCOPES) {
    const path = overrideSettingsPath(source, seams);
    const settings = path === null
      ? null
      : readFile(path, warnings);
    if (path !== null && settings !== null) rejections.set(source, readNames(settings, REJECT_KEY, path, warnings));
  }
  return rejections;
}

/**
 * Every MCP server declared for the project at `seams.projectRoot`, in
 * the `local`, `project` and `user` scopes, with its disabled and
 * rejected readings. With no project root, only `user` is read. See the
 * module note for what each file and key means.
 */
export function readMcpServers(seams: McpSeams): McpReading {
  const warnings: McpWarning[] = [];
  const claudeJsonPath = join(seams.home, CLAUDE_JSON_FILE);
  const claudeJson = readFile(claudeJsonPath, warnings);

  const projects = claudeJson === null
    ? null
    : readMapping(claudeJson, PROJECTS_KEY, claudeJsonPath, warnings);
  const root = seams.projectRoot;
  const projectEntry = projects === null || root === null || !Object.hasOwn(projects, root)
    ? null
    : readMapping(projects, root, claudeJsonPath, warnings);

  const mcpJsonPath = root === null
    ? null
    : join(root, MCP_JSON_FILE);
  const projectNames = mcpJsonPath === null
    ? []
    : serverNames(readFile(mcpJsonPath, warnings), mcpJsonPath, warnings);

  const held: Readonly<Record<McpScope, { readonly path: string | null; readonly names: readonly string[] }>> = {
    local: { path: claudeJsonPath, names: serverNames(projectEntry, claudeJsonPath, warnings) },
    project: { path: mcpJsonPath, names: projectNames },
    user: { path: claudeJsonPath, names: serverNames(claudeJson, claudeJsonPath, warnings) },
  };

  const disabled = projectEntry === null
    ? []
    : readNames(projectEntry, DISABLE_KEY, claudeJsonPath, warnings);
  const rejections = readRejections(seams, warnings);

  const servers = MCP_SCOPES.flatMap((scope) => {
    const { path, names } = held[scope];
    if (path === null) return [];
    return names.map((name): McpDeclaration => ({
      name,
      scope,
      path,
      disabled: disabled.includes(name),
      rejectedBy: scope === 'project'
        ? MCP_SCOPES.filter((source) => rejections.get(source)?.includes(name) === true)
        : [],
    }));
  });
  return { servers, warnings };
}

/** Every declaration of `name`, nearest scope first. */
export function mcpDeclarationsOf(reading: McpReading, name: string): readonly McpDeclaration[] {
  return reading.servers.filter((server) => server.name === name);
}

/**
 * Whether a `-p` session under `settingSources` starts `declaration`,
 * ignoring any nearer declaration of its name: its scope's source is
 * on, it is not disabled, and no settings file whose source is on
 * rejects it.
 */
export function isLoadedUnder(declaration: McpDeclaration, settingSources: readonly ClaudeSettingSource[]): boolean {
  if (!settingSources.includes(declaration.scope) || declaration.disabled) return false;
  return !declaration.rejectedBy.some((source) => settingSources.includes(source));
}

/**
 * The declaration of `name` a loop session under `settingSources` starts:
 * the nearest one {@link isLoadedUnder} those sources. Null when no session
 * of the loop would start a server of that name, whether none is declared
 * or every declaration is off. A nearer declaration that is not loaded
 * leaves the name to a farther one, as a rejected `.mcp.json` server was
 * measured to leave it to the user one.
 */
export function mcpServerFor(
  reading: McpReading,
  name: string,
  settingSources: readonly ClaudeSettingSource[],
): McpDeclaration | null {
  return mcpDeclarationsOf(reading, name).find((server) => isLoadedUnder(server, settingSources)) ?? null;
}
