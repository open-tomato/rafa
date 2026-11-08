/**
 * Tests for the per-bug judge of `rafa bug recheck`
 * (`recheck-judge.ts`), over a planted tracker, a planted `gh` behind
 * the board trust and a planted runner, so nothing is spawned. Every
 * reason is SPELLED here, never read off the module.
 */
import type { JudgeBugsOptions, ReadBug } from './recheck-judge.js';
import type { RecheckBugOptions, RecheckRun } from './recheck-run.js';
import type { GhRunner } from '@open-tomato/rafa/core/git';
import type { EditableIssue, IssueRef, Tracker } from '@open-tomato/rafa/ports';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ghBoardTrust } from '@open-tomato/rafa-board';
import { afterAll, describe, expect, it } from 'bun:test';

import { judgeBugs } from './recheck-judge.js';

/** The kind of the planted tracker, which is not `local`. */
const PROBE = 'probe';

/** The test file every runnable reference names, written in the checkout. */
const TEST_FILE = 'src/a.test.ts';

/** A secret the planted environment holds. */
const SECRET = 'ghp_planted0secret0value';

/** The planted base environment. */
const BASE_ENV = { PATH: '/usr/bin:/bin', GITHUB_TOKEN: SECRET, LANG: 'C' };

const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-recheck-judge-test-')));
mkdirSync(join(checkout, 'src'), { recursive: true });
writeFileSync(join(checkout, TEST_FILE), 'import { test } from "bun:test";\ntest("a case", () => {});\n');

afterAll(() => {
  rmSync(checkout, { recursive: true, force: true });
});

/** The ref of issue `id` on the planted tracker. */
function refOf(id: string): IssueRef {
  return { opt: 0, kind: PROBE, externalId: id, url: null };
}

/** A tracker answering `editable` with `authors` by number, recording every read. */
function plantedTracker(authors: Readonly<Record<string, string>>, reads: string[]): Tracker {
  const refuse = (): Promise<never> => Promise.reject(new Error(`${PROBE}: not modelled`));
  return {
    kind: PROBE,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: () => Promise.resolve({ ok: true }),
    find: refuse,
    get: refuse,
    create: refuse,
    comment: refuse,
    transition: refuse,
    editable: (ref: IssueRef): Promise<EditableIssue> => {
      reads.push(ref.externalId);
      return Promise.resolve({ ref, title: '', body: '', open: true, labels: [], author: authors[ref.externalId] ?? '' });
    },
  };
}

/** A gh answering each login's permission from `permissions`, `none` for any other. */
function plantedGh(permissions: Readonly<Record<string, string>>): GhRunner {
  return (args) => {
    const login = /collaborators\/([^/]+)\/permission$/.exec(args.join(' '))?.[1];
    if (args[0] !== 'api' || login === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: 'planted gh: not modelled' });
    const permission = permissions[login] ?? 'none';
    return Promise.resolve({ ok: true, stdout: JSON.stringify({ permission, role_name: permission }), stderr: '' });
  };
}

/** A bug body with `rerun` in its `Rerun` section and `reproduce` in its `Reproduce` one. */
function bugBody(rerun: string, reproduce = 'run the suite twice'): string {
  return ['## What', '', 'It breaks.', '', '## Reproduce', '', reproduce, '', '## Rerun', '', '```', rerun, '```', ''].join('\n');
}

/** Bug `issue`, its author yet to be read when `author` is null. */
function bug(issue: number, rerun: string, author: string | null = 'alice', reproduce?: string): ReadBug {
  return { ref: refOf(String(issue)), issue, title: `bug ${issue}`, body: bugBody(rerun, reproduce), author };
}

/** A runner answering `answer`, recording each call. */
function plantedRunner(answer: RecheckRun): { readonly recheck: JudgeBugsOptions['recheck']; readonly calls: RecheckBugOptions[] } {
  const calls: RecheckBugOptions[] = [];
  return {
    calls,
    recheck: (options) => {
      calls.push(options);
      return Promise.resolve(answer);
    },
  };
}

/** The judge's options over the planted tracker and gh, with `overrides`. */
function options(overrides: Partial<JudgeBugsOptions> = {}): JudgeBugsOptions {
  return {
    tracker: plantedTracker({}, []),
    trust: () => ghBoardTrust({ gh: plantedGh({ alice: 'write' }), trustedAuthors: [], repo: 'github.com/open-tomato/rafa' }),
    checkout,
    env: BASE_ENV,
    secrets: [{ name: 'GITHUB_TOKEN', value: SECRET }],
    runs: 3,
    timeoutMs: 7000,
    recheck: plantedRunner({ verdict: 'gone', runs: 4, failedRuns: null, timedOutRuns: 0 }).recheck,
    warn: () => undefined,
    ...overrides,
  };
}

/** A row's empty fields, for a verdict reached without a run. */
const UNRUN = { runs: 0, failedRuns: null, commented: false };

