/**
 * The served directory: the copies of the tier winners Claude Code would
 * not load by itself, and the session-only flags that hand them to one
 * loop session.
 *
 * `.rafa/specs/rafa-26-skill-tiers.md` ("Served, not vendored") has rafa
 * copy those winners into `.rafa/runs/<run>/served/` before each task or
 * wrap-up session, and never write under the project's `.claude/`.
 * {@link serveResolution} does the copying and answers the flags. Putting
 * the flags into `claudeArgs` and calling this before a session are the
 * spawning doors' work, not this module's: both the task door and the
 * wrap-up door call it through `start/serving.ts`.
 *
 * ## What is served
 *
 * A {@link Resolution} item in state `served` whose winner sits in the
 * rafa tier ({@link rafaWinners}). A project winner is one Claude Code
 * loads from the checkout by itself. A user winner exists only when
 * `loop.settingSources` holds `user`, and then Claude Code loads it by
 * itself too. So today the rafa tier is the only one served, as the
 * spec says. Only winners are copied, so a collision, an item switched
 * off and a name set aside by a pin never reach a session, and Claude
 * Code's own precedence between flags never decides anything.
 *
 * ## What is not served
 *
 * Each skipped winner is answered in {@link ServedSet.skipped} with one
 * {@link ServeSkipReason}, so a doctor row or a refusal can name it:
 *
 *   - `unreviewed`: a third-party `provenance` with no `reviewed`, the
 *     rule the spec's "Third-party sources" section sets for the rafa
 *     tier.
 *   - `invalid-provenance`: a `provenance` that `checkProvenance`
 *     refuses. Such a value cannot show the item was reviewed. A typo
 *     such as `review:` for `reviewed:` is exactly this case, so it is
 *     refused, not read as first-party. An item with no `provenance` at
 *     all is served: the bundled items' checker test is what requires
 *     one.
 *   - `unreadable`: a definition file that cannot be read, or has no
 *     frontmatter mapping to read `provenance` from.
 *   - `not-loadable`: a skill held as a loose file rather than a
 *     `<name>/SKILL.md` directory. Claude Code does not load one.
 *   - `invalid-definition`: an agent the `--agents` flag would refuse
 *     (below).
 *
 * ## The layout, by delivery
 *
 * Skills go by {@link SKILL_DELIVERY} (`src/tiers/delivery.ts`). Each
 * skill's whole directory is copied, supporting files included:
 *
 *   - `add-dir`: to `<served>/.claude/skills/<name>/`, handed over as
 *     `--add-dir <served>`. The probe found a bare `skills/` under an
 *     added directory is not loaded, so the `.claude/` layout is kept.
 *   - `plugin-dir`: to `<served>/skills/<name>/`, beside a
 *     `<served>/.claude-plugin/plugin.json` naming the plugin
 *     {@link SERVED_PLUGIN_NAME}, handed over as `--plugin-dir <served>`.
 *     Mapping between the bare name and `rafa:<name>` is not done here;
 *     it lives in `src/tiers/skill-names.ts`.
 *
 * Agents go through `--agents <json>` under either delivery, which keeps
 * their bare names. The probe measured that `--plugin-dir` would prefix
 * them. The JSON is written to `<served>/agents.json`
 * ({@link SERVED_AGENTS_FILE}) as the copy a session was given. It is
 * never placed where either delivery would load it a second time: not
 * `.claude/agents/`, not `agents/`.
 *
 * Copies are made with links followed, so the served tree holds no
 * link. A `self-update` during a run therefore cannot change what a
 * running session was given. Each call first removes the run's served
 * directory, so it holds exactly this resolution's winners and no
 * winner an earlier call served.
 *
 * ## The `--agents` value, measured
 *
 * Claude Code 2.1.280 (`SERVE_CLI_VERSION`) was probed on 2026-09-24 with
 * `claude -p --setting-sources project,local --agents '<json>' --agent
 * no-such-agent-zzz`. That call exits 1 before any model call and lists
 * the agents it could have run. Without `--agents`, no probe name was
 * listed: that is the control. With it:
 *
 *   - `description`, `prompt`, a `tools` list and `model` were listed.
 *   - `tools` as the comma string `"Read, Grep"` was refused with
 *     `zqprobe-b.tools: Invalid input`. Three bundled agents write it
 *     that way, so {@link agentDefinition} splits a string into a list.
 *   - Extra keys (`color`, `effort`, `provenance`) were listed, so every
 *     other frontmatter key is passed through unchanged.
 *   - An empty `prompt` or `description`, or none at all, was refused
 *     (`Prompt cannot be empty`, `Description cannot be empty`).
 *   - One refused entry refused the WHOLE value, taking the valid agent
 *     beside it down with it.
 *
 * That last reading is why each agent is checked on its own and skipped
 * as `invalid-definition` rather than passed through. The rules checked
 * are: a non-empty `description` string, a non-empty body, and `tools`
 * as a list of strings or a comma string. `name` becomes the entry's
 * key, and `provenance` is rafa's own, so neither is copied into the
 * entry.
 *
 * ## The flags
 *
 * {@link ServedSet.flags} is the skill flag, when a skill is served,
 * then `--agents <json>`, when an agent is. It is empty when nothing is
 * served. The CLI's help lists `--add-dir` as variadic, so the flags
 * must not be followed by a positional argument it would swallow;
 * `--agents` comes last because it takes exactly one value.
 */
