import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  besideEngineerPrompt,
  claudeLine,
  DEFAULT_RAFA_COMMAND,
  HOLD_SCRIPT,
  isOperatorRole,
  lineText,
  OPERATOR_ROLES,
  operatorAgent,
  operatorSessionName,
  roleCommand,
  tmuxLines,
  windowCommand,
} from './launch.js';

const COPY = '/work/my-project/.rafa/stretch/4/operators';

describe('claudeLine', () => {
  test('builds the plugin-dir, agent, -n name and prompt line', () => {
    const line = claudeLine({
      pluginDir: COPY,
      role: 'engineer',
      project: 'my-project',
      n: 4,
      prompt: 'Open stretch 4.',
      remoteControl: false,
    });

    expect(line).toEqual([
      'claude',
      '--plugin-dir',
      COPY,
      '--agent',
      'rafa-operators:rafa-stretch-engineer',
      '-n',
      'my-project stretch 4 engineer',
      'Open stretch 4.',
    ]);
  });

  test('puts --remote-control in the place of -n, never beside it', () => {
    const line = claudeLine({
      pluginDir: COPY,
      role: 'watchtower',
      project: 'my-project',
      n: 4,
      prompt: '/loop',
      remoteControl: true,
    });

    expect(line).toEqual([
      'claude',
      '--plugin-dir',
      COPY,
      '--agent',
      'rafa-operators:rafa-stretch-watchtower',
      '--remote-control',
      'my-project stretch 4 watchtower',
      '/loop',
    ]);
    expect(line).not.toContain('-n');
  });
});

describe('names and prompts', () => {
  test('names each role\'s agent under the operators plugin', () => {
    expect(OPERATOR_ROLES.map(operatorAgent)).toEqual([
      'rafa-operators:rafa-stretch-engineer',
      'rafa-operators:rafa-stretch-watchtower',
      'rafa-operators:rafa-stretch-analyst',
    ]);
  });

  test('names the session after the project, stretch and role', () => {
    expect(operatorSessionName('rafa', 12, 'analyst')).toBe('rafa stretch 12 analyst');
  });

  test('gives the watchtower /loop and the analyst its stretch folder', () => {
    expect(besideEngineerPrompt('watchtower', 3)).toBe('/loop');
    expect(besideEngineerPrompt('analyst', 3))
      .toBe('Stretch 3 is running. Read .rafa/stretch/3/, then wait for my first hunch.');
  });

  test('reads the three roles as roles and nothing else', () => {
    expect(OPERATOR_ROLES.every(isOperatorRole)).toBe(true);
    expect(isOperatorRole('sweep')).toBe(false);
    expect(isOperatorRole('')).toBe(false);
  });
});

describe('roleCommand', () => {
  test('runs rafa stretch start with the role and stretch', () => {
    expect(roleCommand({ role: 'analyst', n: 7, remoteControl: false }))
      .toEqual([...DEFAULT_RAFA_COMMAND, 'stretch', 'start', '--role=analyst', '--n=7']);
  });

  test('passes --remote-control and another rafa program on', () => {
    expect(roleCommand({ role: 'engineer', n: 2, remoteControl: true, rafa: ['bun', '/opt/rafa/src/rafa.ts'] }))
      .toEqual(['bun', '/opt/rafa/src/rafa.ts', 'stretch', 'start', '--role=engineer', '--n=2', '--remote-control']);
  });
});

describe('tmuxLines', () => {
  const lines = tmuxLines({ root: '/work/my project', project: 'my-project', n: 5, remoteControl: false });

  test('opens the engineer, watchtower and analyst windows, then selects the engineer', () => {
    expect(lines.map((line) => line.slice(0, 2))).toEqual([
      ['tmux', 'new-session'],
      ['tmux', 'new-window'],
      ['tmux', 'new-window'],
      ['tmux', 'select-window'],
    ]);
    expect(lines[0]!.slice(0, 9))
      .toEqual(['tmux', 'new-session', '-d', '-s', 'stretch-my-project-5', '-c', '/work/my project', '-n', 'engineer']);
    expect(lines[1]!.slice(0, 8))
      .toEqual(['tmux', 'new-window', '-t', '=stretch-my-project-5:', '-c', '/work/my project', '-n', 'watchtower']);
    expect(lines[2]!.slice(0, 8))
      .toEqual(['tmux', 'new-window', '-t', '=stretch-my-project-5:', '-c', '/work/my project', '-n', 'analyst']);
    expect(lines[3]).toEqual(['tmux', 'select-window', '-t', '=stretch-my-project-5:engineer']);
  });

  test('runs each window\'s role and holds it', () => {
    const commands = lines.slice(0, 3).map((line) => line[line.length - 1]);

    expect(commands).toEqual(OPERATOR_ROLES.map((role) => windowCommand({ role, n: 5, remoteControl: false })));
    expect(commands[1]).toBe(`sh -c 'rafa stretch start --role=watchtower --n=5; ${HOLD_SCRIPT}'`);
  });

  test('passes --remote-control into every window', () => {
    const remote = tmuxLines({ root: '/w', project: 'p', n: 1, remoteControl: true });

    for (const line of remote.slice(0, 3)) {
      expect(line[line.length - 1]).toContain('--remote-control');
    }
  });
});

describe('lineText', () => {
  test('quotes the words a shell would split and leaves plain ones', () => {
    expect(lineText(['claude', '-n', 'rafa stretch 1 engineer', 'it\'s'])).toBe(
      'claude -n \'rafa stretch 1 engineer\' \'it\'\\\'\'s\'',
    );
  });

  test('leaves a plain --flag=value bare and quotes an assignment or a spaced value', () => {
    expect(lineText(['--n=3', '-r=x', 'FOO=bar', '--body=a b'])).toBe(
      '--n=3 -r=x \'FOO=bar\' \'--body=a b\'',
    );
  });
});

describe('windowCommand under a real shell', () => {
  let scratch: string;
  let rafa: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'rafa-stretch-launch-'));
    rafa = join(scratch, 'stand in rafa');
    writeFileSync(rafa, '#!/bin/sh\necho "ran: $*"\nexit 3\n');
    chmodSync(rafa, 0o755);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function runWindow(stdin: string): { exitCode: number; stdout: string } {
    const command = windowCommand({ role: 'watchtower', n: 9, remoteControl: true, rafa: [rafa] });
    const result = Bun.spawnSync(['sh', '-c', command], { stdin: Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe' });
    return { exitCode: result.exitCode, stdout: result.stdout.toString() };
  }

  test('runs the role, prints its exit code and closes once Enter is read', () => {
    const { exitCode, stdout } = runWindow('\n');

    expect(stdout).toBe('ran: stretch start --role=watchtower --n=9 --remote-control\n'
      + 'exited: 3, press Enter to close\n');
    expect(exitCode).toBe(0);
  });

  test('control: with no Enter to read, the hold fails rather than passing unseen', () => {
    const { exitCode, stdout } = runWindow('');

    expect(stdout).toContain('exited: 3, press Enter to close');
    expect(exitCode).not.toBe(0);
  });
});
