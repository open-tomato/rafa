/**
 * The `rafa:decision` block a `rafa loop start --continue` decision
 * session ends with, read out of its captured output.
 *
 * ````markdown
 * ```rafa:decision
 * strategy: defer
 * reason: "Line 15 writes the helper this task imports."
 * after: 15
 * ```
 * ````
 *
 * {@link parseDecision} takes any string, never throws, and always
 * answers a {@link ContinueDecision}: a decision the loop cannot read is
 * `stop`, the restrictive default, with a reason opening with
 * {@link UNREADABLE_PREFIX} and naming why. A loop that read an
 * unreadable block as anything else would act on a choice nobody made.
 *
 * ## Which block is read
 *
 * As `../report/parse.ts` reads `rafa:report`: blocks are found by
 * `readRafaBlocks`, only the LAST `rafa:decision` block counts, and when
 * it cannot be read no earlier one is read in its place, an earlier one
 * being a draft the session replaced. An unclosed last block is not
 * read, and `Bun.YAML.parse` reads the body, which must be a mapping.
 *
 * ## Fields
 *
 *   - `strategy` is one of {@link DECISION_STRATEGIES}, spelled exactly.
 *   - `reason` is non-blank text, for every strategy: the end-of-run
 *     summary and the stop line quote it.
 *   - `approach` is non-blank text, required for `retry` alone: the
 *     next session on the task is handed it.
 *   - `after` is a whole number from 1, required for `defer` alone: the
 *     tracker line, counted from one as the prompt shows it, of the task
 *     to run first. A quoted number is refused, as the config readers
 *     refuse one; the prompt asks for a bare number. Whether the line
 *     holds an open task is not this module's question:
 *     `./pass-over.ts` answers it against the tracker.
 *
 * Text values are trimmed. A key the strategy does not use, and a key
 * the parser does not know, are dropped. The first problem found, in
 * that order of fields, is the one the reason names.
 */
import { readRafaBlocks } from '../plan/blocks.js';

/** The info string's kind the decision block is fenced with. */
export const DECISION_KIND = 'decision';

/** The four strategies a decision may name. */
export const DECISION_STRATEGIES = ['retry', 'stop', 'jump', 'defer'] as const;

/** One of {@link DECISION_STRATEGIES}. */
export type DecisionStrategy = (typeof DECISION_STRATEGIES)[number];

/** What every reason of an unreadable decision opens with. */
export const UNREADABLE_PREFIX = 'the decision could not be read, so the run stops: ';

/** A decision, as the loop acts on it. */
export interface ContinueDecision {
  readonly strategy: DecisionStrategy;
  /** Why, trimmed; for an unreadable block, why it could not be read. */
  readonly reason: string;
  /** `retry` only: the new approach, trimmed. */
  readonly approach?: string;
  /** `defer` only: the tracker line, counted from one, of the task to run first. */
  readonly after?: number;
}

/** A YAML mapping, as `Bun.YAML.parse` answers one. */
type Mapping = Readonly<Record<string, unknown>>;

/** A field's value, or the problem that keeps it from being read. */
type Field<T> = { readonly value: T } | { readonly problem: string };

/** True for a mapping; false for a list, a scalar or null. */
function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A key's own value, looked up by name and never by object index. */
function fieldOf(mapping: Mapping, key: string): unknown {
  return Object.entries(mapping).find(([own]) => own === key)?.[1];
}

/** A value as a reason quotes it. Never serialises a collection. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return `the ${typeof value} ${String(value)}`;
}

/** The message of whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** The `stop` an unreadable decision reads as. */
function unreadable(why: string): ContinueDecision {
  return { strategy: 'stop', reason: `${UNREADABLE_PREFIX}${why}` };
}

/** True when `value` is one of the strategies. */
function isStrategy(value: unknown): value is DecisionStrategy {
  return (DECISION_STRATEGIES as readonly unknown[]).includes(value);
}

/** A non-blank text field, trimmed. `needs` closes a missing or blank one's problem. */
function textField(document: Mapping, key: string, needs = ''): Field<string> {
  const raw = fieldOf(document, key);
  if (raw === undefined || raw === null) return { problem: `${key} is missing${needs}` };
  if (typeof raw !== 'string') return { problem: `${key} is ${describeValue(raw)}, expected text` };
  const value = raw.trim();
  return value === ''
    ? { problem: `${key} is blank${needs}` }
    : { value };
}

/** `after`, a whole number from 1. */
function afterField(document: Mapping): Field<number> {
  const raw = fieldOf(document, 'after');
  if (raw === undefined || raw === null) return { problem: 'after is missing, and defer needs one' };
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 1
    ? { value: raw }
    : { problem: `after is ${describeValue(raw)}, expected a line number from 1` };
}

/** The decision a block's mapping holds, or the `stop` naming its first problem. */
function readDecision(document: Mapping): ContinueDecision {
  const strategy = fieldOf(document, 'strategy');
  if (strategy === undefined || strategy === null) return unreadable('strategy is missing');
  if (!isStrategy(strategy)) {
    return unreadable(`strategy is ${describeValue(strategy)}, expected one of: ${DECISION_STRATEGIES.join(', ')}`);
  }

  const reason = textField(document, 'reason');
  if ('problem' in reason) return unreadable(reason.problem);

  if (strategy === 'retry') {
    const approach = textField(document, 'approach', ', and retry needs one');
    return 'problem' in approach
      ? unreadable(approach.problem)
      : { strategy, reason: reason.value, approach: approach.value };
  }
  if (strategy === 'defer') {
    const after = afterField(document);
    return 'problem' in after
      ? unreadable(after.problem)
      : { strategy, reason: reason.value, after: after.value };
  }
  return { strategy, reason: reason.value };
}

/**
 * The decision the LAST `rafa:decision` block of `output` holds, or
 * `stop` naming why none can be read. Never throws.
 */
export function parseDecision(output: string): ContinueDecision {
  const block = readRafaBlocks(output).filter((each) => each.kind === DECISION_KIND)
    .at(-1);
  if (block === undefined) return unreadable('the output holds no rafa:decision block');

  const at = `the rafa:decision block at line ${String(block.span.first)}`;
  if (!block.closed) return unreadable(`${at} is never closed`);

  let document: unknown;
  try {
    document = Bun.YAML.parse(block.body);
  } catch (error) {
    return unreadable(`${at} is not valid YAML (${messageOf(error)})`);
  }
  if (!isMapping(document)) return unreadable(`${at} holds ${describeValue(document)}, not a mapping`);

  return readDecision(document);
}