import type { SkillDelivery } from './delivery.js';
import type { Resolution, ServedItem, TierRow } from './resolve.js';
import type { InventoryKind } from '../inventory/record.js';

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { isSessionId, runsDir } from '../loop/sessions.js';
import { readFrontmatterDocument } from '../schema/frontmatter.js';
import { checkProvenance, PROVENANCE_FIELD, readProvenance } from '../schema/provenance.js';

import { SKILL_DELIVERY } from './delivery.js';

/** The served directory's name under `.rafa/runs/<run>/`. */
export const SERVED_DIR = 'served';

/** The file under the served directory holding the `--agents` value. */
export const SERVED_AGENTS_FILE = 'agents.json';

/** The plugin name a `plugin-dir` delivery serves skills under. */
export const SERVED_PLUGIN_NAME = 'rafa';

/** The file a skill directory is loaded by. */
export const SKILL_FILE = 'SKILL.md';

/** Where served skills sit under the served directory, by delivery. */
export const SERVED_SKILLS_PATH: Readonly<Record<SkillDelivery, string>> = {
  'add-dir': join('.claude', 'skills'),
  'plugin-dir': 'skills',
};

/** The flag that hands the served directory over, by delivery. */
export const SKILL_DELIVERY_FLAG: Readonly<Record<SkillDelivery, string>> = {
  'add-dir': '--add-dir',
  'plugin-dir': '--plugin-dir',
};

/** Why a rafa-tier winner is not served. See "What is not served". */
export type ServeSkipReason =
  | 'unreviewed'
  | 'invalid-provenance'
  | 'unreadable'
  | 'not-loadable'
  | 'invalid-definition';

/** One winner copied into the served directory. */
export interface ServedCopy {
  readonly kind: InventoryKind;
  readonly name: string;
  /** The winner's definition file, in the rafa tier. */
  readonly from: string;
  /** Where the copy is: a skill's directory, or {@link SERVED_AGENTS_FILE}. */
  readonly to: string;
}

/** One winner left out, and why. */
export interface SkippedItem {
  readonly kind: InventoryKind;
  readonly name: string;
  /** The winner's definition file. */
  readonly path: string;
  readonly reason: ServeSkipReason;
  /** A sentence naming the item and the reason, printable unedited. */
  readonly message: string;
}

/** One entry of the `--agents` value: the fields the CLI requires, then the rest as written. */
export interface AgentDefinition {
  readonly description: string;
  readonly prompt: string;
  readonly [key: string]: unknown;
}

/** What {@link serveResolution} copied, left out and hands the session. */
export interface ServedSet {
  /** `.rafa/runs/<run>/served`, absolute. */
  readonly dir: string;
  readonly delivery: SkillDelivery;
  /** The skills copied, by name. */
  readonly skills: readonly ServedCopy[];
  /** The agents written into {@link SERVED_AGENTS_FILE}, by name. */
  readonly agents: readonly ServedCopy[];
  /** The rafa-tier winners left out, skills first, then by name. */
  readonly skipped: readonly SkippedItem[];
  /** The session-only flags; empty when nothing is served. See "The flags". */
  readonly flags: readonly string[];
}

