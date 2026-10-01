/**
 * Tests for `rafa roadmap` (`./roadmap.ts`) wired to the relationships
 * mode `board.relationships` names (`./issue/list.ts`, "The
 * relationships mode"), dispatched over a planted project and a fake
 * `gh` that records every call.
 *
 * The board, on `acme/board`: Roadmap #1 names epic #100 and spec #50.
 * Epic #100 (`horizon:now`) lists #101 then #102 in its checklist, while
 * GitHub holds its sub-issues as #102 then #101 and counts 1 of 3 done.
 * #101 is closed; #102 is open, waits on #20 (open) and on
 * `other/lib#7` (closed) through its `blockedBy` nodes, and carries a
 * `Blocked by: #21` line naming the closed #21. Both members carry
 * `epic:alpha`.
 *
 * ## The controls
 *
 * Every native case is paired with the same `gh` and board read with
 * `board.relationships` unset. There the epic counts its labelled
 * members, 1 of 2, walks them in checklist order, and #102's blocker is
 * the `Blocked by:` line's #21; no `gh repo view` is sent and the
 * listing asks for no native field. So a wiring that never handed the
 * relations on fails the native case, and one that read the repository
 * or the native fields in labels mode fails the control.
 */
import type { IssueSeams } from './issue/issue-tracker.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { ROADMAP_REFUSAL_EXIT } from '../board/roadmap.js';
import { dispatchInProject } from '../tests/cli-capture.js';

import { createIssueListCommand } from './issue/list.js';
import { createRoadmapCommand } from './roadmap.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-roadmap-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** How the recorded calls name the repository read. */
const REPO_CALL = 'repo view --json nameWithOwner';

/** A field only the native listing asks for. */
const NATIVE_FIELD = 'subIssuesSummary';

/** The config lines naming the native mode. */
const NATIVE = 'board:\n  relationships: native\n';

/** One issue as the board holds it. */
interface Row {
  readonly number: number;
  readonly title?: string;
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
  readonly parent?: number;
  readonly blockedBy?: readonly Node[];
  readonly subIssues?: readonly number[];
  readonly summary?: { readonly completed: number; readonly total: number };
}

/** A linked issue: its number, state, and repository when it is not {@link REPOSITORY}. */
interface Node {
  readonly number: number;
  readonly state: 'OPEN' | 'CLOSED';
  readonly repository?: string;
}

/** The board the module note describes. */
const ROWS: readonly Row[] = [
  { number: 1, title: 'Roadmap', body: '- [ ] #100 — alpha\n- [ ] #50 — a spec\n', labels: ['type:roadmap'] },
  {
    number: 100,
    title: 'Epic alpha',
    body: '## Acceptance criteria\n\n- it works\n\n- [ ] #101\n- [ ] #102\n',
    labels: ['type:epic', 'epic:alpha', 'horizon:now'],
    subIssues: [102, 101],
    summary: { completed: 1, total: 3 },
  },
  { number: 101, title: 'Alpha one', state: 'CLOSED', labels: ['spec:ready', 'epic:alpha'], parent: 100 },
  {
    number: 102,
    title: 'Alpha two',
    body: 'Blocked by: #21\n',
    labels: ['spec:ready', 'epic:alpha'],
    parent: 100,
    blockedBy: [{ number: 20, state: 'OPEN' }, { number: 7, state: 'CLOSED', repository: 'other/lib' }],
  },
  { number: 20, title: 'The open blocker' },
  { number: 21, title: 'The closed line blocker', state: 'CLOSED' },
  { number: 50, title: 'A spec', labels: ['spec:ready'] },
];

/** `row`'s state as the board holds it. */
function stateOf(number: number): 'OPEN' | 'CLOSED' {
  return ROWS.find((row) => row.number === number)?.state ?? 'OPEN';
}

