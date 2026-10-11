/**
 * Tests for `rafa issue create` (`create.ts`): the draft its flags make
 * and the refusal of each flag, the body `--body-file` reads from a file
 * under this file's temporary directory or, for `-`, from a planted
 * `stdin` seam, the lines text mode writes, the issue
 * filed on a `local` tracker, on the recorded `gh` fake and on `local`
 * once `github` fails its preflight, and the registered command spawned.
 *
 * Every dispatched case runs from a project of its own under this file's
 * temporary directory (`tests/cli-capture.ts`), and reads the issue back
 * from where the adapter filed it: the file under the project's
 * `.rafa/issues/`, parsed as the `local` adapter parses it, or the fake's
 * repository. A line refused for its words is held to leave no
 * `.rafa/issues/` and to run no `gh`, beside the same project taking a
 * line the command accepts, which makes both; a line naming `--body`
 * beside `--body-file` and one naming an unreadable body file are held to
 * the same. A seam that rejects when read stands in for standard input
 * wherever a case must not read it.
 *
 * A spec's `Blocked by:` line is driven on the fake and on `local` over
 * a board whose first issue a case files itself: a line naming it files
 * the spec marked blocked, beside a bug with the same line filed
 * unmarked, and a line naming the issue being filed, an issue the board
 * lacks or no issue at all is refused with the issue count unchanged,
 * the last before any `gh` runs.
 *
 * The project step is driven on the gh fake with `board.project.number`
 * set, every `gh api` call routed to the strict project fake
 * (`../../board/project/project-fake.ts`): the issue filed lands on the
 * project as an item, and a number naming no project is answered by its
 * warning line, each with exit code 0 and the warning written after the
 * create's own lines. The project fake models no facts query, so the
 * refresh asked after the add rejects at the facts read and is answered
 * by its one failed line, which is how the case sees it was asked. Beside them, the same line with the number unset sends no
 * `gh api` call, and a `local` issue sends no `gh` at all.
 *
 * The retry cases time the project add out once (`retry-fake.ts`): the
 * add is sent again and the issue lands on the project, the `retrying`
 * line after the create's own lines, or one `retry` event in json mode.
 * Their control is the same failure under `board.project.retries: false`,
 * which leaves the issue off the project with no `retrying` line.
 *
 * The spawned case runs `bun src/rafa.ts issue create` in a scratch
 * repository whose config names `github` first, under a PATH holding a
 * stand-in `gh` that logs its arguments and exits 1. So the registered
 * command resolves the chain over the core registry: the stand-in is
 * asked `auth status` and nothing more, the warning carries what it
 * wrote, and the issue lands on `local`. `rafa issues list`, the plural,
 * then lists it.
 */
import type { LineFlags } from './issue-tracker.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { localIssuesDir, parseLocalIssue } from '../../adapters/tracker/local.js';
import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { SPEC_LABEL } from '../../board/issue.js';
import { createGhProjectPort } from '../../board/project/gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY, fakeProjectId } from '../../board/project/project-fake.js';
import { notFoundWarning } from '../../board/project/refresh-warnings.js';
import { flakyGh, recordRetries, TIMED_OUT_STDERR } from '../../board/project/retry-fake.js';
import { CommandExit } from '../../cli/command.js';
import {
  dispatchInProject,
  eventsOf,
  plantProject,
  plantProjectConfig,
  plantScratchRepo,
  runRafa,
} from '../../tests/cli-capture.js';

import { KNOWN_LIST_LIMIT } from './create-blocked.js';
import {
  createIssueCreateCommand,
  projectIssueNumber,
  readBodyFile,
  readBodyFileFlag,
  readIssueDraft,
  readIssueLine,
  renderCreated,
  STDIN_PATH,
} from './create.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-create-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long the spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** The usage line a refusal names. */
const USAGE = 'rafa issue create --title=<text> [--body=<text> | --body-file=<path>] [--type=<type>] [--module=<name>] [--priority=<priority>]';

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** What a refused `Blocked by:` line tells the author to do. */
const BLOCKED_REMEDY = 'name the issues it waits on as "Blocked by: #24 #26", or take the line out';

/** A config naming `local` first. */
const LOCAL_CONFIG = 'tracker:\n  default: local\n';

/** A config naming `github` first, then `local`. */
const GITHUB_CONFIG = 'tracker:\n  default: github\n  fallback: [local]\n';

