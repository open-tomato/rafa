/**
 * Spawned `bun src/rafa.ts` proof that five commands reach a real `gh` on
 * the PATH the way `epic-lifecycle-spawn.test.ts` proves it for the
 * labels mode: `rafa issue unblock`, `rafa epic move`, `rafa epic new`,
 * `rafa init --board --epic-guard` and `rafa pr merge`, each dispatched
 * through the REGISTERED command (`src/commands/index.ts`) over a project
 * whose `.rafa/config.yaml` names `board.relationships: native`.
 *
 * Every other native-mode case of these five commands dispatches over a
 * `GhRunner` built by hand, in-process (`unblock-native.test.ts`,
 * `epic/move-native.test.ts`, `epic/new-native.test.ts`,
 * `init-board-native.test.ts`, `pr/merge-native.test.ts`); none of them
 * proves the wiring from the registered command to a `gh` binary spawned
 * for real, which is the one thing this file adds. Each describe block
 * plants a fixture of its own, a stand-in `gh` that fails loudly, naming
 * the call, on anything it was not planted to answer, and asserts on the
 * exact `gh` calls the run logged.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BOARDS_LIST_ARGS } from '../board/boards.js';
import { EPIC_GUARD_PATH } from '../board/epic-guard.js';
import { BOARD_LISTING_LIMIT, boardListingCommand } from '../board/roadmap-board.js';
import { BOARD_LABELS, LABEL_LIST_LIMIT } from '../board/setup.js';
import { NATIVE_MODE, nativeParentLine } from '../commands/epic/move-native.js';
import { EPIC_GUARD_NATIVE_REFUSAL } from '../commands/init-board.js';
import { NATIVE_UNBLOCK_LINE } from '../commands/issue/unblock-native.js';
import { freedHeaderLine, freedIssueLine } from '../commands/pr/merge-freed.js';
import { positionAt, writePositionFile } from '../project/position.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-native-relations-spawn-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function readFileCommand(path: string): string {
  return `IFS= read -r line < '${path}' || true; printf '%s' "$line"`;
}

/** A `gh` that fails loudly, naming the call, on every route: nothing should ever reach it. */
function writeRefusingGh(scratch: ScratchRepo): void {
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'echo "unplanned gh call: $*" >&2',
    'exit 1',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

describe('rafa issue unblock in native mode, spawned', () => {
  it('prints that the tracker clears a blocker and sends no gh call at all', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, 'board:\n  relationships: native\n');
    writeRefusingGh(scratch);

    const run = runRafa(scratch, scratch.repo, ['issue', 'unblock', '12']);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(`${NATIVE_UNBLOCK_LINE}\n`);
  }, SPAWN_TIMEOUT);
});

