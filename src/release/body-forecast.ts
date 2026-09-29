/**
 * The release forecast a pull request body carries, read back out of
 * the block `./branch-forecast.ts` writes, and whether the base has
 * moved since it was computed.
 *
 * ```text
 * readBodyForecast(body)              → { sentence, basis } | null
 * forecastMoved(basis, current)       → true when the base moved
 * ```
 *
 * ## What is read, and what is not
 *
 * The block opens with `<!-- rafa:release v1 base=<version>
 * waiting=<id>,<id> -->` when the forecast was folded, and with a bare
 * `<!-- rafa:release v1 -->` when it was not; it closes with
 * `<!-- /rafa:release -->`. The BASIS is read off the opening marker
 * only, never off the prose, which is the reason the marker carries it.
 *
 * The SENTENCE is the one `./forecast.ts` made at wrap-up, read off the
 * block's `Release forecast: this branch <sentence> (<basis>)` line: the
 * text between that prefix and the line's LAST ` (`, because a sentence
 * may hold a parenthesis of its own (`ships no release (level none)`)
 * and the basis clause is always the last one. Nothing is folded here
 * and no strategy is called: the forecast a reader prints is the one
 * the fold answered when the body was written, and {@link forecastMoved}
 * says when that fold's inputs are no longer the base's.
 *
 * A body with no block answers null. A block whose forecast line says
 * `none computed`, or holds no forecast line (a level report alone),
 * answers a null sentence; a block with no basis in its marker answers
 * a null basis, which nobody can judge as moved or not.
 *
 * ## Moved
 *
 * The base moved when its version is not the basis version, or the ids
 * of the fragments waiting on it are not the basis ids in the same
 * order: the fold reads them in that order, so a reorder is a different
 * fold. Both sides list only the fragments that parse — the forecast
 * left a malformed one out of its fold and named it — so a malformed
 * fragment neither moves nor pins the base.
 */
import type { ForecastBasis } from './forecast.js';

import { RELEASE_BLOCK_CLOSE, RELEASE_BLOCK_OPEN } from './branch-forecast.js';

/** The forecast a pull request body carries; see the module note. */
export interface BodyForecast {
  /** The forecast sentence, or null when the block holds none. */
  readonly sentence: string | null;
  /** What the forecast was computed against, or null when the marker names nothing. */
  readonly basis: ForecastBasis | null;
}

/** The head of the forecast line of a folded forecast. */
const FORECAST_LINE_HEAD = 'Release forecast: this branch ';

/** Where the basis clause of a forecast line opens. */
const BASIS_CLAUSE_OPEN = ' (';

/** The opening marker's basis, as `blockOpen` in `./branch-forecast.ts` writes it. */
const MARKER_BASIS = /^ base=(\S+) waiting=(\S*) -->/;

/** The block's text, from its opening marker to its close, or null when the body has none. */
function blockOf(body: string): string | null {
  const open = body.indexOf(RELEASE_BLOCK_OPEN);
  if (open < 0) return null;
  const close = body.indexOf(RELEASE_BLOCK_CLOSE, open);
  if (close < 0) return null;
  return body.slice(open, close);
}

/** The basis the opening marker carries, or null when it carries none. */
function basisOf(block: string): ForecastBasis | null {
  const matched = MARKER_BASIS.exec(block.slice(RELEASE_BLOCK_OPEN.length));
  if (matched === null) return null;
  const waiting = matched[2] ?? '';
  return {
    baseVersion: matched[1] ?? '',
    waiting: waiting === ''
      ? []
      : waiting.split(','),
  };
}

/** The sentence of the block's forecast line, or null when it has no folded one. */
function sentenceOf(block: string): string | null {
  const line = block.split(/\r?\n/).find((each) => each.startsWith(FORECAST_LINE_HEAD));
  if (line === undefined) return null;
  const rest = line.slice(FORECAST_LINE_HEAD.length).trimEnd();
  const clause = rest.lastIndexOf(BASIS_CLAUSE_OPEN);
  const sentence = (clause < 0
    ? rest
    : rest.slice(0, clause)).trim();
  return sentence === ''
    ? null
    : sentence;
}

/** The forecast `body` carries, or null when it carries no release block; see the module note. */
export function readBodyForecast(body: string): BodyForecast | null {
  const block = blockOf(body);
  if (block === null) return null;
  return { sentence: sentenceOf(block), basis: basisOf(block) };
}

/** Whether `current` is not the base `basis` was computed against; see the module note. */
export function forecastMoved(basis: ForecastBasis, current: ForecastBasis): boolean {
  if (basis.baseVersion !== current.baseVersion) return true;
  if (basis.waiting.length !== current.waiting.length) return true;
  return basis.waiting.some((id, index) => id !== current.waiting[index]);
}