/** What the `github` preflight answers over a fake with no host logged in. */
const NOT_LOGGED_IN = 'gh auth status: You are not logged into any GitHub hosts. To log in, run: gh auth login';

/** The words of a line filing a bug with a body. */
const BUG_LINE = ['issue', 'create', '--title=Timeouts in plan show', '--type=bug', '--body=Seen twice.'];

/** Each set of flags the draft refuses, and the problem its refusal names. */
const DRAFT_REFUSALS: readonly (readonly [LineFlags, string])[] = [
  [{}, '--title is required: --title=<value>'],
  [{ title: '  ' }, '--title cannot be blank: --title=<value>'],
  [{ title: 'x', type: 'feature' }, '--type is "feature", expected one of: code, bug, spike, adr, chore, package-api, epic, spec'],
  [{ title: 'x', priority: 'p1' }, '--priority is "p1", expected one of: urgent, high, medium, low'],
  [{ title: 'x', module: '' }, '--module cannot be blank: --module=<value>'],
  [{ title: 'x', body: true }, '--body needs a value: --body=<value>'],
  [{ title: 'x', body: 'Seen twice.', 'body-file': 'body.md' }, '--body and --body-file cannot be used together: name the body one way'],
  [{ title: 'x', body: '', 'body-file': '-' }, '--body and --body-file cannot be used together: name the body one way'],
  [{ title: 'x', 'body-file': ' ' }, '--body-file cannot be blank: --body-file=<value>'],
  [{ title: 'x', 'body-file': true }, '--body-file needs a value: --body-file=<value>'],
];

/** A body with the bytes a trim or a re-encoding would lose: a leading blank line, a tab, non-ASCII and a trailing newline pair. */
const FILE_BODY = '\nBlocked by: #20\n\n\tSpec — café.\n\n';

/** A stdin seam answering `text`, counting how often it is read. */
function plantStdin(text: string): { readonly stdin: () => Promise<string>; readonly reads: () => number } {
  let reads = 0;
  return {
    stdin: () => {
      reads += 1;
      return Promise.resolve(text);
    },
    reads: () => reads,
  };
}

/** A stdin seam that is never meant to be read: it fails the case when it is. */
function unreadStdin(): Promise<string> {
  return Promise.reject(new Error('standard input was read'));
}

/** A file under this file's temporary directory holding `text`, by its absolute path. */
function plantBodyFile(text: string): string {
  const path = join(mkdtempSync(join(tempBase, 'body-')), 'body.md');
  writeFileSync(path, text, 'utf8');
  return path;
}

/** What `read` rejected with, as its exit code and message for a `CommandExit`, or undefined when it resolved. */
async function asyncExitOf(read: () => Promise<unknown>): Promise<unknown> {
  try {
    await read();
  } catch (error) {
    return error instanceof CommandExit
      ? { exitCode: error.exitCode, message: error.message }
      : error;
  }
  return undefined;
}

/** A fresh project holding `config`. */
function plantCase(config: string): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** What `read` threw, as its exit code and message for a `CommandExit`, or undefined when it returned. */
function exitOf(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error instanceof CommandExit
      ? { exitCode: error.exitCode, message: error.message }
      : error;
  }
  return undefined;
}

/** The `local` issue `number` of a project, as its adapter parses the file. */
function localIssue(project: PlantedProject, number: number) {
  const path = join(localIssuesDir(project.root), `${number}.md`);
  return parseLocalIssue(readFileSync(path, 'utf8'), path);
}

