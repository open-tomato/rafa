/**
 * Tests for the console logger's own shapes: the text line and its hint
 * line, the json event and its `fields`, the `api` entry in both modes,
 * colour on the level prefix alone, and a child's bindings. The rules
 * every logger shares are in the contract suite (`contract.ts`).
 */
import type { LogEntry } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { consoleHarness } from '../../tests/logger-harness.js';

import { DEFAULT_LOGGER_SETTINGS } from './settings.js';

/** The settings every case here reads, unless it says otherwise. */
const settings = (): typeof DEFAULT_LOGGER_SETTINGS => DEFAULT_LOGGER_SETTINGS;

/** A warning carrying every optional text field. */
const UNAVAILABLE: LogEntry = {
  level: 'warn',
  message: 'github unavailable',
  module: 'tracker',
  action: 'chain',
  code: 'tracker:unreachable',
  hint: 'check gh auth status',
};

/** An `api` entry whose exchange holds a secret in each place the filter reads. */
const EXCHANGE: LogEntry = {
  level: 'api',
  message: 'push',
  module: 'hub',
  api: {
    service: 'hub',
    method: 'POST',
    url: 'https://user:pass@hub.example/v1/sync?token=s3cret-value',
    status: 201,
    durationMs: 42,
    headers: { 'Authorization': 'Bearer tok', 'Content-Type': 'application/json' },
  },
};

describe('the console logger in text mode', () => {
  it('writes the level, the label, the message and the code, then the hint on its own line', () => {
    const harness = consoleHarness(settings, 0);

    harness.logger.log(UNAVAILABLE);

    expect(harness.kept.lines()).toEqual([
      'warn: tracker chain: github unavailable [tracker:unreachable]',
      '  hint: check gh auth status',
    ]);
    expect(harness.kept.events()).toEqual([]);
  });

  it('writes a bare entry as its level and its message', () => {
    const harness = consoleHarness(settings, 0);

    harness.logger.log({ level: 'error', message: 'the store is locked' });

    expect(harness.kept.lines()).toEqual(['error: the store is locked']);
  });

  it('colours the level prefix alone', () => {
    const harness = consoleHarness(settings, 0, 'text', true);

    harness.logger.log({ level: 'warn', message: 'careful', module: 'board' });

    expect(harness.kept.lines()).toEqual(['\u001b[33mwarn:\u001b[0m board: careful']);
  });

  it('writes an api entry as its filtered exchange, with the message after it', () => {
    const harness = consoleHarness(() => ({ ...DEFAULT_LOGGER_SETTINGS, api: true }), 0);

    harness.logger.log(EXCHANGE);

    expect(harness.kept.lines()).toEqual([
      'api: hub: hub POST https://hub.example/v1/sync?token=[redacted] → 201 in 42 ms — push',
    ]);
  });

  it('filters a URL in an api entry\'s message', () => {
    const harness = consoleHarness(() => ({ ...DEFAULT_LOGGER_SETTINGS, api: true }), 0);

    harness.logger.log({ ...EXCHANGE, message: 'retried https://hub.example/v1/sync?token=s3cret-value' });

    expect(harness.kept.lines().join('\n')).not.toContain('s3cret-value');
    expect(harness.kept.lines().join('\n')).toContain('retried https://hub.example/v1/sync?token=[redacted]');
  });

  it('names the caller of a helper that tail-calls log, never a native frame', () => {
    const harness = consoleHarness(() => ({ ...DEFAULT_LOGGER_SETTINGS, callSite: true }), 2);

    ['one'].forEach((message) => harness.logger.log({ level: 'debug', message }));

    expect(harness.kept.lines()[0]).not.toContain('(native');
    expect(harness.kept.lines()[0]).toContain('console.test.ts:');
  });

  it('keeps a message holding a newline as it was written', () => {
    const harness = consoleHarness(settings, 0);

    harness.logger.log({ level: 'warn', message: 'first\nsecond' });

    expect(harness.kept.lines()).toEqual(['warn: first\nsecond']);
  });
});

