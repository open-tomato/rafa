/**
 * `describe()`: the package's roster as JSON, for the rafa help layer.
 * Nothing in this package is a `RafaCommand`; `rafa-atlas` reaches it
 * through `rafa module exec` and renders this document into its
 * `--help` text, organised by subject (see the package README).
 */
import { CARD_MODES, MODAL_KEYS, TIME_RANGES, type CardMode, type ModalKey, type TimeRange } from './schemas.js';

/** The schema version of the document; bumped when a field changes meaning. */
export const DESCRIBE_SCHEMA_VERSION = 1;

/** The modal keys `CardLayout` wires to the menu; defined beside the schemas, re-exported here. */
export { MODAL_KEYS };
export type { ModalKey };

/** One roster line: a name and a one-line summary. */
export interface DescribeEntry<Name extends string = string> {
  readonly name: Name;
  readonly summary: string;
}

/** The whole document. */
export interface DescribeDocument {
  readonly schemaVersion: number;
  readonly package: string;
  readonly cards: readonly DescribeEntry[];
  readonly modes: readonly DescribeEntry<CardMode>[];
  readonly modalKeys: readonly DescribeEntry<ModalKey>[];
  readonly ranges: readonly DescribeEntry<TimeRange>[];
  readonly options: readonly DescribeEntry[];
}

/** The package name the document is about. */
const PACKAGE_NAME = '@open-tomato/atlas-ui';

const MODE_SUMMARIES: Readonly<Record<CardMode, string>> = {
  dashboard: 'DashboardCard: static cards over one page-wide result set and range; refresh by page or by card.',
  widget: 'WidgetCard: a predefined card fed by the consumer\'s own transport; menu and modals on, no fetching.',
  snapshot: 'SnapshotCard: static spec and data, rendered once with no menu, modals or animation; renders on the server.',
  report: 'ReportCard: every layer present, per-card data through CardData and a Config modal over the descriptor.',
};

const MODAL_SUMMARIES: Readonly<Record<ModalKey, string>> = {
  info: 'The card\'s description, notes, legend and source line.',
  source: 'The data behind the chart as a table, under its source line.',
  config: 'A form over the card\'s descriptor (report mode).',
  errors: 'What the card\'s boundary caught; listed only after a throw.',
  maximise: 'The card at full size, for labels a small card hides.',
};

const RANGE_SUMMARIES: Readonly<Record<TimeRange, string>> = {
  'now': 'The latest reading only.',
  'last-week': 'The seven days before today.',
  'past-month': 'The thirty days before today.',
  'last-year': 'The twelve months before today.',
};

const OPTIONS: readonly DescribeEntry[] = [
  { name: 'mode', summary: 'One of the four modes; decides which cascade layers are present.' },
  { name: 'range', summary: 'The time range a dashboard or a report card reads.' },
  { name: 'span', summary: 'How many grid columns the card takes: one, two or full.' },
  { name: 'legend', summary: 'The legend mark (rect or line) and whether its entries hide series.' },
  { name: 'modals', summary: 'The built-in modal keys the menu offers; all that apply when absent.' },
  { name: 'menu', summary: 'Labels and icons for menu entries, by modal key.' },
  { name: 'maximise', summary: 'The box size the maximise entry opens at (medium or large), and whether its legend and table show always, behind a toggle, or behind a toggle that starts on.' },
];

/** Roster lines for `names`, in order, from `summaries`. */
function entries<Name extends string>(
  names: readonly Name[],
  summaries: Readonly<Record<Name, string>>,
): DescribeEntry<Name>[] {
  return names.map((name) => ({ name, summary: summaries[name] }));
}

/** The roster as a fresh, JSON-safe document. `cards` stays empty until cards move in. */
export function describe(): DescribeDocument {
  return {
    schemaVersion: DESCRIBE_SCHEMA_VERSION,
    package: PACKAGE_NAME,
    cards: [],
    modes: entries(CARD_MODES, MODE_SUMMARIES),
    modalKeys: entries(MODAL_KEYS, MODAL_SUMMARIES),
    ranges: entries(TIME_RANGES, RANGE_SUMMARIES),
    options: OPTIONS.map((option) => ({ ...option })),
  };
}
