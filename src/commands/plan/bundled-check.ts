/**
 * The bundled-item reading over one plan file: which agents and skills
 * rafa bundles the plan's still-to-run tasks edit, and the tier pin each
 * one needs (`.rafa/specs/rafa-1101-spec-plan-validate-names.md`).
 *
 * In this repository `.claude/agents/<x>.md` and `.claude/skills/<x>`
 * are links into `src/bundled/agents/` and `src/bundled/skills/`, so a
 * task that edits a bundled item edits the project copy too. Once the
 * branch merges, every clone holds a project copy that differs from the
 * installed rafa's, and the next `rafa loop start` there refuses the
 * collision until the tier is pinned. The pin each edit answers is the
 * one that settles it.
 *
 * ## What is read
 *
 * {@link findBundledEdits} reads the code spans of every task line still
 * to run, unticked or blocked, the lines a `rafa:*` block the plan never
 * closed hides included, as `packages/rafa-run/src/plan/store-rules.ts` reads them: a
 * ticked task will not run again. A span holding no whitespace is read
 * as a path against `repoRoot`, and its links are resolved with
 * `realpathSync`, so `.claude/agents/doc-updater.md` and
 * `.claude/skills/dev-planner` name the bundled items they link to,
 * while a plain file under `.claude/agents/` resolves to itself and
 * names nothing. A path nothing sits at names nothing, a dangling link
 * included: a task that creates an item adds one the installed rafa
 * does not hold, so no copy differs. A placeholder, a glob or a path
 * under `~` is no path on disk and names nothing either.
 *
 * The roots are `src/` joined with `BUNDLED_AGENTS_DIR` and
 * `BUNDLED_SKILLS_DIR`, the checkout's own bundle. A resolved path
 * names:
 *
 * - every item of a root, when it IS that root: a root named whole is an
 *   edit of every item in it;
 * - the agent whose definition file it is, the agent named by the
 *   frontmatter `name` `readAgentDirectory` keys it by, which is the
 *   name a pin takes;
 * - the skill whose folder holds it, a `SKILL.md` deep in that folder or
 *   the folder itself, when that folder holds a `SKILL_FILE`.
 *
 * Anything else under a root, a file there no reader loads, names
 * nothing.
 *
 * ## What it answers
 *
 * One {@link BundledEdit} per item, in the order the plan first names
 * them, the items of a root named whole sorted by name: its kind and
 * name, the path as the first span naming it typed it, every line that
 * names it, and the pin `pinLine` (`packages/rafa-inventory/src/tiers/resolve.ts`) writes for it
 * at the `project` tier, so the line is the one `doctor` and the
 * preflight refusal already name. An item named on two lines is one
 * edit holding both.
 *
 * The reading is pure but for the disk it reads under `repoRoot`; the
 * plan's text is the caller's. It refuses nothing: editing a bundled
 * item is legitimate work, so a caller prints a note and writes the pin
 * as a `[human]` prerequisite.
 *
 * ## What it writes
 *
 * {@link writeTierPins} writes those pins into the plan's
 * `PREREQUISITES-<stub>.md`, one `[human]` item per edit under
 * `## Tier pins [human]`, each naming the item, the plan, the removal
 * condition and, as the span that ends it, the pin. The file is created
 * with its `# Prerequisites` heading when absent, the section added at
 * its end when missing, and every other line is left as it was. An item
 * whose pin span the file already holds is skipped, so a second run
 * writes no second copy. `parsePrerequisites` reads each item as `human`,
 * with no probe: the pin is a line a person sets, never a check.
 *
 * ## Who calls it
 *
 * `rafa plan validate` (`./validate.ts`) reads the edits over the
 * project it was handed, prints one {@link bundledEditLine} per edit as a
 * note and, when nothing refuses the plan, writes the pins.
 *
 * `rafa plan create` (`src/plan.ts`) calls {@link notePlanBundledEdits}
 * straight after `enforceStoreRules` (`./store-check.ts`), so a plan the
 * store rules refuse was moved away and is read no further. It reads the
 * plan the planner answered, against the root `plan create` runs in,
 * prints one note per edit and writes the pins into the prerequisites
 * file the planner answered, or into the `PREREQUISITES-<stub>.md`
 * `prerequisitesPathForPlan` derives beside the plan when the planner
 * wrote none. A plan that is not on disk is not read, for the reason
 * `./store-check.ts` gives: the fixture planner `src/plan.test.ts`
 * resolves answers a path it never writes. A pin that cannot be written
 * is warned about and refuses nothing, as no edit does.
 */
