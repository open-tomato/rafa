/**
 * Tests for the bot fragment workflow template
 * (`./templates/release-bot-fragment.yml`, `RELEASE_BOT_FRAGMENT_FILE` in
 * `./templates.ts`): its trigger, the guard on its job, its permissions,
 * the metadata step, the two checkouts, that no step runs the head
 * branch's code, the step writing the CI config in `base/` before the
 * write, and the three scripts: the look for a fragment already on the
 * branch, the write, and the commit pushed to the head branch, which
 * stages the fragment alone with the written config beside it.
 *
 * The workflow is read with `Bun.YAML.parse`, so a case holds the keys
 * GitHub reads rather than a substring of the text. Each script runs
 * under bash in temporary git repositories, the write with a fake `bun`
 * and `rafa` first on PATH, each recording its arguments one by one and
 * writing a planted fragment, so the level, the title and the
 * checkout-or-installed branch are read off what ran. Every write goes
 * under this file's own temporary root.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isMapping } from '@open-tomato/rafa/core/config/sections';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';
import { afterAll, describe, expect, it } from 'bun:test';

import { BOT_FRAGMENT_WORKFLOW, LADDER_WORKFLOWS } from './ladder.js';
import { RELEASE_BOT_FRAGMENT_FILE, readReleaseTemplate, writeReleaseWorkflow } from './templates.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-bot-fragment-template-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The pull request number every run below stands for. */
const NUMBER = '7';

/** The fragment the fake rafa writes, relative to the repository root. */
const FRAGMENT = `.changes/dependabot-${NUMBER}.md`;

/** A title a shell would expand if the workflow spliced it into a script. */
const TITLE = 'Bump zod from 3.0.0 to 3.1.0 $(touch pwned) "and" \'quotes\'';

