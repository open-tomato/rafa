/**
 * Tests for the claim half of the roadmap's taken reading
 * (`src/board/roadmap-claims.ts`): which ref names which claim branch,
 * the remote claim reader's one fetch and its memo, the weighing of a
 * branch reading, and the idle wording.
 *
 * Git goes through {@link scriptedGit}, a runner answering the four
 * commands `fetchClaimBranches` and `readClaimBranch` send and recording
 * every call, so a reader that fetched per branch, or read a branch the
 * remote never answered, shows in the call list. No case spawns `git`.
 * The ownership commits are written by `formatClaimMessage`, the writer
 * the claim commands use, so the reader is fed what a real branch holds.
 *
 * Each reading is paired with the opposite one the same seam answers:
 * a pushed branch beside a local-only one, `origin` beside another
 * remote, a fresh held claim beside a stale one, a fetch that lands
 * beside one that fails.
 */
import type { ClaimBranchReading } from '../claims/git.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { describe, expect, it } from 'bun:test';

import { formatClaimMessage } from '../claims/record.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../claims/stale.js';

import {
  claimBranchOfRef,
  createRemoteClaimReader,
  idleText,
  keepsTaken,
  weighBranchClaim,
} from './roadmap-claims.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The clock every weighing case reads against. */
const NOW = new Date('2026-09-30T12:00:00Z');

/** A full sha for a planted tip. */
const TIP = 'a'.repeat(40);