import type { PlanTask } from '@open-tomato/rafa/core/plan';
import type { GeneratedPlan, Output } from '@open-tomato/rafa/ports';
import type { InventoryKind } from '@open-tomato/rafa-inventory';

import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  BUNDLED_AGENTS_DIR,
  SKILL_FILE,
  pinLine,
  readAgentDirectory,
} from '@open-tomato/rafa-inventory';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { isFile, parsePlan } from '@open-tomato/rafa/core/plan';
import { prerequisitesPathForPlan } from '@open-tomato/rafa/preflight/prerequisites-md';
import { BUNDLED_SKILLS_DIR } from '@open-tomato/rafa/schema/tiers';

/** The folder of the checkout the bundled roots sit in. */
const SOURCE_DIR = 'src';

/** A code span, read as the readiness gate reads one. */
const CODE_SPAN = /`([^`]+)`/gu;

/** A span that can be a path: no whitespace in it. */
const PATH_LIKE = /^\S+$/u;

/** One bundled item a plan's still-to-run tasks edit, and the pin it needs. */
export interface BundledEdit {
  readonly kind: InventoryKind;
  /** The name the item is held under: an agent's frontmatter `name`, a skill's folder. */
  readonly name: string;
  /** The path as the first span naming the item typed it. */
  readonly path: string;
  /** Every plan line naming it, counting from one, ascending. */
  readonly lines: readonly number[];
  /** The config line pinning it to the project tier, as `pinLine` writes it. */
  readonly pinLine: string;
}

/** Where the bundled roots are read from. */
export interface BundledSeams {
  /** The checkout whose `src/bundled/` roots and `.claude/` links are read. */
  readonly repoRoot: string;
}

/** One item a path names. */
interface NamedItem {
  readonly kind: InventoryKind;
  readonly name: string;
}

/** One bundled agent: its name and its definition file, links resolved. */
interface BundledAgent {
  readonly name: string;
  readonly realPath: string;
}

/** The checkout's bundled roots and what they hold. */
interface Bundle {
  /** The agents root, links resolved, or null when it is not there. */
  readonly agentsRoot: string | null;
  /** The skills root, links resolved, or null when it is not there. */
  readonly skillsRoot: string | null;
  /** Its agents, sorted by name. */
  readonly agents: readonly BundledAgent[];
  /** Its skill names, sorted. */
  readonly skills: readonly string[];
}

/** `path` with every link resolved, or null when nothing sits there. */
function realPathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** True when a file sits at `path`, following links. */
function isFilePath(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

/** The agents under `root`, keyed as the roster keys them. */
function bundledAgents(root: string | null): readonly BundledAgent[] {
  if (root === null) return [];
  return readAgentDirectory(root).flatMap((definition) => {
    const realPath = realPathOrNull(definition.path);
    return realPath === null
      ? []
      : [{ name: definition.name, realPath }];
  });
}

/** The folders under `root` holding a {@link SKILL_FILE}, sorted. */
function bundledSkills(root: string | null): readonly string[] {
  if (root === null) return [];
  return readdirSync(root)
    .filter((name) => isFilePath(join(root, name, SKILL_FILE)))
    .sort((a, b) => a.localeCompare(b));
}

/** The bundle of the checkout at `repoRoot`. */
function readBundle(repoRoot: string): Bundle {
  const agentsRoot = realPathOrNull(join(repoRoot, SOURCE_DIR, BUNDLED_AGENTS_DIR));
  const skillsRoot = realPathOrNull(join(repoRoot, SOURCE_DIR, BUNDLED_SKILLS_DIR));
  return { agentsRoot, skillsRoot, agents: bundledAgents(agentsRoot), skills: bundledSkills(skillsRoot) };
}

/** The skill whose folder under the skills root holds `realPath`, or null. */
function skillHolding(bundle: Bundle, realPath: string): string | null {
  if (bundle.skillsRoot === null) return null;
  const inside = relative(bundle.skillsRoot, realPath);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;
  const name = inside.split(sep)[0] ?? '';
  return bundle.skills.includes(name)
    ? name
    : null;
}

/** The bundled items the resolved path `realPath` names; see the module note. */
function itemsAt(bundle: Bundle, realPath: string): readonly NamedItem[] {
  if (realPath === bundle.agentsRoot) return bundle.agents.map(({ name }) => ({ kind: 'agent', name }));
  if (realPath === bundle.skillsRoot) return bundle.skills.map((name) => ({ kind: 'skill', name }));

  const agents = bundle.agents
    .filter((agent) => agent.realPath === realPath)
    .map(({ name }): NamedItem => ({ kind: 'agent', name }));
  const skill = skillHolding(bundle, realPath);
  return skill === null
    ? agents
    : [...agents, { kind: 'skill', name: skill }];
}

/** The still-to-run task lines of `markdown`, hidden ones included, in line order. */
function stillToRun(markdown: string): readonly PlanTask[] {
  const model = parsePlan(markdown);
  return [...model.tasks, ...model.hiddenTasks]
    .filter((task) => task.status !== 'done')
    .sort((a, b) => a.lineNum - b.lineNum);
}

/** The path-like code spans of `text`, as typed. */
function pathSpans(text: string): readonly string[] {
  return [...text.matchAll(CODE_SPAN)]
    .map((match) => (match[1] ?? '').trim())
    .filter((span) => PATH_LIKE.test(span));
}

/** One edit as it is gathered, before its pin is written. */
interface Gathered {
  readonly item: NamedItem;
  readonly path: string;
  readonly lines: number[];
}

/**
 * The bundled items the still-to-run tasks of `markdown` edit, one
 * {@link BundledEdit} per item, read against the bundle under
 * `seams.repoRoot`; none for a plan naming none. See the module note.
 */
export function findBundledEdits(markdown: string, seams: BundledSeams): readonly BundledEdit[] {
  const bundle = readBundle(seams.repoRoot);
  const gathered = new Map<string, Gathered>();

  for (const task of stillToRun(markdown)) {
    const line = task.lineNum + 1;
    for (const span of pathSpans(task.text)) {
      const realPath = realPathOrNull(resolve(seams.repoRoot, span));
      if (realPath === null) continue;

      for (const item of itemsAt(bundle, realPath)) {
        const key = `${item.kind}:${item.name}`;
        const found = gathered.get(key);
        if (found === undefined) gathered.set(key, { item, path: span, lines: [line] });
        else if (!found.lines.includes(line)) found.lines.push(line);
      }
    }
  }

  return [...gathered.values()].map(({ item, path, lines }) => ({
    kind: item.kind,
    name: item.name,
    path,
    lines: [...lines],
    pinLine: pinLine(item.kind, item.name, 'project'),
  }));
}

/**
 * The note naming one edit: the plan file as `file` spells it, the lines
 * naming the item, the item, the path as typed, and the pin each clone
 * that merges the plan needs. A caller adds what became of the pin.
 */
export function bundledEditLine(file: string, edit: BundledEdit): string {
  return `${file}:${edit.lines.join(',')}: a task edits the bundled ${edit.kind} \`${edit.name}\` (\`${edit.path}\`);`
    + ` each clone that merges it needs the pin \`${edit.pinLine}\``;
}

