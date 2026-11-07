/**
 * The rule the `local` adapter's push log writes for one merge
 * decision: the library's {@link MergeRule}, or `same-action-group` when
 * the decision's record now holds its action beside another trigger.
 *
 * `merge` settles each trigger alone, so a lesson pushed under a third
 * wording reads `new-trigger` there, and one confirmed again under a
 * wording already held reads `same-action`, though in either case the
 * held set now holds one lesson under several triggers. The push log
 * names that case `same-action-group`, so a reader of the log sees the
 * wording joined a group. The library's `MergeRule` and `merge` are
 * left as they are: the wider {@link PushLogRule} is the adapter's.
 *
 * ## The reading
 *
 * A decision's logged rule is `same-action-group` when all of these
 * hold over {@link heldAfterPush}, the held set once the whole push has
 * applied:
 *
 *   - its rule is `new-trigger` or `same-action`;
 *   - the record it produced, the one taking the incoming record's
 *     action, is held and `active`;
 *   - its same-action group, as the library's `sameActionGroups` reads
 *     it, `flagged` members left out, holds a member on another trigger
 *     (by `triggerKey`).
 *
 * Any other decision keeps its rule: `higher-confidence` and `flagged`
 * always, and a `new-trigger` or `same-action` one whose action no
 * unflagged record holds under another trigger, such as one whose only
 * other wording is flagged.
 *
 * The held set after the push takes each produced record in place of
 * the held records on its trigger, as the adapter writes them, and reads
 * every status the way `./held.js` reads the files back: `flagged` on a
 * trigger held with more than one action, `active` otherwise.
 *
 * Nothing here reads a file, a clock or randomness, and no record
 * passed in is changed.
 */
import type { InstinctRecord, MergeDecision, MergeResult, MergeRule } from '@open-tomato/rafa/ports';

import { sameActionGroups, triggerKey } from '../../learning/index.js';

/** The rule a push-log line names: the merge's, or a joined group. */
export type PushLogRule = MergeRule | 'same-action-group';

/** The rules a decision may log as `same-action-group` in place of. */
const GROUPABLE: ReadonlySet<MergeRule> = new Set<MergeRule>(['new-trigger', 'same-action']);

/** `record` carrying `status`, as the same object when it already does. */
function withStatus(record: InstinctRecord, status: InstinctRecord['status']): InstinctRecord {
  return record.status === status
    ? record
    : { ...record, status };
}

/**
 * The held set once `result` has applied over `before`: every record
 * on a trigger no decision touched as it was, then each record a
 * decision produced, the last by id when two share one. Each status is
 * read as `./held.js` reads the files back. See the module note.
 *
 * @param before - the held set the push merged against.
 * @param result - what the merge answered.
 * @returns new records; neither argument is changed.
 */
export function heldAfterPush(before: readonly InstinctRecord[], result: MergeResult): InstinctRecord[] {
  const touched = new Set(result.decisions.map((decision) => triggerKey(decision.incoming.trigger)));
  const produced = new Map<string, InstinctRecord>();
  for (const record of result.decisions.flatMap((decision) => decision.produced)) {
    produced.set(record.id, record);
  }
  const held = [
    ...before.filter((record) => !touched.has(triggerKey(record.trigger))),
    ...produced.values(),
  ];
  const actions = new Map<string, Set<string>>();
  for (const record of held) {
    const key = triggerKey(record.trigger);
    actions.set(key, (actions.get(key) ?? new Set<string>()).add(record.action_hash));
  }
  return held.map((record) => withStatus(record, actions.get(triggerKey(record.trigger))!.size > 1
    ? 'flagged'
    : 'active'));
}

/**
 * The rule the push log writes for `decision`: `same-action-group` when
 * its record is `active` in `after` and shares its action with an
 * unflagged record there on another trigger, and its merge rule
 * otherwise. See the module note.
 *
 * @param decision - one decision of the push's merge.
 * @param after - the held set after the push, as {@link heldAfterPush}
 *   answers it.
 * @returns the rule to log.
 */
export function loggedRule(decision: MergeDecision, after: readonly InstinctRecord[]): PushLogRule {
  if (!GROUPABLE.has(decision.rule)) {
    return decision.rule;
  }
  const hash = decision.incoming.action_hash;
  const own = decision.produced.find((record) => record.action_hash === hash);
  if (own === undefined) {
    return decision.rule;
  }
  const [group] = sameActionGroups(after.filter((record) => record.action_hash === hash));
  if (group === undefined || !group.members.some((member) => member.id === own.id)) {
    return decision.rule;
  }
  const key = triggerKey(own.trigger);
  return group.members.some((member) => triggerKey(member.trigger) !== key)
    ? 'same-action-group'
    : decision.rule;
}
