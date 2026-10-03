/**
 * Spawned `bun src/rafa.ts` runs of `rafa roadmap`, `rafa roadmap --full`,
 * `rafa roadmap --check` and `rafa epics <n>`, over a fixture board
 * carrying two `type:epic` issues, both `horizon:now`
 * (`.rafa/specs/rafa-244-epics-group-issues-features.md`).
 *
 * `epic:alpha` (#50) is IN-PROGRESS: one member open, one closed.
 * `epic:beta` (#60) is DONE by both its members closing, while the epic
 * ISSUE itself is left open — the stored/computed disagreement
 * `--check` must fail the run on, and `rafa roadmap` alone must not.
 * Neither epic's members are named when the other is asked for, on
 * `rafa epics <n>`.
 *
 * The last suite proves the hard rule this whole stage is built around:
 * a roadmap naming no epic prints byte-identical output to what it
 * always has. `src/board/roadmap-rows.ts` and
 * `src/commands/issue/roadmap-table.ts` are untouched by this stage —
 * unchanged since `79320b0` and `34e3037`, both merged well before it —
 * so calling them directly over the same fixture reproduces the exact
 * bytes `origin/main` prints for it, without spawning a second binary:
 * that reading is the "capture" the spawned run is compared against.
 *
 * Every stand-in `gh` here fails loudly, naming the call, on anything it
 * was not planted to answer.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { SpecIssue } from '../board/issue.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { SPEC_READY_LABEL } from '../board/readiness.js';
import { parseBoardListing } from '../board/roadmap-board.js';
import { createPlanDirNames, readRoadmapRows } from '../board/roadmap-rows.js';
import { EPIC_CHECK_EXIT } from '../commands/issue/roadmap-check.js';
import { renderRoadmapTable } from '../commands/issue/roadmap-table.js';
import { createGitRunner } from '../pr/git.js';
import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { completeSpecBody } from './spec-bodies.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-roadmap-epics-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The Roadmap issue's number, named by `roadmap.issue`, in every fixture below. */
const ROADMAP = 1;

