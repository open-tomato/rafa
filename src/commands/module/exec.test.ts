/**
 * Tests for `rafa module exec` (`exec.ts`).
 *
 * Each case dispatches over the core registry from a directory of this
 * file's own holding no project, beside a home of its own, since the
 * command needs none. A mounted module is handed to the dispatcher as a
 * command entry answered by the importer seam, so what is held is the
 * command and the route through it and not the import, which
 * `src/cli/modules.test.ts` holds. The control for the bare refusal is
 * the same line with a module and an action after it, which runs.
 */
import type { OutputStream } from '../../adapters/output/stream.js';
import type { RafaCommand } from '../../cli/command.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { dispatch } from '../../cli/dispatch.js';
import { renderHelp } from '../../cli/help.js';
import { CORE_REGISTRY } from '../index.js';

import execCommand from './exec.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-module-exec-')));
const HOME = join(tempBase, 'home');
mkdirSync(HOME);

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The action the mounted module provides. */
const HELLO: RafaCommand = {
  name: 'demo hello',
  subject: 'demo',
  action: 'hello',
  summary: 'say hello',
  description: 'Says hello, and who to.',
  args: [{ name: 'who', description: 'Who to greet.', type: 'string' }],
  flags: [],
  examples: [{ cmd: 'rafa module exec demo hello world', note: 'says hello to world' }],
  outputs: ['text'],
  needsProject: false,
  run: async (context) => {
    context.output.info(`hello ${context.args[0] ?? 'nobody'}`);
  },
};

/** The entry the importer answers. */
const ENTRY = '/modules/demo/commands.ts';

/** A stream of its own, and the text written to it. */
function memoryStream(): { stream: OutputStream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    },
    text: () => chunks.join(''),
  };
}

/** Dispatches `rafa <words>` over the core registry outside any project, the demo module mounted when `mounted`. */
async function run(words: readonly string[], mounted: boolean) {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const { exitCode } = await dispatch(words, {
    registry: CORE_REGISTRY,
    renderHelp,
    modules: mounted
      ? [{ name: 'demo', entry: ENTRY }]
      : [],
    importModule: async () => ({ default: [HELLO] }),
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-09-15T12:00:00.000Z'),
    cwd: tempBase,
    home: HOME,
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

describe('the module exec declaration', () => {
  it('is the exec action of the core module subject, running outside a project', () => {
    expect(CORE_REGISTRY.find('module', 'exec')).toBe(execCommand);
    expect([execCommand.exec, execCommand.needsProject]).toEqual([true, false]);
  });
});

describe('rafa module exec', () => {
  it('refuses with exit code 1 when no module word follows, saying none is mounted and how one is', async () => {
    const result = await run(['module', 'exec'], false);

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '❌ Expected a module and one of its actions; mounted: none is mounted; a module is mounted when allowList: names it and modules: gives its path source\n'
        + 'Usage: rafa module exec <module> <action> [args] [flags]\n',
    });
  });

  it('names each mounted module with its actions when no module word follows', async () => {
    const result = await run(['module', 'exec'], true);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith('❌ Expected a module and one of its actions; mounted: demo (hello)\n');
  });

  it('runs the mounted action a module word and an action word name, handing it the words after them', async () => {
    const result = await run(['module', 'exec', 'demo', 'hello', 'world'], true);

    expect(result).toEqual({ exitCode: 0, stdout: 'hello world\n', stderr: '' });
  });

  it('renders the mounted action help with the core renderer', async () => {
    const result = await run(['module', 'exec', 'demo', 'hello', '--help'], true);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith('rafa module exec demo hello — say hello\n');
    expect(result.stdout).toContain('rafa module exec demo hello world');
  });

  it('leaves a module word naming no mount to the router, which refuses it', async () => {
    const result = await run(['module', 'exec', 'nope', 'hello'], true);

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'rafa: no module "nope" is mounted; mounted: demo\n' });
  });
});