describe('judgeBugs', () => {
  it('judges a prose Rerun manual, carrying the record\'s Reproduce, and runs nothing', async () => {
    const runner = plantedRunner({ verdict: 'gone', runs: 4, failedRuns: null, timedOutRuns: 0 });

    const judged = await judgeBugs([bug(1, 'run it by hand and watch', 'alice', 'open the board and look')], options({ recheck: runner.recheck }));

    expect(judged.rows).toHaveLength(1);
    expect(judged.rows[0]).toMatchObject({ issue: 1, title: 'bug 1', verdict: 'manual', reference: null, reproduce: 'open the board and look', ...UNRUN });
    expect(judged.rows[0]?.reason).not.toBeNull();
    expect(runner.calls).toEqual([]);
  });

  it('judges a file not in the checkout stale, and runs nothing', async () => {
    const runner = plantedRunner({ verdict: 'gone', runs: 4, failedRuns: null, timedOutRuns: 0 });

    const judged = await judgeBugs([bug(2, 'bun test src/gone.test.ts')], options({ recheck: runner.recheck }));

    expect(judged.rows).toEqual([{
      issue: 2,
      title: 'bug 2',
      verdict: 'stale',
      reference: { file: 'src/gone.test.ts', pattern: null },
      reason: 'no file src/gone.test.ts in the checkout',
      reproduce: null,
      ...UNRUN,
    }]);
    expect(runner.calls).toEqual([]);
  });

  it('skips a runnable bug by an untrusted author with the runner never called, and runs the trusted one beside it', async () => {
    const runner = plantedRunner({ verdict: 'gone', runs: 4, failedRuns: null, timedOutRuns: 0 });
    const reads: string[] = [];
    const tracker = plantedTracker({ 3: 'mallory', 4: 'alice' }, reads);

    const judged = await judgeBugs(
      [bug(3, `bun test ${TEST_FILE}`, null), bug(4, `bun test ${TEST_FILE}`, null)],
      options({ tracker, trust: () => ghBoardTrust({ gh: plantedGh({ alice: 'write', mallory: 'read' }), trustedAuthors: [], repo: 'github.com/open-tomato/rafa' }), recheck: runner.recheck }),
    );

    expect(reads).toEqual(['3', '4']);
    expect(judged.rows[0]).toMatchObject({ issue: 3, verdict: 'skipped', reference: { file: TEST_FILE, pattern: null }, ...UNRUN });
    expect(judged.rows[0]?.reason).toStartWith('opened by mallory, ');
    // The control: the trusted author's bug, read the same way, did run.
    expect(judged.rows[1]).toMatchObject({ issue: 4, verdict: 'gone', runs: 4 });
    expect(runner.calls.map((call) => call.junitDir.endsWith('issue-4'))).toEqual([true]);
  });

  it('judges a first failing run reproduces, handing the runner the reference, the checkout and an environment without the named secret', async () => {
    const runner = plantedRunner({ verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 0 });

    const judged = await judgeBugs([bug(5, `bun test ${TEST_FILE} -t "a case"`)], options({ recheck: runner.recheck }));

    expect(judged.rows).toEqual([{
      issue: 5,
      title: 'bug 5',
      verdict: 'reproduces',
      reference: { file: TEST_FILE, pattern: 'a case' },
      runs: 1,
      failedRuns: null,
      reason: null,
      reproduce: null,
      commented: false,
    }]);
    expect(judged.secretsLeftOut).toEqual(['GITHUB_TOKEN']);
    expect(runner.calls).toHaveLength(1);
    const [call] = runner.calls;
    expect(call).toMatchObject({ path: TEST_FILE, pattern: 'a case', checkout, runs: 3, timeoutMs: 7000 });
    expect(call?.env['PATH']).toBe(BASE_ENV.PATH);
    expect(Object.keys(call?.env ?? {})).not.toContain('GITHUB_TOKEN');
  });

  it('removes the JUnit temp dir after a runner that throws, and lets the throw through', async () => {
    const junitDirs: string[] = [];
    const rootExistedDuringRun: boolean[] = [];
    const recheck = (runOptions: RecheckBugOptions): Promise<RecheckRun> => {
      junitDirs.push(runOptions.junitDir);
      rootExistedDuringRun.push(existsSync(dirname(runOptions.junitDir)));
      return Promise.reject(new Error('the runner broke'));
    };

    await expect(judgeBugs([bug(6, `bun test ${TEST_FILE}`)], options({ recheck }))).rejects.toThrow('the runner broke');

    expect(junitDirs).toHaveLength(1);
    const root = dirname(junitDirs[0] ?? '');
    expect(dirname(root)).toBe(tmpdir());
    // The control: the directory was there while the runner ran.
    expect(rootExistedDuringRun).toEqual([true]);
    expect(existsSync(root)).toBe(false);
  });
});

describe('judgeBugs over a removed trigger (#1521)', () => {
  /** The section a bug body gains when its trigger was removed. */
  const TRIGGER_SECTION = '## Trigger removed\n\nthe sideEffects field, removed in #1214';

  it('leaves a passing bug whose body holds no Trigger removed section unmarked gone', async () => {
    const judged = await judgeBugs([bug(20, `bun test ${TEST_FILE}`)], options());

    expect(judged.rows[0]).toMatchObject({ issue: 20, verdict: 'gone' });
    expect(judged.rows[0]).not.toHaveProperty('triggerRemoved');
  });

  it('marks a passing bug whose body holds the section, appended below an update, gone with triggerRemoved', async () => {
    const plain = bug(21, `bun test ${TEST_FILE}`);
    // The body ends with a section the judge does not read, as a filed record's `Versions` does.
    const appended = { ...plain, body: `${plain.body}\n## Versions\n\nrafa 1.2.3\n\n**Updated 2026-11-08, trigger:**\n\n${TRIGGER_SECTION}\n` };

    const judged = await judgeBugs([appended], options());

    expect(judged.rows[0]).toMatchObject({ issue: 21, verdict: 'gone', triggerRemoved: true });
  });

  it('leaves a reproducing bug whose body holds the section unmarked', async () => {
    const runner = plantedRunner({ verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 0 });
    const plain = bug(22, `bun test ${TEST_FILE}`);

    const judged = await judgeBugs([{ ...plain, body: `${plain.body}\n\n${TRIGGER_SECTION}\n` }], options({ recheck: runner.recheck }));

    expect(judged.rows[0]).toMatchObject({ issue: 22, verdict: 'reproduces' });
    expect(judged.rows[0]).not.toHaveProperty('triggerRemoved');
  });
});
