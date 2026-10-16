/**
 * Tests for the level 3 tag workflow template
 * (`./templates/release-tag.yml`, `RELEASE_TAG_FILE` in `./templates.ts`):
 * its trigger, the guard on its tag job, its permissions, the checkout
 * of the base branch at the merge commit, the tag step and the publish
 * job it calls.
 *
 * The workflow is read with `Bun.YAML.parse`, so a case holds the keys
 * GitHub reads rather than a substring of the text. The step moving the
 * checkout to the merge commit runs under bash in a temporary git
 * repository, and the tag step's script runs under bash with a fake
 * `bun` and `rafa` first on PATH, each recording its arguments, so the
 * checkout-or-installed branch is read off what ran. Every write goes
 * under this file's own temporary root.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { isMapping } from '@open-tomato/rafa/core/config/sections';

import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { TAG_WORKFLOW } from './ladder.js';
import { RELEASE_PR_BRANCH } from './settle-pr.js';
import { RELEASE_PUBLISH_FILE, RELEASE_TAG_FILE, readReleaseTemplate, writeReleaseWorkflow } from './templates.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-tag-template-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The merge commit of the pull request whose close ran the workflow. */
const MERGE_COMMIT = '${{ github.event.pull_request.merge_commit_sha }}';

/** The value at `path` in a parsed document, or undefined when a step is not a mapping. */
function at(document: unknown, path: readonly string[]): unknown {
  let value: unknown = document;
  for (const key of path) {
    if (!isMapping(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** The shipped tag workflow, parsed. */
function tagWorkflow(): unknown {
  return Bun.YAML.parse(readReleaseTemplate(RELEASE_TAG_FILE));
}

/** The tag job's steps, each a mapping. */
function tagSteps(): Record<string, unknown>[] {
  const steps = at(tagWorkflow(), ['jobs', 'tag', 'steps']);
  return Array.isArray(steps)
    ? steps.filter(isMapping)
    : [];
}

/** The tag job's step named `name`, or undefined. */
function stepNamed(name: string): Record<string, unknown> | undefined {
  return tagSteps().find((step) => step['name'] === name);
}

/** Runs git in `cwd` with no config of the operator's, and answers its trimmed stdout. */
function git(cwd: string, home: string, args: readonly string[]): string {
  const run = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { TMPDIR: tmpdir(), PATH: process.env['PATH'] ?? '', ...scratchHomeEnv(home) },
  });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

describe('the shipped tag workflow', () => {
  it('runs on a closed pull request alone, and grants the workflow contents: write', () => {
    const workflow = tagWorkflow();

    expect(at(workflow, ['on'])).toEqual({ pull_request: { types: ['closed'] } });
    expect(at(workflow, ['permissions'])).toEqual({ contents: 'write' });
  });

  it('tags only when the pull request merged from rafa/release of this repository', () => {
    const guard = String(at(tagWorkflow(), ['jobs', 'tag', 'if']));
    const clauses = guard.split('&&').map((clause) => clause.trim());

    expect(clauses).toEqual([
      'github.event.pull_request.merged == true',
      `github.event.pull_request.head.ref == '${RELEASE_PR_BRANCH}'`,
      'github.event.pull_request.head.repo.full_name == github.repository',
    ]);
  });

  it('checks the base branch out with full history, and sets up bun from package.json', () => {
    expect(at(stepNamed('Checkout'), ['uses'])).toBe('actions/checkout@v4');
    expect(at(stepNamed('Checkout'), ['with'])).toEqual({
      'ref': '${{ github.event.pull_request.base.ref }}',
      'fetch-depth': 0,
    });
    expect(at(stepNamed('Set up bun'), ['uses'])).toBe('oven-sh/setup-bun@v2');
    expect(at(stepNamed('Set up bun'), ['with', 'bun-version-file'])).toBe('package.json');
  });

  it('runs its steps in order: checkout, the move to the merge commit, bun, then the tag', () => {
    expect(tagSteps().map((step) => step['name'])).toEqual(['Checkout', 'Move to the merge commit', 'Set up bun', 'Tag']);
  });

  it('calls the publish workflow after the tag job, with the merge commit as ref and the id token granted', () => {
    const publish = at(tagWorkflow(), ['jobs', 'publish']);

    expect(publish).toEqual({
      'needs': 'tag',
      'permissions': { 'contents': 'read', 'id-token': 'write' },
      'uses': `./.github/workflows/${RELEASE_PUBLISH_FILE}`,
      'with': { ref: MERGE_COMMIT },
      'secrets': 'inherit',
    });
    // The called workflow takes the input the call passes.
    const called = Bun.YAML.parse(readReleaseTemplate(RELEASE_PUBLISH_FILE));
    expect(Object.keys(at(called, ['on', 'workflow_call', 'inputs']) as object)).toEqual(['ref']);
  });

  it('is the file the ladder names for level 3, and writes byte for byte', () => {
    const root = mkdtempSync(join(tempBase, 'write-'));

    const part = writeReleaseWorkflow(root, RELEASE_TAG_FILE);

    expect(TAG_WORKFLOW.file).toBe(RELEASE_TAG_FILE);
    expect(part.outcome).toBe('created');
    expect(readFileSync(join(root, TAG_WORKFLOW.path), 'utf8')).toBe(readReleaseTemplate(RELEASE_TAG_FILE));
  });
});

describe.skipIf(Bun.which('bash') === null)('the move to the merge commit', () => {
  it('leaves the base branch checked out, at the merge commit rather than the branch\'s newer head', () => {
    const root = mkdtempSync(join(tempBase, 'move-'));
    const repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, root, ['init', '-q', '-b', 'main']);
    git(repo, root, ['commit', '-q', '--allow-empty', '-m', 'the merge']);
    const merge = git(repo, root, ['rev-parse', 'HEAD']);
    git(repo, root, ['commit', '-q', '--allow-empty', '-m', 'a later merge']);
    // The control: before the step, HEAD is not the merge commit.
    expect(git(repo, root, ['rev-parse', 'HEAD'])).not.toBe(merge);

    const step = stepNamed('Move to the merge commit');
    expect(at(step, ['env'])).toEqual({ MERGE_COMMIT });
    const run = Bun.spawnSync(['bash', '-e', '-c', String(at(step, ['run']))], {
      cwd: repo,
      env: { TMPDIR: tmpdir(), PATH: process.env['PATH'] ?? '', ...scratchHomeEnv(root), MERGE_COMMIT: merge },
    });

    expect(run.exitCode).toBe(0);
    expect(git(repo, root, ['rev-parse', 'HEAD'])).toBe(merge);
    expect(git(repo, root, ['branch', '--show-current'])).toBe('main');
  });
});

/** What one run of the tag step's script did: the commands the fakes recorded, and its exit. */
interface TagRun {
  readonly calls: readonly string[];
  readonly exitCode: number;
}

/**
 * Runs the tag step's script under bash in a new git repository whose
 * manifest names `name`, with `src/rafa.ts` tracked when `tracked` and
 * present but untracked otherwise, and a fake `bun` and `rafa` first on
 * PATH.
 */
function runTagStep(name: string, tracked: boolean): TagRun {
  const root = mkdtempSync(join(tempBase, 'step-'));
  const repo = join(root, 'repo');
  const fakes = join(root, 'bin');
  const log = join(root, 'calls.log');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(fakes);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name }), 'utf8');
  writeFileSync(join(repo, 'src', 'rafa.ts'), '', 'utf8');
  for (const tool of ['bun', 'rafa']) {
    writeFileSync(join(fakes, tool), `#!/bin/sh\necho "${tool} $*" >> "${log}"\n`, 'utf8');
    chmodSync(join(fakes, tool), 0o755);
  }
  writeFileSync(log, '', 'utf8');
  Bun.spawnSync(['git', 'init', '-q'], { cwd: repo });
  if (tracked) Bun.spawnSync(['git', 'add', 'src/rafa.ts'], { cwd: repo });

  const run = Bun.spawnSync(['bash', '-e', '-c', String(stepNamed('Tag')?.['run'])], {
    cwd: repo,
    env: {
      TMPDIR: tmpdir(),
      PATH: `${fakes}:${process.env['PATH'] ?? ''}`,
      ...scratchHomeEnv(root),
      BUN_INSTALL: join(root, 'bun-home'),
    },
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
  return { calls, exitCode: run.exitCode };
}

describe.skipIf(Bun.which('node') === null || Bun.which('bash') === null)('the tag step', () => {
  it('installs from the lockfile and runs rafa from the checkout when the project is rafa and git tracks src/rafa.ts', () => {
    expect(runTagStep('@open-tomato/rafa', true)).toEqual({
      calls: ['bun install --frozen-lockfile', 'bun src/rafa.ts release tag --push --output=json'],
      exitCode: 0,
    });
  });

  it('installs rafa globally and runs it when src/rafa.ts is not tracked, or the project is another', () => {
    const installed = ['bun install -g @open-tomato/rafa', 'rafa release tag --push --output=json'];

    expect(runTagStep('@open-tomato/rafa', false)).toEqual({ calls: installed, exitCode: 0 });
    expect(runTagStep('some-package', true)).toEqual({ calls: installed, exitCode: 0 });
  });
});
