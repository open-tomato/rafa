/**
 * The session row's own types: what a session was dispatched to do and
 * the stats accumulated over its log.
 *
 * Moved down from `src/effort/classify.ts` (`SessionKind`) and
 * `packages/rafa/src/effort/session-log.ts` (`SessionStats` and the
 * `SessionUsageTotals` it names), which classify and read session logs
 * and re-export these names under the same names: the store's row types
 * (`types.ts`) need the shapes but not the classifier or the reader, so
 * they import them here and the store imports nothing above core for
 * them. The module notes of `classify.ts` and `session-log.ts` still
 * describe how each value is derived from a log.
 */

/** What a session was dispatched to do. */
export type SessionKind =
  | 'task'
  | 'plan-generation'
  | 'wrap-up'
  | 'ci-repair'
  | 'search'
  | 'other';

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
