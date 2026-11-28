/**
 * `release.packageFragments` across the modules it has to hold together:
 * the config file a project writes, `rafa release fragment` reading it,
 * and the bot fragment workflow, which runs that command in a project
 * whose setting it does not know.
 *
 * One command line, `--package=@scope/x` among its words, is dispatched
 * in a temporary git repository with an origin, once under `refuse` and
 * once under `allow`. The two fixtures differ in that one config value,
 * so the `allow` run is the control that the refusal comes from the key:
 * the package, the plan and the base are all good.
 *
 * The workflow is read twice, as the template rafa ships and as this
 * repository's copy under `.github/workflows/`, and its `release fragment`
 * invocations must carry no `--package`, so a bot's fragment is a root
 * one, which `refuse` takes. The reading counts the invocations it found
 * and is run over a planted script holding `--package`, so an empty or
 * blind match cannot pass.
 */
import type { PlantedProject } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { isMapping } from '@open-tomato/rafa/core/config/sections';
import { parseFragment } from '@open-tomato/rafa/release/fragment';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';
import { createReleaseFragmentCommand } from '@open-tomato/rafa-release/commands/release/fragment';
import { BOT_FRAGMENT_WORKFLOW } from '@open-tomato/rafa-release/release/ladder';
import { RELEASE_BOT_FRAGMENT_FILE, readReleaseTemplate } from '@open-tomato/rafa-release/release/templates';

import { dispatchInProject, plantProjectConfig } from './cli-capture.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-package-setting-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The words after `release fragment`, the same under both settings. */
const PACKAGE_LINE: readonly string[] = [
  '--plan=rafa-12', '--level=patch', '--title=Package change', '--note=x: a change', '--package=@scope/x',
];

/** What the fixture's `main` holds: a workspace with the publishable `@scope/x`. */
const SEED: Readonly<Record<string, string>> = {
  'package.json': '{\n  "name": "demo",\n  "version": "0.25.0",\n  "workspaces": ["packages/*"]\n}\n',
  'packages/x/package.json': '{\n  "name": "@scope/x",\n  "version": "0.1.0"\n}\n',
};

/**
 * A git repository cloned from a bare origin holding {@link SEED}, with an
 * empty `.changes/` and a config setting `release.packageFragments` to `mode`.
 */
function fixture(mode: 'allow' | 'refuse'): PlantedProject {
  const dir = mkdtempSync(join(tempBase, `${mode}-`));
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const root = join(dir, 'project');
  mkdirSync(home);
  const env = { TMPDIR: tmpdir(), PATH: process.env['PATH'] ?? '', ...scratchHomeEnv(home), ...gitIdentityEnv() };
  const git = (cwd: string, args: readonly string[]): void => {
    execFileSync('git', [...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, root]);
  for (const [path, text] of Object.entries(SEED)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'first']);
  git(root, ['push', '-q', 'origin', 'main']);

  mkdirSync(join(root, '.changes'));
  plantProjectConfig(root, `release:\n  versionFile: package.json\n  packageFragments: ${mode}\n`);
  return { root, home };
}

/** Dispatches `rafa release fragment` with {@link PACKAGE_LINE} in `project`. */
async function ranPackageLine(project: PlantedProject): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return dispatchInProject(
    ['release', 'fragment', ...PACKAGE_LINE],
    [{ name: 'release', summary: 'releases' }],
    [createReleaseFragmentCommand({ cwd: () => project.root })],
    project,
  );
}

/**
 * Each `release fragment` invocation in the `run` scripts of the workflow
 * `text`, backslash continuations joined and shell comments left out.
 */
function fragmentInvocations(text: string): readonly string[] {
  const document: unknown = Bun.YAML.parse(text);
  const jobs = isMapping(document) && isMapping(document['jobs'])
    ? Object.values(document['jobs'])
    : [];
  return jobs
    .flatMap((job) => isMapping(job) && Array.isArray(job['steps'])
      ? job['steps']
      : [])
    .flatMap((step) => isMapping(step) && typeof step['run'] === 'string'
      ? step['run'].replaceAll('\\\n', ' ').split('\n')
      : [])
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#') && /\brafa(\.ts)? release fragment\b/.test(line));
}

describe('rafa release fragment --package under a project\'s release.packageFragments', () => {
  it('exits 1 under refuse, naming the key, and leaves .changes/ empty', async () => {
    const project = fixture('refuse');

    const run = await ranPackageLine(project);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('release.packageFragments is refuse (');
    expect(run.stderr).toContain('this project takes no package fragments; drop --package');
    expect(readdirSync(join(project.root, '.changes'))).toEqual([]);
  });

  it('writes the fragment for the same line under allow', async () => {
    const project = fixture('allow');

    const run = await ranPackageLine(project);

    expect(run.exitCode).toBe(0);
    expect(readdirSync(join(project.root, '.changes'))).toEqual(['rafa-12.md']);
    expect(parseFragment(readFileSync(join(project.root, '.changes', 'rafa-12.md'), 'utf8'))).toEqual({
      ok: true,
      fragment: { plan: 'rafa-12', title: 'Package change', level: 'patch', package: '@scope/x', notes: ['- x: a change'] },
    });
  });
});

describe('the bot fragment workflow\'s release fragment line', () => {
  const copies: readonly (readonly [string, () => string])[] = [
    ['the shipped template', () => readReleaseTemplate(RELEASE_BOT_FRAGMENT_FILE)],
    ['this repository\'s .github/workflows/ copy', () => readFileSync(join(REPO_ROOT, BOT_FRAGMENT_WORKFLOW.path), 'utf8')],
  ];

  it.each(copies)('carries no --package in %s', (_name, read) => {
    const invocations = fragmentInvocations(read());

    // Two runners: the checkout's `bun src/rafa.ts` and the installed `rafa`.
    expect(invocations).toHaveLength(2);
    expect(invocations.filter((line) => line.includes('bun src/rafa.ts release fragment'))).toHaveLength(1);
    expect(invocations.filter((line) => line.includes('(rafa release fragment'))).toHaveLength(1);
    for (const line of invocations) {
      expect(line).toContain('--plan=');
      expect(line).not.toContain('--package');
    }
  });

  it('would see a --package, one on a continuation line included', () => {
    const planted = [
      'jobs:',
      '  fragment:',
      '    steps:',
      '      - run: |',
      '          # rafa release fragment --package=@scope/comment',
      '          rafa release fragment --plan=p \\',
      '            --package=@scope/x',
      '',
    ].join('\n');

    const invocations = fragmentInvocations(planted);

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toContain('--package=@scope/x');
  });
});