/** A linked issue as `gh issue list --json` answers it. */
function nodeOf(node: Node): Record<string, unknown> {
  const repository = node.repository ?? REPOSITORY;
  return {
    id: `I_${repository}_${String(node.number)}`,
    number: node.number,
    state: node.state,
    title: `Issue ${String(node.number)}`,
    url: `https://github.com/${repository}/issues/${String(node.number)}`,
  };
}

/** The links a list holds, as the listing answers them. */
function links(nodes: readonly Node[]): Record<string, unknown> {
  return { nodes: nodes.map(nodeOf), totalCount: nodes.length };
}

/** A row as `gh issue view` and the labels listing answer it. */
function viewed(row: Row): Record<string, unknown> {
  return {
    number: row.number,
    title: row.title ?? `Issue ${String(row.number)}`,
    body: row.body ?? '',
    state: row.state ?? 'OPEN',
    stateReason: row.state === 'CLOSED'
      ? 'COMPLETED'
      : '',
    labels: (row.labels ?? []).map((name) => ({ name })),
    author: { login: 'maintainer' },
  };
}

/** A row as the listing answers it: with the native fields only when `native` asked for them. */
function listed(row: Row, native: boolean): Record<string, unknown> {
  if (!native) return viewed(row);
  const summary = row.summary ?? { completed: 0, total: 0 };
  return {
    ...viewed(row),
    parent: row.parent === undefined
      ? null
      : nodeOf({ number: row.parent, state: stateOf(row.parent) }),
    blockedBy: links(row.blockedBy ?? []),
    blocking: links([]),
    subIssuesSummary: { ...summary, percentCompleted: 0 },
    subIssues: links((row.subIssues ?? []).map((number) => ({ number, state: stateOf(number) }))),
  };
}

/** An answer `gh` wrote. */
function wrote(stdout: string): Promise<GhResult> {
  return Promise.resolve({ ok: true, stdout, stderr: '' });
}

/** A `gh` answering the board, recording each call into `calls`; `repo` is what `gh repo view` answers. */
function fakeGh(calls: string[], repo: GhResult = { ok: true, stdout: JSON.stringify({ nameWithOwner: REPOSITORY }), stderr: '' }): GhRunner {
  return (args) => {
    calls.push(args.join(' '));
    const route = args.slice(0, 2).join(' ');
    if (route === 'repo view') return Promise.resolve(repo);
    if (route === 'pr list') return wrote('[]');
    if (route === 'issue list' && args.includes('--label')) return wrote('[]');
    if (route === 'issue list') return wrote(JSON.stringify(ROWS.map((row) => listed(row, args.join(' ').includes(NATIVE_FIELD)))));
    if (route === 'issue view') {
      const row = ROWS.find((each) => each.number === Number(args[2]));
      if (row !== undefined) return wrote(JSON.stringify(viewed(row)));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `unexpected gh ${args.join(' ')}` });
  };
}

/** The seams every case reads through: `gh` recording into `calls`, no branch, no plan, no width. */
function seamsOver(calls: string[], repo?: GhResult): IssueSeams {
  return {
    gh: fakeGh(calls, repo),
    git: () => ({ ok: true, stdout: '', stderr: '' }),
    planNames: () => () => [],
    terminalWidth: () => undefined,
  };
}

/** How many projects the cases have planted. */
let planted = 0;

/** A project reading Roadmap #1, with `extra` appended to its config. */
function plantProject(extra = ''): { readonly root: string; readonly home: string } {
  planted += 1;
  const root = join(tempBase, `project-${String(planted)}`);
  const home = join(tempBase, `home-${String(planted)}`);
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), `roadmap:\n  issue: 1\n${extra}`, 'utf8');
  return { root, home };
}

/** Runs `rafa roadmap` with `flags` over `calls`' `gh`, in a project planted with `extra`. */
function roadmap(calls: string[], flags: readonly string[], extra: string, repo?: GhResult): ReturnType<typeof dispatchInProject> {
  return dispatchInProject(['roadmap', ...flags], [], [createRoadmapCommand(seamsOver(calls, repo))], plantProject(extra));
}

