/**
 * Integration of the references reading (`src/refs/reading.ts`) over a
 * planted git repository under the temp directory and a fake `gh`
 * runner answering `gh issue view` from a table. Nothing reaches GitHub.
 *
 * Covers, end to end through files on disk: a dangling path after the
 * file is deleted, a suspect issue naming the `## Design` heading whose
 * text changed, a resolved blocker, a cross-repository `unknown`, an old
 * copy with no block stamped and read `ok`, and a re-stamp that turns
 * suspect and dangling rows `ok`.
 */
import type { GhRunner } from '../adapters/tracker/github.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { describeRegistry } from '../cli/describe.js';
import { CORE_REGISTRY } from '../commands/index.js';
import { createGitRunner } from '../pr/git.js';
import { readCopyRefs, restampCopyRefs } from '../refs/reading.js';
import { readRefsBlock } from '../refs/stamp.js';
import { createRefVerifier, ghIssueReader } from '../refs/verify.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const ROSTER = describeRegistry(CORE_REGISTRY, '0.0.0-test');
const SPEC = 151;
const FOREIGN = 'other/repo';

interface FakeIssue {
  readonly state: 'OPEN' | 'CLOSED';
  readonly body: string;
}

/** Runs git in `cwd`, throwing on failure. */
function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** A committed repository holding `src/a.ts`. */
function plantRepository(name: string): string {
  const root = join(tempBase, name);
  mkdirSync(join(root, 'src'), { recursive: true });
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'rafa@example.test']);
  git(root, ['config', 'user.name', 'rafa test']);
  writeFileSync(join(root, 'src/a.ts'), 'export const alphaValue = 1;\n');
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '--message', 'planted']);
  return root;
}

/** A fake gh over `board`, keyed `#n` for the board's repository or `owner/repo#n`; the table is live. */
function fakeGh(board: Map<string, FakeIssue>): GhRunner {
  return (args) => {
    const at = args.indexOf('--repo');
    const repo = at === -1
      ? ''
      : args[at + 1] ?? '';
    const issue = board.get(`${repo}#${args[2] ?? ''}`);
    if (args[0] !== 'issue' || args[1] !== 'view') return Promise.resolve({ ok: false, stdout: '', stderr: 'unexpected' });
    if (issue === undefined) {
      return Promise.resolve({ ok: false, stdout: '', stderr: repo === ''
        ? 'Could not resolve to an issue or pull request'
        : 'HTTP 404: no access' });
    }
    return Promise.resolve({ ok: true, stdout: JSON.stringify({ title: 'T', body: issue.body, state: issue.state }), stderr: '' });
  };
}

/** A verifier over the repository at `root` and the fake board. */
function verifierOver(root: string, board: Map<string, FakeIssue>): ReturnType<typeof createRefVerifier> {
  return createRefVerifier({ issues: ghIssueReader(fakeGh(board)), git: createGitRunner(root), outline: null, roster: ROSTER });
}

/** Writes a saved copy and answers its path. */
function plantCopy(name: string, text: string): string {
  const path = join(tempBase, 'copies', `${name}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

const BODY = [
  'Blocked by: #9',
  '',
  'Reads `src/a.ts`, follows #7 and mirrors other/repo#3.',
  '',
].join('\n');

const DESIGN_ONE = '## Design\n\nOne.\n\n## Notes\n\nSame.\n';
const DESIGN_TWO = '## Design\n\nTwo.\n\n## Notes\n\nSame.\n';

function stateOf(rows: readonly { text: string; state: string }[], text: string): string | undefined {
  return rows.find((row) => row.text === text)?.state;
}

describe('references reading over a planted repository and a fake gh', () => {
  it('stamps an old copy with no block and reads every reference ok', async () => {
    const root = plantRepository('old-copy');
    const board = new Map<string, FakeIssue>([
      ['#9', { state: 'OPEN', body: 'x' }],
      ['#7', { state: 'OPEN', body: DESIGN_ONE }],
      [`${FOREIGN}#3`, { state: 'OPEN', body: 'y' }],
    ]);
    const path = plantCopy('old-copy', BODY.replace('other/repo#3', `${FOREIGN}#3`));

    const reading = await readCopyRefs({ path, issue: SPEC, verify: verifierOver(root, board) });

    expect(reading.rows.map((row) => row.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(readRefsBlock(readFileSync(path, 'utf8')).stamps).toHaveLength(4);
  });

  it('reads the deleted file dangling, the changed ## Design suspect, the closed blocker resolved and the unreadable foreign issue unknown', async () => {
    const root = plantRepository('drift');
    const board = new Map<string, FakeIssue>([
      ['#9', { state: 'OPEN', body: 'x' }],
      ['#7', { state: 'OPEN', body: DESIGN_ONE }],
      [`${FOREIGN}#3`, { state: 'OPEN', body: 'y' }],
    ]);
    const path = plantCopy('drift', BODY);
    await readCopyRefs({ path, issue: SPEC, verify: verifierOver(root, board) });

    git(root, ['rm', '--quiet', 'src/a.ts']);
    git(root, ['commit', '--quiet', '--message', 'delete']);
    board.set('#7', { state: 'OPEN', body: DESIGN_TWO });
    board.set('#9', { state: 'CLOSED', body: 'x' });
    board.delete(`${FOREIGN}#3`);

    const reading = await readCopyRefs({ path, issue: SPEC, verify: verifierOver(root, board) });

    expect(stateOf(reading.rows, 'src/a.ts')).toBe('dangling');
    expect(stateOf(reading.rows, '#7')).toBe('suspect');
    expect(reading.rows.find((row) => row.text === '#7')?.changedHeadings).toEqual(['Design']);
    expect(stateOf(reading.rows, '#9')).toBe('resolved');
    expect(reading.rows.find((row) => row.text === '#9')?.unblock).toBe('rafa issue unblock 151');
    expect(stateOf(reading.rows, `${FOREIGN}#3`)).toBe('unknown');
  });

  it('turns the suspect and dangling rows ok on a re-stamp', async () => {
    const root = plantRepository('restamp');
    const board = new Map<string, FakeIssue>([['#7', { state: 'OPEN', body: DESIGN_ONE }]]);
    const path = plantCopy('restamp', 'Reads `src/a.ts` and #7.\n');
    await readCopyRefs({ path, issue: SPEC, verify: verifierOver(root, board) });
    git(root, ['rm', '--quiet', 'src/a.ts']);
    git(root, ['commit', '--quiet', '--message', 'delete']);
    board.set('#7', { state: 'OPEN', body: DESIGN_TWO });

    const before = await readCopyRefs({ path, issue: SPEC, verify: verifierOver(root, board) });
    expect(before.rows.map((row) => row.state)).toEqual(['dangling', 'suspect']);

    const stamped = await restampCopyRefs({ path, issue: SPEC, verify: verifierOver(root, board) });
    expect(stamped.rows.map((row) => row.state)).toEqual(['ok', 'ok']);

    const after = await readCopyRefs({ path, issue: SPEC, verify: verifierOver(root, board) });
    expect(after.rows.map((row) => row.state)).toEqual(['ok', 'ok']);
    expect(after.changed).toBe(false);
  });
});
