/**
 * Tests for the stage label transitions (`labels.ts`): the `gh` command
 * each sends, the warning each answers for a board that is not `gh` and
 * for a write that fails, and the removal sending its second label after
 * the first failed.
 *
 * Every case drives the real `createGhIssueBoard` over a scripted runner,
 * so the argv asserted is the one `gh` would receive and a failure is the
 * board's own rejection; nothing reaches GitHub. Each warning case has a
 * `written` control beside it through the same runner, so a transition
 * that always warned would fail the control.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { IssueBoard } from '../board/issue-board.js';

import { describe, expect, it } from 'bun:test';

import { createGhIssueBoard } from '../board/issue-board.js';

import {
  labelClaimed,
  labelInDevelopment,
  STAGE_LABELS,
  unlabelMerged,
  unlabelReleased,
} from './labels.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from './stale.js';

const ISSUE = 324;
const OK: GhResult = { ok: true, stdout: '', stderr: '' };

/** A `gh` board whose runner records every argv and fails those `fails` picks. */
function world(fails: (args: readonly string[]) => boolean = () => false): {
  readonly board: IssueBoard;
  readonly calls: readonly (readonly string[])[];
} {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    return fails(args)
      ? { ok: false, stdout: '', stderr: `could not edit: ${args.join(' ')}` }
      : OK;
  };
  return { board: createGhIssueBoard({ gh }), calls };
}

/** True for an argv that names `label`. */
function naming(label: string): (args: readonly string[]) => boolean {
  return (args) => args.includes(label);
}

describe('labelClaimed', () => {
  it('adds rafa:claimed alone in one gh issue edit', async () => {
    const { board, calls } = world();
    expect(await labelClaimed(board, ISSUE)).toEqual({ outcome: 'written' });
    expect(calls).toEqual([['issue', 'edit', '324', '--add-label', CLAIMED_LABEL]]);
  });

  it('warns, naming the gh failure, when the write fails', async () => {
    const { board, calls } = world(() => true);
    const outcome = await labelClaimed(board, ISSUE);
    expect(outcome.outcome).toBe('warning');
    const warning = outcome.outcome === 'warning'
      ? outcome.warning
      : '';
    expect(warning).toContain('#324 was not labelled rafa:claimed');
    expect(warning).toContain('could not edit');
    expect(warning).toContain('the claim stands in git');
    expect(calls).toHaveLength(1);
  });

  it('warns and sends nothing when the board is not gh', async () => {
    expect(await labelClaimed(null, ISSUE)).toEqual({
      outcome: 'warning',
      warning: 'claim labels: #324 was not labelled rafa:claimed: the board is not gh; the claim stands in git',
    });
  });

  it('answers the board\'s argument refusal as a warning rather than throwing it', async () => {
    const { board, calls } = world();
    const outcome = await labelClaimed(board, 0);
    expect(outcome.outcome).toBe('warning');
    expect(outcome.outcome === 'warning' && outcome.warning).toContain('expected a positive whole number');
    expect(calls).toEqual([]);
  });
});

describe('labelInDevelopment', () => {
  it('swaps rafa:claimed for rafa:in-development in one gh issue edit', async () => {
    const { board, calls } = world();
    expect(await labelInDevelopment(board, ISSUE)).toEqual({ outcome: 'written' });
    expect(calls).toEqual([
      ['issue', 'edit', '324', '--remove-label', CLAIMED_LABEL, '--add-label', IN_DEVELOPMENT_LABEL],
    ]);
  });

  it('warns when the swap fails', async () => {
    const { board } = world(() => true);
    const outcome = await labelInDevelopment(board, ISSUE);
    expect(outcome.outcome === 'warning' && outcome.warning)
      .toContain('#324 was not moved from rafa:claimed to rafa:in-development');
  });

  it('warns when the board is not gh', async () => {
    const outcome = await labelInDevelopment(null, ISSUE);
    expect(outcome.outcome === 'warning' && outcome.warning).toContain('the board is not gh');
  });
});

describe.each([
  ['unlabelReleased', unlabelReleased, 'release'],
  ['unlabelMerged', unlabelMerged, 'merge'],
] as const)('%s', (_name, transition, why) => {
  it('removes both stage labels, in-development first, one write each', async () => {
    const { board, calls } = world();
    expect(await transition(board, ISSUE)).toEqual({ outcome: 'written' });
    expect(calls).toEqual(STAGE_LABELS.map((label) => ['issue', 'edit', '324', '--remove-label', label]));
    expect(STAGE_LABELS).toEqual([IN_DEVELOPMENT_LABEL, CLAIMED_LABEL]);
  });

  it('still removes rafa:claimed when removing rafa:in-development failed', async () => {
    const { board, calls } = world(naming(IN_DEVELOPMENT_LABEL));
    const outcome = await transition(board, ISSUE);
    expect(calls).toHaveLength(2);
    expect(outcome.outcome).toBe('warning');
    const warning = outcome.outcome === 'warning'
      ? outcome.warning
      : '';
    expect(warning).toContain(`#324 was not unlabelled rafa:in-development on ${why}`);
    expect(warning).not.toContain('not unlabelled rafa:claimed');
  });

  it('answers one warning line per failed removal', async () => {
    const { board } = world(() => true);
    const outcome = await transition(board, ISSUE);
    const warning = outcome.outcome === 'warning'
      ? outcome.warning
      : '';
    expect(warning.split('\n')).toHaveLength(2);
    expect(warning).toContain(`not unlabelled rafa:claimed on ${why}`);
  });

  it('warns and sends nothing when the board is not gh', async () => {
    expect(await transition(null, ISSUE)).toEqual({
      outcome: 'warning',
      warning: `claim labels: #324 was not unlabelled on ${why}: the board is not gh; the claim stands in git`,
    });
  });
});
