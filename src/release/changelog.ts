/**
 * The changelog half of a release: the heading one entry is titled
 * with, the notes rendered beneath it, and where in an existing
 * changelog the two get inserted.
 *
 * The spec's step 1 ends by asking for the entry
 * (`.specs/rafa-21-changelog-and-release.md`):
 *
 * ```text
 * renderReleaseHeading(template, values)  → '## 0.5.0 — 2026-09-20, ...'
 * renderChangelogEntry({ template, values, notes })  → that, plus lines
 * insertChangelogEntry(changelog, entry)  → the whole file, one section longer
 * ```
 *
 * Nothing here opens a file. The wrap-up reads the changelog, keeps
 * step 1's text so step 3 can restore it after a session edit it
 * refuses, and writes both — so the text has to be in its hands
 * either way, and a write inside this module would only be a second
 * copy of the same bytes. That also makes every case below drivable
 * from a string literal.
 *
 * ## The heading is a template, and the fields are three
 *
 * `release.heading` defaults to `## {version} — {date}, {title}`
 * (`src/config-schema.ts`), and {@link RELEASE_HEADING_FIELDS} is the
 * whole of what a placeholder can name. Two rules cover the rest:
 *
 *   - A placeholder naming anything else is left EXACTLY as written.
 *     `heading` is free text a person configured, and a `{`, a
 *     version range or a date pattern that happens to look like a
 *     placeholder is more likely theirs than ours. Rendering an
 *     unknown one empty would silently eat it; leaving it visible
 *     puts it in the pull request body, where it gets noticed.
 *   - Whitespace in the rendered heading is ALWAYS collapsed to
 *     single spaces and trimmed. A heading is one line by
 *     construction, and a plan title carrying a newline — a wrapped
 *     `title:` in the plan header — would otherwise split the heading
 *     in two and leave the second half as body text, which step 3's
 *     one-section check would then read as a changed section.
 *
 * ## An empty value takes its separators with it
 *
 * The spec's config section ends with "a project with no version file
 * gets the changelog entry under a date heading and no bump", so a
 * caller with no version to name passes an empty `version`. Rendered
 * straight, the default template then reads `##  — 2026-09-20, ...`,
 * with a dangling em dash where the version was.
 *
 * So when — and only when — a substitution rendered empty, the
 * separator run on either side of the gap it left goes with it
 * ({@link SEPARATORS}), and the two fields that remain are left one
 * space apart. The condition is what keeps the rule narrow: a heading
 * whose three values are all present is never touched beyond the
 * whitespace collapse, so a title that genuinely ends in a colon
 * keeps it.
 *
 * ## Grouped by area, one raw line each
 *
 * The notes go in raw, as `- <area>: <summary>`, grouped so every
 * line of an area sits together. They are raw on purpose: step 2 has
 * the wrap-up session rewrite them "into one line per area", and a
 * prefix per line is what makes that a collapse rather than a
 * rewrite. No heading level is introduced for an area, because
 * step 3 verifies the file gained exactly one section and a `###`
 * per area would make that count ambiguous.
 *
 * Three things decide what a note contributes:
 *
 *   - A note at level `none` contributes nothing. The spec spells it
 *     "a task with nothing a user would notice writes `level: none`",
 *     so its summary is a sentence about a diff no user sees, and the
 *     reading counts them in {@link ChangelogEntry.noneNotes} rather
 *     than dropping them silently.
 *   - A note repeating an earlier note's area and summary exactly
 *     contributes nothing either, counted in
 *     {@link ChangelogEntry.duplicateNotes}. `store/changes.ts`
 *     dedupes a session's own rows; two sessions reporting the same
 *     line for the same plan is what this catches. A note whose
 *     summary is blank is counted apart, in
 *     {@link ChangelogEntry.blankNotes}: the store refuses one
 *     (`textProblem`, `store/findings.ts`), so it can only arrive from
 *     a caller that did not come through the store, and it is still
 *     not a line.
 *   - A note with no area, or a blank one, is a line without a
 *     prefix. Those lines come LAST whenever they were reported,
 *     since they head nothing and would otherwise interrupt the named
 *     areas; the named areas themselves stay in the order their first
 *     note arrived, which is the order the plan's tasks ran.
 *
 * ## Where the entry goes
 *
 * The spec puts the entry "at the top of the changelog" and then
 * bounds that: "the loop only ever inserts after the file's first
 * heading". The two together are one instruction — land at the top of
 * the list of versions, never at byte 0 of the file — and the top of
 * the list is not the line after the first heading whenever that
 * heading has a preamble under it. This repository's own
 * `CHANGELOG.md` is that shape (measured 2026-09-20: `# Changelog`,
 * then a six-line paragraph describing the format, then
 * `## 0.4.0 — ...`), and inserting on the line after `# Changelog`
 * would file every future release above the sentence explaining the
 * file.
 *
 * So {@link insertChangelogEntry} inserts after the first heading AND
 * after the prose that belongs to it, which is to say immediately
 * before the next heading of any level, and at the end of the file
 * when the first heading is the only one. The entry is still always
 * below the first heading, which is the bound the spec's risk list
 * asks for. {@link ChangelogInsertion.point} says which of the three
 * places answered.
 *
 * A heading is an ATX heading — up to three spaces, one to six `#`,
 * then a space or the end of the line — found outside fenced code, so
 * a `# ...` line inside a ``` block in a changelog entry is not
 * mistaken for one. A setext heading (a line underlined with `===`)
 * is NOT recognised: `---` underlining is indistinguishable from a
 * thematic break and from the close of YAML front matter without a
 * fuller parse, and no changelog shape this repository has seen uses
 * one. A file with no ATX heading at all is prepended to, reported as
 * {@link ChangelogInsertion.point} `file-top`.
 *
 * Blank lines are the one thing added beside the entry: a blank line
 * ends up on each side of it, and one is inserted only where the file
 * had none there. Blank lines the file already had stay as they were,
 * and every other byte — the trailing newline state included — is the
 * byte it was, as with the manifest in `./version.ts`. An EMPTY file
 * is the one exception: its single empty line ends up after the
 * entry, so the result carries the trailing newline the empty file
 * had no byte for.
 */
