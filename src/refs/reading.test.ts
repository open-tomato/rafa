/**
 * Tests for the reading of a saved copy's references
 * (`src/refs/reading.ts`): extract, verify and stamp composed over one
 * copy, and the re-stamp that writes every live fingerprint back.
 *
 * Paths are read through a real git over a repository planted under
 * the temp directory, issues through a fake reader answering from a
 * table each case fills, and commands, flags and keys against the core
 * registry's roster and `SETTINGS`. The copies are files under the same
 * temp directory, so what a reading writes back is read off disk.
 *
 * ## The controls
 *
 * A first reading stamps what it reads `ok`, and a second reading of
 * the file it wrote is `unchanged` on disk: the stamps are what was
 * written, not a reading that stamps afresh every time. The resolved
 * blocker is paired with the same issue closing while NOT on the
 * `Blocked by:` line, which reads `ok` with no unblock command, so the
 * command is the blocker's and not every closed issue's. A suspect path
 * is produced by a real commit, so its stamp is a blob sha git wrote.
 */
import type { IssueRead, IssueReader, RefVerifier } from './verify.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { describeRegistry } from '../cli/describe.js';
import { CORE_REGISTRY } from '../commands/index.js';
import { createGitRunner } from '../pr/git.js';

import { readCopyRefs, readRefsText, restampCopyRefs, restampRefsText, unblockCommand } from './reading.js';
import { ABSENT, issueFingerprint, PRESENT, readRefsBlock, RefsBlockError, writeRefsBlock } from './stamp.js';
import { createRefVerifier, RefVerifyError } from './verify.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-reading-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const ROSTER = describeRegistry(CORE_REGISTRY, '0.0.0-test');

/** The spec's own issue number, which a resolved row's unblock command names. */
const SPEC = 151;

/** Runs git in `cwd`, throwing on failure: the planting's own git, not the seam under test. */
function plantGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** Writes `text` at `path` under `root`, making its directories. */
function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Commits every change under `root`. */
function commitAll(root: string, message: string): void {
  plantGit(root, ['add', '--all']);
  plantGit(root, ['commit', '--quiet', '--message', message]);
}

/** A fresh repository holding `src/a.ts` and `src/b.ts`, committed. */
function plantRepository(name: string): string {
  const root = join(tempBase, name);
  mkdirSync(root, { recursive: true });
  plantGit(root, ['init', '--quiet', '--initial-branch=main']);
  plantGit(root, ['config', 'user.email', 'rafa@example.test']);
  plantGit(root, ['config', 'user.name', 'rafa test']);
  plant(root, 'src/a.ts', 'export const alphaValue = 1;\n');
  plant(root, 'src/b.ts', 'export const betaValue = 2;\n');
  commitAll(root, 'planted');
  return root;
}

/** An issue as the fake reader answers it. */
function found(state: 'open' | 'closed', body = '## Design\n\nThe first design.\n'): IssueRead {
  return { kind: 'found', title: 'A blocker', body, state };
}

/** A reader answering from `table`, keyed `#n` or `owner/repo#n`, `missing` for anything else. */
function tableReader(table: Map<string, IssueRead>): IssueReader {
  return (number, repo) => Promise.resolve(table.get(`${repo ?? ''}#${String(number)}`) ?? { kind: 'missing' });
}

/** A verifier over the repository at `root` and the issues in `table`. */
function verifierOver(root: string, table: Map<string, IssueRead>): RefVerifier {
  return createRefVerifier({ issues: tableReader(table), git: createGitRunner(root), outline: null, roster: ROSTER });
}

