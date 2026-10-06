/**
 * Tests for the Stage rule (`rules.ts`): one case per row of the Stage
 * outline, each row's negative cases first — the facts that look like
 * the row and must NOT land in its column — then the row itself.
 *
 * Every row below Cancelled is also held against the rows to its right,
 * so a case proves the rightmost matching column wins rather than only
 * that a lone fact maps to its column.
 */
import type { StageFacts, StageFragment, StagePullRequest } from './rules.js';

import { describe, expect, it } from 'bun:test';

import { stageOf, STAGE_OPTIONS } from './rules.js';

/** An open issue with no label and no pull request, overridden by `facts`. */
function issue(facts: Partial<StageFacts> = {}): StageFacts {
  return { state: 'OPEN', stateReason: null, labels: [], pullRequests: [], ...facts };
}

/** A closed issue with `reason`, overridden by `facts`. */
function closed(reason: string | null, facts: Partial<StageFacts> = {}): StageFacts {
  return issue({ state: 'CLOSED', stateReason: reason, ...facts });
}

/** A fragment at `level`, still on the base branch unless `onBase` says otherwise. */
function fragment(level: StageFragment['level'], onBase = true): StageFragment {
  return { level, onBase };
}

/** A merged pull request that added `added`. */
function merged(added: StageFragment | null = null): StagePullRequest {
  return { state: 'MERGED', fragment: added };
}

/** An open pull request that added `added`. */
function openPr(added: StageFragment | null = null): StagePullRequest {
  return { state: 'OPEN', fragment: added };
}

describe('STAGE_OPTIONS', () => {
  it('names the eleven options of the template, left to right, by their exact names', () => {
    expect(STAGE_OPTIONS).toEqual([
      'Backlog',
      'Triage',
      'Needs work',
      'Ready',
      'Blocked',
      'Claimed',
      'In development',
      'Waiting for approval',
      'In review',
      'Done',
      'Cancelled',
    ]);
  });
});

describe('stageOf: epics', () => {
  it('gives a non-epic issue a column', () => {
    expect(stageOf(issue({ labels: ['type:feature'] }))).toBe('Backlog');
  });

  it('gives an epic no Stage, open or closed', () => {
    expect(stageOf(issue({ labels: ['type:epic', 'spec:ready'] }))).toBeNull();
    expect(stageOf(closed('NOT_PLANNED', { labels: ['type:epic'] }))).toBeNull();
  });
});

describe('stageOf: closed as not planned or duplicate → Cancelled', () => {
  it('does not cancel an open issue, nor one closed as completed', () => {
    expect(stageOf(issue({ stateReason: 'NOT_PLANNED' }))).toBe('Backlog');
    expect(stageOf(closed('COMPLETED'))).toBe('Done');
  });

  it('cancels an issue closed as not planned, whatever its pull requests and labels', () => {
    const facts = closed('NOT_PLANNED', { labels: ['rafa:in-development'], pullRequests: [merged(fragment('minor'))] });

    expect(stageOf(facts)).toBe('Cancelled');
  });

  it('cancels an issue closed as a duplicate', () => {
    expect(stageOf(closed('DUPLICATE'))).toBe('Cancelled');
  });
});

