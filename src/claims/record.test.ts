/**
 * Tests for the claim record (`record.ts`): the message each of the six
 * actions writes, the parser reading it back, the three readings a
 * message can have (work, ownership, invalid), and `readOwnership`
 * folding a branch's commits oldest first.
 *
 * Every case but one is pure. The exception runs the real
 * `git interpret-trailers --parse` over files in this suite's own
 * temporary directory, as the control for the module's claim that its
 * trailer reading is git's: a message git reads trailers from is read as
 * ownership here, and one git reads none from is read as work. No case
 * touches a repository.
 */
import type { BranchCommit, ClaimRecord } from './record.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';

import {
  CLAIM_ACTIONS,
  formatClaimMessage,
  isClaimAction,
  parseClaimMessage,
  readOwnership,
} from './record.js';

const OWNER = '3f1c2b9e-0d4a-4c6e-9b1f-7a2d5e8c0f11';
const OTHER = 'b7e4a0d2-5c19-4f3b-8e6a-1d9c2f7b4a33';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claims-record-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** One record of each action, the handover naming {@link OTHER}. */
function recordOf(action: ClaimRecord['action'], store = OWNER): ClaimRecord {
  return action === 'hand'
    ? { action, issue: 324, store, to: OTHER }
    : { action, issue: 324, store };
}

/** A commit of `record`'s message, its sha the action and a counter. */
function ownershipCommit(sha: string, record: ClaimRecord): BranchCommit {
  return { sha, message: formatClaimMessage(record) };
}

/** A work commit: the kind the loop makes for every task. */
function workCommit(sha: string, message = 'feat: add the claim record\n\nWith its tests.\n'): BranchCommit {
  return { sha, message };
}

describe('the six actions', () => {
  it('are claim, release, hand, withdraw, accept and take', () => {
    expect([...CLAIM_ACTIONS]).toEqual(['claim', 'release', 'hand', 'withdraw', 'accept', 'take']);
  });

  it('are the only words isClaimAction accepts', () => {
    expect(CLAIM_ACTIONS.every((action) => isClaimAction(action))).toBe(true);
    expect(['Claim', 'handover', '', 'work'].some((word) => isClaimAction(word))).toBe(false);
  });
});

describe('formatClaimMessage', () => {
  it('writes the subject and the two trailers of a claim', () => {
    expect(formatClaimMessage(recordOf('claim'))).toBe(
      `claim(rafa-324): claim\n\nRafa-Claim: claim\nRafa-Claim-Store: ${OWNER}\n`,
    );
  });

  it('adds Rafa-Claim-To on a handover, and on nothing else', () => {
    const messages = CLAIM_ACTIONS.map((action) => formatClaimMessage(recordOf(action)));

    expect(messages.filter((message) => message.includes('Rafa-Claim-To:'))).toEqual([
      `claim(rafa-324): hand\n\nRafa-Claim: hand\nRafa-Claim-Store: ${OWNER}\nRafa-Claim-To: ${OTHER}\n`,
    ]);
  });

  it('refuses an issue that is not a positive integer', () => {
    for (const issue of [0, -3, 1.5, Number.NaN]) {
      expect(() => formatClaimMessage({ action: 'claim', issue, store: OWNER })).toThrow(
        'claim record: the issue must be a positive integer',
      );
    }
  });

  it('refuses a store id that is empty or holds a blank', () => {
    for (const store of ['', 'two words', 'line\nbreak']) {
      expect(() => formatClaimMessage({ action: 'take', issue: 1, store })).toThrow(
        'claim record: the store id must be one word',
      );
    }
  });

  it('refuses a handover to an empty store, or to its own', () => {
    expect(() => formatClaimMessage({ action: 'hand', issue: 1, store: OWNER, to: '' })).toThrow(
      'the receiving store id must be one word',
    );
    expect(() => formatClaimMessage({ action: 'hand', issue: 1, store: OWNER, to: OWNER })).toThrow(
      'a handover names another store, not its own',
    );
  });
});

