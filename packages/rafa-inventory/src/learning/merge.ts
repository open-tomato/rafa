/**
 * Settling what one source pushes against the instincts already held.
 *
 * {@link merge} groups the held records and the payload's records by
 * {@link triggerKey}, and settles each trigger the payload touches over
 * its whole set of actions at once, never pair by pair:
 *
 *   1. `same-action`: the records sharing one `action_hash` collapse to
 *      one record. Its `sources` is the union of theirs, `usage_count`
 *      that union's length, and its confidence the usage-weighted mean
 *      of theirs plus {@link SOURCE_STEP} for each distinct source
 *      beyond the first, capped at {@link CONFIDENCE_MAX}.
 *   2. `higher-confidence`: the action with the highest confidence
 *      leads, and each action more than {@link GAP} below it is
 *      discarded: reported in {@link MergeResult.discarded} and left out
 *      of what the trigger is held as.
 *   3. `flagged`: each action within {@link GAP} of the leader, an exact
 *      tie included, is flagged together with the leader.
 *   4. `new-trigger`: a lone record on a trigger nothing held is kept as
 *      it is, the payload's `source_id` joined to its `sources`.
 *
 * Triggers the payload does not touch are not read, and no record
 * passed in is changed: every record the result names that differs from
 * its input is a new object.
 *
 * ## Readings the rules leave open
 *
 *   - **Two decimals.** Confidences are compared, and a collapsed
 *     record's confidence computed, in whole hundredths, so 0.55 − 0.45
 *     reads as the 0.10 it is written as rather than 0.10000000000000003,
 *     which is more than {@link GAP}. A collapsed record's confidence is
 *     stored at two decimals.
 *   - **The source step is counted once.** A held record's confidence
 *     already carries the step for its own sources, so each member's
 *     step is taken off before the mean and the step for the union is
 *     added after it. Three sources at 0.5 give 0.60 however they
 *     arrive; averaging the stepped confidences as they stand would
 *     give 0.63 pushed one at a time, and more for each later source.
 *     A record already at the cap has lost the part the cap cut off,
 *     so a later merge reads it lower than its sources put it.
 *   - **A source counts once.** Members are read held first, each
 *     oldest first, and a member weighs only as many sources as it adds
 *     to those already read. A source pushing an action it already
 *     confirmed changes nothing, which is what makes a repeated push
 *     idempotent.
 *   - **A record without `sources`** stands as one source named by its
 *     own `id`, so the union still counts it once and `usage_count`
 *     still equals the length of `sources` after the merge.
 *   - **Whose identity survives.** A collapsed record keeps the `id`,
 *     `trigger`, `action`, `signal` and `created_at` of its oldest
 *     member (by `created_at`, then `id`), and the first `artifact` and
 *     `promoted_to` in that order, so the answer does not depend on
 *     which member was pushed first.
 *   - **Status is settled, not carried.** A trigger left with one action
 *     is `active`, and one left with several is `flagged`, whatever the
 *     records said before; a flag written against an `id` is the
 *     adapter's to apply. A `new-trigger` record keeps its own status.
 *   - **`now`** becomes the `updated_at` of each record the settle
 *     changed. A record it left as the held set had it keeps its own.
 *
 * A discarded action is left out of the held set, so an action
 * discarded by one push and confirmed by a later one comes back with
 * only the later sources: that sequence can settle differently from the
 * same pushes in another order.
 *
 * Like the rest of `src/learning/`, this module imports nothing from
 * the rest of `src/`, reads no clock and uses no randomness.
 */

import type {
  InstinctRecord,
  MergeDecision,
  MergeResult,
  MergeRule,
  SyncPayload,
} from './types.js';

import {
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  GAP,
  SOURCE_STEP,
  triggerKey,
} from './identity.js';

/** Hundredths in one unit of confidence. */
const HUNDREDTHS = 100;

/** {@link GAP} in whole hundredths. */
const GAP_H = Math.round(GAP * HUNDREDTHS);

/** {@link SOURCE_STEP} in whole hundredths. */
const STEP_H = Math.round(SOURCE_STEP * HUNDREDTHS);

/** {@link CONFIDENCE_MIN} in whole hundredths. */
const MIN_H = Math.round(CONFIDENCE_MIN * HUNDREDTHS);

/** {@link CONFIDENCE_MAX} in whole hundredths. */
const MAX_H = Math.round(CONFIDENCE_MAX * HUNDREDTHS);

/** The records of one trigger that share one action. */
interface ActionGroup {
  readonly held: InstinctRecord[];
  readonly incoming: InstinctRecord[];
}

