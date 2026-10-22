/**
 * The `claim` declarations as values: the subject, each declaration under
 * it, and the flags `declarations.ts` spells for the modules that read them.
 *
 * These cases import `declarations.ts`, and so reach core's command types;
 * the cases that read its source for what it imports stay in
 * `declarations.test.ts` beside this file.
 */
import { describe, expect, it } from 'bun:test';

import {
  CLAIM_ACCEPT_DECLARATION,
  CLAIM_HAND_DECLARATION,
  CLAIM_HAND_TO_FLAG,
  CLAIM_HAND_WITHDRAW_FLAG,
  CLAIM_RELEASE_DECLARATION,
  CLAIM_SUBJECT,
  CLAIM_TAKE_DECLARATION,
  CLAIM_TAKE_STALE_FLAG,
} from './declarations.js';

describe('the claim declarations', () => {
  it('names the claim subject, frozen', () => {
    expect(CLAIM_SUBJECT.name).toBe('claim');
    expect(Object.isFrozen(CLAIM_SUBJECT)).toBe(true);
  });

  it('puts each declaration under the claim subject, its name the subject and its action', () => {
    const declarations = [CLAIM_RELEASE_DECLARATION, CLAIM_HAND_DECLARATION, CLAIM_ACCEPT_DECLARATION, CLAIM_TAKE_DECLARATION];

    expect(declarations.map((declaration) => [declaration.subject, declaration.action, declaration.name])).toEqual([
      ['claim', 'release', 'claim release'],
      ['claim', 'hand', 'claim hand'],
      ['claim', 'accept', 'claim accept'],
      ['claim', 'take', 'claim take'],
    ]);
    expect(declarations.every((declaration) => Object.isFrozen(declaration))).toBe(true);
  });

  it('declares the flags hand.ts and take.ts read on their commands', () => {
    expect(CLAIM_HAND_DECLARATION.flags.map((flag) => flag.name)).toEqual([CLAIM_HAND_TO_FLAG, CLAIM_HAND_WITHDRAW_FLAG]);
    expect(CLAIM_TAKE_DECLARATION.flags.map((flag) => flag.name)).toEqual([CLAIM_TAKE_STALE_FLAG]);
    expect([CLAIM_HAND_TO_FLAG, CLAIM_HAND_WITHDRAW_FLAG, CLAIM_TAKE_STALE_FLAG]).toEqual(['to', 'withdraw', 'stale']);
  });

  it('declares no spends, since no claim command starts a session', () => {
    expect([CLAIM_RELEASE_DECLARATION, CLAIM_HAND_DECLARATION, CLAIM_ACCEPT_DECLARATION, CLAIM_TAKE_DECLARATION]
      .map((declaration) => declaration.spends)).toEqual([undefined, undefined, undefined, undefined]);
  });
});
