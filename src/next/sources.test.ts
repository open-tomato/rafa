/**
 * Tests for the composition (`./sources.ts`): the four settings it reads
 * off one config, the seams every reading arrives through, the refusal a
 * repository without a `gh` provider gets, and the three board readings
 * over one `gh` runner.
 *
 * `./state.test.ts` drives the table over fakes and `./readings.test.ts`
 * the readings themselves; what only this file can see is the WIRING —
 * that `pr.base` and not something else answers the base, that the
 * plans directory is `plan.dir` resolved, that the board sends the `gh`
 * commands `plan create --next` sends, and that one issue is read once
 * however many rows ask about it.
 *
 * Every case plants a project of its own under this file's temporary
 * directory and drives a recording `gh` runner and a recording git
 * runner, so nothing here spawns `gh`, spawns git or reaches GitHub. The
 * two recordings are what the cases about the memo and about the
 * roadmap's own commands read.
 *
 * ## The controls
 *
 * Four readings here would pass while wrong, and each is paired:
 *
 *  - The base off `pr.base` is read beside a config that sets none,
 *    which must answer {@link DEFAULT_BASE_BRANCH}. A composition that
 *    ignored the setting would pass the second half alone.
 *  - The plans directory off `plan.dir` is read beside a config that
 *    sets none, which must answer `.rafa/plans`.
 *  - The provider refusal is read beside a remote that IS a GitHub one,
 *    which must compose sources rather than throw.
 *  - The memo is read as a COUNT of `gh issue view` calls beside the
 *    count a second board makes for the same two questions, so a memo
 *    that stopped working changes a number and not an answer.
 *
 * ## What passes while wrong
 *
 * Three mutations of `./sources.ts` were driven on 2026-09-22, one at a
 * time, over `env -u CLAUDECODE bun test src/commands/next.test.ts
 * src/next/`, the module restored from a scratch copy and verified with
 * `shasum -c` each time, against 179 pass and 0 fail either side:
 *
 *  - `pr.base` ignored, the base always {@link DEFAULT_BASE_BRANCH}:
 *    178 pass and 1 fail, the base case alone. Every other case runs on
 *    a project whose base IS `main`, which is what the pair is for.
 *  - the issue memo dropped: 177 pass and 2 fail, the two cases that
 *    count `gh issue view` calls. Every answer is unchanged, so only a
 *    count can see it.
 *  - `requireGhProvider` dropped, a repository with no GitHub remote
 *    composing sources anyway: 178 pass and 1 fail, the provider case
 *    alone.
 */
import type { NextSources } from './readings.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { GitResult, GitRunner, PullRequests } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { createCommandRegistry } from '../cli/registry.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { resolveScope } from '../project/scope.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { DEFAULT_BASE_BRANCH, ghNextBoard, openNextSources } from './sources.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-sources-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The roadmap issue every board case walks. */
const ROADMAP = 31;

/** The issue its first unticked line names. */
const ISSUE = 64;

/** A remote `resolvePrProvider` reads as a GitHub one. */
const GITHUB_REMOTE = 'git@github.com:open-tomato/rafa.git';

/** How many projects this file has planted. */
let planted = 0;

/** A project of its own, holding `.rafa/config.yaml` written with `config`. */
function plantProject(config: string): { readonly root: string; readonly home: string } {
  planted += 1;
  const root = join(tempBase, `project-${planted}`);
  const home = join(tempBase, `home-${planted}`);
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), config, 'utf8');
  return { root, home };
}

/** What git answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** What `gh` answered when it worked. */
function wrote(stdout: string): Promise<GhResult> {
  return Promise.resolve({ ok: true, stdout, stderr: '' });
}

/** A recording git runner answering nothing in particular. */
function recordingGit(): { readonly git: GitRunner; readonly calls: () => readonly string[] } {
  const calls: string[] = [];
  return {
    git: (args) => {
      calls.push(args.join(' '));
      return said('');
    },
    calls: () => calls,
  };
}

/** A context over a planted project, with `seams` reaching nothing real. */
function contextFor(root: string, home: string, warnings: string[] = []): RafaContext {
  const scope = resolveScope(root, { home });
  if (!scope.found) throw new Error(`the planted project did not resolve: ${scope.hint}`);
  const commands: readonly RafaCommand[] = [];
  return Object.freeze({
    args: [],
    flags: {},
    outputMode: 'text',
    verbosity: 2,
    output: sinkOutput({ warn: (line: string) => warnings.push(line) }),
    signal: new AbortController().signal,
    env: {},
    argv: [],
    registry: createCommandRegistry({ subjects: [], commands }),
    project: scope,
  });
}

/** The sources composed for a project holding `config`, over seams that reach nothing real. */
function sourcesFor(config: string, over: Partial<Parameters<typeof openNextSources>[1]> = {}): NextSources {
  const { root, home } = plantProject(config);
  return openNextSources(contextFor(root, home), {
    readRemote: () => GITHUB_REMOTE,
    openGh: () => (): Promise<GhResult> => wrote('[]'),
    openGit: () => (): GitResult => said(''),
    pullRequests: () => createPullRequestsDouble({}).pulls,
    ...over,
  });
}

