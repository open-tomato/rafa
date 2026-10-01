/**
 * Tests for the relationships mode `plan create --next` walks in
 * (`./plan-spec.ts`, "The relationships mode `--next` walks in"):
 * `resolvePlanSpec` handed `relationships`, over a fake `gh` that records
 * every call. The `labels` cases stay in `./plan-spec.test.ts`.
 *
 * The board, on `acme/board`: Roadmap #31 names #20, then #21, both
 * ready. #20 waits on #40, open, through its `blockedBy` node alone: it
 * carries no `spec:blocked` label and no `Blocked by:` line.
 *
 * ## The controls
 *
 * The native `--next` case is paired with the same `gh` and board read
 * with `relationships` left out, and with it set to `labels`: there #20
 * reads as waiting on nothing, is picked, and the `--dry-run` stops on
 * it; no `gh repo view` is sent and the listing asks for no native field.
 * So a resolution that never handed the relations to the walk plans #20
 * in native mode, and one that read the repository in labels mode fails
 * the control. `--issue=<n>` in native mode is the second control: it
 * walks no roadmap, so it reads no repository.
 */
import type { SpecIssue } from './issue.js';
import type { PlanSpecOptions } from './plan-spec.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BoardRelationshipMode } from '../config-sections.js';
import type { GitRunner } from '../pr/git.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { sinkOutput } from '../tests/output-sinks.js';
import { completeSpecBody } from '../tests/spec-bodies.js';

import { SPEC_LABEL } from './issue.js';
import { resolvePlanSpec } from './plan-spec.js';
import { SPEC_READY_LABEL } from './readiness.js';

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** The roadmap issue every case is configured with. */
const ROADMAP = 31;

/** How the recorded calls name the repository read. */
const REPO_CALL = 'repo view --json nameWithOwner';

/** A field only the native listing asks for. */
const NATIVE_FIELD = 'subIssuesSummary';

/** Where one case writes. */
let root = '';

/** Every root this file made, removed at the end. */
const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-plan-spec-native-'));
  roots.push(root);
});

afterAll(() => {
  for (const made of roots) rmSync(made, { recursive: true, force: true });
});

/** A planted issue, ready and complete unless `fields` says otherwise. */
function issueOf(number: number, fields: Partial<SpecIssue> = {}): SpecIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: completeSpecBody(`Issue ${String(number)}`),
    state: 'OPEN',
    labels: [SPEC_LABEL, SPEC_READY_LABEL],
    author: 'octocat',
    ...fields,
  };
}

/** The board the module note describes. */
const ISSUES: readonly SpecIssue[] = [
  issueOf(ROADMAP, { title: 'Roadmap', body: '## Next, in order\n\n- [ ] #20 — blocked\n- [ ] #21 — ready\n', labels: [] }),
  issueOf(20),
  issueOf(21),
  issueOf(40),
];

/** What blocks each issue, by number, through its `blockedBy` nodes. */
const BLOCKED_BY: ReadonlyMap<number, readonly number[]> = new Map([[20, [40]]]);

/** A linked issue on {@link REPOSITORY} as `gh issue list --json` answers it. */
function nodeOf(number: number): Record<string, unknown> {
  return {
    id: `I_${String(number)}`,
    number,
    state: ISSUES.find((issue) => issue.number === number)?.state ?? 'OPEN',
    title: `Issue ${String(number)}`,
    url: `https://github.com/${REPOSITORY}/issues/${String(number)}`,
  };
}

/** The links a list holds, as the listing answers them. */
function links(numbers: readonly number[]): Record<string, unknown> {
  return { nodes: numbers.map(nodeOf), totalCount: numbers.length };
}

/** An issue as `gh issue view` answers it. */
function viewed(issue: SpecIssue): Record<string, unknown> {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: issue.labels.map((name) => ({ name })),
    author: { login: issue.author },
  };
}

/** An issue as the listing answers it: with the native fields only when `native` asked for them. */
function listed(issue: SpecIssue, native: boolean): Record<string, unknown> {
  const plain = { ...viewed(issue), stateReason: '' };
  if (!native) return plain;
  return {
    ...plain,
    parent: null,
    blockedBy: links(BLOCKED_BY.get(issue.number) ?? []),
    blocking: links([]),
    subIssuesSummary: { completed: 0, percentCompleted: 0, total: 0 },
    subIssues: links([]),
  };
}

