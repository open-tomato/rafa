/**
 * Streaming reader for one Claude Code session log.
 *
 * A session log is newline-delimited JSON: one record per line,
 * appended as the session runs. The tree behind this repo is roughly a
 * gigabyte across several hundred files, so the collector can never
 * afford to hold one — this module reads line by line and folds each
 * record into a fixed-size accumulator. That is the only shape whose
 * memory is bounded by the number of DISTINCT VALUES a session saw
 * (branches, entrypoints, models) rather than by how long it ran.
 *
 * The row carries counters and identifiers ONLY. No prompt, no tool
 * output, no message content of any kind reaches it, so the store it
 * feeds can never become a second copy of a transcript.
 *
 * Record shape, measured against the live tree rather than assumed.
 * The counts move with every run; the shape has not:
 *
 *   - Every record carries `type` — measured, not one of the tree's
 *     records is missing it. The SET is open: a loop session emits
 *     five spellings (`assistant`, `user`, `attachment`,
 *     `queue-operation`, `last-prompt`) and a desktop-driven one adds
 *     six more (`atis-latch`, `custom-title`, `pr-link`, `mode`,
 *     `bridge-session`, `system`). The row bins by whatever type it
 *     finds rather than against a fixed list, so a kind that has not
 *     been seen yet is counted rather than dropped.
 *   - `timestamp`, `gitBranch`, `entrypoint`, `isSidechain` and
 *     `effort` sit at the record's TOP level, not under `message`.
 *     `queue-operation` and `last-prompt` records carry none of the
 *     last four, so a reader keying branch attribution on every
 *     record must tolerate their absence rather than treat it as a
 *     fault.
 *   - `effort` rides on assistant records and on exactly those, the
 *     way `message.usage` does. A record without one is NOT
 *     necessarily a synthetic turn, which is the reading this
 *     line used to carry: measured over 905 logs, 38 assistant
 *     turns carry no `effort` against 28 whose model is
 *     `<synthetic>`, and the missing 10 are exactly the
 *     `claude-haiku-4-5-20251001` turns, whose records carry no
 *     `effort` field at all. The identity that holds is
 *     `effortless == synthetic + haiku` (measured 38 == 38), and
 *     every figure in it is a SNAPSHOT: the tree grows while it is
 *     being scanned, this session's own log included, so re-derive
 *     the pair rather than holding a run against it. What has not
 *     moved is the SHAPE, and the histogram being ONE-VALUED
 *     (`xhigh` throughout) is what makes the field worth collecting
 *     rather than what makes it pointless: a task declaration asking
 *     for a cheaper level shows up here as a second key, and nothing
 *     else in the tree records what a dispatched session ran at.
 *   - `message.model` and `message.usage` ride on `assistant`
 *     records, and on exactly those: over the live tree the count of
 *     records carrying a `usage` equals the count of assistant
 *     records to the record. A synthetic record — an API error the
 *     harness materialises as a turn — names a synthetic model and
 *     carries a `usage` whose counters are all zero, so it inflates
 *     the turn count and nothing else.
 *   - `message.usage` holds nine numeric counters across three
 *     levels: four at the top, two under `cache_creation`, two under
 *     `server_tool_use`, and `thinking_tokens` under
 *     `output_tokens_details`. Its remaining members are not
 *     counters — `service_tier`, `inference_geo` and `speed` are
 *     strings, `iterations` is a list.
 *
 * The `cache_creation` split is exact rather than indicative — over
 * every usage record in the tree,
 * `ephemeral_1h + ephemeral_5m === cache_creation_input_tokens` — so a
 * report can hold the two summed ephemeral counters against the summed
 * cache-write counter as a free reading on its own arithmetic.
 *
 * A row carries its own arithmetic cross-check:
 * `recordCount + unparsedLineCount === lineCount`. A live session's
 * last line can be half-written, so an unparsed line is expected data
 * rather than a failure — it is COUNTED, never dropped silently.
 */
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * Every numeric counter under a record's `message.usage`, summed over
 * the whole session. Names are the camelCase of the wire spelling;
 * the two `ephemeral*` members are the `cache_creation` split and the
 * two `*Requests` members the `server_tool_use` one.
 */
export interface SessionUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  ephemeral1hInputTokens: number;
  ephemeral5mInputTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
  thinkingTokens: number;
}

