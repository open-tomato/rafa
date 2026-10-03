/**
 * Tests for the task prompt's gate lines (`task-gate-lines.ts`): the base
 * line naming `bun test --changed=<base>`, no line for a null base, an
 * abbreviated commit name taken, and a base that is not a commit name
 * refused. Where `buildTaskPrompt` places the line is driven in
 * `dispatch.test.ts`.
 */

import { describe, expect, it } from 'bun:test';

import { BASE_PROMPT_PREFIX, baseLines } from './task-gate-lines.js';

describe('baseLines, handing the task its base commit', () => {
  const BASE = 'a5a383a0c3f1e2d4b6a798011223344556677889';

  it('names the base and bun test --changed=<base> in one line', () => {
    expect(baseLines(BASE)).toEqual([
      `${BASE_PROMPT_PREFIX}${BASE}: run \`bun test --changed=${BASE}\` for the tests your changes reach.`,
    ]);
  });

  it('gives no line for a null base', () => {
    expect(baseLines(null)).toEqual([]);
  });

  it('takes an abbreviated commit name', () => {
    expect(baseLines('a5a383a').join('\n')).toContain('--changed=a5a383a`');
  });

  it('refuses a base that is not a commit name, which the line would paste into a shell command', () => {
    for (const base of ['', 'HEAD', 'origin/main', 'a5a383a; rm -rf .', 'A5A383A']) {
      expect(() => baseLines(base)).toThrow('is not a commit name');
    }
  });
});
