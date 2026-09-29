/**
 * Tests for the release guard's step in `rafa pr merge`
 * (`merge-guard.ts`), dispatched through the real command over a real
 * repository: a bare `origin.git` and a work tree under a HOME of this
 * file's own, git isolated from the operator's config as
 * `merge-driven.test.ts` isolates it. The provider is the one stub, and
 * it records whether `merge` was ever sent, so "refused and merged
 * nothing" is measured rather than read off a message.
 *
 * Each world carries a `package.json` at 0.24.0 and a `CHANGELOG.md`
 * with its section, so `release.enabled: auto` reads on; the one case
 * that leaves the changelog out is the control that the guard fetches
 * nothing and prints nothing where the release does not run, read off
 * the log of every git command the run sent.
 *
 * `merge.test.ts` is past 800 lines, so these cases live here, beside
 * the module they cover.
 */
import type { MergeSeams, PrMergeResult } from './merge.js';
import type { GitResult, GitRunner, PullRequestDetail } from '../../pr/index.js';
import type { PullRequestsDouble } from '../../pr/pull-requests-double.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { createPrMergeCommand } from './merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-guard-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** A config naming the GitHub CLI, so no origin remote needs probing. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** The base branch. */
const BASE = 'main';

/** The head branch, and its pull request. */
const BRANCH = 'feat/guarded';

/** The pull request number every case names. */
const NUMBER = 41;

/** The clock the forecast is dated by. */
const NOW = new Date('2026-09-29T12:00:00Z');

/** The fix line a stale or collision reading ends with. */
const FIX_LINE = `fix:    rafa pr triage ${NUMBER} --resolve`;

/** Typed by every case, so the ending hint reads nothing real. */
const NO_HINT = '--no-hint';

/** Runs real git in `cwd`, isolated under `home`. */
function git(cwd: string, home: string, ...args: readonly string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      LC_ALL: 'C',
    },
  });
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

/** Runs git and fails the case where it did not work. */
function must(cwd: string, home: string, ...args: readonly string[]): void {
  const result = git(cwd, home, ...args);
  expect([args.join(' '), result.ok, result.stderr]).toEqual([args.join(' '), true, result.stderr]);
}

/** A manifest declaring `version`. */
function manifest(version: string): string {
  return `{\n  "name": "demo",\n  "version": "${version}"\n}\n`;
}

/** A changelog with one section per `[version, note]`, newest first. */
function changelog(...sections: readonly (readonly [string, string])[]): string {
  return ['# Changelog', '', ...sections.flatMap(([version, note]) => [`## ${version} — 2026-09-28, a plan`, '', note, ''])]
    .join('\n');
}

/** A fragment's text. */
function fragment(plan: string, level: string, note: string): string {
  return ['---', `plan: ${plan}`, `title: ${plan} title`, `level: ${level}`, '---', '', note, ''].join('\n');
}

/** A repository this case owns. */
interface GuardRepo {
  readonly work: string;
  readonly home: string;
}

/** Writes `files` under `dir`, creating directories as it goes. */
function writeFiles(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text, 'utf8');
  }
}

/** Commits `files` on the branch checked out in `repo` and pushes it. */
function commitAndPush(repo: GuardRepo, branch: string, files: Readonly<Record<string, string>>): void {
  writeFiles(repo.work, files);
  must(repo.work, repo.home, 'add', '-A');
  must(repo.work, repo.home, 'commit', '-q', '-m', `on ${branch}`);
  must(repo.work, repo.home, 'push', '-q', '-u', 'origin', branch);
}

/** How a world is planted. */
interface WorldOptions {
  /** The files the head branch commits. */
  readonly branch: Readonly<Record<string, string>>;
  /** Files committed on the base after the branch forked, if any. */
  readonly baseAfter?: Readonly<Record<string, string>>;
  /** The config, {@link GH_CONFIG} and more. */
  readonly config?: string;
  /** False to leave `CHANGELOG.md` out, so `release.enabled: auto` reads off. */
  readonly changelog?: boolean;
}

/**
 * Plants the base at 0.24.0 with its section, forks {@link BRANCH} off
 * it with `options.branch`, lands `options.baseAfter` on the base, and
 * leaves the work tree on the base, clean.
 */
