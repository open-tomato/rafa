/**
 * Tests for the board side of `plan create` (`src/board/plan-spec.ts`):
 * the seams it builds, the three checks it runs on an issue as read in
 * the order it runs them, and the gate issue it answers beside the
 * spec.
 *
 * `./spec-source.test.ts` drives the routes themselves over planted
 * readers, and this file drives none of that again. It exists for the
 * WIRING, which nothing else can see: that the issue arrives through
 * `gh issue view` with the field list `./issue.ts` declares, that the
 * roadmap walk reaches `gh pr list` and `git`, that the three checks
 * run BEFORE a snapshot is written and in the order that decides which
 * sentence a body failing two of them is refused with, and that the
 * spec route asks `gh` nothing at all.
 *
 * Every case plants a `gh` runner and a `git` runner of its own, so
 * nothing spawns and no case reaches GitHub or reads the configuration
 * `gh` keeps under the home. Each writes under a temporary directory of
 * its own, with `specs.dir` relative as a project configures it, so a
 * resolution that reached a real `.rafa/specs` would find nothing and
 * redden.
 *
 * Every planted issue carries {@link completeBody}, the shared filled
 * body of `../tests/spec-bodies.ts`, because `requireCompleteSpec` is
 * wired into `inspectSpecIssue` and an issue carrying less is refused
 * before the wiring a case is about is ever reached. A case that means
 * to break one thing says which body it plants instead.
 *
 * ## What passes while wrong
 *
 * A check that ran AFTER the write would refuse with the same exit code
 * and the same sentence, and only the disk can tell the two apart. So
 * each refusal case asserts the snapshot is absent, beside a control in
 * which the same call writes it.
 *
 * Two mutations were driven on 2026-09-20, the module restored from a
 * scratch copy and verified with `shasum -c` each time, against 12 pass
 * and 0 fail either side:
 *
 *  - the `inspect` seam left unfilled in `resolvePlanSpec`, so no check
 *    runs on a resolution at all: 7 pass and 5 fail, every case that
 *    reaches a refusal THROUGH a route — the label one, the leak one
 *    and all three completeness ones. The two cases that call
 *    `inspectSpecIssue` directly stay green, which is the point of
 *    having both kinds.
 *  - the `requireCompleteSpec` call alone dropped from
 *    `inspectSpecIssue`: 8 pass and 4 fail, the completeness group and
 *    the ordering case whose control reaches the completeness sentence,
 *    and nothing else — which is what says the other eight do not lean
 *    on the new check.
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
import { completeSpecBody } from '../tests/spec-bodies.js';

import { ISSUE_VIEW_FIELDS, SPEC_LABEL } from './issue.js';
import { LEAK_REFUSAL_EXIT } from './leak.js';
import { specPath } from './naming.js';
import { BOARD_REFUSAL_EXIT, inspectSpecIssue, resolvePlanSpec } from './plan-spec.js';
import { SPEC_READY_LABEL, specReadyRefusalMessage, TEMPLATE_HEADINGS } from './readiness.js';
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

/** The filled body a planted issue carries; `../tests/spec-bodies.ts` holds why it is shared. */
function completeBody(number: number): string {
  return completeSpecBody(`Issue ${String(number)}`);
}

/** The body an issue opened before `src/board/templates/spec.md` carries: no heading the template names. */
function templatelessBody(number: number): string {
  return `# Issue ${String(number)}\n\nThe body.\n`;
}

/** A planted issue: the five fields, labelled ready and complete unless a case says otherwise. */
function issueOf(number: number, fields: Partial<SpecIssue> = {}): SpecIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: completeBody(number),
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

/** What a case varies about one resolution. */
interface PlanSpecFields {
  readonly refresh?: boolean;
  readonly dryRun?: boolean;
  readonly roadmapIssue?: number | null;
}

/** What {@link resolvePlanSpec} is asked for one planted board. */
function ask(
  request: Parameters<typeof resolvePlanSpec>[0]['request'],
  gh: GhRunner,
  git: GitRunner,
  fields: PlanSpecFields = {},
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
    expect(readFileSync(join(root, snapshotAt(20)), 'utf8')).toBe(completeBody(20));
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
    const leaking = issueOf(20, { body: `${completeBody(20)}\nRun it in /Users/ada/checkouts/rafa.\n` });
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

describe('the checks one issue passes, in the order they run', () => {
  it('weighs the label first, so an issue failing all three is named unready', async () => {
    const all = issueOf(20, { labels: [SPEC_LABEL], body: 'Run it in /Users/ada/checkouts/rafa.\n' });

    const refused = await refusal(() => inspectSpecIssue(all));

    expect(refused.message).toBe(specReadyRefusalMessage(20));
  });

  it('weighs the leak before the completeness gaps, so a labelled leaking body is named for the leak', async () => {
    const leaking = issueOf(20, { body: 'Run it in /Users/ada/checkouts/rafa.\n' });

    const refused = await refusal(() => inspectSpecIssue(leaking));

    expect(refused.exitCode).toBe(LEAK_REFUSAL_EXIT);
    expect(refused.message).toContain('issue #20 names a machine path or a credential');
    // The control: the same body with the path taken out reaches the
    // completeness check, which names the headings it does not carry.
    const clean = issueOf(20, { body: 'Run it in the checkout.\n' });
    expect((await refusal(() => inspectSpecIssue(clean))).message)
      .toContain('issue #20 is not ready to plan from');
  });

  it('lets an issue that is labelled, leaks nothing and fills the template through', async () => {
    await expect(inspectSpecIssue(issueOf(20))).resolves.toBeUndefined();
  });
});

describe('the completeness refusal', () => {
  it('refuses an issue the template predates, naming every heading, before anything is written', async () => {
    const board = plantedGh([issueOf(20, { body: templatelessBody(20) })]);
    const git = plantedGit();

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, git.git));

    expect(refused.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refused.message).toContain('issue #20 is not ready to plan from');
    for (const heading of TEMPLATE_HEADINGS) expect(refused.message).toContain(`"${heading}" is missing`);
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
    // The control: the same call over the filled body writes the snapshot.
    await ask({ kind: 'issue', issue: 20 }, plantedGh([issueOf(20)]).gh, git.git);
    expect(existsSync(join(root, snapshotAt(20)))).toBe(true);
  });

  it('refuses a body filling every heading whose "Definition of done" holds no list item', async () => {
    const filled = completeBody(20);
    const heading = '## Definition of done';
    const prose = `${filled.slice(0, filled.indexOf(heading))}${heading}\n\nThis is done once the tests pass.\n`;
    const board = plantedGh([issueOf(20, { body: prose })]);

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, plantedGit().git));

    expect(refused.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refused.message).toContain('"Definition of done" holds no list item');
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });

  it('stops the --next walk at a line whose issue is incomplete, rather than skipping ahead', async () => {
    const board = plantedGh([
      issueOf(ROADMAP, { body: ROADMAP_BODY, labels: [] }),
      issueOf(17, { state: 'CLOSED' }),
      issueOf(20, { body: templatelessBody(20) }),
    ]);

    const refused = await refusal(() => ask({ kind: 'next', roadmap: null }, board.gh, plantedGit().git, { roadmapIssue: ROADMAP }));

    expect(refused.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refused.message).toContain('issue #20 is not ready to plan from');
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });
});
