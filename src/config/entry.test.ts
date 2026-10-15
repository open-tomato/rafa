/**
 * Holds `entry.ts`'s values: `defineConfig` answering the very list it is
 * given, and `entryOf` nesting dotted keys into frozen mappings and
 * refusing a key it cannot place. `ConfigEntry`'s type, its `false` and
 * `$replace` forms among it, is held in `shape.test.ts`, whose one
 * TypeScript program serves both modules.
 */
import { describe, expect, test } from 'bun:test';

import { defineConfig, entryOf } from './entry.js';

describe('defineConfig', () => {
  test('answers the very list it is given', () => {
    const entries = [{ store: 'ndjson' as const }, { plan: { inject: 'task' as const } }];

    expect(defineConfig(entries)).toBe(entries);
  });
});

describe('entryOf', () => {
  test('nests dotted keys, in the order first named', () => {
    const entry = entryOf([
      ['plan.inject', 'task'],
      ['store', 'ndjson'],
      ['plan.dir', 'plans'],
      ['board.project.number', 6],
    ]);

    expect(entry).toEqual({
      plan: { inject: 'task', dir: 'plans' },
      store: 'ndjson',
      board: { project: { number: 6 } },
    });
    expect(Object.keys(entry)).toEqual(['plan', 'store', 'board']);
    expect(Object.keys(entry.plan ?? {})).toEqual(['inject', 'dir']);
  });

  test('freezes every mapping it builds', () => {
    const entry = entryOf([['board.project.number', 6], ['store', 'sqlite']]);

    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.board)).toBe(true);
    expect(Object.isFrozen(entry.board?.project)).toBe(true);
  });

  test('takes each value as given, a list or a mapping kept whole', () => {
    const fallback = ['local'];
    const routing = { tests: 'tdd-guide' };

    const entry = entryOf([['tracker.fallback', fallback], ['routing', routing]]);

    expect(entry.tracker?.fallback).toBe(fallback);
    expect(entry.routing).toBe(routing);
  });

  test('answers an empty entry for no keys', () => {
    expect(entryOf([])).toEqual({});
  });

  test('refuses a key given twice', () => {
    expect(() => entryOf([['plan.dir', 'a'], ['plan.dir', 'b']])).toThrow(
      'rafa config: plan.dir is given twice, or as a value and a mapping',
    );
  });

  test('refuses a key that is both a value and a mapping', () => {
    expect(() => entryOf([['board', 'x'], ['board.project.number', 6]])).toThrow(
      'rafa config: board is given twice, or as a value and a mapping',
    );
  });

  test.each(['', 'plan..dir', '.store', 'store.'])('refuses %p, which is no dotted key', (key) => {
    expect(() => entryOf([[key, 1]])).toThrow(`rafa config: ${JSON.stringify(key)} is no dotted key`);
  });
});
