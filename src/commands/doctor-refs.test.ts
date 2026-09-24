/**
 * Tests for the references row of `rafa doctor` (`./doctor-refs.ts`):
 * which saved copies under `specs.dir` are read, the suspect, dangling
 * and unknown counts per copy and in total, that an issue is read once
 * per run, that an unreadable board reads `unknown` instead of failing
 * the row, that nothing is written, and the lines the row renders.
 *
 * Paths are read through a real git over a repository planted under the
 * temp directory; issues through a fake `gh` runner answering
 * `gh issue view` from a table each case fills and recording every call.
 * The verifier is `createRefVerifier` over those two, handed in through
 * the `refsVerifier` seam with no `ts-symbols` and the core roster.
 *
 * ## The controls
 *
 * The board case that reads `unknown` is paired with the same copy over
 * a board that answers, which reads `ok`; the memoisation case counts
 * `gh` calls, where a reader asked per reference would make two; the
 * read-nothing case holds that the same copy read by `readRefsText`
 * WOULD change, so the unchanged bytes on disk are the row's doing.
 */
import type { DoctorRefsReading, DoctorRefsSeams } from './doctor-refs.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { describeRegistry } from '../cli/describe.js';
import { createGitRunner } from '../pr/git.js';
import { readRefsText } from '../refs/reading.js';
import { issueFingerprint, UNREADABLE, writeRefsBlock } from '../refs/stamp.js';
import { createRefVerifier } from '../refs/verify.js';

import { issueCheckCommand, memoiseIssueReader, NO_BOARD_DETAIL, readDoctorRefs, renderDoctorRefs } from './doctor-refs.js';

import { CORE_REGISTRY } from './index.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-refs-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const ROSTER = describeRegistry(CORE_REGISTRY, '0.0.0-test');

/** `specs.dir` as the cases configure it. */
const SPECS = join('.rafa', 'specs');

/** Runs git in `cwd`, throwing on failure: the planting's own git. */
function plantGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** Writes `text` at `path` under `root`, making its directories. */
function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A fresh repository holding `src/a.ts`, committed. */
function plantRepository(name: string): string {
  const root = join(tempBase, name);
  mkdirSync(root, { recursive: true });
  plantGit(root, ['init', '--quiet', '--initial-branch=main']);
  plantGit(root, ['config', 'user.email', 'rafa@example.test']);
  plantGit(root, ['config', 'user.name', 'rafa test']);
  plant(root, 'src/a.ts', 'export const alphaValue = 1;\n');
  plantGit(root, ['add', '--all']);
  plantGit(root, ['commit', '--quiet', '--message', 'planted']);
  return root;
}

/** Writes a saved copy named `name` under `specs.dir` of `root`. */
function plantCopy(root: string, name: string, text: string): string {
  const path = join(SPECS, name);
  plant(root, path, text);
  return path;
}

/** An issue as the fake board holds it. */
interface FakeIssue {
  readonly title: string;
  readonly body: string;
  readonly state: 'OPEN' | 'CLOSED';
}

/** A `gh` runner answering `gh issue view <n>` from `issues`, or failing every call with `failWith`. */
function fakeGh(issues: Readonly<Record<number, FakeIssue>>, failWith: string | null = null): { run: GhRunner; calls: () => readonly string[] } {
  const calls: string[] = [];
  const run: GhRunner = async (args) => {
    calls.push(args.join(' '));
    if (failWith !== null) return { ok: false, stdout: '', stderr: failWith } satisfies GhResult;
    const issue = issues[Number(args[2])];
    if (issue === undefined) {
      return { ok: false, stdout: '', stderr: 'GraphQL: Could not resolve to an issue or pull request with the number.' };
    }
    return { ok: true, stdout: JSON.stringify(issue), stderr: '' };
  };
  return { run, calls: () => calls };
}

/** The seams every case reads with: git in the root, no `ts-symbols`, the core roster. */
const SEAMS: DoctorRefsSeams = {
  refsVerifier: (root, issues) => createRefVerifier({ issues, git: createGitRunner(root), outline: null, roster: ROSTER }),
};

/** Issue #7 as it was when the suspect copy was stamped. */
const OLD_SEVEN: FakeIssue = { title: 'Seven', body: '## Design\n\nThe old design.\n', state: 'OPEN' };

/** Issue #7 as the board holds it now: its Design section changed. */
const NEW_SEVEN: FakeIssue = { title: 'Seven', body: '## Design\n\nA new design.\n', state: 'OPEN' };

/** A copy of issue 2 stamped with #7 as it was, naming a file that is not there. */
function suspectCopy(): string {
  const stamp = issueFingerprint({ title: OLD_SEVEN.title, body: OLD_SEVEN.body, state: 'open' });
  return writeRefsBlock('Builds on #7 and adds `src/missing.ts`.\n', [{ kind: 'issue', text: '#7', fingerprint: stamp }]);
}

