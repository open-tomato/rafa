/**
 * Tests for the running command record (`src/cli/running.ts`): set, read
 * and restore, nesting, and the frozen copy of the flags; then the async
 * scope {@link runAsRunningCommand} runs a function in.
 *
 * The scope cases hold what the module-level value cannot: two runs that
 * overlap each read their own record after an await, and nothing is
 * recorded once both have ended, in both orders. With the first started
 * ending first, a set and a `finally` restore leave the second reading
 * null and the first's record behind for good; with it ending last, a
 * reader outside both, between the two endings, reads the first's. Each
 * overlap is ordered by gates the case opens itself, never by a timer,
 * so the order read is the order the case names. A record set at module
 * level ahead of a scope is the control that the scope leaves it alone:
 * the same reader answers it again once the scope has ended.
 *
 * Driven on 2026-10-10 against a stand-in of {@link runAsRunningCommand}
 * that set the module-level record and restored it in a `finally`, one
 * run over this file: the two overlap cases, the set-inside-a-scope
 * case and the listener case were red, the other nine green.
 *
 * The listener case holds the module note's "What reads outside the
 * scope" with an emitter of its own in place of a process signal: a
 * listener registered inside a scope and called from outside it reads
 * the module-level record, and the same listener wrapped with
 * `AsyncResource.bind` where it is registered reads the scope's.
 */
import type { RafaCommand } from './command.js';

import { AsyncResource } from 'node:async_hooks';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, test } from 'bun:test';

import { restoreRunningCommand, runAsRunningCommand, runningCommand, setRunningCommand } from './running.js';

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

/** A promise and the function that settles it, so a case orders its own overlaps. */
function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe('the running command in an async scope', () => {
  test('answers the scope\'s record with its flags inside the run, after an await too, and none once it ends', async () => {
    const plan = command('plan', 'create');
    const during: (RafaCommand | undefined)[] = [];

    const answer = await runAsRunningCommand(plan, { resolve: true }, async () => {
      during.push(runningCommand()?.command);
      await Promise.resolve();
      during.push(runningCommand()?.command);
      return runningCommand()?.flags;
    });

    expect(during).toEqual([plan, plan]);
    expect(answer).toEqual({ resolve: true });
    expect(runningCommand()).toBeNull();
  });

  test('gives two overlapping runs their own records when the first started ends last, and leaves none', async () => {
    const first = command('effort', 'schema');
    const second = command('loop', 'start');
    const firstMayEnd = gate();
    const secondEnded = gate();
    const read: string[] = [];

    await Promise.all([
      runAsRunningCommand(first, {}, async () => {
        await firstMayEnd.opened;
        read.push(`first reads ${String(runningCommand()?.command.subject)}`);
      }),
      runAsRunningCommand(second, {}, async () => {
        await Promise.resolve();
        read.push(`second reads ${String(runningCommand()?.command.subject)}`);
        secondEnded.open();
      }),
      secondEnded.opened.then(() => {
        read.push(`between reads ${String(runningCommand()?.command.subject)}`);
        firstMayEnd.open();
      }),
    ]);

    expect(read).toEqual(['second reads loop', 'between reads undefined', 'first reads effort']);
    expect(runningCommand()).toBeNull();
  });

  test('gives two overlapping runs their own records when the first started ends first, and leaves none', async () => {
    const first = command('effort', 'schema');
    const second = command('loop', 'start');
    const firstEnded = gate();
    const read: string[] = [];

    await Promise.all([
      runAsRunningCommand(first, {}, async () => {
        await Promise.resolve();
        read.push(`first reads ${String(runningCommand()?.command.subject)}`);
      }).then(firstEnded.open),
      runAsRunningCommand(second, {}, async () => {
        await firstEnded.opened;
        read.push(`second reads ${String(runningCommand()?.command.subject)}`);
      }),
    ]);

    expect(read).toEqual(['first reads effort', 'second reads loop']);
    expect(runningCommand()).toBeNull();
  });

  test('answers the inner record inside a nested run and the outer one after it', async () => {
    const outer = command('next', null);
    const inner = command('loop', 'start');
    const read: (RafaCommand | undefined)[] = [];

    await runAsRunningCommand(outer, {}, async () => {
      read.push(runningCommand()?.command);
      await runAsRunningCommand(inner, { plan: 'y.md' }, async () => {
        await Promise.resolve();
        read.push(runningCommand()?.command);
      });
      read.push(runningCommand()?.command);
    });

    expect(read).toEqual([outer, inner, outer]);
    expect(runningCommand()).toBeNull();
  });

  test('leaves none behind a run that throws, and one that rejects', async () => {
    const plan = command('plan', 'create');

    expect(() => runAsRunningCommand(plan, {}, () => {
      throw new Error('boom');
    })).toThrow('boom');
    expect(runningCommand()).toBeNull();

    const rejected = runAsRunningCommand(plan, {}, async () => {
      await Promise.resolve();
      throw new Error('later');
    });
    await expect(rejected).rejects.toThrow('later');
    expect(runningCommand()).toBeNull();
  });

  test('leaves a record set at module level in place: hidden inside the scope, answered again after it', async () => {
    const outside = command('outer', 'probe');
    const scoped = command('plan', 'create');
    setRunningCommand(outside, {});

    const inside = await runAsRunningCommand(scoped, {}, async () => runningCommand()?.command);

    expect(inside).toBe(scoped);
    expect(runningCommand()?.command).toBe(outside);
  });

  test('keeps a frozen copy of the flags, unmoved by a later change to the caller\'s object', async () => {
    const flags: Record<string, string | boolean> = { resolve: true };

    const recorded = await runAsRunningCommand(command('pr', 'triage'), flags, async () => {
      flags.resolve = false;
      return runningCommand()?.flags;
    });

    expect(recorded).toEqual({ resolve: true });
    expect(Object.isFrozen(recorded)).toBe(true);
  });

  test('a listener registered inside a scope and called from outside it reads the module-level record, and one wrapped with AsyncResource.bind the scope\'s', async () => {
    const scoped = command('loop', 'start');
    const outside = command('outer', 'probe');
    const emitter = new EventEmitter();
    const read: Record<string, string | undefined> = {};

    await runAsRunningCommand(scoped, {}, async () => {
      emitter.on('interrupt', () => {
        read['plain'] = runningCommand()?.command.subject;
      });
      emitter.on('interrupt', AsyncResource.bind(() => {
        read['bound'] = runningCommand()?.command.subject;
      }));
      await Promise.resolve();
    });
    setRunningCommand(outside, {});
    emitter.emit('interrupt');

    expect(read).toEqual({ plain: 'outer', bound: 'loop' });
  });

  test('a set made inside a scope writes the module-level record: the scope still answers its own, and the set one is read after', async () => {
    const scoped = command('plan', 'create');
    const set = command('loop', 'start');

    const read = await runAsRunningCommand(scoped, {}, async () => {
      const replaced = setRunningCommand(set, {});
      return { replaced, inside: runningCommand()?.command };
    });

    expect(read).toEqual({ replaced: null, inside: scoped });
    expect(runningCommand()?.command).toBe(set);
  });
});