/** How one trigger settled. */
interface TriggerOutcome {
  /** What the trigger is held as, by confidence, then `id`. */
  readonly produced: InstinctRecord[];
  /** The collapsed records a leader displaced, by confidence, then `id`. */
  readonly discarded: InstinctRecord[];
  /** The rule each action applied, by `action_hash`. */
  readonly rules: ReadonlyMap<string, MergeRule>;
}

/** A confidence in whole hundredths. */
function hundredths(confidence: number): number {
  return Math.round(confidence * HUNDREDTHS);
}

/** Orders two strings by code unit, as every machine does. */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** Oldest first: by `created_at`, then `id`. */
function byAge(left: InstinctRecord, right: InstinctRecord): number {
  return compareText(left.created_at, right.created_at) || compareText(left.id, right.id);
}

/** Highest confidence first, then `id`. */
function byConfidence(left: InstinctRecord, right: InstinctRecord): number {
  return hundredths(right.confidence) - hundredths(left.confidence)
    || compareText(left.id, right.id);
}

/** The distinct sources a record stands for; its own `id` when it names none. */
function sourcesOf(record: InstinctRecord): string[] {
  return record.sources !== undefined && record.sources.length > 0
    ? [...new Set(record.sources)]
    : [record.id];
}

/** The pushed record with the payload's source joined to its own. */
function withSource(record: InstinctRecord, sourceId: string): InstinctRecord {
  const sources = [...new Set([...record.sources ?? [], sourceId])].sort();
  return { ...record, sources, usage_count: sources.length };
}

/**
 * The first member, in `ordered`, carrying `key`, as a record fragment
 * that is empty when none does, so an absent field stays absent.
 */
function firstOptional(
  ordered: readonly InstinctRecord[],
  key: 'artifact' | 'promoted_to',
): Partial<InstinctRecord> {
  const found = ordered.find((record) => record[key] !== undefined);
  return found === undefined
    ? {}
    : { [key]: found[key] };
}

/**
 * One action's records as one record, or its lone record as it is.
 * See the module note for the arithmetic.
 */
function collapse(group: ActionGroup): InstinctRecord {
  const ordered = [...[...group.held].sort(byAge), ...[...group.incoming].sort(byAge)];
  if (ordered.length === 1) {
    return ordered[0]!;
  }
  const seen = new Set<string>();
  let weighted = 0;
  for (const member of ordered) {
    const own = sourcesOf(member);
    const fresh = own.filter((source) => !seen.has(source));
    const base = hundredths(member.confidence) - STEP_H * (own.length - 1);
    weighted += base * fresh.length;
    for (const source of fresh) {
      seen.add(source);
    }
  }
  const sources = [...seen].sort();
  const stepped = Math.round(weighted / sources.length + STEP_H * (sources.length - 1));
  const confidence = Math.min(MAX_H, Math.max(MIN_H, stepped)) / HUNDREDTHS;
  const byAgeAll = [...ordered].sort(byAge);
  const lead = byAgeAll[0]!;
  const rest: Partial<InstinctRecord> = {};
  for (const [key, value] of Object.entries(lead)) {
    if (key !== 'artifact' && key !== 'promoted_to') {
      Object.assign(rest, { [key]: value });
    }
  }
  return {
    ...rest as InstinctRecord,
    ...firstOptional(byAgeAll, 'artifact'),
    ...firstOptional(byAgeAll, 'promoted_to'),
    confidence,
    usage_count: sources.length,
    sources,
  };
}

/** True when two records differ in nothing but `updated_at`. */
function sameButStamp(left: InstinctRecord, right: InstinctRecord): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  keys.delete('updated_at');
  return [...keys].every((key) => {
    const field = key as keyof InstinctRecord;
    return JSON.stringify(left[field]) === JSON.stringify(right[field]);
  });
}

/**
 * `record` with `updated_at` set to `now`, unless the held set holds it
 * under its `id` already as it stands.
 */
function stamp(record: InstinctRecord, held: readonly InstinctRecord[], now: string): InstinctRecord {
  const before = held.find((candidate) => candidate.id === record.id);
  if (before !== undefined && sameButStamp(before, record)) {
    return before;
  }
  return { ...record, updated_at: now };
}

/** `record` carrying `status`, as the same object when it already does. */
function withStatus(record: InstinctRecord, status: InstinctRecord['status']): InstinctRecord {
  return record.status === status
    ? record
    : { ...record, status };
}