describe('parseClaimMessage', () => {
  it('reads back every action it wrote', () => {
    for (const action of CLAIM_ACTIONS) {
      const record = recordOf(action);

      expect(parseClaimMessage(formatClaimMessage(record))).toEqual({ kind: 'ownership', record });
    }
  });

  it('reads a commit with no trailer as work, not ownership', () => {
    expect(parseClaimMessage('feat: add the claim record\n\nWith its tests.\n')).toEqual({ kind: 'work' });
  });

  it('reads a claim subject with no trailer as work: the trailers decide, not the subject', () => {
    expect(parseClaimMessage('claim(rafa-324): claim\n')).toEqual({ kind: 'work' });
    expect(parseClaimMessage('claim(rafa-324): claim\n\nNo trailers here.\n')).toEqual({ kind: 'work' });
  });

  it('reads trailers only from the last paragraph, as git does', () => {
    const message = `fix: a thing\n\nRafa-Claim: claim\nRafa-Claim-Store: ${OWNER}\n\nA paragraph after.\n`;

    expect(parseClaimMessage(message)).toEqual({ kind: 'work' });
  });

  it('reads a message of one paragraph as work, even one that looks like trailers', () => {
    expect(parseClaimMessage(`Rafa-Claim: claim\nRafa-Claim-Store: ${OWNER}`)).toEqual({ kind: 'work' });
  });

  it('reads work commits carrying other trailers as work', () => {
    const message = 'feat: x\n\nCo-Authored-By: Someone <someone@example.test>\nRafa-Task: 3\n';

    expect(parseClaimMessage(message)).toEqual({ kind: 'work' });
  });

  it('matches the trailer keys without regard to case, and reads CRLF line ends', () => {
    const message = `claim(rafa-9): take\r\n\r\nrafa-claim: take\r\nRAFA-CLAIM-STORE: ${OWNER}\r\n`;

    expect(parseClaimMessage(message)).toEqual({
      kind: 'ownership',
      record: { action: 'take', issue: 9, store: OWNER },
    });
  });

  it('keeps the claim trailers when other trailers share their paragraph', () => {
    const message = `${formatClaimMessage(recordOf('release'))}Co-Authored-By: Someone <someone@example.test>\n`;

    expect(parseClaimMessage(message)).toEqual({ kind: 'ownership', record: recordOf('release') });
  });

  it.each([
    ['an unknown action', `claim(rafa-1): steal\n\nRafa-Claim: steal\nRafa-Claim-Store: ${OWNER}`, 'unknown Rafa-Claim action "steal"'],
    ['no Rafa-Claim trailer', `claim(rafa-1): claim\n\nRafa-Claim-Store: ${OWNER}`, 'no Rafa-Claim trailer'],
    ['no Rafa-Claim-Store trailer', 'claim(rafa-1): claim\n\nRafa-Claim: claim', 'no Rafa-Claim-Store trailer'],
    ['two Rafa-Claim-Store trailers', `claim(rafa-1): claim\n\nRafa-Claim: claim\nRafa-Claim-Store: ${OWNER}\nRafa-Claim-Store: ${OTHER}`, '2 Rafa-Claim-Store trailers'],
    ['an empty store id', 'claim(rafa-1): claim\n\nRafa-Claim: claim\nRafa-Claim-Store: ', 'the store id must be one word'],
    ['a store id with a blank', 'claim(rafa-1): claim\n\nRafa-Claim: claim\nRafa-Claim-Store: two words', 'the store id must be one word'],
    ['a handover with no receiver', `claim(rafa-1): hand\n\nRafa-Claim: hand\nRafa-Claim-Store: ${OWNER}`, 'no Rafa-Claim-To trailer'],
    ['a handover to its own store', `claim(rafa-1): hand\n\nRafa-Claim: hand\nRafa-Claim-Store: ${OWNER}\nRafa-Claim-To: ${OWNER}`, 'a handover names another store'],
    ['a receiver on a take', `claim(rafa-1): take\n\nRafa-Claim: take\nRafa-Claim-Store: ${OWNER}\nRafa-Claim-To: ${OTHER}`, 'a Rafa-Claim-To trailer on a take commit'],
    ['a subject naming another action', `claim(rafa-1): claim\n\nRafa-Claim: release\nRafa-Claim-Store: ${OWNER}`, 'is not claim(rafa-<n>): release'],
    ['a subject that is no claim subject', `feat: x\n\nRafa-Claim: claim\nRafa-Claim-Store: ${OWNER}`, 'is not claim(rafa-<n>): claim'],
    ['an issue with a leading zero', `claim(rafa-012): claim\n\nRafa-Claim: claim\nRafa-Claim-Store: ${OWNER}`, 'is not claim(rafa-<n>): claim'],
  ])('reads %s as invalid', (_name, message, reason) => {
    const reading = parseClaimMessage(message);
    if (reading.kind !== 'invalid') {
      throw new Error(`expected invalid, got ${reading.kind}`);
    }

    expect(reading.reason).toContain(reason);
  });
});

