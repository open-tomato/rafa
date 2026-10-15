/**
 * The dispatcher's start: what a process that loads `src/index.ts` holds
 * in core's adapter registry, what a dispatch resolves once only the
 * composition root `src/adapter-registry.ts` is imported, and the
 * refusal a resolve makes when nothing is registered.
 *
 * The first case reads the registry in a fresh `bun` process, since
 * every test file shares one process here and another file's import of
 * the root would hide a missing one. The kinds are spelled in
 * registration order.
 */
import type { RafaCommand } from '../core/command/index.js';
import type { PortType } from '../ports/index.js';

import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'bun:test';

import '../adapter-registry.js';
import {
  activeAdapterRegistry,
  CORE_ADAPTER_REGISTRY,
  createAdapterRegistry,
  restoreAdapters,
} from '../core/adapters/index.js';

import { dispatchCaptured } from './cli-capture.js';

const ENTRY = fileURLToPath(new URL('../index.ts', import.meta.url));

/** Core's kinds per port, in registration order. */
const CORE_KINDS: Readonly<Record<PortType, readonly string[]>> = {
  store: ['sqlite', 'ndjson'],
  output: ['text', 'json', 'events'],
  logger: ['console'],
  tracker: ['local', 'github'],
  learning: ['local'],
  planner: ['claude'],
  sync: ['local', 'file'],
};

const CHILD = `
const { CORE_ADAPTER_REGISTRY } = await import(process.argv[1]);
const ports = ['store', 'output', 'logger', 'tracker', 'learning', 'planner', 'sync'];
console.log(JSON.stringify(Object.fromEntries(ports.map((port) => [port, CORE_ADAPTER_REGISTRY.kinds(port)]))));
`;

const originalRegistry = activeAdapterRegistry();

afterEach(() => {
  restoreAdapters(originalRegistry);
});

describe('the dispatcher\'s start', () => {
  it('holds the kinds of all seven ports in a fresh process that loads src/index.ts', async () => {
    const child = Bun.spawn(['bun', '-e', CHILD, ENTRY], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(CORE_KINDS);
  });

  it('dispatches a command with only the root imported, resolving logger/console', async () => {
    const seen: string[] = [];
    const command: RafaCommand = {
      name: 'probe start',
      description: 'Resolves the console logger.',
      subject: 'probe',
      action: 'start',
      summary: 'resolves the console logger',
      args: [],
      flags: [],
      examples: [{ cmd: 'rafa probe start', note: 'resolves the console logger' }],
      outputs: ['text'],
      run: async () => {
        seen.push(CORE_ADAPTER_REGISTRY.resolve('logger', 'console').kind);
      },
    };

    const run = await dispatchCaptured(['probe', 'start'], [{ name: 'probe', summary: 'a probe' }], [command]);

    expect(run.exitCode).toBe(0);
    expect(seen).toEqual(['console']);
  });

  it('refuses a resolve naming src/adapter-registry.ts when the registry is restored to an empty one', () => {
    restoreAdapters(createAdapterRegistry());

    expect(() => CORE_ADAPTER_REGISTRY.resolve('logger', 'console')).toThrow(
      /adapter registry: no adapter is registered: import src\/adapter-registry\.ts/,
    );
  });
});