function plantWorld(options: WorldOptions): GuardRepo {
  const root = realpathSync(mkdtempSync(join(tempBase, 'repo-')));
  const repo = { work: join(root, 'work'), home: join(root, 'home') };
  const bare = join(root, 'origin.git');
  mkdirSync(repo.home, { recursive: true });
  must(root, repo.home, 'init', '-q', '--bare', `--initial-branch=${BASE}`, bare);
  must(root, repo.home, 'init', '-q', `--initial-branch=${BASE}`, repo.work);
  must(repo.work, repo.home, 'remote', 'add', 'origin', bare);
  const first: Record<string, string> = { '.gitignore': '.rafa/\n', 'package.json': manifest('0.24.0') };
  const withChangelog = options.changelog === false
    ? first
    : { ...first, 'CHANGELOG.md': changelog(['0.24.0', '- loop: the first note']) };
  commitAndPush(repo, BASE, withChangelog);
  must(repo.work, repo.home, 'switch', '-q', '-c', BRANCH);
  commitAndPush(repo, BRANCH, options.branch);
  must(repo.work, repo.home, 'switch', '-q', BASE);
  if (options.baseAfter !== undefined) commitAndPush(repo, BASE, options.baseAfter);
  plantProjectConfig(repo.work, options.config ?? GH_CONFIG);
  return repo;
}

/** A pull request detail for {@link BRANCH} into {@link BASE}. */
function detail(): PullRequestDetail {
  return {
    number: NUMBER,
    title: 'a guarded merge',
    url: `https://github.com/open-tomato/rafa/pull/${NUMBER}`,
    state: 'open',
    headRefName: BRANCH,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-18T11:00:00Z',
    body: '',
    headRefOid: '1f0c2b7de6a94c1a0b5e3d2f4a6b8c0d1e2f3a4b',
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
  };
}

/** A provider answering `get`, `checks` and `merge`, recording each. */
function stubPulls(): PullRequestsDouble {
  return createPullRequestsDouble({
    get: () => Promise.resolve(detail()),
    checks: () => Promise.resolve({ rows: [], verdict: 'green' as const }),
    merge: () => Promise.resolve({ merged: true, detail: 'Squashed and merged pull request' }),
  }, { refusal: 'the stub provider models get, checks and merge alone' });
}

/** One json-mode event, as far as these cases read it. */
interface ReadEvent {
  readonly type: string;
  readonly level?: string;
  readonly message?: string;
  readonly ok?: boolean;
  readonly data?: PrMergeResult;
  readonly error?: { readonly message: string };
}

/** What one run left, read off its json-mode events. */
interface GuardRun {
  readonly exitCode: number | null;
  /** Every `info` message, in order. */
  readonly printed: readonly string[];
  /** Every `warn` message, in order. */
  readonly warned: readonly string[];
  /** The refusal's message, or null for a run that ended 0. */
  readonly refusal: string | null;
  /** Every question asked, in order. */
  readonly asked: readonly string[];
  /** Every git command the run sent, the words after `git`. */
  readonly gitRan: readonly string[];
  /** The provider calls, e.g. `merge 41 squash`. */
  readonly sent: readonly string[];
  /** The json result's `guard`, when the run wrote one. */
  readonly guard: PrMergeResult['guard'] | undefined;
}

/** How a run is driven. */
interface RunOptions {
  /** The answers, one per question in order; a question past them gets null. */
  readonly answers?: readonly string[];
  /** False for a run with no terminal. */
  readonly terminal?: boolean;
}

/** Dispatches `rafa pr merge <n> ...words --output=json` over `repo`. */
async function ran(repo: GuardRepo, words: readonly string[], options: RunOptions = {}): Promise<GuardRun> {
  const asked: string[] = [];
  const gitRan: string[] = [];
  const answers = [...(options.answers ?? ['y'])];
  const stub = stubPulls();
  const runner = (root: string): GitRunner => (args) => {
    gitRan.push(args.join(' '));
    return git(root, repo.home, ...args);
  };
  const seams: MergeSeams = {
    pullRequests: () => stub.pulls,
    git: runner,
    isTerminal: () => options.terminal ?? true,
    now: () => NOW,
    openPrompter: () => ({
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve(answers.shift() ?? null);
      },
      close: () => undefined,
    }),
  };
  const project: PlantedProject = { root: repo.work, home: repo.home };
  const line = ['pr', 'merge', String(NUMBER), ...words, '--output=json', NO_HINT];
  const run = await dispatchInProject(line, SUBJECTS, [createPrMergeCommand(seams)], project);
  const events = eventsOf(run.stdout) as unknown as readonly ReadEvent[];
  const logged = (level: string): string[] => events
    .filter((event) => event.type === 'log' && event.level === level)
    .map((event) => event.message ?? '');
  const result = events.find((event) => event.type === 'result');
  // Json mode writes everything to stdout; a stderr line would be a leak.
  expect(run.stderr).toBe('');
  return {
    exitCode: run.exitCode,
    printed: logged('info'),
    warned: logged('warn'),
    refusal: result?.error?.message ?? null,
    asked,
    gitRan,
    sent: stub.sent(),
    guard: result?.data?.guard,
  };
}

