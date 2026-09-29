/**
 * The forecast of one branch's verified fragment, and the block the
 * wrap-up writes it into the pull request body with.
 *
 * ```text
 * readBranchForecast({ git, settings, prepared, verified, now })
 *   → { ok: true, ref, baseVersion, waiting, forecast, problems }
 *   → { ok: false, ref, problem, problems }
 * releaseBodyBlock({ forecast, levelReport }) → the marked block, or null
 * bodyWithRelease(body, sentence, block)      → the body to write
 * ```
 *
 * ## One base reading, not two
 *
 * Step 1 (`./prepare.ts`) already fetched the base branch and read the
 * fragments waiting on it at ONE commit, which its record carries as
 * {@link ReleasePrepared.base}. The base version is read at that same
 * commit — `git show <commit>:<version file>` — rather than by a second
 * fetch of the ref, so the version and the waiting fragments the fold
 * runs over are one tree, and a base that moved between the two reads
 * cannot mix two trees into one forecast. The fold itself is
 * `./forecast.ts`, which goes through the strategy port like settle
 * does, so what the body forecasts and what settle writes cannot
 * disagree over the same tree.
 *
 * The branch's fragment is the one step 3 verified, as the session left
 * it, with its id read off the file name. It has no add commit on the
 * base yet — a merge now would add it today — so its `addedOn` is the
 * UTC date of the `now` the caller passes, and no clock is read here.
 *
 * A waiting fragment that does not parse is left out of the fold and
 * named in {@link BranchForecastRead.problems}: settle would refuse to
 * fold it too, and a forecast that failed over another plan's fragment
 * would say nothing about this branch. A base version that cannot be
 * read is the one reading that stops the forecast, since every fold
 * starts from it; the block then says so in its place.
 *
 * ## The block is replaced, the sentence is appended
 *
 * The block opens with `<!-- rafa:release v1 ... -->` and closes with
 * `<!-- /rafa:release -->`. A folded forecast puts its basis into the
 * opening marker — `base=<version> waiting=<id>,<id>` — so a reader can
 * tell when the base has moved since the forecast was written without
 * parsing prose. A re-run of the wrap-up REPLACES the block rather than
 * adding a second one, because a forecast goes stale as the base moves
 * and two of them would contradict each other. A failure sentence stays
 * append-if-absent, as the release stage always wrote it: it is a record
 * of what happened, not a reading that goes stale.
 */
import type { ReleaseStrategy } from '../config-readers.js';
import type { Forecast } from './forecast.js';
import type { ReleasePrepared } from './prepare.js';
import type { FoldFragment } from './strategy.js';
import type { ReleaseVerified } from './verify.js';
import type { GitRunner } from '../pr/git.js';

import { posix } from 'node:path';

import { gitSaid } from '../pr/index.js';

import { forecastRelease } from './forecast.js';
import { FRAGMENT_EXTENSION } from './fragment.js';
import { releaseStrategyFor } from './strategy.js';
import { gitPathOf, readManifestVersion } from './version.js';

/** The settings a forecast reads, named as `ResolvedConfig` names them. */
export interface BranchForecastSettings {
  /** `release.versionFile`, whose version on the base the fold starts from. */
  readonly releaseVersionFile: string;
  /** `release.strategy`, the adapter the fold goes through. */
  readonly releaseStrategy: ReleaseStrategy;
  /** `release.heading`, the template the strategy renders a section with. */
  readonly releaseHeading: string;
}

/** What {@link readBranchForecast} reads. */
export interface BranchForecastInput {
  /** Git, run in the repository root. */
  readonly git: GitRunner;
  /** The release settings the fold runs under. */
  readonly settings: BranchForecastSettings;
  /** Step 1's record: the base commit and the fragments waiting on it. */
  readonly prepared: ReleasePrepared;
  /** Step 3's reading: the branch's fragment as the session left it. */
  readonly verified: ReleaseVerified;
  /** When the forecast is made; the branch fragment's add date is its UTC day. */
  readonly now: Date;
}

