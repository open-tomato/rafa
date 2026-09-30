/**
 * The epic context `plan create` hands the planner: the epic a spec issue
 * belongs to, with the epic's number, title and acceptance criteria. In
 * `labels` mode, the default, it is found by the issue's `epic:<slug>`
 * label; in `native` mode, by its sub-issue parent (see "The mode").
 *
 * In `labels` mode an epic is an issue labelled `type:epic` and `epic:<slug>`, and its
 * members are the issues carrying that `epic:<slug>` label
 * (`./epics.ts`). The spec issue's labels are already in hand when
 * `plan create` runs under `--issue` or `--next`, so the slug costs no
 * read; the epic costs ONE:
 *
 * ```
 * gh issue list --state all --label type:epic --label epic:<slug> --limit 20 --json number,title,body,state,stateReason,labels
 * ```
 *
 * `--state all` because membership is the label and not the epic's
 * state: a closed epic still owns its criteria, and a closed epic and an
 * open one sharing a slug are the ambiguity warned about below rather
 * than one silently chosen. The rows are checked by
 * `./roadmap-board.ts`'s {@link parseBoardListing}, the board listing's
 * own rule, so a row missing a field is refused the same way there and
 * here. The criteria are {@link readEpicBody}'s reading of the body,
 * kept verbatim.
 *
 * ## The mode
 *
 * Which epic the spec issue is in is a relationship, read in the mode
 * `board.relationships` names through the board's relationships port
 * (`./relations/port.ts`), {@link EpicContextOptions.relations}; left
 * out, the mode is `labels` (`LABELS_READS`), what every caller before
 * the port read.
 *
 * - In `labels` mode the epic is found by the issue's `epic:<slug>`
 *   label with the one command above, and everything below reads as it
 *   did before the port.
 * - In `native` mode no `epic:` label is read and no `--label` list is
 *   sent: the epic is the issue's sub-issue `parent`, read by the port's
 *   `epicOf` over the board listing, and its title and body are the
 *   parent's row on that listing. The listing is
 *   {@link EpicContextOptions.listing} when the caller holds one, and
 *   costs no read; otherwise it is ONE board listing read in the native
 *   mode (`createGhBoardListing`, `./roadmap-board.ts`). A native epic
 *   is named by its number and title, so {@link EpicContext.slug} is
 *   null.

 * ## Null, and when it warns
 *
 * {@link readEpicContext} never throws and never refuses: the epic is
 * context for the planner, and a plan made without it is the plan made
 * before epics existed. It answers null in five cases:
 *
 * - the issue carries no `epic:` label: SILENTLY, sending nothing,
 *   because a spec outside any epic is the ordinary case and its prompt
 *   must stay byte-identical to the one made before epics;
 * - the issue carries two or more `epic:` labels, sending nothing: a
 *   warning names them, since the issue is in two epics and neither is
 *   picked;
 * - no `type:epic` issue carries the slug: a warning names the label;
 * - two or more do: a warning names every epic found;
 * - the command failed or answered anything but a list of issues: a
 *   warning carries the refusal.
 *
 * In `native` mode it answers null SILENTLY for an issue with no parent,
 * the ordinary case, and after one warning when the listing read failed
 * or lacks the native fields, when the listing holds no row for the
 * issue, or when its parent is no epic on the listing (another
 * repository's issue, or a row not typed `epic`).
 *
 * An epic found whose body has no criteria section is still answered,
 * with `criteria` null, and without a warning: the missing section is a
 * body problem `rafa doctor` reports, and the number and title are
 * still context.
 *
 * Nothing here spawns: the command goes through the {@link GhRunner}
 * seam, and every case in `./epic-context.test.ts` and
 * `./epic-context-native.test.ts` plants the answer it reads.
 */
import type { EpicRelations } from './epics.js';
import type { BoardIssue } from './roadmap-board.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Output } from '../ports/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';

import { readEpicBody } from './epic-body.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf } from './epics.js';
import { LABELS_READS } from './relations/labels.js';
import { BOARD_LIST_FIELDS, createGhBoardListing, parseBoardListing } from './roadmap-board.js';

/** The label every epic issue carries. */
export const EPIC_TYPE_LABEL = 'type:epic';

/** How many epics the lookup lists: enough to name every epic sharing a slug. */
export const EPIC_CONTEXT_LIMIT = 20;

/** What every warning opens with. */
const PREFIX = 'epic context';

/** The epic a spec issue belongs to, as the planner is given it. */
export interface EpicContext {
  /** The epic issue's number. */
  readonly number: number;
  /** The epic issue's title. */
  readonly title: string;
  /** The slug its `epic:` label and the spec issue's share; null in `native` mode, where an epic has none. */
  readonly slug: string | null;
  /** The acceptance criteria, verbatim, or null when the body has none. */
  readonly criteria: string | null;
}

/** What {@link readEpicContext} reads. */
export interface EpicContextOptions {
  /** The spec issue's number, for a warning. */
  readonly issue: number;
  /** Every label on the spec issue. */
  readonly labels: readonly string[];
  /** Runs the one `gh` command the lookup sends. */
  readonly gh: GhRunner;
  /** Where a warning goes; the active output when left out. */
  readonly output?: Output;
  /** The board's relationships, which read the issue's epic; `labels` mode when left out. */
  readonly relations?: EpicRelations;
  /**
   * The board listing the caller already holds, read in the `native`
   * mode; read by `native` only, which lists the board once when it is
   * left out. See the module note.
   */
  readonly listing?: readonly BoardIssue[];
}