/** The line of `stdout` holding `text`, or the empty string. */
function lineWith(stdout: string, text: string): string {
  return stdout.split('\n').find((line) => line.includes(text)) ?? '';
}

/** The member rows `--full` printed, trimmed: every line from the first member to the blank line after them. */
function memberRows(stdout: string): readonly string[] {
  const lines = stdout.split('\n');
  const first = lines.findIndex((line) => /^\s+#10[12]\s/u.test(line));
  const end = lines.findIndex((line, index) => index > first && line.trim() === '');
  return lines.slice(first, end).map((line) => line.trim());
}

describe('rafa roadmap in native mode', () => {
  it('prints the epic\'s done/total from its sub-issues, reading the repository once and the native listing', async () => {
    const calls: string[] = [];

    const run = await roadmap(calls, [], NATIVE);

    expect(run.exitCode).toBe(0);
    expect(lineWith(run.stdout, 'Epic alpha')).toMatch(/^#100\s+in-progress\s+1\/3\s/u);
    expect(calls.filter((call) => call === REPO_CALL)).toHaveLength(1);
    expect(calls.indexOf(REPO_CALL)).toBe(0);
    expect(calls.filter((call) => call.startsWith('issue list --state all'))).toHaveLength(1);
    expect(calls.find((call) => call.startsWith('issue list --state all'))).toContain(NATIVE_FIELD);
  });

  it('counts the labelled members and sends no repository read or native field in labels mode, the control', async () => {
    const calls: string[] = [];

    const run = await roadmap(calls, [], '');

    expect(run.exitCode).toBe(0);
    expect(lineWith(run.stdout, 'Epic alpha')).toMatch(/^#100\s+in-progress\s+1\/2\s/u);
    expect(calls).not.toContain(REPO_CALL);
    expect(calls.join('\n')).not.toContain(NATIVE_FIELD);
  });

  it('prints --full members in sub-issue order, each open one\'s blockers off its blockedBy nodes', async () => {
    const calls: string[] = [];

    const run = await roadmap(calls, ['--full'], NATIVE);

    expect(run.exitCode).toBe(0);
    expect(memberRows(run.stdout)).toEqual([
      '#102  open    Alpha two',
      '└→ 🔴 #20 🟢 other/lib#7',
      '#101  closed  Alpha one',
    ]);
    expect(calls).not.toContain('issue view 20 --json number,title,body,state,labels,author');
  });

  it('prints --full members in checklist order with the Blocked by: line\'s blockers in labels mode, the control', async () => {
    const calls: string[] = [];

    const run = await roadmap(calls, ['--full'], '');

    expect(run.exitCode).toBe(0);
    expect(memberRows(run.stdout)).toEqual([
      '#101  closed  Alpha one',
      '#102  open    Alpha two',
      '└→ 🟢 #21',
    ]);
  });

  it('refuses as an unreadable roadmap when the repository cannot be read, listing nothing', async () => {
    const calls: string[] = [];
    const refused: GhResult = { ok: false, stdout: '', stderr: 'no repository here' };

    const run = await roadmap(calls, [], NATIVE, refused);

    expect(run.exitCode).toBe(ROADMAP_REFUSAL_EXIT);
    expect(run.stderr).toContain('Could not read the roadmap: gh repo view --json nameWithOwner failed: no repository here');
    expect(calls).toEqual([REPO_CALL]);
  });

  it('prints what rafa issue list --roadmap prints in native mode, byte for byte', async () => {
    const roadmapCalls: string[] = [];
    const listCalls: string[] = [];

    const viaRoadmap = await roadmap(roadmapCalls, ['--full'], NATIVE);
    const viaList = await dispatchInProject(
      ['issue', 'list', '--roadmap', '--full'],
      [{ name: 'issue', summary: 'issues' }],
      [createIssueListCommand(seamsOver(listCalls))],
      plantProject(NATIVE),
    );

    expect(viaList.exitCode).toBe(0);
    expect(viaList.stdout).toBe(viaRoadmap.stdout);
    expect(listCalls).toEqual(roadmapCalls);
  });
});