/** The heading lines a prerequisites file this module creates opens with. */
const PREREQUISITES_HEADING = '# Prerequisites';

/** The section the pins are written under, a `[human]` one. */
export const TIER_PINS_HEADING = '## Tier pins [human]';

/** {@link TIER_PINS_HEADING} as a line of a file, any case and trailing space. */
const TIER_PINS_HEADING_RE = /^##\s+Tier pins \[human\]\s*$/iu;

/** Any markdown heading line. */
const HEADING_RE = /^#/u;

/**
 * The prerequisite item pinning `edit`: a `[human]` reminder naming the
 * item, the plan whose tasks edit it, the removal condition, and the pin
 * as the span that ends it.
 */
export function tierPinItem(edit: BundledEdit, planFileName: string): string {
  return `- [ ] Pin the bundled ${edit.kind} \`${edit.name}\` to the project tier in each clone that merges`
    + ` \`${planFileName}\`, and drop the pin once the installed rafa carries the new text: \`${edit.pinLine}\``;
}

/** The text of the file at `path`, or null when nothing is there. */
function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const isAbsent = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
    if (isAbsent) return null;
    throw error;
  }
}

/** `lines` with `items` written at the end of the {@link TIER_PINS_HEADING} section, which it gains when missing. */
function withItems(lines: readonly string[], items: readonly string[]): readonly string[] {
  const heading = lines.findIndex((line) => TIER_PINS_HEADING_RE.test(line));
  if (heading === -1) {
    const body = [...lines];
    while (body.length > 0 && body.at(-1)?.trim() === '') body.pop();
    return [...body, '', TIER_PINS_HEADING, ...items];
  }

  const next = lines.findIndex((line, index) => index > heading && HEADING_RE.test(line));
  let end = next === -1
    ? lines.length
    : next;
  while (end > heading + 1 && lines[end - 1]?.trim() === '') end -= 1;
  return [...lines.slice(0, end), ...items, ...lines.slice(end)];
}

