/**
 * The table `rafa issue list --roadmap` and `rafa epics` print: one line
 * per {@link RoadmapRow}, in the order the rows arrive, under a header
 * line naming the eight columns (`.rafa/specs/rafa-123-rafa-issue-list-roadmap.md`,
 * and `.rafa/specs/rafa-151-references-specs-bugs-are.md` for `refs`).
 *
 * ## The columns
 *
 * In order, each from what `src/board/roadmap-rows.ts` read:
 *
 *  - `#` — the Roadmap line's issue, as `#123`, right-aligned.
 *  - `state` — the board's state, `open` or `closed`.
 *  - `type` — the type the labels carry, as the github tracker reads it.
 *  - `spec` — whether the issue can be planned: every section of the spec
 *    template filled, and the `spec:ready` label on it. A symbol
 *    ({@link SPEC_SYMBOLS}), or under {@link TableStyle.texts} the words
 *    {@link specWords} spells, naming the sections that need work.
 *  - `blocked by` — the blockers grouped by state, each group led by its
 *    symbol ({@link BLOCKER_SYMBOLS}): `🔴 #118 #119 🟢 #26`; in words,
 *    `open #118 #119 · closed #26`.
 *  - `has` — {@link hasText}: `plan, branch, pr #40`.
 *  - `refs` — {@link refsText}: how many references of the issue's saved
 *    copy read `suspect` or `dangling`, `0` for a clean copy, `?` for a
 *    copy that could not be read.
 *  - `title` — the issue's title; with no issue on the row, the Roadmap
 *    line's own `why`, so a row read while the board was unreachable
 *    still says what it is. It takes the rest of the line.
 *
 * The labels are no column. Their length pushed the title off a terminal
 * of any usual width, so they print only under {@link TableStyle.labels}
 * (`--labels`), on a row of their own under each issue, led by
 * {@link LABELS_LEAD} and indented to start under `state`, so the row
 * reads as belonging to the one above.
 *
 * ## Symbols, and the legend
 *
 * Symbols keep the two reading columns a few cells wide whatever the
 * reading, which is what leaves the title its room. A symbol that leads
 * text is followed by exactly {@link SYMBOL_GAP}, one space, so a symbol
 * and an issue number or a meaning never read as one word. Under the
 * table, {@link legendLines} names each symbol the table printed, and
 * only those, one line per column headed by the column's name, so a
 * reader never meets one unexplained. `--texts` (`-t`) spells both
 * columns in words instead and prints no legend.
 *
 * The words are written for someone who has never read rafa's source,
 * and name the stages a spec moves through: `outline only`, `needs
 * refinement`, `refined, waiting for approval`, `ready to dev`, and
 * `approved, needs refinement` where the label and the body disagree.
 * "Refined" is a body the readiness gate finds nothing missing in: every
 * heading of the spec template (`TEMPLATE_HEADINGS`,
 * `src/board/readiness.ts`) present and filled, and no placeholder left.
 * "Approved" is the `spec:ready` label, which a person adds through
 * `rafa issue ready <n>`. A green check was left out on purpose, because
 * it reads as done. Unchecked boxes are not read yet, and the words are
 * not yet config: #318 specifies both. The readiness gate's own words
 * (`label: none, gate: ready`) stay in the row reading's `specText` for
 * code that wants them, and are not printed here.
 *
 * ## An empty cell
 *
 * A cell with nothing to print is {@link EMPTY_CELL}, `-`, in every
 * column alike: no issue on the row (the board unreachable, or the
 * listing not holding it), no `Blocked by:` line, nothing in `has`, no
 * saved copy for `refs`, a label row for an issue with no labels, and a
 * title-less row with no `why`. A blank cell would leave a gap that
 * reads as a misaligned column, and one spelling for all keeps "nothing
 * here" one thing to look for.
 *
 * ## The width rule
 *
 * Columns are separated by {@link COLUMN_GAP}, each padded to its widest
 * cell or header, the last (`title`) unpadded, so a line is exactly as
 * wide as its content. Width is counted in terminal cells
 * (`Bun.stringWidth`): each symbol is two cells, as a terminal draws it,
 * so a column holding symbols stays aligned.
 *
 * With no terminal width — `process.stdout.columns` is undefined when
 * stdout is a pipe or a file, and so is anything but a positive whole
 * number here — nothing is cut: a capture holds every character.
 *
 * With a width and a table wider than it, `title` is cut, down to
 * {@link TITLE_FLOOR}; a cut cell ends with `…`. The other columns are
 * never cut: they are short by construction and are the reason the table
 * is printed. A table still wider than the terminal with the title at its
 * floor is printed as it then stands and wraps. A label row is cut to the
 * terminal's width, since the row above already says which issue it is.
 */