/** Where {@link serveResolution} writes, and by which delivery. */
export interface ServeOptions {
  /** The project root, whose `.rafa/runs/` holds the run. */
  readonly root: string;
  /** The run's session id. */
  readonly run: string;
  /** The skill delivery; {@link SKILL_DELIVERY} when absent. */
  readonly delivery?: SkillDelivery;
}

/** A winner's verdict: served with what it carries, or left out and why. */
export type ServeVerdict<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ServeSkipReason; readonly why: string };

/** A frontmatter file split into its mapping and its body. */
interface ReadDefinition {
  readonly data: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/**
 * `<root>/.rafa/runs/<run>/served`. Throws on a run id `isSessionId`
 * refuses, so no id can name a path outside `.rafa/runs/`.
 */
export function servedDirectory(root: string, run: string): string {
  if (!isSessionId(run)) {
    throw new Error(`served directory: unusable run id ${JSON.stringify(run)}`);
  }
  return join(runsDir(root), run, SERVED_DIR);
}

/** The items of `resolution` served from the rafa tier, in resolution order. */
export function rafaWinners(resolution: Resolution): readonly ServedItem[] {
  return resolution.items.flatMap((item) => item.state === 'served' && item.winner.source === 'rafa'
    ? [item]
    : []);
}

/** Whether `data`'s `provenance` lets an item be served, or why it keeps it out. */
export function provenanceBlock(data: Readonly<Record<string, unknown>>): ServeVerdict<null> {
  if (checkProvenance(data).length > 0) {
    return { ok: false, reason: 'invalid-provenance', why: `its ${PROVENANCE_FIELD} does not pass the checker` };
  }
  const provenance = readProvenance(data);
  return provenance?.kind === 'third-party' && provenance.reviewed === null
    ? { ok: false, reason: 'unreviewed', why: `it is third-party from ${provenance.origin} with no reviewed` }
    : { ok: true, value: null };
}

/** `tools` as the list the CLI accepts, or null when it is neither a list of strings nor a string. */
function toolList(value: unknown): readonly string[] | null {
  if (typeof value === 'string') {
    return value.split(',').map((tool) => tool.trim())
      .filter((tool) => tool !== '');
  }
  return Array.isArray(value) && value.every((tool) => typeof tool === 'string')
    ? value
    : null;
}

/**
 * The `--agents` entry an agent definition makes, or why the CLI would
 * refuse it. See "The `--agents` value, measured".
 */
export function agentDefinition(data: Readonly<Record<string, unknown>>, body: string): ServeVerdict<AgentDefinition> {
  const description = data['description'];
  if (typeof description !== 'string' || description.trim() === '') {
    return { ok: false, reason: 'invalid-definition', why: 'it has no description' };
  }
  const prompt = body.trim();
  if (prompt === '') return { ok: false, reason: 'invalid-definition', why: 'its body is empty' };

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'name' && key !== PROVENANCE_FIELD) rest[key] = value;
  }
  if (Object.hasOwn(data, 'tools')) {
    const tools = toolList(data['tools']);
    if (tools === null) {
      return { ok: false, reason: 'invalid-definition', why: 'its tools are neither a list nor a comma string' };
    }
    rest['tools'] = tools;
  }
  return { ok: true, value: { ...rest, description, prompt } };
}

/** The frontmatter and body of `path`, or why they cannot be read. */
function readDefinition(path: string): ServeVerdict<ReadDefinition> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, reason: 'unreadable', why: 'its file cannot be read' };
  }
  const document = readFrontmatterDocument(text);
  return document === null
    ? { ok: false, reason: 'unreadable', why: 'it has no frontmatter mapping' }
    : { ok: true, value: { data: document.data, body: document.body } };
}

/** The skipped entry for `row`. */
function skipped(row: TierRow, reason: ServeSkipReason, why: string): SkippedItem {
  return {
    kind: row.kind,
    name: row.name,
    path: row.path,
    reason,
    message: `rafa-tier ${row.kind} ${row.name} is not served: ${why} (${row.path})`,
  };
}

