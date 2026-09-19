/**
 * Tests for the triage selection (`src/pr/triage/select.ts`): which pull
 * request a bare `rafa pr triage` assesses, the 72-hour rule over two or
 * three candidates, the listing above three, and the `--resolve`
 * refusal above one.
 *
 * The module is pure and its clock is an input, so every case here is a
 * direct call over literals: pull request summaries built by `pull`,
 * timestamps built by `hoursAgo` against a fixed {@link NOW}. Nothing
 * spawns a process, reaches GitHub or reads the real clock — a case that
 * did would drift into a different reading three days after it was
 * written, which is exactly the rule under test.
 *
 * The decision set is held closed from both ends the way
 * `rerun.test.ts` holds its own: {@link EVERY_DECISION} labels one input
 * per decision, and the closed-set case asserts the decisions it
 * produced are exactly `TRIAGE_SELECTION_DECISIONS`. A seventh decision
 * added to the module without a case here reddens that assertion rather
 * than passing unmeasured.
 *
 * Five readings carry a control, because each could pass while wrong:
 *
 *   - `branch` STOPS every other reading, so its case is paired with the
 *     same candidates and no branch pull request, which must not read
 *     that way.
 *   - The 72-hour rule does NOT apply to a lone candidate, so the
 *     eleven-day-old pull request that `single` assesses is the same one
 *     that is skipped when two fresh ones stand beside it. A rule
 *     applied everywhere, or nowhere, fails one half or the other.
 *   - The cap is at three, so the four-candidate listing is paired with
 *     the same list minus one, which must assess.
 *   - The window's edge is measured from both sides: a candidate that
 *     moved exactly {@link TRIAGE_FRESH_WINDOW_MS} ago is assessed and
 *     one a millisecond older is skipped, through the whole selection
 *     and not only through `isFreshCandidate`.
 *   - The `--resolve` refusal counts candidates, so it is paired with a
 *     single candidate under the same flag, which must be assessed and
 *     exit 0.
 *
 * Twelve mutations of `select.ts` were driven on 2026-09-18, one at a
 * time, over this file. 33 pass either side, and the module was restored
 * from a scratch copy and verified with `shasum -c` after each. Each
 * line below is the run's own count, not a prediction:
 *
 *   - `isFreshCandidate` answering true whatever it was handed: 10 fail.
 *   - `isFreshCandidate` answering false whatever it was handed: 16 fail,
 *     including all four closed-set cases, which lose `some` entirely.
 *   - the window widened to 73 hours: 1 fail. It was 0 fail until the
 *     case that reads 71 and a half and 72 and a half hours was written
 *     — every other case measures the window through
 *     `TRIAGE_FRESH_WINDOW_MS`, which the widened constant moves with
 *     it, so the number 72 itself was unmeasured. That case is here
 *     because the mutation found the gap, not the other way round.
 *   - the window read with `<` rather than `<=`: 2 fail, the two cases
 *     standing exactly on the edge.
 *   - `ageMs` treating an unparseable timestamp as 0 rather than null: 5
 *     fail — the three unreadable-timestamp cases, and the two that read
 *     an unparseable value beside a timestamp ahead of the clock, which
 *     a zero age collapses onto the same words.
 *   - the current branch's pull request no longer outranking the
 *     candidates: 4 fail, the two branch cases and the two closed-set
 *     cases that reach `branch` through it.
 *   - the `--resolve` refusal counting what would be ASSESSED rather
 *     than the candidates: 1 fail, the narrowed-to-one case, and only
 *     that one.
 *   - the refusal firing from one candidate up: 1 fail, its control.
 *   - `MAX_TRIAGE_CANDIDATES` raised to 4: 4 fail, the listing case and
 *     three closed-set cases.
 *   - the single-candidate arm skipped, so a lone candidate falls into
 *     the two-or-three arm: 5 fail, including the lone stale pull
 *     request, which is then listed instead of assessed.
 *   - `byNumber` left unsorted: 7 fail.
 *   - `describeAge` always saying days: 3 fail.
 */
import type { TriageSelectionDecision, TriageSelectionInput } from './select.js';
import type { PullRequestSummary } from '../types.js';

