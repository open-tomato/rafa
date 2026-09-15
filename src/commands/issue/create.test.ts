/**
 * Tests for `rafa issue create` (`create.ts`): the draft its flags make
 * and the refusal of each flag, the lines text mode writes, the issue
 * filed on a `local` tracker, on the recorded `gh` fake and on `local`
 * once `github` fails its preflight, and the registered command spawned.
 *
 * Every dispatched case runs from a project of its own under this file's
 * temporary directory (`tests/cli-capture.ts`), and reads the issue back
 * from where the adapter filed it: the file under the project's
 * `.rafa/issues/`, parsed as the `local` adapter parses it, or the fake's
 * repository. A line refused for its words is held to leave no
 * `.rafa/issues/` and to run no `gh`, beside the same project taking a
 * line the command accepts, which makes both.
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
import type { PlantedProject } from '../../tests/cli-capture.js';

import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { localIssuesDir, parseLocalIssue } from '../../adapters/tracker/local.js';
import { CommandExit } from '../../cli/command.js';
import {
  dispatchInProject,
  eventsOf,
  plantProject,
  plantProjectConfig,
  plantScratchRepo,
  runRafa,
} from '../../tests/cli-capture.js';

import { createIssueCreateCommand, readIssueDraft, renderCreated } from './create.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-create-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long the spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** The usage line a refusal names. */
const USAGE = 'rafa issue create --title=<text> [--body=<text>] [--type=<type>] [--module=<name>] [--priority=<priority>]';

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

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
  [{ title: 'x', type: 'feature' }, '--type is "feature", expected one of: code, bug, spike, adr, chore, package-api'],
  [{ title: 'x', priority: 'p1' }, '--priority is "p1", expected one of: urgent, high, medium, low'],
  [{ title: 'x', module: '' }, '--module cannot be blank: --module=<value>'],
  [{ title: 'x', body: true }, '--body needs a value: --body=<value>'],
];

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

  it('files on local once github fails its preflight, warning first and recording why in the issue', async () => {
    const fake = createFakeGh({ authOk: false });
    const project = plantCase(GITHUB_CONFIG);

    const outcome = await dispatchInProject(BUG_LINE, SUBJECTS, [createIssueCreateCommand({ gh: fake.run })], project);

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `warn: tracker chain: github unavailable: ${NOT_LOGGED_IN}\nCreated local issue 1.\n`,
      stderr: '',
    });
    expect(localIssue(project, 1).fallbackReason).toBe(`github: ${NOT_LOGGED_IN}`);
    expect(fake.issueCount()).toBe(0);
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
      stderr: `❌ --type is "feature", expected one of: code, bug, spike, adr, chore, package-api\nUsage: ${USAGE}\n`,
    });
    expect(untitled.stderr).toBe(`❌ --title is required: --title=<value>\nUsage: ${USAGE}\n`);
    expect(argument.stderr).toBe(`❌ Expected no argument, got 1: bug\nUsage: ${USAGE}\n`);
    expect(refusedState).toEqual([0, false]);
    expect(taken.exitCode).toBe(0);
    expect([fake.calls().length > 0, existsSync(localIssuesDir(project.root))]).toEqual([true, true]);
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
    const warning = 'warn: tracker chain: github unavailable: gh auth status: stand-in gh: not logged in';

    const created = runRafa(scratch, scratch.repo, ['issue', 'create', '--title=Spawned issue', '--type=bug']);
    const listed = runRafa(scratch, scratch.repo, ['issues', 'list']);

    expect(created).toEqual({ exitCode: 0, stdout: `${warning}\nCreated local issue 1.\n`, stderr: '' });
    expect(listed).toEqual({ exitCode: 0, stdout: `${warning}\nTracker: local\n  1  todo  bug  Spawned issue\n`, stderr: '' });
    expect(readFileSync(ghLog, 'utf8')).toBe('auth status\nauth status\n');
    expect(existsSync(join(scratch.repo, '.rafa', 'issues', '1.md'))).toBe(true);
  }, SPAWN_TIMEOUT);
});
