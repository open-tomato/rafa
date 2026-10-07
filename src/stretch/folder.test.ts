import type { StretchFolderSeams, StretchFs } from './folder.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  agentFilePath,
  highestStretch,
  liveStretches,
  newestWatched,
  nextStretch,
  nodeStretchFs,
  projectName,
  readAgentFile,
  spawnProbe,
  stretchFolder,
  stretchLiveness,
  stretchNumbers,
  tmuxProbe,
  tmuxSessionName,
  tmuxTarget,
} from './folder.js';

let scratch: string;
let root: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'rafa-stretch-folder-'));
  root = join(scratch, 'my.project');
  mkdirSync(root);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function makeFolder(n: number | string): void {
  mkdirSync(join(root, '.rafa', 'stretch', String(n)), { recursive: true });
}

function writeAgent(n: number, body: unknown): void {
  makeFolder(n);
  writeFileSync(join(root, '.rafa', 'stretch', String(n), 'agent.json'), typeof body === 'string'
    ? body
    : JSON.stringify(body));
}

function seams(overrides: Partial<StretchFolderSeams> = {}): StretchFolderSeams {
  return {
    fs: nodeStretchFs,
    isAlive: () => false,
    hasTmuxSession: () => false,
    ...overrides,
  };
}

describe('stretch numbers', () => {
  test('a project with no stretch folder has none, highest 0 and next 1', () => {
    expect(stretchNumbers(root)).toEqual([]);
    expect(highestStretch(root)).toBe(0);
    expect(nextStretch(root)).toBe(1);
    expect(newestWatched(root)).toBe(0);
  });

  test('only all-digit folders count, sorted by number rather than by name', () => {
    makeFolder(2);
    makeFolder(10);
    makeFolder(3);
    makeFolder('0');
    makeFolder('4-old');
    writeFileSync(join(root, '.rafa', 'stretch', '3-archive.tar.gz'), '');
    writeFileSync(join(root, '.rafa', 'stretch', '7'), 'a file named like a stretch');
    writeFileSync(join(root, '.rafa', 'stretch', 'engineer-prompt.md'), '');

    expect(stretchNumbers(root)).toEqual([2, 3, 10]);
    expect(highestStretch(root)).toBe(10);
  });

  test('the next stretch is the highest while it has no agent.json', () => {
    writeAgent(1, { sessionId: 'a' });
    makeFolder(2);

    expect(nextStretch(root)).toBe(2);
  });

  test('the next stretch is one more than the highest once it has an agent.json', () => {
    writeAgent(1, { sessionId: 'a' });
    writeAgent(2, { sessionId: 'b' });

    expect(nextStretch(root)).toBe(3);
  });

  test('the newest watched stretch skips a newer folder with no agent.json', () => {
    writeAgent(1, { sessionId: 'a' });
    writeAgent(2, { sessionId: 'b' });
    makeFolder(3);

    expect(newestWatched(root)).toBe(2);
  });

  test('the newest watched stretch is 0 when no folder holds an agent.json', () => {
    makeFolder(1);
    makeFolder(2);

    expect(newestWatched(root)).toBe(0);
  });

  test('the readings go through the filesystem seam', () => {
    const listed: string[] = [];
    const fs: StretchFs = {
      list: (dir) => {
        listed.push(dir);
        return [{ name: '5', isDirectory: true }];
      },
      readText: (file) => file.endsWith(join('5', 'agent.json'))
        ? '{}'
        : null,
    };

    expect(nextStretch('/nowhere', fs)).toBe(6);
    expect(listed).toEqual([join('/nowhere', '.rafa', 'stretch')]);
  });
});

describe('paths', () => {
  test('the folder and agent.json sit under .rafa/stretch/<n>', () => {
    expect(stretchFolder('/p', 4)).toBe(join('/p', '.rafa', 'stretch', '4'));
    expect(agentFilePath('/p', 4)).toBe(join('/p', '.rafa', 'stretch', '4', 'agent.json'));
  });

  test.each([0, -1, 1.5, Number.NaN])('a stretch number of %p is refused', (n) => {
    expect(() => stretchFolder('/p', n)).toThrow('is not a stretch number');
    expect(() => tmuxSessionName('p', n)).toThrow('is not a stretch number');
  });
});

describe('readAgentFile', () => {
  test('a folder with no agent.json reads absent', () => {
    makeFolder(1);

    expect(readAgentFile(root, 1)).toEqual({ kind: 'absent', file: agentFilePath(root, 1) });
  });

  test('stretch 4 as it was written: the four fields read, the others pass unread', () => {
    writeAgent(4, {
      sessionId: 'b72e62ca-7a67-430f-8e49-2e44a6f832ab',
      pid: 1296258,
      role: 'rafa-stretch-engineer',
      stretch: 4,
      integrationBranch: 'stretch/4',
      startedAt: '2026-10-05',
      tmuxSession: 'stretch-rafa-4',
      state: 'running',
    });

    expect(readAgentFile(root, 4)).toEqual({
      kind: 'read',
      file: agentFilePath(root, 4),
      agent: {
        sessionId: 'b72e62ca-7a67-430f-8e49-2e44a6f832ab',
        pid: 1296258,
        state: 'running',
        tmuxSession: 'stretch-rafa-4',
      },
    });
  });

  test('stretch 1 as it was written, with no state or tmux session, reads those as null', () => {
    writeAgent(1, { sessionId: 'f0580289', pid: 2694307, role: 'rafa-stretch-engineer' });

    const reading = readAgentFile(root, 1);

    expect(reading.kind).toBe('read');
    expect(reading.kind === 'read' && reading.agent).toEqual({
      sessionId: 'f0580289',
      pid: 2694307,
      state: null,
      tmuxSession: null,
    });
  });

  test.each([
    ['text that is no JSON', '{ not json', 'is not JSON'],
    ['an array', '[1, 2]', 'is not a JSON object'],
    ['null', 'null', 'is not a JSON object'],
    ['a number session id', '{"sessionId": 7}', 'sessionId is not a string'],
    ['a boolean state', '{"state": true}', 'state is not a string'],
    ['an object tmux session', '{"tmuxSession": {}}', 'tmuxSession is not a string'],
    ['a string pid', '{"pid": "12"}', 'pid is not a positive whole number'],
    ['a zero pid', '{"pid": 0}', 'pid is not a positive whole number'],
    ['a fractional pid', '{"pid": 1.5}', 'pid is not a positive whole number'],
  ])('%s reads malformed with its reason', (_label, text, reason) => {
    writeAgent(2, text);

    const reading = readAgentFile(root, 2);

    expect(reading.kind).toBe('malformed');
    expect(reading.kind === 'malformed' && reading.reason).toContain(reason);
  });
});

