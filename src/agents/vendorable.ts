/**
 * The agents the plans of a project ask for that resolve only in
 * `~/.claude/agents`, and the warning `rafa init` writes about them.
 *
 * `start/preflight.ts` and `rafa plan validate` REFUSE on an `agent=`
 * no loaded scope defines, because a run that starts on one exits 1 at
 * the first dispatch with no JSON at all. `init` is earlier than both
 * and writes rather than dispatches, so it only warns: the project is
 * set up whatever its plans route to, exactly as the `PATH` check warns
 * and never refuses.
 *
 * The warning is narrower than the refusals on purpose. It names only a
 * missing agent {@link vendorFixCommand} answers for — one
 * `~/.claude/agents` defines under the same name, which under the
 * resolved `loop.settingSources` the run does not load, so
 * `rafa agent vendor <name>` would make it resolve. A name no user file
 * carries has no such fix, and `init` says nothing about it: it is a
 * typo or an agent yet to be written, and the preflight is where it is
 * refused with its lines.
 *
 * ## What is scanned
 *
 * Every `.md` directly under the config's `plan.dir`, resolved against
 * the root, sorted by file name, each read as the checklist `parsePlan`
 * reads. Subdirectories are not walked, since a plan is written at
 * `plan.dir` itself. A tracker beside a plan is an `.md` under the same
 * directory and is read the same way, which costs a duplicate name at
 * most: the warning lists one line per file and name.
 *
 * Nothing here throws. A `plan.dir` that does not exist, or a file that
 * cannot be read, contributes nothing, so `init` on a fresh project —
 * where `plan.dir` is a directory `init` itself is about to create —
 * warns about nothing.
 */
import type { ClaudeSettingSource } from '../config.js';

import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { missingPlanAgents, resolveAgentRoster, VENDOR_COMMAND } from './roster.js';

/** One plan file asking for one agent that only the home defines. */
export interface VendorableAgent {
  /** The plan file that asked, an absolute path. */
  readonly plan: string;
  /** The `agent=` name, exactly as the declaration carried it. */
  readonly name: string;
  /** The task lines that named it, counting from one, in order. */
  readonly lines: readonly number[];
  /** The command that would copy the home's definition into the project. */
  readonly fix: string;
}

/** What the scan reads; each path absolute. */
export interface VendorableScan {
  /** The project root, whose `.claude/agents` loads under `project`. */
  readonly repoRoot: string;
  /** The home, whose `.claude/agents` holds the definitions a fix would copy. */
  readonly home: string;
  /** The config's `plan.dir`, absolute or relative to the root. */
  readonly planDir: string;
  /** `loop.settingSources` as the config resolved it. */
  readonly settingSources: readonly ClaudeSettingSource[];
}

/** The `.md` files directly under `dir`, sorted, or none when it is unreadable. */
function planFiles(dir: string): readonly string[] {
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

/** A file's text, or null when nothing readable sits at `path`. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Every agent a plan under `plan.dir` asks for that the run would not
 * resolve and `rafa agent vendor` could fix, plan by plan and in the
 * order each named it; see the module note.
 */
export function vendorableAgents(scan: VendorableScan): readonly VendorableAgent[] {
  const dir = isAbsolute(scan.planDir)
    ? scan.planDir
    : join(scan.repoRoot, scan.planDir);
  const roster = resolveAgentRoster({ repoRoot: scan.repoRoot, home: scan.home }, scan.settingSources);
  const found: VendorableAgent[] = [];

  for (const file of planFiles(dir)) {
    const path = join(dir, file);
    const markdown = readText(path);
    if (markdown === null) continue;

    for (const missing of missingPlanAgents(markdown, roster)) {
      if (missing.fix === null) continue;
      found.push({ plan: path, name: missing.name, lines: missing.lines, fix: missing.fix });
    }
  }

  return found;
}

/** One line naming a plan, the agent it asked for and the command that would vendor it. */
export function vendorableAgentLine(agent: VendorableAgent, root: string): string {
  const shown = agent.plan.startsWith(`${root}/`)
    ? agent.plan.slice(root.length + 1)
    : agent.plan;
  const where = agent.lines.length === 1
    ? `line ${String(agent.lines[0])}`
    : `lines ${agent.lines.join(', ')}`;

  return `${shown} (${where}) routes to agent "${agent.name}", which resolves only in ~/.claude/agents:`
    + ` run \`${agent.fix}\``;
}

/**
 * The warning lines `init` writes for a scan's answer, the head line
 * naming `VENDOR_COMMAND` and one line per plan and name; none at all
 * when nothing is vendorable.
 */
export function vendorableAgentWarnings(
  agents: readonly VendorableAgent[],
  root: string,
): readonly string[] {
  if (agents.length === 0) return [];

  const head = `${String(agents.length)} agent use(s) under plan.dir resolve only in ~/.claude/agents,`
    + ` where a run does not load them; \`${VENDOR_COMMAND} <name>\` copies one into this project.`;
  return [head, ...agents.map((agent) => `  ${vendorableAgentLine(agent, root)}`)];
}