/** A body naming one unticked roadmap line. */
const ROADMAP_BODY = ['# Roadmap', '', '- [x] #12 done already', `- [ ] #${ISSUE} the next one`, ''].join('\n');

/** One issue as `gh issue view` answers it. */
function issuePayload(number: number, over: Partial<{ body: string; state: string; labels: readonly string[] }> = {}): string {
  return JSON.stringify({
    number,
    title: `Issue ${number}`,
    body: over.body ?? '',
    state: over.state ?? 'OPEN',
    labels: (over.labels ?? []).map((name) => ({ name })),
    author: { login: 'maintainer' },
  });
}

/** What a board case's `gh` holds. */
interface FakeBoard {
  /** The bodies, labels and states of the issues it answers, by number. */
  readonly issues?: Readonly<Record<string, { body?: string; state?: string; labels?: readonly string[] }>>;
  /** The candidates the roadmap search answers. */
  readonly search?: readonly { readonly number: number; readonly title: string }[];
}

/** A `gh` runner over `board`, and the commands it was handed. */
function fakeGh(board: FakeBoard): { readonly gh: GhRunner; readonly calls: () => readonly string[] } {
  const calls: string[] = [];
  return {
    gh: (args) => {
      calls.push(args.slice(0, 3).join(' '));
      const route = args.slice(0, 2).join(' ');
      if (route === 'issue list') return wrote(JSON.stringify(board.search ?? []));
      if (route === 'pr list') return wrote('[]');
      if (route === 'issue view') {
        const number = Number(args[2]);
        const held = board.issues?.[String(number)];
        if (held === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: `no issue ${number}` });
        return wrote(issuePayload(number, held));
      }
      return Promise.resolve({ ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}` });
    },
    calls: () => calls,
  };
}

describe('the sources one answer is read over', () => {
  it('reads the base off pr.base, and main where the config names none', () => {
    const named = sourcesFor('pr:\n  base: trunk\n');
    const silent = sourcesFor('plan:\n  dir: .rafa/plans\n');

    expect([named.base, silent.base]).toEqual(['trunk', DEFAULT_BASE_BRANCH]);
    expect(silent.base).toBe('main');
  });

  it('reads the plans directory off plan.dir, in both spellings, and .rafa/plans where the config names none', () => {
    const named = sourcesFor('plan:\n  dir: docs/plans\n');
    const silent = sourcesFor('pr:\n  base: main\n');

    expect(named.plans.label).toBe('docs/plans');
    expect(named.plans.path.endsWith(join('docs', 'plans'))).toBe(true);
    expect(silent.plans.label).toBe(join('.rafa', 'plans'));
  });

  it('reads the session records under the project root, with the pid probe it is handed', () => {
    const { root, home } = plantProject('pr:\n  base: main\n');
    mkdirSync(join(root, '.rafa', 'runs'), { recursive: true });
    writeFileSync(join(root, '.rafa', 'runs', '20260922-090000-abcd.json'), JSON.stringify({
      sessionId: '20260922-090000-abcd',
      planStub: 'rafa-63-one-command-next-step',
      plan: '.rafa/plans/PLAN-rafa-63-one-command-next-step.md',
      branch: 'feat/rafa-63-one-command-next-step',
      pid: 4242,
      startedAt: '2026-09-22T09:00:00Z',
      state: 'running',
      task: null,
    }), 'utf8');
    const sources = openNextSources(contextFor(root, home), {
      readRemote: () => GITHUB_REMOTE,
      isAlive: () => false,
    });

    const records = sources.runs();

    expect(records.map((record) => [record.sessionId, record.state])).toEqual([['20260922-090000-abcd', 'stopped']]);
  });

  it('takes git, gh and the provider from the seams, each made for the project root', () => {
    const { root, home } = plantProject('pr:\n  base: main\n');
    const roots: string[] = [];
    const pulls: PullRequests = createPullRequestsDouble({}).pulls;
    const sources = openNextSources(contextFor(root, home), {
      readRemote: () => GITHUB_REMOTE,
      openGh: (dir) => {
        roots.push(`gh:${dir}`);
        return (): Promise<GhResult> => wrote('[]');
      },
      openGit: (dir) => {
        roots.push(`git:${dir}`);
        return (): GitResult => said('');
      },
      pullRequests: (dir) => {
        roots.push(`pulls:${dir}`);
        return pulls;
      },
    });

    expect(roots).toEqual([`git:${root}`, `gh:${root}`, `pulls:${root}`]);
    expect(sources.pulls).toBe(pulls);
  });

  it('refuses a repository whose provider is not gh with exit 2, and composes over one that is', () => {
    const composed = sourcesFor('pr:\n  base: main\n', { readRemote: () => GITHUB_REMOTE });
    let refused: CommandExit | null = null;
    try {
      sourcesFor('pr:\n  base: main\n', { readRemote: () => 'git@gitlab.com:someone/else.git' });
    } catch (error) {
      refused = error instanceof CommandExit
        ? error
        : null;
    }

    expect(composed.base).toBe('main');
    expect(refused?.exitCode).toBe(2);
    expect(refused?.message).toContain('pr.provider');
  });

  it('refuses a config that cannot be used with exit 1, naming rafa next', () => {
    const { root, home } = plantProject('plan:\n  dir: 12\n');
    let refused: CommandExit | null = null;

    try {
      openNextSources(contextFor(root, home), { readRemote: () => GITHUB_REMOTE });
    } catch (error) {
      refused = error instanceof CommandExit
        ? error
        : null;
    }

    expect(refused?.exitCode).toBe(1);
    expect(refused?.message).toContain('rafa next: the config cannot be used');
  });

  it('reads nothing off git, the board or the provider until a row asks', () => {
    const { root, home } = plantProject('pr:\n  base: main\n');
    const git = recordingGit();
    const gh = fakeGh({});

    openNextSources(contextFor(root, home), {
      readRemote: () => GITHUB_REMOTE,
      openGit: () => git.git,
      openGh: () => gh.gh,
    });

    expect([git.calls(), gh.calls()]).toEqual([[], []]);
  });
});

describe('the board the roadmap rows are read through', () => {
  it('walks the roadmap through the commands plan create --next sends, and answers the line it picked', async () => {
    const gh = fakeGh({
      search: [{ number: ROADMAP, title: 'Roadmap' }],
      issues: { [ROADMAP]: { body: ROADMAP_BODY }, [ISSUE]: {} },
    });
    const git = recordingGit();
    const board = ghNextBoard({ gh: gh.gh, git: git.git, configured: null });

    const reading = await board.next();

    expect([reading.roadmap, reading.line?.issue, reading.passed]).toEqual([ROADMAP, ISSUE, 1]);
    expect(gh.calls()).toEqual([
      'issue list --state',
      `issue view ${ROADMAP}`,
      `issue view ${ISSUE}`,
      'pr list --state',
    ]);
    expect(git.calls()).toEqual([
      'for-each-ref --format=%(refname) refs/heads refs/remotes',
      'ls-remote --heads origin',
    ]);
  });

  it('sends no search where roadmap.issue names the issue', async () => {
    const gh = fakeGh({ issues: { [ROADMAP]: { body: ROADMAP_BODY }, [ISSUE]: {} } });
    const board = ghNextBoard({ gh: gh.gh, git: recordingGit().git, configured: ROADMAP });

    const reading = await board.next();

    expect(reading.roadmap).toBe(ROADMAP);
    expect(gh.calls().filter((call) => call.startsWith('issue list'))).toEqual([]);
  });

  it('carries a branch scan that failed as a problem rather than throwing', async () => {
    const gh = fakeGh({ issues: { [ROADMAP]: { body: ROADMAP_BODY }, [ISSUE]: {} } });
    const board = ghNextBoard({
      gh: gh.gh,
      git: (args) => (args[0] === 'ls-remote'
        ? { ok: false, stdout: '', stderr: 'no network' }
        : said('')),
      configured: ROADMAP,
    });

    const reading = await board.next();

    expect(reading.line?.issue).toBe(ISSUE);
    expect(reading.problems.join('\n')).toContain('no network');
  });

  it('answers whether a line carries spec:ready, and why it waits, off one read of its issue', async () => {
    const gh = fakeGh({
      issues: {
        [ISSUE]: { labels: ['spec:ready', 'spec:blocked'], body: 'Blocked by: #24' },
        24: { state: 'OPEN' },
      },
    });
    const board = ghNextBoard({ gh: gh.gh, git: recordingGit().git, configured: ROADMAP });

    const ready = await board.isReady(ISSUE);
    const blocked = await board.blocking(ISSUE);

    expect([ready, blocked?.open]).toEqual([true, [24]]);
    expect(gh.calls()).toEqual([`issue view ${ISSUE}`, 'issue view 24']);
  });

  it('reads the picked line issue once for the walk and both readings over it', async () => {
    const gh = fakeGh({
      search: [{ number: ROADMAP, title: 'Roadmap' }],
      issues: { [ROADMAP]: { body: `- [ ] #${ISSUE} the next one\n` }, [ISSUE]: { labels: ['spec:ready'] } },
    });
    const board = ghNextBoard({ gh: gh.gh, git: recordingGit().git, configured: ROADMAP });

    await board.next();
    await board.isReady(ISSUE);
    await board.blocking(ISSUE);

    expect(gh.calls().filter((call) => call === `issue view ${ISSUE}`)).toEqual([`issue view ${ISSUE}`]);
  });

  it('answers no blocked line for a line that carries no spec:blocked label', async () => {
    const gh = fakeGh({ issues: { [ISSUE]: { labels: ['spec:ready'], body: 'Blocked by: #24' } } });
    const board = ghNextBoard({ gh: gh.gh, git: recordingGit().git, configured: ROADMAP });

    expect(await board.blocking(ISSUE)).toBeNull();
  });
});
