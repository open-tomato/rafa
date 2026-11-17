/**
 * Tests for `rafa issue comment <id> --body=<text> --upstream=rafa`
 * (`comment.ts`): the gate's refusals before any tracker, the redaction
 * of the checkout's path and of a named secret, the private-name rule
 * over the body, and the comment posted on a ref carrying the upstream
 * as its `repo`.
 *
 * Each case runs the command over a fixture project of its own under
 * this file's temporary directory: its `.rafa/config.yaml` planted by
 * the case, naming the `env` prerequisite {@link SECRET_NAME}, a
 * `package.json` naming the filing package {@link PACKAGE}, and an empty
 * home. Git is a seam answering no checkout of its own, so the project
 * root stands in. `gh` is a seam recording every call: it answers
 * `gh repo view --json nameWithOwner,visibility` as this board,
 * {@link OWN}, and hands every other call to the recorded fake
 * (`adapters/tracker/github-fake.ts`) holding the upstream,
 * {@link UPSTREAM}, with one issue planted, which refuses a `--repo`
 * naming another repository. The recorded calls are the control that a
 * refusal sent no `gh issue` or `gh label` call, and that a comment
 * named the upstream and never this board.
 *
 * Negative cases come first.
 */
import type { IssueCommentResult } from './comment.js';
import type { IssueSeams, LineFlags } from './issue-tracker.js';
import type { FakeGh } from '../../adapters/tracker/github-fake.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCommandRegistry } from '@open-tomato/rafa/cli/registry';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { scopeAt } from '@open-tomato/rafa/core/config';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';

import { createIssueCommentCommand, renderCommented } from './comment.js';
import { registerUpstreamTestAdapters } from './upstream-test-adapters.js';
import { PRIVATE_SIBLING } from './upstream-text.js';

/** The logger and trackers this file reads, registered when the package's own preload ran (#1586). */
let restoreAdapters: () => void = () => undefined;
beforeAll(() => {
  restoreAdapters = registerUpstreamTestAdapters();
});
afterAll(() => {
  restoreAdapters();
});

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-comment-upstream-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The upstream every config here names. */
const UPSTREAM = 'open-tomato/rafa';

/** This board, the commenting repository. */
const OWN = 'open-tomato/components';

/** The filing package, as its `package.json` names it. */
const PACKAGE = 'components-workspace';

/** The variable the config names as an `env` prerequisite, so its value is a secret. */
const SECRET_NAME = 'DEPLOY_TOKEN';

/** The secret's value, in the environment the command runs with. */
const SECRET_VALUE = 'tok-9f8e7d6c5b4a';

/** The prerequisite naming {@link SECRET_NAME}. */
const PREREQUISITES = `prerequisites:\n  required:\n    - env: ${SECRET_NAME}\n`;

/** A config naming {@link UPSTREAM} under `collaborate.rafa`, and the secret. */
const COLLABORATE_CONFIG = `collaborate:\n  rafa: ${UPSTREAM}\n${PREREQUISITES}`;

/** A config holding no `collaborate` section. */
const NO_COLLABORATE_CONFIG = `tracker:\n  default: local\n${PREREQUISITES}`;

/** The command the gate reads this board through. */
const REPO_VIEW = ['repo', 'view', '--json', 'nameWithOwner,visibility'];

/** The issue planted on the upstream, the one each comment is posted on. */
const ISSUE_ID = '1';