/** An answer `gh` wrote. */
function wrote(stdout: string): Promise<GhResult> {
  return Promise.resolve({ ok: true, stdout, stderr: '' });
}

/** A `gh` answering the board, recording each call into `calls`. */
function fakeGh(calls: string[]): GhRunner {
  return (args) => {
    calls.push(args.join(' '));
    const route = args.slice(0, 2).join(' ');
    if (route === 'repo view') return wrote(JSON.stringify({ nameWithOwner: REPOSITORY }));
    if (route === 'pr list') return wrote('[]');
    if (route === 'issue list' && args.includes('--label')) return wrote('[]');
    if (route === 'issue list' && args.includes('--search')) return wrote(JSON.stringify([{ number: ROADMAP, title: 'Roadmap' }]));
    if (route === 'issue list') {
      const native = args.join(' ').includes(NATIVE_FIELD);
      return wrote(JSON.stringify(ISSUES.map((issue) => listed(issue, native))));
    }
    if (args[0] === 'api') return wrote(JSON.stringify({ permission: 'admin', role_name: 'admin' }));
    const found = ISSUES.find((issue) => String(issue.number) === args[2]);
    if (route === 'issue view' && found !== undefined) return wrote(JSON.stringify(viewed(found)));
    return Promise.resolve({ ok: false, stdout: '', stderr: `unexpected gh ${args.join(' ')}` });
  };
}

/** A `git` holding no branch, its `origin` on {@link REPOSITORY}. */
const GIT: GitRunner = (args) => ({
  ok: true,
  stdout: args.join(' ') === 'remote get-url origin'
    ? `git@github.com:${REPOSITORY}.git\n`
    : '',
  stderr: '',
});

/** A `--dry-run` resolution of `request` over `calls`' `gh`, in `relationships` mode or with the key left out. */
function resolve(
  request: PlanSpecOptions['request'],
  calls: string[],
  relationships?: BoardRelationshipMode,
): ReturnType<typeof resolvePlanSpec> {
  return resolvePlanSpec({
    request,
    refresh: false,
    dryRun: true,
    repoRoot: root,
    specsDir: '.rafa/specs',
    roadmapIssue: ROADMAP,
    trustedAuthors: [],
    findSpec: (spec) => spec,
    gh: fakeGh(calls),
    git: GIT,
    output: sinkOutput({}),
    ...relationships === undefined
      ? {}
      : { relationships },
  });
}

describe('plan create --next in native mode', () => {
  it('holds #20 back on its open blockedBy node, reading the repository once before the native listing', async () => {
    const calls: string[] = [];

    const resolved = await resolve({ kind: 'next', roadmap: null }, calls, 'native');

    expect(resolved).toEqual({ outcome: 'stopped', reason: 'blocked' });
    expect(calls.filter((call) => call === REPO_CALL)).toHaveLength(1);
    expect(calls.indexOf(REPO_CALL)).toBe(0);
    expect(calls.filter((call) => call.includes(NATIVE_FIELD))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith('issue view 40'))).toEqual([]);
  });

  it('picks #20 and stops on the dry run in labels mode, sending no repository read, the control', async () => {
    for (const relationships of [undefined, 'labels'] as const) {
      const calls: string[] = [];

      const resolved = await resolve({ kind: 'next', roadmap: null }, calls, relationships);

      expect(resolved).toEqual({ outcome: 'stopped', reason: 'dry-run' });
      expect(calls).not.toContain(REPO_CALL);
      expect(calls.join('\n')).not.toContain(NATIVE_FIELD);
      expect(calls).toContain('issue view 20 --json number,title,body,state,labels,author');
    }
  });

  it('reads no repository for --issue, which walks no roadmap, the second control', async () => {
    const calls: string[] = [];

    const resolved = await resolve({ kind: 'issue', issue: 21 }, calls, 'native');

    expect(resolved).toEqual({ outcome: 'stopped', reason: 'dry-run' });
    expect(calls).not.toContain(REPO_CALL);
  });
});
