/**
 * The records the learning library settles, and the answers it gives.
 *
 * The library owns these types: `src/ports/index.ts` re-exports each of
 * them under the same name rather than declaring it again, so the
 * `Learning` port passes exactly what the library takes and answers, and
 * a service typing an adapter against `./ports` and one calling the
 * library read one declaration. Like the rest of `src/learning/`, this
 * module imports nothing from the rest of `src/`.
 *
 * The fields are snake case, as the distributed-learning spec spells the
 * record a sync payload carries. Every type here is erased at build, so
 * the module holds no runtime value.
 */

/**
 * One instinct: a trigger, the action to take on it, and how far to
 * trust that action.
 */
export interface InstinctRecord {
  id: string;
  trigger: string;
  action: string;
  /** `sha256(trim(lower(action)))`: two records share an action by it. */
  action_hash: string;
  /** From 0.3 to 0.9. */
  confidence: number;
  /**
   * The weight a merge gives the confidence. Once a record carries
   * {@link InstinctRecord.sources}, it equals that list's length.
   */
  usage_count: number;
  /**
   * The distinct `source_id`s that confirmed the record. A merge takes
   * the union, which is what makes a source pushing one record twice
   * count once. Left out by a record written before sources were kept.
   */
  sources?: string[];
  /** The recurrence key; phase 2's field. */
  artifact?: string;
  signal: 'loud' | 'silent';
  /** A `flagged` record is excluded from every blessed bundle. */
  status: 'active' | 'flagged';
  /**
   * The path of the page the wrap-up wrote the record into. A promoted
   * record leaves every blessed bundle, because the page now carries it.
   */
  promoted_to?: string;
  created_at: string;
  updated_at: string;
}

/**
 * What one source pushes. Under the `local` adapter the source is the
 * task's session id, so two tasks of one plan are two sources.
 */
export interface SyncPayload {
  source_id: string;
  instincts: InstinctRecord[];
}

/** What a pull answers: the instincts blessed for injection. */
export interface BlessedBundle {
  version: string;
  instincts: InstinctRecord[];
}

/**
 * The rule a merge applied to one incoming record, one per row of the
 * spec's merge table plus the record whose trigger nothing shares:
 *
 *   - `new-trigger`: no held record shares the trigger, so it is kept.
 *   - `same-action`: the same `action_hash`, so the confidences are
 *     weighted by usage and the sources joined.
 *   - `higher-confidence`: a different action, confidences more than
 *     0.10 apart, so the higher one wins.
 *   - `flagged`: a different action, confidences within 0.10, so both
 *     are kept and flagged.
 */
export type MergeRule = 'new-trigger' | 'same-action' | 'higher-confidence' | 'flagged';

/** Which rule applied to one incoming record, and what it produced. */
export interface MergeDecision {
  incoming: InstinctRecord;
  rule: MergeRule;
  /** The records the trigger is held as once the rule has applied. */
  produced: InstinctRecord[];
}

/**
 * What a merge did, so a consumer can log each decision.
 *
 * The spec names `discarded` and describes the rest, a list saying which
 * rule applied to each incoming record and what it produced, without
 * naming it; `decisions`, {@link MergeDecision} and the
 * {@link MergeRule} names are this module's.
 */
export interface MergeResult {
  /** One per incoming record, in the payload's order. */
  decisions: MergeDecision[];
  /** The records a higher-confidence action displaced; none is deleted. */
  discarded: InstinctRecord[];
}
