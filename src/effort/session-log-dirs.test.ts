/**
 * Tests for where the session logs are and which files there are
 * sessions.
 *
 * These cases moved here from `collect.test.ts` with the functions they
 * cover, unchanged. The mutations that note lists against the listing
 * and the encoding — dropping the `isFile` guard, matching every file
 * name instead of only `.jsonl`, ordering newest first, reading a
 * missing log directory as an empty list, and leaving a dot alone when
 * encoding the log directory — are the ones these cases redden.
 *
 * Every case reads a temporary directory, never the real session log
 * directory.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { listSessionLogs, projectLogDirName, sessionLogDir } from './session-log-dirs.js';

/** Temporary directories to remove once each case is done. */
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A temporary directory that this file's afterEach will remove. */
function makeScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ralph-log-dirs-'));
  scratch.push(dir);
  return dir;
}

/** Writes one session log and answers its path. */
function writeLog(
  dir: string,
  sessionId: string,
  lines: readonly string[],
): string {
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

describe('the project log directory', () => {
  it('replaces every slash and dot with a hyphen', () => {
    expect(projectLogDirName('/Users/dev/projects/agentic-research'))
      .toBe('-Users-dev-projects-agentic-research');
  });

  it('doubles the hyphen for a dot-directory segment', () => {
    expect(projectLogDirName('/Users/dev/repo/.claude/worktrees/x'))
      .toBe('-Users-dev-repo--claude-worktrees-x');
  });

  it('files the encoded name under the projects root', () => {
    expect(sessionLogDir('/Users/dev/repo', '/home'))
      .toBe(join('/home', '.claude', 'projects', '-Users-dev-repo'));
  });
});

describe('listSessionLogs', () => {
  it('takes the loose logs and nothing one level down', () => {
    const dir = makeScratch();
    writeLog(dir, 'aaa', ['{}']);
    writeLog(dir, 'bbb', ['{}']);
    mkdirSync(join(dir, 'aaa', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'aaa', 'subagents', 'agent-1.jsonl'), '{}\n');

    const ids = listSessionLogs(dir).map((entry) => entry.sessionId);

    expect(ids.sort()).toEqual(['aaa', 'bbb']);
  });

  it('skips a directory whose name ends in .jsonl', () => {
    const dir = makeScratch();
    writeLog(dir, 'real', ['{}']);
    mkdirSync(join(dir, 'decoy.jsonl'));

    expect(listSessionLogs(dir).map((e) => e.sessionId)).toEqual(['real']);
  });

  it('skips a file that is not a session log', () => {
    const dir = makeScratch();
    writeLog(dir, 'real', ['{}']);
    writeFileSync(join(dir, 'notes.md'), 'hello\n');
    writeFileSync(join(dir, '.DS_Store'), 'x\n');

    expect(listSessionLogs(dir).map((e) => e.sessionId)).toEqual(['real']);
  });

  it('carries each log size and modification time', () => {
    const dir = makeScratch();
    const body = '{"a":1}';
    writeLog(dir, 'one', [body]);

    const found = listSessionLogs(dir);

    expect(found).toHaveLength(1);
    expect(found[0]?.sizeBytes).toBe(body.length + 1);
    expect(found[0]?.modifiedAtMs).toBeGreaterThan(0);
    expect(found[0]?.path).toBe(join(dir, 'one.jsonl'));
  });

  it('orders oldest first', () => {
    const dir = makeScratch();
    const older = writeLog(dir, 'zzz', ['{}']);
    writeLog(dir, 'aaa', ['{}']);
    utimesSync(older, 1_600_000, 1_600_000);

    expect(listSessionLogs(dir).map((e) => e.sessionId))
      .toEqual(['zzz', 'aaa']);
  });

  it('throws rather than reading a missing directory as empty', () => {
    const dir = join(makeScratch(), 'not-there');

    expect(() => listSessionLogs(dir)).toThrow(/no session log directory/);
  });
});