/** The merge the stub records when the command sent one. */
const MERGE_SENT = `merge ${NUMBER} squash`;

/** A branch that changes source and adds its fragment. */
const CLEAN_BRANCH = {
  'src/a.ts': 'export const a = 1;\n',
  '.changes/rafa-1.md': fragment('rafa-1', 'minor', '- loop: a new thing'),
};

/** A branch that changes source and adds nothing else. */
const MISSING_BRANCH = { 'src/a.ts': 'export const a = 1;\n' };

/** A branch that stamps 0.25.0 itself, the way the old wrap-up did. */
const STAMPED_BRANCH = {
  'src/a.ts': 'export const a = 1;\n',
  'package.json': manifest('0.25.0'),
  'CHANGELOG.md': changelog(['0.25.0', '- loop: the branch note'], ['0.24.0', '- loop: the first note']),
};

/** The base releasing 0.25.0 with other notes after the branch forked: the 0.25.0 incident. */
const BASE_RELEASED = {
  'package.json': manifest('0.25.0'),
  'CHANGELOG.md': changelog(['0.25.0', '- loop: the base note'], ['0.24.0', '- loop: the first note']),
};

describe('a branch the guard reads clean', () => {
  it('prints the clean line and the forecast on stdout, merges, and carries the reading in the result', async () => {
    const repo = plantWorld({ branch: CLEAN_BRANCH });

    const run = await ran(repo, ['--yes']);

    expect([run.exitCode, run.warned]).toEqual([0, []]);
    expect(run.printed).toContain(`Release guard: clean — ${BRANCH} carries .changes/rafa-1.md`);
    expect(run.printed.filter((line) => line.startsWith('Release forecast:') && line.includes('0.25.0'))).toHaveLength(1);
    expect(run.sent).toContain(MERGE_SENT);
    expect(run.guard).toMatchObject({ answer: 'clean', reaction: 'print' });
    // Both fetches ran ahead of the merge's own clean-up.
    expect(run.gitRan.slice(3, 5)).toEqual([`fetch origin ${BASE}`, `fetch origin ${BRANCH}`]);
  });
});