import { describe, expect, it } from 'bun:test';

import {
  describeAge,
  isFreshCandidate,
  isTriageSelectionDecision,
  MAX_TRIAGE_CANDIDATES,
  REFUSE_EXIT_CODE,
  selectTriagePullRequests,
  TRIAGE_FRESH_HOURS,
  TRIAGE_FRESH_WINDOW_MS,
  TRIAGE_SELECTION_DECISIONS,
  triageCommand,
} from './select.js';

/** The clock every case reads against. */
const NOW = '2026-09-18T12:00:00Z';

/** An ISO timestamp `hours` before {@link NOW}, to the millisecond. */
function hoursAgo(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
}

/** An ISO timestamp `ms` before {@link NOW}. */
function msAgo(ms: number): string {
  return new Date(Date.parse(NOW) - ms).toISOString();
}

/** One pull request as the port answers it, red unless a case says otherwise. */
function pull(number: number, overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number,
    title: `rafa-${number}: a change`,
    url: `https://github.com/open-tomato/rafa/pull/${number}`,
    state: 'open',
    headRefName: `feat/rafa-${number}`,
    baseRefName: 'main',
    author: { login: 'marcos', isBot: false },
    isCrossRepository: false,
    updatedAt: hoursAgo(2),
    ...overrides,
  };
}

/** A pull request that last moved eleven days ago, as the spec sample has one. */
function old(number: number): PullRequestSummary {
  return pull(number, { updatedAt: hoursAgo(11 * 24) });
}

/** One selection input: no branch pull request, and the candidates given. */
function input(overrides: Partial<TriageSelectionInput> = {}): TriageSelectionInput {
  return { current: null, candidates: [pull(21)], now: NOW, ...overrides };
}

/** The decision one input reads as. */
function decisionOf(one: TriageSelectionInput): TriageSelectionDecision {
  return selectTriagePullRequests(one).decision;
}

/** The numbers a selection assesses, in the order it answered them. */
function assessed(one: TriageSelectionInput): number[] {
  return selectTriagePullRequests(one).assess.map((each) => each.number);
}

/**
 * One input per decision, each labelled with the decision it must
 * produce. The closed-set case reads this from both ends.
 */
const EVERY_DECISION: readonly (readonly [TriageSelectionDecision, TriageSelectionInput])[] = [
  ['branch', input({ current: pull(30) })],
  ['refuse', input({ candidates: [pull(21), pull(24)], resolve: true })],
  ['none', input({ candidates: [] })],
  ['single', input()],
  ['some', input({ candidates: [pull(21), pull(24), old(9)] })],
  ['list', input({ candidates: [pull(21), pull(24), pull(27), pull(30)] })],
];

describe('the decision set', () => {
  it('provokes every decision the module declares, and no decision it does not', () => {
    const produced = EVERY_DECISION.map(([, one]) => decisionOf(one));

    expect([...new Set(produced)].sort()).toEqual([...TRIAGE_SELECTION_DECISIONS].sort());
    expect(produced.every((one) => isTriageSelectionDecision(one))).toBe(true);
  });

  it('reaches from each labelled input exactly the decision it is labelled with', () => {
    for (const [expected, one] of EVERY_DECISION) expect(decisionOf(one)).toBe(expected);
  });

  it('gives every decision a headline and a message that opens with it', () => {
    for (const [, one] of EVERY_DECISION) {
      const read = selectTriagePullRequests(one);

      expect(read.headline.length).toBeGreaterThan(0);
      expect(read.message.startsWith(read.headline)).toBe(true);
      expect(read.message.endsWith('\n')).toBe(false);
    }
  });

  it('assesses nothing where it listed, and lists nothing where it assessed', () => {
    for (const [expected, one] of EVERY_DECISION) {
      const read = selectTriagePullRequests(one);
      const assesses = expected !== 'none' && expected !== 'list' && expected !== 'refuse';

      expect(read.assess.length > 0).toBe(assesses);
      expect(read.exitCode).toBe(expected === 'refuse'
        ? REFUSE_EXIT_CODE
        : 0);
    }
  });
});