import type { ChangeLevel } from '../report/parse.js';

/** The placeholders {@link renderReleaseHeading} fills in. */
export const RELEASE_HEADING_FIELDS = ['version', 'date', 'title'] as const;

/** One placeholder name. */
export type ReleaseHeadingField = (typeof RELEASE_HEADING_FIELDS)[number];

/** What a heading template is rendered over. */
export type ReleaseHeadingValues = Readonly<Record<ReleaseHeadingField, string>>;

/** A `{name}` placeholder, its name captured. */
const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

/** Whitespace runs, newlines included. */
const WHITESPACE = /\s+/g;

/** The marker of an ATX heading, and the text after it. */
const ATX_HEADING = /^ {0,3}#{1,6}(?: |$)/;

/** The open or close of a fenced code block. */
const CODE_FENCE = /^ {0,3}(?:```|~~~)/;

/**
 * The characters a heading template puts between two of its fields,
 * beside whitespace: both dashes, the hyphen, and the punctuation the
 * default template and a consumer's are likely to use. A run of these
 * is what a field rendering empty leaves dangling.
 */
const SEPARATORS = '—–-,;:·|';

/** True when `character` separates two fields rather than being one. */
function isSeparator(character: string): boolean {
  return character.trim() === '' || SEPARATORS.includes(character);
}

/** `text` without the separator run it ends with. */
function trimTrailingSeparators(text: string): string {
  let end = text.length;
  while (end > 0 && isSeparator(text[end - 1] ?? '')) end -= 1;
  return text.slice(0, end);
}

/** `text` without the separator run it starts with. */
function trimLeadingSeparators(text: string): string {
  let start = 0;
  while (start < text.length && isSeparator(text[start] ?? '')) start += 1;
  return text.slice(start);
}

/** True when `field` is one of the three this module fills in. */
function isHeadingField(field: string): field is ReleaseHeadingField {
  return (RELEASE_HEADING_FIELDS as readonly string[]).includes(field);
}

/**
 * A heading rendered from `template` over `values`.
 *
 * Placeholders are `{version}`, `{date}` and `{title}`; any other
 * `{word}` survives as written. See the module note for what an empty
 * value does to the separators around it, and why the whitespace
 * collapse is unconditional.
 *
 * The template is walked placeholder by placeholder rather than
 * substituted in one pass, because a field that renders empty has to
 * take the separators on BOTH sides of it with it, and only a walk
 * knows which characters those were.
 */
export function renderReleaseHeading(
  template: string,
  values: ReleaseHeadingValues,
): string {
  let rendered = '';
  let afterGap = false;

  /** Appends `text`, dropping the separators a gap before it left. */
  const add = (text: string): void => {
    if (!afterGap) {
      rendered += text;
      return;
    }
    const kept = trimLeadingSeparators(text);
    if (kept === '') return;
    afterGap = false;
    rendered += kept;
  };

  let cursor = 0;
  for (const found of template.matchAll(PLACEHOLDER)) {
    const before = template.slice(cursor, found.index);
    cursor = found.index + found[0].length;
    const name = found[1] ?? '';
    if (!isHeadingField(name)) {
      add(`${before}${found[0]}`);
      continue;
    }
    const value = values[name].trim();
    if (value !== '') {
      add(before);
      add(value);
      continue;
    }
    add(before);
    rendered = `${trimTrailingSeparators(rendered)} `;
    afterGap = true;
  }
  add(template.slice(cursor));

  return rendered.replace(WHITESPACE, ' ').trim();
}

/** What a note has to carry to become a changelog line. */
export interface ChangelogNote {
  /** How much of a release the note claims its diff is worth. */
  readonly level: ChangeLevel;
  /** The heading the line groups under, or null when it named none. */
  readonly area: string | null;
  /** The line itself, as the task wrote it. */
  readonly summary: string;
}

/** The lines of one area, in the order their notes arrived. */
export interface ChangelogGroup {
  /** The area, or null for the notes that named none. */
  readonly area: string | null;
  /** Each note's summary, whitespace collapsed, duplicates dropped. */
  readonly summaries: readonly string[];
}

/** What grouping a plan's notes produced, and what it left out. */
export interface ChangelogGrouping {
  /** Named areas first, in first-note order; the unnamed group last. */
  readonly groups: readonly ChangelogGroup[];
  /** How many notes were at level `none`. */
  readonly noneNotes: number;
  /** How many notes repeated an earlier area and summary exactly. */
  readonly duplicateNotes: number;
  /** How many notes carried no summary to put on a line. */
  readonly blankNotes: number;
}

/** A note's area as a group key: null for absent, blank or whitespace. */
function areaOf(note: ChangelogNote): string | null {
  const area = note.area?.trim() ?? '';
  return area === ''
    ? null
    : area;
}

/**
 * `notes` grouped by area, at the shape the entry renders from.
 *
 * Level `none` notes and exact repeats are left out and counted; the
 * module note says why each, and why the unnamed group comes last.
 */
export function groupChangeNotes(notes: readonly ChangelogNote[]): ChangelogGrouping {
  const named = new Map<string, string[]>();
  const unnamed: string[] = [];
  const seen = new Set<string>();
  let noneNotes = 0;
  let duplicateNotes = 0;
  let blankNotes = 0;

  for (const note of notes) {
    if (note.level === 'none') {
      noneNotes += 1;
      continue;
    }
    const area = areaOf(note);
    const summary = note.summary.replace(WHITESPACE, ' ').trim();
    if (summary === '') {
      blankNotes += 1;
      continue;
    }
    const key = `${area ?? ''}\n${summary}`;
    if (seen.has(key)) {
      duplicateNotes += 1;
      continue;
    }
    seen.add(key);
    if (area === null) {
      unnamed.push(summary);
      continue;
    }
    const summaries = named.get(area);
    if (summaries === undefined) named.set(area, [summary]);
    else summaries.push(summary);
  }

  const groups = [...named].map(([area, summaries]) => ({ area, summaries }));
  return {
    groups: unnamed.length === 0
      ? groups
      : [...groups, { area: null, summaries: unnamed }],
    noneNotes,
    duplicateNotes,
    blankNotes,
  };
}

/** The `- area: summary` lines of a grouping, areas together. */
export function renderNoteLines(grouping: ChangelogGrouping): string[] {
  return grouping.groups.flatMap(
    (group) => group.summaries.map((summary) => (
      group.area === null
        ? `- ${summary}`
        : `- ${group.area}: ${summary}`
    )),
  );
}

/** What one entry is rendered from. */
export interface ChangelogEntryInput {
  /** `release.heading`, as configured. */
  readonly template: string;
  /** The version, date and plan title to render it over. */
  readonly values: ReleaseHeadingValues;
  /** The plan's stored change notes, in append order. */
  readonly notes: readonly ChangelogNote[];
}

/** One changelog entry, rendered but not yet inserted. */
export interface ChangelogEntry {
  /** The heading line. */
  readonly heading: string;
  /** The lines beneath it, in the order they will appear. */
  readonly lines: readonly string[];
  /** The areas the lines came from, the unnamed one last. */
  readonly groups: readonly ChangelogGroup[];
  /** Heading, a blank line and the lines; no trailing newline. */
  readonly text: string;
  /** How many notes were at level `none`. */
  readonly noneNotes: number;
  /** How many notes repeated an earlier line exactly. */
  readonly duplicateNotes: number;
  /** How many notes carried no summary to put on a line. */
  readonly blankNotes: number;
}

/**
 * One entry's text: the heading {@link renderReleaseHeading} makes of
 * `template`, and the notes under it grouped by area.
 *
 * A plan whose every note was skipped renders the heading alone, with
 * no blank line after it; the counts say why the body is empty and
 * the caller decides whether an entry of nothing is worth inserting.
 */
export function renderChangelogEntry(input: ChangelogEntryInput): ChangelogEntry {
  const heading = renderReleaseHeading(input.template, input.values);
  const grouping = groupChangeNotes(input.notes);
  const lines = renderNoteLines(grouping);
  return {
    heading,
    lines,
    groups: grouping.groups,
    text: lines.length === 0
      ? heading
      : `${heading}\n\n${lines.join('\n')}`,
    noneNotes: grouping.noneNotes,
    duplicateNotes: grouping.duplicateNotes,
    blankNotes: grouping.blankNotes,
  };
}

/** Which of the three places an entry was inserted at. */
export type ChangelogInsertPoint =
  /** Before the heading that followed the first one's preamble. */
  | 'before-next-heading'
  /** At the end: the file's first heading was its only one. */
  | 'file-end'
  /** At the top: the file held no ATX heading at all. */
  | 'file-top';

/** A changelog with one entry inserted, and where it went. */
export interface ChangelogInsertion {
  /** The whole file, one section longer. */
  readonly text: string;
  /** Which place answered; see {@link ChangelogInsertPoint}. */
  readonly point: ChangelogInsertPoint;
  /** The 1-based line the entry's heading now sits on. */
  readonly line: number;
}

/**
 * The index of the first ATX heading in `lines` at or after `from`,
 * or null when there is none. Lines inside a fenced code block are
 * skipped, so a heading quoted in an example is not one.
 */
function findHeading(lines: readonly string[], from: number): number | null {
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (CODE_FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || index < from) continue;
    if (ATX_HEADING.test(line)) return index;
  }
  return null;
}

/** The index one past the last line of `lines` that holds anything. */
function endOfContent(lines: readonly string[]): number {
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') end -= 1;
  return end;
}

/** Where an entry goes in `lines`, and under which reading. */
function insertPoint(lines: readonly string[]): { at: number; point: ChangelogInsertPoint } {
  const first = findHeading(lines, 0);
  if (first === null) return { at: 0, point: 'file-top' };
  const next = findHeading(lines, first + 1);
  if (next !== null) return { at: next, point: 'before-next-heading' };
  return { at: endOfContent(lines), point: 'file-end' };
}

/**
 * `changelog` with `entry` inserted after its first heading's block.
 *
 * `entry` is a whole entry's text, as {@link ChangelogEntry.text}
 * spells it. A blank line ends up on each side of it, added only
 * where the file had none, and no other byte of the file moves; the
 * module note holds why the insert lands before the NEXT heading
 * rather than on the line after the first one.
 */
export function insertChangelogEntry(changelog: string, entry: string): ChangelogInsertion {
  const lines = changelog.split('\n');
  const { at, point } = insertPoint(lines);
  const entryLines = entry.split('\n');

  const before = at === 0 || (lines[at - 1] ?? '').trim() === ''
    ? []
    : [''];
  const after = at >= lines.length || (lines[at] ?? '').trim() === ''
    ? []
    : [''];
  const inserted = [
    ...lines.slice(0, at),
    ...before,
    ...entryLines,
    ...after,
    ...lines.slice(at),
  ];
  return { text: inserted.join('\n'), point, line: at + before.length + 1 };
}

/**
 * `now` as a changelog date: the calendar date where the release is
 * being made, `YYYY-MM-DD`.
 *
 * Local rather than UTC. A release cut at 21:00 in UTC-5 is dated the
 * day its operator made it, which is the day they will look for in
 * the file; `toISOString` would date it tomorrow.
 *
 * That difference is invisible to a test that does not ask for it:
 * `bun test` runs at a ZERO offset whatever zone the host is set to
 * (measured 2026-09-20), so the two dates agree there. The cases in
 * `./changelog.test.ts` set `TZ` themselves for that reason.
 */
export function changelogDate(now: Date): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
