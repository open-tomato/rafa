/**
 * The `PREREQUISITES-<stub>.md` a plan emits, read into preflight items
 * for that plan alone.
 *
 * Copied from open-tomato's
 * `services/orchestrator/src/prerequisites/parser.ts` at commit
 * `e96fbb29e953d32705b4d39f737bf93dd4e0c099` (2026-04-21). `checker.ts`
 * beside it is not copied: it splits the probe on whitespace, closes no
 * stdin, sets no timeout, and answers a failure with a Claude fix attempt
 * and a human approval request. Running a probe is not this module's.
 *
 * ## How a file is read
 *
 * The source's rules, unchanged:
 *
 *   - An item is a line opening with `- [ ] `. A ticked `- [x]` or
 *     `- [X]` item and a `- [BLOCKED]` item are skipped, so a step the
 *     operator has done asks nothing of a run.
 *   - An item's tag is the `[auto]` or `[human]` written right after its
 *     box (`- [ ] [auto] Bun is installed`), else the tag of the section
 *     it sits in, else `human`.
 *   - A heading is a line opening with `#`. One carrying `[auto]` gives
 *     its section the tag `auto`; failing that, one carrying `[human]` or
 *     naming `manual`, `human`, `sign-off` or `team` gives it `human`.
 *     Both tests ignore case.
 *   - An `auto` item's probe is its first backticked span, trimmed. A
 *     `human` item has none, whatever it quotes. The copy reads the
 *     probe elsewhere; see below.
 *
 * ## What the copy changes
 *
 * Most are a file the source reads wrongly, and
 * `prerequisites-md.test.ts` holds each beside a control.
 *
 *   - **A heading ends the section above it at its own level.** The
 *     source kept the last tagged heading's tag until another tagged
 *     heading replaced it, so `## Operator steps after the plan merges`
 *     below `## Checks [auto]` read as `auto`, and its `npm publish`
 *     became a probe. Here a heading with no tag of its own takes the tag
 *     of the nearest heading above it at a shallower level, and `human`
 *     when there is none, so `### Bun` under `## Checks [auto]` is still
 *     `auto`.
 *   - **An item runs on over its indented lines.** A plan's file wraps
 *     an item at about seventy columns and often quotes its command on
 *     the second line, which the source, reading one line, never sees.
 *     A non-blank indented line below an item is part of it, joined with
 *     one space, unless it opens a list item or a fence of its own.
 *     `raw` and `lineIndex` still name the item's first line.
 *   - **Fenced code is not read.** A `- [ ]` line in an example is no
 *     item, and a `# install manually` comment in a shell block is no
 *     heading: the source read it as one, and every item below it as
 *     `human`.
 *   - **A probe is the span that ENDS the item, after its final `: `.**
 *     The item is written `<description>: \`<command>\``, and the probe
 *     is that last span, trimmed. The source took the FIRST span, so an
 *     item quoting a name ahead of its command ran the name: a package,
 *     `@open-tomato/define-config`, which exited 127, or a command that
 *     is on `PATH` and wants arguments, `uvx check-jsonschema`, which
 *     exited 2 (#140). A `: ` inside the span is the command's own. An
 *     `auto` or `start` item that does not end so — the command first,
 *     text after the span, no span at all — is MALFORMED: its probe is
 *     null, nothing is run for it, and it lands on
 *     {@link PlanPrerequisites.malformed}, named by its line, for a
 *     caller to refuse the run with ({@link malformedPrerequisiteLines}).
 *     Guessing which span is the command is what #140 was, so none is
 *     guessed.
 *   - **The names follow this package.** The source's `PrerequisiteItem`
 *     is {@link MarkdownPrerequisite}, the config already naming its own
 *     item `PrerequisiteItem`, and `probeCommand?: string` is
 *     `probe: string | null`, the spelling that item uses. A span holding
 *     only whitespace is no probe.
 *   - **A `[start]` item is probed on a plan's first dispatch alone.** An
 *     item naming the state a run begins from — the sibling checkout
 *     holding no uncommitted change, say — is true before the first
 *     dispatch and false on every resume, because the run itself changed
 *     that state. The source has no spelling for it: every probed item is
 *     probed on every dispatch, so such an item halts the resume it was
 *     written to guard. Here `[start]` is a third tag, written after an
 *     item's box or on a heading exactly as `[auto]` is, whose probed
 *     items land on {@link PlanPrerequisites.startRequired} rather than
 *     `required`, for a caller that probes that list on a first dispatch
 *     and skips it on a resume. Running them, and deciding which dispatch
 *     this is, is no more this module's than running a probe is. Only the
 *     bracketed `[start]` reads as the tag: a heading merely NAMING a
 *     start, a `## Starting position` among a plan's sections, keeps the
 *     tag it would have had, since a fuzzy match there would quietly move
 *     items off the tier that halts a run. `[auto]` is still tested
 *     first, so a heading carrying both reads `auto`, the tier probed
 *     every time.
 *
 * ## What an item becomes
 *
 * {@link planPrerequisites} maps the file onto the config's shapes
 * (`config-sections.ts`):
 *
 *   - An `auto` item with a probe is a REQUIRED item, the tier whose
 *     failure halts a run. Its `name` is the item's description and its
 *     `kind` is `tool`, the kind whose probe is a command. Every such item
 *     carries its probe, so its kind names nothing a check needs.
 *   - A `start` item with a probe is a REQUIRED item too, held on
 *     {@link PlanPrerequisites.startRequired} instead, the tier a caller
 *     probes on a first dispatch and skips on a resume.
 *   - A `human` item is a {@link PrerequisiteReminder}: a line to print,
 *     held in neither tier, so it cannot halt a run. Plans carry unticked
 *     steps for after the merge, and those must not stop one.
 *   - An `auto` or `start` item with no probe is a
 *     {@link MalformedPrerequisite}, in neither tier and not a reminder:
 *     it asked for a check and names none, so a caller refuses the run
 *     before any probe rather than let a required check go unmade. With
 *     nothing to run the source's checker asked a human.
 *
 * Nothing becomes an OPTIONAL item: the markdown has no spelling for one.
 *
 * ## One plan only
 *
 * {@link mergePlanPrerequisites} answers a new set: the config's required
 * items followed by the plan's, the config's optional items, and the
 * plan's start-only items, reminders and malformed items. The config has
 * no spelling for any of those three, so each list is the plan's alone. The settings handed
 * in are never written to, so a merge for one plan leaves nothing behind
 * for the next.
 *
 * {@link prerequisitesPathForPlan} names the file a plan's merge reads,
 * `PREREQUISITES-<stub>.md` beside `PLAN-<stub>.md`, where
 * `rafa plan create` writes both. A plan not named `PLAN-<stub>.md`, a
 * hand-written `PLAN.md` among them, has no such file.
 * {@link loadPlanPrerequisites} reads it and merges. Nothing at that path
 * merges nothing, and anything there that cannot be read is refused:
 * `Bun.file(path).exists()` answers false for a directory (measured on
 * bun 1.3.14), so the read is attempted and `ENOENT` alone is read as
 * absent.
 */
