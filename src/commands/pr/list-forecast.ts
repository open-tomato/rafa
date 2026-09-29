/**
 * The forecast column of `rafa pr list`: the release forecast each open
 * pull request's body carries, marked when its base has moved since.
 *
 * ```text
 *   #12  Settle on the base  rafa-21  updated 2h ago  checks green  MERGEABLE  ships as the next minor, 0.26.0 if merged now (base moved)
 *
 *   #12 forecast was made against origin/main at 0.25.0 with rafa-19 waiting; origin/main is now at 0.26.0 with none waiting
 * ```
 *
 * ## The body's forecast, not a new one
 *
 * The sentence is the one the wrap-up wrote into the body, read back by
 * `readBodyForecast` (`src/release/body-forecast.ts`); it was made by
 * `src/release/forecast.ts` when the body was written, and nothing here
 * folds or calls a strategy. What this module adds is the reading of the
 * base NOW, so a sentence computed against a base that has moved on is
 * marked rather than read as current: the release it names may be taken
 * or settled already. A new forecast needs the branch's fragment, which
 * this command, reading the provider and the base only, does not read.
 *
 * ## The base, as last fetched
 *
 * The base is `origin/<base branch>` of each pull request — its own
 * `baseRefName`, since pull requests into two branches are forecast
 * against two bases — read by `readWaiting`
 * (`src/commands/release/status-fragments.ts`), the reading `rafa release
 * status` prints, so the two commands cannot disagree over one tree.
 * Like that one, it fetches nothing: the ref is read as last fetched and
 * named in the line, and each base is read once however many pull
 * requests point at it.
 *
 * ## The cell
 *
 *   - the sentence, when the base is where the body's basis says;
 *   - the sentence and `(base moved)`, with a line under the table naming
 *     the basis and the base now;
 *   - the sentence and `(base ?)`, with a line saying why the base could
 *     not be read, when the basis cannot be compared;
 *   - `no forecast` for a body carrying none — a branch from before
 *     fragments, a wrap-up that did not reach its release stage, or one
 *     whose forecast was not computed;
 *   - `?` for a body that could not be read, whose failure the
 *     mergeable line already names, since one read answers both.
 *
 * A sentence whose marker names no basis is shown as it is, with no
 * mark: there is nothing to compare, and no base is read for it.
 *
 * The column is left out altogether where the project's release is off
 * (`resolveReleaseEnabled`), since no body there carries a forecast.
 */
import type { RafaConfig } from '../../config.js';
import type { GitRunner } from '../../pr/index.js';
import type { ForecastBasis } from '../../release/forecast.js';

import { forecastMoved, readBodyForecast } from '../../release/body-forecast.js';
import { RELEASE_REMOTE } from '../../release/version.js';
import { readWaiting } from '../release/status-fragments.js';

import { SEPARATOR } from './current.js';

/** The release settings the base is read with, named as `ResolvedConfig` names them. */
export type ListForecastSettings = Pick<
  RafaConfig,
  'releaseFragments' | 'releaseVersionFile' | 'releaseStrategy' | 'releaseHeading'
>;

/** The base of a pull request as last fetched: its version and waiting fragments, or why not. */
export interface BaseNow {
  /** The ref read, e.g. `origin/main`. */
  readonly ref: string;
  /** The version and the ids of the fragments that parse, or null when it could not be read. */
  readonly basis: ForecastBasis | null;
  /** Why it could not be read, or null when it was. */
  readonly problem: string | null;
}

/** What the forecast column holds for one pull request; see the module note. */
export type PrListForecast =
  | { readonly kind: 'unread' }
  | { readonly kind: 'absent' }
  | {
    readonly kind: 'body';
    /** The sentence the body carries. */
    readonly sentence: string;
    /** What the body's forecast was computed against, or null when its marker names nothing. */
    readonly basis: ForecastBasis | null;
    /** The base as last fetched, or null when there is no basis to compare it with. */
    readonly base: BaseNow | null;
    /** Whether the base moved since; null when the two cannot be compared. */
    readonly moved: boolean | null;
  };

/** Reads a base branch's state; see {@link createBaseReader}. */
export type BaseReader = (baseBranch: string) => BaseNow;

/** The cell of a body that carries no forecast. */
export const NO_FORECAST = 'no forecast';

/** The mark of a forecast whose base moved since. */
export const MOVED_MARK = '(base moved)';

/** The mark of a forecast whose base could not be read to compare. */
export const UNCHECKED_MARK = '(base ?)';

/** The base `ref` as `readWaiting` reads it. */
function readBase(git: GitRunner, settings: ListForecastSettings, ref: string): BaseNow {
  const reading = readWaiting(git, { ...settings, ref });
  if (reading.baseVersion === null) {
    return { ref, basis: null, problem: reading.problems[0] ?? `${ref} could not be read` };
  }
  return {
    ref,
    basis: { baseVersion: reading.baseVersion, waiting: reading.fragments.map((each) => each.id) },
    problem: null,
  };
}

/** A reader of `origin/<branch>` that reads each branch once; see the module note. */
export function createBaseReader(git: GitRunner, settings: ListForecastSettings): BaseReader {
  const read = new Map<string, BaseNow>();
  return (baseBranch) => {
    const known = read.get(baseBranch);
    if (known !== undefined) return known;
    const now = readBase(git, settings, `${RELEASE_REMOTE}/${baseBranch}`);
    read.set(baseBranch, now);
    return now;
  };
}

/**
 * The column for one pull request: `body` null when it could not be
 * read, and its base read through `readBaseOf` only when there is a
 * forecast to compare.
 */
export function listForecast(body: string | null, baseBranch: string, readBaseOf: BaseReader): PrListForecast {
  if (body === null) return { kind: 'unread' };
  const carried = readBodyForecast(body);
  if (carried === null || carried.sentence === null) return { kind: 'absent' };
  const { sentence, basis } = carried;
  if (basis === null) return { kind: 'body', sentence, basis, base: null, moved: null };
  const base = readBaseOf(baseBranch);
  const moved = base.basis === null
    ? null
    : forecastMoved(basis, base.basis);
  return { kind: 'body', sentence, basis, base, moved };
}

/** The cell the column shows; `unreadable` is the table's own mark. */
export function forecastCell(forecast: PrListForecast, unreadable: string): string {
  if (forecast.kind === 'unread') return unreadable;
  if (forecast.kind === 'absent') return NO_FORECAST;
  if (forecast.moved === true) return `${forecast.sentence} ${MOVED_MARK}`;
  if (forecast.moved === null && forecast.basis !== null) return `${forecast.sentence} ${UNCHECKED_MARK}`;
  return forecast.sentence;
}

/** A basis as a phrase: `at 0.25.0 with rafa-19, rafa-20 waiting`. */
function basisPhrase(basis: ForecastBasis): string {
  const waiting = basis.waiting.length === 0
    ? 'none'
    : basis.waiting.join(', ');
  return `at ${basis.baseVersion} with ${waiting} waiting`;
}

/** The line under the table for pull request `number`, or null when there is nothing to say. */
export function forecastLine(number: number, forecast: PrListForecast): string | null {
  if (forecast.kind !== 'body' || forecast.basis === null || forecast.base === null) return null;
  const { base, basis } = forecast;
  if (base.basis === null) {
    return `#${number} forecast could not be checked against ${base.ref}${SEPARATOR}${base.problem ?? 'it could not be read'}`;
  }
  if (forecast.moved !== true) return null;
  return `#${number} forecast was made against ${base.ref} ${basisPhrase(basis)};`
    + ` ${base.ref} is now ${basisPhrase(base.basis)}`;
}
