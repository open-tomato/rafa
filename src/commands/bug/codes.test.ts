/**
 * Tests for `rafa bug codes`: the list, `--family`, `--suggest`,
 * `--check` and the json result, each dispatched in-process over a
 * planted project, so the config the command reads is the file a case
 * wrote. Every line and refusal is SPELLED here, never read off the
 * module. Each case runs over a planted tracker listing no open bug,
 * resolved through the registry seam, so none spawns `gh`.
 */
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';
import type { IssueSeams } from '../issue/issue-tracker.js';
import type { OpenIssue, Tracker } from '@open-tomato/rafa/ports';

import '../../adapter-registry.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createAdapterRegistry, PORT_VERSIONS } from '@open-tomato/rafa/core/adapters';

import { projectConfigText } from '../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createCodesCommand } from './codes.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-bug-codes-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command sits under, for the registry a case dispatches over. */
const SUBJECTS = [{ name: 'bug', summary: 'cause codes for bugs' }];

/** The kind of the planted tracker, which the configs name as `tracker.default`. */
const EMPTY_KIND = 'empty';

/** The config lines making the planted tracker the chain's default. */
const TRACKER_CONFIG = `tracker:\n  default: ${EMPTY_KIND}\n`;

/** A tracker listing no open issue, refusing everything else. */
function emptyTracker(): Tracker {
  const refuse = (): Promise<never> => Promise.reject(new Error(`${EMPTY_KIND}: not modelled`));
  return {
    kind: EMPTY_KIND,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: () => Promise.resolve({ ok: true }),
    find: refuse,
    get: refuse,
    create: refuse,
    comment: refuse,
    transition: refuse,
    openIssues: () => Promise.resolve([]),
  };
}

/** The seams every case runs over: a registry whose one tracker lists nothing. */
const SEAMS: IssueSeams = {
  registry: createAdapterRegistry([
    { port: 'tracker', kind: EMPTY_KIND, portVersion: PORT_VERSIONS.tracker, create: emptyTracker },
  ]),
};

/** The code the planted bug proposes, a leaf the list does not hold. */
const PROPOSED_CODE = 'git:branch-not-found';

/** The planted bug's title. */
const BUG_TITLE = 'checkout fails when the branch is missing';

/** The planted bug's number, which the proposal's line names. */
const BUG_NUMBER = '7';

/** A bug body whose record proposes {@link PROPOSED_CODE}. */
const BUG_BODY = ['## What', '', 'It breaks.', '', '## Proposed cause', '', PROPOSED_CODE, ''].join('\n');

/** A tracker holding one open bug, recording the types it was asked to list. */
function bugTracker(lists: string[]): Tracker {
  const open: OpenIssue = {
    ref: { opt: 0, kind: EMPTY_KIND, externalId: BUG_NUMBER, url: null },
    title: BUG_TITLE,
    body: BUG_BODY,
    createdAt: null,
  };
  return {
    ...emptyTracker(),
    openIssues: (type: string) => {
      lists.push(type);
      return Promise.resolve([open]);
    },
  };
}

/** Seams whose registry holds the bug tracker; `lists` records its listings. */
function bugSeams(lists: string[]): IssueSeams {
  return {
    registry: createAdapterRegistry([
      { port: 'tracker', kind: EMPTY_KIND, portVersion: PORT_VERSIONS.tracker, create: () => bugTracker(lists) },
    ]),
  };
}

/** `rafa bug codes <words>` run over `seams`. */
async function ranOver(seams: IssueSeams, words: readonly string[]): Promise<CapturedRun> {
  return dispatchInProject(['bug', 'codes', ...words], SUBJECTS, [createCodesCommand(seams)], freshProject());
}

/** A project config adding one code in a family of the project's own. */
const DEPLOY_CONFIG = [
  projectConfigText(),
  TRACKER_CONFIG,
  'errors:',
  '  codes:',
  '    - code: deploy:missing-secret',
  '      description: a deploy reads an unset secret',
  '      hint: set the secret',
  '      level: error',
  '      since: v1',
  '',
].join('\n');

