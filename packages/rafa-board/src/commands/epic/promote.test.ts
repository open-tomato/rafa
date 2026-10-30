/**
 * Tests for `rafa epic promote`'s declaration (`promote.ts`): its name,
 * its line, and that it declares no `spends`. What the run does is
 * `./horizon-change.test.ts`'s, dispatched through this command.
 */
import { describe, expect, it } from 'bun:test';

import promoteCommand, { createEpicPromoteCommand } from './promote.js';

describe('rafa epic promote', () => {
  it('is the promote action of the epic subject, with <n>, a required --to and --reason', () => {
    const command = createEpicPromoteCommand();

    expect([command.name, command.subject, command.action]).toEqual(['epic promote', 'epic', 'promote']);
    expect(command.args?.map((arg) => [arg.name, arg.required])).toEqual([['n', true]]);
    expect(command.flags?.map((flag) => [flag.name, flag.required === true])).toEqual([['to', true], ['reason', false]]);
    expect(command.flags?.[0]?.description).toContain('one of now, next');
    expect(command.outputs).toEqual(['text', 'json']);
  });

  it('declares no spends, and its default export is the command made with the system\'s seams', () => {
    expect(promoteCommand.spends).toBeUndefined();
    expect(promoteCommand.name).toBe('epic promote');
    expect(Object.isFrozen(promoteCommand)).toBe(true);
  });
});
