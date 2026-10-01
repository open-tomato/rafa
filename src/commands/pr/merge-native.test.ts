/**
 * Tests for `rafa pr merge` under `board.relationships: native`
 * (`./merge.ts`, "Native mode"): the epic checklist tick left out, the
 * roadmap boards ticked as in `labels`, and in the unblock reading's
 * place the issues the merge freed, printed and never written to.
 *
 * Every case dispatches the real command from a project of its own
 * whose config names the mode (`tests/cli-capture.ts`), over a stub
 * provider, a planted git runner and an in-process `gh` runner recording
 * every argv. Nothing reaches GitHub or git.
 *
 * ## The controls
 *
 * The mode is the only thing a pair of cases changes, so each native
 * reading is held against the `labels` run over the same board and the
 * same body:
 *
 *  - The call list: native sends the repository read and the native
 *    listing and neither the epic tick's listing nor the blocked-issue
 *    listing; the labels run sends those two and not the others, so a
 *    recorder that saw nothing, or a mode that was never read, fails it.
 *  - The json result: the `freed` key is present in native and left out
 *    of labels, read with `Object.keys` since `toEqual` passes over an
 *    undefined-valued key.
 */
import type { MergeSeams } from './merge.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { CliEvent } from '../../ports/index.js';
import type { GitResult, GitRunner, PullRequestDetail } from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { BOARDS_LIST_ARGS } from '../../board/boards.js';
import { BOARD_LISTING_LIMIT, boardListingCommand } from '../../board/roadmap-board.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { INDENT } from './merge-cleanup.js';
import { freedHeaderLine } from './merge-freed.js';
import { createPrMergeCommand } from './merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** The roadmap issue the config names. */
const ROADMAP_ISSUE = 31;

/** The roadmap body before the tick. */
const ROADMAP_BODY = '- [ ] #20 sign-in\n';

/** A config naming the GitHub CLI and the roadmap, in `labels` mode. */
const LABELS_CONFIG = `pr:\n  provider: gh\nroadmap:\n  issue: ${String(ROADMAP_ISSUE)}\n`;

/** The same config in `native` mode. */
const NATIVE_CONFIG = `${LABELS_CONFIG}board:\n  relationships: native\n`;

const BRANCH = 'feat/rafa-20-sign-in';
const BASE = 'main';

/** The repository read, as the recorder spells it. */
const REPO_VIEW = 'repo view --json nameWithOwner';

/** The native listing the freed-issue reading sends. */
const NATIVE_LISTING = boardListingCommand(BOARD_LISTING_LIMIT, 'native').slice('gh '.length);

/** The labels listing the epic tick sends. */
const EPIC_LISTING = boardListingCommand(BOARD_LISTING_LIMIT).slice('gh '.length);

/** The blocked-issue listing the unblock reading sends. */
const BLOCKED_LISTING = `issue list --state open --label ${SPEC_BLOCKED_LABEL} --limit 100 --json number,body`;

/** The `type:roadmap` listing the boards tick sends. */
const BOARDS_LISTING = BOARDS_LIST_ARGS.join(' ');

/** The roadmap read and write the tick sends. */
const ROADMAP_READ = `api repos/{owner}/{repo}/issues/${String(ROADMAP_ISSUE)}`;
const ROADMAP_WRITE = `${ROADMAP_READ} -X PATCH -f body=- [x] #20 sign-in\n`;

