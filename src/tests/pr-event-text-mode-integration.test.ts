/**
 * The `pr` event of a wrap-up under `RAFA_OUTPUT=text`, over a spawned
 * `bun src/rafa.ts loop start` run in a scratch project: text prints no
 * event, yet the run's `.rafa/runs/<id>.events.ndjson` holds the `pr`
 * line, its number read from the branch's open pull request.
 *
 * `pr.provider: none` keeps the delivery and the CI wait out of the run
 * (`context/workflow.md`, wrap-up), so the number is the one the lookup
 * asks the stand-in `gh` for. The stand-in `claude` reports every task
 * done.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { runsDir } from '../loop/sessions.js';
import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';
import { EVENTS_EXTENSION } from '../start/loop-events.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

const RUN_TIMEOUT = { timeout: 90_000 };
const PLAN_FLAG = '--plan=.plans/PLAN-store.md';
const PULL_NUMBER = 4242;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-event-text-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

function git(scratch: ScratchRepo, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args], {
    cwd: scratch.repo,
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
}

/** A `claude` reporting the task done, and a `gh` answering `pr list` with one open pull request. */
function plantStandIns(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    'cat <<\'REPORT_EOF\'',
    '```rafa:report',
    'status: done',
    'feedback: "done"',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    '```',
    'REPORT_EOF',
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
  const pull = JSON.stringify([{
    number: PULL_NUMBER,
    title: 'A task',
    url: `https://github.com/o/r/pull/${PULL_NUMBER}`,
    state: 'OPEN',
    headRefName: 'feat/store',
    baseRefName: 'main',
    author: { login: 'rafa', is_bot: false },
    isCrossRepository: false,
    updatedAt: '2026-01-01T00:00:00Z',
  }]);
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'if [ "$1" = "auth" ]; then echo "Logged in"; exit 0; fi',
    `if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo '${pull}'; exit 0; fi`,
    'echo "stand-in gh: unsupported: $*" >&2',
    'exit 1',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

function plantScratch(provider: string): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  plantStandIns(scratch);
  writeDismissed(scratch.home, NOTICE_IDS);
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(scratch, 'checkout', '-q', '-b', 'feat/store');
  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', 'PLAN-store.md'), '# Plan: store\n\n- [ ] A task\n', 'utf8');
  plantProjectConfig(scratch.repo, `pr:\n  provider: ${provider}\n`);
  return scratch;
}

describe('the pr event of a wrap-up under RAFA_OUTPUT=text', () => {
  it('writes the pr line to the run\'s events file though text prints none', () => {
    const scratch = plantScratch('gh');

    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait'], { RAFA_OUTPUT: 'text' });

    const files = readdirSync(runsDir(scratch.repo)).filter((name) => name.endsWith(EVENTS_EXTENSION));
    expect(files).toHaveLength(1);
    const text = readFileSync(join(runsDir(scratch.repo), files[0] ?? ''), 'utf8');
    const lines: Array<{ name: string; data: { number?: number } }> = text.split('\n').filter((line) => line !== '')
      .map((line) => JSON.parse(line));
    const pr = lines.filter((line) => line.name === 'pr');
    expect(pr).toHaveLength(1);
    expect(pr[0]?.data.number).toBe(PULL_NUMBER);
    expect(lines.some((line) => line.name === 'no-pr')).toBe(false);
    expect(run.stdout).not.toContain('"name":"pr"');
  }, RUN_TIMEOUT);

  it('writes the no-pr line to the events file under pr.provider none, never asking gh', () => {
    const scratch = plantScratch('none');

    runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait'], { RAFA_OUTPUT: 'text' });

    const files = readdirSync(runsDir(scratch.repo)).filter((name) => name.endsWith(EVENTS_EXTENSION));
    expect(files).toHaveLength(1);
    const text = readFileSync(join(runsDir(scratch.repo), files[0] ?? ''), 'utf8');
    const lines: Array<{ name: string }> = text.split('\n').filter((line) => line !== '')
      .map((line) => JSON.parse(line));
    expect(lines.filter((line) => line.name === 'no-pr')).toHaveLength(1);
    expect(lines.some((line) => line.name === 'pr')).toBe(false);
  }, RUN_TIMEOUT);
});