describe('rafa epic move in native mode, spawned', () => {
  /** The board's own repository, matched against every link's URL. */
  const REPOSITORY = 'acme/board';
  const FROM_EPIC = 10;
  const TO_EPIC = 40;
  const ISSUE = 12;

  /** A link node, as `gh` writes one, on the board's own repository. */
  function link(number: number, title: string, state: 'OPEN' | 'CLOSED'): object {
    return { number, title, state, url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
  }

  /** A relationship list of `nodes`, none of it truncated. */
  function links(nodes: readonly object[]): object {
    return { nodes, totalCount: nodes.length };
  }

  /** One native-listing row. */
  function row(
    number: number,
    title: string,
    state: 'OPEN' | 'CLOSED',
    labels: readonly string[],
    parent: object | null,
  ): object {
    return {
      number,
      title,
      body: '',
      state,
      stateReason: state === 'CLOSED'
        ? 'COMPLETED'
        : null,
      labels: labels.map((name) => ({ name })),
      parent,
      blockedBy: links([]),
      blocking: links([]),
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      subIssues: links([]),
    };
  }

  /** The board: two open epics and one closed member of the first. */
  const LISTING: readonly object[] = [
    row(FROM_EPIC, 'Auth epic', 'OPEN', ['type:epic'], null),
    row(TO_EPIC, 'Billing epic', 'OPEN', ['type:epic'], null),
    row(ISSUE, 'Some closed issue', 'CLOSED', [], link(FROM_EPIC, 'Auth epic', 'OPEN')),
  ];

  /** Writes the stand-in `gh`: the repository, the native listing, the parent edit and the comment post. */
  function writeGhStub(scratch: ScratchRepo, data: string): void {
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'repo.json'), JSON.stringify({ nameWithOwner: REPOSITORY }), 'utf8');
    writeFileSync(join(data, 'listing.json'), JSON.stringify(LISTING), 'utf8');

    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, [
      '#!/bin/sh',
      `LOG='${scratch.callLog}'`,
      '',
      'route() {',
      '  printf \'%s\\n\' "$1" >> "$LOG"',
      '}',
      '',
      'case "$1 $2" in',
      '  "repo view")',
      '    route "$*"',
      `    ${readFileCommand(join(data, 'repo.json'))}`,
      '    ;;',
      '  "issue list")',
      '    route "$*"',
      `    ${readFileCommand(join(data, 'listing.json'))}`,
      '    ;;',
      '  "issue edit")',
      '    route "$*"',
      '    printf \'\'',
      '    ;;',
      '  "api "*)',
      '    case "$4" in',
      '      POST)',
      '        route "api $2 -X POST"',
      '        printf \'{"id": 1, "body": "posted", "user": {"login": "octocat"}}\'',
      '        ;;',
      '      *)',
      '        echo "unplanned gh call: $*" >&2',
      '        exit 1',
      '        ;;',
      '    esac',
      '    ;;',
      '  *)',
      '    echo "unplanned gh call: $*" >&2',
      '    exit 1',
      '    ;;',
      'esac',
      '',
    ].join('\n'), 'utf8');
    chmodSync(gh, 0o755);
  }

  it('sends the repository read, the native listing, the parent edit and the comment; no label or checklist write', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, 'pr:\n  provider: gh\n  base: main\nboard:\n  relationships: native\n');
    const data = join(dirname(scratch.repo), 'data');
    writeGhStub(scratch, data);

    const run = runRafa(scratch, scratch.repo, [
      'epic', 'move', String(ISSUE), `--to=${String(TO_EPIC)}`, '--reason=Consolidating with billing',
    ]);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout.split('\n')).toEqual([
      `Moved #${String(ISSUE)} from epic #${String(FROM_EPIC)} to #${String(TO_EPIC)}: Consolidating with billing`,
      nativeParentLine(TO_EPIC),
      '',
    ]);

    const log = readFileSync(scratch.callLog, 'utf8').split('\n')
      .filter((line) => line !== '');
    expect(log).toEqual([
      'repo view --json nameWithOwner',
      boardListingCommand(BOARD_LISTING_LIMIT, 'native').slice('gh '.length),
      `issue edit ${String(ISSUE)} --parent ${String(TO_EPIC)}`,
      `api repos/{owner}/{repo}/issues/${String(ISSUE)}/comments -X POST`,
    ]);
  }, SPAWN_TIMEOUT);
});

