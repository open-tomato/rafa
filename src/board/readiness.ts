/**
 * The two cheap readiness checks a spec passes before a planner session
 * is paid for: the `spec:ready` label a person puts on the issue, and
 * the code reading of the body — every template heading present and
 * non-empty, the two list sections holding an item, and no placeholder
 * left in the text.
 *
 * `.rafa/specs/rafa-20-pr-commands.md` orders the gate's four checks cheapest
 * first, and these are checks 1 and 2. Check 0 is the author's trust
 * (`./trust.ts`), check 2 also carries the leak refusal (`./leak.ts`),
 * and check 3 is the planner's own first pass over the spec. This module
 * answers 1 and the non-leak half of 2, and composes with neither: the
 * command runs them in order and stops at the first that refuses, which
 * is the only place that knows what order costs what.
 *
 * Both answers are pure functions over the label list and the body
 * string, so the cases in `./readiness.test.ts` need no seam, no
 * temporary directory and no `gh`. Nothing here reads a file: a
 * `--spec=<file>` run hands the file's text to {@link findReadinessGaps}
 * exactly as an `--issue` run hands the issue body, and gets the same
 * gaps, because a spec off the board and a spec off a disk are the same
 * document to this check. Only the LABEL check is board-only — a file
 * has no labels to carry — which is why it is a separate function and
 * not a step inside the body reading.
 *
 * ## What a gap is
 *
 * {@link ReadinessGap} carries a `heading` and a `what`, the same two
 * fields the planner's `rafa:spec-review` block answers its own gaps
 * with. That is deliberate: the not-ready comment posts the code gaps
 * and the reviewed gaps in one list, and a second shape would need a
 * second way of printing them. `line` is this side's addition, since a
 * placeholder has a place and a review gap does not.
 *
 * Every gap names a heading, as the spec requires, and a placeholder
 * found before the first heading names {@link PREAMBLE_HEADING} rather
 * than nothing, so no gap in the list is anonymous.
 *
 * ## The headings
 *
 * {@link TEMPLATE_HEADINGS} is the template's own list, in the
 * template's order. ORDER IS NOT CHECKED — the spec asks for every
 * heading present and non-empty and says nothing about their sequence,
 * and an author who moves Design above Starting position has written a
 * readable spec, not an unready one.
 *
 * A heading is matched on its text, normalised: trimmed, lower-cased,
 * inner whitespace collapsed, a trailing colon or full stop dropped, and
 * emphasis characters removed, so `## **Definition of done:**` is the
 * template's heading. Any level counts, because an author who nests the
 * template under a `#` title has still written the section. A heading
 * repeated answers its FIRST section; a second one with the same text is
 * read as any other extra section, scanned for placeholders and not for
 * emptiness.
 *
 * A heading inside a fenced block is not a heading, which matters here
 * more than it looks: a spec about this repository quotes template
 * bodies in fences, and a reader that took those as sections would find
 * the template complete in a body that only QUOTES it.
 *
 * ## Empty, and what content is
 *
 * A heading's section runs to the next heading at its level or above, so
 * a `## Design` whose content all sits under `### Approach` is not
 * empty. Content is any non-blank line once HTML comments are removed —
 * a fenced block counts, a table counts, and a section holding nothing
 * but the template's guidance comment does not. A subsection heading is
 * not content either, so a section that was outlined and never written
 * is empty however many `###` lines it carries.
 *
 * {@link LIST_HEADINGS} are the two the spec singles out, "Tasks the
 * plan must carry" and "Definition of done". Each must hold at least one
 * list item: a `-`, `*` or `+` bullet, or a numbered `1.` or `1)`, with
 * content after it, outside any fence. Prose under those two headings is
 * a paragraph about the work, and the plan is written from the items.
 *
 * Those two are also read on their own, through
 * {@link findListSectionGaps} and {@link listSectionWarning}: the spec
 * asks `plan create --issue` to WARN, naming them, when either is
 * missing. NOTHING CALLS THAT PAIR TODAY. `./plan-spec.ts` printed the
 * warning until {@link requireCompleteSpec} was wired into its
 * `inspectSpecIssue`, and every gap the warning names is one the
 * refusal now throws on, so a warning after it would reach no output
 * and a warning before it would comment on a body about to be refused.
 * The pair stays because the reading is the spec's own and costs
 * nothing to keep; `./readiness.test.ts` is its only caller, and
 * `src/board/plan-spec.ts`'s note holds what the refusal costs a body
 * written before the template.
 *
 * ## Placeholders, and the documentation problem
 *
 * The spec names four: `TBD`, `TODO`, `???` and an unfilled template
 * comment. The list is the spec's and is not a general lint; a word this
 * misses is caught by the planner's pass, which reads for meaning.
 *
 * The check has to survive being pointed at a spec ABOUT it. This
 * repository's specs quote `TBD`, `TODO` and `???` as literals while
 * describing the gate, and a check that refused those would make the
 * gate unable to read its own spec. So two exemptions, each with a
 * control in the test file:
 *
 *  - A fenced block is skipped whole. A spec showing an example body,
 *    an example template or an example refusal puts it in a fence, and
 *    what is quoted there is not what the author left behind.
 *  - An inline code span is skipped. `` `TODO` `` in a sentence is the
 *    word being named, not a marker being left.
 *
 * The word forms are matched UPPER-CASE and whole: `TODO` is the
 * convention for an unfinished note, and `the todo list` in a sentence
 * about a feature is prose. That is the trade — an author who types
 * `tbd` in lower case is not caught here — and it is the cheaper
 * mistake, since the planner's pass reads the same sentence for meaning
 * and a false refusal teaches the author to stop writing plainly. `???`
 * is any run of three or more question marks, which has no prose form
 * worth keeping.
 *
 * An HTML comment surviving in the body is an unfilled template comment,
 * whatever it says, because every comment in the template is guidance
 * the author is asked to delete — the first one included, the one that
 * says no local paths or credentials. The one exemption is a comment
 * opening `rafa:`, the marker shape rafa writes itself, so a body
 * carrying a machine-written marker is not refused for it.
 *
 * A section already reported EMPTY does not also report the placeholders
 * inside it. A section holding nothing but the template's comment is one
 * fault, and naming it twice sends the author looking for a second one.
 */
