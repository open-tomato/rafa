/**
 * Derives what a session was dispatched to DO from the prompt it was
 * handed, so a cost report can separate the loop's own traffic from
 * everything else sharing the log directory.
 *
 * A session's prompt is the `content` of its first
 * `type: queue-operation` / `operation: enqueue` record. Measured over
 * the live tree, that record is record 0 for all but a couple of files,
 * where a desktop-driven session emits `mode` and `atis-latch` records
 * ahead of it. So this module keys on the type/operation PAIR inside a
 * small window rather than on a position: a reader keyed on record 0
 * would report those two as having no prompt at all, which reads as a
 * malformed log rather than as a session that started differently.
 *
 * The five shapes below are THIS repo's own, each derived from the
 * source that injects it rather than transcribed from a log. That
 * distinction is the whole reason this module exists as code instead of
 * a regex someone carried across: the reference implementation this
 * collector is modelled on matches loop sessions on a phrase-shaped
 * needle of its own, and over the whole live tree here that needle
 * answers ZERO first-enqueue hits while the `Your scoped task is: `
 * prefix answers every task session. A port that kept the needle would
 * collect nothing and report a clean, plausible, entirely empty run.
 * The colocated test pins both halves — the foreign needle matching
 * none of the five shapes, and this repo's own prefix matching through
 * the identical matcher, which is what makes that zero a reading rather
 * than a dead needle.
 *
 * A second guard runs in the same test file: every shape's prefix is
 * asserted present in the source file named on its record. The prompts
 * are ordinary string literals in `start.ts` and `plan-prompt.md` with
 * nothing tying them to this module, so an edit there would otherwise
 * silently re-bucket every later session as `other`.
 *
 * Snapshot at the time of writing, over 896 loose session logs — the
 * counts move with every run and are meant to be re-derived, the SHAPE
 * has not moved: 858 `task`, 14 `plan-generation`, 10 `wrap-up`, 0
 * `ci-repair`, 0 `compaction` and 14 `other`, with no file lacking an
 * enqueue record inside the window. The `other` bucket is hand-driven
 * and measurement traffic, this plan's own context probes among it — a
 * plan that measures the loop pollutes what it measures, which is why
 * `entrypoint` rather than prompt shape is the discriminator for that
 * question. `ci-repair` and `compaction` at zero are honest rather than
 * broken: both prompts are newer than every session in the tree, so
 * they are the two shapes whose only evidence is the drift guard
 * against their source.
 *
 * Nothing here puts prompt content into a classification. The kind, the
 * record index and a line count are the whole result, so a store fed
 * from it can never become a second copy of a transcript.
 * {@link findFirstEnqueue} does answer content, because attribution
 * needs it — that is a deliberate seam and the reason the two are
 * separate functions.
 */
import { readLines } from './session-log.js';

/** What a session was dispatched to do. */
export type SessionKind =
  | 'task'
  | 'plan-generation'
  | 'compaction'
  | 'wrap-up'
  | 'ci-repair'
  | 'other';

/** The five kinds the loop itself dispatches; `other` is the residue. */
export type LoopSessionKind = Exclude<SessionKind, 'other'>;

/** One recognised prompt shape, and where its literal is authored. */
export interface PromptShape {
  /** The kind a matching prompt classifies as. */
  kind: LoopSessionKind;
  /** Short human label, for a report column. */
  label: string;
  /** Literal the prompt content begins with. */
  prefix: string;
  /**
   * A second literal that must also appear on the content's FIRST LINE,
   * or null when the prefix alone is decisive. Only the CI-repair shape
   * needs one: its prefix is followed by an interpolated branch name
   * and PR number before the part that identifies it.
   */
  firstLineInfix: string | null;
  /** Repo-relative path of the file that injects this prompt. */
  source: string;
}

/**
 * The recognised shapes, checked in order.
 *
 * Order is not load-bearing — no prefix here is a prefix of another, so
 * at most one shape can match any content, and the test asserts that
 * pairwise rather than leaving it to inspection.
 */
export const PROMPT_SHAPES: readonly PromptShape[] = [
  {
    kind: 'task',
    label: 'task',
    prefix: 'Your scoped task is: ',
    firstLineInfix: null,
    source: 'tools/ralph/start.ts',
  },
  {
    kind: 'plan-generation',
    label: 'plan generation',
    prefix: '# Plan-generation instructions',
    firstLineInfix: null,
    source: 'tools/ralph/plan-prompt.md',
  },
  {
    kind: 'wrap-up',
    label: 'wrap-up',
    prefix: '* Read `@progress.txt` in full.',
    firstLineInfix: null,
    source: 'tools/ralph/start.ts',
  },
  {
    kind: 'ci-repair',
    label: 'CI repair',
    prefix: 'The pull request for branch ',
    firstLineInfix: ' is not mergeable: ',
    source: 'tools/ralph/start.ts',
  },
  {
    kind: 'compaction',
    label: 'compaction',
    prefix: '* Compact `@progress.txt` per ',
    firstLineInfix: null,
    source: 'tools/ralph/start.ts',
  },
];