describe('the draft rafa issue create makes', () => {
  it('fills a title alone with an empty body, type code, module unassigned, no priority, opt 0, no project and no blocker', () => {
    expect(readIssueDraft({ title: 'Timeouts' })).toEqual({
      opt: 0,
      title: 'Timeouts',
      body: '',
      type: 'code',
      module: 'unassigned',
      priority: null,
      project: null,
      blockedBy: [],
    });
  });

  it('takes the body, type, module and priority each flag names', () => {
    expect(readIssueDraft({ title: 'Timeouts', body: 'Seen twice.', type: 'bug', module: 'cli', priority: 'high' })).toMatchObject({
      title: 'Timeouts',
      body: 'Seen twice.',
      type: 'bug',
      module: 'cli',
      priority: 'high',
    });
  });

  it('takes --type epic', () => {
    expect(readIssueDraft({ title: 'Epics', type: 'epic' })).toMatchObject({ title: 'Epics', type: 'epic' });
  });

  it('takes --type spec', () => {
    expect(readIssueDraft({ title: 'A spec', type: 'spec' })).toMatchObject({ title: 'A spec', type: 'spec' });
  });

  it.each(DRAFT_REFUSALS)('refuses the flags %j with exit code 1', (flags, problem) => {
    expect(exitOf(() => readIssueDraft(flags))).toEqual({ exitCode: 1, message: `❌ ${problem}\nUsage: ${USAGE}` });
  });

  it('writes the issue created, and its URL when the tracker gives one', () => {
    expect(renderCreated({ opt: 0, kind: 'local', externalId: '1', url: null })).toEqual(['Created local issue 1.']);
    expect(renderCreated({ opt: 0, kind: 'github', externalId: '7', url: 'https://github.com/open-tomato/rafa/issues/7' })).toEqual([
      'Created github issue 7.',
      'URL: https://github.com/open-tomato/rafa/issues/7',
    ]);
  });
});

describe('the body rafa issue create reads from --body-file', () => {
  it('names no path when the line leaves --body-file out, and the path typed when it names one', () => {
    expect(readBodyFileFlag({ title: 'x', body: 'Seen twice.' })).toBeUndefined();
    expect(readBodyFileFlag({ title: 'x', 'body-file': 'spec.md' })).toBe('spec.md');
    expect(readBodyFileFlag({ title: 'x', 'body-file': STDIN_PATH })).toBe('-');
  });

  it('reads a file\'s bytes whole, nothing trimmed, and leaves standard input unread', async () => {
    const path = plantBodyFile(FILE_BODY);

    expect(await readBodyFile(path, { stdin: unreadStdin })).toBe(FILE_BODY);
  });

  it('reads standard input through the seam for -, once', async () => {
    const seam = plantStdin(FILE_BODY);

    expect(await readBodyFile(STDIN_PATH, seam)).toBe(FILE_BODY);
    expect(seam.reads()).toBe(1);
  });

  it('takes an empty standard input as an empty body', async () => {
    expect(await readBodyFile(STDIN_PATH, plantStdin(''))).toBe('');
  });

  it('refuses a path holding no file with exit code 1, naming the path and the reason', async () => {
    const path = join(tempBase, 'no-such-dir', 'body.md');

    expect(await asyncExitOf(() => readBodyFile(path, { stdin: unreadStdin }))).toEqual({
      exitCode: 1,
      message: `❌ --body-file cannot read "${path}": ENOENT: no such file or directory, open '${path}'\nUsage: ${USAGE}`,
    });
  });

  it('refuses a directory with exit code 1, naming the path', async () => {
    const path = mkdtempSync(join(tempBase, 'dir-'));

    expect(await asyncExitOf(() => readBodyFile(path, { stdin: unreadStdin }))).toMatchObject({
      exitCode: 1,
      message: expect.stringContaining(`❌ --body-file cannot read "${path}": `),
    });
  });

  it('refuses standard input that fails to read with exit code 1, naming standard input', async () => {
    const stdin = (): Promise<string> => Promise.reject(new Error('stream closed'));

    expect(await asyncExitOf(() => readBodyFile(STDIN_PATH, { stdin }))).toEqual({
      exitCode: 1,
      message: `❌ --body-file cannot read standard input: stream closed\nUsage: ${USAGE}`,
    });
  });

  it('fills the draft\'s body from the file, every other field as the flags make it', async () => {
    const path = plantBodyFile(FILE_BODY);
    const flags = { title: 'A spec', type: 'spec', 'body-file': path };

    expect(await readIssueLine(flags, { stdin: unreadStdin })).toEqual({ ...readIssueDraft(flags), body: FILE_BODY });
  });

  it('keeps --body as the draft\'s body and reads nothing when the line names no body file', async () => {
    expect(await readIssueLine({ title: 'x', body: 'Seen twice.' }, { stdin: unreadStdin })).toMatchObject({ body: 'Seen twice.' });
  });

  it('refuses --body beside --body-file before reading standard input', async () => {
    const seam = plantStdin(FILE_BODY);

    const refused = await asyncExitOf(() => readIssueLine({ title: 'x', body: 'Seen twice.', 'body-file': STDIN_PATH }, seam));

    expect(refused).toEqual({
      exitCode: 1,
      message: `❌ --body and --body-file cannot be used together: name the body one way\nUsage: ${USAGE}`,
    });
    expect(seam.reads()).toBe(0);
  });
});

