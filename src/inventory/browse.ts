/**
 * The browse view behind `rafa skill list -i` and `rafa agent list -i`:
 * the listed rows in a `select`, one row's show view in a `page`, and
 * that row's full context in a second `page`, moved between with keys.
 *
 * ## The views and the keys
 *
 * | View | Key | Goes to |
 * | --- | --- | --- |
 * | list | `up`, `down`, typing | stays: `select` moves and filters |
 * | list | `enter` | show, of the highlighted row |
 * | list | `q` with an empty filter, `escape` | quit |
 * | show | `f` | full context, of the same row |
 * | show | `escape` | list, the row shown highlighted |
 * | show | `q` | quit |
 * | full context | `escape` | show, of the same row |
 * | full context | `q` | quit |
 *
 * {@link transition} is that table and nothing else, so the moves are
 * measured without a terminal; {@link browse} runs a view for each
 * state and turns what the view ended on into the next event.
 *
 * Two readings the table settles that the plain rule ("typing filters,
 * `q` quits, Escape goes back") leaves open:
 *
 *   - **`q` in the list quits only while the filter is empty.** With a
 *     filter typed, `q` is one more filter character, so a name holding
 *     a `q` can still be typed. Browse keeps its own copy of the filter
 *     for this, from the same keys `select` reads: a character appends,
 *     `backspace` drops the last code point. `f` in the list is always
 *     a filter character.
 *   - **Escape in the list quits**, since the list is the first view and
 *     there is nothing behind it to go back to.
 *
 * The list reopens with its filter empty and the row last shown
 * highlighted.
 *
 * The show view is {@link renderShowView} over {@link readShowView}, so
 * a row reads here exactly as `rafa skill show` prints it, and a shadowed
 * row shows itself rather than the holder that shadows it. The full
 * context is the same view read with `full`, which carries the whole
 * file. The file is read each time a view opens.
 *
 * ## One key source for the whole browse
 *
 * `select` and `page` each read keys with `for await`, and leaving a
 * `for await` closes the iterator it read: measured on bun 1.3.14, a
 * second `select` over the async generator a first one answered from
 * reads no key and answers `null`. So browse opens the key source ONCE
 * and hands each view its own iterable over it ({@link viewKeys}), whose
 * closing leaves the shared source open, and closes the shared source
 * itself on the way out. A key a person typed ahead is therefore never
 * lost between views, and {@link stdinKeys}'s listener is removed however
 * browse ends.
 *
 * A key that switches away from a page view (`f`, `q`) is handed to the
 * view as `escape`, which is the one key that closes it; `select`'s `q`
 * is handed over the same way. A key source that ends quits from any
 * view rather than falling back through the list.
 *
 * ## Terminal
 *
 * Each view is its own raw-mode session (`rawSession` in
 * `cli/prompt/terminal.ts`), since sessions do not nest. Browse refuses
 * before opening the key source when there is no terminal, with the
 * caller's `instead` line, so `-i` can name `--output=json` and a piped
 * standard input is never read. `ctrl-c` in any view is the view's
 * `CommandExit` with exit code 130, passed on as it is.
 */
import type { InventoryRecord } from './record.js';
import type { Key, NoTerminalOptions, Terminal } from '../cli/prompt/terminal.js';

import { page } from '../cli/prompt/page.js';
import { select } from '../cli/prompt/select.js';
import { processTerminal, refuseWithoutTerminal, stdinKeys } from '../cli/prompt/terminal.js';

import { readShowView, renderShowView } from './show.js';

/** The key that quits from any view (in the list, only with an empty filter). */
export const QUIT_CHAR = 'q';

/** The key that opens the full context from the show view. */
export const FULL_CHAR = 'f';

/** The keys named after the list's message. */
export const LIST_KEYS_TEXT = '↑↓ move · type to filter · enter show · q quit';

/** The keys named on the show view's title line. */
export const SHOW_KEYS_TEXT = 'f full context · q quit';

/** The keys named on the full context's title line. */
export const FULL_KEYS_TEXT = 'q quit';

/** Where browse is: a view and the row it is on, or done. `at` is a position in the rows. */
export type BrowseState =
  | { readonly view: 'list'; readonly at: number }
  | { readonly view: 'show'; readonly at: number }
  | { readonly view: 'full'; readonly at: number }
  | { readonly view: 'quit' };

/** What a view ended on. */
export type BrowseEvent =
  | { readonly name: 'open'; readonly at: number }
  | { readonly name: 'full' }
  | { readonly name: 'back' }
  | { readonly name: 'quit' };

