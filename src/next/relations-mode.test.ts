/**
 * Tests for the relationships mode `rafa next` and a command's closing
 * hint read the board in (`./relations-mode.ts`), and for the two callers
 * wired to it: `runNext` (`src/commands/next.ts`), dispatched, and
 * `nextStepHint` (`./hint.ts`), run from a command dispatched in a
 * planted project.
 *
 * The board, on `acme/board`, a solo one with no epic: board #1 lists
 * #10 then #11, both `spec:ready`. #10 is blocked by #20, open, which the
 * roadmap does not list; #10 carries the `labels` marks too, `spec:blocked`
 * and a `Blocked by: #20` line, and the `blockedBy` node the native
 * listing answers.
 *
 * ## The controls
 *
 * Every native case is paired with the same `gh` and the same board read
 * with `board.relationships` unset: there the command stops at #10 and
 * proposes `unblock`, and sends no `gh repo view`. So a caller that never
 * handed the relations on (native reading as labels) fails the native
 * case, and one that read the repository in labels mode fails the labels
 * case.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { RafaCommand } from '../cli/command.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createNextCommand } from '../commands/next.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { dispatchInProject } from '../tests/cli-capture.js';

import { nextStepHint } from './hint.js';
import { DRY_RUN_FLAG } from './lines.js';
import { openNextRelations } from './relations-mode.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-relations-mode-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** The base branch the state table is read on. */
const BASE = 'main';

/** How the recorded calls name the board listing. */
const LISTING_CALL = 'issue list --state all';

/** How the recorded calls name the repository read. */
const REPO_CALL = 'repo view --json';

/** A GitHub remote, so `pr.provider` resolves to `gh`. */
const REMOTE = 'git@github.com:acme/board.git';

/** One issue as the board holds it. */
interface Row {
  readonly number: number;
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
  readonly blockedBy?: readonly number[];
}

/** The board the module note describes. */
const ROWS: readonly Row[] = [
  { number: 1, body: '- [ ] #10\n- [ ] #11', labels: ['type:roadmap'] },
  { number: 10, body: 'Blocked by: #20\n', labels: ['spec:ready', 'spec:blocked'], blockedBy: [20] },
  { number: 11, labels: ['spec:ready'] },
  { number: 20 },
];

/** An answer `gh` wrote. */
function wrote(stdout: string): Promise<GhResult> {
  return Promise.resolve({ ok: true, stdout, stderr: '' });
}

/** A linked issue as `gh issue list --json` answers it. */
function node(number: number): Record<string, unknown> {
  return {
    id: `I_node${String(number)}`,
    number,
    state: ROWS.find((row) => row.number === number)?.state ?? 'OPEN',
    title: `Issue ${String(number)}`,
    url: `https://github.com/${REPOSITORY}/issues/${String(number)}`,
  };
}

/** A row as `gh issue view` answers it. */
function viewed(row: Row): Record<string, unknown> {
  return {
    number: row.number,
    title: `Issue ${String(row.number)}`,
    body: row.body ?? '',
    state: row.state ?? 'OPEN',
    stateReason: '',
    labels: (row.labels ?? []).map((name) => ({ name })),
    author: { login: 'maintainer' },
  };
}

/** A row as the native listing answers it. */
function listed(row: Row): Record<string, unknown> {
  const blockedBy = (row.blockedBy ?? []).map(node);
  return {
    ...viewed(row),
    parent: null,
    blockedBy: { nodes: blockedBy, totalCount: blockedBy.length },
    blocking: { nodes: [], totalCount: 0 },
    subIssuesSummary: { completed: 0, percentCompleted: 0, total: 0 },
    subIssues: { nodes: [], totalCount: 0 },
  };
}

/** What a fake `gh` recorded, and how many runners were opened over it. */
interface GhLog {
  readonly calls: string[];
  opened: number;
}