describe('rafa issue create, dispatched', () => {
  it('files a local issue under the project, recording no fallback reason', async () => {
    const project = plantCase(LOCAL_CONFIG);

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand()], project);
    const issue = localIssue(project, 1);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Created local issue 1.\n', stderr: '' });
    expect(localIssuesDir(project.root).startsWith(`${tempBase}${sep}`)).toBe(true);
    expect(issue.draft).toEqual({
      opt: 0,
      title: 'Timeouts in plan show',
      body: 'Seen twice.',
      type: 'bug',
      module: 'unassigned',
      priority: null,
      project: null,
      blockedBy: [],
    });
    expect([issue.state, issue.fallbackReason, issue.comments]).toEqual(['todo', null, []]);
  });

  it('gives the tracker and the ref as the data of the one result event in json mode', async () => {
    const project = plantCase(LOCAL_CONFIG);

    const outcome = await dispatchInProject([...BUG_LINE, '--output=json'], SUBJECTS, [createIssueCreateCommand()], project);
    const events = eventsOf(outcome.stdout);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      ok: true,
      data: {
        tracker: { kind: 'local', degraded: false, fallbackReason: null },
        ref: { opt: 0, kind: 'local', externalId: '1', url: null },
      },
    });
  });

  it('files on the gh fake with its labels, and writes the URL', async () => {
    const fake = createFakeGh();
    const project = plantCase(GITHUB_CONFIG);

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand({ gh: fake.run })], project);

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: 'Created github issue 1.\nURL: https://github.com/open-tomato/rafa/issues/1\n',
      stderr: '',
    });
    expect(fake.issue('1')).toMatchObject({ title: 'Timeouts in plan show', body: 'Seen twice.', state: 'OPEN' });
    expect([...(fake.issue('1')?.labels ?? [])].sort((a, b) => a.localeCompare(b))).toEqual([
      'module:unassigned',
      'needs-triage',
      'type:bug',
    ]);
    expect(existsSync(localIssuesDir(project.root))).toBe(false);
  });

  it('files --type=spec on the gh fake under the board\'s spec label', async () => {
    const fake = createFakeGh();
    const project = plantCase(GITHUB_CONFIG);
    const line = ['issue', 'create', '--title=A spec', '--type=spec', '--body=The spec.'];

    const outcome = await dispatchInProject(line, SUBJECTS, [createIssueCreateCommand({ gh: fake.run })], project);

    expect(outcome.exitCode).toBe(0);
    expect(fake.issue('1')?.labels).toContain(SPEC_LABEL);
    expect(fake.issue('1')?.labels).not.toContain('type:code');
  });

  it('files --type=spec on local as a spec issue', async () => {
    const project = plantCase(LOCAL_CONFIG);
    const line = ['issue', 'create', '--title=A spec', '--type=spec', '--body=The spec.'];

    const outcome = await dispatchInProject(line, SUBJECTS, [createIssueCreateCommand()], project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Created local issue 1.\n', stderr: '' });
    expect(localIssue(project, 1).draft.type).toBe('spec');
  });

  it('files on local once github fails its preflight, warning first and recording why in the issue', async () => {
    const fake = createFakeGh({ authOk: false });
    const project = plantCase(GITHUB_CONFIG);

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand({ gh: fake.run })], project);

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `warn: tracker chain: github unavailable: ${NOT_LOGGED_IN} [tracker:unavailable]\nCreated local issue 1.\n`,
      stderr: '',
    });
    expect(localIssue(project, 1).fallbackReason).toBe(`github: ${NOT_LOGGED_IN}`);
    expect(fake.issueCount()).toBe(0);
  });

  it('files a body file\'s bytes on the gh fake, and standard input\'s for --body-file=-', async () => {
    const fake = createFakeGh();
    const project = plantCase(GITHUB_CONFIG);
    const seam = plantStdin('From standard input.\n');
    const command = createIssueCreateCommand({ gh: fake.run, stdin: seam.stdin });
    const path = plantBodyFile(FILE_BODY);

    const fromFile = await dispatchInProject(['issue', 'create', '--title=A spec', `--body-file=${path}`], SUBJECTS, [command], project);
    const fromStdin = await dispatchInProject(['issue', 'create', '--title=Piped', '--body-file=-'], SUBJECTS, [command], project);

    expect([fromFile.exitCode, fromStdin.exitCode]).toEqual([0, 0]);
    expect(fake.issue('1')).toMatchObject({ title: 'A spec', body: FILE_BODY });
    expect(fake.issue('2')).toMatchObject({ title: 'Piped', body: 'From standard input.\n' });
    expect(seam.reads()).toBe(1);
  });

  it('files a body file\'s bytes on local', async () => {
    const project = plantCase(LOCAL_CONFIG);
    const path = plantBodyFile(FILE_BODY);

    const outcome = await dispatchInProject(['issue', 'create', '--title=A spec', `--body-file=${path}`], SUBJECTS, [createIssueCreateCommand({ stdin: unreadStdin })], project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Created local issue 1.\n', stderr: '' });
    expect(localIssue(project, 1).draft.body).toBe(FILE_BODY);
  });

  it('refuses --body beside --body-file and an unreadable body file before resolving the tracker, where a readable one files', async () => {
    const fake = createFakeGh({ authOk: false });
    const project = plantCase(GITHUB_CONFIG);
    const command = createIssueCreateCommand({ gh: fake.run, stdin: unreadStdin });
    const missing = join(tempBase, 'no-such-dir', 'body.md');

    const both = await dispatchInProject(['issue', 'create', '--title=x', '--body=Seen.', '--body-file=-'], SUBJECTS, [command], project);
    const unreadable = await dispatchInProject(['issue', 'create', '--title=x', `--body-file=${missing}`], SUBJECTS, [command], project);
    const refusedState = [fake.calls().length, existsSync(localIssuesDir(project.root))];
    const taken = await dispatchInProject(['issue', 'create', '--title=x', `--body-file=${plantBodyFile(FILE_BODY)}`], SUBJECTS, [command], project);

    expect(both).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ --body and --body-file cannot be used together: name the body one way\nUsage: ${USAGE}\n`,
    });
    expect([unreadable.exitCode, unreadable.stdout]).toEqual([1, '']);
    expect(unreadable.stderr).toStartWith(`❌ --body-file cannot read "${missing}": ENOENT`);
    expect(refusedState).toEqual([0, false]);
    expect(taken.exitCode).toBe(0);
    expect([fake.calls().length > 0, existsSync(localIssuesDir(project.root))]).toEqual([true, true]);
    expect(localIssue(project, 1).draft.body).toBe(FILE_BODY);
  });

  it('refuses a line before resolving the tracker, filing nothing and running no gh, where a line it takes files', async () => {
    const fake = createFakeGh({ authOk: false });
    const project = plantCase(GITHUB_CONFIG);
    const command = createIssueCreateCommand({ gh: fake.run });

    const refused = await dispatchInProject(['issue', 'create', '--title=x', '--type=feature'], SUBJECTS, [command], project);
    const untitled = await dispatchInProject(['issue', 'create', '--type=bug'], SUBJECTS, [command], project);
    const argument = await dispatchInProject(['issue', 'create', 'bug', '--title=x'], SUBJECTS, [command], project);
    const refusedState = [fake.calls().length, existsSync(localIssuesDir(project.root))];
    const taken = await dispatchInProject(['issue', 'create', '--title=x'], SUBJECTS, [command], project);

    expect(refused).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ --type is "feature", expected one of: code, bug, spike, adr, chore, package-api, epic, spec\nUsage: ${USAGE}\n`,
    });
    expect(untitled.stderr).toBe(`❌ --title is required: --title=<value>\nUsage: ${USAGE}\n`);
    expect(argument.stderr).toBe(`❌ Expected no argument, got 1: bug\nUsage: ${USAGE}\n`);
    expect(refusedState).toEqual([0, false]);
    expect(taken.exitCode).toBe(0);
    expect([fake.calls().length > 0, existsSync(localIssuesDir(project.root))]).toEqual([true, true]);
  });
});

