/**
 * Tests for the release ladder's workflow templates (`templates.ts`):
 * the shipped publish workflow read as YAML, where a template is looked
 * for in a checkout and in a build, and the file it is written to.
 *
 * The workflow is read with `Bun.YAML.parse`, so a case holds the keys
 * GitHub reads rather than a substring of the text. Its gate steps are
 * held to `.github/workflows/verify.yml`'s own, parsed the same way, so
 * the two cannot drift apart. The publish step's script is run under
 * bash in a temporary git repository with a fake `bun` and `rafa` first
 * on PATH, each recording its arguments, so the checkout-or-installed
 * branch is read off what ran rather than off the script's text. Every
 * write goes under this file's own temporary root.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { isMapping } from '@open-tomato/rafa/core/config/sections';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';

import {
  RELEASE_PUBLISH_FILE,
  RELEASE_TEMPLATES_DIRNAME,
  readReleaseTemplate,
  releaseTemplateSource,
  writeReleaseWorkflow,
} from './templates.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-templates-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Where the publish workflow is written, under a project root. */
const PUBLISH_PATH = join('.github', 'workflows', RELEASE_PUBLISH_FILE);

/** The repository's own verify workflow, whose gate steps the publish workflow repeats. */
const VERIFY_PATH = join(import.meta.dir, '..', '..', '.github', 'workflows', 'verify.yml');

/** The names of the gate steps both workflows run. */
const GATE_STEPS = ['Test', 'Lint', 'Types'];

