/**
 * Tests for the board side of `plan create` (`src/board/plan-spec.ts`):
 * the seams it builds, the two checks it runs on an issue as read, and
 * the gate issue it answers beside the spec.
 *
 * `./spec-source.test.ts` drives the routes themselves over planted
 * readers, and this file drives none of that again. It exists for the
 * WIRING, which nothing else can see: that the issue arrives through
 * `gh issue view` with the field list `./issue.ts` declares, that the
 * roadmap walk reaches `gh pr list` and `git`, that the label check and
 * the leak refusal run BEFORE a snapshot is written, and that the spec
 * route asks `gh` nothing at all.
 *
 * Every case plants a `gh` runner and a `git` runner of its own, so
 * nothing spawns and no case reaches GitHub or reads the configuration
 * `gh` keeps under the home. Each writes under a temporary directory of
 * its own, with `specs.dir` relative as a project configures it, so a
 * resolution that reached a real `.rafa/specs` would find nothing and
 * redden.
 *
 * ## What passes while wrong
 *
 * A check that ran AFTER the write would refuse with the same exit code
 * and the same sentence, and only the disk can tell the two apart. So
 * each refusal case asserts the snapshot is absent, beside a control in
 * which the same call writes it.
 *
 * One mutation was driven on 2026-09-19, the module restored from a
 * scratch copy and verified with `shasum -c`: the `inspect` seam left
 * unfilled, so the checks never run, left 6 pass and 2 fail against 8
 * pass either side — the label refusal and the leak refusal, and nothing
 * else, since no other case turns on them.
 */
import type { SpecIssue } from './issue.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { GitRunner } from '../pr/git.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { ISSUE_VIEW_FIELDS, SPEC_LABEL } from './issue.js';
import { LEAK_REFUSAL_EXIT } from './leak.js';
import { specPath } from './naming.js';
import { BOARD_REFUSAL_EXIT, inspectSpecIssue, resolvePlanSpec } from './plan-spec.js';
import { SPEC_READY_LABEL, specReadyRefusalMessage } from './readiness.js';
import { PR_LIST_FIELDS } from './roadmap.js';

/** Where snapshots go, as a project configures it. */
const SPECS_DIR = '.rafa/specs';

/** The roadmap issue every `--next` case here is configured with. */
const ROADMAP = 31;

/** A roadmap body whose first undone line is issue 20. */
const ROADMAP_BODY = ['## Next, in order', '', '- [x] #17 — done', '- [ ] #20 — the pull request commands', ''].join('\n');

/** Where one case writes. */
let root = '';

/** Every root this file made, removed at the end. */
const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-plan-spec-'));
  roots.push(root);
});

afterAll(() => {
  for (const made of roots) rmSync(made, { recursive: true, force: true });
});

/** A planted issue: the five fields, labelled ready unless a case says otherwise. */
function issueOf(number: number, fields: Partial<SpecIssue> = {}): SpecIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: `# Issue ${String(number)}\n\nThe body.\n`,
    state: 'OPEN',
    labels: [SPEC_LABEL, SPEC_READY_LABEL],
    ...fields,
  };
}