/** The ok reading of `copies`, or a failure. */
function okReading(reading: DoctorRefsReading): Extract<DoctorRefsReading, { ok: true }> {
  if (!reading.ok) throw new Error(`expected a reading, got: ${reading.detail}`);
  return reading;
}

describe('readDoctorRefs', () => {
  it('counts suspect and dangling references per saved copy and in total, skipping the notes file and previous/', async () => {
    const root = plantRepository('counts');
    plantCopy(root, 'rafa-1-clean-copy.md', 'Reads `src/a.ts`.\n');
    plantCopy(root, 'rafa-2-suspect-copy.md', suspectCopy());
    plantCopy(root, 'rafa-2-notes.md', 'Names `src/also-missing.ts`.\n');
    plantCopy(root, join('previous', 'rafa-3-old-copy.md'), 'Names `src/gone.ts`.\n');
    plantCopy(root, 'README.md', 'Names `src/gone.ts`.\n');
    const gh = fakeGh({ 7: NEW_SEVEN });

    const reading = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: gh.run }, SEAMS));

    expect(reading.copies).toEqual([
      { issue: 1, path: join(SPECS, 'rafa-1-clean-copy.md'), suspect: 0, dangling: 0, unknown: 0, error: null },
      { issue: 2, path: join(SPECS, 'rafa-2-suspect-copy.md'), suspect: 1, dangling: 1, unknown: 0, error: null },
    ]);
    expect([reading.suspect, reading.dangling, reading.unknown]).toEqual([1, 1, 0]);
  });

  it('reads each issue once per run, across copies and across its two spellings', async () => {
    const root = plantRepository('memoised');
    plantCopy(root, 'rafa-1-first-copy.md', 'Builds on #7.\n');
    plantCopy(root, 'rafa-2-second-copy.md', 'Builds on #7 and rafa-7.\n');
    const gh = fakeGh({ 7: NEW_SEVEN });

    const reading = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: gh.run }, SEAMS));

    expect(gh.calls()).toEqual(['issue view 7 --json title,body,state']);
    expect(reading.copies.map((copy) => copy.error)).toEqual([null, null]);
  });

  it('counts an issue an unreadable board cannot answer as unknown, asking gh once, where a board that answers reads ok', async () => {
    const root = plantRepository('board-down');
    plantCopy(root, 'rafa-1-board-copy.md', 'Builds on #7 and #8, and reads `src/a.ts`.\n');
    const down = fakeGh({}, 'HTTP 401: Bad credentials');
    const up = fakeGh({ 7: NEW_SEVEN, 8: NEW_SEVEN });

    const unread = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: down.run }, SEAMS));
    const read = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: up.run }, SEAMS));

    expect(unread.copies).toEqual([
      { issue: 1, path: join(SPECS, 'rafa-1-board-copy.md'), suspect: 0, dangling: 0, unknown: 2, error: null },
    ]);
    expect(down.calls()).toHaveLength(1);
    expect(read.copies[0]).toMatchObject({ suspect: 0, dangling: 0, unknown: 0, error: null });
    expect(up.calls()).toHaveLength(2);
  });

  it('reads every issue as unknown with no gh runner, spawning nothing', async () => {
    const root = plantRepository('no-board');
    plantCopy(root, 'rafa-1-plain-copy.md', 'Builds on #7.\n');

    const reading = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: null }, SEAMS));

    expect(reading.copies[0]).toMatchObject({ unknown: 1, error: null });
  });

  it('writes nothing to a copy it read, where readRefsText would have stamped it', async () => {
    const root = plantRepository('read-only');
    const path = plantCopy(root, 'rafa-1-unstamped-copy.md', 'Reads `src/a.ts`.\n');
    const before = readFileSync(join(root, path), 'utf8');
    const verify = createRefVerifier({ issues: async () => ({ kind: 'missing' }), git: createGitRunner(root), outline: null, roster: ROSTER });

    await readDoctorRefs({ root, specsDir: SPECS, gh: null }, SEAMS);

    expect(readFileSync(join(root, path), 'utf8')).toBe(before);
    expect((await readRefsText({ copy: before, issue: 1, verify })).changed).toBe(true);
  });

  it('fails one copy whose refs block will not read, and still counts the others', async () => {
    const root = plantRepository('broken-block');
    plantCopy(root, 'rafa-1-broken-copy.md', '<!-- rafa:refs\n: not yaml [\n-->\nReads `src/a.ts`.\n');
    plantCopy(root, 'rafa-2-fine-copy.md', 'Names `src/missing.ts`.\n');

    const reading = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: null }, SEAMS));

    expect(reading.copies[0]?.error).toEqual(expect.any(String));
    expect(reading.copies[1]).toMatchObject({ issue: 2, dangling: 1, error: null });
    expect(reading.dangling).toBe(1);
  });

  it('holds no copy for a specs.dir that does not exist, and fails the row for one that is a file', async () => {
    const root = plantRepository('no-specs');
    plant(root, 'specs-file', 'not a directory\n');

    const missing = await readDoctorRefs({ root, specsDir: SPECS, gh: null }, SEAMS);
    const file = await readDoctorRefs({ root, specsDir: 'specs-file', gh: null }, SEAMS);

    expect(missing).toEqual({ ok: true, copies: [], suspect: 0, dangling: 0, unknown: 0 });
    expect(file.ok).toBe(false);
  });
});