/** A result with nothing wrong. */
function ok(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A runner answering the claim reads, with the fetch's answer given, recording every call. */
function scriptedGit(options: { readonly fetch?: GitResult; readonly messages?: readonly string[] } = {}): {
  run: GitRunner;
  calls: () => readonly (readonly string[])[];
} {
  let calls: readonly (readonly string[])[] = [];
  const seconds = String(Math.floor((NOW.getTime() - DAY) / 1000));
  const walked = (options.messages ?? []).map((message, index) => `${String(index).repeat(40)}\n${message}\0`).join('');
  return {
    run: (args) => {
      calls = [...calls, Object.freeze([...args])];
      if (args[0] === 'fetch') return options.fetch ?? ok('');
      if (args[0] === 'rev-parse') return ok(`${TIP}\n`);
      if (args[0] === 'log' && args[1] === '-1') return ok(`${seconds}\n`);
      if (args[0] === 'log') return ok(walked);
      return { ok: false, stdout: '', stderr: 'scriptedGit: no answer recorded' };
    },
    calls: () => calls,
  };
}

/** A found branch reading holding `ownership`, its tip committed `idleMs` before {@link NOW}. */
function found(ownership: Extract<ClaimBranchReading, { state: 'found' }>['ownership'], idleMs: number): ClaimBranchReading {
  return {
    state: 'found',
    branch: 'feat/rafa-20-x',
    tip: TIP,
    tipCommittedAt: new Date(NOW.getTime() - idleMs),
    commits: [],
    ownership,
  };
}

/** A held ownership naming `owner`. */
const held = (owner: string): Extract<ClaimBranchReading, { state: 'found' }>['ownership'] => ({
  state: 'held',
  owner,
  pending: null,
  ignored: [],
});

describe('claimBranchOfRef', () => {
  it('names the claim branch whatever prefix the ref carries', () => {
    const named = [
      'feat/rafa-20-pr-commands',
      'refs/heads/feat/rafa-20-pr-commands',
      'refs/remotes/origin/feat/rafa-20-pr-commands',
      'origin/feat/rafa-20',
    ].map(claimBranchOfRef);

    expect(named).toEqual(['feat/rafa-20-pr-commands', 'feat/rafa-20-pr-commands', 'feat/rafa-20-pr-commands', 'feat/rafa-20']);
  });

  it('names nothing for a ref that is no claim branch', () => {
    const named = ['refs/heads/main', 'feat/rafa-20x', 'feat/rafa-0-x', 'myfeat/rafa-2-x', 'fix/rafa-2-x'].map(claimBranchOfRef);

    expect(named).toEqual([null, null, null, null, null]);
  });
});

describe('createRemoteClaimReader', () => {
  const claim = formatClaimMessage({ action: 'claim', issue: 33, store: 'store-a' });

  it('fetches once on the first branch the remote holds, and reads each branch once', () => {
    const git = scriptedGit({ messages: [claim] });
    const read = createRemoteClaimReader(git.run, 'origin', [
      'refs/heads/main',
      'refs/heads/feat/rafa-33-board-setup',
      'refs/heads/feat/rafa-34-naming',
    ]);

    const first = read('feat/rafa-33-board-setup');
    const again = read('feat/rafa-33-board-setup');
    read('feat/rafa-34-naming');

    expect(first?.state === 'found' && first.ownership).toEqual({ state: 'held', owner: 'store-a', pending: null, ignored: [] });
    expect(again).toBe(first);
    expect(git.calls().map((call) => call[0])).toEqual(['fetch', 'rev-parse', 'log', 'log', 'rev-parse', 'log', 'log']);
  });

  it('answers null, calling nothing, for a branch only this checkout holds', () => {
    const git = scriptedGit({ messages: [claim] });
    const read = createRemoteClaimReader(git.run, 'origin', ['refs/heads/feat/rafa-33-board-setup']);

    expect(read('feat/rafa-20-pr-commands')).toBeNull();
    expect(git.calls()).toEqual([]);
  });

  it('answers null, calling nothing, when the scan asked a remote other than the one claims are read from', () => {
    const git = scriptedGit({ messages: [claim] });
    const read = createRemoteClaimReader(git.run, 'upstream', ['refs/heads/feat/rafa-33-board-setup']);

    expect(read('feat/rafa-33-board-setup')).toBeNull();
    expect(git.calls()).toEqual([]);
  });

  it('answers every branch unreadable, in git\'s words, when the one fetch fails', () => {
    const git = scriptedGit({ fetch: { ok: false, stdout: '', stderr: 'fatal: unable to access origin' } });
    const read = createRemoteClaimReader(git.run, 'origin', [
      'refs/heads/feat/rafa-33-board-setup',
      'refs/heads/feat/rafa-34-naming',
    ]);

    const readings = [read('feat/rafa-33-board-setup'), read('feat/rafa-34-naming')];

    expect(readings.map((reading) => reading?.state)).toEqual(['unreadable', 'unreadable']);
    expect(readings[0]?.state === 'unreadable' && readings[0].reason).toContain('fatal: unable to access origin');
    expect(git.calls().map((call) => call[0])).toEqual(['fetch']);
  });
});

describe('weighBranchClaim', () => {
  const weights = (labels: readonly string[]): Parameters<typeof weighBranchClaim>[1] => ({ labels, staleAfter: '3d', now: NOW });

  it('answers none where there is no claim to read', () => {
    const answers = [
      weighBranchClaim(null, weights([])),
      weighBranchClaim({ state: 'absent', branch: 'feat/rafa-20-x' }, weights([])),
      weighBranchClaim(found({ state: 'none', ignored: [] }, 5 * DAY), weights([CLAIMED_LABEL])),
    ];

    expect(answers).toEqual([{ state: 'none' }, { state: 'none' }, { state: 'none' }]);
  });

  it('carries the reason of a branch that could not be read', () => {
    const answer = weighBranchClaim({ state: 'unreadable', branch: 'feat/rafa-20-x', reason: 'bad object' }, weights([]));

    expect(answer).toEqual({ state: 'unreadable', reason: 'bad object' });
  });

  it('weighs an ownership with the stale reading: released, fresh, stale claimed, stale in development', () => {
    const answers = [
      weighBranchClaim(found({ state: 'released', releasedBy: 'store-a', ignored: [] }, 9 * DAY), weights([CLAIMED_LABEL])),
      weighBranchClaim(found(held('store-a'), DAY), weights([CLAIMED_LABEL])),
      weighBranchClaim(found(held('store-a'), 4 * DAY), weights([CLAIMED_LABEL])),
      weighBranchClaim(found(held('store-a'), 4 * DAY), weights([IN_DEVELOPMENT_LABEL])),
    ];

    expect(answers).toEqual([
      { state: 'released', releasedBy: 'store-a' },
      { state: 'held', owner: 'store-a', pending: null },
      { state: 'stale-claimed', owner: 'store-a', idleMs: 4 * DAY },
      { state: 'stale-in-development', owner: 'store-a', idleMs: 4 * DAY },
    ]);
  });
});

describe('keepsTaken', () => {
  it('frees a line only for a released claim or a stale rafa:claimed one', () => {
    const kept = [
      keepsTaken({ state: 'none' }),
      keepsTaken({ state: 'unreadable', reason: 'x' }),
      keepsTaken({ state: 'held', owner: 'a', pending: null }),
      keepsTaken({ state: 'stale-in-development', owner: 'a', idleMs: DAY }),
      keepsTaken({ state: 'stale-claimed', owner: 'a', idleMs: DAY }),
      keepsTaken({ state: 'released', releasedBy: 'a' }),
    ];

    expect(kept).toEqual([true, true, true, true, false, false]);
  });
});

describe('idleText', () => {
  it('writes hours under two days and whole days from two days on', () => {
    const written = [0, 36 * HOUR, 2 * DAY - 1, 2 * DAY, 5.9 * DAY].map(idleText);

    expect(written).toEqual(['0h', '36h', '47h', '2d', '5d']);
  });
});
