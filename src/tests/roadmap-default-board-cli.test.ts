/**
 * Spawned `bun src/rafa.ts` runs of `rafa roadmap` proving
 * {@link resolveDefaultBoard}'s three-rank order end to end
 * (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`, "Boards found
 * by label"): `roadmap.issue` is left unset in every fixture below, so
 * each case exercises the label and title ranks alone.
 *
 * ## The hard rule
 *
 * "A project with no `type:roadmap` label and no position file behaves
 * exactly as before: `rafa roadmap` ... print byte-identical output."
 * `src/board/roadmap-rows.ts` and `src/commands/issue/roadmap-table.ts`
 * are untouched by this stage, so calling them directly, over a
 * `resolveDefaultBoard` that degrades to the title rule the way it does
 * with nothing labelled, reproduces the exact bytes the PRE-CHANGE
 * renderer wrote for the same fixture — the "pre-change renderer"'s own
 * capture, taken in-process, without spawning a second binary. The first
 * suite below compares that capture to the spawned one.
 *
 * The other two suites plant labelled boards, where the label rank
 * decides the answer and the title rule is not asked to pick anything:
 * a labelled board beside an unlabelled issue titled "Roadmap", and two
 * labelled boards planted out of order, so a resolver reading the first
 * row, or ever preferring the title over the label, fails.
 *
 * Every stand-in `gh` here tells the board label listing, the title
 * search and the board content listing apart by their own flags —
 * `--label type:roadmap`, `--search `, and neither — never by `$1`/`$2`
 * alone, and fails loudly, naming the call, on anything it was not
 * planted to answer.
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
import { ROADMAP_LABEL } from '../board/setup.js';
import { renderRoadmapTable } from '../commands/issue/roadmap-table.js';
import { createGitRunner } from '../pr/git.js';
import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { completeSpecBody } from './spec-bodies.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-roadmap-default-board-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

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

/** One `gh issue list` row, labels already named. */
function boardIssue(number: number, title: string, body: string, labels: readonly string[]): object {
  return { number, title, body, state: 'OPEN', stateReason: '', labels: labels.map((name) => ({ name })) };
}

/** What a fixture's stand-in `gh` answers, per route. */
interface GhFixture {
  /** `gh issue list --label type:roadmap --state open ...`: the labelled boards, none by default. */
  readonly labelListing?: readonly object[];
  /** `gh issue list --state open --search "Roadmap in:title" ...`: the title rule's candidates, none by default. */
  readonly titleSearch?: readonly object[];
  /** `gh issue view <n> ...`: the resolved board's own issue. */
  readonly view: object;
  /** `gh issue list --state all ...`: the board's content, empty by default. */
  readonly board?: readonly object[];
}

/**
 * Writes the stand-in `gh` into `scratch`'s `bin/`: the board label
 * listing and the title search are matched on their own flags, ahead of
 * the plain `issue list` fallback that answers the board content, so the
 * three `gh issue list` routes are told apart the way the module note
 * requires.
 */