/** The value at `path` in a parsed document, or undefined when a step is not a mapping. */
function at(document: unknown, path: readonly string[]): unknown {
  let value: unknown = document;
  for (const key of path) {
    if (!isMapping(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** The shipped bot fragment workflow, parsed. */
function botWorkflow(): unknown {
  return Bun.YAML.parse(readReleaseTemplate(RELEASE_BOT_FRAGMENT_FILE));
}

/** The fragment job's steps, each a mapping. */
function botSteps(): Record<string, unknown>[] {
  const steps = at(botWorkflow(), ['jobs', 'fragment', 'steps']);
  return Array.isArray(steps)
    ? steps.filter(isMapping)
    : [];
}

/** The fragment job's step named `name`, or undefined. */
function stepNamed(name: string): Record<string, unknown> | undefined {
  return botSteps().find((step) => step['name'] === name);
}

/** The script of the step named `name`. */
function scriptOf(name: string): string {
  return String(stepNamed(name)?.['run']);
}

/** The environment every spawned run below gets, its `HOME` under `root`. */
function envUnder(root: string, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { TMPDIR: tmpdir(), PATH: process.env['PATH'] ?? '', ...scratchHomeEnv(root), ...extra };
}

/** Runs git in `cwd` with no config of the operator's, and answers its trimmed stdout. */
function git(cwd: string, root: string, args: readonly string[]): string {
  const run = Bun.spawnSync(['git', ...args], { cwd, env: envUnder(root) });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

/** Writes `text` at `path` under `dir`, making its parent. */
function put(dir: string, path: string, text: string): void {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text, 'utf8');
}

/** Each `key=value` line a step appended to its `GITHUB_OUTPUT`. */
function outputsOf(file: string): Record<string, string> {
  const lines = existsSync(file)
    ? readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
    : [];
  return Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

/**
 * A bare origin whose `main` holds a lockfile and whose
 * `dependabot/bun/zod` adds a bumped one, and a full clone of it at the
 * head branch.
 */
function headClone(root: string): { origin: string; head: string } {
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const head = join(root, 'head');
  git(root, root, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(root, root, ['init', '-q', '-b', 'main', seed]);
  put(seed, 'bun.lock', 'zod 3.0.0\n');
  git(seed, root, ['add', '-A']);
  git(seed, root, ['commit', '-q', '-m', 'base']);
  git(seed, root, ['checkout', '-q', '-b', 'dependabot/bun/zod']);
  put(seed, 'bun.lock', 'zod 3.1.0\n');
  git(seed, root, ['commit', '-q', '-am', 'bump zod']);
  git(seed, root, ['push', '-q', origin, 'main', 'dependabot/bun/zod']);
  git(root, root, ['clone', '-q', '--branch', 'dependabot/bun/zod', origin, head]);
  return { origin, head };
}

describe('the shipped bot fragment workflow', () => {
  it('runs on a pull request target opened, synchronized or reopened, and grants contents: write and pull-requests: read', () => {
    const workflow = botWorkflow();

    expect(at(workflow, ['on'])).toEqual({ pull_request_target: { types: ['opened', 'synchronize', 'reopened'] } });
    expect(at(workflow, ['permissions'])).toEqual({ 'contents': 'write', 'pull-requests': 'read' });
  });

  it('runs its job only for a pull request Dependabot opened from this repository', () => {
    const guard = String(at(botWorkflow(), ['jobs', 'fragment', 'if']));
    const clauses = guard.split('&&').map((clause) => clause.trim());

    expect(clauses).toEqual([
      'github.actor == \'dependabot[bot]\'',
      'github.event.pull_request.head.repo.full_name == github.repository',
    ]);
  });

  it('runs its steps in order: metadata, the base, the head, the look, bun, the CI config, the write, then the commit', () => {
    expect(botSteps().map((step) => step['name'])).toEqual([
      'Fetch metadata',
      'Checkout the base',
      'Checkout the head',
      'Look for the fragment',
      'Set up bun',
      'Write the CI config',
      'Write the fragment',
      'Commit and push',
    ]);
    expect(at(stepNamed('Write the CI config'), ['shell'])).toBe('bash');
    expect(at(stepNamed('Write the CI config'), ['working-directory'])).toBe('base');
  });

  it('reads the dependency type off dependabot/fetch-metadata into the write', () => {
    expect(stepNamed('Fetch metadata')).toEqual({ name: 'Fetch metadata', id: 'metadata', uses: 'dependabot/fetch-metadata@v3' });
    expect(at(stepNamed('Write the fragment'), ['env', 'DEPENDENCY_TYPE'])).toBe('${{ steps.metadata.outputs.dependency-type }}');
  });

  it('checks the base out under base/ and the head branch under head/ with credentials, both with full history', () => {
    expect(at(stepNamed('Checkout the base'), ['uses'])).toBe('actions/checkout@v7');
    expect(at(stepNamed('Checkout the base'), ['with'])).toEqual({
      'ref': '${{ github.event.pull_request.base.ref }}',
      'path': 'base',
      'fetch-depth': 0,
    });
    expect(at(stepNamed('Checkout the head'), ['uses'])).toBe('actions/checkout@v7');
    expect(at(stepNamed('Checkout the head'), ['with'])).toEqual({
      'ref': '${{ github.event.pull_request.head.ref }}',
      'path': 'head',
      'fetch-depth': 0,
      'persist-credentials': true,
    });
  });

  it('runs nothing of the head branch: bun and rafa come from base/, and the head steps run git alone', () => {
    const runsCode = /\b(bun|bunx|node|npm|npx|yarn|pnpm|rafa|make)\b|\.\//;
    const headSteps = botSteps().filter((step) => step['working-directory'] === 'head');

    expect(headSteps.map((step) => step['name'])).toEqual(['Look for the fragment', 'Commit and push']);
    for (const step of headSteps) expect(String(step['run'])).not.toMatch(runsCode);
    // The control: the write step's script does match, so the check can fail.
    expect(scriptOf('Write the fragment')).toMatch(runsCode);
    expect(at(stepNamed('Write the fragment'), ['working-directory'])).toBe('base');
    expect(at(stepNamed('Set up bun'), ['with', 'bun-version-file'])).toBe('base/package.json');
    expect(botSteps().filter((step) => String(step['uses'] ?? '').startsWith('./'))).toEqual([]);
  });

  it('passes the title, number and branch through env, never spliced into a script', () => {
    for (const step of botSteps()) expect(String(step['run'] ?? '')).not.toContain('${{');
    expect(at(stepNamed('Write the fragment'), ['env', 'PR_TITLE'])).toBe('${{ github.event.pull_request.title }}');
  });

  it('skips bun, the CI config, the write and the commit when the branch already holds the fragment', () => {
    for (const name of ['Set up bun', 'Write the CI config', 'Write the fragment', 'Commit and push']) {
      expect(at(stepNamed(name), ['if'])).toBe('steps.held.outputs.held == \'false\'');
    }
  });

  it('is the bot workflow the ladder names, and writes byte for byte', () => {
    const root = mkdtempSync(join(tempBase, 'write-'));

    const part = writeReleaseWorkflow(root, RELEASE_BOT_FRAGMENT_FILE);

    expect(BOT_FRAGMENT_WORKFLOW.file).toBe(RELEASE_BOT_FRAGMENT_FILE);
    expect(LADDER_WORKFLOWS).toContain(BOT_FRAGMENT_WORKFLOW);
    expect(part.outcome).toBe('created');
    expect(readFileSync(join(root, BOT_FRAGMENT_WORKFLOW.path), 'utf8')).toBe(readReleaseTemplate(RELEASE_BOT_FRAGMENT_FILE));
  });
});

/** Runs the look step in a head clone after `prepare`, and answers its `held` output. */
function look(prepare: (clone: { origin: string; head: string; root: string }) => void): string | undefined {
  const root = mkdtempSync(join(tempBase, 'look-'));
  const clone = headClone(root);
  prepare({ ...clone, root });
  const output = join(root, 'output');

  const run = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', scriptOf('Look for the fragment')], {
    cwd: clone.head,
    env: envUnder(root, { BASE_REF: 'main', PR_NUMBER: NUMBER, GITHUB_OUTPUT: output }),
  });

  expect(run.exitCode).toBe(0);
  return outputsOf(output)['held'];
}

/** Commits `path` on the head clone's branch. */
function addOnBranch(head: string, root: string, path: string): void {
  put(head, path, 'plan: x\n');
  git(head, root, ['add', '-A']);
  git(head, root, ['commit', '-q', '-m', `add ${path}`]);
}

describe.skipIf(Bun.which('bash') === null)('the look for the fragment', () => {
  it('reads held=false on a branch adding no fragment', () => {
    expect(look(() => {})).toBe('false');
  });

  it('reads held=true on a branch adding dependabot-<n>.md or a -2 of it', () => {
    expect(look(({ head, root }) => addOnBranch(head, root, FRAGMENT))).toBe('true');
    expect(look(({ head, root }) => addOnBranch(head, root, `.changes/dependabot-${NUMBER}-2.md`))).toBe('true');
  });

  it('reads held=false for another pull request\'s fragment, and for one the base already held', () => {
    expect(look(({ head, root }) => addOnBranch(head, root, `.changes/dependabot-${NUMBER}1.md`))).toBe('false');
    expect(look(({ origin, root }) => {
      const base = join(root, 'base');
      git(root, root, ['clone', '-q', '--branch', 'main', origin, base]);
      addOnBranch(base, root, FRAGMENT);
      git(base, root, ['push', '-q', 'origin', 'main']);
      const head = join(root, 'head');
      git(head, root, ['fetch', '-q', 'origin']);
      git(head, root, ['merge', '-q', '--no-edit', 'origin/main']);
    })).toBe('false');
  });
});

/** What one run of the write step did. */
interface WriteRun {
  /** Each command the fakes ran, its arguments bracketed one by one. */
  readonly calls: readonly string[];
  readonly exitCode: number;
  readonly outputs: Record<string, string>;
  /** The fragment copied into head/, or null. */
  readonly copied: string | null;
}

/**
 * Runs the write step's script under bash in `base/`, a git repository
 * whose manifest names `name` with `src/rafa.ts` tracked when `tracked`,
 * beside an empty `head/`, with a fake `bun` and `rafa` first on PATH.
 */
function runWrite(name: string, tracked: boolean, dependencyType: string): WriteRun {
  const root = mkdtempSync(join(tempBase, 'step-'));
  const base = join(root, 'base');
  const head = join(root, 'head');
  const fakes = join(root, 'bin');
  const log = join(root, 'calls.log');
  const output = join(root, 'output');
  mkdirSync(join(base, 'src'), { recursive: true });
  mkdirSync(head);
  mkdirSync(fakes);
  writeFileSync(join(base, 'package.json'), JSON.stringify({ name }), 'utf8');
  writeFileSync(join(base, 'src', 'rafa.ts'), '', 'utf8');
  for (const tool of ['bun', 'rafa']) {
    const fake = [
      '#!/bin/bash',
      `line=${tool}; for word in "$@"; do line="$line [$word]"; done`,
      `printf '%s\\n' "$line" >> '${log}'`,
      'case " $* " in',
      `  *" fragment "*) mkdir -p .changes; printf 'plan: dependabot-${NUMBER}\\n' > '${FRAGMENT}'; echo 'warn: a warning'; echo '${FRAGMENT}' ;;`,
      'esac',
      '',
    ].join('\n');
    writeFileSync(join(fakes, tool), fake, 'utf8');
    chmodSync(join(fakes, tool), 0o755);
  }
  writeFileSync(log, '', 'utf8');
  git(base, root, ['init', '-q']);
  if (tracked) git(base, root, ['add', 'src/rafa.ts']);

  const run = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', scriptOf('Write the fragment')], {
    cwd: base,
    env: envUnder(root, {
      PATH: `${fakes}:${process.env['PATH'] ?? ''}`,
      BUN_INSTALL: join(root, 'bun-home'),
      DEPENDENCY_TYPE: dependencyType,
      PR_NUMBER: NUMBER,
      PR_TITLE: TITLE,
      GITHUB_OUTPUT: output,
    }),
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
  const copy = join(head, FRAGMENT);
  return {
    calls,
    exitCode: run.exitCode,
    outputs: outputsOf(output),
    copied: existsSync(copy)
      ? readFileSync(copy, 'utf8')
      : null,
  };
}

/** The fragment line a run at `level` passes, after the runner words. */
function fragmentWords(level: string): string {
  return `[release] [fragment] [--plan=dependabot-${NUMBER}] [--level=${level}] [--title=${TITLE}]`;
}

describe.skipIf(Bun.which('node') === null || Bun.which('bash') === null)('the write of the fragment', () => {
  it('writes at patch for direct:production, from the checkout when the project is rafa, and copies it to head/', () => {
    expect(runWrite('@open-tomato/rafa', true, 'direct:production')).toEqual({
      calls: ['bun [install] [--frozen-lockfile]', `bun [src/rafa.ts] ${fragmentWords('patch')}`],
      exitCode: 0,
      outputs: { path: FRAGMENT },
      copied: `plan: dependabot-${NUMBER}\n`,
    });
  });

  it('writes at none for direct:development, indirect and an empty type, from a global install for another project', () => {
    for (const type of ['direct:development', 'indirect', '']) {
      const run = runWrite('some-package', true, type);

      expect(run.calls).toEqual(['bun [install] [-g] [@open-tomato/rafa]', `rafa ${fragmentWords('none')}`]);
      expect(run.exitCode).toBe(0);
      expect(run.copied).not.toBeNull();
    }
  });

  it('installs rafa globally when the project is rafa but git does not track src/rafa.ts', () => {
    expect(runWrite('@open-tomato/rafa', false, 'direct:production').calls).toEqual([
      'bun [install] [-g] [@open-tomato/rafa]',
      `rafa ${fragmentWords('patch')}`,
    ]);
  });
});

describe.skipIf(Bun.which('bash') === null)('the commit and push', () => {
  it('commits the fragment alone as chore: release fragment dependabot-<n> and pushes it to the head branch', () => {
    const root = mkdtempSync(join(tempBase, 'commit-'));
    const { origin, head } = headClone(root);
    put(head, FRAGMENT, 'plan: x\n');
    const written = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', scriptOf('Write the CI config')], { cwd: head, env: envUnder(root) });
    // The control: the config the step writes sits beside the fragment, so the commit could take it.
    expect(written.exitCode).toBe(0);
    expect(existsSync(join(head, '.rafa', 'config.yaml'))).toBe(true);
    put(head, 'stray.txt', 'not the fragment\n');
    const before = git(root, root, ['--git-dir', origin, 'rev-parse', 'dependabot/bun/zod']);

    const run = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', scriptOf('Commit and push')], {
      cwd: head,
      env: envUnder(root, { FRAGMENT, HEAD_REF: 'dependabot/bun/zod', PR_NUMBER: NUMBER }),
    });

    expect(run.exitCode).toBe(0);
    const tip = git(root, root, ['--git-dir', origin, 'rev-parse', 'dependabot/bun/zod']);
    expect(tip).not.toBe(before);
    expect(git(root, root, ['--git-dir', origin, 'log', '-1', '--format=%s', tip])).toBe(`chore: release fragment dependabot-${NUMBER}`);
    expect(git(root, root, ['--git-dir', origin, 'diff-tree', '--no-commit-id', '--name-only', '-r', tip])).toBe(FRAGMENT);
    expect(git(head, root, ['config', 'user.name'])).toBe('github-actions[bot]');
  });
});