/** What a `gh` answer holds. */
function said(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A `gh` runner over planted issues, keeping every command it was sent. */
function plantedGh(issues: readonly SpecIssue[]): { gh: GhRunner; sent: () => readonly string[] } {
  let sent: readonly string[] = [];
  const gh: GhRunner = (args) => {
    sent = [...sent, args.join(' ')];
    if (args[0] === 'pr' && args[1] === 'list') return Promise.resolve(said('[]'));
    if (args[0] === 'issue' && args[1] === 'list') {
      return Promise.resolve(said(JSON.stringify([{ number: ROADMAP, title: 'Roadmap' }])));
    }
    const found = issues.find((issue) => String(issue.number) === args[2]);
    if (args[0] !== 'issue' || args[1] !== 'view' || found === undefined) {
      return Promise.resolve({ ok: false, stdout: '', stderr: `no planted answer for ${args.join(' ')}` });
    }
    return Promise.resolve(said(JSON.stringify({
      number: found.number,
      title: found.title,
      body: found.body,
      state: found.state,
      labels: found.labels.map((name) => ({ name })),
    })));
  };
  return { gh, sent: () => sent };
}

/** A `git` runner answering no branch at all, keeping every command it was sent. */
function plantedGit(): { git: GitRunner; sent: () => readonly string[] } {
  let sent: readonly string[] = [];
  const git: GitRunner = (args) => {
    sent = [...sent, args.join(' ')];
    return { ok: true, stdout: '', stderr: '' };
  };
  return { git, sent: () => sent };
}

/** An output that keeps nothing; the lines are `./spec-source.test.ts`'s subject. */
const OUTPUT = sinkOutput({});

/** What {@link resolvePlanSpec} is asked for one planted board. */
function ask(
  request: Parameters<typeof resolvePlanSpec>[0]['request'],
  gh: GhRunner,
  git: GitRunner,
  fields: { readonly refresh?: boolean; readonly dryRun?: boolean; readonly roadmapIssue?: number | null } = {},
): ReturnType<typeof resolvePlanSpec> {
  return resolvePlanSpec({
    request,
    refresh: fields.refresh ?? false,
    dryRun: fields.dryRun ?? false,
    repoRoot: root,
    specsDir: SPECS_DIR,
    roadmapIssue: fields.roadmapIssue ?? null,
    findSpec: (spec) => spec,
    gh,
    git,
    output: OUTPUT,
  });
}

/** What a thrown `CommandExit` carried. */
async function refusal(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the call answered instead');
}

/** The snapshot path for a planted issue. */
function snapshotAt(issue: number): string {
  return specPath(SPECS_DIR, issue, `Issue ${String(issue)}`);
}

describe('the spec an issue is planned from', () => {
  it('is read with the field list the read declares, snapshotted, and answered with its gate issue', async () => {
    const board = plantedGh([issueOf(20)]);
    const git = plantedGit();

    const resolved = await ask({ kind: 'issue', issue: 20 }, board.gh, git.git);

    expect(board.sent()).toEqual([`issue view 20 --json ${ISSUE_VIEW_FIELDS}`]);
    expect(git.sent()).toEqual([]);
    if (resolved.outcome !== 'spec') throw new Error(`the resolution stopped: ${resolved.reason}`);
    expect(resolved.spec).toMatchObject({ kind: 'issue', issue: 20, path: snapshotAt(20), source: 'issue #20' });
    expect(resolved.gate?.number).toBe(20);
    expect(readFileSync(join(root, snapshotAt(20)), 'utf8')).toBe('# Issue 20\n\nThe body.\n');
  });

  it('asks gh nothing on the spec route, and answers no gate issue for it', async () => {
    const board = plantedGh([issueOf(20)]);
    const git = plantedGit();
    mkdirSync(join(root, SPECS_DIR), { recursive: true });

    const resolved = await ask({ kind: 'spec', spec: 'spec.md' }, board.gh, git.git);

    expect(board.sent()).toEqual([]);
    expect(git.sent()).toEqual([]);
    if (resolved.outcome !== 'spec') throw new Error(`the resolution stopped: ${resolved.reason}`);
    expect(resolved.spec).toMatchObject({ kind: 'spec', issue: null, path: 'spec.md' });
    expect(resolved.gate).toBeNull();
  });

  it('refuses an issue nobody marked ready, before anything is written', async () => {
    const board = plantedGh([issueOf(20, { labels: [SPEC_LABEL] })]);
    const git = plantedGit();

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, git.git));

    expect(refused.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refused.message).toBe(specReadyRefusalMessage(20));
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
    // The control: the same call writes the snapshot once the label is there.
    await ask({ kind: 'issue', issue: 20 }, plantedGh([issueOf(20)]).gh, git.git);
    expect(existsSync(join(root, snapshotAt(20)))).toBe(true);
  });

  it('refuses a body carrying a home path, leaving no copy of it on disk', async () => {
    const leaking = issueOf(20, { body: '# Issue 20\n\nRun it in /Users/ada/checkouts/rafa.\n' });
    const board = plantedGh([leaking]);
    const git = plantedGit();

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, git.git));

    expect(refused.exitCode).toBe(LEAK_REFUSAL_EXIT);
    expect(refused.message).toContain('issue #20 names a machine path or a credential');
    expect(refused.message).not.toContain('/Users/ada');
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });
});

describe('the spec the roadmap picks', () => {
  it('walks the configured roadmap through gh and git, and snapshots the line it picks', async () => {
    const board = plantedGh([issueOf(ROADMAP, { body: ROADMAP_BODY, labels: [] }), issueOf(17, { state: 'CLOSED' }), issueOf(20)]);
    const git = plantedGit();

    const resolved = await ask({ kind: 'next', roadmap: null }, board.gh, git.git, { roadmapIssue: ROADMAP });

    // The order is the measured one: the roadmap body, the line it picks,
    // and the open pull requests last, asked only once a line needs the reading.
    expect(board.sent()).toEqual([
      `issue view ${String(ROADMAP)} --json ${ISSUE_VIEW_FIELDS}`,
      `issue view 20 --json ${ISSUE_VIEW_FIELDS}`,
      `pr list --state open --json ${PR_LIST_FIELDS} --limit 100`,
    ]);
    expect(git.sent()).toEqual(['for-each-ref --format=%(refname) refs/heads refs/remotes', 'ls-remote --heads origin']);
    if (resolved.outcome !== 'spec') throw new Error(`the resolution stopped: ${resolved.reason}`);
    expect(resolved.spec).toMatchObject({ kind: 'next', issue: 20, path: snapshotAt(20) });
    expect(resolved.gate?.number).toBe(20);
  });

  it('writes nothing under --dry-run, and answers the reason it stopped', async () => {
    const board = plantedGh([issueOf(20)]);
    const git = plantedGit();

    const resolved = await ask({ kind: 'issue', issue: 20 }, board.gh, git.git, { dryRun: true });

    expect(resolved).toEqual({ outcome: 'stopped', reason: 'dry-run' });
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });
});

describe('the checks one issue passes', () => {
  it('weighs the label before the leak, so an unready leaking issue is named unready', async () => {
    const both = issueOf(20, { labels: [SPEC_LABEL], body: 'Run it in /Users/ada/checkouts/rafa.\n' });

    const refused = await refusal(() => inspectSpecIssue(both));

    expect(refused.message).toBe(specReadyRefusalMessage(20));
  });

  it('lets an issue that is labelled and carries no leak through', async () => {
    await expect(inspectSpecIssue(issueOf(20))).resolves.toBeUndefined();
  });
});