describe('the console logger in json mode', () => {
  it('emits today\'s log event, with what else it knew under fields', () => {
    const harness = consoleHarness(settings, 0, 'json');

    harness.logger.log(UNAVAILABLE);

    expect(harness.kept.lines()).toEqual([]);
    expect(harness.kept.events()).toEqual([{
      type: 'log',
      level: 'warn',
      message: 'tracker chain: github unavailable',
      fields: { module: 'tracker', action: 'chain', code: 'tracker:unreachable', hint: 'check gh auth status' },
      ts: expect.any(String) as string,
    }]);
  });

  it('emits no fields member for an entry that carried nothing else', () => {
    const harness = consoleHarness(settings, 0, 'json');

    harness.logger.log({ level: 'warn', message: 'careful' });

    expect(harness.kept.events().map((event) => Object.keys(event))).toEqual([['type', 'level', 'message', 'ts']]);
  });

  it('emits one event for a message holding a newline', () => {
    const harness = consoleHarness(settings, 0, 'json');

    harness.logger.log({ level: 'warn', message: 'first\nsecond' });

    expect(harness.kept.events()).toHaveLength(1);
  });

  it('emits an api entry at debug, typed api, with the filtered exchange', () => {
    const harness = consoleHarness(() => ({ ...DEFAULT_LOGGER_SETTINGS, api: true }), 0, 'json');

    harness.logger.log(EXCHANGE);
    const [event] = harness.kept.events();

    expect(event).toMatchObject({
      type: 'log',
      level: 'debug',
      fields: {
        type: 'api',
        module: 'hub',
        api: { url: 'https://hub.example/v1/sync?token=[redacted]', headers: { 'content-type': 'application/json' } },
      },
    });
    expect(JSON.stringify(event)).not.toContain('s3cret-value');
    expect(JSON.stringify(event)).not.toContain('Bearer tok');
    expect(JSON.stringify(event)).not.toContain('user:pass');
  });

  it('emits an entry whose data JSON cannot write, without the data and saying so', () => {
    const harness = consoleHarness(settings, 0, 'json');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    harness.logger.log({ level: 'warn', message: 'big', data: { n: 10n } });
    harness.logger.log({ level: 'warn', message: 'round', data: cyclic });

    expect(harness.kept.events()).toMatchObject([
      { message: 'big', fields: { dataUnwritable: true } },
      { message: 'round', fields: { dataUnwritable: true } },
    ]);
    expect(harness.kept.events().map((event) => event.type === 'log' && 'data' in (event.fields ?? {}))).toEqual([false, false]);
  });

  it('filters a URL in an api entry\'s error', () => {
    const harness = consoleHarness(() => ({ ...DEFAULT_LOGGER_SETTINGS, api: true }), 0, 'json');

    harness.logger.log({ ...EXCHANGE, error: new Error('fetch https://hub.example/v1/sync?token=s3cret-value failed') });

    expect(JSON.stringify(harness.kept.events())).not.toContain('s3cret-value');
    expect(harness.kept.events()[0]).toMatchObject({ fields: { error: 'fetch https://hub.example/v1/sync?token=[redacted] failed' } });
  });

  it('carries an error as its message under fields', () => {
    const harness = consoleHarness(settings, 0, 'json');

    harness.logger.log({ level: 'error', message: 'the push failed', error: new Error('socket closed') });

    expect(harness.kept.events()[0]).toMatchObject({ fields: { error: 'socket closed' } });
  });
});

describe('a child of the console logger', () => {
  it('keeps its bindings when an entry names a member as undefined', () => {
    const harness = consoleHarness(() => ({ ...DEFAULT_LOGGER_SETTINGS, modules: new Map([['board', 'debug']]) }), 0);
    const child = harness.logger.child({ module: 'board' });

    child.log({ level: 'debug', message: 'kept', module: undefined });

    expect(harness.kept.lines()).toEqual(['debug: board: kept']);
  });

  it('adds its bindings to every entry, a later child\'s over an earlier one\'s', () => {
    const harness = consoleHarness(settings, 0);
    const child = harness.logger.child({ module: 'tracker', action: 'chain' }).child({ action: 'preflight' });

    child.log({ level: 'warn', message: 'slow' });

    expect(harness.kept.lines()).toEqual(['warn: tracker preflight: slow']);
  });
});