import type {
  OptionalPrerequisiteItem,
  PrerequisiteItem,
  RafaConfig,
} from '../config.js';

import { basename, dirname, join } from 'node:path';

import { messageOf } from '../config-sections.js';

/**
 * How a PREREQUISITES item is checked: by its probe on every dispatch, by
 * its probe on a plan's first dispatch alone, or by a human.
 */
export type PrerequisiteTag = 'auto' | 'human' | 'start';

/** One unticked item of a PREREQUISITES file; see the module note. */
export interface MarkdownPrerequisite {
  /** The item's first line, as written. */
  raw: string;
  /** The item's text: its box and tag dropped, its lines joined. */
  description: string;
  /** Its own tag, else its section's, else `human`. */
  tag: PrerequisiteTag;
  /** Where its first line sits, counted from 0. */
  lineIndex: number;
  /**
   * A probed item's command: the backticked span ending it after its
   * final `: `, trimmed. Null for a `human` item, and for a probed one
   * not ending so, which is malformed.
   */
  probe: string | null;
}

/** An item a run names and never checks; see the module note. */
export interface PrerequisiteReminder {
  /** The item's text, as {@link MarkdownPrerequisite.description}. */
  description: string;
  /** Always `human`: a probed item with no probe is malformed instead. */
  tag: PrerequisiteTag;
  /** Where the item's first line sits, counted from 1 as `grep -n` does. */
  line: number;
}