/**
 * Writes one `[human]` prerequisite per edit into the prerequisites file
 * at `prerequisitesPath`, under {@link TIER_PINS_HEADING}, and answers
 * the edits it wrote an item for.
 *
 * The file is created with its `# Prerequisites` heading when absent, and
 * the section is added at its end when missing; every other line is kept
 * as it was, an `[auto]` section included. An edit whose pin span, the
 * backticked `pinLine`, the file already holds anywhere is skipped, so a
 * second call over the same edits writes nothing and leaves the file
 * byte for byte. No edits to write writes nothing, and creates no file.
 * `planFileName` is the plan's file name, which each item names.
 */
export function writeTierPins(
  prerequisitesPath: string,
  planFileName: string,
  edits: readonly BundledEdit[],
): readonly BundledEdit[] {
  const existing = readOrNull(prerequisitesPath);
  const written: BundledEdit[] = [];
  const items: string[] = [];
  for (const edit of edits) {
    const span = `\`${edit.pinLine}\``;
    if (existing?.includes(span) === true || items.some((item) => item.includes(span))) continue;
    written.push(edit);
    items.push(tierPinItem(edit, planFileName));
  }
  if (items.length === 0) return [];

  const lines = existing === null
    ? [PREREQUISITES_HEADING]
    : existing.replace(/\n$/u, '').split('\n');
  writeFileSync(prerequisitesPath, `${withItems(lines, items).join('\n')}\n`);
  return written;
}

/** What became of one edit's pin on `plan create`, as the tail of its note. */
function createPinTail(edit: BundledEdit, file: string | null, written: readonly BundledEdit[] | null): string {
  if (file === null) return 'not written, since a plan not named PLAN-<stub>.md has no PREREQUISITES file';
  if (written === null) return `not written to ${file}`;
  return written.includes(edit)
    ? `written to ${file} as a [human] prerequisite`
    : `already held by ${file}`;
}

/**
 * Notes the bundled agents and skills the plan `plan create` generated
 * edits, and writes their pins as `[human]` prerequisites; see the
 * module note. Paths are read against `repoRoot`. Answers `generated`,
 * its `prerequisitesPath` naming the file the pins went into when the
 * planner answered none and this call created one; `generated` as it
 * came for a plan not on disk, one naming no bundled item, and one whose
 * pins went nowhere new.
 */
export function notePlanBundledEdits(
  repoRoot: string,
  generated: GeneratedPlan,
  output: Output = activeOutput(),
): GeneratedPlan {
  const planFile = resolve(repoRoot, generated.planPath);
  if (!isFile(planFile)) return generated;
  const edits = findBundledEdits(readFileSync(planFile, 'utf8'), { repoRoot });
  if (edits.length === 0) return generated;

  const file = generated.prerequisitesPath ?? prerequisitesPathForPlan(generated.planPath);
  let written: readonly BundledEdit[] | null = [];
  if (file !== null) {
    try {
      written = writeTierPins(resolve(repoRoot, file), basename(generated.planPath), edits);
    } catch (error) {
      output.warn(`${file}: the tier pins could not be written: ${messageOf(error)}`);
      written = null;
    }
  }
  for (const edit of edits) {
    output.info(`ℹ️  ${bundledEditLine(generated.planPath, edit)}, ${createPinTail(edit, file, written)}.`);
  }
  return file !== null && generated.prerequisitesPath === null && isFile(resolve(repoRoot, file))
    ? { ...generated, prerequisitesPath: file }
    : generated;
}
