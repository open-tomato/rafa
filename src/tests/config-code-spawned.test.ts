/**
 * `rafa.config.ts` read by the real CLI: `bun src/rafa.ts` spawned
 * through `./cli-capture.ts` over scratch repositories, each holding a
 * config module and none a `.rafa/config.yaml` of its own unless a case
 * leaves one beside it.
 *
 * The first repository holds `rafa.config.ts` naming
 * `naming.branch: 'work/{stub}'`, a bare `origin` and a one-task plan,
 * under a stand-in `claude` that answers every session `done`:
 *
 *   - `loop start --create-branch` from `main` creates `work/<stub>`
 *     and not `feat/<stub>`, and runs the task there;
 *   - `config show --sources` names the file and entry 0 for
 *     `naming.branch`, in text and as json data;
 *   - `doctor` reads a `.rafa/config.yaml` left beside the module as
 *     the local layer over it: its unknown key is the one warning naming
 *     it, and no line calls either file not read.
 *
 * The second repository is a clone whose head branch commits a
 * `rafa.config.ts` the base never held, with a `bun.lock` conflicting
 * with the base's, so the pull request assesses as a simple one under a
 * `gh` standing in for GitHub (`./replaying-fake-gh.ts`):
 *
 *   - `pr triage 12 --resolve` is refused with exit 1 naming the file,
 *     `origin/main` and `--allow-local-config`, and adds no worktree;
 *   - with `--allow-local-config` the same line prints the one warning
 *     and goes past the rule, to the worktree the refusal never added.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { GitRunner } from '../pr/index.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';
import { createGitRunner } from '../pr/index.js';
import { resolveWorktreePath } from '../pr/worktree.js';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { plantFakeGh } from './replaying-fake-gh.js';

/** This suite's own temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-config-code-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one case may take: each spawned run is a few seconds and a loop several. */
const CASE_TIMEOUT_MS = 120_000;

/** The plan's stub, and the branch the config module names for it. */
const STUB = 'probe';
const BRANCH = `work/${STUB}`;

/** The config module every repository holds: the branch template, and no provider the loop would reach. */
const CONFIG_TS = 'export default [{ naming: { branch: \'work/{stub}\' }, pr: { provider: \'none\' } }];\n';

/** The module the pull request's head carries: the template alone, the project's `pr` being the operator's. */
const HEAD_CONFIG_TS = 'export default [{ naming: { branch: \'work/{stub}\' } }];\n';

/** The YAML file a case leaves beside the module, holding one key no setting names. */
const LEFT_YAML = 'pr:\n  provider: none\nnonesuch: 1\n';

/** What a spawned run's streams hold, as one string a case searches. */
function said(run: { readonly stdout: string; readonly stderr: string }): string {
  return `${run.stdout}\n${run.stderr}`;
}

/** Runs git, throwing what it said when it failed: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} in a fixture step: ${result.stderr}`);
  return result.stdout.trim();
}

/** Gives a checkout an identity and no signing, and puts it on `main`. */
function configureCheckout(git: GitRunner): void {
  must(git, ['config', 'user.name', 'config code']);
  must(git, ['config', 'user.email', 'config-code@example.invalid']);
  must(git, ['config', 'commit.gpgsign', 'false']);
}

/** Commits everything under the checkout `git` runs in, under `message`. */
function commitAll(git: GitRunner, message: string): void {
  must(git, ['add', '--all']);
  must(git, ['commit', '--quiet', '--no-verify', '-m', message]);
}

