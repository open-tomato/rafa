/**
 * Integration over `src/stretch/`: a scratch project goes through three
 * stretches of folders, on the real filesystem and the real pid probe.
 * Only tmux and the package entry are stood in for.
 */
import type { StretchFolderSeams } from './folder.js';
import type { OperatorsSeams } from './operators.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { isPidAlive } from '../loop/sessions.js';

import {
  agentFilePath,
  liveStretches,
  newestWatched,
  nextStretch,
  nodeStretchFs,
  stretchFolder,
  stretchLiveness,
} from './folder.js';
import { copyOperators, nodeOperatorsFs, operatorsCopyPath } from './operators.js';

let scratch: string;
let root: string;
let operatorSeams: OperatorsSeams;
let folderSeams: StretchFolderSeams;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-integration-')));
  root = join(scratch, 'project');
  mkdirSync(root);
  const entry = join(scratch, 'pkg', 'dist', 'cli.js');
  mkdirSync(join(scratch, 'pkg', 'dist', 'bundled', 'operators', '.claude-plugin'), { recursive: true });
  mkdirSync(join(scratch, 'pkg', 'dist', 'bundled', 'operators', 'agents'), { recursive: true });
  writeFileSync(entry, '');
  writeFileSync(join(scratch, 'pkg', 'package.json'), JSON.stringify({ version: '2.0.0' }));
  writeFileSync(join(scratch, 'pkg', 'dist', 'bundled', 'operators', '.claude-plugin', 'plugin.json'), '{}');
  writeFileSync(join(scratch, 'pkg', 'dist', 'bundled', 'operators', 'agents', 'rafa-stretch-engineer.md'), 'engineer v1');
  operatorSeams = { fs: nodeOperatorsFs, entry, buildVersion: '0.0.0', home: () => join(scratch, 'home') };
  folderSeams = { fs: nodeStretchFs, isAlive: isPidAlive, hasTmuxSession: () => false };
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A pid that belonged to a process that has already exited. */
function deadPid(): number {
  const child = Bun.spawnSync(['true']);
  return child.pid;
}

function startStretch(n: number): void {
  mkdirSync(stretchFolder(root, n), { recursive: true });
  const result = copyOperators(root, n, operatorSeams);
  expect(result.kind).toBe('copied');
}

describe('three stretches of folders', () => {
  test('numbers, copies once and reads a dead pid as not live', () => {
    // Stretch 1: no folder yet.
    expect(nextStretch(root)).toBe(1);
    startStretch(1);

    // A folder with no agent.json is reused, not skipped.
    expect(nextStretch(root)).toBe(1);
    expect(newestWatched(root)).toBe(0);

    // The copy is made once: a changed package does not overwrite it.
    const copiedAgent = join(operatorsCopyPath(root, 1), 'agents', 'rafa-stretch-engineer.md');
    expect(readFileSync(copiedAgent, 'utf8')).toBe('engineer v1');
    writeFileSync(join(scratch, 'pkg', 'dist', 'bundled', 'operators', 'agents', 'rafa-stretch-engineer.md'), 'engineer v2');
    expect(copyOperators(root, 1, operatorSeams).kind).toBe('kept');
    expect(readFileSync(copiedAgent, 'utf8')).toBe('engineer v1');

    // The engineer ran: stretch 1 has an agent.json, so the next is 2.
    writeFileSync(agentFilePath(root, 1), JSON.stringify({ sessionId: 's1', pid: deadPid(), state: 'running' }));
    expect(nextStretch(root)).toBe(2);
    expect(newestWatched(root)).toBe(1);

    // Stretch 2 copies the package as it is now, and starts with no agent.json.
    startStretch(2);
    expect(readFileSync(join(operatorsCopyPath(root, 2), 'agents', 'rafa-stretch-engineer.md'), 'utf8')).toBe('engineer v2');
    expect(nextStretch(root)).toBe(2);

    // Stretch 2's agent.json names a live pid (this process), stretch 1's is stale.
    writeFileSync(agentFilePath(root, 2), JSON.stringify({ sessionId: 's2', pid: process.pid, state: 'running' }));
    expect(stretchLiveness(root, 1, folderSeams).pidAlive).toBe(false);
    expect(stretchLiveness(root, 1, folderSeams).live).toBe(false);
    expect(liveStretches(root, folderSeams).map((reading) => reading.n)).toEqual([2]);
    expect(nextStretch(root)).toBe(3);

    // Stretch 3: the stale record of 2 now reads as dead, and nothing is live.
    startStretch(3);
    writeFileSync(agentFilePath(root, 2), JSON.stringify({ sessionId: 's2', pid: deadPid(), state: 'running' }));
    expect(liveStretches(root, folderSeams)).toEqual([]);
    expect(nextStretch(root)).toBe(3);
    expect(newestWatched(root)).toBe(2);
    expect(existsSync(agentFilePath(root, 3))).toBe(false);
  });
});