/** A forecast the fold answered, with the basis it was computed against. */
export interface BranchForecastRead {
  readonly ok: true;
  /** The base ref, e.g. `origin/main`. */
  readonly ref: string;
  /** The version the base's version file declared at the read commit. */
  readonly baseVersion: string;
  /** The ids of the waiting fragments folded before the branch's, in order. */
  readonly waiting: readonly string[];
  /** What the fold answered; see `./forecast.ts`. */
  readonly forecast: Forecast;
  /** A sentence per waiting fragment left out of the fold. */
  readonly problems: readonly string[];
}

/** A forecast that could not be computed, and why. */
export interface BranchForecastUnread {
  readonly ok: false;
  /** The base ref, e.g. `origin/main`. */
  readonly ref: string;
  /** One sentence saying what stopped it. */
  readonly problem: string;
  /** A sentence per waiting fragment left out of the fold. */
  readonly problems: readonly string[];
}

/** What {@link readBranchForecast} answers. */
export type BranchForecast = BranchForecastRead | BranchForecastUnread;

/** The opening marker's fixed head; a folded forecast adds its basis after it. */
export const RELEASE_BLOCK_OPEN = '<!-- rafa:release v1';

/** The line that closes the block. */
export const RELEASE_BLOCK_CLOSE = '<!-- /rafa:release -->';

/** How long `YYYY-MM-DD` is at the head of an ISO timestamp. */
const ISO_DATE_LENGTH = 10;

/** The waiting fragments that parsed, as the fold reads them, and the ones that did not. */
function waitingFragments(prepared: ReleasePrepared): {
  readonly folded: readonly FoldFragment[];
  readonly problems: readonly string[];
} {
  const folded: FoldFragment[] = [];
  const problems: string[] = [];
  for (const waiting of prepared.base.waiting) {
    if (waiting.reading.ok) {
      folded.push({ id: waiting.id, fragment: waiting.reading.fragment, addedOn: waiting.addedOn });
    } else {
      problems.push(`${prepared.base.ref}'s ${waiting.path} was left out of the forecast: ${waiting.reading.sentence}`);
    }
  }
  return { folded, problems };
}

/** The version the base's version file declares at the read commit, or the problem. */
function baseVersionAt(
  git: GitRunner,
  prepared: ReleasePrepared,
  versionFile: string,
): { readonly version: string } | { readonly problem: string } {
  const where = `${prepared.base.ref}:${gitPathOf(versionFile)}`;
  const shown = git(['show', `${prepared.base.commit}:${gitPathOf(versionFile)}`]);
  if (!shown.ok) return { problem: `${where} could not be read: ${gitSaid(shown)}` };
  const version = readManifestVersion(shown.stdout);
  return version === null
    ? { problem: `${where} declares no version` }
    : { version };
}

/**
 * The forecast of the verified fragment against the base step 1 read.
 * Never throws: a strategy that throws is the forecast's own `failed`
 * answer, and an unreadable base version is `ok: false`. See the module
 * note for why the base is read at step 1's commit.
 */
export function readBranchForecast(input: BranchForecastInput): BranchForecast {
  const { git, settings, prepared, verified, now } = input;
  const ref = prepared.base.ref;
  const { folded, problems } = waitingFragments(prepared);
  const base = baseVersionAt(git, prepared, settings.releaseVersionFile);
  if ('problem' in base) return { ok: false, ref, problem: base.problem, problems };

  const branch: FoldFragment = {
    id: posix.basename(verified.path, FRAGMENT_EXTENSION),
    fragment: verified.fragment,
    addedOn: now.toISOString().slice(0, ISO_DATE_LENGTH),
  };
  const strategy = releaseStrategyFor(settings.releaseStrategy, { heading: settings.releaseHeading });
  const forecast = forecastRelease({ strategy, baseVersion: base.version, waiting: folded, branch });
  return {
    ok: true,
    ref,
    baseVersion: base.version,
    waiting: folded.map((each) => each.id),
    forecast,
    problems,
  };
}

