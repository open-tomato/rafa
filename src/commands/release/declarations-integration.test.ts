/**
 * The `release` declarations as values: the subject, each declaration under
 * it, and the flags `declarations.ts` spells for the modules that read them.
 *
 * These cases import `declarations.ts`, and so reach core's command types;
 * the cases that read its source for what it imports stay in
 * `declarations.test.ts` beside this file.
 */
import { describe, expect, it } from 'bun:test';

import {
  RELEASE_SETTLE_DECLARATION,
  RELEASE_SETTLE_DRY_RUN_FLAG,
  RELEASE_STATUS_DECLARATION,
  RELEASE_STATUS_PLAN_FLAG,
  RELEASE_SUBJECT,
  RELEASE_TAG_DECLARATION,
  RELEASE_TAG_PUSH_FLAG,
} from './declarations.js';

describe('the release declarations', () => {
  const declarations = [RELEASE_STATUS_DECLARATION, RELEASE_SETTLE_DECLARATION, RELEASE_TAG_DECLARATION];

  it('names the release subject, frozen', () => {
    expect(RELEASE_SUBJECT.name).toBe('release');
    expect(Object.isFrozen(RELEASE_SUBJECT)).toBe(true);
  });

  it('puts each declaration under the release subject, its name the subject and its action', () => {
    expect(declarations.map((declaration) => [declaration.subject, declaration.action, declaration.name])).toEqual([
      ['release', 'status', 'release status'],
      ['release', 'settle', 'release settle'],
      ['release', 'tag', 'release tag'],
    ]);
    expect(declarations.every((declaration) => Object.isFrozen(declaration))).toBe(true);
  });

  it('declares the flags status.ts, settle.ts and tag.ts read on their commands', () => {
    expect(declarations.map((declaration) => declaration.flags.map((flag) => flag.name))).toEqual([
      [RELEASE_STATUS_PLAN_FLAG],
      [RELEASE_SETTLE_DRY_RUN_FLAG],
      [RELEASE_TAG_PUSH_FLAG],
    ]);
    expect([RELEASE_STATUS_PLAN_FLAG, RELEASE_SETTLE_DRY_RUN_FLAG, RELEASE_TAG_PUSH_FLAG]).toEqual(['plan', 'dry-run', 'push']);
  });

  it('declares no spends, since no release command starts a session', () => {
    expect(declarations.map((declaration) => declaration.spends)).toEqual([undefined, undefined, undefined]);
  });
});