/**
 * How many non-empty lines to read before giving up on finding an
 * enqueue record.
 *
 * Measured, the enqueue sits at record 0 or record 2, so ten lines is
 * several times the observed worst case while still bounding the read
 * to the head of a file that can be hundreds of megabytes. The budget
 * counts LINES rather than records on purpose: an unparseable line has
 * to cost something, or a malformed head could hold the scan open.
 */
export const ENQUEUE_SCAN_WINDOW = 10;

/** What the head-of-file scan found, whether or not it found a prompt. */
export interface EnqueueLookup {
  /**
   * The enqueue record's `content`, or null — which covers both no
   * enqueue record inside the window and one whose content is not a
   * string. {@link EnqueueLookup.recordIndex} separates the two.
   */
  content: string | null;
  /** Index of the enqueue among PARSED records, or null if none. */
  recordIndex: number | null;
  /** Non-empty lines read before the scan stopped. */
  linesScanned: number;
}

/** The classification of one session; carries no prompt content. */
export interface SessionClassification {
  kind: SessionKind;
  /** Index of the enqueue among parsed records, or null if none. */
  enqueueRecordIndex: number | null;
  /** Non-empty lines read before the scan stopped. */
  linesScanned: number;
}

type JsonObject = Record<string, unknown>;

/** Narrows to a plain JSON object; arrays and scalars answer null. */
function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/** One line to a JSON object, or null for the two ways that can fail. */
function parseRecord(line: string): JsonObject | null {
  try {
    return asObject(JSON.parse(line));
  } catch {
    return null;
  }
}

/** The content up to its first line break, or all of it if there is none. */
function firstLineOf(content: string): string {
  const breakAt = content.indexOf('\n');
  return breakAt === -1
    ? content
    : content.slice(0, breakAt);
}

/** Whether one prompt content matches one shape. */
export function matchesShape(content: string, shape: PromptShape): boolean {
  if (!content.startsWith(shape.prefix)) return false;
  if (shape.firstLineInfix === null) return true;
  return firstLineOf(content).includes(shape.firstLineInfix);
}

/**
 * Classifies prompt content against the five shapes.
 *
 * Anything that matches none of them is `other` rather than an error:
 * the log directory holds hand-driven sessions and measurement probes
 * as well as the loop's own, and those are a legitimate bucket to
 * report rather than a fault to raise.
 */
export function classifyPromptContent(
  content: string | null | undefined,
): SessionKind {
  if (typeof content !== 'string' || content.length === 0) return 'other';

  for (const shape of PROMPT_SHAPES) {
    if (matchesShape(content, shape)) return shape.kind;
  }
  return 'other';
}

/**
 * Reads the head of a session's line source for its enqueue record.
 *
 * Stops at the first match, so a consumer driving this over
 * {@link readLines} tears the stream down after a handful of lines
 * rather than reading the file. The scan is keyed on the type/operation
 * pair, never on a position.
 */
export async function findFirstEnqueue(
  lines: AsyncIterable<string>,
  scanWindow: number = ENQUEUE_SCAN_WINDOW,
): Promise<EnqueueLookup> {
  let linesScanned = 0;
  let recordIndex = 0;

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (linesScanned >= scanWindow) break;
    linesScanned += 1;

    const record = parseRecord(line);
    if (record === null) continue;

    if (
      record['type'] === 'queue-operation'
      && record['operation'] === 'enqueue'
    ) {
      const content = record['content'];
      return {
        content: typeof content === 'string'
          ? content
          : null,
        recordIndex,
        linesScanned,
      };
    }
    recordIndex += 1;
  }

  return { content: null, recordIndex: null, linesScanned };
}

/**
 * Classifies a session from its line source.
 *
 * Split from {@link classifySessionLog} so the fold is drivable from a
 * generator in a test without touching disk, matching the seam the
 * session-log reader uses.
 */
export async function classifySessionLines(
  lines: AsyncIterable<string>,
  scanWindow: number = ENQUEUE_SCAN_WINDOW,
): Promise<SessionClassification> {
  const found = await findFirstEnqueue(lines, scanWindow);

  return {
    kind: classifyPromptContent(found.content),
    enqueueRecordIndex: found.recordIndex,
    linesScanned: found.linesScanned,
  };
}

/** Classifies a session log on disk, reading only its head. */
export async function classifySessionLog(
  filePath: string,
  scanWindow: number = ENQUEUE_SCAN_WINDOW,
): Promise<SessionClassification> {
  return classifySessionLines(readLines(filePath), scanWindow);
}