/** Which strategy answered, when the forecast names one. */
function strategyOf(forecast: Forecast): ReleaseStrategy | null {
  return 'strategy' in forecast
    ? forecast.strategy
    : null;
}

/** `count` waiting fragments, as a clause. */
function waitingClause(count: number): string {
  if (count === 0) return 'no fragment waiting';
  return count === 1
    ? '1 fragment waiting'
    : `${count} fragments waiting`;
}

/** The forecast as the one line the block and the terminal print. */
export function forecastLine(read: BranchForecast): string {
  if (!read.ok) return `Release forecast: none computed, because ${read.problem}`;
  const strategy = strategyOf(read.forecast);
  const by = strategy === null
    ? ''
    : `${strategy}, `;
  return `Release forecast: this branch ${read.forecast.sentence}`
    + ` (${by}${read.ref} at ${read.baseVersion}, ${waitingClause(read.waiting.length)})`;
}

/** The opening marker, with the basis when the forecast was folded. */
function blockOpen(forecast: BranchForecast | null): string {
  if (forecast === null || !forecast.ok) return `${RELEASE_BLOCK_OPEN} -->`;
  return `${RELEASE_BLOCK_OPEN} base=${forecast.baseVersion} waiting=${forecast.waiting.join(',')} -->`;
}

/** What {@link releaseBodyBlock} is made from. */
export interface ReleaseBodyParts {
  /** The forecast, or null when none was made. */
  readonly forecast: BranchForecast | null;
  /** The level report (`./level.ts`), or null when it did not fire. */
  readonly levelReport: string | null;
}

/**
 * The lines the block shows a reader, without its markers: the
 * forecast line, then the level report.
 */
export function releaseBodyLines(parts: ReleaseBodyParts): readonly string[] {
  const lines: string[] = [];
  if (parts.forecast !== null) lines.push(forecastLine(parts.forecast));
  if (parts.levelReport !== null) lines.push(`Level report: ${parts.levelReport}`);
  return lines;
}

/** The marked block, or null when there is nothing to put in it. */
export function releaseBodyBlock(parts: ReleaseBodyParts): string | null {
  const lines = releaseBodyLines(parts);
  if (lines.length === 0) return null;
  return [blockOpen(parts.forecast), ...lines, RELEASE_BLOCK_CLOSE].join('\n');
}

/** `body` with any earlier block taken out, whitespace around it collapsed. */
function withoutBlock(body: string): string {
  const open = body.indexOf(RELEASE_BLOCK_OPEN);
  if (open < 0) return body;
  const close = body.indexOf(RELEASE_BLOCK_CLOSE, open);
  if (close < 0) return body;
  const before = body.slice(0, open).trimEnd();
  const after = body.slice(close + RELEASE_BLOCK_CLOSE.length).trim();
  if (before === '') return after;
  return after === ''
    ? before
    : `${before}\n\n${after}`;
}

/** `body` and `paragraph` as two paragraphs, or `paragraph` alone. */
function appended(body: string, paragraph: string): string {
  const kept = body.trimEnd();
  return kept === ''
    ? paragraph
    : `${kept}\n\n${paragraph}`;
}

/**
 * The body to write: `sentence` appended unless the body already holds
 * it, and `block` in place of any earlier block. A null `block` leaves
 * an earlier block where it is. Answers `body` itself, unchanged, when
 * neither changes it; see the module note.
 */
export function bodyWithRelease(body: string, sentence: string | null, block: string | null): string {
  const said = sentence === null || body.includes(sentence)
    ? body
    : appended(body, sentence);
  return block === null || said.includes(block)
    ? said
    : appended(withoutBlock(said), block);
}
