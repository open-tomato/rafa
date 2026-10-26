/**
 * Tests for `rafa epic defer`'s declaration (`defer.ts`): its name, its
 * line, that it runs the defer action and that it declares no `spends`.
 * What the run does is `./horizon-change.test.ts`'s, dispatched through
 * this command.
 */
import { describe, expect, it } from 'bun:test';

import deferCommand, { createEpicDeferCommand } from './defer.js';

describe('rafa epic defer', () => {
  it('is the defer action of the epic subject, with <n>, a required --to and --reason', () => {
    const command = createEpicDeferCommand();

    expect([command.name, command.subject, command.action]).toEqual(['epic defer', 'epic', 'defer']);
    expect(command.args?.map((arg) => [arg.name, arg.required])).toEqual([['n', true]]);
    expect(command.flags?.map((flag) => [flag.name, flag.required === true])).toEqual([['to', true], ['reason', false]]);
    expect(command.flags?.[0]?.description).toContain('one of next, later');
    expect(command.outputs).toEqual(['text', 'json']);
  });

  it('declares no spends, and its default export is the command made with the system\'s seams', () => {
    expect(deferCommand.spends).toBeUndefined();
    expect(deferCommand.name).toBe('epic defer');
    expect(Object.isFrozen(deferCommand)).toBe(true);
  });
});