/** One accumulated stats row per session log. */
export interface SessionStats {
  /** Log basename without its extension, which is the session uuid. */
  sessionId: string;
  /** The path the row was accumulated from. */
  filePath: string;
  /** Non-empty lines read. */
  lineCount: number;
  /** Lines that parsed to a JSON object. */
  recordCount: number;
  /** Lines that did not — malformed JSON, or JSON that is not an object. */
  unparsedLineCount: number;
  /** Records by top-level `type`; an absent type is keyed as `unknown`. */
  recordTypeCounts: Record<string, number>;
  /** Records with `type: assistant`, which are the billable turns. */
  assistantRecordCount: number;
  /** Earliest and latest `timestamp` by instant, not by file order. */
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  /** Records per top-level `gitBranch`, the plan-attribution field. */
  gitBranchCounts: Record<string, number>;
  /** Records per `entrypoint`; separates loop from hand-driven traffic. */
  entrypointCounts: Record<string, number>;
  /** Records per top-level `effort`; what a session actually ran at. */
  effortCounts: Record<string, number>;
  /** Records carrying `isSidechain: true`, which are subagent turns. */
  sidechainRecordCount: number;
  /** Records per `message.model`. */
  modelCounts: Record<string, number>;
  /** Summed `message.usage` counters. */
  usage: SessionUsageTotals;
}

/** Where a row's identity comes from — never from the records themselves. */
export interface SessionIdentity {
  sessionId: string;
  filePath: string;
}

/**
 * The accumulator is the row plus the two epochs the timestamp
 * comparison needs. It is mutated in place and never escapes
 * `accumulateSessionStats`, which is what keeps a per-line fold from
 * allocating a fresh row per record over a million-line tree.
 */
interface Accumulator extends SessionStats {
  firstEpoch: number | null;
  lastEpoch: number | null;
}

type JsonObject = Record<string, unknown>;

/** Zeroed totals, one fresh object per call so no row shares a counter. */
export function emptyUsageTotals(): SessionUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ephemeral1hInputTokens: 0,
    ephemeral5mInputTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    thinkingTokens: 0,
  };
}

/** Narrows to a plain JSON object; arrays and scalars answer null. */
function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/** A counter reads as 0 unless it is a finite number on the wire. */
function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : 0;
}

/** A non-empty string, or null — an empty label is no label. */
function asLabel(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? value
    : null;
}

/** Increments one key of a histogram, seeding it on first sight. */
function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Derives the row key from the path; records are never trusted for it. */
export function sessionIdFromPath(filePath: string): string {
  return basename(filePath).replace(/\.jsonl$/i, '');
}

/**
 * Reads a session log one line at a time.
 *
 * `createInterface` over a read stream is what makes this bounded: the
 * file is pulled in stream chunks and split by the interface, so no
 * step ever holds more than one line plus one chunk. `crlfDelay:
 * Infinity` folds a CRLF pair into a single break, and a final line
 * with no trailing newline is still yielded.
 */
