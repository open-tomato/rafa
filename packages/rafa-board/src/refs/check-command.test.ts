/** Tests for `issueCheckCommand` (`check-command.ts`). */
import { describe, expect, it } from 'bun:test';

import { issueCheckCommand } from './check-command.js';

describe('issueCheckCommand', () => {
  it('spells rafa issue check with the issue as a bare number', () => {
    expect(issueCheckCommand(151)).toBe('rafa issue check 151');
    expect(issueCheckCommand(7)).toBe('rafa issue check 7');
  });
});