/** The records of one trigger, grouped by `action_hash`, held first. */
function groupByAction(
  held: readonly InstinctRecord[],
  incoming: readonly InstinctRecord[],
): Map<string, ActionGroup> {
  const groups = new Map<string, ActionGroup>();
  const groupOf = (hash: string): ActionGroup => {
    const found = groups.get(hash);
    if (found !== undefined) {
      return found;
    }
    const made: ActionGroup = { held: [], incoming: [] };
    groups.set(hash, made);
    return made;
  };
  for (const record of held) {
    groupOf(record.action_hash).held.push(record);
  }
  for (const record of incoming) {
    groupOf(record.action_hash).incoming.push(record);
  }
  return groups;
}

/** A trigger left with one action: rules 1 and 4. */
function settleOne(
  hash: string,
  group: ActionGroup,
  held: readonly InstinctRecord[],
  now: string,
): TriggerOutcome {
  if (group.held.length === 0 && group.incoming.length === 1) {
    return {
      produced: [group.incoming[0]!],
      discarded: [],
      rules: new Map([[hash, 'new-trigger']]),
    };
  }
  const record = stamp(withStatus(collapse(group), 'active'), held, now);
  return { produced: [record], discarded: [], rules: new Map([[hash, 'same-action']]) };
}

/** A trigger with several actions: rules 2 and 3, over the whole set. */
function settleMany(
  collapsed: ReadonlyMap<string, InstinctRecord>,
  held: readonly InstinctRecord[],
  now: string,
): TriggerOutcome {
  const leaderH = Math.max(...[...collapsed.values()].map((record) => hundredths(record.confidence)));
  const kept = new Map<string, InstinctRecord>();
  const discarded: InstinctRecord[] = [];
  for (const [hash, record] of collapsed) {
    if (leaderH - hundredths(record.confidence) > GAP_H) {
      discarded.push(record);
    } else {
      kept.set(hash, record);
    }
  }
  const status = kept.size > 1
    ? 'flagged'
    : 'active';
  const rule: MergeRule = kept.size > 1
    ? 'flagged'
    : 'higher-confidence';
  const rules = new Map<string, MergeRule>();
  for (const hash of collapsed.keys()) {
    rules.set(hash, kept.has(hash)
      ? rule
      : 'higher-confidence');
  }
  const produced = [...kept.values()].map((record) => stamp(withStatus(record, status), held, now));
  return {
    produced: produced.sort(byConfidence),
    discarded: discarded.sort(byConfidence),
    rules,
  };
}

/** Settles one trigger over its held and incoming records. */
function settleTrigger(
  held: readonly InstinctRecord[],
  incoming: readonly InstinctRecord[],
  now: string,
): TriggerOutcome {
  const groups = groupByAction(held, incoming);
  if (groups.size === 1) {
    const [hash, group] = [...groups.entries()][0]!;
    return settleOne(hash, group, held, now);
  }
  const collapsed = new Map<string, InstinctRecord>();
  for (const [hash, group] of groups) {
    collapsed.set(hash, collapse(group));
  }
  return settleMany(collapsed, held, now);
}

/**
 * Settles `payload` against `held`, trigger by trigger, by the four
 * rules in the module note.
 *
 * @param held - the records already held, on any trigger.
 * @param payload - one source's records; `source_id` joins each
 *   record's `sources`.
 * @param now - the ISO 8601 time each changed record's `updated_at`
 *   takes.
 * @returns one decision per pushed record, in the payload's order,
 *   whose `produced` is what that record's trigger is now held as, and
 *   the records a higher-confidence action displaced. A trigger the
 *   payload does not touch is held as before.
 */
export function merge(
  held: readonly InstinctRecord[],
  payload: SyncPayload,
  now: string,
): MergeResult {
  const incoming = payload.instincts.map((record) => withSource(record, payload.source_id));
  const keys = [...new Set(incoming.map((record) => triggerKey(record.trigger)))];
  const outcomes = new Map<string, TriggerOutcome>();
  for (const key of keys) {
    const onKey = (record: InstinctRecord): boolean => triggerKey(record.trigger) === key;
    outcomes.set(key, settleTrigger(held.filter(onKey), incoming.filter(onKey), now));
  }
  const decisions = payload.instincts.map((record): MergeDecision => {
    const outcome = outcomes.get(triggerKey(record.trigger))!;
    return {
      incoming: record,
      rule: outcome.rules.get(record.action_hash)!,
      produced: [...outcome.produced],
    };
  });
  return {
    decisions,
    discarded: keys.flatMap((key) => outcomes.get(key)!.discarded),
  };
}
