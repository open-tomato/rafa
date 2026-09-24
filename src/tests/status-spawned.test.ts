/**
 * A spawned test of `rafa status`: the real command, run as
 * `bun src/rafa.ts` in a scratch project that has a bare `origin`, a
 * `feat/<stub>` branch checked out whose tracker holds one `[BLOCKED]`
 * task with a stopped session record naming it, and one branch merged
 * into `main` and left behind.
 *
 * The `gh` first on the child's PATH is a stand-in answering `[]` to
 * every `pr` and `issue` command, so the pull request section is read and
 * empty and the board, finding no Roadmap issue, is one `warn` line; `pr.provider` is set to `gh` because the bare
 * remote is a path, which resolves to no provider on its own. No
 * `claude` is planted or called: `status` starts no session.
 *
 * The text and the `--output=json` result are held to the same three
 * facts: the plan branch, the blocked task and one merged branch.
 */
import type { CapturedRun, ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { STATUS_NETWORK_TIMEOUT_MS } from '../status/sections.js';

import { eventsOf, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const STUB = 'rafa-900-status-probe';
const BRANCH = `feat/${STUB}`;
const MERGED_BRANCH = 'feat/left-behind';
const BLOCKED_TEXT = 'Wire the flux capacitor';
const PLAN_FILE = `.rafa/plans/PLAN-${STUB}.md`;
const TRACKER_FILE = `.rafa/plans/PLAN_TRACKER-${STUB}.md`;

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-spawned-')));

afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** A `gh` that answers an empty list to every `pr` and `issue` command and refuses the rest. */
const STAND_IN_GH = [
  '#!/bin/sh',
  'case "$1" in',
  '  pr|issue) echo "[]"; exit 0 ;;',
  'esac',
  'echo "unexpected gh call: $*" >&2',
  'exit 1',
  '',
].join('\n');

/** A `gh` that never answers: the scratch PATH holds no `sleep`, so bun itself waits. */
const HANGING_GH = `#!/bin/sh\nexec "${process.execPath}" -e "setTimeout(() => {}, 300000)"\n`;

/** How far past the network deadline the whole command may run: the local readings and process start-up. */
const DEADLINE_MARGIN_MS = 10_000;

/** Writes `text` to `path`, making its directories. */
function plant(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** Runs git in `cwd` under the scratch home, answering its stdout. */
function git(scratch: ScratchRepo, cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    env: {
      PATH: scratch.path,
      HOME: scratch.home,
      GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Probe',
      GIT_AUTHOR_EMAIL: 'probe@example.com',
      GIT_COMMITTER_NAME: 'Probe',
      GIT_COMMITTER_EMAIL: 'probe@example.com',
    },
  });
}

/** The tracker and plan of the branch's plan, one task blocked. */
const TRACKER_TEXT = `# Plan\n\n- [x] Lay the groundwork\n- [BLOCKED] ${BLOCKED_TEXT}\n- [ ] Ship it\n`;

/** Plants the scratch project described in the module note. */
function plantWorld(ghScript: string = STAND_IN_GH, config = 'pr:\n  provider: gh\n'): ScratchRepo {
  const scratch = plantScratchRepo(scratchBase);
  const { repo } = scratch;
  plantProjectConfig(repo, config);
  const gh = join(scratch.bin, 'gh');
  plant(gh, ghScript);
  chmodSync(gh, 0o755);

  const bare = join(dirname(repo), 'origin.git');
  git(scratch, dirname(repo), ['init', '-q', '--bare', bare]);
  git(scratch, repo, ['checkout', '-q', '-B', 'main']);
  plant(join(repo, 'README.md'), '# scratch\n');
  plant(join(repo, '.gitignore'), '.rafa/\n');
  git(scratch, repo, ['add', '-A']);
  git(scratch, repo, ['commit', '-q', '-m', 'initial']);
  git(scratch, repo, ['remote', 'add', 'origin', bare]);
  git(scratch, repo, ['push', '-q', '-u', 'origin', 'main']);

  git(scratch, repo, ['checkout', '-q', '-b', MERGED_BRANCH]);
  plant(join(repo, 'left-behind.txt'), 'done\n');
  git(scratch, repo, ['add', '-A']);
  git(scratch, repo, ['commit', '-q', '-m', 'work that merged']);
  git(scratch, repo, ['checkout', '-q', 'main']);
  git(scratch, repo, ['merge', '-q', '--no-ff', '-m', 'merge left-behind', MERGED_BRANCH]);
  git(scratch, repo, ['push', '-q', 'origin', 'main']);

  git(scratch, repo, ['checkout', '-q', '-b', BRANCH]);
  plant(join(repo, 'feature.txt'), 'in progress\n');
  git(scratch, repo, ['add', '-A']);
  git(scratch, repo, ['commit', '-q', '-m', 'feature work']);

  plant(join(repo, PLAN_FILE), TRACKER_TEXT);
  plant(join(repo, TRACKER_FILE), TRACKER_TEXT);
  plant(join(repo, '.rafa', 'runs', 'probe-session.json'), JSON.stringify({
    sessionId: 'probe-session',
    planStub: STUB,
    plan: PLAN_FILE,
    branch: BRANCH,
    pid: 1,
    startedAt: '2026-09-20T10:00:00.000Z',
    state: 'stopped',
    task: { line: 4, text: BLOCKED_TEXT },
  }));
  return scratch;
}

/** The `data` of a json run's result event. */
function resultData(run: CapturedRun): Record<string, Record<string, unknown>> {
  const result = eventsOf(run.stdout).find((event) => event.type === 'result');
  expect(result).toBeDefined();
  return (result as unknown as { data: Record<string, Record<string, unknown>> }).data;
}

describe('rafa status, spawned', () => {
  it('shows the plan branch, the blocked task and one merged branch in text', RUN_TIMEOUT, () => {
    const scratch = plantWorld();

    const run = runRafa(scratch, scratch.repo, ['status']);

    expect(run.exitCode).toBe(0);
    const output = `${run.stdout}${run.stderr}`;
    expect(output).toContain(`Branch: \`${BRANCH}\`, plan \`${STUB}\``);
    expect(output).toContain('Loops: 0 running, 1 task blocked');
    expect(output).toContain(`line 4: ${BLOCKED_TEXT}`);
    expect(output).toMatch(/Housekeeping: 1 merged,/);
    expect(output).toContain('Pull request: none open');
  });

  it('carries the same three facts as data under --output=json', RUN_TIMEOUT, () => {
    const scratch = plantWorld();

    const run = runRafa(scratch, scratch.repo, ['status', '--output=json']);

    expect(run.exitCode).toBe(0);
    const data = resultData(run);
    expect(data['branch']?.['read']).toBe(true);
    expect(data['branch']?.['branch']).toBe(BRANCH);
    expect((data['branch']?.['plan'] as { stub: string }).stub).toBe(STUB);
    const blocked = data['loops']?.['blocked'] as { tasks: { line: number; text: string }[] }[];
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.tasks).toEqual([expect.objectContaining({ line: 4, text: BLOCKED_TEXT })]);
    expect((data['housekeeping']?.['counts'] as { merged: number }).merged).toBe(1);
  });

  it('warns for the pull request and the board when gh never answers, and still prints the local sections', RUN_TIMEOUT, () => {
    const scratch = plantWorld(HANGING_GH, 'pr:\n  provider: gh\nroadmap:\n  issue: 1\n');

    const started = Date.now();
    const run = runRafa(scratch, scratch.repo, ['status']);
    const elapsed = Date.now() - started;

    expect(run.exitCode).toBe(0);
    expect(elapsed).toBeLessThan(STATUS_NETWORK_TIMEOUT_MS + DEADLINE_MARGIN_MS);
    const output = `${run.stdout}${run.stderr}`;
    expect(output.match(/^.*Pull request: not read:.*$/gm)).toHaveLength(1);
    expect(output.match(/^.*Board: not read:.*$/gm)).toHaveLength(1);
    expect(output).toContain(`Branch: \`${BRANCH}\`, plan \`${STUB}\``);
    expect(output).toContain('Loops: 0 running, 1 task blocked');
    expect(output).toMatch(/Housekeeping: 1 merged,/);
  });
});