import type { BlockerCell, RoadmapRow, SpecReading, SpecReadingKind } from '../../board/roadmap-rows.js';

import { hasText, refsText } from '../../board/roadmap-rows.js';

/** What a cell with nothing to print holds; see the module note. */
export const EMPTY_CELL = '-';

/** What stands between two columns. */
export const COLUMN_GAP = '  ';

/** The narrowest `title` is cut to. */
export const TITLE_FLOOR = 20;

/** The narrowest a labels row or cell is cut to. */
export const LABELS_FLOOR = 12;

/** What leads a row of labels under its issue. */
export const LABELS_LEAD = '└→ ';

/**
 * What stands between a symbol and the text it leads — an issue number
 * in `blocked by`, a meaning in the legend: one space, always, so the
 * two never read as one word.
 */
export const SYMBOL_GAP = ' ';

/** What ends a cut cell. */
const ELLIPSIS = '…';

/** The eight columns, in order, as the header line spells them. */
export const ROADMAP_COLUMNS = Object.freeze([
  '#',
  'state',
  'type',
  'spec',
  'blocked by',
  'has',
  'refs',
  'title',
] as const);

/** How the table is spelled: `--labels` and `--texts`. */
export interface TableStyle {
  /** Print each issue's labels on a row of their own under it. */
  readonly labels: boolean;
  /** Spell `spec` and `blocked by` in words, with no legend. */
  readonly texts: boolean;
}

/** The style with neither switch: symbols, and no label rows. */
export const DEFAULT_STYLE: TableStyle = Object.freeze({ labels: false, texts: false });

/**
 * Each readiness reading's symbol, in the order the legend prints them:
 * the path a spec takes, then the label and body that disagree.
 */
export const SPEC_SYMBOLS: Readonly<Record<SpecReadingKind, string>> = Object.freeze({
  'outline': '📝',
  'gaps': '🚧',
  'unlabelled': '👀',
  'ready': '🚀',
  'stale-label': '🟠',
});

/** What each readiness symbol means, as the legend and `--texts` say it; see the module note. */
export const SPEC_MEANINGS: Readonly<Record<SpecReadingKind, string>> = Object.freeze({
  'outline': 'outline only',
  'gaps': 'needs refinement',
  'unlabelled': 'refined, waiting for approval',
  'ready': 'ready to dev',
  'stale-label': 'approved, needs refinement',
});

/** Each blocker state's symbol. */
export const BLOCKER_SYMBOLS: Readonly<Record<BlockerCell['state'], string>> = Object.freeze({
  open: '🔴',
  closed: '🟢',
  unknown: '❔',
});

/** What each blocker symbol means, as the legend says it. */
export const BLOCKER_MEANINGS: Readonly<Record<BlockerCell['state'], string>> = Object.freeze({
  open: 'still open',
  closed: 'closed',
  unknown: 'state unknown',
});

/** What heads each legend line: the column its symbols are read in, padded to the longer. */
const LEGEND_HEADS = Object.freeze({ spec: 'spec:', blockers: 'blocked by:' });

/**
 * The order blocker groups are printed in: what still blocks first. The
 * keys here spell `UNKNOWN_STATE` (`src/board/roadmap-rows.ts`) as its
 * literal: this module and that one import each other through the
 * command tree, and a value read from it while it loads is not there yet.
 */