describe('a pull request open on the current branch', () => {
  it('is the answer whatever red pull requests the repository has', () => {
    const read = selectTriagePullRequests(input({
      current: pull(30, { headRefName: 'feat/rafa-30-board' }),
      candidates: [pull(21), pull(24), old(9)],
    }));

    expect(read.decision).toBe('branch');
    expect(read.assess.map((each) => each.number)).toEqual([30]);
    expect(read.skipped).toEqual([]);
    expect(read.lines).toEqual([]);
    expect(read.headline).toContain('#30');
    expect(read.headline).toContain('feat/rafa-30-board');
  });

  it('does not read that way with no pull request on the branch, from the same candidates', () => {
    const read = selectTriagePullRequests(input({ candidates: [pull(21), pull(24), old(9)] }));

    expect(read.decision).toBe('some');
    expect(read.assess.map((each) => each.number)).toEqual([21, 24]);
  });

  it('is a single explicit target, so --resolve does not refuse on it', () => {
    const read = selectTriagePullRequests(input({
      current: pull(30),
      candidates: [pull(21), pull(24)],
      resolve: true,
    }));

    expect(read.decision).toBe('branch');
    expect(read.exitCode).toBe(0);
  });

  it('is assessed even when it is green, which the rerun reading decides about', () => {
    const read = selectTriagePullRequests(input({ current: pull(30), candidates: [] }));

    expect(read.decision).toBe('branch');
    expect(read.assess.map((each) => each.number)).toEqual([30]);
  });
});

describe('one red pull request', () => {
  it('is assessed however long ago it moved', () => {
    const read = selectTriagePullRequests(input({ candidates: [old(9)] }));

    expect(read.decision).toBe('single');
    expect(read.assess.map((each) => each.number)).toEqual([9]);
    expect(read.skipped).toEqual([]);
    expect(read.headline).toBe('1 red: assessing #9, last moved 11 days ago');
  });

  it('is skipped as older once two fresh ones stand beside it, which is the control', () => {
    const read = selectTriagePullRequests(input({ candidates: [pull(21), pull(24), old(9)] }));

    expect(read.decision).toBe('some');
    expect(read.assess.map((each) => each.number)).toEqual([21, 24]);
    expect(read.skipped.map((each) => each.number)).toEqual([9]);
  });
});

describe('two or three red pull requests', () => {
  it('assesses the fresh ones and names the older one with the command for it', () => {
    const read = selectTriagePullRequests(input({ candidates: [old(9), pull(24), pull(21)] }));

    expect(read.decision).toBe('some');
    expect(read.headline).toBe('3 red: assessing #21 and #24; 1 older one is skipped');
    expect(read.lines).toEqual(['   #9 last moved 11 days ago, run rafa pr triage 9']);
    expect(read.message).toContain('rafa pr triage 9');
    expect(read.skipped[0]?.fresh).toBe(false);
    expect(read.exitCode).toBe(0);
  });

  it('lists nothing when both moved inside the window', () => {
    const read = selectTriagePullRequests(input({
      candidates: [pull(24), pull(21, { updatedAt: hoursAgo(TRIAGE_FRESH_HOURS - 1) })],
    }));

    expect(read.decision).toBe('some');
    expect(read.headline).toBe('2 red: assessing #21 and #24');
    expect(read.skipped).toEqual([]);
    expect(read.lines).toEqual([]);
  });

  it('assesses one that moved exactly at the edge of the window', () => {
    const read = selectTriagePullRequests(input({
      candidates: [pull(21), pull(24, { updatedAt: msAgo(TRIAGE_FRESH_WINDOW_MS) })],
    }));

    expect(read.decision).toBe('some');
    expect(read.assess.map((each) => each.number)).toEqual([21, 24]);
  });

  it('skips one that moved a millisecond further back, which is the other side of the edge', () => {
    const read = selectTriagePullRequests(input({
      candidates: [pull(21), pull(24, { updatedAt: msAgo(TRIAGE_FRESH_WINDOW_MS + 1) })],
    }));

    expect(read.decision).toBe('some');
    expect(read.assess.map((each) => each.number)).toEqual([21]);
    expect(read.skipped.map((each) => each.number)).toEqual([24]);
  });

  it('assesses nothing and lists both when neither moved inside the window', () => {
    const read = selectTriagePullRequests(input({ candidates: [old(9), old(12)] }));

    expect(read.decision).toBe('list');
    expect(read.assess).toEqual([]);
    expect(read.headline).toContain(`none moved in the last ${TRIAGE_FRESH_HOURS} hours`);
    expect(read.lines.length).toBe(2);
    expect(read.exitCode).toBe(0);
  });

  it('names the numbers ascending however the port ordered them', () => {
    expect(assessed(input({ candidates: [pull(24), pull(9), pull(21)] }))).toEqual([9, 21, 24]);
  });
});

