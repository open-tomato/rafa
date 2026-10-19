/**
 * Tests for `rafa switch` (`./switch.ts`) wired to the relationships
 * mode `board.relationships` names ("The relationships mode"),
 * dispatched over a planted project and a fake `gh` that records every
 * call. The `labels` cases stay in `./switch.test.ts`.
 *
 * The board, on `acme/board`: Roadmap #1 names epic #200, then epic
 * #100, both `horizon:now`.
 *
 *  - Epic #200 carries no `epic:` label on any issue; GitHub holds its
 *    two sub-issues, #201 and #202, both closed, and counts 2 of 2 done.
 *  - Epic #100's members #101 (closed) and #102 (open) carry
 *    `epic:alpha` and are its sub-issues; GitHub counts 1 of 3 done, one
 *    sub-issue past the listing.
 *
 * ## The controls
 *
 * Each native case is paired with the same `gh` and board read with
 * `board.relationships` unset. There #200 has no labelled member, reads
 * `empty` and so not done, and a switch to board #1 stops at it; #100
 * counts its two labelled members, 1 of 2; and no `gh repo view` is
 * sent. So a wiring that never handed the relations on fails the native
 * case, and one that read the repository in labels mode fails the
 * control.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { dispatchInProject } from '../tests/cli-capture.js';

import { createSwitchCommand, SWITCH_REFUSAL_EXIT } from './switch.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-switch-native-')));

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
  readonly subIssues?: readonly number[];
  readonly summary?: { readonly completed: number; readonly total: number };
}

/** An epic body: acceptance criteria and a checklist naming `members`. */
function epicBody(members: readonly number[]): string {
  return `## Acceptance criteria\n\n- it works\n\n${members.map((member) => `- [ ] #${String(member)}`).join('\n')}\n`;
}

/** The board the module note describes. */
const ROWS: readonly Row[] = [
  { number: 1, title: 'Roadmap', body: '- [ ] #200 — omega\n- [ ] #100 — alpha\n', labels: ['type:roadmap'] },
  {
    number: 200,
    title: 'Epic omega',
    body: epicBody([201, 202]),
    labels: ['type:epic', 'horizon:now'],
    subIssues: [201, 202],
    summary: { completed: 2, total: 2 },
  },
  { number: 201, state: 'CLOSED', parent: 200 },
  { number: 202, state: 'CLOSED', parent: 200 },
  {
    number: 100,
    title: 'Epic alpha',
    body: epicBody([101, 102]),
    labels: ['type:epic', 'epic:alpha', 'horizon:now'],
    subIssues: [101, 102],
    summary: { completed: 1, total: 3 },
  },
  { number: 101, state: 'CLOSED', labels: ['epic:alpha'], parent: 100 },
  { number: 102, labels: ['epic:alpha'], parent: 100 },
];

/** `number`'s state as the board holds it. */
function stateOf(number: number): 'OPEN' | 'CLOSED' {
  return ROWS.find((row) => row.number === number)?.state ?? 'OPEN';
}

/** A linked issue on {@link REPOSITORY} as `gh issue list --json` answers it. */
function nodeOf(number: number): Record<string, unknown> {
  return {
    id: `I_${String(number)}`,
    number,
    state: stateOf(number),
    title: `Issue ${String(number)}`,
    url: `https://github.com/${REPOSITORY}/issues/${String(number)}`,
  };
}

/** The links a list holds, as the listing answers them. */
function links(numbers: readonly number[]): Record<string, unknown> {
  return { nodes: numbers.map(nodeOf), totalCount: numbers.length };
}

/** A row as the listing answers it: with the native fields only when `native` asked for them. */
function listed(row: Row, native: boolean): Record<string, unknown> {
  const plain = {
    number: row.number,
    title: row.title ?? `Issue ${String(row.number)}`,
    body: row.body ?? '',
    state: row.state ?? 'OPEN',
    stateReason: row.state === 'CLOSED'
      ? 'COMPLETED'
      : '',
    labels: (row.labels ?? []).map((name) => ({ name })),
  };
  if (!native) return plain;
  return {
    ...plain,
    parent: row.parent === undefined
      ? null
      : nodeOf(row.parent),
    blockedBy: links([]),
    blocking: links([]),
    subIssuesSummary: { ...row.summary ?? { completed: 0, total: 0 }, percentCompleted: 0 },
    subIssues: links(row.subIssues ?? []),
  };
}

