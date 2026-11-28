/**
 * How a hub contact (`contact.ts` beside this file) runs one direction
 * and writes what it came to: the error names a push, pull or status
 * read is matched by, the lines each writes, and
 * {@link createAttempts}, which holds the contact's record of the lines
 * it already wrote, so each is written once per contact. `contact.ts`
 * re-exports the names a caller uses, and its module note is the
 * authority for what each line means and when it is written.
 */
import type { HubContactStep, HubRefusal, HubRefusalCause } from './contact-readings.js';

import { describeValue, messageOf } from '@open-tomato/rafa/core/config/sections';

import { OPENING } from './contact-facts.js';

/** The `name` an error carries when a push or pull found the hub unreachable. */
export const HUB_UNREACHABLE = 'HubUnreachable';

/** The `name` an error carries when the hub speaks another wire contract version than this rafa. */
export const HUB_CONTRACT_MISMATCH = 'HubContractMismatch';

/** The `name` an error carries when the hub's store lacks a migration this rafa's applied: the hub is behind. */
export const HUB_UPGRADE_REQUIRED = 'HubUpgradeRequired';

/** The `name` an error carries when the hub's rows name a migration this rafa lacks: this rafa is behind. */
export const RAFA_UPDATE_REQUIRED = 'RafaUpdateRequired';

/** The names of the two skew refusals, whose messages are written as they stand; see `contact.ts`'s module note. */
export const SKEW_REFUSALS: readonly string[] = Object.freeze([HUB_UPGRADE_REQUIRED, RAFA_UPDATE_REQUIRED]);

/** The `name` an error carries when the hub token cannot be read: the `service` strategy's `HubTokenError`. */
export const HUB_TOKEN_ERROR = 'HubTokenError';

/** The `name` the hub's own refusal of a project it does not serve carries, as `rafa-hub`'s store throws it. */
export const HUB_PROJECT_NOT_SERVED = 'HubProjectNotServed';

/** What a message refusing a project the hub does not serve says, however the client wraps it. */
const NOT_SERVED = /project \S+ is not served here/;

/**
 * A push or pull found the hub unreachable. A module need not throw
 * this class: any error whose `name` is {@link HUB_UNREACHABLE} counts.
 */
export class HubUnreachable extends Error {
  override readonly name: 'HubUnreachable' = HUB_UNREACHABLE;
}

/** Whether a thrown value says the hub was unreachable; see `contact.ts`'s module note. */
export function isHubUnreachable(error: unknown): boolean {
  return error instanceof Error && error.name === HUB_UNREACHABLE;
}

/** Whether a thrown value says the hub speaks another contract version; see `contact.ts`'s module note. */
export function isHubContractMismatch(error: unknown): boolean {
  return error instanceof Error && error.name === HUB_CONTRACT_MISMATCH;
}

/** Whether a thrown value is a skew refusal, `HubUpgradeRequired` or `RafaUpdateRequired`; see `contact.ts`'s module note. */
export function isSkewRefusal(error: unknown): boolean {
  return error instanceof Error && SKEW_REFUSALS.includes(error.name);
}

/** The first line of `text` holding anything, trimmed, or the whole text described when none does. */
function firstLine(text: string): string {
  return text.split('\n').map((line) => line.trim())
    .find((line) => line !== '') ?? describeValue(text);
}

/**
 * The one line a contact writes when the hub is unreachable: the hub's
 * url when the config names one, the first line of why, and that the
 * command used the local store.
 */
export function hubUnreachableLine(hubUrl: string | null, error: unknown): string {
  const hub = hubUrl === null
    ? 'the hub'
    : `the hub at ${hubUrl}`;
  return `${OPENING}: ${hub} is unreachable (${firstLine(messageOf(error))});`
    + ' this command used the local store, and its rows sync on the next contact';
}

/**
 * Why a thrown value refuses a `sync()` run, or null when it is no
 * refusal: a contract mismatch, a skew refusal, the token reader's
 * `HubTokenError`, or a project the hub does not serve, matched by its
 * `name` or the hub's own sentence. See `contact.ts`'s module note, `The sync`.
 */
export function refusalCauseOf(error: unknown): HubRefusalCause | null {
  if (!(error instanceof Error)) return null;
  if (isHubContractMismatch(error)) return 'contract';
  if (isSkewRefusal(error)) return 'skew';
  if (error.name === HUB_TOKEN_ERROR) return 'token';
  return error.name === HUB_PROJECT_NOT_SERVED || NOT_SERVED.test(error.message)
    ? 'project'
    : null;
}