const BLOCKER_ORDER: readonly BlockerCell['state'][] = ['open', 'unknown', 'closed'];

/** Where each column the width rule touches sits in {@link ROADMAP_COLUMNS}. */
const NUMBER_COLUMN = 0;
const TITLE_COLUMN = 7;

/** `text`, or {@link EMPTY_CELL} when it is empty. */
function cell(text: string): string {
  return text === ''
    ? EMPTY_CELL
    : text;
}

/** How wide `text` is, counted in terminal cells. */
export function widthOf(text: string): number {
  return Bun.stringWidth(text);
}

/** The title a row prints: the issue's, else the Roadmap line's `why`. */
function titleOf(row: RoadmapRow): string {
  return row.issue === null
    ? row.line.why
    : row.issue.title;
}

/**
 * The `spec` cell in words: the legend's meaning, with the sections
 * that need work named where there are some, as `needs refinement:
 * Design, Tasks the plan must carry`.
 */
export function specWords(reading: SpecReading): string {
  const missing = [...new Set(reading.gaps.map((gap) => gap.heading))];
  const meaning = SPEC_MEANINGS[reading.kind];
  return (reading.kind === 'gaps' || reading.kind === 'stale-label') && missing.length > 0
    ? `${meaning}: ${missing.join(', ')}`
    : meaning;
}

/** The `spec` cell in `style`. */
export function specCell(row: RoadmapRow, style: TableStyle): string {
  if (row.spec === null) return '';
  return style.texts
    ? specWords(row.spec)
    : SPEC_SYMBOLS[row.spec.kind];
}

/** The `blocked by` cell in `style`: the blockers grouped by state, what still blocks first. */
export function blockersCell(blockers: readonly BlockerCell[], style: TableStyle): string {
  const lead = (state: BlockerCell['state']): string => style.texts
    ? state
    : BLOCKER_SYMBOLS[state];
  const separator = style.texts
    ? ' · '
    : ' ';
  return BLOCKER_ORDER
    .map((state) => ({ state, references: blockers.filter((blocker) => blocker.state === state).map((blocker) => blocker.reference) }))
    .filter((group) => group.references.length > 0)
    .map((group) => `${lead(group.state)}${SYMBOL_GAP}${group.references.join(' ')}`)
    .join(separator);
}

/** One row's eight cells in `style`, uncut and unpadded. */
export function roadmapCells(row: RoadmapRow, style: TableStyle = DEFAULT_STYLE): readonly string[] {
  const state = row.issue === null
    ? ''
    : row.issue.state.toLowerCase();
  return Object.freeze([
    `#${String(row.line.issue)}`,
    cell(state),
    cell(row.issue?.type ?? ''),
    cell(specCell(row, style)),
    cell(blockersCell(row.blockers, style)),
    cell(hasText(row.has)),
    cell(refsText(row.refs)),
    cell(titleOf(row)),
  ]);
}

/** `text` cut to `width` terminal cells, ending with `…` when it was cut. */
export function cutCell(text: string, width: number): string {
  if (widthOf(text) <= width) return text;
  let kept = '';
  for (const point of text) {
    if (widthOf(`${kept}${point}${ELLIPSIS}`) > width) break;
    kept = `${kept}${point}`;
  }
  return `${kept}${ELLIPSIS}`;
}

/** True when `width` is one the width rule applies: a positive whole number. */
function isTerminalWidth(width: number | undefined): width is number {
  return width !== undefined && Number.isSafeInteger(width) && width > 0;
}

/**
 * Each column's width once the width rule has run over `natural`: the
 * widths as they are with no terminal width or when the table fits, else
 * `title` cut toward {@link TITLE_FLOOR}.
 */