describe('rafa issue create, a spec\'s Blocked by: line', () => {
  it('files a spec naming an issue the gh fake holds with spec:blocked, and a bug with the same line without it', async () => {
    const fake = createFakeGh();
    const project = plantCase(GITHUB_CONFIG);
    const command = createIssueCreateCommand({ gh: fake.run });

    const first = await dispatchInProject(BUG_LINE, SUBJECTS, [command], project);
    const spec = await dispatchInProject(['issue', 'create', '--title=A spec', '--type=spec', '--body=Blocked by: #1\n\nThe spec.'], SUBJECTS, [command], project);
    const bug = await dispatchInProject(['issue', 'create', '--title=A bug', '--type=bug', '--body=Blocked by: #1'], SUBJECTS, [command], project);

    expect([first.exitCode, spec, bug.exitCode]).toEqual([
      0,
      { exitCode: 0, stdout: 'Created github issue 2.\nURL: https://github.com/open-tomato/rafa/issues/2\n', stderr: '' },
      0,
    ]);
    expect(fake.issue('2')?.labels).toContain(SPEC_BLOCKED_LABEL);
    expect(fake.issue('2')?.labels).toContain(SPEC_LABEL);
    expect(fake.issue('3')?.labels).not.toContain(SPEC_BLOCKED_LABEL);
    expect(fake.calls()).toContainEqual(['issue', 'list', '--state', 'all', '--json', 'number,url,labels', '--limit', String(KNOWN_LIST_LIMIT)]);
  });

  it('files a spec with no line unmarked and lists no board for it', async () => {
    const fake = createFakeGh();
    const project = plantCase(GITHUB_CONFIG);

    const outcome = await dispatchInProject(['issue', 'create', '--title=A spec', '--type=spec', '--body=The spec.'], SUBJECTS, [createIssueCreateCommand({ gh: fake.run })], project);

    expect(outcome.exitCode).toBe(0);
    expect(fake.issue('1')?.labels).not.toContain(SPEC_BLOCKED_LABEL);
    expect(fake.calls().some((call) => call[0] === 'issue' && call[1] === 'list')).toBe(false);
  });

  it('refuses a line naming the issue being filed and one naming an issue the board lacks, filing nothing', async () => {
    const fake = createFakeGh();
    const project = plantCase(GITHUB_CONFIG);
    const command = createIssueCreateCommand({ gh: fake.run });
    await dispatchInProject(BUG_LINE, SUBJECTS, [command], project);

    const itself = await dispatchInProject(['issue', 'create', '--title=A spec', '--type=spec', '--body=Blocked by: #1 #2'], SUBJECTS, [command], project);
    const unknown = await dispatchInProject(['issue', 'create', '--title=A spec', '--type=spec', '--body=Blocked by: #1 #7'], SUBJECTS, [command], project);

    expect(itself).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ The spec's "Blocked by:" line, line 1 of the body, names #2, the number this issue would be filed as: ${BLOCKED_REMEDY}\n`,
    });
    expect(unknown).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ The spec's "Blocked by:" line, line 1 of the body, names #7, which the board has no issue for: ${BLOCKED_REMEDY}\n`,
    });
    expect(fake.issueCount()).toBe(1);
  });

  it('refuses a line naming no issue before resolving the tracker, running no gh and filing nothing', async () => {
    const fake = createFakeGh();
    const project = plantCase(GITHUB_CONFIG);
    const path = plantBodyFile('Blocked by: the API work\n');

    const outcome = await dispatchInProject(['issue', 'create', '--title=A spec', '--type=spec', `--body-file=${path}`], SUBJECTS, [createIssueCreateCommand({ gh: fake.run, stdin: unreadStdin })], project);

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ The spec's "Blocked by:" line, line 1 of the body, names no issue: "the API work": ${BLOCKED_REMEDY}\n`,
    });
    expect([fake.calls().length, fake.issueCount(), existsSync(localIssuesDir(project.root))]).toEqual([0, 0, false]);
  });

  it('records specBlocked in the local issue file for a line naming a local issue, and refuses one naming itself', async () => {
    const project = plantCase(LOCAL_CONFIG);
    const command = createIssueCreateCommand();
    await dispatchInProject(BUG_LINE, SUBJECTS, [command], project);

    const spec = await dispatchInProject(['issue', 'create', '--title=A spec', '--type=spec', '--body=Blocked by: #1'], SUBJECTS, [command], project);
    const itself = await dispatchInProject(['issue', 'create', '--title=Another', '--type=spec', '--body=Blocked by: #3'], SUBJECTS, [command], project);

    expect(spec).toEqual({ exitCode: 0, stdout: 'Created local issue 2.\n', stderr: '' });
    expect(localIssue(project, 2).draft.specBlocked).toBe(true);
    expect(localIssue(project, 1).draft.specBlocked).toBeUndefined();
    expect([itself.exitCode, itself.stderr]).toEqual([1, expect.stringContaining('names #3, the number this issue would be filed as')]);
    expect(existsSync(join(localIssuesDir(project.root), '3.md'))).toBe(false);
  });
});