describe('more red pull requests than the cap', () => {
  it('assesses none, and lists every one of them with its own command', () => {
    const candidates = [pull(30), pull(27), pull(24), pull(21)];
    const read = selectTriagePullRequests(input({ candidates }));

    expect(read.decision).toBe('list');
    expect(read.assess).toEqual([]);
    expect(read.skipped.map((each) => each.number)).toEqual([21, 24, 27, 30]);
    expect(read.headline).toContain(`more than the ${MAX_TRIAGE_CANDIDATES}`);
    expect(read.lines.length).toBe(4);
    for (const number of [21, 24, 27, 30]) {
      expect(read.message).toContain(`run rafa pr triage ${number}`);
    }
    expect(read.exitCode).toBe(0);
  });

  it('assesses the same list one shorter, which is the control on the cap', () => {
    const read = selectTriagePullRequests(input({
      candidates: [pull(27), pull(24), pull(21)],
    }));

    expect(read.decision).toBe('some');
    expect(read.assess.map((each) => each.number)).toEqual([21, 24, 27]);
  });
});

describe('no red pull request at all', () => {
  it('says so, assesses nothing and exits 0', () => {
    const read = selectTriagePullRequests(input({ candidates: [] }));

    expect(read.decision).toBe('none');
    expect(read.assess).toEqual([]);
    expect(read.skipped).toEqual([]);
    expect(read.lines).toEqual([]);
    expect(read.exitCode).toBe(0);
    expect(read.headline).toContain('no red pull request');
  });
});

describe('--resolve', () => {
  it('refuses above one candidate, exits 2 and lists the resolving command for each', () => {
    const read = selectTriagePullRequests(input({
      candidates: [pull(24), pull(21)],
      resolve: true,
    }));

    expect(read.decision).toBe('refuse');
    expect(read.assess).toEqual([]);
    expect(read.exitCode).toBe(REFUSE_EXIT_CODE);
    expect(read.headline).toContain('rafa pr triage --resolve refuses');
    expect(read.lines).toEqual([
      '   #21 last moved 2 hours ago, run rafa pr triage 21 --resolve',
      '   #24 last moved 2 hours ago, run rafa pr triage 24 --resolve',
    ]);
  });

  it('assesses a single candidate under the same flag, which is the control', () => {
    const read = selectTriagePullRequests(input({ candidates: [pull(21)], resolve: true }));

    expect(read.decision).toBe('single');
    expect(read.assess.map((each) => each.number)).toEqual([21]);
    expect(read.exitCode).toBe(0);
  });

  it('still refuses when the 72-hour rule would have narrowed them to one', () => {
    const read = selectTriagePullRequests(input({
      candidates: [pull(21), old(9), old(12)],
      resolve: true,
    }));

    expect(read.decision).toBe('refuse');
    expect(read.exitCode).toBe(REFUSE_EXIT_CODE);
    expect(read.lines.length).toBe(3);
  });

  it('writes the flag into every listed command, and only when it was asked for', () => {
    expect(triageCommand(9)).toBe('rafa pr triage 9');
    expect(triageCommand(9, true)).toBe('rafa pr triage 9 --resolve');
  });
});