import { CommandExit } from '../cli/command.js';

/** The label a person puts on an issue that is ready to plan from. */
export const SPEC_READY_LABEL = 'spec:ready';

/** The exit code a refused spec ends the command with; the spec's own. */
export const READINESS_REFUSAL_EXIT = 2;

/** The template's headings, in the template's order. */
export const TEMPLATE_HEADINGS: readonly string[] = [
  'What you get',
  'Starting position',
  'Design',
  'What can go wrong',
  'Tasks the plan must carry',
  'Definition of done',
];

/** The two headings that must hold a list item, not just prose. */
export const LIST_HEADINGS: readonly string[] = [
  'Tasks the plan must carry',
  'Definition of done',
];

/** The word forms a gap names; see the module note for the matching. */
export const PLACEHOLDER_TOKENS: readonly string[] = ['TBD', 'TODO', '???'];

/** What a gap found before the first heading is named by. */
export const PREAMBLE_HEADING = 'the opening';

/** The comment prefix rafa writes its own markers under; never a gap. */
export const MARKER_PREFIX = 'rafa:';

/** What kind of hole in the spec a gap is. */
export type ReadinessGapKind =
  | 'empty-heading'
  | 'missing-heading'
  | 'no-list-item'
  | 'placeholder';

/** One thing keeping a spec from being planned from. */
export interface ReadinessGap {
  /** What kind of hole it is. */
  readonly kind: ReadinessGapKind;
  /** The heading it sits under, as the refusal names it. */
  readonly heading: string;
  /** The clause the refusal spells after the heading. */
  readonly what: string;
  /** The 1-based line it sits on, or null for a heading that is absent. */
  readonly line: number | null;
}