describe('rafa issue create, spawned', () => {
  it('files through the chain of the registered command: a stand-in gh fails the github preflight and the issue lands on local', () => {
    const scratch = plantScratchRepo(tempBase);
    plantProjectConfig(scratch.repo, GITHUB_CONFIG);
    const ghLog = join(dirname(scratch.bin), 'gh.log');
    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, ['#!/bin/sh', `echo "$*" >> '${ghLog}'`, 'echo "stand-in gh: not logged in" >&2', 'exit 1', ''].join('\n'), 'utf8');
    chmodSync(gh, 0o755);
    const warning = 'warn: tracker chain: github unavailable: gh auth status: stand-in gh: not logged in [tracker:unavailable]';

    const created = runRafa(scratch, scratch.repo, ['issue', 'create', '--title=Spawned issue', '--type=bug']);
    const listed = runRafa(scratch, scratch.repo, ['issues', 'list']);

    expect(created).toEqual({ exitCode: 0, stdout: `${warning}\nCreated local issue 1.\n`, stderr: '' });
    expect(listed).toEqual({ exitCode: 0, stdout: `${warning}\nTracker: local\n  1  todo  bug  Spawned issue\n`, stderr: '' });
    expect(readFileSync(ghLog, 'utf8')).toBe('auth status\nauth status\n');
    expect(existsSync(join(scratch.repo, '.rafa', 'issues', '1.md'))).toBe(true);
  }, SPAWN_TIMEOUT);
});