/** A fixture project holding `config`, the filing package's `package.json`, and an empty home. */
function plantProject(config: string): ProjectFound {
  const base = mkdtempSync(join(tempBase, 'case-'));
  const root = join(base, 'project');
  const home = join(base, 'home');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), config);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: PACKAGE, version: '0.1.0' })}\n`);
  return { found: true, root, home, project: scopeAt(root), user: scopeAt(home) };
}

/** A body holding the checkout's path, the secret, this board's name and the package's. */
function leakyBody(project: ProjectFound): string {
  return [
    `Seen again in ${project.root}/src/loop.ts:12 of ${OWN}.`,
    `The run had ${SECRET_NAME}=${SECRET_VALUE} set, and ${PACKAGE} at its head.`,
  ].join('\n');
}

/** A git in no checkout of its own: the project root stands in. */
const noCheckoutGit: GitRunner = () => ({ ok: false, stdout: '', stderr: 'fatal: not a git repository' });

/** How this board answers `gh repo view`: a repository and a visibility, `null` for none, or a failure. */
type OwnAnswer = { readonly repository: string; readonly visibility: string | null } | { readonly fails: string };

/** The `gh` seam a case runs over: every call recorded, and the upstream fake behind it. */
interface Boards {
  readonly gh: GhRunner;
  readonly calls: (readonly string[])[];
  readonly upstream: FakeGh;
}

/** What `gh repo view` answers for `own`. */
function repoView(own: OwnAnswer): GhResult {
  if ('fails' in own) return { ok: false, stdout: '', stderr: `${own.fails}\n` };
  const answer = own.visibility === null
    ? { nameWithOwner: own.repository }
    : { nameWithOwner: own.repository, visibility: own.visibility };
  return { ok: true, stdout: `${JSON.stringify(answer)}\n`, stderr: '' };
}

/** A `gh` answering this board as `own` and handing every other call to the fake holding `upstream` and its one issue. */
async function boardsOf(own: OwnAnswer = { repository: OWN, visibility: 'PRIVATE' }): Promise<Boards> {
  const fake = createFakeGh({ repo: UPSTREAM });
  const planted = await fake.run(['issue', 'create', '--title', 'resume finds no branch', '--body', 'Seen once.']);
  if (!planted.ok) throw new Error(`the fake refused the planted issue: ${planted.stderr}`);
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args, stdin) => {
    calls.push(args);
    return args[0] === 'repo' && args[1] === 'view'
      ? Promise.resolve(repoView(own))
      : fake.run(args, stdin);
  };
  return { gh, calls, upstream: fake };
}

/** What a run wrote: the `info` and `warn` lines, and each result. */
interface Written {
  readonly info: string[];
  readonly warn: string[];
  readonly results: unknown[];
}

/** A context over `project` with `id` and `flags`, in `mode`, writing into `written`. */
function contextOf(project: ProjectFound, id: string, flags: LineFlags, written: Written, mode: RafaContext['outputMode']): RafaContext {
  return Object.freeze({
    args: [id],
    flags,
    outputMode: mode,
    verbosity: 2,
    output: sinkOutput({
      info: (line: string) => written.info.push(line),
      warn: (line: string) => written.warn.push(line),
      result: (payload: unknown) => written.results.push(payload),
    }),
    signal: new AbortController().signal,
    env: { [SECRET_NAME]: SECRET_VALUE },
    argv: [],
    registry: createCommandRegistry({ subjects: [], commands: [] }),
    project,
  });
}

/** What a run ended with: its exit code and message, 0 and `''` when it resolved, and what it wrote. */
interface Outcome extends Written {
  readonly exitCode: number;
  readonly message: string;
}

/** How a case runs the command: the issue id and the output mode, `1` and text when left out. */
interface RunOptions {
  readonly id?: string;
  readonly mode?: RafaContext['outputMode'];
}

/** Runs `issue comment` with `flags` in `project` over `boards`. */
async function run(project: ProjectFound, flags: LineFlags, boards: Boards, options: RunOptions = {}): Promise<Outcome> {
  const written: Written = { info: [], warn: [], results: [] };
  const seams: IssueSeams = { gh: boards.gh, git: noCheckoutGit, cwd: () => project.root };
  const context = contextOf(project, options.id ?? ISSUE_ID, flags, written, options.mode ?? 'text');
  try {
    await createIssueCommentCommand(seams).run(context);
  } catch (error) {
    if (!(error instanceof CommandExit)) throw error;
    return { exitCode: error.exitCode, message: error.message, ...written };
  }
  return { exitCode: 0, message: '', ...written };
}

/** The calls `boards` sent past the gate's one read. */
function pastTheGate(boards: Boards): (readonly string[])[] {
  return boards.calls.filter((call) => call[0] !== 'repo');
}

/** The repository a call names with `--repo`, or undefined for none. */
function repoOf(call: readonly string[]): string | undefined {
  const at = call.indexOf('--repo');
  return at < 0
    ? undefined
    : call[at + 1];
}

/** Asserts every call past the gate named `--repo <upstream>`, and none named this board. */
function expectOnUpstream(boards: Boards): void {
  const sent = pastTheGate(boards);
  expect(sent.length).toBeGreaterThan(0);
  for (const call of sent) {
    expect(repoOf(call)).toBe(UPSTREAM);
    expect(call.some((arg) => arg.toLowerCase() === OWN)).toBe(false);
  }
}

/** The comments the upstream's planted issue holds. */
function postedComments(boards: Boards): readonly string[] {
  return boards.upstream.issue(ISSUE_ID)?.comments ?? [];
}

describe('issue comment --upstream refuses at the gate, before any tracker', () => {
  it('refuses the flag typed blank, naming the usage, sending no gh', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { body: 'Seen again.', upstream: ' ' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ --upstream cannot be blank: --upstream=<value>\nUsage: rafa issue comment <id> --body=<text>',
    ]);
    expect(boards.calls).toEqual([]);
  });

  it('refuses a tool it does not know, sending no gh', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { body: 'Seen again.', upstream: 'bun' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue comment --upstream=bun: --upstream names "bun", expected one of: rafa. Nothing was filed.',
    ]);
    expect(boards.calls).toEqual([]);
  });

  it('refuses collaborate.rafa absent, sending no gh', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(NO_COLLABORATE_CONFIG), { body: 'Seen again.', upstream: 'rafa' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue comment --upstream=rafa: collaborate.rafa is not set, so reporting upstream is off. Nothing was filed.',
    ]);
    expect(boards.calls).toEqual([]);
  });

  it('refuses owners that differ, after the one read of this board, with nothing posted', async () => {
    const boards = await boardsOf({ repository: 'someone-else/app', visibility: 'PUBLIC' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { body: 'Seen again.', upstream: 'rafa' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue comment --upstream=rafa: collaborate.rafa names open-tomato/rafa (owner open-tomato), and this board is '
      + 'someone-else/app (owner someone-else). Reporting upstream is allowed only between repositories of one owner. '
      + 'Nothing was filed.',
    ]);
    expect(boards.calls).toEqual([REPO_VIEW]);
    expect(postedComments(boards)).toEqual([]);
  });

  it('refuses this board\'s owner unread, naming gh\'s reason, with nothing posted', async () => {
    const boards = await boardsOf({ fails: 'no git remotes found' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { body: 'Seen again.', upstream: 'rafa' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue comment --upstream=rafa: could not read this board\'s owner '
      + '(gh repo view --json nameWithOwner,visibility failed: no git remotes found). Nothing was filed.',
    ]);
    expect(boards.calls).toEqual([REPO_VIEW]);
  });

  it('refuses a missing --body before the gate, sending no gh', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa' }, boards);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toStartWith('❌ --body is required: --body=<value>');
    expect(boards.calls).toEqual([]);
  });
});

describe('issue comment --upstream on an id the upstream does not hold', () => {
  it('fails at the comment with the error gh gives, naming the upstream and posting nothing', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { body: 'Seen again.', upstream: 'rafa' }, boards, { id: '9' });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toStartWith(`❌ Could not comment on issue 9 on ${UPSTREAM} on the github tracker: `);
    expect(postedComments(boards)).toEqual([]);
    expectOnUpstream(boards);
  });
});

describe('issue comment --upstream=rafa, posted', () => {
  it('posts a PRIVATE board\'s comment redacted: no checkout path, no secret, no private name', async () => {
    const boards = await boardsOf({ repository: OWN, visibility: 'PRIVATE' });
    const project = plantProject(COLLABORATE_CONFIG);
    const outcome = await run(project, { body: leakyBody(project), upstream: 'rafa' }, boards);

    expect([outcome.exitCode, outcome.message, outcome.warn]).toEqual([0, '', []]);
    expect(outcome.info).toEqual([`Commented on github issue ${ISSUE_ID} on ${UPSTREAM}.`]);
    const posted = postedComments(boards);
    expect(posted).toHaveLength(1);
    const [comment = ''] = posted;
    expect(comment).toContain('Seen again in src/loop.ts:12');
    expect(comment).toContain(PRIVATE_SIBLING);
    expect(comment).not.toContain(project.root);
    expect(comment).not.toContain(SECRET_VALUE);
    expect(comment).not.toMatch(/components/i);
    expect(boards.calls[0]).toEqual(REPO_VIEW);
    expectOnUpstream(boards);
    expect(pastTheGate(boards).map((call) => call.slice(0, 2))).toEqual([['issue', 'comment']]);
  });

  it('hides the names of a board whose visibility gh did not answer', async () => {
    const boards = await boardsOf({ repository: OWN, visibility: null });
    const project = plantProject(COLLABORATE_CONFIG);
    const outcome = await run(project, { body: leakyBody(project), upstream: 'rafa' }, boards);
    expect(outcome.exitCode).toBe(0);
    expect(postedComments(boards)[0]).not.toMatch(/components/i);
  });

  it('passes owners differing only in case', async () => {
    const boards = await boardsOf({ repository: 'Open-Tomato/components', visibility: 'PRIVATE' });
    const project = plantProject(COLLABORATE_CONFIG);
    const outcome = await run(project, { body: leakyBody(project), upstream: 'rafa' }, boards);
    expect(outcome.exitCode).toBe(0);
    expect(postedComments(boards)[0]).not.toMatch(/components/i);
    expectOnUpstream(boards);
  });

  it('keeps a PUBLIC board\'s names, still redacted: the control that the leak check reads the posted text', async () => {
    const boards = await boardsOf({ repository: OWN, visibility: 'PUBLIC' });
    const project = plantProject(COLLABORATE_CONFIG);
    const outcome = await run(project, { body: leakyBody(project), upstream: 'rafa' }, boards);
    expect(outcome.exitCode).toBe(0);
    const [comment = ''] = postedComments(boards);
    expect(comment).toContain(`of ${OWN}.`);
    expect(comment).toContain(PACKAGE);
    expect(comment).not.toContain(project.root);
    expect(comment).not.toContain(SECRET_VALUE);
  });

  it('posts the body as typed without --upstream: the control that the redaction is the upstream path\'s', async () => {
    const boards = await boardsOf();
    const project = plantProject('tracker:\n  default: github\n');
    const outcome = await run(project, { body: leakyBody(project) }, boards);
    expect(outcome.exitCode).toBe(0);
    expect(postedComments(boards)[0]).toContain(SECRET_VALUE);
    expect(boards.calls.some((call) => call[0] === 'repo' && call.includes('nameWithOwner,visibility'))).toBe(false);
  });

  it('gives the github tracker, the ref carrying the upstream repo, and the upstream as the result in json mode', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { body: 'Seen again.', upstream: 'rafa' }, boards, { mode: 'json' });
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0] as IssueCommentResult).toEqual({
      tracker: { kind: 'github', degraded: false, fallbackReason: null },
      ref: { opt: 0, kind: 'github', externalId: ISSUE_ID, url: null, repo: UPSTREAM },
      upstream: UPSTREAM,
    });
  });
});

describe('what the comment line renders', () => {
  it('names the upstream only when given', () => {
    const ref = { opt: 0, kind: 'github', externalId: '4', url: null } as const;
    expect(renderCommented({ ref })).toBe('Commented on github issue 4.');
    expect(renderCommented({ ref, upstream: UPSTREAM })).toBe(`Commented on github issue 4 on ${UPSTREAM}.`);
  });
});