describe('memoiseIssueReader', () => {
  it('asks once per repository and number, and stops asking the board after it failed while other repositories are still asked', async () => {
    const asked: string[] = [];
    const reader = memoiseIssueReader(async (number, repo) => {
      asked.push(`${repo ?? 'board'}#${String(number)}`);
      return repo === undefined
        ? { kind: 'failed', detail: 'down' }
        : { kind: 'missing' };
    });

    await reader(7);
    await reader(8);
    await reader(7, 'owner/other');
    await reader(7, 'owner/other');

    expect(asked).toEqual(['board#7', 'owner/other#7']);
  });
});

describe('renderDoctorRefs', () => {
  it('prints nothing with no saved copy or a specs.dir that could not be listed', () => {
    expect(renderDoctorRefs({ ok: true, copies: [], suspect: 0, dangling: 0, unknown: 0 })).toEqual([]);
    expect(renderDoctorRefs({ ok: false, detail: 'ENOTDIR' })).toEqual([]);
  });

  it('prints one line for copies that all read', () => {
    const copy = { issue: 1, path: '.rafa/specs/rafa-1-a.md', suspect: 0, dangling: 0, unknown: 0, error: null };

    expect(renderDoctorRefs({ ok: true, copies: [copy], suspect: 0, dangling: 0, unknown: 0 }))
      .toEqual(['References: 1 saved copy, none suspect or dangling.']);
  });

  it('names rafa issue check <n> for each copy holding a suspect or dangling reference, and why unknown ones went unchecked', () => {
    const copies = [
      { issue: 1, path: '.rafa/specs/rafa-1-a.md', suspect: 0, dangling: 0, unknown: 0, error: null },
      { issue: 2, path: '.rafa/specs/rafa-2-b.md', suspect: 1, dangling: 2, unknown: 0, error: null },
      { issue: 3, path: '.rafa/specs/rafa-3-c.md', suspect: 0, dangling: 0, unknown: 1, error: null },
      { issue: 4, path: '.rafa/specs/rafa-4-d.md', suspect: 0, dangling: 0, unknown: 0, error: 'bad block' },
    ];

    expect(renderDoctorRefs({ ok: true, copies, suspect: 1, dangling: 2, unknown: 1 })).toEqual([
      'References: 1 suspect, 2 dangling, 1 unknown across 4 saved copies, 1 not read; run rafa issue check <n> to see each:',
      `  #2 .rafa/specs/rafa-2-b.md: 1 suspect, 2 dangling — ${issueCheckCommand(2)}`,
      '  #3 .rafa/specs/rafa-3-c.md: 1 unknown, not checked — the board or their repository could not be read',
      `  #4 .rafa/specs/rafa-4-d.md: its references could not be read (bad block) — ${issueCheckCommand(4)}`,
    ]);
  });

  it('counts unknown references on the clean line', () => {
    const copy = { issue: 1, path: '.rafa/specs/rafa-1-a.md', suspect: 0, dangling: 0, unknown: 2, error: null };

    expect(renderDoctorRefs({ ok: true, copies: [copy], suspect: 0, dangling: 0, unknown: 2 })[0])
      .toBe('References: 1 saved copy, none suspect or dangling (2 unknown).');
  });
});

describe('the no-board detail', () => {
  it('is what an issue reads as with no runner: unreadable, never a failure of the row', async () => {
    const root = plantRepository('detail');
    plantCopy(root, 'rafa-1-detail-copy.md', 'Builds on #9.\n');
    const seen: unknown[] = [];
    const seams: DoctorRefsSeams = {
      refsVerifier: (at, issues) => async () => {
        seen.push([at, await issues(9)]);
        return UNREADABLE;
      },
    };

    await readDoctorRefs({ root, specsDir: SPECS, gh: null }, seams);

    expect(seen).toEqual([[root, { kind: 'failed', detail: NO_BOARD_DETAIL }]]);
  });
});
