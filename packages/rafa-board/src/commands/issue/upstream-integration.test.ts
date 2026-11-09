/**
 * Integration tests of `--upstream=rafa` across the three commands that
 * take it, `rafa issue create`, `rafa issue comment` and `rafa issue
 * list`: each is dispatched by the CLI's own `dispatch`
 * (`src/cli/dispatch.ts`) over a registry holding the `issue` subject and
 * those three commands, made over seams of this file's own, in a fixture
 * project of its own.
 *
 * The fixture project holds a `.rafa/config.yaml` planted by the case, a
 * `package.json` naming the filing package {@link PACKAGE} and an empty
 * home. `gh` is a seam recording every call: it answers
 * `gh repo view --json nameWithOwner,visibility` as this board,
 * {@link OWN}, and hands every other call to the recorded fake
 * (`adapters/tracker/github-fake.ts`) holding the upstream,
 * {@link UPSTREAM}, with one issue planted, which refuses a `--repo`
 * naming another repository. Git is a seam answering a fixed commit.
 *
 * What it holds, over the three commands at once:
 *
 *   - each of the gate's refusals, and the refusal of a tool outside the
 *     accepted list, ends the dispatch with exit code 1, the spec's line
 *     on the error stream, and no `gh issue` or `gh label` call sent;
 *   - a `PRIVATE` board and one whose visibility `gh` did not answer
 *     leave neither this board's repository name nor the filing
 *     package's in the filed issue or the posted comment, and a `PUBLIC`
 *     board keeps them, the control that the leak check reads the text;
 *   - `issue create --type=bug … --upstream=rafa --dry-run` prints the
 *     upstream and the body it would file, with no private name, and
 *     files nothing;
 *   - the `--help` of each command lists `--upstream`.
 *
 * The cases over one command at its seams are in `create-upstream.test.ts`,
 * `comment-upstream.test.ts` and `list-upstream.test.ts` beside this file.
 *
 * Negative cases come first.
 */
import type { IssueSeams } from './issue-tracker.js';
import type { FakeGh } from '../../adapters/tracker/github-fake.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCommandRegistry } from '@open-tomato/rafa/cli/registry';
import { afterAll, describe, expect, it } from 'bun:test';

import { dispatch } from '../../../../../src/cli/dispatch.js';
import { renderHelp } from '../../../../../src/cli/help.js';
import { createFakeGh } from '../../adapters/tracker/github-fake.js';

import { createIssueCommentCommand } from './comment.js';
import { createIssueCreateCommand } from './create.js';
import { ISSUE_SUBJECT } from './declarations.js';
import { createIssueListCommand } from './list.js';
import { PRIVATE_SIBLING } from './upstream-text.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-upstream-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The upstream every config here names. */
const UPSTREAM = 'open-tomato/rafa';

/** This board, the filing repository. */
const OWN = 'open-tomato/components';

/** The filing package, as its `package.json` names it. */
const PACKAGE = 'components-workspace';

/** A config naming {@link UPSTREAM} under `collaborate.rafa`. */
const COLLABORATE_CONFIG = `collaborate:\n  rafa: ${UPSTREAM}\n`;

/** A config holding no `collaborate` section. */
const NO_COLLABORATE_CONFIG = 'tracker:\n  default: local\n';

/** The command the gate reads this board through. */
const REPO_VIEW = ['repo', 'view', '--json', 'nameWithOwner,visibility'];

/** The id of the issue planted on the upstream. */
const ISSUE_ID = '1';

/** The three commands, by the words that dispatch them. */
type Action = 'create' | 'comment' | 'list';

/** The words of one action's command line, ending with `--upstream=<value>` and the flags it needs. */
const COMMAND_LINES: { readonly [A in Action]: readonly string[] } = {
  create: [
    'issue', 'create', '--type=bug', '--module=loop', '--action=start',
    `--summary=resume does not find the ${PACKAGE} branch`,
    `--reproduce=rafa loop start --continue in a clone of ${OWN}`,
    '--cause=git:new-context', '--proposed=git:branch-not-found',
  ],
  comment: ['issue', 'comment', ISSUE_ID, `--body=Seen again in ${OWN}, with ${PACKAGE} at its head.`],
  list: ['issue', 'list'],
};

/** What each action's refusal says was left undone. */
const NOTHING_DONE: { readonly [A in Action]: string } = {
  create: 'Nothing was filed.',
  comment: 'Nothing was filed.',
  list: 'Nothing was read.',
};

const ACTIONS: readonly Action[] = ['create', 'comment', 'list'];

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

/** A `gh` answering this board as `own` and handing every other call to the fake holding the upstream and its one issue. */
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