/** The owner of the fake's repository, and of its project. */
const PROJECT_OWNER = FAKE_PROJECT_REPOSITORY.split('/')[0] ?? '';

/** The project's number on the fake. */
const PROJECT_NUMBER = 6;

/** True for the call adding an item to the project. */
function isAdd(args: readonly string[]): boolean {
  return args.some((arg) => arg.includes('addProjectV2ItemById'));
}

/** {@link GITHUB_CONFIG} with `board.project.number` set to `number`. */
function projectConfig(number: number): string {
  return `${GITHUB_CONFIG}board:\n  project:\n    number: ${String(number)}\n`;
}

/** The tracker's gh fake and the project fake behind one runner: `gh api` to the project, the rest to the tracker. */
function projectGh(): { readonly gh: GhRunner; readonly fake: ReturnType<typeof createFakeGh>; readonly project: ReturnType<typeof createFakeProjectGh>; readonly apiCalls: () => number } {
  const fake = createFakeGh();
  const project = createFakeProjectGh({
    projects: [{ owner: PROJECT_OWNER, number: PROJECT_NUMBER }],
    repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues: [1] }],
  });
  let apiCalls = 0;
  const gh: GhRunner = (args) => {
    if (args[0] !== 'api') return fake.run(args);
    apiCalls += 1;
    return project.gh(args);
  };
  return { gh, fake, project, apiCalls: () => apiCalls };
}