/** A `gh` answering the board, recording each call into `calls`; `repo` is what `gh repo view` answers. */
function fakeGh(calls: string[], repo: GhResult = { ok: true, stdout: JSON.stringify({ nameWithOwner: REPOSITORY }), stderr: '' }): GhRunner {
  return (args) => {
    calls.push(args.join(' '));
    const route = args.slice(0, 2).join(' ');
    if (route === 'repo view') return Promise.resolve(repo);
    if (route === 'issue list' && args.includes('all')) {
      const native = args.join(' ').includes(NATIVE_FIELD);
      return Promise.resolve({ ok: true, stdout: JSON.stringify(ROWS.map((row) => listed(row, native))), stderr: '' });
    }
    if (route === 'issue list' && args.includes('--search')) {
      return Promise.resolve({ ok: true, stdout: JSON.stringify([{ number: 1, title: 'Roadmap' }]), stderr: '' });
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `unexpected gh ${args.join(' ')}` });
  };
}

/** How many projects the cases have planted. */
let planted = 0;

/** A project whose default board is #1, with `extra` appended to its config. */
function plantProject(extra = ''): { readonly root: string; readonly home: string } {
  planted += 1;
  const root = join(tempBase, `project-${String(planted)}`);
  const home = join(tempBase, `home-${String(planted)}`);
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), `roadmap:\n  issue: 1\n${extra}`, 'utf8');
  return { root, home };
}

/** Runs `rafa switch <target>` over `calls`' `gh`, in a project planted with `extra`. */
function switchTo(target: string, calls: string[], extra: string, repo?: GhResult): ReturnType<typeof dispatchInProject> {
  return dispatchInProject(['switch', target], [], [createSwitchCommand({ gh: fakeGh(calls, repo) })], plantProject(extra));
}

describe('rafa switch in native mode', () => {
  it('names an epic\'s done/total from its sub-issues, reading the repository once, before the native listing', async () => {
    const calls: string[] = [];

    const run = await switchTo('100', calls, NATIVE);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('board #1 · epic #100 Epic alpha (now) · 1/3 done\n');
    expect(calls.filter((call) => call === REPO_CALL)).toHaveLength(1);
    expect(calls.indexOf(REPO_CALL)).toBe(0);
    expect(calls.filter((call) => call.includes(NATIVE_FIELD))).toHaveLength(1);
  });

  it('counts the labelled members and sends no repository read in labels mode, the control', async () => {
    const calls: string[] = [];

    const run = await switchTo('100', calls, '');

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('board #1 · epic #100 Epic alpha (now) · 1/2 done\n');
    expect(calls).not.toContain(REPO_CALL);
    expect(calls.join('\n')).not.toContain(NATIVE_FIELD);
  });

  it('moves to a board at its first now epic whose sub-issues are not all done', async () => {
    const calls: string[] = [];

    const run = await switchTo('1', calls, NATIVE);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('board #1 · epic #100 Epic alpha (now) · 1/3 done\n');
  });

  it('stops at the epic with no labelled member in labels mode, which reads empty and not done, the control', async () => {
    const calls: string[] = [];

    const run = await switchTo('1', calls, '');

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('board #1 · epic #200 Epic omega (now) · 0/0 done\n');
  });

  it('refuses with the switch refusal when the repository cannot be read, listing nothing', async () => {
    const calls: string[] = [];
    const refused: GhResult = { ok: false, stdout: '', stderr: 'no repository here' };

    const run = await switchTo('100', calls, NATIVE, refused);

    expect(run.exitCode).toBe(SWITCH_REFUSAL_EXIT);
    expect(run.stderr).toContain('Could not read the board, so no target can be checked: gh repo view --json nameWithOwner failed: no repository here');
    expect(calls).toEqual([REPO_CALL]);
  });
});
