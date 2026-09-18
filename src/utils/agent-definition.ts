/**
 * Reading a routed agent's definition, for the one question the loop
 * asks of it: does it declare an effort of its own.
 *
 * A task declaring `agent=` is spawned with `--agent`, and the agent's
 * definition supplies its model and tool set, so
 * `resolveDeclarationFlags` never passes `--model` or `--tools` beside
 * it. A declared `effort=` joins `--agent` as `--effort` unless the
 * definition's frontmatter carries an `effort` of its own, and this
 * module is where that frontmatter is read: {@link agentEffortLookup}
 * builds the lookup `start/dispatch.ts` hands the resolver.
 *
 * ## Where a definition resolves
 *
 * `.claude/agents/<name>.md` under the repo root, then the same path
 * under the home directory when the run's setting sources include
 * `user`. A project file SHADOWS a user-level agent of the same name
 * rather than merging with it (`context/workflow.md`), so the first
 * file that answers is the only one read.
 *
 * The home is searched only under `user` because the CLI resolves a
 * name there only under `user`. Measured on Claude Code 2.1.268, an
 * `--agent` name no scope defines exits 1 before any model call and
 * lists the agents it could have run. Under `project,local`, the loop's
 * default, that list held this repo's definitions and none of
 * `~/.claude/agents`; under `user,project,local` it held both. A home
 * definition read under `project,local` would be one the CLI never
 * dispatches, and an effort it declared would keep `--effort` off a
 * session that then exits 1 on the name.
 *
 * The repo root is searched whatever the sources say, which is wider
 * than the CLI: under `local` alone the same list held no project
 * definition either. No session runs under a wrong effort for it, since
 * a name missing from that list is refused the same way.
 *
 * A file answers only when its frontmatter `name` is the name asked
 * for, because that `name` is what the CLI resolves `--agent` by.
 * Measured on Claude Code 2.1.268 under `--setting-sources
 * project,local`: a project `file-name.md` carrying `name: other-name`
 * exited 1 on `--agent file-name` with `--agent 'file-name' not found`
 * and answered `--agent other-name`, and a `nameless.md` with no `name`
 * key exited 1 on `--agent nameless` the same way. So a file whose name
 * disagrees, or which carries none, is passed over and the search goes
 * on. The converse is NOT searched for: a definition carrying the name
 * under some other file name is one the CLI would run and this module
 * never opens, so its effort reads as undeclared.
 *
 * ## Reading the frontmatter
 *
 * `schema/frontmatter.ts` reads it, and this module re-exports {@link
 * readFrontmatter} for the callers that reached for it here before the
 * schema existed. The block opens with a `---` first line and closes
 * at the next `---` line, and its body is parsed with `Bun.YAML`, as
 * `config.ts` parses the loop's config. A body that parser refuses, or
 * one that is not a mapping, reads as no frontmatter at all, and its
 * file is passed over like one naming another agent. That is stricter
 * than the CLI: `description: Probe: answers one literal` throws in
 * `Bun.YAML`, and the CLI dispatched a definition carrying exactly
 * that line.
 *
 * ## What counts as declaring an effort
 *
 * An `effort` key holding anything but `null` or the empty string. The
 * value is NOT checked against the levels `--effort` accepts, because
 * nothing the CLI prints says whether it honours a frontmatter level:
 * measured, `--effort medum` beside `--agent` wrote `Unknown --effort
 * value 'medum'` to stderr, the same `medum` in the definition's
 * frontmatter wrote nothing, and the session log recorded
 * `perTurnEffort: null` for both. A definition that says anything about
 * effort is taken at its word.
 *
 * Nothing here throws. A path with no readable file behind it (absent,
 * a directory, unreadable) holds no definition, and a name no file
 * answers for reads as declaring no effort, so the resolver still
 * passes `--effort` and the CLI is left to refuse the name.
 */
import type { AgentEffortLookup } from './declaration.js';
import type { ClaudeSettingSource } from '../config.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readFrontmatter } from '../schema/frontmatter.js';

import { isAgentName } from './declaration.js';

export { readFrontmatter };

/** Where definitions live under either root. */
export const AGENT_DEFINITION_DIR = join('.claude', 'agents');

/** Which root a definition resolved under. */
export type AgentDefinitionScope = 'project' | 'user';

/** The two roots a definition resolves under. */
export interface AgentDefinitionRoots {
  /** The repo root, searched first. */
  readonly repoRoot: string;
  /**
   * The home directory, searched when the repo holds no answer and the
   * setting sources include `user`.
   */
  readonly home: string;
}

/** One place a definition may be. */
export interface AgentDefinitionCandidate {
  readonly scope: AgentDefinitionScope;
  readonly path: string;
}

/** A definition the CLI would dispatch under the name it was asked for. */
export interface AgentDefinition {
  /** The name asked for, which the frontmatter's `name` equals. */
  readonly name: string;
  /** The root it resolved under. */
  readonly scope: AgentDefinitionScope;
  /** The file it was read from. */
  readonly path: string;
  /** Its frontmatter, as `Bun.YAML` parsed the block. */
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

/**
 * The paths a definition named `name` is looked for at, in search
 * order: the repo root's, then the home's when `settingSources`
 * includes `user`. None for a name that is not a bare file stem, so no
 * name can reach a file outside either `.claude/agents/`.
 */
export function agentDefinitionCandidates(
  name: string,
  roots: AgentDefinitionRoots,
  settingSources: readonly ClaudeSettingSource[],
): readonly AgentDefinitionCandidate[] {
  if (!isAgentName(name)) return [];

  const file = `${name}.md`;
  const project: AgentDefinitionCandidate = {
    scope: 'project',
    path: join(roots.repoRoot, AGENT_DEFINITION_DIR, file),
  };
  if (!settingSources.includes('user')) return [project];

  return [project, { scope: 'user', path: join(roots.home, AGENT_DEFINITION_DIR, file) }];
}

/** A file's text, or null when no readable file sits at `path`. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The definition `--agent <name>` would dispatch: the first candidate
 * whose frontmatter names `name`, or null when no root `settingSources`
 * lets this module search holds one.
 */
export function findAgentDefinition(
  name: string,
  roots: AgentDefinitionRoots,
  settingSources: readonly ClaudeSettingSource[],
): AgentDefinition | null {
  for (const candidate of agentDefinitionCandidates(name, roots, settingSources)) {
    const text = readText(candidate.path);
    if (text === null) continue;

    const frontmatter = readFrontmatter(text);
    if (frontmatter === null || frontmatter['name'] !== name) continue;

    return { name, scope: candidate.scope, path: candidate.path, frontmatter };
  }

  return null;
}

/** True when `definition` exists and its frontmatter carries an effort. */
export function declaresEffort(definition: AgentDefinition | null): boolean {
  if (definition === null) return false;

  const effort = definition.frontmatter['effort'];
  return effort !== undefined && effort !== null && effort !== '';
}

/**
 * The lookup the resolver asks whether a named agent's definition
 * declares an effort of its own, reading definitions under `roots`, the
 * home only when `settingSources` includes `user`. Each answer reads the
 * disk afresh, so a definition edited mid-run is read as it stands at
 * the next dispatch.
 */
export function agentEffortLookup(
  roots: AgentDefinitionRoots,
  settingSources: readonly ClaudeSettingSource[],
): AgentEffortLookup {
  return (agent) => declaresEffort(findAgentDefinition(agent, roots, settingSources));
}
