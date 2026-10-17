/**
 * Tests for the level 4 settle workflow template
 * (`./templates/release-settle.yml`, `RELEASE_SETTLE_FILE` in
 * `./templates.ts`): its trigger, the guard on its settle job, its
 * permissions, the full-history checkout, the git identity, the step
 * writing the CI config before the settle step, the settle step and the
 * publish job it calls.
 *
 * The workflow is read with `Bun.YAML.parse`, so a case holds the keys
 * GitHub reads rather than a substring of the text. The identity step
 * runs under bash in a temporary git repository, and the settle step's
 * script runs under bash with a fake `bun` and `rafa` first on PATH,
 * each recording its arguments and printing a planted settle result, so
 * the checkout-or-installed branch and the `release` output are read off
 * what ran. Every write goes under this file's own temporary root.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { isMapping } from '@open-tomato/rafa/core/config/sections';

import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { SETTLE_WORKFLOW } from './ladder.js';
import { RELEASE_PUBLISH_FILE, RELEASE_SETTLE_FILE, readReleaseTemplate, writeReleaseWorkflow } from './templates.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-template-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The release commit a planted settle result names. */
const RELEASE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** The value at `path` in a parsed document, or undefined when a step is not a mapping. */
function at(document: unknown, path: readonly string[]): unknown {
  let value: unknown = document;
  for (const key of path) {
    if (!isMapping(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** The shipped settle workflow, parsed. */
function settleWorkflow(): unknown {
  return Bun.YAML.parse(readReleaseTemplate(RELEASE_SETTLE_FILE));
}

/** The settle job's steps, each a mapping. */
function settleSteps(): Record<string, unknown>[] {
  const steps = at(settleWorkflow(), ['jobs', 'settle', 'steps']);
  return Array.isArray(steps)
    ? steps.filter(isMapping)
    : [];
}

/** The settle job's step named `name`, or undefined. */
function stepNamed(name: string): Record<string, unknown> | undefined {
  return settleSteps().find((step) => step['name'] === name);
}

/** Runs git in `cwd` with no config of the operator's, and answers its exit code and trimmed stdout. */
function git(cwd: string, home: string, args: readonly string[]): { readonly exitCode: number; readonly out: string } {
  const run = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { TMPDIR: tmpdir(), PATH: process.env['PATH'] ?? '', ...scratchHomeEnv(home) },
  });
  return { exitCode: run.exitCode, out: run.stdout.toString().trim() };
}

describe('the shipped settle workflow', () => {
  it('runs on a push to a branch, one run at a time, and grants the workflow contents: write', () => {
    const workflow = settleWorkflow();

    expect(at(workflow, ['on'])).toEqual({ push: { branches: ['**'] } });
    expect(at(workflow, ['permissions'])).toEqual({ contents: 'write' });
    expect(at(workflow, ['concurrency'])).toEqual({ 'group': 'release-settle', 'cancel-in-progress': false });
  });

  it('settles only on a push to the default branch', () => {
    expect(at(settleWorkflow(), ['jobs', 'settle', 'if'])).toBe('github.ref_name == github.event.repository.default_branch');
  });

  it('checks the pushed branch out with full history, and sets up bun from package.json', () => {
    expect(at(stepNamed('Checkout'), ['uses'])).toBe('actions/checkout@v4');
    expect(at(stepNamed('Checkout'), ['with'])).toEqual({ 'ref': '${{ github.ref_name }}', 'fetch-depth': 0 });
    expect(at(stepNamed('Set up bun'), ['uses'])).toBe('oven-sh/setup-bun@v2');
    expect(at(stepNamed('Set up bun'), ['with', 'bun-version-file'])).toBe('package.json');
  });

  it('runs its steps in order: checkout, the identity, bun, the CI config, then settle, whose output the job carries', () => {
    expect(settleSteps().map((step) => step['name'])).toEqual([
      'Checkout',
      'Set git identity',
      'Set up bun',
      'Write the CI config',
      'Settle',
    ]);
    expect(at(stepNamed('Write the CI config'), ['shell'])).toBe('bash');
    expect(stepNamed('Write the CI config')?.['if']).toBeUndefined();
    expect(at(stepNamed('Settle'), ['id'])).toBe('settle');
    expect(at(settleWorkflow(), ['jobs', 'settle', 'outputs'])).toEqual({ release: '${{ steps.settle.outputs.release }}' });
  });

  it('calls the publish workflow after settle only when it names a release commit, passing it as ref', () => {
    const publish = at(settleWorkflow(), ['jobs', 'publish']);

    expect(publish).toEqual({
      'needs': 'settle',
      'if': 'needs.settle.outputs.release != \'\'',
      'permissions': { 'contents': 'read', 'id-token': 'write' },
      'uses': `./.github/workflows/${RELEASE_PUBLISH_FILE}`,
      'with': { ref: '${{ needs.settle.outputs.release }}' },
      'secrets': 'inherit',
    });
    // The called workflow takes the input the call passes.
    const called = Bun.YAML.parse(readReleaseTemplate(RELEASE_PUBLISH_FILE));
    expect(Object.keys(at(called, ['on', 'workflow_call', 'inputs']) as object)).toEqual(['ref']);
  });

  it('is the file the ladder names for level 4, and writes byte for byte', () => {
    const root = mkdtempSync(join(tempBase, 'write-'));

    const part = writeReleaseWorkflow(root, RELEASE_SETTLE_FILE);

    expect(SETTLE_WORKFLOW.file).toBe(RELEASE_SETTLE_FILE);
    expect(part.outcome).toBe('created');
    expect(readFileSync(join(root, SETTLE_WORKFLOW.path), 'utf8')).toBe(readReleaseTemplate(RELEASE_SETTLE_FILE));
  });
});

describe.skipIf(Bun.which('bash') === null)('the identity step', () => {
  it('sets a user name and email in the repository, where none was set before', () => {
    const root = mkdtempSync(join(tempBase, 'identity-'));
    const repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, root, ['init', '-q']);
    // The control: the scratch home holds no identity, so the reading can fail.
    expect(git(repo, root, ['config', 'user.name']).exitCode).not.toBe(0);

    const run = Bun.spawnSync(['bash', '-e', '-c', String(at(stepNamed('Set git identity'), ['run']))], {
      cwd: repo,
      env: { TMPDIR: tmpdir(), PATH: process.env['PATH'] ?? '', ...scratchHomeEnv(root) },
    });

    expect(run.exitCode).toBe(0);
    expect(git(repo, root, ['config', '--local', 'user.name']).out).toBe('github-actions[bot]');
    expect(git(repo, root, ['config', '--local', 'user.email']).out).toBe('41898282+github-actions[bot]@users.noreply.github.com');
  });
});

/** What one run of the settle step's script did: the commands the fakes recorded, its exit and its step output. */
interface SettleRun {
  readonly calls: readonly string[];
  readonly exitCode: number;
  readonly output: string;
}

/** What the planted settle result says: its delivery's outcome and its tag's. */
interface Planted {
  readonly delivered: string;
  readonly tag: 'tagged' | 'skipped';
}

/** The NDJSON a settle run prints for `planted`: a log event, then its terminal result. */
function settleEvents(planted: Planted): string {
  const tag = planted.tag === 'tagged'
    ? { outcome: 'tagged', exitCode: 0, tags: ['v1.2.0'], commit: RELEASE_COMMIT, sentence: 'Tagged.' }
    : { outcome: 'skipped', exitCode: 0, reason: 'manual', sentence: null };
  const data = { dryRun: false, delivery: 'push', delivered: { delivery: 'push', outcome: { outcome: planted.delivered } }, tag };
  return [
    JSON.stringify({ type: 'log', level: 'warn', message: 'a warning', ts: '2026-10-16T00:00:00.000Z' }),
    JSON.stringify({ type: 'result', ok: true, data, ts: '2026-10-16T00:00:00.000Z' }),
  ].join('\n');
}

/**
 * Runs the settle step's script under bash in a new git repository whose
 * manifest names `name`, with `src/rafa.ts` tracked when `tracked` and
 * present but untracked otherwise, and a fake `bun` and `rafa` first on
 * PATH that print `planted`'s events for a settle.
 */
function runSettleStep(name: string, tracked: boolean, planted: Planted): SettleRun {
  const root = mkdtempSync(join(tempBase, 'step-'));
  const repo = join(root, 'repo');
  const fakes = join(root, 'bin');
  const runnerTemp = join(root, 'runner-temp');
  const log = join(root, 'calls.log');
  const events = join(root, 'events.ndjson');
  const output = join(root, 'github-output');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(fakes);
  mkdirSync(runnerTemp);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name }), 'utf8');
  writeFileSync(join(repo, 'src', 'rafa.ts'), '', 'utf8');
  writeFileSync(events, `${settleEvents(planted)}\n`, 'utf8');
  for (const tool of ['bun', 'rafa']) {
    const script = `#!/bin/sh\necho "${tool} $*" >> "${log}"\ncase "$*" in *'release settle'*) cat "${events}" ;; esac\n`;
    writeFileSync(join(fakes, tool), script, 'utf8');
    chmodSync(join(fakes, tool), 0o755);
  }
  writeFileSync(log, '', 'utf8');
  writeFileSync(output, '', 'utf8');
  Bun.spawnSync(['git', 'init', '-q'], { cwd: repo });
  if (tracked) Bun.spawnSync(['git', 'add', 'src/rafa.ts'], { cwd: repo });

  const run = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', String(stepNamed('Settle')?.['run'])], {
    cwd: repo,
    env: {
      TMPDIR: tmpdir(),
      PATH: `${fakes}:${process.env['PATH'] ?? ''}`,
      ...scratchHomeEnv(root),
      BUN_INSTALL: join(root, 'bun-home'),
      RUNNER_TEMP: runnerTemp,
      GITHUB_OUTPUT: output,
    },
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
  return { calls, exitCode: run.exitCode, output: readFileSync(output, 'utf8') };
}