/** A bare `origin` under `root`, answering its path. */
function plantOrigin(root: string): string {
  const origin = join(root, 'origin.git');
  must(createGitRunner(root), ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  return origin;
}

/** Makes `repo` hold one commit on `main`, pushed to a bare `origin` it tracks. */
function seedMain(scratch: ScratchRepo, files: Readonly<Record<string, string>>): GitRunner {
  const root = join(scratch.repo, '..');
  const origin = plantOrigin(root);
  const git = createGitRunner(scratch.repo);
  must(git, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  configureCheckout(git);
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\nprogress.txt\n', 'utf8');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(scratch.repo, name), text, 'utf8');
  commitAll(git, 'root');
  must(git, ['remote', 'add', 'origin', origin]);
  must(git, ['push', '--quiet', '-u', 'origin', 'main']);
  return git;
}

/** The report a stand-in session ends on: `done`, holding nothing back. */
const REPORT = [
  '```rafa:report',
  'status: done',
  'feedback: "the stand-in answered"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  '```',
  '',
].join('\n');

/** Writes a `claude` into the scratch `bin/` that logs the call and answers {@link REPORT}. */
function plantSessionClaude(scratch: ScratchRepo): void {
  const report = join(scratch.bin, 'report.txt');
  writeFileSync(report, REPORT, 'utf8');
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo session-call >> '${scratch.callLog}'`,
    `cat '${report}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  Bun.spawnSync(['chmod', '755', claude]);
}

/** The plan every run over the first repository runs, one task. */
const PLAN_FILE = `.rafa/plans/PLAN-${STUB}.md`;
const PLAN_TEXT = `# Plan: ${STUB}\n\n\`\`\`rafa:plan\nstub: ${STUB}\n\`\`\`\n\n- [ ] Do the thing\n`;

/** The repository holding `rafa.config.ts`, a plan and an `origin`, on `main`, under a stand-in `claude`. */
function plantModuleRepo(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  writeDismissed(scratch.home, NOTICE_IDS);
  seedMain(scratch, { 'rafa.config.ts': CONFIG_TS });
  mkdirSync(join(scratch.repo, '.rafa', 'plans'), { recursive: true });
  writeFileSync(join(scratch.repo, PLAN_FILE), PLAN_TEXT, 'utf8');
  plantSessionClaude(scratch);
  return scratch;
}

describe('a rafa.config.ts naming the branch template', () => {
  it('has loop start create work/<stub> from main and run the task on it', () => {
    const scratch = plantModuleRepo();
    const git = createGitRunner(scratch.repo);

    const run = runRafa(scratch, scratch.repo, ['loop', 'start', `--plan=${PLAN_FILE}`, '--create-branch', '--no-ci-wait', '--no-hint']);

    expectExit(run, 0, scratch);
    expect(must(git, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(BRANCH);
    expect(git(['rev-parse', '--verify', '--quiet', `refs/heads/feat/${STUB}`]).ok).toBe(false);
    expect(run.stdout).toContain(`🌿 Creating ${BRANCH} from the latest origin/main.`);
    expect(run.stdout).toContain('✅ Task done: Do the thing');
    expect(readFileSync(scratch.callLog, 'utf8')).toContain('session-call');
  }, CASE_TIMEOUT_MS);

  it('names the file and entry 0 for naming.branch under config show --sources', () => {
    const scratch = plantModuleRepo();
    const file = join(scratch.repo, 'rafa.config.ts');

    const text = runRafa(scratch, scratch.repo, ['config', 'show', '--sources']);
    const json = runRafa(scratch, scratch.repo, ['config', 'show', '--sources', '--output=json']);

    expectExit(text, 0, scratch);
    expect(text.stdout).toContain(`naming.branch: "work/{stub}"  from project ${file} entry 0\n`);
    expect(text.stdout).toContain('pr.base: null  from default');
    expectExit(json, 0, scratch);
    expect(json.stdout).toContain(`"key":"naming.branch","value":"work/{stub}","layer":"project","file":${JSON.stringify(file)},"entry":0`);
  }, CASE_TIMEOUT_MS);

  it('has doctor read a YAML file left beside it as the local layer, listing neither file as not read', () => {
    const scratch = plantModuleRepo();
    const yaml = plantProjectConfig(scratch.repo, LEFT_YAML);
    const module = join(scratch.repo, 'rafa.config.ts');

    const run = runRafa(scratch, scratch.repo, ['doctor']);

    const lines = said(run).split('\n');
    // The YAML file is read: its unknown key is the one line naming it,
    // which is also the control that doctor prints the load's warnings.
    expect(lines.filter((line) => line.includes(yaml))).toEqual([
      expect.stringContaining(`unknown key "nonesuch" in ${yaml}`),
    ]);
    expect(lines.filter((line) => line.includes('is not read'))).toEqual([]);
    expect(lines.filter((line) => line.includes(module))).toEqual([]);
  }, CASE_TIMEOUT_MS);
});

/** The pull request the triage cases resolve, and the branch its head is. */
const NUMBER = 12;
const HEAD = 'fix/with-config';

/** The repository the pull request targets, its head carrying a config module and a conflicting lockfile. */
interface TriageRepo {
  readonly scratch: ScratchRepo;
  readonly worktree: string;
}

/** Plants a clone on `main` whose head branch commits `rafa.config.ts` and a `bun.lock` the base changed too. */
function plantTriageRepo(): TriageRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  writeDismissed(scratch.home, NOTICE_IDS);
  const git = seedMain(scratch, { 'bun.lock': 'lock 0\n' });
  plantProjectConfig(scratch.repo, 'pr:\n  provider: gh\n');

  must(git, ['switch', '--quiet', '-c', HEAD]);
  writeFileSync(join(scratch.repo, 'rafa.config.ts'), HEAD_CONFIG_TS, 'utf8');
  writeFileSync(join(scratch.repo, 'bun.lock'), 'lock head\n', 'utf8');
  commitAll(git, 'head');
  const headOid = must(git, ['rev-parse', HEAD]);

  must(git, ['switch', '--quiet', 'main']);
  writeFileSync(join(scratch.repo, 'bun.lock'), 'lock base\n', 'utf8');
  commitAll(git, 'base');
  must(git, ['push', '--quiet', 'origin', 'main']);

  const state = join(scratch.repo, '..', 'gh-state');
  mkdirSync(state, { recursive: true });
  plantFakeGh(scratch.bin, state, {
    pulls: [{
      number: NUMBER,
      title: 'a config-carrying head',
      headRefName: HEAD,
      headRefOid: headOid,
      checks: [],
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
    }],
    permissions: { octo: 'admin', 'rafa-fake': 'admin' },
  });
  plantSessionClaude(scratch);
  return { scratch, worktree: resolveWorktreePath(scratch.home, NUMBER) };
}

/** `pr triage` over the pull request, resolving, plus `extra`. */
function triageWords(extra: readonly string[]): readonly string[] {
  return ['pr', 'triage', String(NUMBER), '--resolve', ...extra, '--no-hint'];
}

describe('pr triage --resolve over a head committing its own rafa.config.ts', () => {
  it('refuses with exit 1, naming the file, the base and the flag, before any worktree is added', () => {
    const planted = plantTriageRepo();

    const run = runRafa(planted.scratch, planted.scratch.repo, triageWords([]));

    expectExit(run, 1, planted.scratch);
    expect(run.stderr).toContain(`refuses #${String(NUMBER)}`);
    expect(run.stderr).toContain('`rafa.config.ts`, which `origin/main` does not hold');
    expect(run.stderr).toContain('--allow-local-config');
    expect(existsSync(planted.worktree)).toBe(false);
    expect(createGitRunner(planted.scratch.repo)(['worktree', 'list', '--porcelain']).stdout).not.toContain('pr-12');
  }, CASE_TIMEOUT_MS);

  it('passes the rule under --allow-local-config with one warning line and reaches the worktree', () => {
    const planted = plantTriageRepo();

    const run = runRafa(planted.scratch, planted.scratch.repo, triageWords(['--allow-local-config']));

    const output = said(run);
    const warnings = output.split('\n').filter((line) => line.includes('--allow-local-config:'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('`rafa.config.ts`, which `origin/main` does not hold');
    expect(output).not.toContain(`refuses #${String(NUMBER)}`);
    expect(output).toContain(`Resolving #${String(NUMBER)}`);
    expect(output).toContain('Added the worktree at');
  }, CASE_TIMEOUT_MS);
});