/**
 * An `auto` or `start` item with no command where one belongs, which a
 * run refuses rather than guess at; see the module note.
 */
export interface MalformedPrerequisite {
  /** The item's text, as {@link MarkdownPrerequisite.description}. */
  description: string;
  /** `auto` or `start`: the tag that asked for a probe. */
  tag: PrerequisiteTag;
  /** Where the item's first line sits, counted from 1 as `grep -n` does. */
  line: number;
}

/** What one PREREQUISITES file adds to a run. */
export interface PlanPrerequisites {
  /** Its `auto` items that carry a probe, as required items. */
  required: readonly PrerequisiteItem[];
  /** Its `start` items that carry a probe; see the module note. */
  startRequired: readonly PrerequisiteItem[];
  /** Its `human` items. */
  reminders: readonly PrerequisiteReminder[];
  /** Its `auto` and `start` items that carry no probe. */
  malformed: readonly MalformedPrerequisite[];
}

/** The items a preflight checks for one plan, and the ones it only names. */
export interface PreflightItems extends PlanPrerequisites {
  /** The config's optional items. */
  optional: readonly OptionalPrerequisiteItem[];
}

/** The two settings a merge reads, as the config resolves them. */
export type PrerequisiteSettings = Pick<
  RafaConfig,
  'prerequisitesRequired' | 'prerequisitesOptional'
>;

/** The tags of the headings a line sits under, one per level from 1. */
type HeadingScope = readonly (PrerequisiteTag | null)[];

const SECTION_AUTO_RE = /\[auto\]/i;
const SECTION_START_RE = /\[start\]/i;
const SECTION_HUMAN_RE = /\[human\]|manual|human|sign.?off|team/i;