/** A fixture project holding `config`, the filing package's `package.json`, and an empty home. */
function plantProject(config: string): { readonly root: string; readonly home: string } {
  const base = mkdtempSync(join(tempBase, 'case-'));
  const root = join(base, 'project');
  const home = join(base, 'home');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), config);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: PACKAGE, version: '0.1.0' })}\n`);
  return { root, home };
}

/** A git on commit `2bdad97` with a clean tree, in no checkout of its own: the project root stands in. */
const cleanGit: GitRunner = (args) => {
  if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
    return { ok: false, stdout: '', stderr: 'fatal: not a git repository' };
  }
  const stdout = args[0] === 'rev-parse'
    ? '2bdad97\n'
    : '';
  return { ok: true, stdout, stderr: '' };
};

/** What one dispatch wrote, and how it ended. */
interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** An output stream that keeps what it is written. */
function memoryStream(): { readonly stream: { write: (chunk: string) => boolean }; readonly text: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    },
    text: () => chunks.join(''),
  };
}

/** Dispatches `words` in `project` over a registry of the three commands made over `boards`' `gh`. */
async function dispatchOver(
  words: readonly string[],
  project: { readonly root: string; readonly home: string },
  boards: Boards,
): Promise<Run> {
  const seams: IssueSeams = { gh: boards.gh, git: cleanGit, cwd: () => project.root };
  const registry = createCommandRegistry({
    subjects: [ISSUE_SUBJECT],
    commands: [createIssueCreateCommand(seams), createIssueCommentCommand(seams), createIssueListCommand(seams)],
  });
  const stdout = memoryStream();
  const stderr = memoryStream();
  const { exitCode } = await dispatch(words, {
    registry,
    renderHelp,
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-11-09T12:00:00.000Z'),
    cwd: project.root,
    home: project.home,
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

/** The words of `action`'s command line with `--upstream=<tool>` and `extra` after them. */
function lineOf(action: Action, tool: string, extra: readonly string[] = []): readonly string[] {
  return [...COMMAND_LINES[action], `--upstream=${tool}`, ...extra];
}

/** The calls `boards` sent that were a `gh issue` or `gh label` call. */
function issueOrLabelCalls(boards: Boards): (readonly string[])[] {
  return boards.calls.filter((call) => call[0] === 'issue' || call[0] === 'label');
}

/** The repository a call names with `--repo`, or undefined for none. */
function repoOf(call: readonly string[]): string | undefined {
  const at = call.indexOf('--repo');
  return at < 0
    ? undefined
    : call[at + 1];
}

/** True when `text` names this board or the filing package, ignoring case. */
function leaksName(text: string): boolean {
  return /components/i.test(text);
}

/** The title and body the upstream's issue `id` holds, joined. */
function filedText(boards: Boards, id: string): string {
  const issue = boards.upstream.issue(id);
  return `${issue?.title ?? ''}\n${issue?.body ?? ''}`;
}

describe.each(ACTIONS)('issue %s --upstream=rafa refuses at the gate, sending no gh issue or gh label', (action) => {
  const done = NOTHING_DONE[action];

  it('refuses a tool it does not know, sending no gh at all', async () => {
    const boards = await boardsOf();
    const run = await dispatchOver(lineOf(action, 'bun'), plantProject(COLLABORATE_CONFIG), boards);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`issue ${action} --upstream=bun: --upstream names "bun", expected one of: rafa. ${done}`);
    expect(boards.calls).toEqual([]);
  });

  it('refuses collaborate.rafa absent, sending no gh at all', async () => {
    const boards = await boardsOf();
    const run = await dispatchOver(lineOf(action, 'rafa'), plantProject(NO_COLLABORATE_CONFIG), boards);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      `issue ${action} --upstream=rafa: collaborate.rafa is not set, so reporting upstream is off. ${done}`,
    );
    expect(boards.calls).toEqual([]);
  });

  it('refuses owners that differ, after the one read of this board', async () => {
    const boards = await boardsOf({ repository: 'someone-else/app', visibility: 'PUBLIC' });
    const run = await dispatchOver(lineOf(action, 'rafa'), plantProject(COLLABORATE_CONFIG), boards);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      `issue ${action} --upstream=rafa: collaborate.rafa names ${UPSTREAM} (owner open-tomato), and this board is `
      + 'someone-else/app (owner someone-else). Reporting upstream is allowed only between repositories of one owner. '
      + done,
    );
    expect(boards.calls).toEqual([REPO_VIEW]);
    expect(issueOrLabelCalls(boards)).toEqual([]);
  });

  it('refuses this board\'s owner unread, naming gh\'s reason', async () => {
    const boards = await boardsOf({ fails: 'no git remotes found' });
    const run = await dispatchOver(lineOf(action, 'rafa'), plantProject(COLLABORATE_CONFIG), boards);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      `issue ${action} --upstream=rafa: could not read this board's owner `
      + `(gh repo view --json nameWithOwner,visibility failed: no git remotes found). ${done}`,
    );
    expect(boards.calls).toEqual([REPO_VIEW]);
    expect(issueOrLabelCalls(boards)).toEqual([]);
  });

  it('leaves the upstream as it was when refused', async () => {
    const boards = await boardsOf({ repository: 'someone-else/app', visibility: 'PUBLIC' });
    await dispatchOver(lineOf(action, 'rafa'), plantProject(COLLABORATE_CONFIG), boards);
    expect(boards.upstream.issueCount()).toBe(1);
    expect(boards.upstream.issue(ISSUE_ID)?.comments ?? []).toEqual([]);
  });
});

