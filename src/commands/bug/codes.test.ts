/**
 * Tests for `rafa bug codes`: the list, `--family`, `--suggest`,
 * `--check` and the json result, each dispatched in-process over a
 * planted project, so the config the command reads is the file a case
 * wrote. Every line and refusal is SPELLED here, never read off the
 * module.
 */
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { projectConfigText } from '../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createCodesCommand } from './codes.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-bug-codes-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command sits under, for the registry a case dispatches over. */
const SUBJECTS = [{ name: 'bug', summary: 'cause codes for bugs' }];

/** A project config adding one code in a family of the project's own. */
const DEPLOY_CONFIG = [
  projectConfigText(),
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
  'errors:',
  '  codes:',
  '    - code: git:no-author',
  '      description: a git commit runs with no author identity set, often in a scratch home',
  '      hint: set the author',
  '      level: error',
  '      since: v1',
  '',
].join('\n');

/** A fresh project, holding `text` as its config when given. */
function freshProject(text?: string): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), text);
}

/** `rafa bug codes <words>` run in `project`. */
async function ran(words: readonly string[], project: PlantedProject = freshProject()): Promise<CapturedRun> {
  return dispatchInProject(['bug', 'codes', ...words], SUBJECTS, [createCodesCommand()], project);
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