describe('a branch the guard reads missing, as pr.versionCollision says', () => {
  it('warns and merges under the default, report', async () => {
    const repo = plantWorld({ branch: MISSING_BRANCH });

    const run = await ran(repo, ['--yes']);

    expect(run.exitCode).toBe(0);
    expect(run.warned[0]).toBe(`Release guard: missing — ${BRANCH} (pull request #${NUMBER}) changes 1 path`
      + ' outside the release fragments and carries no fragment');
    expect(run.sent).toContain(MERGE_SENT);
    expect(run.guard).toMatchObject({ answer: 'missing', reaction: 'report' });
  });

  it('says nothing and merges under allow, while the result still carries the answer', async () => {
    const repo = plantWorld({ branch: MISSING_BRANCH, config: `${GH_CONFIG}  versionCollision: allow\n` });

    const run = await ran(repo, ['--yes']);

    expect([run.exitCode, run.warned]).toEqual([0, []]);
    expect(run.printed.filter((line) => line.startsWith('Release '))).toEqual([]);
    expect(run.sent).toContain(MERGE_SENT);
    expect(run.guard).toMatchObject({ answer: 'missing', reaction: 'silent' });
  });

  it('refuses with exit 1 under refuse, naming the setting, asking nothing and merging nothing', async () => {
    const repo = plantWorld({ branch: MISSING_BRANCH, config: `${GH_CONFIG}  versionCollision: refuse\n` });

    const run = await ran(repo, ['--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.refusal?.split('\n')[0]).toBe(`❌ rafa pr merge refuses #${NUMBER}: its release guard reads missing,`
      + ' and pr.versionCollision is refuse.');
    expect(run.asked).toEqual([]);
    expect(run.sent).not.toContain(MERGE_SENT);
  });
});

describe('a branch the guard reads stale, under ask', () => {
  /** A config asking about missing and stale branches. */
  const ASK_CONFIG = `${GH_CONFIG}  versionCollision: ask\n`;

  it('asks its own question before the merge question, and a no merges nothing and ends 0', async () => {
    const repo = plantWorld({ branch: STAMPED_BRANCH, config: ASK_CONFIG });

    const run = await ran(repo, [], { answers: ['n'] });

    expect(run.exitCode).toBe(0);
    expect(run.asked).toEqual([`Merge #${NUMBER} with its release guard reading stale? [y/N] `]);
    expect(run.warned.at(-1)?.trim()).toBe(FIX_LINE);
    expect(run.printed).toEqual(['Nothing was merged.']);
    expect(run.sent).not.toContain(MERGE_SENT);
    expect(run.guard).toMatchObject({ answer: 'stale', reaction: 'ask' });
  });

  it('goes on to the merge question after a yes, and merges on a second yes', async () => {
    const repo = plantWorld({ branch: STAMPED_BRANCH, config: ASK_CONFIG });

    const run = await ran(repo, [], { answers: ['y', 'y'] });

    expect(run.exitCode).toBe(0);
    expect(run.asked).toEqual([`Merge #${NUMBER} with its release guard reading stale? [y/N] `, 'Merge? [y/N] ']);
    expect(run.sent).toContain(MERGE_SENT);
  });

  it('refuses without a terminal even under --yes, which does not answer it', async () => {
    const repo = plantWorld({ branch: STAMPED_BRANCH, config: ASK_CONFIG });

    const run = await ran(repo, ['--yes'], { terminal: false });

    expect(run.exitCode).toBe(1);
    expect(run.refusal).toContain('(pr.versionCollision is ask), and standard input is no terminal; --yes does not answer it.');
    expect(run.asked).toEqual([]);
    expect(run.sent).not.toContain(MERGE_SENT);
  });
});

describe('a branch the guard reads collision', () => {
  it('refuses whatever pr.versionCollision says, naming both sides and ending with the fix', async () => {
    const repo = plantWorld({
      branch: STAMPED_BRANCH,
      baseAfter: BASE_RELEASED,
      config: `${GH_CONFIG}  versionCollision: allow\n`,
    });

    const run = await ran(repo, ['--yes']);

    expect(run.exitCode).toBe(1);
    const lines = (run.refusal ?? '').split('\n');
    expect(lines).toContain(`❌ rafa pr merge refuses #${NUMBER}: its release guard reads collision,`
      + ' which only dangerous.acceptVersionCollision lets through.');
    expect(lines.some((line) => line.startsWith(`    branch: ${BRANCH} (pull request #${NUMBER}): package.json 0.25.0`))).toBe(true);
    expect(lines.some((line) => line.startsWith(`    base:   origin/${BASE}: package.json 0.25.0`))).toBe(true);
    expect(lines.at(-1)?.trim()).toBe(FIX_LINE);
    expect(run.sent).not.toContain(MERGE_SENT);
  });

  it('merges under dangerous.acceptVersionCollision, warning that the setting let it through', async () => {
    const repo = plantWorld({
      branch: STAMPED_BRANCH,
      baseAfter: BASE_RELEASED,
      config: `${GH_CONFIG}dangerous:\n  acceptVersionCollision: true\n`,
    });

    const run = await ran(repo, ['--yes']);

    expect(run.exitCode).toBe(0);
    expect(run.warned[0]?.startsWith('Release guard: collision')).toBe(true);
    expect(run.warned).toContain(`#${NUMBER} merges anyway: dangerous.acceptVersionCollision is true.`);
    expect(run.sent).toContain(MERGE_SENT);
    expect(run.guard).toMatchObject({ answer: 'collision', reaction: 'accept' });
  });
});

describe('where the release does not run', () => {
  it('fetches nothing, prints nothing and carries no reading, over the same branch that reads missing with it on', async () => {
    const repo = plantWorld({ branch: MISSING_BRANCH, changelog: false, config: `${GH_CONFIG}  versionCollision: refuse\n` });

    const run = await ran(repo, ['--yes']);

    expect([run.exitCode, run.warned]).toEqual([0, []]);
    expect(run.printed.filter((line) => line.startsWith('Release '))).toEqual([]);
    expect(run.gitRan.filter((line) => line.startsWith('fetch origin '))).toEqual([]);
    expect(run.guard).toBeNull();
    expect(run.sent).toContain(MERGE_SENT);
  });
});