export async function* readLines(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      yield line;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Folds the top-level identity fields of one record into the row. */
function applyIdentityFields(acc: Accumulator, record: JsonObject): void {
  bump(acc.recordTypeCounts, asLabel(record['type']) ?? 'unknown');
  if (record['type'] === 'assistant') acc.assistantRecordCount += 1;
  if (record['isSidechain'] === true) acc.sidechainRecordCount += 1;

  const branch = asLabel(record['gitBranch']);
  if (branch !== null) bump(acc.gitBranchCounts, branch);

  const entrypoint = asLabel(record['entrypoint']);
  if (entrypoint !== null) bump(acc.entrypointCounts, entrypoint);

  const effort = asLabel(record['effort']);
  if (effort !== null) bump(acc.effortCounts, effort);
}

/**
 * Widens the row's time span to cover this record.
 *
 * The comparison is by parsed INSTANT and not by string order: these
 * timestamps carry a variable-length fractional part, so a lexical
 * compare puts a coarser stamp after a finer one at the same second.
 * Records also arrive interleaved once subagents are running, so
 * first-seen and last-seen are not the span either.
 */
function applyTimestamp(acc: Accumulator, record: JsonObject): void {
  const timestamp = asLabel(record['timestamp']);
  if (timestamp === null) return;

  const epoch = Date.parse(timestamp);
  if (Number.isNaN(epoch)) return;

  if (acc.firstEpoch === null || epoch < acc.firstEpoch) {
    acc.firstEpoch = epoch;
    acc.firstTimestamp = timestamp;
  }
  if (acc.lastEpoch === null || epoch > acc.lastEpoch) {
    acc.lastEpoch = epoch;
    acc.lastTimestamp = timestamp;
  }
}

/**
 * Adds one record's nine usage counters to the running totals.
 *
 * A missing nested group reads as an empty object rather than a fault:
 * a synthetic record carries `output_tokens_details: null`, so the
 * thinking counter is legitimately absent on a turn that still has the
 * other eight.
 */
function applyUsage(totals: SessionUsageTotals, usage: JsonObject): void {
  const creation = asObject(usage['cache_creation']) ?? {};
  const served = asObject(usage['server_tool_use']) ?? {};
  const details = asObject(usage['output_tokens_details']) ?? {};

  totals.inputTokens += asCount(usage['input_tokens']);
  totals.outputTokens += asCount(usage['output_tokens']);
  totals.cacheCreationInputTokens += asCount(usage['cache_creation_input_tokens']);
  totals.cacheReadInputTokens += asCount(usage['cache_read_input_tokens']);
  totals.ephemeral1hInputTokens += asCount(creation['ephemeral_1h_input_tokens']);
  totals.ephemeral5mInputTokens += asCount(creation['ephemeral_5m_input_tokens']);
  totals.webSearchRequests += asCount(served['web_search_requests']);
  totals.webFetchRequests += asCount(served['web_fetch_requests']);
  totals.thinkingTokens += asCount(details['thinking_tokens']);
}

/** Folds `message.model` and `message.usage`, wherever they ride. */
function applyMessage(acc: Accumulator, record: JsonObject): void {
  const message = asObject(record['message']);
  if (message === null) return;

  const model = asLabel(message['model']);
  if (model !== null) bump(acc.modelCounts, model);

  const usage = asObject(message['usage']);
  if (usage !== null) applyUsage(acc.usage, usage);
}

/**
 * Folds an async line source into one stats row.
 *
 * Split out from {@link readSessionLog} so the fold is drivable from a
 * generator in a test without touching disk, and so a caller with a
 * line source of its own (an archive, a pipe) needs no second reader.
 * The source is consumed exactly once, lazily, and is never collected
 * into an array.
 */
export async function accumulateSessionStats(
  lines: AsyncIterable<string>,
  identity: SessionIdentity,
): Promise<SessionStats> {
  const acc = createAccumulator(identity);

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    acc.lineCount += 1;

    const record = parseRecord(line);
    if (record === null) {
      acc.unparsedLineCount += 1;
      continue;
    }

    acc.recordCount += 1;
    applyIdentityFields(acc, record);
    applyTimestamp(acc, record);
    applyMessage(acc, record);
  }

  return toRow(acc);
}

/** A zeroed accumulator carrying the row's identity and nothing else. */
function createAccumulator(identity: SessionIdentity): Accumulator {
  return {
    sessionId: identity.sessionId,
    filePath: identity.filePath,
    lineCount: 0,
    recordCount: 0,
    unparsedLineCount: 0,
    recordTypeCounts: {},
    assistantRecordCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    gitBranchCounts: {},
    entrypointCounts: {},
    effortCounts: {},
    sidechainRecordCount: 0,
    modelCounts: {},
    usage: emptyUsageTotals(),
    firstEpoch: null,
    lastEpoch: null,
  };
}

/**
 * Projects the accumulator onto the row, dropping the two working
 * epochs. Spelled field by field rather than as a rest-destructure
 * omission, which this repo's lint rejects — and it doubles as the
 * enumeration of what a stored row is allowed to carry.
 */
function toRow(acc: Accumulator): SessionStats {
  return {
    sessionId: acc.sessionId,
    filePath: acc.filePath,
    lineCount: acc.lineCount,
    recordCount: acc.recordCount,
    unparsedLineCount: acc.unparsedLineCount,
    recordTypeCounts: acc.recordTypeCounts,
    assistantRecordCount: acc.assistantRecordCount,
    firstTimestamp: acc.firstTimestamp,
    lastTimestamp: acc.lastTimestamp,
    gitBranchCounts: acc.gitBranchCounts,
    entrypointCounts: acc.entrypointCounts,
    effortCounts: acc.effortCounts,
    sidechainRecordCount: acc.sidechainRecordCount,
    modelCounts: acc.modelCounts,
    usage: acc.usage,
  };
}

/** One line to a JSON object, or null for the two ways that can fail. */
function parseRecord(line: string): JsonObject | null {
  try {
    return asObject(JSON.parse(line));
  } catch {
    return null;
  }
}

/** Accumulates one stats row from a session log on disk. */
export async function readSessionLog(filePath: string): Promise<SessionStats> {
  return accumulateSessionStats(readLines(filePath), {
    sessionId: sessionIdFromPath(filePath),
    filePath,
  });
}