/** A `gh` answering the board, recording each call; `repo` is what `gh repo view` answers. */
function fakeGh(log: GhLog, repo: GhResult = { ok: true, stdout: JSON.stringify({ nameWithOwner: REPOSITORY }), stderr: '' }): GhRunner {
  return (args) => {
    const route = args.slice(0, 2).join(' ');
    const listing = route === 'issue list' && args.includes('--state') && args.includes('all');
    log.calls.push(listing
      ? LISTING_CALL
      : args.slice(0, 3).join(' '));
    if (route === 'repo view') return Promise.resolve(repo);
    if (listing) return wrote(JSON.stringify(ROWS.map(listed)));
    if (route === 'issue list' || route === 'pr list') return wrote('[]');
    if (route === 'issue view') {
      const number = Number(args[2]);
      return wrote(JSON.stringify(viewed(ROWS.find((row) => row.number === number) ?? { number })));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}` });
  };
}

/** Git on a clean base level with its remote, holding no branch. */
const GIT: GitRunner = (args): GitResult => {
  const answers: Readonly<Record<string, string>> = {
    'rev-parse --abbrev-ref HEAD': `${BASE}\n`,
    [`rev-list --left-right --count ${BASE}...origin/${BASE}`]: '0\t0\n',
  };
  return { ok: true, stdout: answers[args.join(' ')] ?? '', stderr: '' };
};

/** The seams every case reads the board through, `gh` recording into `log`. */
function seamsOver(log: GhLog, repo?: GhResult): {
  readonly openGh: (root: string) => GhRunner;
  readonly openGit: () => GitRunner;
  readonly readRemote: () => string;
  readonly pullRequests: () => ReturnType<typeof createPullRequestsDouble>['pulls'];
} {
  return {
    openGh: () => {
      log.opened += 1;
      return fakeGh(log, repo);
    },
    openGit: () => GIT,
    readRemote: () => REMOTE,
    pullRequests: () => createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
  };
}

/** How many projects the cases have planted. */
let planted = 0;

/** A project reading board #1, with `extra` appended to its config. */
function plantProject(extra = ''): { readonly root: string; readonly home: string } {
  planted += 1;
  const root = join(tempBase, `project-${String(planted)}`);
  const home = join(tempBase, `home-${String(planted)}`);
  mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), `pr:\n  base: ${BASE}\nroadmap:\n  issue: 1\n${extra}`, 'utf8');
  return { root, home };
}

/** The config lines naming the native mode. */
const NATIVE = 'board:\n  relationships: native\n';

/** A fresh log. */
function newLog(): GhLog {
  return { calls: [], opened: 0 };
}

/** The proposal lines a dispatched run printed. */
function proposals(stdout: string): readonly string[] {
  return stdout.split('\n').filter((line) => line.startsWith('👉'));
}

/** A command that answers what `openNextRelations` read, as the dispatcher hands it a project. */
function relationsProbe(log: GhLog, seen: { mode: string | null }, repo?: GhResult): RafaCommand {
  return {
    name: 'probe',
    subject: 'probe',
    action: 'probe',
    summary: 'reads the relationships mode',
    description: 'Reads the relationships mode.',
    args: [],
    flags: [],
    examples: [{ cmd: 'rafa probe', note: 'reads the relationships mode' }],
    outputs: ['text'],
    run: async (context) => {
      const relations = await openNextRelations(context, seamsOver(log, repo));
      seen.mode = relations?.mode ?? null;
    },
  };
}

/** A command ending with the hint, over `log`'s `gh`, with no terminal. */
function hintProbe(log: GhLog, lines: string[]): RafaCommand {
  return {
    name: 'probe',
    subject: 'probe',
    action: 'probe',
    summary: 'ends with the hint',
    description: 'Ends with the hint.',
    args: [],
    flags: [],
    examples: [{ cmd: 'rafa probe', note: 'ends with the hint' }],
    outputs: ['text'],
    run: async (context) => {
      const hint = await nextStepHint(context, { ...seamsOver(log), isTerminal: () => false });
      lines.push(hint?.line ?? '(none)');
    },
  };
}

describe('openNextRelations', () => {
  it('answers the native adapter in native mode, having sent one repository read and nothing else', async () => {
    const log = newLog();
    const seen = { mode: null as string | null };

    const run = await dispatchInProject(['probe'], [], [relationsProbe(log, seen)], plantProject(NATIVE));

    expect(run.exitCode).toBe(0);
    expect(seen.mode).toBe('native');
    expect(log.calls).toEqual([REPO_CALL]);
  });

  it('answers nothing in labels mode, opening no gh at all, the control', async () => {
    const log = newLog();
    const seen = { mode: 'unset' as string | null };

    const run = await dispatchInProject(['probe'], [], [relationsProbe(log, seen)], plantProject());

    expect(run.exitCode).toBe(0);
    expect(seen.mode).toBeNull();
    expect([log.opened, log.calls.length]).toEqual([0, 0]);
  });

  it('answers nothing for a config that cannot be used, leaving the refusal to openNextSources', async () => {
    const log = newLog();
    const seen = { mode: 'unset' as string | null };

    await dispatchInProject(['probe'], [], [relationsProbe(log, seen)], plantProject('board:\n  relationships: sideways\n'));

    expect(seen.mode).toBeNull();
    expect(log.opened).toBe(0);
  });

  it('fails with the gh message when the repository cannot be read', async () => {
    const log = newLog();
    const seen = { mode: 'unset' as string | null };
    const refused: GhResult = { ok: false, stdout: '', stderr: 'no repository here' };

    const run = await dispatchInProject(['probe'], [], [relationsProbe(log, seen, refused)], plantProject(NATIVE));

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain('no repository here');
    expect(seen.mode).toBe('unset');
  });
});

describe('rafa next --dry-run in each mode', () => {
  it('passes #10 while #20 is open and proposes #11 in native mode, reading the repository once', async () => {
    const log = newLog();
    const command = createNextCommand({ ...seamsOver(log), isTerminal: () => false });

    const run = await dispatchInProject(['next', `--${DRY_RUN_FLAG}`], [], [command], plantProject(NATIVE));

    expect(run.exitCode).toBe(0);
    expect(proposals(run.stdout)).toEqual(['👉 create the plan for #11 — rafa plan create --next']);
    expect(log.calls.filter((call) => call === REPO_CALL)).toHaveLength(1);
    expect(log.calls).toContain(LISTING_CALL);
    expect(log.calls).not.toContain('issue view 20');
  });

  it('proposes unblocking #10 in labels mode and sends no repository read, the control', async () => {
    const log = newLog();
    const command = createNextCommand({ ...seamsOver(log), isTerminal: () => false });

    const run = await dispatchInProject(['next', `--${DRY_RUN_FLAG}`], [], [command], plantProject());

    expect(run.exitCode).toBe(0);
    expect(proposals(run.stdout)[0]).toContain('#10');
    expect(log.calls).not.toContain(REPO_CALL);
    expect(log.calls).not.toContain(LISTING_CALL);
    expect(log.calls).toContain('issue view 20');
  });
});

describe('the hint in each mode', () => {
  it('names planning #11 in native mode, reading the repository once', async () => {
    const log = newLog();
    const lines: string[] = [];

    await dispatchInProject(['probe'], [], [hintProbe(log, lines)], plantProject(NATIVE));

    expect(lines).toEqual(['👉 Next: create the plan for #11 — rafa plan create --next']);
    expect(log.calls.filter((call) => call === REPO_CALL)).toHaveLength(1);
  });

  it('names #10 in labels mode and sends no repository read, the control', async () => {
    const log = newLog();
    const lines: string[] = [];

    await dispatchInProject(['probe'], [], [hintProbe(log, lines)], plantProject());

    expect(lines[0]).toContain('#10');
    expect(log.calls).not.toContain(REPO_CALL);
  });
});