/** The value at `path` in a parsed document, or undefined when a step is not a mapping. */
function at(document: unknown, path: readonly string[]): unknown {
  let value: unknown = document;
  for (const key of path) {
    if (!isMapping(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** The steps of `job` in a parsed workflow, each a mapping. */
function stepsOf(workflow: unknown, job: string): Record<string, unknown>[] {
  const steps = at(workflow, ['jobs', job, 'steps']);
  return Array.isArray(steps)
    ? steps.filter(isMapping)
    : [];
}

/** The step named `name`, or undefined. */
function stepNamed(steps: readonly Record<string, unknown>[], name: string): Record<string, unknown> | undefined {
  return steps.find((step) => step['name'] === name);
}

/** The shipped publish workflow's steps, parsed. */
function publishSteps(): Record<string, unknown>[] {
  return stepsOf(Bun.YAML.parse(readReleaseTemplate(RELEASE_PUBLISH_FILE)), 'publish');
}

describe('the shipped publish workflow', () => {
  it('runs on any pushed tag and on a workflow_call naming a ref, reading contents and minting an id token', () => {
    const workflow = Bun.YAML.parse(readReleaseTemplate(RELEASE_PUBLISH_FILE));

    expect(at(workflow, ['on', 'push'])).toEqual({ tags: ['**'] });
    expect(at(workflow, ['on', 'workflow_call', 'inputs', 'ref', 'type'])).toBe('string');
    expect(at(workflow, ['on', 'workflow_call', 'inputs', 'ref', 'required'])).toBe(true);
    expect(at(workflow, ['permissions'])).toEqual({ 'contents': 'read', 'id-token': 'write' });
  });

  it('checks out the ref or the pushed tag, and sets up bun from package.json and node 24 for the registry', () => {
    const steps = publishSteps();

    expect(at(stepNamed(steps, 'Checkout'), ['uses'])).toBe('actions/checkout@v4');
    expect(at(stepNamed(steps, 'Checkout'), ['with', 'ref'])).toBe('${{ inputs.ref || github.ref }}');
    expect(at(stepNamed(steps, 'Set up bun'), ['uses'])).toBe('oven-sh/setup-bun@v2');
    expect(at(stepNamed(steps, 'Set up bun'), ['with', 'bun-version-file'])).toBe('package.json');
    expect(at(stepNamed(steps, 'Set up node'), ['uses'])).toBe('actions/setup-node@v4');
    expect(at(stepNamed(steps, 'Set up node'), ['with', 'node-version'])).toBe(24);
    expect(at(stepNamed(steps, 'Set up node'), ['with', 'registry-url'])).toBe('https://registry.npmjs.org');
  });

  it('upgrades npm to its latest release after node is set up, then installs from the frozen lockfile', () => {
    const steps = publishSteps();
    const names = steps.map((step) => step['name']);

    expect(String(at(stepNamed(steps, 'Upgrade npm'), ['run']))).toContain('npm install -g npm@latest');
    expect(names.indexOf('Upgrade npm')).toBeGreaterThan(names.indexOf('Set up node'));
    expect(at(stepNamed(steps, 'Install'), ['run'])).toBe('bun install --frozen-lockfile');
  });

  it('runs the gate steps of verify.yml as they are there, and publishes only after them', () => {
    const steps = publishSteps();
    const verify = stepsOf(Bun.YAML.parse(readFileSync(VERIFY_PATH, 'utf8')), 'verify');
    const names = steps.map((step) => step['name']);

    expect(GATE_STEPS.map((name) => stepNamed(steps, name))).toEqual(GATE_STEPS.map((name) => stepNamed(verify, name)));
    expect(GATE_STEPS.every((name) => stepNamed(steps, name) !== undefined)).toBe(true);
    expect(names.at(-1)).toBe('Publish');
    expect(stepNamed(steps, 'Publish')?.['if']).toBeUndefined();
  });

  it('writes the CI config under bash after the gate steps, as the step straight before Publish', () => {
    const steps = publishSteps();
    const names = steps.map((step) => step['name']);
    const written = names.indexOf('Write the CI config');

    expect(at(stepNamed(steps, 'Write the CI config'), ['shell'])).toBe('bash');
    expect(stepNamed(steps, 'Write the CI config')?.['if']).toBeUndefined();
    expect(GATE_STEPS.every((name) => names.indexOf(name) !== -1 && names.indexOf(name) < written)).toBe(true);
    expect(names.indexOf('Publish')).toBe(written + 1);
  });

  it('refuses, naming both places, a directory the build dropped the workflow from', () => {
    const empty = mkdtempSync(join(tempBase, 'no-build-'));

    expect(() => readReleaseTemplate(RELEASE_PUBLISH_FILE, empty)).toThrow(
      `no file at ${join(empty, RELEASE_TEMPLATES_DIRNAME, RELEASE_PUBLISH_FILE)} or ${join(empty, 'templates', RELEASE_PUBLISH_FILE)}`,
    );
  });
});

/** What one run of the publish step's script did: the commands the fakes recorded, and its exit. */
interface PublishRun {
  readonly calls: readonly string[];
  readonly exitCode: number;
}

/**
 * Runs the publish step's script under bash in a new git repository
 * whose manifest names `name`, with `src/rafa.ts` tracked when `tracked`
 * and present but untracked otherwise, and a fake `bun` and `rafa`
 * first on PATH.
 */
function runPublishStep(name: string, tracked: boolean): PublishRun {
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

  const script = String(stepNamed(publishSteps(), 'Publish')?.['run']);
  const run = Bun.spawnSync(['bash', '-e', '-c', script], {
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

describe.skipIf(Bun.which('node') === null || Bun.which('bash') === null)('the publish step', () => {
  it('runs rafa from the checkout when the project is rafa and git tracks src/rafa.ts', () => {
    expect(runPublishStep('@open-tomato/rafa', true)).toEqual({ calls: ['bun src/rafa.ts release publish'], exitCode: 0 });
  });

  it('installs rafa globally and runs it when src/rafa.ts is not tracked, or the project is another', () => {
    const installed = ['bun install -g @open-tomato/rafa', 'rafa release publish'];

    expect(runPublishStep('@open-tomato/rafa', false)).toEqual({ calls: installed, exitCode: 0 });
    expect(runPublishStep('some-package', true)).toEqual({ calls: installed, exitCode: 0 });
  });
});

describe('where a template is read from', () => {
  it('reads the checkout\'s templates directory, and a build\'s release-templates directory first', () => {
    const build = mkdtempSync(join(tempBase, 'build-'));
    mkdirSync(join(build, RELEASE_TEMPLATES_DIRNAME));
    mkdirSync(join(build, 'templates'));
    writeFileSync(join(build, RELEASE_TEMPLATES_DIRNAME, RELEASE_PUBLISH_FILE), 'name: built\n', 'utf8');
    writeFileSync(join(build, 'templates', RELEASE_PUBLISH_FILE), 'name: board tree\n', 'utf8');

    expect(releaseTemplateSource(RELEASE_PUBLISH_FILE)).toBe(join(import.meta.dir, 'templates', RELEASE_PUBLISH_FILE));
    expect(releaseTemplateSource(RELEASE_PUBLISH_FILE, build)).toBe(join(build, RELEASE_TEMPLATES_DIRNAME, RELEASE_PUBLISH_FILE));
    expect(readReleaseTemplate(RELEASE_PUBLISH_FILE, build)).toBe('name: built\n');
  });
});

describe('writing a workflow', () => {
  it('writes the shipped bytes under .github/workflows, and leaves them alone the second time', () => {
    const root = mkdtempSync(join(tempBase, 'write-'));

    const first = writeReleaseWorkflow(root, RELEASE_PUBLISH_FILE);
    const again = writeReleaseWorkflow(root, RELEASE_PUBLISH_FILE);

    expect([first.kind, first.name, first.outcome]).toEqual(['template', PUBLISH_PATH, 'created']);
    expect(readFileSync(join(root, PUBLISH_PATH), 'utf8')).toBe(readReleaseTemplate(RELEASE_PUBLISH_FILE));
    expect(again.outcome).toBe('present');
  });

  it('leaves an edited workflow as it is, and refuses a directory at the path', () => {
    const edited = mkdtempSync(join(tempBase, 'edited-'));
    const blocked = mkdtempSync(join(tempBase, 'blocked-'));
    mkdirSync(join(edited, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(edited, PUBLISH_PATH), 'name: mine\n', 'utf8');
    mkdirSync(join(blocked, PUBLISH_PATH), { recursive: true });

    const kept = writeReleaseWorkflow(edited, RELEASE_PUBLISH_FILE);
    const refused = writeReleaseWorkflow(blocked, RELEASE_PUBLISH_FILE);

    expect(kept.outcome).toBe('present');
    expect(readFileSync(join(edited, PUBLISH_PATH), 'utf8')).toBe('name: mine\n');
    expect(refused.outcome).toBe('refused');
    expect(refused.detail).toBe(`${join(blocked, PUBLISH_PATH)} is not a file, so the workflow was not written`);
  });
});