/** How browse shows the rows, and where it reads and writes. */
export interface BrowseOptions extends NoTerminalOptions {
  /** The list's question, followed by {@link LIST_KEYS_TEXT}. */
  readonly message: string;
  /** The rows listed, in order. */
  readonly rows: readonly InventoryRecord[];
  /** The whole inventory, for the show view's other holders. */
  readonly records: readonly InventoryRecord[];
  /** The rows' labels, one per row in order; {@link browseLabels} by default. */
  readonly labels?: (rows: readonly InventoryRecord[]) => readonly string[];
  /** Reads a definition file; the show view's default reader otherwise. */
  readonly read?: (path: string) => string;
  /** The most list rows shown at once; `select`'s default otherwise. */
  readonly pageSize?: number;
  /** The most lines a page view shows at once; `page`'s default otherwise. */
  readonly height?: number;
  /** The longest line a page view shows; `page`'s default otherwise. */
  readonly width?: number;
  /** The key source, opened once; {@link stdinKeys} by default. */
  readonly keys?: AsyncIterable<Key>;
  /** The terminal seam; {@link processTerminal} by default. */
  readonly terminal?: Terminal;
}

/** The state browse opens in. */
export const OPENING_STATE: BrowseState = { view: 'list', at: 0 };

/** The state after `event` in `state`; see the table in the module note. */
export function transition(state: BrowseState, event: BrowseEvent): BrowseState {
  if (state.view === 'quit' || event.name === 'quit') return { view: 'quit' };
  if (state.view === 'list') {
    if (event.name === 'open') return { view: 'show', at: event.at };
    if (event.name === 'back') return { view: 'quit' };
    return state;
  }
  if (state.view === 'show') {
    if (event.name === 'full') return { view: 'full', at: state.at };
    if (event.name === 'back') return { view: 'list', at: state.at };
    return state;
  }
  return event.name === 'back'
    ? { view: 'show', at: state.at }
    : state;
}

/** A row's default label: name, source and state, each column padded to its widest cell. */
export function browseLabels(rows: readonly InventoryRecord[]): readonly string[] {
  const cells = rows.map((row) => [row.name, row.source, row.state] as const);
  const nameWidth = Math.max(0, ...cells.map(([name]) => name.length));
  const sourceWidth = Math.max(0, ...cells.map(([, source]) => source.length));
  return cells.map(([name, source, state]) => `${name.padEnd(nameWidth)}  ${source.padEnd(sourceWidth)}  ${state}`);
}

/** The show view's title line. */
export function showTitle(record: InventoryRecord): string {
  return `[show] ${record.kind} ${record.name} (${record.source}) · ${SHOW_KEYS_TEXT}`;
}

/** The full context's title line. */
export function fullTitle(record: InventoryRecord): string {
  return `[full context] ${record.kind} ${record.name} (${record.source}) · ${FULL_KEYS_TEXT}`;
}

/** The one key source every view reads, and whether it has ended. */
interface KeyFeed {
  readonly next: () => Promise<Key | null>;
  readonly ended: () => boolean;
  readonly close: () => Promise<void>;
}

/** A feed over `keys`'s one iterator; `next` answers null once it ends. */
function openFeed(keys: AsyncIterable<Key>): KeyFeed {
  const iterator = keys[Symbol.asyncIterator]();
  let done = false;
  return {
    next: async () => {
      if (done) return null;
      const step = await iterator.next();
      if (step.done === true) {
        done = true;
        return null;
      }
      return step.value;
    },
    ended: () => done,
    close: async () => {
      done = true;
      await iterator.return?.();
    },
  };
}

/**
 * One view's keys over `feed`. A key `intercept` answers an event for is
 * recorded through `onEvent` and handed to the view as `escape`, which
 * closes it; closing this iterable leaves `feed` open.
 */
export function viewKeys(
  feed: Pick<KeyFeed, 'next'>,
  intercept: (key: Key) => BrowseEvent | null,
  onEvent: (event: BrowseEvent) => void,
): AsyncIterable<Key> {
  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const key = await feed.next();
        if (key === null) return;
        const event = intercept(key);
        if (event === null) {
          yield key;
          continue;
        }
        onEvent(event);
        yield { name: 'escape' };
        return;
      }
    },
  };
}

/** The list's interceptor: `q` quits while its copy of the filter is empty; see the module note. */
export function listIntercept(): (key: Key) => BrowseEvent | null {
  let filter = '';
  return (key) => {
    if (key.name === 'backspace') filter = [...filter].slice(0, -1).join('');
    if (key.name !== 'char') return null;
    if (filter === '' && key.char === QUIT_CHAR) return { name: 'quit' };
    filter = `${filter}${key.char}`;
    return null;
  };
}