describe.each([
  ['PRIVATE', { repository: OWN, visibility: 'PRIVATE' }],
  ['unreadable-visibility', { repository: OWN, visibility: null }],
] as const)('a %s own board leaves no repository or package name upstream', (_name, own) => {
  it('files a bug whose title, body and Versions block name neither', async () => {
    const boards = await boardsOf(own);
    const run = await dispatchOver(lineOf('create', 'rafa'), plantProject(COLLABORATE_CONFIG), boards);
    expect(run.exitCode).toBe(0);
    expect(boards.upstream.issueCount()).toBe(2);
    const text = filedText(boards, '2');
    expect(text).toContain(PRIVATE_SIBLING);
    expect(text).toContain(`package: ${PRIVATE_SIBLING}@0.1.0`);
    expect(leaksName(text)).toBe(false);
    expect(run.stdout).toContain(`on ${UPSTREAM}`);
    expect(leaksName(run.stdout + run.stderr)).toBe(false);
  });

  it('posts a comment naming neither', async () => {
    const boards = await boardsOf(own);
    const run = await dispatchOver(lineOf('comment', 'rafa'), plantProject(COLLABORATE_CONFIG), boards);
    expect(run.exitCode).toBe(0);
    const posted = boards.upstream.issue(ISSUE_ID)?.comments ?? [];
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain(PRIVATE_SIBLING);
    expect(leaksName(posted[0] ?? '')).toBe(false);
  });
});

describe('issue create --type=bug … --upstream=rafa --dry-run', () => {
  it('prints the upstream and the body it would file with no private name, and files nothing', async () => {
    const boards = await boardsOf();
    const run = await dispatchOver(lineOf('create', 'rafa', ['--dry-run']), plantProject(COLLABORATE_CONFIG), boards);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Upstream: ${UPSTREAM}`);
    expect(run.stdout).toContain(`loop - start: resume does not find the ${PRIVATE_SIBLING} branch`);
    expect(run.stdout).toContain(`package: ${PRIVATE_SIBLING}@0.1.0`);
    expect(run.stdout).toContain(`rafa loop start --continue in a clone of ${PRIVATE_SIBLING}`);
    expect(leaksName(run.stdout)).toBe(false);
    expect(boards.upstream.issueCount()).toBe(1);
    expect(issueOrLabelCalls(boards)).toEqual([]);
  });
});

describe('a PUBLIC own board, the control that the leak check reads the text', () => {
  it('keeps its names in the filed bug and the posted comment, all calls naming the upstream', async () => {
    const boards = await boardsOf({ repository: OWN, visibility: 'PUBLIC' });
    const project = plantProject(COLLABORATE_CONFIG);
    const created = await dispatchOver(lineOf('create', 'rafa'), project, boards);
    const commented = await dispatchOver(lineOf('comment', 'rafa'), project, boards);
    expect([created.exitCode, commented.exitCode]).toEqual([0, 0]);
    expect(leaksName(filedText(boards, '2'))).toBe(true);
    expect(boards.upstream.issue(ISSUE_ID)?.comments?.[0]).toContain(OWN);
    const sent = issueOrLabelCalls(boards);
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) {
      expect(repoOf(call)).toBe(UPSTREAM);
    }
  });

  it('lists the upstream board\'s issues naming --repo <upstream> and never this board', async () => {
    const boards = await boardsOf();
    const run = await dispatchOver(['issue', 'list', '--upstream=rafa'], plantProject(COLLABORATE_CONFIG), boards);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('resume finds no branch');
    const sent = issueOrLabelCalls(boards);
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) {
      expect(repoOf(call)).toBe(UPSTREAM);
      expect(call.some((arg) => arg.toLowerCase() === OWN)).toBe(false);
    }
  });
});

describe.each(ACTIONS)('rafa issue %s --help', (action) => {
  it('lists --upstream, naming collaborate.rafa', async () => {
    const boards = await boardsOf();
    const run = await dispatchOver(['issue', action, '--help'], plantProject(COLLABORATE_CONFIG), boards);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toStartWith(`rafa issue ${action}`);
    expect(run.stdout).toContain('--upstream');
    expect(run.stdout).toContain('collaborate.rafa');
    expect(boards.calls).toEqual([]);
  });
});