describe('rafa issue create and the project', () => {
  it('answers the issue number of a github ref only', () => {
    expect(projectIssueNumber({ kind: 'github', externalId: '41' })).toBe(41);
    expect(projectIssueNumber({ kind: 'local', externalId: '41' })).toBeNull();
    expect(projectIssueNumber({ kind: 'github', externalId: '0' })).toBeNull();
    expect(projectIssueNumber({ kind: 'github', externalId: 'abc' })).toBeNull();
  });

  it('sends no gh api call with board.project.number unset', async () => {
    const wired = projectGh();
    const project = plantCase(GITHUB_CONFIG);

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand({ gh: wired.gh })], project);

    expect(outcome.exitCode).toBe(0);
    expect(wired.apiCalls()).toBe(0);
  });

  it('adds the new issue to the project, then asks the refresh, whose failure is a warning after its own lines and exit 0', async () => {
    const wired = projectGh();
    const project = plantCase(projectConfig(PROJECT_NUMBER));

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand({ gh: wired.gh })], project);
    const items = await createGhProjectPort(wired.project.gh).items(fakeProjectId({ owner: PROJECT_OWNER, number: PROJECT_NUMBER }));
    const lines = outcome.stdout.split('\n');

    expect(outcome.exitCode).toBe(0);
    expect(lines.slice(0, 2)).toEqual(['Created github issue 1.', 'URL: https://github.com/open-tomato/rafa/issues/1']);
    expect(wired.fake.issue('1')).toMatchObject({ title: 'Timeouts in plan show', state: 'OPEN' });
    expect(items.map((item) => item.content)).toEqual([{ kind: 'issue', repository: FAKE_PROJECT_REPOSITORY, number: 1 }]);
    // The project fake models no facts query, so #1's facts are refused; the board read after them finds no
    // Roadmap issue and rejects, answered as one line.
    expect(lines[2]).toStartWith('warn: The project was not updated for #1: no open issue is titled Roadmap');
    expect(lines[2]).toContain('rafa board sync');
  });

  it('writes the not-found line after its own lines and exits 0 for a number naming no project', async () => {
    const wired = projectGh();
    const project = plantCase(projectConfig(PROJECT_NUMBER + 1));

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand({ gh: wired.gh })], project);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe([
      'Created github issue 1.',
      'URL: https://github.com/open-tomato/rafa/issues/1',
      `warn: ${notFoundWarning({ owner: PROJECT_OWNER, number: PROJECT_NUMBER + 1 })}`,
      '',
    ].join('\n'));
  });

  it('sends an add that timed out again, printing one retrying line, and puts the issue on the project', async () => {
    const wired = projectGh();
    const flaky = flakyGh(wired.gh, [TIMED_OUT_STDERR], isAdd);
    const project = plantCase(projectConfig(PROJECT_NUMBER));
    const recorder = recordRetries();

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand({ gh: flaky.gh, sleep: recorder.seams.sleep })], project);
    const items = await createGhProjectPort(wired.project.gh).items(fakeProjectId({ owner: PROJECT_OWNER, number: PROJECT_NUMBER }));
    const lines = outcome.stdout.split('\n');

    expect(outcome.exitCode).toBe(0);
    expect(lines.slice(0, 3)).toEqual([
      'Created github issue 1.',
      'URL: https://github.com/open-tomato/rafa/issues/1',
      'retrying addProjectV2ItemById (1 of 3): operation timed out',
    ]);
    expect(recorder.waits()).toEqual([2000]);
    expect(items.map((item) => item.content)).toEqual([{ kind: 'issue', repository: FAKE_PROJECT_REPOSITORY, number: 1 }]);
  });

  it('control: with board.project.retries false the same add is sent once and the issue stays off the project', async () => {
    const wired = projectGh();
    const flaky = flakyGh(wired.gh, [TIMED_OUT_STDERR], isAdd);
    const project = plantCase(`${projectConfig(PROJECT_NUMBER)}    retries: false\n`);

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand({ gh: flaky.gh, sleep: () => Promise.resolve() })], project);
    const items = await createGhProjectPort(wired.project.gh).items(fakeProjectId({ owner: PROJECT_OWNER, number: PROJECT_NUMBER }));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).not.toContain('retrying ');
    expect(outcome.stdout).toContain('warn: The project was not updated for #1: ');
    expect(items).toEqual([]);
  });

  it('writes the retry as one retry event in json mode', async () => {
    const wired = projectGh();
    const flaky = flakyGh(wired.gh, [TIMED_OUT_STDERR], isAdd);
    const project = plantCase(projectConfig(PROJECT_NUMBER));

    const outcome = await dispatchInProject([...BUG_LINE, '--output=json'], SUBJECTS, [createIssueCreateCommand({ gh: flaky.gh, sleep: () => Promise.resolve() })], project);
    const retries = eventsOf(outcome.stdout).filter((event) => event.type === 'event' && event.name === 'retry');

    expect(outcome.exitCode).toBe(0);
    expect(retries.map((event) => event.type === 'event' && event.summary)).toEqual(['retrying addProjectV2ItemById (1 of 3): operation timed out']);
  });

  it('sends no gh for a local issue, with the number set', async () => {
    const project = plantCase(`${LOCAL_CONFIG}board:\n  project:\n    number: ${String(PROJECT_NUMBER)}\n`);
    const gh: GhRunner = () => Promise.reject(new Error('no gh call was planted'));

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand({ gh })], project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Created local issue 1.\n', stderr: '' });
  });
});