/** One `gh issue list` row, labels already named. */
function boardIssue(
  number: number,
  title: string,
  body: string,
  state: 'OPEN' | 'CLOSED',
  labels: readonly string[],
  stateReason = '',
): object {
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * Adds a reachable, empty bare `origin` remote to `scratch`, so the
 * branch scan's remote half (`git ls-remote --heads origin`) never fails
 * and warns: a warning would land on stdout beside the table
 * (`src/adapters/output/text.ts` writes every level to the one stream)
 * and break a byte-identical comparison.
 */
function addOrigin(scratch: ScratchRepo): void {
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
}

/**
 * Writes the stand-in `gh`: `issue view` answers `view`, `issue list`
 * answers `board` unless it is null, in which case it fails loudly as an
 * unreachable board, and `pr list` answers no open pull request.
 */
function writeGhStub(scratch: ScratchRepo, view: object, board: readonly object[] | null): void {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'view.json'), JSON.stringify(view), 'utf8');
  if (board !== null) writeFileSync(join(data, 'board.json'), JSON.stringify(board), 'utf8');
  writeFileSync(join(data, 'pulls.json'), '[]', 'utf8');
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    // No issue carries type:roadmap: its listing answers empty, told
    // apart from the board listing by its label flag.
    'case "$*" in *"--label type:roadmap"*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$1 $2" in',
    `  "issue view") ${printFile(join(data, 'view.json'))};;`,
    `  "pr list") ${printFile(join(data, 'pulls.json'))};;`,
    `  "issue list") [ -f '${join(data, 'board.json')}' ] || { echo 'connection refused' >&2; exit 1; }; ${printFile(join(data, 'board.json'))};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** The rows of an epic table, each split into its cells; lines starting the row only. */
function epicCellsOf(stdout: string): string[][] {
  return stdout.split('\n').filter((line) => line.startsWith('#') && !line.startsWith('# '))
    .map((line) => line.trim().split(/ {2,}/u));
}

describe('rafa roadmap and rafa epics over a fixture board with two epics, spawned', () => {
  const EPIC_ALPHA = 50;
  const EPIC_BETA = 60;
  const ALPHA_OPEN_MEMBER = 51;
  const ALPHA_CLOSED_MEMBER = 52;
  const BETA_MEMBER_ONE = 61;
  const BETA_MEMBER_TWO = 62;

  const ALPHA_BODY = `- [ ] #${String(ALPHA_OPEN_MEMBER)}\n- [ ] #${String(ALPHA_CLOSED_MEMBER)}\n`;
  const BETA_BODY = `- [ ] #${String(BETA_MEMBER_ONE)}\n- [ ] #${String(BETA_MEMBER_TWO)}\n`;
  const ROADMAP_BODY = `- [ ] #${String(EPIC_ALPHA)}\n- [ ] #${String(EPIC_BETA)}\n`;

  /** `epic:alpha` is in-progress (1/2 done); `epic:beta` is done (2/2) but its issue is still open. */
  const TWO_EPIC_BOARD = [
    boardIssue(EPIC_ALPHA, 'Alpha epic', ALPHA_BODY, 'OPEN', ['type:epic', 'epic:alpha', 'horizon:now']),
    boardIssue(ALPHA_OPEN_MEMBER, 'Alpha open member', '', 'OPEN', ['epic:alpha']),
    boardIssue(ALPHA_CLOSED_MEMBER, 'Alpha closed member', '', 'CLOSED', ['epic:alpha'], 'COMPLETED'),
    boardIssue(EPIC_BETA, 'Beta epic', BETA_BODY, 'OPEN', ['type:epic', 'epic:beta', 'horizon:now']),
    boardIssue(BETA_MEMBER_ONE, 'Beta member one', '', 'CLOSED', ['epic:beta'], 'COMPLETED'),
    boardIssue(BETA_MEMBER_TWO, 'Beta member two', '', 'CLOSED', ['epic:beta'], 'COMPLETED'),
  ];

  /** Plants a scratch project over the two-epic board, or an unreachable one when `reachable` is false. */
  function plant(reachable: boolean): ScratchRepo {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, `${projectConfigText()}roadmap:\n  issue: ${String(ROADMAP)}\n`);
    addOrigin(scratch);
    const view = { number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: { login: 'me' } };
    writeGhStub(scratch, view, reachable
      ? TWO_EPIC_BOARD
      : null);
    return scratch;
  }

  let up: ScratchRepo;
  let down: ScratchRepo;

  beforeAll(() => {
    up = plant(true);
    down = plant(false);
  });

  it('prints both epic rows with their computed state and done/total, and exits 0 despite the disagreement', () => {
    const run = runRafa(up, up.repo, ['roadmap']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Roadmap #${String(ROADMAP)} · now`);

    const rows = epicCellsOf(run.stdout);
    expect(rows.find((cells) => cells[0] === `#${String(EPIC_ALPHA)}`))
      .toEqual([`#${String(EPIC_ALPHA)}`, 'in-progress', '1/2', '-', '-', 'Alpha epic']);
    expect(rows.find((cells) => cells[0] === `#${String(EPIC_BETA)}`))
      .toEqual([`#${String(EPIC_BETA)}`, 'done', '2/2', '-', '-', 'Beta epic']);
    expect(run.stdout).toContain(`done, but epic #${String(EPIC_BETA)} is still open`);

    // Neither epic's own members are named without --full.
    expect(run.stdout).not.toContain(`#${String(ALPHA_OPEN_MEMBER)}`);
    expect(run.stdout).not.toContain(`#${String(BETA_MEMBER_ONE)}`);
  });

  it('--full prints each epic\'s issues underneath its row, alpha\'s between its row and beta\'s', () => {
    const run = runRafa(up, up.repo, ['roadmap', '--full']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Alpha open member');
    expect(run.stdout).toContain('Alpha closed member');
    expect(run.stdout).toContain('Beta member one');
    expect(run.stdout).toContain('Beta member two');

    const alphaMember = run.stdout.indexOf('Alpha open member');
    const betaRow = run.stdout.indexOf('Beta epic');
    const betaMember = run.stdout.indexOf('Beta member one');
    expect(alphaMember).toBeGreaterThan(-1);
    expect(alphaMember).toBeLessThan(betaRow);
    expect(betaRow).toBeLessThan(betaMember);
  });

  it('--check exits non-zero: beta is open with all its members closed', () => {
    const bare = runRafa(up, up.repo, ['roadmap']);
    const checked = runRafa(up, up.repo, ['roadmap', '--check']);
    expect(bare.exitCode).toBe(0);
    expect(checked.exitCode).toBe(EPIC_CHECK_EXIT);
    expect(checked.stdout + checked.stderr).toContain(`done, but epic #${String(EPIC_BETA)} is still open`);
  });

  it('prints the epics unknown, with the reason, when the board listing fails', () => {
    const run = runRafa(down, down.repo, ['roadmap']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Roadmap #${String(ROADMAP)} · epics unknown:`);
    expect(run.stdout).toContain('connection refused');
  });

  it('--check also fails, naming that the epics could not be checked, when the listing is unknown', () => {
    const run = runRafa(down, down.repo, ['roadmap', '--check']);
    expect(run.exitCode).toBe(EPIC_CHECK_EXIT);
    expect(run.stdout + run.stderr).toContain('Could not check the epics');
  });

  it('rafa epics <n> names no issue of the other epic', () => {
    const run = runRafa(up, up.repo, ['epics', String(EPIC_ALPHA)]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Epic #${String(EPIC_ALPHA)} · Alpha epic`);
    expect(run.stdout).toContain(`#${String(ALPHA_OPEN_MEMBER)}`);
    expect(run.stdout).toContain(`#${String(ALPHA_CLOSED_MEMBER)}`);
    expect(run.stdout).not.toContain(`#${String(EPIC_BETA)}`);
    expect(run.stdout).not.toContain(`#${String(BETA_MEMBER_ONE)}`);
    expect(run.stdout).not.toContain(`#${String(BETA_MEMBER_TWO)}`);
  });
});

describe('rafa roadmap over a fixture naming no epic at all, spawned', () => {
  const SPEC_ISSUE = 70;
  const SPEC_TITLE = 'Ship the byte-identical proof';
  const NO_EPIC_BODY = `- [ ] #${String(SPEC_ISSUE)}\n`;
  const NO_EPIC_BOARD = [
    boardIssue(SPEC_ISSUE, SPEC_TITLE, completeSpecBody(SPEC_TITLE), 'OPEN', [SPEC_READY_LABEL, 'type:bug']),
  ];

  let scratch: ScratchRepo;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, `${projectConfigText()}roadmap:\n  issue: ${String(ROADMAP)}\n`);
    addOrigin(scratch);
    const view = { number: ROADMAP, title: 'Roadmap', body: NO_EPIC_BODY, state: 'OPEN', labels: [], author: { login: 'me' } };
    writeGhStub(scratch, view, NO_EPIC_BOARD);
  });

  /**
   * The bytes `readRoadmapRows` and `renderRoadmapTable` — both untouched
   * by this stage — print for {@link NO_EPIC_BOARD} over `scratch`'s own
   * git: the capture `origin/main` would answer, built without spawning a
   * second binary. See the module note.
   */
  async function goldenCapture(): Promise<string> {
    const board = parseBoardListing(JSON.stringify(NO_EPIC_BOARD), 'golden board listing');
    const roadmapIssue: SpecIssue = { number: ROADMAP, title: 'Roadmap', body: NO_EPIC_BODY, state: 'OPEN', labels: [], author: 'me' };
    const read = await readRoadmapRows({
      configured: ROADMAP,
      listBoards: () => Promise.resolve([]),
      search: () => Promise.reject(new Error('no title search expected: roadmap.issue names one')),
      issues: () => Promise.resolve(roadmapIssue),
      board: () => Promise.resolve(board),
      git: createGitRunner(scratch.repo),
      pullRequests: () => Promise.resolve([]),
      planNames: createPlanDirNames(join(scratch.repo, '.rafa', 'plans')),
      refs: () => Promise.resolve(new Map()),
    });
    expect(read.warnings).toEqual([]);
    return [`Roadmap: #${String(ROADMAP)}`, ...renderRoadmapTable(read.rows)].join('\n') + '\n';
  }

  it('prints a capture byte-identical to the one taken on origin/main', async () => {
    const run = runRafa(scratch, scratch.repo, ['roadmap']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(await goldenCapture());
  });
});