/** The show view's interceptor: `f` opens the full context, `q` quits. */
function showIntercept(key: Key): BrowseEvent | null {
  if (key.name !== 'char') return null;
  if (key.char === FULL_CHAR) return { name: 'full' };
  if (key.char === QUIT_CHAR) return { name: 'quit' };
  return null;
}

/** The full context's interceptor: `q` quits. */
function fullIntercept(key: Key): BrowseEvent | null {
  return key.name === 'char' && key.char === QUIT_CHAR
    ? { name: 'quit' }
    : null;
}

/** What every view of one browse shares. */
interface BrowseRun {
  readonly options: BrowseOptions;
  readonly labels: readonly string[];
  readonly feed: KeyFeed;
  readonly terminal: Terminal;
}

/** The event a view ended on: the key it was switched away by, quit when the keys ended, back otherwise. */
function endedOn(run: BrowseRun, intercepted: BrowseEvent | null): BrowseEvent {
  if (intercepted !== null) return intercepted;
  return run.feed.ended()
    ? { name: 'quit' }
    : { name: 'back' };
}

/** Runs the list with row `at` highlighted; answers the event it ended on. */
async function runList(run: BrowseRun, at: number): Promise<BrowseEvent> {
  let intercepted: BrowseEvent | null = null;
  const keys = viewKeys(run.feed, listIntercept(), (event) => {
    intercepted = event;
  });
  const picked = await select({
    message: `${run.options.message} (${LIST_KEYS_TEXT})`,
    choices: run.labels.map((label, index) => ({ label, value: index })),
    initial: at,
    keys,
    terminal: run.terminal,
    ...(run.options.pageSize === undefined
      ? {}
      : { pageSize: run.options.pageSize }),
  });
  return picked === null
    ? endedOn(run, intercepted)
    : { name: 'open', at: picked };
}

/** Runs a page view of row `at`, full or not; answers the event it ended on. */
async function runPage(run: BrowseRun, at: number, full: boolean): Promise<BrowseEvent> {
  const record = run.options.rows[at];
  if (record === undefined) return { name: 'back' };
  let intercepted: BrowseEvent | null = null;
  const keys = viewKeys(run.feed, full
    ? fullIntercept
    : showIntercept, (event) => {
    intercepted = event;
  });
  const view = readShowView(record, run.options.records, {
    full,
    ...(run.options.read === undefined
      ? {}
      : { read: run.options.read }),
  });
  const { height, width } = run.options;
  await page({
    text: renderShowView(view).join('\n'),
    title: full
      ? fullTitle(record)
      : showTitle(record),
    keys,
    terminal: run.terminal,
    ...(height === undefined
      ? {}
      : { height }),
    ...(width === undefined
      ? {}
      : { width }),
  });
  return endedOn(run, intercepted);
}

/** Runs the view `state` names; answers the event it ended on. */
async function runView(run: BrowseRun, state: Exclude<BrowseState, { view: 'quit' }>): Promise<BrowseEvent> {
  if (state.view === 'list') return runList(run, state.at);
  return runPage(run, state.at, state.view === 'full');
}

/** Each row's label, refusing a labeller that answers the wrong count. */
function labelsOf(options: BrowseOptions): readonly string[] {
  const labels = (options.labels ?? browseLabels)(options.rows);
  if (labels.length !== options.rows.length) {
    throw new Error(`browse: ${String(labels.length)} label(s) for ${String(options.rows.length)} row(s)`);
  }
  return labels;
}

/**
 * Browses `options.rows` until a view quits or the keys end; answers
 * every state it was in, the opening list first and `quit` last. Refuses
 * without a terminal before reading a key, and passes `ctrl-c`'s
 * `CommandExit` on; see the module note.
 */
export async function browse(options: BrowseOptions): Promise<readonly BrowseState[]> {
  const terminal = options.terminal ?? processTerminal();
  const refusal: NoTerminalOptions = options.instead === undefined
    ? {}
    : { instead: options.instead };
  refuseWithoutTerminal(terminal, refusal);
  const labels = labelsOf(options);
  const feed = openFeed(options.keys ?? stdinKeys());
  const run: BrowseRun = { options, labels, feed, terminal };
  const trail: BrowseState[] = [OPENING_STATE];
  try {
    let state = OPENING_STATE;
    while (state.view !== 'quit') {
      state = transition(state, await runView(run, state));
      trail.push(state);
    }
    return trail;
  } finally {
    await feed.close();
  }
}