describe('rafa epic new in native mode, spawned', () => {
  /** One `gh issue list` row, labels named plainly; the labels-mode fields alone, since `epic new` never asks for the native ones. */
  function row(number: number, title: string, body: string, labels: readonly string[]): object {
    return { number, title, body, state: 'OPEN', stateReason: '', labels: labels.map((name) => ({ name })) };
  }

  const BOARD_NUMBER = 100;
  const BOARD: readonly object[] = [row(BOARD_NUMBER, 'Roadmap', '', ['type:roadmap'])];

  /** Writes the stand-in `gh`: the board listing, the issue create and the checklist's read/write/re-read. */
  function writeGhStub(scratch: ScratchRepo, data: string, createdUrl: string): void {
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'board.json'), JSON.stringify(BOARD), 'utf8');
    writeFileSync(join(data, 'created-url.txt'), createdUrl, 'utf8');
    writeFileSync(join(data, `body-${String(BOARD_NUMBER)}.txt`), '', 'utf8');

    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, [
      '#!/bin/sh',
      `DATA='${data}'`,
      `LOG='${scratch.callLog}'`,
      '',
      'route() {',
      '  printf \'%s\\n\' "$1" >> "$LOG"',
      '}',
      '',
      'case "$1 $2" in',
      '  "issue list")',
      '    route "$*"',
      `    ${readFileCommand(join(data, 'board.json'))}`,
      '    ;;',
      '  "issue create")',
      '    route "issue create $3 $5 $6"',
      `    ${readFileCommand(join(data, 'created-url.txt'))}`,
      '    ;;',
      '  "label list")',
      '    echo "unplanned gh call: $*" >&2',
      '    exit 1',
      '    ;;',
      '  "label create")',
      '    echo "unplanned gh call: $*" >&2',
      '    exit 1',
      '    ;;',
      '  "api "*)',
      '    case "$4" in',
      '      PATCH)',
      '        val="$6"',
      '        val="${val#body=}"',
      '        num="${2##*/}"',
      '        printf \'%s\' "$val" > "$DATA/body-$num.txt"',
      '        route "api $2 -X PATCH"',
      '        printf \'{"body": "%s"}\' "$val"',
      '        ;;',
      '      *)',
      '        num="${2##*/}"',
      '        route "api $2"',
      '        IFS= read -r val < "$DATA/body-$num.txt" || true',
      '        printf \'{"body": "%s"}\' "$val"',
      '        ;;',
      '    esac',
      '    ;;',
      '  *)',
      '    echo "unplanned gh call: $*" >&2',
      '    exit 1',
      '    ;;',
      'esac',
      '',
    ].join('\n'), 'utf8');
    chmodSync(gh, 0o755);
  }

  it('creates the issue with type:epic and its horizon alone, and its board line, asking gh nothing about labels', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, 'tracker:\n  default: local\nboard:\n  relationships: native\n');
    writePositionFile(scratch.repo, positionAt({ board: BOARD_NUMBER, epic: null }));
    const data = join(dirname(scratch.repo), 'data');
    const createdUrl = 'https://github.com/acme/board/issues/501';
    writeGhStub(scratch, data, createdUrl);

    const run = runRafa(scratch, scratch.repo, ['epic', 'new', 'Sign-in without passwords']);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      `${NATIVE_MODE}, so it is named by its number and title and no epic: label was created.`,
    );
    expect(run.stdout).toContain(`Added its line to board #${String(BOARD_NUMBER)}.`);
    expect(run.stdout).toContain(createdUrl);

    const log = readFileSync(scratch.callLog, 'utf8').split('\n')
      .filter((line) => line !== '');
    expect(log).toEqual([
      boardListingCommand(BOARD_LISTING_LIMIT).slice('gh '.length),
      'issue create --title=Sign-in without passwords --label=type:epic --label=horizon:later',
      `api repos/{owner}/{repo}/issues/${String(BOARD_NUMBER)}`,
      `api repos/{owner}/{repo}/issues/${String(BOARD_NUMBER)} -X PATCH`,
      `api repos/{owner}/{repo}/issues/${String(BOARD_NUMBER)}`,
    ]);
    expect(readFileSync(join(data, `body-${String(BOARD_NUMBER)}.txt`), 'utf8')).toBe('- [ ] #501 Sign-in without passwords');
  }, SPAWN_TIMEOUT);
});

describe('rafa init --board --epic-guard in native mode, spawned', () => {
  it('refuses the epic guard with a line naming the mode, and the board step sends one gh label list call', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(
      scratch.repo,
      'board:\n  relationships: native\npr:\n  provider: gh\nroadmap:\n  issue: 100\n',
    );
    const data = join(dirname(scratch.repo), 'data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'labels.json'), JSON.stringify(BOARD_LABELS.map((label) => ({ name: label.name }))), 'utf8');

    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, [
      '#!/bin/sh',
      `LOG='${scratch.callLog}'`,
      'case "$1 $2" in',
      '  "label list")',
      '    printf \'%s\\n\' "$*" >> "$LOG"',
      `    ${readFileCommand(join(data, 'labels.json'))}`,
      '    ;;',
      '  *)',
      '    echo "unplanned gh call: $*" >&2',
      '    exit 1',
      '    ;;',
      'esac',
      '',
    ].join('\n'), 'utf8');
    chmodSync(gh, 0o755);

    const run = runRafa(scratch, scratch.repo, ['init', `--root=${scratch.repo}`, '--board', '--epic-guard']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(EPIC_GUARD_NATIVE_REFUSAL);
    expect(existsSync(join(scratch.repo, EPIC_GUARD_PATH))).toBe(false);

    const log = readFileSync(scratch.callLog, 'utf8').split('\n')
      .filter((line) => line !== '');
    expect(log).toEqual([`label list --limit ${String(LABEL_LIST_LIMIT)} --json name`]);
  }, SPAWN_TIMEOUT);
});

