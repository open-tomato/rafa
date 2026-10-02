/**
 * Scoring test of the nearest-open-bug step (`src/triage/similarity.ts`)
 * at the default threshold, over the board's own reports
 * (`./testdata/scoring.json`, built by `scripts/extract-scoring-fixture.ts`;
 * `./scoring-fixture.ts` says how each is labelled with its cause).
 *
 * The replay files the reports in the order they were written, through
 * the public lookup of `./triage.ts` as far as it is built: a report whose
 * key an earlier report stored reaches the issue that key was stored
 * under (step 1), and any other is scored against the issues filed so far
 * (step 2), each one open, its body written by `./issue-text.ts`, and
 * taken for the nearest issue at or above the threshold. A report is a
 * repeat when its cause already has an issue, else a new cause that files
 * one; step 2's match, or a new issue, stores the report's key.
 *
 *   - a repeat reaches the right issue when the lookup lands on the issue
 *     its cause owns;
 *   - a new cause lands wrong when the lookup lands on any issue, which
 *     would be of another cause: the report is commented on it and filed
 *     nowhere.
 *
 * The key's part is replayed because the step never sees a report the key
 * finds: counted alone, step 2 reaches fewer repeats, since the ones left
 * to it are the ones worded away from their issue. The last test holds
 * both facts: the key alone falls short of the bound, and the step is what
 * lifts the lookup over it.
 */
import type { Filing, ScoringFixture } from './scoring-fixture.js';
import type { OpenIssue } from '../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { bugKeyOf } from './bug-key.js';
import { ISSUE_OPENING, issueText } from './issue-text.js';
import { firstLeakIn } from './scoring-fixture.js';
import { nearestOpenBugs } from './similarity.js';

/** The default of `triage.similarity.threshold`. */
const THRESHOLD = 0.3;

/** The share of repeats that must reach the issue owning their cause. */
const MIN_REPEATS_RIGHT = 0.81;

/** The share of new causes that may land on an issue of another cause. */
const MAX_NEW_CAUSES_WRONG = 0.06;

/** A threshold no score is under, which turns step 2 off. */
const STEP_TWO_OFF = Number.POSITIVE_INFINITY;

/** The smallest score step 2 reads, which takes any one shared word for a match. */
const ANY_SHARED_WORD = Number.MIN_VALUE;

const fixture = await Bun.file(new URL('./testdata/scoring.json', import.meta.url)).json() as ScoringFixture;

/** The open issue filed for `filing`, numbered by its cause. */
function openIssueOf(filing: Filing): OpenIssue {
  const body = issueText(ISSUE_OPENING, {
    what: filing.what,
    artifact: filing.artifact,
    key: null,
    refs: null,
    planStub: null,
    taskText: '',
    feedback: null,
  }, (text) => text);
  return {
    ref: { opt: filing.cause, kind: 'github', externalId: String(filing.cause), url: null },
    title: filing.what,
    body,
  };
}

/** The key step 1 looks `filing` up by, or null when it has no artifact and so no key. */
function keyOf(filing: Filing): string | null {
  return filing.artifact === null
    ? null
    : bugKeyOf(`PLAN_TRACKER-${filing.plan ?? 'none'}.md`, filing.artifact, filing.what);
}

/** What the replay counted. */
interface Score {
  readonly repeats: number;
  readonly repeatsRight: number;
  readonly newCauses: number;
  readonly newCausesWrong: number;
}

/** The share `part` is of `whole`; 0 for no whole. */
function shareOf(part: number, whole: number): number {
  return whole === 0
    ? 0
    : part / whole;
}

/** Files `filings` in order and scores where each lookup lands; see the module note. */
function replay(filings: readonly Filing[], threshold: number): Score {
  const open = new Map<number, OpenIssue>();
  const stored = new Map<string, number>();
  const tally = { repeats: 0, repeatsRight: 0, newCauses: 0, newCausesWrong: 0 };
  for (const filing of filings) {
    const key = keyOf(filing);
    const keyed = key === null
      ? undefined
      : stored.get(key);
    const [nearest] = keyed === undefined
      ? nearestOpenBugs(filing, [...open.values()])
      : [];
    const byWords = nearest !== undefined && nearest.score >= threshold
      ? nearest.issue.ref.opt
      : null;
    const reached = keyed ?? byWords;
    if (key !== null && keyed === undefined) stored.set(key, reached ?? filing.cause);
    if (open.has(filing.cause)) {
      tally.repeats += 1;
      if (reached === filing.cause) tally.repeatsRight += 1;
    } else {
      tally.newCauses += 1;
      if (reached !== null) tally.newCausesWrong += 1;
      open.set(filing.cause, openIssueOf(filing));
    }
  }
  return tally;
}

describe('the scoring fixture', () => {
  it('holds reports of many causes, some repeated', () => {
    const causes = new Set(fixture.filings.map(({ cause }) => cause));
    expect(causes.size).toBeGreaterThan(100);
    expect(fixture.filings.length).toBeGreaterThan(causes.size);
  });

  it('holds no local path and no secret', () => {
    expect(firstLeakIn(fixture.filings)).toBeNull();
  });

  it('names the plan of every report that has one in a form a key can use', () => {
    const planned = fixture.filings.filter(({ plan }) => plan !== null);
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every(({ plan }) => plan !== '' && !/\s/.test(plan!))).toBe(true);
  });
});

describe('the nearest open bug at the default threshold', () => {
  const score = replay(fixture.filings, THRESHOLD);

  it('reaches the issue owning the cause for at least 81% of repeats', () => {
    expect(score.repeats).toBeGreaterThan(0);
    expect(shareOf(score.repeatsRight, score.repeats)).toBeGreaterThanOrEqual(MIN_REPEATS_RIGHT);
  });

  it('lands at most 6% of new causes on an issue of another cause', () => {
    expect(score.newCauses).toBeGreaterThan(0);
    expect(shareOf(score.newCausesWrong, score.newCauses)).toBeLessThanOrEqual(MAX_NEW_CAUSES_WRONG);
  });

  it('is what lifts the lookup over the repeat bound, the key alone falling short of it', () => {
    const keyOnly = replay(fixture.filings, STEP_TWO_OFF);
    expect(shareOf(keyOnly.repeatsRight, keyOnly.repeats)).toBeLessThan(MIN_REPEATS_RIGHT);
  });

  it('would break the new-cause bound at a threshold that takes any shared word for a match', () => {
    const loose = replay(fixture.filings, ANY_SHARED_WORD);
    expect(shareOf(loose.newCausesWrong, loose.newCauses)).toBeGreaterThan(MAX_NEW_CAUSES_WRONG);
  });
});