describe('project and tmux names', () => {
  test.each([
    ['/home/me/rafa', 'rafa'],
    ['/home/me/my.project', 'my-project'],
    ['/home/me/a b_c-d', 'a-b_c-d'],
    ['/home/me/trailing..', 'trailing'],
    ['/home/me/café', 'caf'],
    ['/home/me/rafa/', 'rafa'],
  ])('%s is kept by tmux as %s', (path, name) => {
    expect(projectName(path)).toBe(name);
  });

  test('a root that leaves no name is refused', () => {
    expect(() => projectName('/')).toThrow('leaves no project name');
    expect(() => projectName('/home/me/...')).toThrow('leaves no project name');
  });

  test('the session is stretch-<project>-<n>, and its target the exact match', () => {
    expect(tmuxSessionName('rafa', 2)).toBe('stretch-rafa-2');
    expect(tmuxTarget('stretch-rafa-2')).toBe('=stretch-rafa-2');
  });
});

describe('liveness', () => {
  test('a running agent whose pid is alive is live; the tmux probe is asked the project session', () => {
    writeAgent(3, { sessionId: 's', pid: 42, state: 'running' });
    const asked: string[] = [];

    const reading = stretchLiveness(root, 3, seams({
      isAlive: (pid) => pid === 42,
      hasTmuxSession: (name) => {
        asked.push(name);
        return false;
      },
    }));

    expect(reading).toMatchObject({ n: 3, pidAlive: true, tmuxOpen: false, live: true });
    expect(asked).toEqual(['stretch-my-project-3']);
  });

  test('a running agent whose pid is dead is not live (the control for the case above)', () => {
    writeAgent(3, { sessionId: 's', pid: 42, state: 'running' });

    expect(stretchLiveness(root, 3, seams({ isAlive: (pid) => pid !== 42 })))
      .toMatchObject({ pidAlive: false, tmuxOpen: false, live: false });
  });

  test.each([
    ['archived', { pid: 42, state: 'archived' }],
    ['no state, as stretch 1 wrote', { pid: 42 }],
    ['running with no pid', { state: 'running' }],
  ])('an agent %s is not live by its pid even when that pid is alive', (_label, body) => {
    writeAgent(3, body);
    let probed = 0;

    const reading = stretchLiveness(root, 3, seams({
      isAlive: () => {
        probed += 1;
        return true;
      },
    }));

    expect(reading.live).toBe(false);
    expect(probed).toBe(0);
  });

  test('an open tmux session makes a stretch live with no agent.json, or a malformed one', () => {
    makeFolder(1);
    writeAgent(2, '{ broken');
    const open = seams({ hasTmuxSession: (name) => name.startsWith('stretch-my-project-') });

    expect(stretchLiveness(root, 1, open)).toMatchObject({ agent: { kind: 'absent' }, tmuxOpen: true, live: true });
    expect(stretchLiveness(root, 2, open)).toMatchObject({ agent: { kind: 'malformed' }, tmuxOpen: true, live: true });
  });

  test('liveStretches lists only the live ones, smallest first', () => {
    writeAgent(1, { pid: 11, state: 'running' });
    writeAgent(2, { pid: 22, state: 'archived' });
    writeAgent(3, { pid: 33, state: 'running' });
    makeFolder(4);

    const live = liveStretches(root, seams({
      isAlive: (pid) => pid === 33 || pid === 22,
      hasTmuxSession: (name) => name === 'stretch-my-project-4',
    }));

    expect(live.map((reading) => reading.n)).toEqual([3, 4]);
  });

  test('a project with no stretch has no live stretch', () => {
    expect(liveStretches(root, seams({ hasTmuxSession: () => true }))).toEqual([]);
  });
});

describe('tmux probe', () => {
  test('asks tmux has-session for the exact-match target, open on exit 0', () => {
    const calls: (readonly string[])[] = [];
    const probe = tmuxProbe((argv) => {
      calls.push(argv);
      return { exitCode: 0 };
    });

    expect(probe('stretch-rafa-2')).toBe(true);
    expect(calls).toEqual([['tmux', 'has-session', '-t', '=stretch-rafa-2']]);
  });

  test('a non-zero exit, or a tmux that cannot start, reads closed', () => {
    expect(tmuxProbe(() => ({ exitCode: 1 }))('s')).toBe(false);
    expect(tmuxProbe(() => null)('s')).toBe(false);
  });

  test('spawnProbe returns the exit code, and null for a program that is not there', () => {
    expect(spawnProbe([process.execPath, '-e', 'process.exit(0)'])).toEqual({ exitCode: 0 });
    expect(spawnProbe([process.execPath, '-e', 'process.exit(3)'])).toEqual({ exitCode: 3 });
    expect(spawnProbe([join(scratch, 'no-such-program')])).toBeNull();
  });
});