/** A link node, as `gh` writes one. */
function node(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  return { number, title: `Issue ${String(number)}`, state, url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
}

/** A list of link nodes. */
function links(nodes: readonly object[]): object {
  return { nodes, totalCount: nodes.length };
}

/** One native listing row. */
function row(number: number, title: string, blockedBy: readonly object[] = [], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  return {
    number,
    title,
    body: '',
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: [],
    parent: null,
    blockedBy: links(blockedBy),
    blocking: links([]),
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: links([]),
  };
}

/** The board: #12 waits on #20 alone, #13 on #20 and an open #26. */
const LISTING: readonly object[] = [
  row(20, 'Sign-in', [], 'CLOSED'),
  row(26, 'Tokens'),
  row(12, 'Sign-in page', [node(20)]),
  row(13, 'Session store', [node(20), node(26)]),
];

/** A `gh` runner over the board, and every argv it was handed. */
interface FakeGh {
  readonly gh: (root: string) => GhRunner;
  readonly ran: () => readonly string[];
}

/** A runner answering every call either mode sends; `brokenListing` fails the native listing. */
function fakeGh(brokenListing = false): FakeGh {
  const ran: string[] = [];
  let roadmap = ROADMAP_BODY;
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
  const gh: GhRunner = (args) => {
    const line = args.join(' ');
    ran.push(line);
    if (line === REPO_VIEW) return ok(JSON.stringify({ nameWithOwner: REPOSITORY }));
    if (line === NATIVE_LISTING) {
      return brokenListing
        ? Promise.resolve({ ok: false, stdout: '', stderr: 'gh: HTTP 502' })
        : ok(JSON.stringify(LISTING));
    }
    if (line === EPIC_LISTING || line === BOARDS_LISTING || line === BLOCKED_LISTING) return ok('[]');
    if (line.startsWith(ROADMAP_READ)) {
      const sent = args.find((arg) => arg.startsWith('body='));
      if (sent !== undefined) roadmap = sent.slice('body='.length);
      return ok(JSON.stringify({ number: ROADMAP_ISSUE, body: roadmap }));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${line}` });
  };
  return { gh: () => gh, ran: () => [...ran] };
}

/** A pull request detail closing what `body` says. */
function detail(body: string): PullRequestDetail {
  return {
    number: 41,
    title: 'rafa-20: sign-in',
    url: 'https://github.com/acme/board/pull/41',
    state: 'open',
    headRefName: BRANCH,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-30T11:00:00Z',
    body,
    headRefOid: '1f0c2b7de6a94c1a0b5e3d2f4a6b8c0d1e2f3a4b',
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
  };
}

/** A git runner answering a clean tree, this checkout alone and the remote branch; `failing` fails one command. */
function fakeGit(root: string, failing: string | null = null): (root: string) => GitRunner {
  const answers: Readonly<Record<string, GitResult>> = {
    'worktree list --porcelain': { ok: true, stdout: `worktree ${root}\nbranch refs/heads/${BRANCH}\n\n`, stderr: '' },
    'rev-parse --show-toplevel': { ok: true, stdout: `${root}\n`, stderr: '' },
    [`ls-remote --heads origin ${BRANCH}`]: { ok: true, stdout: `1f0c2b7\trefs/heads/${BRANCH}\n`, stderr: '' },
  };
  return () => (args) => {
    const line = args.join(' ');
    if (line === failing) return { ok: false, stdout: '', stderr: 'fatal: no such branch' };
    return answers[line] ?? { ok: true, stdout: '', stderr: '' };
  };
}

/** A prompter recording each question and answering no. */
function recordingPrompter(): { readonly open: () => Prompter; readonly asked: () => readonly string[] } {
  const asked: string[] = [];
  return {
    open: () => ({
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve('n');
      },
      close: () => undefined,
    }),
    asked: () => [...asked],
  };
}

/** How a case is run. */
interface CaseOptions {
  readonly config: string;
  readonly body?: string;
  readonly json?: boolean;
  readonly brokenListing?: boolean;
  readonly failingGit?: string;
}

/** What a run left. */
interface Ran {
  readonly exitCode: number;
  readonly lines: readonly string[];
  readonly events: readonly CliEvent[];
  readonly gh: FakeGh;
  readonly asked: readonly string[];
}

/** Dispatches `rafa pr merge 41 --yes --no-hint` from a fresh project holding `options.config`. */
async function ran(options: CaseOptions): Promise<Ran> {
  const project: PlantedProject = plantProject(mkdtempSync(join(tempBase, 'case-')), options.config);
  const gh = fakeGh(options.brokenListing ?? false);
  const prompter = recordingPrompter();
  const pulls = createPullRequestsDouble({
    get: () => Promise.resolve(detail(options.body ?? 'Closes #20')),
    checks: () => Promise.resolve({ rows: [], verdict: 'green' }),
    merge: () => Promise.resolve({ merged: true, detail: 'Squashed and merged pull request #41' }),
  }, { refusal: 'the stub provider models get, checks and merge alone' });
  const seams: MergeSeams = {
    pullRequests: () => pulls.pulls,
    readBranch: () => BRANCH,
    readRemote: () => 'git@github.com:acme/board.git',
    git: fakeGit(project.root, options.failingGit ?? null),
    gh: gh.gh,
    isTerminal: () => true,
    openPrompter: prompter.open,
  };
  const words = ['pr', 'merge', '41', '--yes', '--no-hint', ...(options.json === true
    ? ['--output=json']
    : [])];
  const run = await dispatchInProject(words, SUBJECTS, [createPrMergeCommand(seams)], project);
  return {
    exitCode: run.exitCode,
    lines: run.stdout.split('\n').filter((line) => line !== ''),
    events: options.json === true
      ? eventsOf(run.stdout)
      : [],
    gh,
    asked: prompter.asked(),
  };
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): Record<string, unknown> {
  return (events.at(-1) as { data?: Record<string, unknown> }).data ?? {};
}

/** The index of `line` in `lines`, failing the case when it is not there. */
function at(lines: readonly string[], line: string): number {
  const found = lines.indexOf(line);
  if (found < 0) throw new Error(`the run wrote no "${line}" line: ${lines.join(' | ')}`);
  return found;
}

describe('the calls it sends after the merge', () => {
  it('in native mode: the boards tick, the repository and one native listing, and no epic tick or unblock listing', async () => {
    const run = await ran({ config: NATIVE_CONFIG });

    expect(run.exitCode).toBe(0);
    expect(run.gh.ran()).toEqual([BOARDS_LISTING, ROADMAP_READ, ROADMAP_WRITE, REPO_VIEW, NATIVE_LISTING]);
  });

  it('in labels mode, over the same board and body: the epic tick and the unblock listing, and no native read', async () => {
    const run = await ran({ config: LABELS_CONFIG });

    expect(run.exitCode).toBe(0);
    expect(run.gh.ran()).toEqual([EPIC_LISTING, BOARDS_LISTING, ROADMAP_READ, ROADMAP_WRITE, BLOCKED_LISTING]);
  });

  it('sends no call at all for a pull request closing no issue', async () => {
    const run = await ran({ config: NATIVE_CONFIG, body: 'Refactors the sign-in form.' });

    expect(run.exitCode).toBe(0);
    expect(run.gh.ran()).toEqual([]);
  });

  it('never reads the board when a clean-up step failed', async () => {
    const run = await ran({ config: NATIVE_CONFIG, failingGit: `switch ${BASE}` });

    expect(run.exitCode).toBe(1);
    expect(run.gh.ran()).not.toContain(REPO_VIEW);
    expect(run.gh.ran()).not.toContain(NATIVE_LISTING);
  });
});

describe('what it prints in native mode', () => {
  it('names the freed issue after the clean-up, asking nothing', async () => {
    const run = await ran({ config: NATIVE_CONFIG });

    expect(run.asked).toEqual([]);
    expect(at(run.lines, freedHeaderLine([20], 1))).toBeGreaterThan(at(run.lines, 'prune deleted remote branches: done'));
    expect(at(run.lines, `${INDENT}#12 Sign-in page`)).toBe(at(run.lines, freedHeaderLine([20], 1)) + 1);
    expect(run.lines.some((line) => line.includes('#13'))).toBe(false);
    expect(run.lines.some((line) => line.includes(SPEC_BLOCKED_LABEL))).toBe(false);
  });

  it('warns and keeps exit code 0 when the listing fails', async () => {
    const run = await ran({ config: NATIVE_CONFIG, brokenListing: true });

    expect(run.exitCode).toBe(0);
    expect(run.lines.filter((line) => line.startsWith('warn: the freed-issue reading did not run: '))).toHaveLength(1);
  });
});

describe('the json result', () => {
  it('carries freed in native mode, with unblocked null', async () => {
    const run = await ran({ config: NATIVE_CONFIG, json: true });
    const data = dataOf(run.events);

    expect(Object.keys(data)).toContain('freed');
    expect(data['unblocked']).toBeNull();
    expect(data['freed']).toEqual({
      relationships: 'native',
      closed: [20],
      freed: [{ number: 12, title: 'Sign-in page' }],
      problem: null,
    });
  });

  it('leaves the freed key out in labels mode', async () => {
    const run = await ran({ config: LABELS_CONFIG, json: true });
    const data = dataOf(run.events);

    expect(Object.keys(data)).toContain('unblocked');
    expect(Object.keys(data)).not.toContain('freed');
  });
});