/** A project config whose one code reads like rafa's `git:no-identity`. */
const NEAR_DUPLICATE_CONFIG = [
  projectConfigText(),
  TRACKER_CONFIG,
  'errors:',
  '  codes:',
  '    - code: git:no-author',
  '      description: a git commit runs with no author identity set, often in a scratch home',
  '      hint: set the author',
  '      level: error',
  '      since: v1',
  '',
].join('\n');

/** The scaffold's project config, the planted tracker its chain's default. */
const BASE_CONFIG = [projectConfigText(), TRACKER_CONFIG].join('\n');

/** A fresh project, holding `text` as its config, {@link BASE_CONFIG} when none is given. */
function freshProject(text: string = BASE_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), text);
}

/** `rafa bug codes <words>` run in `project`. */
async function ran(words: readonly string[], project: PlantedProject = freshProject()): Promise<CapturedRun> {
  return dispatchInProject(['bug', 'codes', ...words], SUBJECTS, [createCodesCommand(SEAMS)], project);
}

describe('rafa bug codes', () => {
  it('lists rafa\'s families and codes, then the new-context line', async () => {
    const run = await ran([]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('git (2): running git');
    expect(run.stdout).toContain('  git:no-identity  a git commit runs with no author identity set, often in a scratch home');
    const lines = run.stdout.trimEnd().split('\n');

    expect(lines.at(-1))
      .toBe('Every family also takes <family>:new-context; unknown:new-context is the last resort.');
  });

  it('lists a project code under its own family, marked as the project\'s', async () => {
    const run = await ran([], freshProject(DEPLOY_CONFIG));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('deploy (1): (project)');
    expect(run.stdout).toContain('  deploy:missing-secret  a deploy reads an unset secret');
  });

  it('prints only the family --family names', async () => {
    const run = await ran(['--family=git']);
    const codes = run.stdout.split('\n').filter((line) => line.startsWith('  '));

    expect(run.exitCode).toBe(0);
    expect(codes.map((line) => line.trim().split(' ')[0])).toEqual(['git:no-identity', 'git:filesystem-boundary']);
  });

  it('refuses a family nobody declares, naming the ones that exist', async () => {
    const run = await ran(['--family=nope']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ No family "nope". Families: api, cli, config, fs, git, input, skill, spawn, tracker, tsc');
    expect(run.stdout).toBe('');
  });
});

describe('rafa bug codes --suggest', () => {
  it('ranks the closest code first, with its share of the text', async () => {
    const run = await ran(['--suggest=git commit has no author identity']);
    const lines = run.stdout.trimEnd().split('\n');

    expect(run.exitCode).toBe(0);
    expect(lines[0]).toBe('Closest codes for "git commit has no author identity":');
    expect(lines[1]).toBe('  git:no-identity  100%  a git commit runs with no author identity set, often in a scratch home');
  });

  it('says so when no code shares a word, and still exits 0', async () => {
    const run = await ran(['--suggest=quantum flux']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.trimEnd()).toBe('No code matches "quantum flux". File it as <family>:new-context with a proposed leaf.');
  });

  it('says so for an everyday sentence about a cause the list lacks', async () => {
    const run = await ran(['--suggest=the database connection pool is exhausted']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.trimEnd())
      .toBe('No code matches "the database connection pool is exhausted". File it as <family>:new-context with a proposed leaf.');
  });

  it('refuses --suggest beside --check, which answer two different questions', async () => {
    const run = await ran(['--suggest=git', '--check']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ --suggest and --check answer two questions: give one');
    expect(run.stdout).toBe('');
  });

  it('refuses a blank --suggest', async () => {
    const run = await ran(['--suggest= ']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--suggest cannot be blank');
  });
});

describe('rafa bug codes --suggest over a tracker holding a bug that proposes a code', () => {
  const PROPOSAL_LINE = `  ${PROPOSED_CODE}  100%  proposed by ${EMPTY_KIND} issue ${BUG_NUMBER}`;

  it('lists the proposal naming the issue in text mode', async () => {
    const lists: string[] = [];
    const run = await ranOver(bugSeams(lists), ['--suggest=branch not found']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.split('\n')).toContain(PROPOSAL_LINE);
    expect(lists).toEqual(['bug']);
  });

  it('carries the proposal and its issue in the json suggestions', async () => {
    const run = await ranOver(bugSeams([]), ['--suggest=branch not found', '--output=json']);
    const result = eventsOf(run.stdout).at(-1);
    const data = result?.type === 'result'
      ? result.data as { suggestions: { code: string; issue: { externalId: string } | null }[] }
      : undefined;
    const row = data?.suggestions.find((entry) => entry.code === PROPOSED_CODE);

    expect(run.exitCode).toBe(0);
    expect(row?.issue?.externalId).toBe(BUG_NUMBER);
  });

  it('lists none and reads no tracker under --no-proposals', async () => {
    const lists: string[] = [];
    const run = await ranOver(bugSeams(lists), ['--suggest=branch not found', '--no-proposals']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).not.toContain(PROPOSED_CODE);
    expect(run.stdout).not.toContain('proposed by');
    expect(lists).toEqual([]);
  });

  it('warns and prints the suggestions without proposals when the chain lands nowhere', async () => {
    const nowhere: IssueSeams = { registry: createAdapterRegistry([]) };
    const run = await ranOver(nowhere, ['--suggest=git commit has no author identity']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('  git:no-identity  100%');
    expect(run.stdout).not.toContain('proposed by');
    expect(run.stdout).toContain('warn: bug codes: suggesting without the open bugs\' proposals: tracker chain: no tracker available');
  });

  it('refuses --no-proposals without --suggest', async () => {
    const lists: string[] = [];
    const run = await ranOver(bugSeams(lists), ['--no-proposals']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--no-proposals only narrows --suggest: give both or neither');
    expect(run.stdout).toBe('');
    expect(lists).toEqual([]);
  });
});

describe('rafa bug codes --check', () => {
  it('exits 0 over a list whose leaves all read apart', async () => {
    const run = await ran(['--check']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.trimEnd()).toBe('No two codes of one family read alike.');
  });

  it('exits 1 naming each pair that reads alike', async () => {
    const run = await ran(['--check'], freshProject(NEAR_DUPLICATE_CONFIG));

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain('  git:no-identity ~ git:no-author  ');
    expect(run.stderr).toContain('❌ rafa bug codes --check: 1 pair of codes reads alike');
  });
});

describe('rafa bug codes --output=json', () => {
  it('carries the pairs --check found in an event, since the refusal that follows carries no data', async () => {
    const run = await ran(['--check', '--output=json'], freshProject(NEAR_DUPLICATE_CONFIG));
    const events = eventsOf(run.stdout);
    const found = events.find((event) => event.type === 'event');
    const pairs = found?.type === 'event'
      ? found.data.nearDuplicates
      : undefined;

    expect(run.exitCode).toBe(1);
    expect(found?.type === 'event' && found.name).toBe('bug-codes-alike');
    expect(pairs).toEqual([{ first: 'git:no-identity', second: 'git:no-author', score: 1 }]);
    expect(events.at(-1)).toMatchObject({ type: 'result', ok: false });
  });

  it('answers the report as the result, both sources in it', async () => {
    const run = await ran(['--output=json'], freshProject(DEPLOY_CONFIG));
    const result = eventsOf(run.stdout).at(-1);
    const data = result?.type === 'result'
      ? result.data as { codes: { code: string; source: string }[]; suggestions: unknown; nearDuplicates: unknown }
      : undefined;

    expect(run.exitCode).toBe(0);
    expect(data?.codes.find((row) => row.code === 'git:no-identity')?.source).toBe('rafa');
    expect(data?.codes.find((row) => row.code === 'deploy:missing-secret')?.source).toBe('project');
    expect(data?.suggestions).toBeNull();
    expect(data?.nearDuplicates).toBeNull();
  });
});