describe('the trailer reading, against git interpret-trailers', () => {
  /** The trailer lines git reads from `message`, one per line. */
  function gitTrailers(name: string, message: string): string {
    const path = join(tempBase, name);
    writeFileSync(path, message, 'utf8');
    const result = createGitRunner(tempBase)(['interpret-trailers', '--parse', path]);
    if (!result.ok) {
      throw new Error(`git interpret-trailers failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  it('reads the same three trailers from a handover that git does', () => {
    const message = formatClaimMessage(recordOf('hand'));

    expect(gitTrailers('hand.txt', message)).toBe(
      `Rafa-Claim: hand\nRafa-Claim-Store: ${OWNER}\nRafa-Claim-To: ${OTHER}\n`,
    );
    expect(parseClaimMessage(message).kind).toBe('ownership');
  });

  it('reads no trailer where git reads none: a middle paragraph and a one-line message', () => {
    const middle = `fix: a thing\n\nRafa-Claim: claim\nRafa-Claim-Store: ${OWNER}\n\nA paragraph after.\n`;
    const oneLine = 'claim(rafa-324): claim\n';

    expect([gitTrailers('middle.txt', middle), gitTrailers('one-line.txt', oneLine)]).toEqual(['', '']);
    expect([parseClaimMessage(middle), parseClaimMessage(oneLine)]).toEqual([{ kind: 'work' }, { kind: 'work' }]);
  });
});

describe('readOwnership', () => {
  it('answers none for a branch with no commits', () => {
    expect(readOwnership([])).toEqual({ state: 'none', ignored: [] });
  });

  it('answers none for a branch of work commits only: work is never ownership', () => {
    expect(readOwnership([workCommit('w1'), workCommit('w2', 'claim(rafa-324): claim\n')])).toEqual({
      state: 'none',
      ignored: [],
    });
  });

  it('answers the claimant as the owner, whatever work follows the claim', () => {
    const commits = [ownershipCommit('c1', recordOf('claim')), workCommit('w1'), workCommit('w2')];

    expect(readOwnership(commits)).toEqual({ state: 'held', owner: OWNER, pending: null, ignored: [] });
  });

  it('keeps the owner through a handover, with the handover pending', () => {
    const commits = [ownershipCommit('c1', recordOf('claim')), workCommit('w1'), ownershipCommit('h1', recordOf('hand'))];

    expect(readOwnership(commits)).toEqual({
      state: 'held',
      owner: OWNER,
      pending: { to: OTHER, sha: 'h1' },
      ignored: [],
    });
  });

  it('keeps a handover pending across work the owner commits after it', () => {
    const commits = [ownershipCommit('c1', recordOf('claim')), ownershipCommit('h1', recordOf('hand')), workCommit('w1')];

    expect(readOwnership(commits)).toMatchObject({ state: 'held', owner: OWNER, pending: { to: OTHER, sha: 'h1' } });
  });

  it('clears a pending handover on withdrawal, the owner still the owner', () => {
    const commits = [
      ownershipCommit('c1', recordOf('claim')),
      ownershipCommit('h1', recordOf('hand')),
      ownershipCommit('x1', recordOf('withdraw')),
    ];

    expect(readOwnership(commits)).toEqual({ state: 'held', owner: OWNER, pending: null, ignored: [] });
  });

  it('moves the claim to the receiver on acceptance', () => {
    const commits = [
      ownershipCommit('c1', recordOf('claim')),
      ownershipCommit('h1', recordOf('hand')),
      ownershipCommit('a1', recordOf('accept', OTHER)),
    ];

    expect(readOwnership(commits)).toEqual({ state: 'held', owner: OTHER, pending: null, ignored: [] });
  });

  it('answers released after a release, naming who released it', () => {
    const commits = [ownershipCommit('c1', recordOf('claim')), workCommit('w1'), ownershipCommit('r1', recordOf('release'))];

    expect(readOwnership(commits)).toEqual({ state: 'released', releasedBy: OWNER, ignored: [] });
  });

  it('answers a released claim taken by another store as held by the taker', () => {
    const commits = [
      ownershipCommit('c1', recordOf('claim')),
      ownershipCommit('r1', recordOf('release')),
      ownershipCommit('t1', recordOf('take', OTHER)),
    ];

    expect(readOwnership(commits)).toEqual({ state: 'held', owner: OTHER, pending: null, ignored: [] });
  });

  it('answers a takeover of a held claim as held by the taker, the old owner\'s work kept', () => {
    const commits = [ownershipCommit('c1', recordOf('claim')), workCommit('w1'), ownershipCommit('t1', recordOf('take', OTHER))];

    expect(readOwnership(commits)).toEqual({ state: 'held', owner: OTHER, pending: null, ignored: [] });
  });

  it('reads the commits oldest first: the last ownership commit decides', () => {
    const claim = ownershipCommit('c1', recordOf('claim'));
    const release = ownershipCommit('r1', recordOf('release'));

    expect(readOwnership([claim, release]).state).toBe('released');
    expect(readOwnership([release, claim]).state).toBe('held');
  });

  it('passes over an invalid ownership commit, listing it in ignored', () => {
    const forged = { sha: 'f1', message: `claim(rafa-324): steal\n\nRafa-Claim: steal\nRafa-Claim-Store: ${OTHER}\n` };
    const commits = [ownershipCommit('c1', recordOf('claim')), forged];

    expect(readOwnership(commits)).toEqual({
      state: 'held',
      owner: OWNER,
      pending: null,
      ignored: [{ sha: 'f1', reason: 'unknown Rafa-Claim action "steal"' }],
    });
  });

  it('answers none when every claim-looking commit is invalid, listing each', () => {
    const invalid = { sha: 'i1', message: 'claim(rafa-324): claim\n\nRafa-Claim: claim\n' };

    expect(readOwnership([invalid, workCommit('w1')])).toEqual({
      state: 'none',
      ignored: [{ sha: 'i1', reason: 'no Rafa-Claim-Store trailer' }],
    });
  });
});
