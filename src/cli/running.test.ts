/**
 * Tests for the running command record (`src/cli/running.ts`): set, read
 * and restore, nesting, and the frozen copy of the flags.
 */
import type { RafaCommand } from './command.js';

import { afterEach, describe, expect, test } from 'bun:test';

import { restoreRunningCommand, runningCommand, setRunningCommand } from './running.js';

/** A command with the fields a record reads, nothing run. */
function command(subject: string, action: string | null): RafaCommand {
  return {
    subject,
    action,
    name: subject,
    description: 'a stand-in',
    args: [],
    flags: [],
    run: async () => {},
  } as unknown as RafaCommand;
}

afterEach(() => {
  restoreRunningCommand(null);
});

describe('the running command record', () => {
  test('reads null while nothing is recorded', () => {
    expect(runningCommand()).toBeNull();
  });

  test('reads the command and flags set, and answers null as the record replaced', () => {
    const plan = command('plan', 'create');

    const previous = setRunningCommand(plan, { resolve: true, plan: 'x.md' });

    expect(previous).toBeNull();
    expect(runningCommand()?.command).toBe(plan);
    expect(runningCommand()?.flags).toEqual({ resolve: true, plan: 'x.md' });
  });

  test('restoring the answered record puts the outer command back after a nested set', () => {
    const outer = command('next', null);
    const inner = command('loop', 'start');
    const first = setRunningCommand(outer, {});

    const second = setRunningCommand(inner, { plan: 'y.md' });
    expect(runningCommand()?.command).toBe(inner);
    restoreRunningCommand(second);

    expect(runningCommand()?.command).toBe(outer);
    restoreRunningCommand(first);
    expect(runningCommand()).toBeNull();
  });

  test('keeps a frozen copy of the flags, unmoved by a later change to the caller\'s object', () => {
    const flags: Record<string, string | boolean> = { resolve: true };

    setRunningCommand(command('pr', 'triage'), flags);
    flags.resolve = false;

    expect(runningCommand()?.flags).toEqual({ resolve: true });
    expect(Object.isFrozen(runningCommand()?.flags)).toBe(true);
  });
});