describe('rafa pr merge in native mode, spawned', () => {
  const REPOSITORY = 'acme/board';
  const BRANCH = 'featbranch';
  const PR_NUMBER = 41;
  const ROADMAP_ISSUE = 31;
  const FREED_ISSUE = 12;
  const STILL_WAITING_ISSUE = 13;
  const CLOSED_ISSUE = 20;
  const OTHER_OPEN_BLOCKER = 26;

  /** A link node, as `gh` writes one, on the board's own repository. */
  function link(number: number, title: string, state: 'OPEN' | 'CLOSED'): object {
    return { number, title, state, url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
  }

  /** A relationship list of `nodes`, none of it truncated. */
  function links(nodes: readonly object[]): object {
    return { nodes, totalCount: nodes.length };
  }

  /** One native-listing row, open, waiting on `blockedBy`. */
  function row(number: number, title: string, blockedBy: readonly object[]): object {
    return {
      number,
      title,
      body: '',
      state: 'OPEN',
      stateReason: null,
      labels: [],
      parent: null,
      blockedBy: links(blockedBy),
      blocking: links([]),
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      subIssues: links([]),
    };
  }

  /** #12 waits on #20 alone; #13 waits on #20 and the still-open #26. */
  const LISTING: readonly object[] = [
    row(FREED_ISSUE, 'Sign-in page', [link(CLOSED_ISSUE, 'Sign-in', 'CLOSED')]),
    row(STILL_WAITING_ISSUE, 'Session store', [link(CLOSED_ISSUE, 'Sign-in', 'CLOSED'), link(OTHER_OPEN_BLOCKER, 'Tokens', 'OPEN')]),
  ];

  /** A pull request detail closing `body`'s issue. */
  function detail(): object {
    return {
      number: PR_NUMBER,
      title: 'Ship sign-in',
      url: `https://github.com/${REPOSITORY}/pull/${String(PR_NUMBER)}`,
      state: 'OPEN',
      headRefName: BRANCH,
      baseRefName: 'main',
      author: { login: 'octocat', is_bot: false },
      isCrossRepository: false,
      updatedAt: '2026-09-27T00:00:00Z',
      body: `Closes #${String(CLOSED_ISSUE)}`,
      headRefOid: 'deadbeef',
      labels: [],
      mergeStateStatus: 'CLEAN',
      mergeable: 'MERGEABLE',
    };
  }

  /** The environment every git run here uses: `scratch`'s own HOME, global and system config off. */
  function gitEnv(scratch: ScratchRepo): Readonly<Record<string, string | undefined>> {
    return {
      ...process.env,
      HOME: scratch.home,
      GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
    };
  }

  /** Runs one git command for real, in `scratch.repo`, isolated the way {@link gitEnv} names. */
  function git(scratch: ScratchRepo, args: readonly string[]): void {
    execFileSync('git', [...args], { cwd: scratch.repo, stdio: 'pipe', env: gitEnv(scratch) });
  }

  /**
   * Plants a work tree on `main` with one commit, pushed to a bare
   * `origin.git` beside it, then `branch` off it with one more commit,
   * pushed too and left checked out, so the merge's clean-up has a real
   * base and a real head to work with.
   */
  function plantMergeRepo(): ScratchRepo {
    const scratch = plantScratchRepo(tempBase, { project: false });
    git(scratch, ['checkout', '-q', '-B', 'main']);
    writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
    writeFileSync(join(scratch.repo, 'README.md'), 'first\n', 'utf8');
    git(scratch, ['add', '.gitignore', 'README.md']);
    git(scratch, ['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.invalid', 'commit', '-q', '-m', 'first']);
    const bare = join(dirname(scratch.repo), 'origin.git');
    git(scratch, ['init', '-q', '--bare', bare]);
    git(scratch, ['remote', 'add', 'origin', bare]);
    git(scratch, ['push', '-q', '-u', 'origin', 'main']);
    git(scratch, ['switch', '-q', '-c', BRANCH]);
    writeFileSync(join(scratch.repo, 'feature.txt'), 'a feature\n', 'utf8');
    git(scratch, ['add', 'feature.txt']);
    git(scratch, ['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.invalid', 'commit', '-q', '-m', 'feature']);
    git(scratch, ['push', '-q', '-u', 'origin', BRANCH]);
    return scratch;
  }

  /**
   * Writes the stand-in `gh` for `rafa pr merge`: the pull request, one
   * green check, the merge itself, the empty `type:roadmap` listing (so
   * the tick falls back to `roadmap.issue`), the roadmap's own body (read
   * only: it names neither closed issue, so nothing is ticked), the
   * repository and the native listing the freed-issue reading sends.
   */
  function writeGhStub(scratch: ScratchRepo, data: string): void {
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'detail.json'), JSON.stringify(detail()), 'utf8');
    writeFileSync(join(data, 'checks.json'), JSON.stringify([{ name: 'build', state: 'SUCCESS', link: 'https://example.invalid/run/1' }]), 'utf8');
    writeFileSync(join(data, 'repo.json'), JSON.stringify({ nameWithOwner: REPOSITORY }), 'utf8');
    writeFileSync(join(data, 'listing.json'), JSON.stringify(LISTING), 'utf8');
    writeFileSync(join(data, `body-${String(ROADMAP_ISSUE)}.txt`), '', 'utf8');

    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, [
      '#!/bin/sh',
      `DATA='${data}'`,
      `LOG='${scratch.callLog}'`,
      '',
      'route() {',
      '  printf \'%s\\n\' "$1" >> "$LOG"',
      '}',
      '',
      'case "$*" in *"--label type:roadmap"*) route "$*"; printf \'%s\' \'[]\'; exit 0;; esac',
      'case "$1 $2" in',
      '  "pr view")',
      '    route "pr view"',
      `    ${readFileCommand(join(data, 'detail.json'))}`,
      '    ;;',
      '  "pr checks")',
      '    route "pr checks"',
      `    ${readFileCommand(join(data, 'checks.json'))}`,
      '    ;;',
      '  "pr merge")',
      '    route "pr merge"',
      '    printf \'\'',
      '    ;;',
      '  "repo view")',
      '    route "$*"',
      `    ${readFileCommand(join(data, 'repo.json'))}`,
      '    ;;',
      '  "issue list")',
      '    route "$*"',
      `    ${readFileCommand(join(data, 'listing.json'))}`,
      '    ;;',
      '  "api "*)',
      '    case "$4" in',
      '      PATCH)',
      '        echo "unplanned gh call: $*" >&2',
      '        exit 1',
      '        ;;',
      '      *)',
      '        num="${2##*/}"',
      '        route "api $2"',
      '        IFS= read -r val < "$DATA/body-$num.txt" || true',
      '        printf \'{"body": "%s"}\' "$val"',
      '        ;;',
      '    esac',
      '    ;;',
      '  *)',
      '    echo "unplanned gh call: $*" >&2',
      '    exit 1',
      '    ;;',
      'esac',
      '',
    ].join('\n'), 'utf8');
    chmodSync(gh, 0o755);
  }

  it('sends the repository read and one native listing, and names the issue the merge freed', () => {
    const scratch = plantMergeRepo();
    plantProjectConfig(
      scratch.repo,
      `pr:\n  provider: gh\n  base: main\nboard:\n  relationships: native\nroadmap:\n  issue: ${String(ROADMAP_ISSUE)}\n`,
    );
    const data = join(dirname(scratch.repo), 'data');
    writeGhStub(scratch, data);

    const run = runRafa(scratch, scratch.repo, ['pr', 'merge', String(PR_NUMBER), '--yes', '--no-hint']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(freedHeaderLine([CLOSED_ISSUE], 1));
    expect(run.stdout).toContain(freedIssueLine({ number: FREED_ISSUE, title: 'Sign-in page' }));
    expect(run.stdout).not.toContain(`#${String(STILL_WAITING_ISSUE)}`);
    expect(run.stdout).not.toContain('spec:blocked');

    const log = readFileSync(scratch.callLog, 'utf8').split('\n')
      .filter((line) => line !== '');
    expect(log).toEqual([
      'pr view',
      'pr checks',
      'pr merge',
      BOARDS_LIST_ARGS.join(' '),
      `api repos/{owner}/{repo}/issues/${String(ROADMAP_ISSUE)}`,
      'repo view --json nameWithOwner',
      boardListingCommand(BOARD_LISTING_LIMIT, 'native').slice('gh '.length),
    ]);
  }, SPAWN_TIMEOUT);
});