describe('stageOf: closed as completed → In review or Done', () => {
  it('is Done, not In review, when the merged PR added no fragment', () => {
    expect(stageOf(closed('COMPLETED', { pullRequests: [merged()] }))).toBe('Done');
  });

  it('is Done, not In review, when the fragment is `level: none`', () => {
    expect(stageOf(closed('COMPLETED', { pullRequests: [merged(fragment('none'))] }))).toBe('Done');
  });

  it('is Done, not In review, when settle already folded the fragment off the base', () => {
    expect(stageOf(closed('COMPLETED', { pullRequests: [merged(fragment('patch', false))] }))).toBe('Done');
  });

  it('is Done, not In review, when the shipping fragment belongs to a PR still open', () => {
    expect(stageOf(closed('COMPLETED', { pullRequests: [openPr(fragment('patch'))] }))).toBe('Done');
  });

  it('is Done when closed by hand with no pull request, whatever its labels', () => {
    expect(stageOf(closed('COMPLETED', { labels: ['rafa:claimed'] }))).toBe('Done');
  });

  it('reads a closed issue with no close reason as completed', () => {
    expect(stageOf(closed(null))).toBe('Done');
  });

  it('is In review while its merged PR\'s shipping fragment is still on the base', () => {
    const facts = closed('COMPLETED', { pullRequests: [merged(fragment('none')), merged(fragment('minor'))] });

    expect(stageOf(facts)).toBe('In review');
  });
});

describe('stageOf: open with a merged PR (integration branch) → In review or Done', () => {
  it('is Done, not In review, when the merged PR added no fragment', () => {
    expect(stageOf(issue({ pullRequests: [merged()] }))).toBe('Done');
  });

  it('is Done, not In review, when the merged PR\'s fragment is `level: none`', () => {
    expect(stageOf(issue({ pullRequests: [merged(fragment('none'))] }))).toBe('Done');
  });

  it('is In review when the merged PR added a shipping fragment, wherever that fragment now is', () => {
    expect(stageOf(issue({ pullRequests: [merged(fragment('patch', false))] }))).toBe('In review');
  });

  it('wins over an open PR and the stage labels to its left', () => {
    const facts = issue({ labels: ['rafa:in-development'], pullRequests: [openPr(), merged(fragment('major'))] });

    expect(stageOf(facts)).toBe('In review');
  });
});

describe('stageOf: linked PR open → Waiting for approval', () => {
  it('does not wait on a pull request that is not linked', () => {
    expect(stageOf(issue({ labels: ['rafa:in-development'] }))).toBe('In development');
  });

  it('waits for approval on an open PR, over every label to its left', () => {
    const facts = issue({ labels: ['rafa:in-development', 'spec:blocked'], pullRequests: [openPr(fragment('patch'))] });

    expect(stageOf(facts)).toBe('Waiting for approval');
  });
});

describe('stageOf: the label rows', () => {
  it('reads no column from a label that only resembles one', () => {
    const lookalikes = ['rafa:in-dev', 'rafa:claim', 'spec:block', 'spec:readiness', 'needs-work', 'triage'];

    expect(stageOf(issue({ labels: lookalikes }))).toBe('Backlog');
  });

  it('is In development on rafa:in-development, over rafa:claimed', () => {
    expect(stageOf(issue({ labels: ['rafa:claimed', 'rafa:in-development'] }))).toBe('In development');
  });

  it('is Claimed on rafa:claimed, over spec:blocked', () => {
    expect(stageOf(issue({ labels: ['spec:blocked', 'rafa:claimed'] }))).toBe('Claimed');
  });

  it('is Blocked on spec:blocked, over spec:ready', () => {
    expect(stageOf(issue({ labels: ['spec:ready', 'spec:blocked'] }))).toBe('Blocked');
  });

  it('is Ready on spec:ready, over spec:needs-work', () => {
    expect(stageOf(issue({ labels: ['spec:needs-work', 'spec:ready'] }))).toBe('Ready');
  });

  it('is Needs work on spec:needs-work, over needs-triage', () => {
    expect(stageOf(issue({ labels: ['needs-triage', 'spec:needs-work'] }))).toBe('Needs work');
  });

  it('is Triage on needs-triage', () => {
    expect(stageOf(issue({ labels: ['type:bug', 'needs-triage'] }))).toBe('Triage');
  });
});

describe('stageOf: nothing → Backlog', () => {
  it('is Backlog for an open issue with no stage label and no pull request', () => {
    expect(stageOf(issue({ labels: ['type:feature', 'module:board'] }))).toBe('Backlog');
  });
});
