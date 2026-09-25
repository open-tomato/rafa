/**
 * The `local` Learning adapter's held set, in both directions: a parsed
 * `.md` instinct as the library's `InstinctRecord`, and a record the
 * library's `merge` produced as the `.md` instinct written back.
 *
 * The held set is the `.md` files under `.rafa/instincts/`, which
 * `rafa instinct check|list|show` read, and `src/schema/instinct.ts`
 * reads and writes one file. The library settles records that carry the
 * merge fields alone, so each direction owns what the other leaves out.
 *
 * ## A file as a record
 *
 * {@link toHeldRecord} answers the port's fields in the port's order,
 * with `sources`, `artifact` and `promoted_to` each left out when the
 * file has none. The `action_hash` is the one the schema computed from
 * the Action section when it read the file, never a stored one.
 *
 * A file carries no `status`, because the plan has `merge` decide
 * `flagged` afresh on every merge and an operator's flag lives in
 * `flags.ndjson` by id. {@link toHeldRecord} therefore answers `active`,
 * and {@link toHeldRecords} reads the status off the whole held set the
 * way `merge` settles it: a trigger (by {@link triggerKey}) held with
 * more than one action is `flagged`, every record on it, and a trigger
 * held with one action is `active`. A merge leaves several actions on a
 * trigger only when it flagged them, so the set read back answers what
 * the merge produced. Two demoted files sharing a trigger with different
 * actions read as flagged too, which is what the next merge on that
 * trigger would settle them as.
 *
 * ## A record as a file
 *
 * {@link toHeldInstinct} takes the record's merge fields and the rest
 * from the held set: `kind`, `domain`, `scope`, `source`, `evidence`
 * and `cause`, and `project_id` with them, come from the EARLIEST held
 * member of the record, by `created_at` and then `id`, the order
 * `merge` ages members by. A member is a held instinct on the record's
 * trigger (by {@link triggerKey}) whose action hash is the record's:
 * exactly the held records a `same-action` merge collapses into it. A
 * record with no held member, as a `new-trigger` record is, takes those
 * fields from the `fallback` the caller passes, and without one there is
 * nothing to write it with, so the answer is null.
 *
 * `status` is not written, as above. `usage_count`, `sources`,
 * `artifact` and `promoted_to` are the record's own, an absent
 * `sources` written as none, and the action hash is computed again from
 * the record's `action` by {@link actionHash} rather than copied, so an
 * `Instinct` this module answers carries the hash its file would read.
 *
 * Nothing here opens a file, reads a clock or changes a value passed in.
 */
import type { InstinctRecord } from '../../ports/index.js';
import type { Instinct } from '../../schema/instinct.js';

import { actionHash, triggerKey } from '../../learning/index.js';

/**
 * The fields of a `.md` instinct the library's record does not carry,
 * which a record written back takes from its earliest held member.
 */
export type HeldDescription = Pick<
  Instinct,
  'kind' | 'domain' | 'scope' | 'source' | 'evidence' | 'cause' | 'projectId'
>;

/** Orders two strings by code unit, as `merge` does. */
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
function byAge(left: Instinct, right: Instinct): number {
  return compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id);
}

/**
 * `instinct` as the library reads it: the port's fields in the port's
 * order, `active`, with each optional field left out when the file has
 * none.
 *
 * @param instinct - a record `parseInstinct` answered.
 * @returns a new record; `instinct` is not changed.
 */
export function toHeldRecord(instinct: Instinct): InstinctRecord {
  return {
    id: instinct.id,
    trigger: instinct.trigger,
    action: instinct.action,
    action_hash: instinct.actionHash,
    confidence: instinct.confidence,
    usage_count: instinct.usageCount,
    ...instinct.sources.length > 0
      ? { sources: [...instinct.sources] }
      : {},
    ...instinct.artifact === null
      ? {}
      : { artifact: instinct.artifact },
    signal: instinct.signal,
    status: 'active',
    ...instinct.promotedTo === null
      ? {}
      : { promoted_to: instinct.promotedTo },
    created_at: instinct.createdAt,
    updated_at: instinct.updatedAt,
  };
}

/**
 * The held set as the library reads it, in the order given, each record
 * `flagged` when its trigger is held with more than one action and
 * `active` otherwise.
 *
 * @param held - every `.md` instinct the held set holds.
 * @returns one new record per instinct.
 */
export function toHeldRecords(held: readonly Instinct[]): InstinctRecord[] {
  const actions = new Map<string, Set<string>>();
  for (const instinct of held) {
    const key = triggerKey(instinct.trigger);
    actions.set(key, (actions.get(key) ?? new Set<string>()).add(instinct.actionHash));
  }
  return held.map((instinct) => {
    const record = toHeldRecord(instinct);
    return actions.get(triggerKey(instinct.trigger))!.size > 1
      ? { ...record, status: 'flagged' }
      : record;
  });
}

/**
 * The earliest held member of `record`: the oldest held instinct on its
 * trigger carrying its action hash, or null when the held set has none.
 *
 * @param record - a record `merge` produced.
 * @param held - the `.md` instincts held before the merge.
 */
export function earliestHeldMember(
  record: InstinctRecord,
  held: readonly Instinct[],
): Instinct | null {
  const key = triggerKey(record.trigger);
  const members = held.filter((instinct) => instinct.actionHash === record.action_hash
    && triggerKey(instinct.trigger) === key);
  return [...members].sort(byAge)[0] ?? null;
}

/**
 * `record` as the `.md` instinct written back, described by its earliest
 * held member or, when it has none, by `fallback`.
 *
 * @param record - a record `merge` produced.
 * @param held - the `.md` instincts held before the merge.
 * @param fallback - what describes a record no held instinct is a
 *   member of, such as a `new-trigger` record.
 * @returns the instinct to write, or null when neither a held member
 *   nor `fallback` describes the record.
 */
export function toHeldInstinct(
  record: InstinctRecord,
  held: readonly Instinct[],
  fallback?: HeldDescription,
): Instinct | null {
  const description: HeldDescription | undefined = earliestHeldMember(record, held) ?? fallback;
  if (description === undefined) {
    return null;
  }
  return {
    id: record.id,
    trigger: record.trigger,
    kind: description.kind,
    domain: description.domain,
    confidence: record.confidence,
    usageCount: record.usage_count,
    sources: [...record.sources ?? []],
    artifact: record.artifact ?? null,
    signal: record.signal,
    scope: description.scope,
    projectId: description.projectId,
    source: description.source,
    evidence: [...description.evidence],
    promotedTo: record.promoted_to ?? null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    action: record.action,
    cause: description.cause,
    actionHash: actionHash(record.action),
  };
}