/** Whether `row` may be served, with the frontmatter it was read by. */
function admit(row: TierRow): ServeVerdict<ReadDefinition> {
  if (row.kind === 'skill' && basename(row.path) !== SKILL_FILE) {
    return { ok: false, reason: 'not-loadable', why: `it is a loose file, not a <name>/${SKILL_FILE} directory` };
  }
  const read = readDefinition(row.path);
  if (!read.ok) return read;
  const block = provenanceBlock(read.value.data);
  return block.ok
    ? read
    : block;
}

/** Copies `row`'s skill directory to `<skills>/<name>`, links followed. */
function copySkill(row: TierRow, skills: string): ServedCopy {
  const to = join(skills, row.name);
  cpSync(dirname(row.path), to, { recursive: true, dereference: true });
  return { kind: 'skill', name: row.name, from: row.path, to };
}

/** Writes the plugin manifest a `plugin-dir` delivery needs. */
function writePluginManifest(dir: string): void {
  const manifestDir = join(dir, '.claude-plugin');
  mkdirSync(manifestDir, { recursive: true });
  const manifest = { name: SERVED_PLUGIN_NAME, description: 'rafa-tier skills served to one loop session' };
  writeFileSync(join(manifestDir, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The session flags for what was served. See "The flags". */
export function servedFlags(
  dir: string,
  delivery: SkillDelivery,
  skillCount: number,
  agents: Readonly<Record<string, AgentDefinition>>,
): readonly string[] {
  const skillFlag = skillCount > 0
    ? [SKILL_DELIVERY_FLAG[delivery], dir]
    : [];
  const agentFlag = Object.keys(agents).length > 0
    ? ['--agents', JSON.stringify(agents)]
    : [];
  return [...skillFlag, ...agentFlag];
}

/**
 * A rafa-tier winner's final verdict: a skill admitted, an agent with
 * its entry, or why it is left out. It reads the row's file and copies
 * nothing, so `buildInventory` (`inventory/index.ts`) asks it whether a
 * rafa row is being served, and the two can never disagree.
 */
export function serveVerdict(row: TierRow): ServeVerdict<AgentDefinition | null> {
  const read = admit(row);
  if (!read.ok) return read;
  return row.kind === 'skill'
    ? { ok: true, value: null }
    : agentDefinition(read.value.data, read.value.body);
}

/**
 * Copies the rafa-tier winners of `resolution` into the run's served
 * directory, replacing whatever an earlier call left there, and answers
 * what was copied, what was left out, and the flags handing it to a
 * session. See the module note.
 */
export function serveResolution(resolution: Resolution, options: ServeOptions): ServedSet {
  const delivery = options.delivery ?? SKILL_DELIVERY;
  const dir = servedDirectory(options.root, options.run);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const judged = rafaWinners(resolution).map((item) => ({ row: item.winner, verdict: serveVerdict(item.winner) }));
  const skillsDir = join(dir, SERVED_SKILLS_PATH[delivery]);
  const skills = judged.flatMap(({ row, verdict }) => verdict.ok && row.kind === 'skill'
    ? [copySkill(row, skillsDir)]
    : []);
  if (skills.length > 0 && delivery === 'plugin-dir') writePluginManifest(dir);

  const agentsFile = join(dir, SERVED_AGENTS_FILE);
  const admitted = judged.flatMap(({ row, verdict }) => verdict.ok && verdict.value !== null
    ? [{ row, definition: verdict.value }]
    : []);
  const agentMap: Record<string, AgentDefinition> = Object.fromEntries(admitted.map(({ row, definition }) => [row.name, definition]));
  if (admitted.length > 0) writeFileSync(agentsFile, `${JSON.stringify(agentMap, null, 2)}\n`);

  return {
    dir,
    delivery,
    skills,
    agents: admitted.map(({ row }) => ({ kind: 'agent', name: row.name, from: row.path, to: agentsFile })),
    skipped: judged.flatMap(({ row, verdict }) => verdict.ok
      ? []
      : [skipped(row, verdict.reason, verdict.why)]),
    flags: servedFlags(dir, delivery, skills.length, agentMap),
  };
}