const ITEM_RE = /^-\s+\[\s*\]\s+/;
const INLINE_AUTO_RE = /^-\s+\[\s*\]\s+\[auto\]\s+/i;
const INLINE_HUMAN_RE = /^-\s+\[\s*\]\s+\[human\]\s+/i;
const INLINE_START_RE = /^-\s+\[\s*\]\s+\[start\]\s+/i;
const PROBE_RE = /:\s+`([^`]+)`\s*$/;

const HEADING_MARKS_RE = /^#+/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const NESTED_LIST_ITEM_RE = /^\s+(?:[-*+]|\d+[.)])\s/;
const PLAN_FILE_RE = /^PLAN-(.+)\.md$/;

/** The tag a heading gives its section, or null when it names none. */
function inferSectionTag(header: string): PrerequisiteTag | null {
  if (SECTION_AUTO_RE.test(header)) return 'auto';
  if (SECTION_START_RE.test(header)) return 'start';
  if (SECTION_HUMAN_RE.test(header)) return 'human';
  return null;
}

/**
 * The scope below `header`: the headings at shallower levels kept, its
 * own level set to its tag, every deeper level ended.
 */
function enterHeading(scope: HeadingScope, header: string): HeadingScope {
  const level = HEADING_MARKS_RE.exec(header)?.[0].length ?? 1;
  const above = Array.from({ length: level - 1 }, (_, index) => scope[index] ?? null);
  return [...above, inferSectionTag(header)];
}

/** The tag of the deepest heading in `scope` that names one, else `human`. */
function sectionDefault(scope: HeadingScope): PrerequisiteTag {
  for (let index = scope.length - 1; index >= 0; index -= 1) {
    const tag = scope[index];
    if (tag) return tag;
  }
  return 'human';
}

/** The run of backticks or tildes a line opens a fence with, or null. */
function fenceOf(line: string): string | null {
  return FENCE_RE.exec(line)?.[1] ?? null;
}

/** True when `marker` closes the fence `opened` opened. */
function closesFence(opened: string, marker: string | null): boolean {
  return marker !== null && marker[0] === opened[0] && marker.length >= opened.length;
}

/** True when `line` runs on the item above it; see the module note. */
function isContinuation(line: string): boolean {
  return /^\s/.test(line)
    && line.trim() !== ''
    && !NESTED_LIST_ITEM_RE.test(line)
    && fenceOf(line) === null;
}

/** The lines from `start` that run on the item above, each trimmed. */
function continuationOf(lines: readonly string[], start: number): string[] {
  const following: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isContinuation(line)) break;
    following.push(line.trim());
  }
  return following;
}

/** The tag written right after an item's box, or null when there is none. */
function inlineTag(line: string): PrerequisiteTag | null {
  if (INLINE_AUTO_RE.test(line)) return 'auto';
  if (INLINE_START_RE.test(line)) return 'start';
  if (INLINE_HUMAN_RE.test(line)) return 'human';
  return null;
}

/** An item line with its `- [ ] [auto] ` or `- [ ] ` opening dropped. */
function stripItemPrefix(line: string): string {
  return line
    .replace(INLINE_AUTO_RE, '')
    .replace(INLINE_HUMAN_RE, '')
    .replace(INLINE_START_RE, '')
    .replace(ITEM_RE, '')
    .trim();
}

/** True when a tag's item carries a probe; a `human` item never does. */
function isProbedTag(tag: PrerequisiteTag): boolean {
  return tag === 'auto' || tag === 'start';
}

/**
 * The backticked span that ends `description` after its final `: `,
 * trimmed, or null when it does not end so; see the module note.
 */
function extractProbe(description: string): string | null {
  const probe = PROBE_RE.exec(description)?.[1]?.trim();
  return probe || null;
}

/** One item, read from its first line and the lines that run on it. */
function readItem(
  lines: readonly string[],
  lineIndex: number,
  inherited: PrerequisiteTag,
): MarkdownPrerequisite {
  const raw = lines[lineIndex] ?? '';
  const tag = inlineTag(raw) ?? inherited;
  const description = [stripItemPrefix(raw), ...continuationOf(lines, lineIndex + 1)].join(' ');
  const probe = isProbedTag(tag)
    ? extractProbe(description)
    : null;
  return Object.freeze({ raw, description, tag, lineIndex, probe });
}

/**
 * Reads every unticked item of a PREREQUISITES file, in file order; see
 * the module note for the rules. The list and each item are frozen.
 */
export function parsePrerequisites(content: string): readonly MarkdownPrerequisite[] {
  const lines = content.split('\n');
  const items: MarkdownPrerequisite[] = [];
  let scope: HeadingScope = [];
  let fence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const marker = fenceOf(line);
    if (fence !== null) {
      if (closesFence(fence, marker)) fence = null;
      continue;
    }
    if (marker !== null) {
      fence = marker;
      continue;
    }
    if (line.startsWith('#')) {
      scope = enterHeading(scope, line);
      continue;
    }
    if (ITEM_RE.test(line)) items.push(readItem(lines, index, sectionDefault(scope)));
  }

  return Object.freeze(items);
}

/** An item the preflight can run: tagged `auto` or `start`, carrying a probe. */
function isProbed(item: MarkdownPrerequisite): item is MarkdownPrerequisite & { probe: string } {
  return isProbedTag(item.tag) && item.probe !== null;
}

/** A probed item as a required item; see the module note. */
function requiredItem(item: MarkdownPrerequisite & { probe: string }): PrerequisiteItem {
  return Object.freeze({ kind: 'tool', name: item.description, probe: item.probe });
}

/** The probed items of `items` tagged `tag`, frozen, in file order. */
function requiredItemsTagged(
  items: readonly MarkdownPrerequisite[],
  tag: PrerequisiteTag,
): readonly PrerequisiteItem[] {
  const probed = items.filter(isProbed).filter((item) => item.tag === tag);
  return Object.freeze(probed.map(requiredItem));
}

/** An item named by its text, its tag and its line: a reminder, or a malformed item. */
function namedItemOf(item: MarkdownPrerequisite): PrerequisiteReminder & MalformedPrerequisite {
  return Object.freeze({ description: item.description, tag: item.tag, line: item.lineIndex + 1 });
}

/** True when a probed tag's item carries no probe to run. */
function isMalformed(item: MarkdownPrerequisite): boolean {
  return isProbedTag(item.tag) && item.probe === null;
}

/**
 * What a PREREQUISITES file adds to a run: its probed `auto` items as
 * required items, its probed `start` items as start-only required items,
 * its `human` items as reminders, and its `auto` and `start` items with
 * no probe as malformed, each list in file order and frozen.
 */
export function planPrerequisites(content: string): PlanPrerequisites {
  const items = parsePrerequisites(content);
  return Object.freeze({
    required: requiredItemsTagged(items, 'auto'),
    startRequired: requiredItemsTagged(items, 'start'),
    reminders: Object.freeze(items.filter((item) => !isProbedTag(item.tag)).map(namedItemOf)),
    malformed: Object.freeze(items.filter(isMalformed).map(namedItemOf)),
  });
}

/** A probed item written as the one shape the parser reads a probe from. */
export const PROBE_ITEM_EXAMPLE = '- [ ] uv installed: `uvx --version`';

/**
 * The lines a PREREQUISITES file holding malformed items is refused
 * with, `file` naming it: what is wrong, each item by its line, then the
 * shape to write it in. `loop start` and `rafa doctor` both refuse with
 * them, so the two say the same thing about the same file.
 */
export function malformedPrerequisiteLines(file: string, malformed: readonly MalformedPrerequisite[]): readonly string[] {
  return [
    `${file} holds ${malformed.length} malformed [auto] or [start] item(s): no command ends the item after a final ": ".`,
    ...malformed.map((item) => `  line ${item.line} [${item.tag}]: ${item.description}`),
    `Write each as ${PROBE_ITEM_EXAMPLE}, its one backticked span a complete command run as written;`
      + ' prove a tool is there with `<tool> --version`, `<tool> --help` or `which <tool>`.',
  ];
}

/**
 * The config's items with one plan's PREREQUISITES file merged in, or
 * with nothing merged when `content` is null; see the module note. The
 * settings are read and never written to, and the set answered is new
 * and frozen.
 */
export function mergePlanPrerequisites(
  settings: PrerequisiteSettings,
  content: string | null,
): PreflightItems {
  const plan = planPrerequisites(content ?? '');
  return Object.freeze({
    required: Object.freeze([...settings.prerequisitesRequired, ...plan.required]),
    startRequired: plan.startRequired,
    optional: Object.freeze([...settings.prerequisitesOptional]),
    reminders: plan.reminders,
    malformed: plan.malformed,
  });
}

/**
 * The PREREQUISITES file of the plan at `planPath`: `PREREQUISITES-<stub>.md`
 * in the plan's directory for a plan named `PLAN-<stub>.md`, else null.
 */
export function prerequisitesPathForPlan(planPath: string): string | null {
  const stub = PLAN_FILE_RE.exec(basename(planPath))?.[1];
  if (stub === undefined) return null;
  return join(dirname(planPath), `PREREQUISITES-${stub}.md`);
}

/** The text at `path`, or null when nothing is there. */
async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch (error) {
    const isAbsent = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
    if (isAbsent) return null;
    throw new Error(`${path}: cannot be read (${messageOf(error)})`, { cause: error });
  }
}

/**
 * The config's items with the PREREQUISITES file of the plan at
 * `planPath` merged in. A relative `planPath` is read against the working
 * directory. Refuses a file that is there and cannot be read, naming its
 * path; see the module note.
 */
export async function loadPlanPrerequisites(
  planPath: string,
  settings: PrerequisiteSettings,
): Promise<PreflightItems> {
  const path = prerequisitesPathForPlan(planPath);
  const content = path === null
    ? null
    : await readIfPresent(path);
  return mergePlanPrerequisites(settings, content);
}