function writeGhStub(scratch: ScratchRepo, fixture: GhFixture): void {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'label.json'), JSON.stringify(fixture.labelListing ?? []), 'utf8');
  writeFileSync(join(data, 'search.json'), JSON.stringify(fixture.titleSearch ?? []), 'utf8');
  writeFileSync(join(data, 'view.json'), JSON.stringify(fixture.view), 'utf8');
  writeFileSync(join(data, 'board.json'), JSON.stringify(fixture.board ?? []), 'utf8');
  writeFileSync(join(data, 'pulls.json'), '[]', 'utf8');
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `case "$*" in *"--label type:roadmap"*) ${printFile(join(data, 'label.json'))}; exit 0;; esac`,
    `case "$*" in *"--search "*) ${printFile(join(data, 'search.json'))}; exit 0;; esac`,
    'case "$1 $2" in',
    `  "issue view") ${printFile(join(data, 'view.json'))};;`,
    `  "pr list") ${printFile(join(data, 'pulls.json'))};;`,
    `  "issue list") ${printFile(join(data, 'board.json'))};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

describe('rafa roadmap over a repository with one Roadmap-titled issue and no labelled board, spawned', () => {
  const ROADMAP = 1;
  const SPEC_ISSUE = 9;
  const ROADMAP_BODY = `- [ ] #${String(SPEC_ISSUE)}\n`;
  const BOARD = [boardIssue(SPEC_ISSUE, 'A spec issue', completeSpecBody('A spec issue'), [SPEC_READY_LABEL])];
  const VIEW = { number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', stateReason: '', labels: [], author: { login: 'me' } };

  let scratch: ScratchRepo;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    // No `roadmap.issue`: the fallback runs, exactly as it always did.
    plantProjectConfig(scratch.repo, projectConfigText());
    addOrigin(scratch);
    writeGhStub(scratch, { titleSearch: [{ number: ROADMAP, title: 'Roadmap' }], view: VIEW, board: BOARD });
  });

  /**
   * The bytes `readRoadmapRows` and `renderRoadmapTable` — both untouched
   * by this stage — print for {@link BOARD}, `resolveDefaultBoard`
   * reduced to the title rule the way it does with nothing labelled: the
   * pre-change renderer's own capture, without spawning a second binary;
   * see the module note.
   */
  async function preChangeCapture(): Promise<string> {
    const board = parseBoardListing(JSON.stringify(BOARD), 'golden board listing');
    const roadmapIssue: SpecIssue = { number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: 'me' };
    const read = await readRoadmapRows({
      configured: null,
      listBoards: () => Promise.resolve([]),
      search: () => Promise.resolve([{ number: ROADMAP, title: 'Roadmap' }]),
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

  it('prints a capture byte-identical to the in-process capture of the pre-change renderer', async () => {
    const run = runRafa(scratch, scratch.repo, ['roadmap']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(await preChangeCapture());
  });
});

describe('rafa roadmap when a labelled board and an unlabelled "Roadmap" both exist, spawned', () => {
  const LABELLED_BOARD = 1;
  const UNLABELLED_ROADMAP = 5;

  let scratch: ScratchRepo;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, projectConfigText());
    addOrigin(scratch);
    writeGhStub(scratch, {
      labelListing: [boardIssue(LABELLED_BOARD, 'Team board', '', [ROADMAP_LABEL])],
      // #5 is titled "Roadmap" but carries no label; the title rule is
      // never asked to pick between the two, only to report on it (the
      // doctor row this fixture would also feed is a later task's).
      titleSearch: [{ number: UNLABELLED_ROADMAP, title: 'Roadmap' }],
      view: { number: LABELLED_BOARD, title: 'Team board', body: '', state: 'OPEN', stateReason: '', labels: [{ name: ROADMAP_LABEL }], author: { login: 'me' } },
    });
  });

  it('reads the labelled board, not the unlabelled issue titled Roadmap', () => {
    const run = runRafa(scratch, scratch.repo, ['roadmap']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Roadmap: #${String(LABELLED_BOARD)}`);
    expect(run.stdout).not.toContain(`#${String(UNLABELLED_ROADMAP)}`);
  });
});

describe('rafa roadmap over two labelled boards with no roadmap.issue configured, spawned', () => {
  const HIGHER_BOARD = 7;
  const LOWER_BOARD = 3;

  let scratch: ScratchRepo;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, projectConfigText());
    addOrigin(scratch);
    writeGhStub(scratch, {
      // Planted out of order, so a resolver taking the first row fails.
      labelListing: [
        boardIssue(HIGHER_BOARD, 'Board seven', '', [ROADMAP_LABEL]),
        boardIssue(LOWER_BOARD, 'Board three', '', [ROADMAP_LABEL]),
      ],
      view: { number: LOWER_BOARD, title: 'Board three', body: '', state: 'OPEN', stateReason: '', labels: [{ name: ROADMAP_LABEL }], author: { login: 'me' } },
    });
  });

  it('reads the lower-numbered labelled board', () => {
    const run = runRafa(scratch, scratch.repo, ['roadmap']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Roadmap: #${String(LOWER_BOARD)}`);
    expect(run.stdout).not.toContain(`#${String(HIGHER_BOARD)}`);
  });
});