/** Writes `text` as a saved copy named `name` under the temp directory and answers its path. */
function plantCopy(name: string, text: string): string {
  const path = join(tempBase, 'copies', `${name}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** A spec body naming a path, an issue, a command, a flag and a key; line numbers in the comments. */
const BODY = [
  '## Starting position', // 1
  '', // 2
  'The reader lives in `src/a.ts`, and #7 describes it.', // 3
  '', // 4
  'Run `rafa plan create` with `--issue`, which reads `specs.dir`.', // 5
  '',
].join('\n');

describe('a copy with no block', () => {
  it('stamps every present reference, reads each ok, and writes the block above the body unchanged', async () => {
    const root = plantRepository('first-read');
    const issues = new Map([['#7', found('open')]]);
    const path = plantCopy('first-read', BODY);

    const reading = await readCopyRefs({ path, issue: SPEC, verify: verifierOver(root, issues) });

    expect(reading.rows.map((row) => [row.kind, row.text, row.line, row.state])).toEqual([
      ['path', 'src/a.ts', 3, 'ok'],
      ['issue', '#7', 3, 'ok'],
      ['command', 'rafa plan create', 5, 'ok'],
      ['flag', '--issue', 5, 'ok'],
      ['key', 'specs.dir', 5, 'ok'],
    ]);
    for (const row of reading.rows) {
      expect(row.stamp).toEqual(row.fingerprint);
      expect(row.changedHeadings).toEqual([]);
      expect(row.unblock).toBeNull();
    }
    const onDisk = readFileSync(path, 'utf8');
    expect(reading.changed).toBe(true);
    expect(onDisk).toBe(reading.copy);
    expect(readRefsBlock(onDisk).body).toBe(BODY);
    expect(readRefsBlock(onDisk).stamps?.map((stamp) => stamp.text)).toEqual(['src/a.ts', '#7', 'rafa plan create', '--issue', 'specs.dir']);
  });

  it('reads the stamps it wrote on the next reading and leaves the file as it is', async () => {
    const root = plantRepository('second-read');
    const issues = new Map([['#7', found('open')]]);
    const path = plantCopy('second-read', BODY);
    const verify = verifierOver(root, issues);
    await readCopyRefs({ path, issue: SPEC, verify });
    const written = readFileSync(path, 'utf8');

    const again = await readCopyRefs({ path, issue: SPEC, verify });

    expect(again.changed).toBe(false);
    expect(again.rows.every((row) => row.state === 'ok')).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(written);
  });

  it('reads a missing target dangling on its first read and does not stamp it', async () => {
    const root = plantRepository('first-dangling');
    const path = plantCopy('first-dangling', 'See `src/gone.ts`.\n');

    const reading = await readCopyRefs({ path, issue: SPEC, verify: verifierOver(root, new Map()) });

    expect(reading.rows).toHaveLength(1);
    expect(reading.rows[0]).toMatchObject({ kind: 'path', text: 'src/gone.ts', line: 1, state: 'dangling', stamp: null });
    expect(reading.rows[0]?.fingerprint).toEqual(ABSENT);
    expect(reading.changed).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe('See `src/gone.ts`.\n');
  });

  it('leaves a copy that names nothing without a block', async () => {
    const root = plantRepository('names-nothing');
    const path = plantCopy('names-nothing', 'Nothing here points anywhere.\n');

    const reading = await readCopyRefs({ path, issue: SPEC, verify: verifierOver(root, new Map()) });

    expect(reading).toMatchObject({ rows: [], stamps: null, changed: false });
    expect(readFileSync(path, 'utf8')).toBe('Nothing here points anywhere.\n');
  });

  it('stamps a blocker closed on its first read and reads it ok: nothing closed since', async () => {
    const root = plantRepository('first-closed');
    const reading = await readRefsText({
      copy: 'Blocked by: #7\n',
      issue: SPEC,
      verify: verifierOver(root, new Map([['#7', found('closed')]])),
    });

    expect(reading.rows.map((row) => [row.text, row.state, row.unblock])).toEqual([['#7', 'ok', null]]);
  });
});

describe('a copy with a block', () => {
  it('reads a closed blocker stamped open as resolved, naming rafa issue unblock with the spec\'s number', async () => {
    const root = plantRepository('resolved');
    const body = 'Blocked by: #7\n\nWaits on the reader.\n';
    const copy = writeRefsBlock(body, [{ kind: 'issue', text: '#7', fingerprint: issueFingerprint(found('open')) }]);

    const reading = await readRefsText({ copy, issue: SPEC, verify: verifierOver(root, new Map([['#7', found('closed')]])) });

    expect(reading.rows).toHaveLength(1);
    expect(reading.rows[0]).toMatchObject({ kind: 'issue', text: '#7', line: 1, state: 'resolved' });
    expect(reading.rows[0]?.unblock).toBe('rafa issue unblock 151');
    expect(unblockCommand(SPEC)).toBe('rafa issue unblock 151');
    expect(reading.changed).toBe(false);
  });

  it('reads the same issue closing ok with no unblock command when it is not a blocker', async () => {
    const root = plantRepository('closed-not-blocker');
    const copy = writeRefsBlock('Related: #7\n', [{ kind: 'issue', text: '#7', fingerprint: issueFingerprint(found('open')) }]);

    const reading = await readRefsText({ copy, issue: SPEC, verify: verifierOver(root, new Map([['#7', found('closed')]])) });

    expect(reading.rows.map((row) => [row.text, row.state, row.unblock])).toEqual([['#7', 'ok', null]]);
  });

  it('reads an issue whose Design section changed suspect, naming that heading', async () => {
    const root = plantRepository('suspect-issue');
    const stamped = issueFingerprint(found('open', '## Design\n\nOld.\n\n## Scope\n\nSame.\n'));
    const copy = writeRefsBlock('Builds on #7.\n', [{ kind: 'issue', text: '#7', fingerprint: stamped }]);
    const issues = new Map([['#7', found('open', '## Design\n\nNew.\n\n## Scope\n\nSame.\n')]]);

    const reading = await readRefsText({ copy, issue: SPEC, verify: verifierOver(root, issues) });

    expect(reading.rows[0]?.state).toBe('suspect');
    expect(reading.rows[0]?.changedHeadings).toEqual(['Design']);
    expect(reading.rows[0]?.stamp).toEqual(stamped);
  });

  it('reads a path committed with new content since the stamp suspect, and one deleted since dangling', async () => {
    const root = plantRepository('suspect-path');
    const path = plantCopy('suspect-path', 'Reads `src/a.ts` and `src/b.ts`.\n');
    const verify = (): RefVerifier => verifierOver(root, new Map());
    await readCopyRefs({ path, issue: SPEC, verify: verify() });
    plant(root, 'src/a.ts', 'export const alphaValue = 10;\n');
    rmSync(join(root, 'src/b.ts'));
    commitAll(root, 'changed a, deleted b');

    const reading = await readCopyRefs({ path, issue: SPEC, verify: verify() });

    expect(reading.rows.map((row) => [row.text, row.state])).toEqual([['src/a.ts', 'suspect'], ['src/b.ts', 'dangling']]);
    expect(reading.changed).toBe(false);
  });

  it('reads a cross-repository issue it cannot read unknown, and stamps nothing for it', async () => {
    const root = plantRepository('unknown');
    const reading = await readRefsText({ copy: 'Mirrors other/repo#3.\n', issue: SPEC, verify: verifierOver(root, new Map()) });

    expect(reading.rows.map((row) => [row.kind, row.text, row.state, row.stamp])).toEqual([['cross-issue', 'other/repo#3', 'unknown', null]]);
    expect(reading.stamps).toBeNull();
  });

  it('stamps a reference the block does not hold yet and keeps the stamps it holds, the body no longer naming one', async () => {
    const root = plantRepository('added-ref');
    const copy = writeRefsBlock('Reads `src/a.ts`.\n', [{ kind: 'key', text: 'plan.dir', fingerprint: PRESENT }]);

    const reading = await readRefsText({ copy, issue: SPEC, verify: verifierOver(root, new Map()) });

    expect(reading.changed).toBe(true);
    expect(reading.stamps?.map((stamp) => stamp.text)).toEqual(['plan.dir', 'src/a.ts']);
    expect(reading.rows.map((row) => [row.text, row.state])).toEqual([['src/a.ts', 'ok']]);
  });

  it('counts lines in the body with the block stripped', async () => {
    const root = plantRepository('lines');
    const copy = writeRefsBlock('One.\nTwo.\nReads `src/a.ts`.\n', []);

    const reading = await readRefsText({ copy, issue: SPEC, verify: verifierOver(root, new Map()) });

    expect(reading.rows.map((row) => row.line)).toEqual([3]);
  });

  it('throws the codec\'s error for a block that does not close, before reading any target', async () => {
    const root = plantRepository('broken-block');
    let asked = 0;
    const verify: RefVerifier = async (ref) => {
      asked += 1;
      return verifierOver(root, new Map())(ref);
    };

    const reading = readRefsText({ copy: '<!-- rafa:refs\nrefs: []\n\nReads `src/a.ts`.\n', issue: SPEC, verify });

    await expect(reading).rejects.toBeInstanceOf(RefsBlockError);
    expect(asked).toBe(0);
  });
});

describe('re-stamping', () => {
  it('writes every live fingerprint back, absent for a missing target, and turns suspect and dangling rows ok', async () => {
    const root = plantRepository('restamp');
    const body = 'Reads `src/a.ts` and `src/gone.ts`, after #7.\n';
    const stale = issueFingerprint(found('open', '## Design\n\nOld.\n'));
    const path = plantCopy('restamp', writeRefsBlock(body, [
      { kind: 'issue', text: '#7', fingerprint: stale },
      { kind: 'key', text: 'plan.dir', fingerprint: PRESENT },
    ]));
    const verify = verifierOver(root, new Map([['#7', found('open', '## Design\n\nNew.\n')]]));
    const before = await readCopyRefs({ path, issue: SPEC, verify });
    expect(before.rows.map((row) => [row.text, row.state])).toEqual([['src/a.ts', 'ok'], ['src/gone.ts', 'dangling'], ['#7', 'suspect']]);

    const restamped = await restampCopyRefs({ path, issue: SPEC, verify });

    expect(restamped.rows.map((row) => [row.text, row.state])).toEqual([['src/a.ts', 'ok'], ['src/gone.ts', 'ok'], ['#7', 'ok']]);
    const onDisk = readRefsBlock(readFileSync(path, 'utf8'));
    expect(onDisk.body).toBe(body);
    expect(onDisk.stamps?.map((stamp) => [stamp.text, stamp.fingerprint.kind])).toEqual([['src/a.ts', 'blob'], ['src/gone.ts', 'absent'], ['#7', 'issue']]);
    const after = await readCopyRefs({ path, issue: SPEC, verify });
    expect(after.rows.every((row) => row.state === 'ok')).toBe(true);
    expect(after.changed).toBe(false);
  });

  it('keeps the old stamp of a target it cannot read, and reads that row unknown', async () => {
    const root = plantRepository('restamp-unknown');
    const stamped = issueFingerprint(found('open'));
    const copy = writeRefsBlock('Mirrors other/repo#3.\n', [{ kind: 'cross-issue', text: 'other/repo#3', fingerprint: stamped }]);

    const reading = await restampRefsText({ copy, issue: SPEC, verify: verifierOver(root, new Map()) });

    expect(reading.rows.map((row) => row.state)).toEqual(['unknown']);
    expect(reading.stamps).toEqual([{ kind: 'cross-issue', text: 'other/repo#3', fingerprint: stamped }]);
  });

  it('writes an empty block for a copy that names nothing, telling it apart from one never checked', async () => {
    const root = plantRepository('restamp-empty');
    const path = plantCopy('restamp-empty', 'Nothing here.\n');

    const reading = await restampCopyRefs({ path, issue: SPEC, verify: verifierOver(root, new Map()) });

    expect(reading.stamps).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe('<!-- rafa:refs\nrefs: []\n-->\n\nNothing here.\n');
  });

  it('writes nothing when the board cannot be read', async () => {
    const root = plantRepository('restamp-unreadable');
    const path = plantCopy('restamp-unreadable', 'After #7.\n');
    const verify = verifierOver(root, new Map([['#7', { kind: 'failed', detail: 'gh: not logged in' }]]));

    await expect(restampCopyRefs({ path, issue: SPEC, verify })).rejects.toBeInstanceOf(RefVerifyError);
    expect(readFileSync(path, 'utf8')).toBe('After #7.\n');
  });
});