/** The arguments the `labels`-mode lookup hands `gh` for `slug`. */
export function epicContextArgs(slug: string): readonly string[] {
  return Object.freeze([
    'issue', 'list',
    '--state', 'all',
    '--label', EPIC_TYPE_LABEL,
    '--label', `${EPIC_LABEL_PREFIX}${slug}`,
    '--limit', String(EPIC_CONTEXT_LIMIT),
    '--json', BOARD_LIST_FIELDS,
  ]);
}

/** `#1, #2` for a warning. */
function numbersOf(numbers: readonly number[]): string {
  return numbers.map((number) => `#${String(number)}`).join(', ');
}

/** The one epic `slug` names, or null after warning why there is none. */
async function findEpic(slug: string, options: EpicContextOptions, output: Output): Promise<EpicContext | null> {
  const id = `issue #${String(options.issue)}`;
  const label = `${EPIC_LABEL_PREFIX}${slug}`;
  const args = epicContextArgs(slug);
  const command = `gh ${args.join(' ')}`;
  const result = await options.gh(args);
  if (!result.ok) {
    const written = result.stderr.trim() || result.stdout.trim() || 'nothing';
    output.warn(`${PREFIX}: ${command} failed (${written}); ${id} is planned without its epic`);
    return null;
  }
  let epics;
  try {
    epics = parseBoardListing(result.stdout, command);
  } catch (error) {
    output.warn(`${PREFIX}: ${messageOf(error)}; ${id} is planned without its epic`);
    return null;
  }
  const [epic, ...others] = epics;
  if (epic === undefined) {
    output.warn(`${PREFIX}: ${id} carries "${label}" but no "${EPIC_TYPE_LABEL}" issue does; it is planned without an epic`);
    return null;
  }
  if (others.length > 0) {
    const found = numbersOf(epics.map((each) => each.number));
    output.warn(`${PREFIX}: ${id} carries "${label}" and ${String(epics.length)} epics carry it (${found}); it is planned without an epic`);
    return null;
  }
  return Object.freeze({ number: epic.number, title: epic.title, slug, criteria: readEpicBody(epic.body).criteria });
}

/** The board listing the `native` mode reads: the caller's, or one listing read over `options.gh`. */
function nativeListing(options: EpicContextOptions): Promise<readonly BoardIssue[]> {
  return options.listing === undefined
    ? createGhBoardListing({ gh: options.gh, mode: 'native' })()
    : Promise.resolve(options.listing);
}

/** The epic the spec issue's `parent` names on `listing`, or null, silently or after one warning; see the module note. */
function nativeEpicOn(listing: readonly BoardIssue[], options: EpicContextOptions, relations: EpicRelations, output: Output): EpicContext | null {
  const id = `issue #${String(options.issue)}`;
  const row = listing.find((each) => each.number === options.issue);
  if (row === undefined) {
    output.warn(`${PREFIX}: the board listing holds no ${id}; it is planned without its epic`);
    return null;
  }
  const epicOf = relations.read(listing).epicOf(row);
  if (epicOf.kind === 'none') return null;
  if (epicOf.kind === 'unresolved') {
    const marks = epicOf.marks.map((each) => each.mark).join(', ');
    output.warn(`${PREFIX}: ${id}'s parent ${marks} is no epic on the board; it is planned without an epic`);
    return null;
  }
  const epic = listing.find((each) => each.number === epicOf.epic);
  if (epic === undefined) return null;
  return Object.freeze({ number: epic.number, title: epic.title, slug: null, criteria: readEpicBody(epic.body).criteria });
}

/** The `native`-mode lookup: the issue's parent on the board listing; never throws. */
async function readNativeEpicContext(options: EpicContextOptions, relations: EpicRelations): Promise<EpicContext | null> {
  const output = options.output ?? activeOutput();
  try {
    return nativeEpicOn(await nativeListing(options), options, relations, output);
  } catch (error) {
    output.warn(`${PREFIX}: ${messageOf(error)}; issue #${String(options.issue)} is planned without its epic`);
    return null;
  }
}

/**
 * The epic the spec issue belongs to, with its criteria, or null. In
 * `labels` mode, the one its `epic:` label names: null silently for an
 * issue with no such label, after one warning otherwise, sending at most
 * one `gh` command. In `native` mode, its `parent` on the board listing.
 * See the module note.
 */
export async function readEpicContext(options: EpicContextOptions): Promise<EpicContext | null> {
  const relations = options.relations ?? LABELS_READS;
  if (relations.mode === 'native') return readNativeEpicContext(options, relations);
  const slugs = epicSlugsOf(options.labels);
  const [slug, ...others] = slugs;
  if (slug === undefined) return null;
  const output = options.output ?? activeOutput();
  if (others.length > 0) {
    const labels = slugs.map((each) => `"${EPIC_LABEL_PREFIX}${each}"`).join(', ');
    output.warn(`${PREFIX}: issue #${String(options.issue)} carries ${String(slugs.length)} epic labels (${labels}); it is planned without an epic`);
    return null;
  }
  return findEpic(slug, options, output);
}