/** A placeholder word and the pattern that finds it. */
interface PlaceholderShape {
  /** What the gap calls it. */
  readonly token: string;
  /** The pattern, not global, read over one line of prose. */
  readonly pattern: RegExp;
}

/** An ATX heading: up to three spaces, one to six hashes, then text. */
const HEADING_LINE = /^ {0,3}(#{1,6})\s+(.*)$/u;

/** A fenced block's opening or closing line. */
const FENCE_LINE = /^ {0,3}(?:```|~~~)/u;

/** A list item at list level: a bullet or a number, then content. */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d+[.)])\s+\S/u;

/** An inline code span, whose contents are quoted rather than written. */
const CODE_SPAN = /`[^`]*`/gu;

/** Emphasis and code characters a heading may be dressed in. */
const HEADING_DRESS = /[*_`]/gu;

/** A trailing colon or full stop on a heading. */
const HEADING_TAIL = /[:.]+$/u;

/** What opens an HTML comment. */
const COMMENT_OPEN = '<!--';

/** What closes one. */
const COMMENT_CLOSE = '-->';

/** Every placeholder word, in the order gaps on one line are listed. */
const PLACEHOLDER_SHAPES: readonly PlaceholderShape[] = [
  { token: 'TBD', pattern: /\bTBD\b/u },
  { token: 'TODO', pattern: /\bTODO\b/u },
  { token: '???', pattern: /\?{3,}/u },
];

/** What the author must do about a refused spec. */
const REMEDY = 'fill each gap in the spec and rerun';

/** One line of a body, read for everything the checks ask of it. */
interface BodyLine {
  /** Its 1-based number, as a gap names it. */
  readonly number: number;
  /** True when it is inside a fenced block, or is a fence itself. */
  readonly fenced: boolean;
  /** The line with its HTML comments removed. */
  readonly visible: string;
  /** The text of each comment that OPENED on this line. */
  readonly comments: readonly string[];
  /** Its heading, when it is one outside a fence. */
  readonly heading: { readonly level: number; readonly title: string } | null;
}

/** One stretch of a body: a heading and what sits under it, or the preamble. */
interface BodySpan {
  /** Its heading text as written, or null for the preamble. */
  readonly title: string | null;
  /** The heading's 1-based line, or null for the preamble. */
  readonly line: number | null;
  /** The lines to the next heading of any level; where placeholders belong. */
  readonly own: readonly BodyLine[];
  /** The lines to the next heading at this level or above; the section. */
  readonly section: readonly BodyLine[];
}

/** What one line looks like once its HTML comments are taken out. */
interface StrippedLine {
  /** The line without them. */
  readonly visible: string;
  /** The text of each comment that opened on this line. */
  readonly comments: readonly string[];
  /** True when a comment is still open at the end of the line. */
  readonly open: boolean;
}

/**
 * `line` with its HTML comments removed, carrying the text of each
 * comment that opened on it. A comment carried over from an earlier line
 * contributes no text, so a comment spanning five lines is one finding
 * on the line it started, not five.
 */
function stripComments(line: string, carried: boolean): StrippedLine {
  const comments: string[] = [];
  let visible = '';
  let rest = line;
  let inside = carried;

  while (rest !== '') {
    if (inside) {
      const end = rest.indexOf(COMMENT_CLOSE);
      if (end === -1) break;
      rest = rest.slice(end + COMMENT_CLOSE.length);
      inside = false;
      continue;
    }

    const start = rest.indexOf(COMMENT_OPEN);
    if (start === -1) {
      visible += rest;
      break;
    }

    visible += rest.slice(0, start);
    const body = rest.slice(start + COMMENT_OPEN.length);
    const end = body.indexOf(COMMENT_CLOSE);
    if (end === -1) {
      comments.push(body);
      inside = true;
      break;
    }

    comments.push(body.slice(0, end));
    rest = body.slice(end + COMMENT_CLOSE.length);
  }

  return { visible, comments, open: inside };
}

/** The heading a visible line opens, or null when it opens none. */
function headingOf(visible: string): BodyLine['heading'] {
  const match = HEADING_LINE.exec(visible);
  if (match === null) return null;

  const [, hashes = '', title = ''] = match;
  return { level: hashes.length, title: title.replace(/\s+#+\s*$/u, '').trim() };
}

/** Every line of `body`, with its comments, its fence state and its heading. */
function readLines(body: string): readonly BodyLine[] {
  const raw = body.split('\n').map((line) => line.replace(/\r$/u, ''));
  const lines: BodyLine[] = [];
  let carried = false;
  let fenced = false;

  raw.forEach((text, index) => {
    const stripped = stripComments(text, carried);
    carried = stripped.open;

    const isFence = FENCE_LINE.test(stripped.visible);
    const inFence = fenced || isFence;
    if (isFence) fenced = !fenced;

    lines.push({
      number: index + 1,
      fenced: inFence,
      visible: stripped.visible,
      comments: stripped.comments,
      heading: inFence
        ? null
        : headingOf(stripped.visible),
    });
  });

  return lines;
}

/** Every stretch of `lines`, the preamble first when it holds anything. */
function spansOf(lines: readonly BodyLine[]): readonly BodySpan[] {
  const heads = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.heading !== null);

  const first = heads[0]?.index ?? lines.length;
  const preamble: BodySpan = {
    title: null,
    line: null,
    own: lines.slice(0, first),
    section: lines.slice(0, first),
  };

  const sections = heads.map((entry, position) => {
    const level = entry.line.heading?.level ?? 1;
    const nextAny = heads[position + 1]?.index ?? lines.length;
    const nextPeer = heads.slice(position + 1)
      .find((other) => (other.line.heading?.level ?? 1) <= level);

    return {
      title: entry.line.heading?.title ?? '',
      line: entry.line.number,
      own: lines.slice(entry.index + 1, nextAny),
      section: lines.slice(entry.index + 1, nextPeer?.index ?? lines.length),
    };
  });

  return [preamble, ...sections];
}

/** A heading text as it is compared; see the module note. */
function normaliseHeading(title: string): string {
  return title.replace(HEADING_DRESS, '')
    .trim()
    .replace(HEADING_TAIL, '')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

/**
 * True when some line of `lines` holds anything but blank space. A
 * subsection HEADING is not content: a section holding `### Approach`
 * and nothing under it is a section the author only outlined.
 */
function hasContent(lines: readonly BodyLine[]): boolean {
  return lines.some((line) => line.heading === null && line.visible.trim() !== '');
}

/** True when some line of `lines` is a list item outside a fence. */
function hasListItem(lines: readonly BodyLine[]): boolean {
  return lines.some((line) => !line.fenced && LIST_ITEM.test(line.visible));
}

/** One gap, spelled. */
function gapAt(kind: ReadinessGapKind, heading: string, what: string, line: number | null): ReadinessGap {
  return { kind, heading, what, line };
}

/** Every placeholder in one line, named under `heading`. */
function placeholdersInLine(heading: string, line: BodyLine): readonly ReadinessGap[] {
  const found: ReadinessGap[] = [];
  const unfilled = line.comments.some((comment) => !comment.trim().startsWith(MARKER_PREFIX));
  if (unfilled) {
    found.push(gapAt('placeholder', heading, `holds an unfilled template comment on line ${String(line.number)}`, line.number));
  }

  if (line.fenced) return found;

  const prose = line.visible.replace(CODE_SPAN, ' ');
  for (const shape of PLACEHOLDER_SHAPES) {
    if (!shape.pattern.test(prose)) continue;
    found.push(gapAt('placeholder', heading, `holds the placeholder ${shape.token} on line ${String(line.number)}`, line.number));
  }

  return found;
}

/** Every placeholder under `heading`, in line order. */
function placeholderGaps(heading: string, lines: readonly BodyLine[]): readonly ReadinessGap[] {
  return lines.flatMap((line) => placeholdersInLine(heading, line));
}

/** What a span's gaps are named under: the template's spelling when it has one. */
function headingNameOf(span: BodySpan, template: string | null): string {
  if (template !== null) return template;
  if (span.title === null || span.title === '') return PREAMBLE_HEADING;
  return span.title;
}

/**
 * Every gap in one span: the heading-level fault when it is a template
 * heading, then the placeholders under it. An empty section reports the
 * emptiness alone; see the module note.
 */
function spanGaps(span: BodySpan, template: string | null): readonly ReadinessGap[] {
  const heading = headingNameOf(span, template);

  if (template !== null && !hasContent(span.section)) {
    return [gapAt('empty-heading', heading, 'is empty', span.line)];
  }

  const needsList = template !== null && LIST_HEADINGS.includes(template);
  const missingList = needsList && !hasListItem(span.section);
  const listGaps = missingList
    ? [gapAt('no-list-item', heading, 'holds no list item', span.line)]
    : [];

  return [...listGaps, ...placeholderGaps(heading, span.own)];
}

/** The template heading each span is, by its position in the span list. */
function templateNames(spans: readonly BodySpan[]): ReadonlyMap<number, string> {
  const wanted = new Map(TEMPLATE_HEADINGS.map((heading) => [normaliseHeading(heading), heading]));
  const taken = new Map<number, string>();
  const seen = new Set<string>();

  spans.forEach((span, position) => {
    if (span.title === null) return;
    const key = normaliseHeading(span.title);
    const template = wanted.get(key);
    if (template === undefined || seen.has(key)) return;
    seen.add(key);
    taken.set(position, template);
  });

  return taken;
}

/**
 * Every gap in `body`: the template headings it does not carry, the ones
 * it carries empty, the two list sections holding no item, and every
 * placeholder left in the text. A body that carries none answers an
 * empty list, which is the only reading that lets a plan be written
 * from it.
 *
 * The missing headings come first, in {@link TEMPLATE_HEADINGS} order,
 * because a body missing a heading is further from ready than one whose
 * sections need editing. Everything after them is in body order, so the
 * list reads down the document the author is about to open.
 */
export function findReadinessGaps(body: string): readonly ReadinessGap[] {
  const spans = spansOf(readLines(body));
  const templates = templateNames(spans);

  const present = new Set(templates.values());
  const missing = TEMPLATE_HEADINGS
    .filter((heading) => !present.has(heading))
    .map((heading) => gapAt('missing-heading', heading, 'is missing', null));

  const rest = spans.flatMap((span, position) => spanGaps(span, templates.get(position) ?? null));
  return [...missing, ...rest];
}

/** True when `labels` carries {@link SPEC_READY_LABEL}, whatever its case. */
export function hasSpecReadyLabel(labels: readonly string[]): boolean {
  return labels.some((label) => label.trim().toLowerCase() === SPEC_READY_LABEL);
}

/**
 * The sentence an issue without the label is refused with; the spec's
 * own wording, so an operator can search for it.
 */
export function specReadyRefusalMessage(issue: number): string {
  return `issue #${String(issue)} is not marked ${SPEC_READY_LABEL}`;
}

/**
 * Lets a labelled issue through, and throws
 * `CommandExit(2, {@link specReadyRefusalMessage})` for one without the
 * label.
 *
 * Called before the body is read any further, so nothing is spent on an
 * issue nobody has marked ready — unless the caller has an offer to make
 * first, which `src/board/plan-spec.ts` does when `plan create` has a
 * terminal to ask on: then this is what refuses an issue the offer left
 * unmarked, with the same sentence. `plan create --next` asks
 * {@link hasSpecReadyLabel} instead and STOPS at the line rather than
 * skipping it, which is the caller's decision and not this module's.
 */
export function requireSpecReadyLabel(issue: number, labels: readonly string[]): void {
  if (hasSpecReadyLabel(labels)) return;
  throw new CommandExit(READINESS_REFUSAL_EXIT, specReadyRefusalMessage(issue));
}

/** One gap, as the refusal names it. */
function describeGap(gap: ReadinessGap): string {
  return `"${gap.heading}" ${gap.what}`;
}

/**
 * The sentence an incomplete spec is refused with: what `source` names,
 * each gap with its heading, and what the author must do.
 *
 * `source` is the caller's name for the text — `issue #20`, or a spec
 * file's path — as `./leak.ts` takes one, and for the same reason: this
 * module is handed a string and cannot know where it came from.
 *
 * Throws a `TypeError` for an empty list, as `./leak.ts` and
 * `./trust.ts` do for a clean reading: there is no refusal to spell for
 * a ready spec.
 */
export function readinessRefusalMessage(source: string, gaps: readonly ReadinessGap[]): string {
  if (gaps.length === 0) {
    throw new TypeError(`board readiness: ${source} carries no gap, and has no refusal to name`);
  }

  const named = gaps.map(describeGap).join(', ');
  return `${source} is not ready to plan from: ${named}; ${REMEDY}`;
}

/**
 * Lets a complete `body` through, and throws
 * `CommandExit(2, {@link readinessRefusalMessage})` for one with gaps.
 *
 * Called after the label check and beside the leak refusal, and before
 * any session is opened: the point of the code checks is that they cost
 * nothing and a planner pass costs a session.
 */
export function requireCompleteSpec(source: string, body: string): void {
  const gaps = findReadinessGaps(body);
  if (gaps.length === 0) return;
  throw new CommandExit(READINESS_REFUSAL_EXIT, readinessRefusalMessage(source, gaps));
}

/** What the author must do about a thin list section. */
const LIST_REMEDY = 'the plan is written from those items, so fill them in and rerun';

/**
 * The gaps under the two {@link LIST_HEADINGS} alone: each one missing,
 * empty, or holding no list item. Placeholders are left out — a `TODO`
 * under a filled list is a gap about the text, not about the list — so
 * an empty answer means both sections carry something to plan from.
 *
 * A gap's `heading` is the template's own spelling
 * ({@link findReadinessGaps}), which is what makes the filter a string
 * comparison rather than a second pass over the body.
 */
export function findListSectionGaps(body: string): readonly ReadinessGap[] {
  return findReadinessGaps(body)
    .filter((gap) => gap.kind !== 'placeholder' && LIST_HEADINGS.includes(gap.heading));
}

/**
 * The sentence a body whose list sections are thin is WARNED with: what
 * `source` names, each of the two headings that is missing, empty or
 * itemless, and what the author must do.
 *
 * A warning and not a refusal, which is the whole of the difference
 * between this and {@link readinessRefusalMessage}: the spec asks
 * `plan create --issue` to warn, naming them
 * (`.rafa/specs/rafa-20-pr-commands.md`), and a run that refused here would
 * stop every spec written before the template existed.
 *
 * Throws a `TypeError` for an empty list, as the refusals do: there is
 * no warning to spell for a body whose lists are filled.
 */
export function listSectionWarning(source: string, gaps: readonly ReadinessGap[]): string {
  if (gaps.length === 0) {
    throw new TypeError(`board readiness: ${source} carries no thin list section, and has no warning to name`);
  }

  const named = gaps.map(describeGap).join(', ');
  return `${source} gives the planner no list to plan from: ${named}; ${LIST_REMEDY}`;
}