describe.skipIf(Bun.which('node') === null || Bun.which('bash') === null)('the settle step', () => {
  const tagged: Planted = { delivered: 'pushed', tag: 'tagged' };

  it('installs from the lockfile and runs rafa from the checkout when the project is rafa and git tracks src/rafa.ts', () => {
    expect(runSettleStep('@open-tomato/rafa', true, tagged)).toEqual({
      calls: ['bun install --frozen-lockfile', 'bun src/rafa.ts release settle --output=json'],
      exitCode: 0,
      output: `release=${RELEASE_COMMIT}\n`,
    });
  });

  it('installs rafa globally and runs it when src/rafa.ts is not tracked, or the project is another', () => {
    const installed = ['bun install -g @open-tomato/rafa', 'rafa release settle --output=json'];

    expect(runSettleStep('@open-tomato/rafa', false, tagged).calls).toEqual(installed);
    expect(runSettleStep('some-package', true, tagged)).toEqual({
      calls: installed,
      exitCode: 0,
      output: `release=${RELEASE_COMMIT}\n`,
    });
  });

  it('names no release commit when settle pushed nothing, or pushed and wrote no tag', () => {
    for (const planted of [
      { delivered: 'superseded', tag: 'skipped' },
      { delivered: 'unsettled', tag: 'skipped' },
      { delivered: 'pushed', tag: 'skipped' },
    ] as const) {
      expect(runSettleStep('some-package', true, planted)).toMatchObject({ exitCode: 0, output: 'release=\n' });
    }
  });
});