describe('a timestamp that cannot be read', () => {
  it('counts as older, so the pull request is listed rather than assessed', () => {
    const unreadable = pull(9, { updatedAt: 'last tuesday' });
    const read = selectTriagePullRequests(input({ candidates: [pull(21), pull(24), unreadable] }));

    expect(read.decision).toBe('some');
    expect(read.assess.map((each) => each.number)).toEqual([21, 24]);
    expect(read.skipped[0]?.age).toBe('at an unrecorded time');
    expect(read.lines[0]).toContain('at an unrecorded time');
  });

  it('is assessed with the same number and a readable timestamp, which is the control', () => {
    const readable = pull(9, { updatedAt: hoursAgo(3) });
    const read = selectTriagePullRequests(input({ candidates: [pull(21), pull(24), readable] }));

    expect(read.assess.map((each) => each.number)).toEqual([9, 21, 24]);
    expect(read.skipped).toEqual([]);
  });

  it('makes every candidate older when it is the clock that cannot be read', () => {
    const read = selectTriagePullRequests(input({
      candidates: [pull(21), pull(24)],
      now: 'whenever',
    }));

    expect(read.decision).toBe('list');
    expect(read.assess).toEqual([]);
    expect(read.lines.length).toBe(2);
  });

  it('still assesses a lone candidate, because that arm never asks about the age', () => {
    const read = selectTriagePullRequests(input({
      candidates: [pull(21, { updatedAt: 'last tuesday' })],
    }));

    expect(read.decision).toBe('single');
    expect(read.headline).toContain('at an unrecorded time');
  });
});

describe('the freshness window', () => {
  it('is inclusive at its edge and closed a millisecond past it', () => {
    expect(isFreshCandidate(msAgo(TRIAGE_FRESH_WINDOW_MS), NOW)).toBe(true);
    expect(isFreshCandidate(msAgo(TRIAGE_FRESH_WINDOW_MS + 1), NOW)).toBe(false);
    expect(TRIAGE_FRESH_WINDOW_MS).toBe(TRIAGE_FRESH_HOURS * 3_600_000);
  });

  it('is 72 hours wide and no wider, read from either side of that mark', () => {
    expect(TRIAGE_FRESH_HOURS).toBe(72);
    expect(isFreshCandidate(hoursAgo(71.5), NOW)).toBe(true);
    expect(isFreshCandidate(hoursAgo(72.5), NOW)).toBe(false);
    expect(assessed(input({
      candidates: [pull(21), pull(24, { updatedAt: hoursAgo(72.5) })],
    }))).toEqual([21]);
  });

  it('holds a timestamp ahead of the clock, and refuses one it cannot parse', () => {
    expect(isFreshCandidate(hoursAgo(-4), NOW)).toBe(true);
    expect(isFreshCandidate('last tuesday', NOW)).toBe(false);
    expect(isFreshCandidate(hoursAgo(1), 'whenever')).toBe(false);
  });
});

describe('how an age is said', () => {
  it('says minutes as less than an hour, then hours, then days', () => {
    expect(describeAge(msAgo(90_000), NOW)).toBe('less than an hour ago');
    expect(describeAge(hoursAgo(1), NOW)).toBe('1 hour ago');
    expect(describeAge(hoursAgo(2), NOW)).toBe('2 hours ago');
    expect(describeAge(hoursAgo(47), NOW)).toBe('47 hours ago');
    expect(describeAge(hoursAgo(48), NOW)).toBe('2 days ago');
    expect(describeAge(hoursAgo(11 * 24), NOW)).toBe('11 days ago');
  });

  it('says a timestamp ahead of the clock as just now, and an unreadable one as unrecorded', () => {
    expect(describeAge(hoursAgo(-1), NOW)).toBe('just now');
    expect(describeAge('last tuesday', NOW)).toBe('at an unrecorded time');
  });
});

describe('the decision vocabulary', () => {
  it('is frozen, and recognises its own words and no others', () => {
    expect(Object.isFrozen(TRIAGE_SELECTION_DECISIONS)).toBe(true);
    expect(TRIAGE_SELECTION_DECISIONS.every((one) => isTriageSelectionDecision(one))).toBe(true);
    expect(isTriageSelectionDecision('listed')).toBe(false);
    expect(isTriageSelectionDecision(3)).toBe(false);
  });
});