export function fitColumnWidths(natural: readonly number[], width: number | undefined): readonly number[] {
  if (!isTerminalWidth(width)) return Object.freeze([...natural]);
  const total = natural.reduce((sum, column) => sum + column, 0) + COLUMN_GAP.length * (natural.length - 1);
  const title = natural[TITLE_COLUMN] ?? 0;
  const cut = Math.min(Math.max(0, total - width), Math.max(0, title - TITLE_FLOOR));
  return Object.freeze(natural.map((column, index) => index === TITLE_COLUMN
    ? column - cut
    : column));
}

/** One line of cells at `widths`: `#` right-aligned, the rest left, the last unpadded. */
function lineOf(cells: readonly string[], widths: readonly number[]): string {
  return cells.map((text, index) => {
    const width = widths[index] ?? 0;
    const cut = cutCell(text, width);
    if (index === cells.length - 1) return cut;
    const pad = ' '.repeat(Math.max(0, width - widthOf(cut)));
    return index === NUMBER_COLUMN
      ? `${pad}${cut}`
      : `${cut}${pad}`;
  }).join(COLUMN_GAP);
}

/** The labels row under an issue, starting `indent` cells in, cut to `width`. */
export function labelsLine(labels: readonly string[], indent: number, width: number | undefined): string {
  const line = `${' '.repeat(indent)}${LABELS_LEAD}${cell(labels.join(', '))}`;
  return isTerminalWidth(width)
    ? cutCell(line, Math.max(width, indent + widthOf(LABELS_LEAD) + LABELS_FLOOR))
    : line;
}

/**
 * The legend under a table in symbols: one line per column that printed
 * a symbol, headed by the column's name, naming each symbol it printed
 * and only those, with what it means; no line under `--texts`, nor for
 * a column that printed no symbol.
 */
export function legendLines(rows: readonly RoadmapRow[], style: TableStyle): string[] {
  if (style.texts) return [];
  const specs = Object.keys(SPEC_SYMBOLS) as SpecReadingKind[];
  const spec = specs
    .filter((kind) => rows.some((row) => row.spec?.kind === kind))
    .map((kind) => `${SPEC_SYMBOLS[kind]}${SYMBOL_GAP}${SPEC_MEANINGS[kind]}`);
  const blockers = BLOCKER_ORDER
    .filter((state) => rows.some((row) => row.blockers.some((blocker) => blocker.state === state)))
    .map((state) => `${BLOCKER_SYMBOLS[state]}${SYMBOL_GAP}${BLOCKER_MEANINGS[state]}`);
  const width = Math.max(LEGEND_HEADS.spec.length, LEGEND_HEADS.blockers.length);
  return [
    [LEGEND_HEADS.spec, spec] as const,
    [LEGEND_HEADS.blockers, blockers] as const,
  ]
    .filter(([, meanings]) => meanings.length > 0)
    .map(([head, meanings]) => `${head.padEnd(width)}${COLUMN_GAP}${meanings.join(COLUMN_GAP)}`);
}

/**
 * The lines text mode prints for `rows`: the header, then one line per
 * row in the order given, each followed by its labels row under
 * `--labels`, then the legend; the header alone when there is no row.
 * `width` is the terminal's, or undefined for none; see the module note
 * for what it cuts.
 */
export function renderRoadmapTable(rows: readonly RoadmapRow[], width?: number, style: TableStyle = DEFAULT_STYLE): string[] {
  const table = [[...ROADMAP_COLUMNS], ...rows.map((row) => roadmapCells(row, style))];
  const natural = ROADMAP_COLUMNS.map((_, index) => Math.max(...table.map((cells) => widthOf(cells[index] ?? ''))));
  const widths = fitColumnWidths(natural, width);
  const indent = (widths[NUMBER_COLUMN] ?? 0) + COLUMN_GAP.length;
  const lines = rows.flatMap((row, index) => {
    const line = lineOf(table[index + 1] ?? [], widths);
    return style.labels
      ? [line, labelsLine(row.issue?.labels ?? [], indent, width)]
      : [line];
  });
  return [lineOf(table[0] ?? [], widths), ...lines, ...legendLines(rows, style)];
}