/** A refusal's one line: the first line of why, opening with what every contact line opens with. */
function refusalLine(problem: string): string {
  const line = firstLine(problem);
  return line.startsWith(OPENING)
    ? line
    : `${OPENING}: ${line}`;
}

/** What a direction is named in the line its failure writes. */
export type Direction = 'push' | 'pull' | 'hub status' | 'pending push';

/** One direction's step and the refusal it came to, null when it came to none. */
export interface Attempted<Result> {
  readonly step: HubContactStep<Result>;
  readonly refusal: HubRefusal | null;
}

/** What {@link createAttempts} writes through, and names in its lines. */
export interface AttemptsInput {
  /** Writes one warning, as a command's `output.warn` does. */
  readonly warn: (message: string) => void;
  /** The strategy the contact runs, as its `failed` line names it. */
  readonly strategy: string;
  /** The hub the config names, which the unreachable line names; null when it names none. */
  readonly hubUrl: string | null;
}

/** One contact's way of running a direction, holding the lines it already wrote. */
export interface Attempts {
  /** Writes a refusal's line once per contact: a contract mismatch's once whatever it says, any other once per line. */
  readonly tell: (refusal: HubRefusal) => void;
  /**
   * Runs one direction, answering its step and the refusal it came to,
   * writing its line when it threw: the unreachable, mismatch and skew
   * lines once per contact and any other failure each time. Under
   * `refusals`, a `sync()` run's, a missing token and a project the hub
   * does not serve are refusals too.
   */
  readonly attempted: <Result>(direction: Direction, run: () => Promise<Result>, refusals: boolean) => Promise<Attempted<Result>>;
  /** Runs one direction for `pushThenPull()`, `pull()` and `status()`, whose steps name no refusal cause. */
  readonly attempt: <Result>(direction: Direction, run: () => Promise<Result>) => Promise<HubContactStep<Result>>;
}

/** Makes the attempts of one contact; a new record of the lines written on each call. */
export function createAttempts(input: AttemptsInput): Attempts {
  const { warn, strategy, hubUrl } = input;
  let toldUnreachable = false;
  let toldMismatch = false;
  const toldRefusals = new Set<string>();

  const tell = (refusal: HubRefusal): void => {
    if (refusal.cause === 'contract') {
      if (!toldMismatch) warn(refusal.line);
      toldMismatch = true;
      return;
    }
    if (!toldRefusals.has(refusal.line)) warn(refusal.line);
    toldRefusals.add(refusal.line);
  };

  /** The step a direction that threw came to, writing its line; see {@link Attempts.attempted}. */
  const caught = (direction: Direction, error: unknown, refusals: boolean): Attempted<never> => {
    const problem = messageOf(error);
    const cause = refusalCauseOf(error);
    if (cause === 'contract' || cause === 'skew' || (refusals && cause !== null)) {
      const refusal: HubRefusal = { cause, line: cause === 'project' || cause === 'token'
        ? refusalLine(problem)
        : firstLine(problem) };
      tell(refusal);
      const step = cause === 'contract'
        ? { outcome: 'mismatch', problem: refusal.line } as const
        : { outcome: 'refused', problem: refusal.line } as const;
      return { step, refusal };
    }
    if (!isHubUnreachable(error)) {
      warn(`${OPENING}: ${direction} over ${strategy} failed: ${problem}`);
      return { step: { outcome: 'failed', problem }, refusal: null };
    }
    if (!toldUnreachable) warn(hubUnreachableLine(hubUrl, error));
    toldUnreachable = true;
    return { step: { outcome: 'unreachable', problem }, refusal: null };
  };

  const attempted = async <Result>(direction: Direction, run: () => Promise<Result>, refusals: boolean): Promise<Attempted<Result>> => {
    try {
      return { step: { outcome: 'done', result: await run() }, refusal: null };
    } catch (error) {
      return caught(direction, error, refusals);
    }
  };

  const attempt = async <Result>(direction: Direction, run: () => Promise<Result>): Promise<HubContactStep<Result>> => (
    await attempted(direction, run, false)
  ).step;

  return Object.freeze({ tell, attempted, attempt });
}
