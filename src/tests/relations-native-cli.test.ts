/**
 * Spawned `bun src/rafa.ts` proof that `rafa roadmap` and `rafa next
 * --dry-run` read GitHub's own sub-issue and blocked-by links for real,
 * over a stand-in `gh` on the PATH, the way `native-relations-spawn.
 * test.ts` proves it for `rafa issue unblock`, `rafa epic move`, `rafa
 * epic new`, `rafa init --board --epic-guard` and `rafa pr merge`.
 *
 * `roadmap-native.test.ts` and `next/relations-mode.test.ts` already
 * prove this wiring in-process, over a `GhRunner` built by hand; neither
 * proves that the REGISTERED commands, dispatched through `bun
 * src/rafa.ts`, reach a `gh` binary spawned for real with the native
 * `--json` fields and read it correctly, which is the one thing this
 * file adds. Each describe block plants a fixture of its own, a
 * stand-in `gh` that fails loudly, naming the call, on anything it was
 * not planted to answer, and asserts on the exact `gh` calls the run
 * logged.
 *
 * ## `rafa roadmap`
 *
 * Roadmap #1 lists two epics: #100, `in-progress` with one of three
 * sub-issues done (`subIssuesSummary`, not the two member rows the
 * listing happens to carry), and #200, `done` with both of its two
 * closed. #100's open member, #102, waits on a local blocker, #20, open,
 * and a foreign one, `other/lib#7`, closed — read off its own
 * `blockedBy` node, so `--full` prints its own state rather than "state
 * unknown", the `labels`-mode reading of a foreign token
 * (`relations-labels-baseline.test.ts`).
 *
 * ## `rafa next --dry-run`
 *
 * Board #1 lists #10, `spec:ready` and waiting on #20 (native
 * `blockedBy`), then #11, `spec:ready` and waiting on nothing. The first
 * run skips #10 and proposes #11; the fixture's own `board.json` is then
 * rewritten with #20 closed, and the second run proposes #10 instead —
 * both runs read no `Blocked by:` line and send no `gh issue edit` at
 * all, `--dry-run` writing nothing and native mode never touching a
 * label to mark or clear a blocker.
 *
 * ## `rafa next --roadmap --dry-run`
 *
 * Board #1 lists epic #5, `horizon:now`, whose one member is #10, waiting
 * (native `blockedBy`) on #21, a sub-issue (native `parent`) of epic #6,
 * which board #2 lists. #10's blocker is on another epic, reached through
 * its `parent` node rather than an `epic:<slug>` label, so the one-hop
 * decision (`src/next/hop-chain.ts` over `src/board/blocker-epic.ts`)
 * proposes the hop to epic #6 on board #2.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { SPEC_READY_LABEL } from '../board/readiness.js';
import { BOARD_LISTING_LIMIT, boardListingCommand } from '../board/roadmap-board.js';
import { positionFilePath } from '../project/position.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-relations-native-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may take: a handful of sequential local `gh` and `git` reads, none of them network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The config lines naming the native mode. */
const NATIVE_CONFIG = 'board:\n  relationships: native\n';

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/** Prints the file the shell variable `name` (e.g. `$f`) names, double-quoted so it is expanded. */
function printVarFile(name: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < "${name}"`;
}

/**
 * A commit on `main`, pushed to a bare `origin` beside the repository,
 * so the branch scan's remote half never fails and warns onto stdout,
 * which would land inside the captured bytes.
 */
function gitSetup(scratch: ScratchRepo): void {
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['checkout', '-q', '-B', 'main']);
  writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  git(['add', '-A']);
  git(['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.com', 'commit', '-q', '-m', 'initial']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', '-u', 'origin', 'main']);
}

/** One line of a `--full` table, trimmed of its leading spaces. */
function tableLines(stdout: string): readonly string[] {
  return stdout.split('\n').map((line) => line.trim())
    .filter((line) => line !== '');
}

describe('rafa roadmap in native mode, spawned', () => {
  /** The board's own repository. */
  const REPOSITORY = 'acme/board';

  const ROADMAP = 1;
  const EPIC_ONE = 100;
  const DONE_MEMBER = 101;
  const OPEN_MEMBER = 102;
  const EPIC_TWO = 200;
  const CLOSED_MEMBER = 201;
  const LOCAL_BLOCKER = 20;

  /** A linked issue as `gh issue list --json` answers it. */
  function link(number: number, state: 'OPEN' | 'CLOSED', repository = REPOSITORY): object {
    return { id: `I_${String(number)}`, number, state, title: `Issue ${String(number)}`, url: `https://github.com/${repository}/issues/${String(number)}` };
  }

  /** A relationship list of `nodes`, none of it truncated. */
  function links(nodes: readonly object[]): object {
    return { nodes, totalCount: nodes.length };
  }

  /** One row of the native listing, with all five relationship fields. */
  interface Row {
    readonly number: number;
    readonly title: string;
    readonly body?: string;
    readonly state?: 'OPEN' | 'CLOSED';
    readonly labels?: readonly string[];
    readonly parent?: number;
    readonly blockedBy?: readonly object[];
    readonly subIssues?: readonly object[];
    readonly summary?: { readonly completed: number; readonly total: number };
  }

  /** `row` as `gh issue list --json` answers it in native mode. */
  function rowOf(row: Row): object {
    const summary = row.summary ?? { completed: 0, total: 0 };
    const state = row.state ?? 'OPEN';
    return {
      number: row.number,
      title: row.title,
      body: row.body ?? '',
      state,
      stateReason: state === 'CLOSED'
        ? 'COMPLETED'
        : '',
      labels: (row.labels ?? []).map((name) => ({ name })),
      parent: row.parent === undefined
        ? null
        : link(row.parent, 'OPEN'),
      blockedBy: links(row.blockedBy ?? []),
      blocking: links([]),
      subIssuesSummary: { ...summary, percentCompleted: 0 },
      subIssues: links(row.subIssues ?? []),
    };
  }

  /** `row` as `gh issue view` answers it: the same fields, none of the native five. */
  function viewOf(row: Row): object {
    const state = row.state ?? 'OPEN';
    return {
      number: row.number,
      title: row.title,
      body: row.body ?? '',
      state,
      stateReason: state === 'CLOSED'
        ? 'COMPLETED'
        : '',
      labels: (row.labels ?? []).map((name) => ({ name })),
      author: { login: 'octocat' },
    };
  }

  /** Roadmap #1 names two epics; #100 is in-progress on GitHub's own sub-issue count, #200 is done. */
  const ROWS: readonly Row[] = [
    { number: ROADMAP, title: 'Roadmap', body: `- [ ] #${String(EPIC_ONE)} — epic one\n- [ ] #${String(EPIC_TWO)} — epic two\n`, labels: ['type:roadmap'] },
    {
      number: EPIC_ONE,
      title: 'Epic one',
      labels: ['type:epic', 'epic:one', 'horizon:now'],
      subIssues: [link(OPEN_MEMBER, 'OPEN'), link(DONE_MEMBER, 'CLOSED')],
      summary: { completed: 1, total: 3 },
    },
    { number: DONE_MEMBER, title: 'Member closed', state: 'CLOSED', parent: EPIC_ONE },
    {
      number: OPEN_MEMBER,
      title: 'Member open',
      parent: EPIC_ONE,
      blockedBy: [link(LOCAL_BLOCKER, 'OPEN'), link(7, 'CLOSED', 'other/lib')],
    },
    {
      number: EPIC_TWO,
      title: 'Epic two',
      state: 'CLOSED',
      labels: ['type:epic', 'epic:two', 'horizon:now'],
      subIssues: [link(CLOSED_MEMBER, 'CLOSED')],
      summary: { completed: 2, total: 2 },
    },
    { number: CLOSED_MEMBER, title: 'Member closed two', state: 'CLOSED', parent: EPIC_TWO },
    { number: LOCAL_BLOCKER, title: 'Local blocker' },
  ];

  /** Writes the stand-in `gh`: the repository, the native listing, and one `issue view` answer per fixture issue. */
  function writeGhStub(scratch: ScratchRepo, data: string, logPath: string): void {
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'repo.json'), JSON.stringify({ nameWithOwner: REPOSITORY }), 'utf8');
    writeFileSync(join(data, 'board.json'), JSON.stringify(ROWS.map(rowOf)), 'utf8');
    for (const row of ROWS) writeFileSync(join(data, `view-${String(row.number)}.json`), JSON.stringify(viewOf(row)), 'utf8');

    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, [
      '#!/bin/sh',
      `LOG='${logPath}'`,
      'route() { printf \'%s\\n\' "$1" >> "$LOG"; }',
      '',
      // The board cache's own watermark read: answered with no timestamp, so every run reads the whole board again.
      'case "$*" in *"issues?state=all&sort=updated"*) route "$*"; printf \'\'; exit 0;; esac',
      // `resolveDefaultBoard`'s fallbacks, never reached once `roadmap.issue` resolves, but sent anyway.
      'case "$*" in *"--label type:roadmap"*) route "$*"; printf \'%s\' \'[]\'; exit 0;; esac',
      'case "$*" in *"--search "*) route "$*"; printf \'%s\' \'[]\'; exit 0;; esac',
      'case "$1 $2" in',
      '  "repo view")',
      '    route "$*"',
      `    ${printFile(join(data, 'repo.json'))}`,
      '    ;;',
      '  "issue view")',
      '    route "$*"',
      `    f='${data}'"/view-$3.json"`,
      '    if [ -f "$f" ]; then',
      `      ${printVarFile('$f')}`,
      '    else',
      '      echo "unplanned issue view: $3" >&2; exit 1',
      '    fi',
      '    ;;',
      '  "pr list")',
      '    route "$*"',
      '    printf \'%s\' \'[]\'',
      '    ;;',
      '  "issue list")',
      '    route "$*"',
      `    ${printFile(join(data, 'board.json'))}`,
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

  let scratch: ScratchRepo;
  let logPath: string;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, `roadmap:\n  issue: ${String(ROADMAP)}\n${NATIVE_CONFIG}`);
    gitSetup(scratch);
    const data = join(dirname(scratch.repo), 'data');
    logPath = join(dirname(scratch.repo), 'gh-calls.log');
    writeGhStub(scratch, data, logPath);
  });

  it('prints each epic\'s state and done/total off GitHub\'s own sub-issue count, reading the repository once', RUN_TIMEOUT, () => {
    rmSync(logPath, { force: true });

    const run = runRafa(scratch, scratch.repo, ['roadmap']);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    const rows = tableLines(run.stdout);
    expect(rows).toContain(`#${String(EPIC_ONE)}  in-progress  1/3         -        -     Epic one`);
    expect(rows).toContain(`#${String(EPIC_TWO)}  done         2/2         -        -     Epic two`);

    const calls = readFileSync(logPath, 'utf8').split('\n')
      .filter((line) => line !== '');
    expect(calls.filter((call) => call === 'repo view --json nameWithOwner')).toHaveLength(1);
    expect(calls[0]).toBe('repo view --json nameWithOwner');
    expect(calls.filter((call) => call === boardListingCommand(BOARD_LISTING_LIMIT, 'native').slice('gh '.length))).toHaveLength(1);
  });

  it('prints --full members with the open one\'s local and foreign blockers, the foreign one reading its own state', RUN_TIMEOUT, () => {
    const run = runRafa(scratch, scratch.repo, ['roadmap', '--full']);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    const rows = tableLines(run.stdout);
    expect(rows).toContain(`#${String(OPEN_MEMBER)}  open    Member open`);
    expect(rows).toContain(`└→ 🔴 #${String(LOCAL_BLOCKER)} 🟢 other/lib#7`);
    // A foreign blocker reads its own state off its blockedBy node: never the labels-mode "state unknown".
    expect(run.stdout).not.toContain('state unknown');
  });
});

describe('rafa next --dry-run in native mode, spawned', () => {
  /** The board's own repository. */
  const REPOSITORY = 'acme/board';

  const ROADMAP = 1;
  const FIRST = 10;
  const SECOND = 11;
  const BLOCKER = 20;

  /** A linked issue as `gh issue list --json` answers it. */
  function link(number: number, state: 'OPEN' | 'CLOSED'): object {
    return { id: `I_${String(number)}`, number, state, title: `Issue ${String(number)}`, url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
  }

  /** A relationship list of `nodes`, none of it truncated. */
  function links(nodes: readonly object[]): object {
    return { nodes, totalCount: nodes.length };
  }

  /** One row of the native listing, with all five relationship fields. */
  function rowOf(number: number, title: string, labels: readonly string[], blockedBy: readonly object[]): object {
    return {
      number,
      title,
      body: '',
      state: 'OPEN',
      stateReason: '',
      labels: labels.map((name) => ({ name })),
      parent: null,
      blockedBy: links(blockedBy),
      blocking: links([]),
      subIssuesSummary: { completed: 0, total: 0, percentCompleted: 0 },
      subIssues: links([]),
    };
  }

  /** `number` as `gh issue view` answers it: the same fields, none of the native five. */
  function viewOf(number: number, title: string, body: string, labels: readonly string[]): object {
    return {
      number, title, body, state: 'OPEN', stateReason: '', labels: labels.map((name) => ({ name })), author: { login: 'octocat' },
    };
  }

  /** The fixture issues, less the native listing's `blockedBy`, which `boardJson` fills in for #20's own state. */
  const VIEWS: readonly object[] = [
    viewOf(ROADMAP, 'Roadmap', `- [ ] #${String(FIRST)}\n- [ ] #${String(SECOND)}\n`, ['type:roadmap']),
    viewOf(FIRST, 'Ten', '', [SPEC_READY_LABEL]),
    viewOf(SECOND, 'Eleven', '', [SPEC_READY_LABEL]),
    viewOf(BLOCKER, 'Twenty', '', []),
  ];

  /** The native listing with #20's own state: open first, closed once the second run rewrites it. */
  function boardJson(blockerState: 'OPEN' | 'CLOSED'): string {
    return JSON.stringify([
      rowOf(ROADMAP, 'Roadmap', ['type:roadmap'], []),
      rowOf(FIRST, 'Ten', [SPEC_READY_LABEL], [link(BLOCKER, blockerState)]),
      rowOf(SECOND, 'Eleven', [SPEC_READY_LABEL], []),
      rowOf(BLOCKER, 'Twenty', [], []),
    ]);
  }

  /** Writes the stand-in `gh`: the repository, `board.json` (rewritten between runs) and one `issue view` per fixture issue. */
  function writeGhStub(scratch: ScratchRepo, data: string, boardFile: string, logPath: string): void {
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'repo.json'), JSON.stringify({ nameWithOwner: REPOSITORY }), 'utf8');
    for (const view of VIEWS) writeFileSync(join(data, `view-${String((view as { readonly number: number }).number)}.json`), JSON.stringify(view), 'utf8');

    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, [
      '#!/bin/sh',
      `LOG='${logPath}'`,
      'route() { printf \'%s\\n\' "$1" >> "$LOG"; }',
      '',
      'case "$*" in *"issues?state=all&sort=updated"*) route "$*"; printf \'\'; exit 0;; esac',
      'case "$*" in *"--label type:roadmap"*) route "$*"; printf \'%s\' \'[]\'; exit 0;; esac',
      'case "$*" in *"--search "*) route "$*"; printf \'%s\' \'[]\'; exit 0;; esac',
      'case "$1 $2" in',
      '  "repo view")',
      '    route "$*"',
      `    ${printFile(join(data, 'repo.json'))}`,
      '    ;;',
      '  "issue view")',
      '    route "$*"',
      `    f='${data}'"/view-$3.json"`,
      '    if [ -f "$f" ]; then',
      `      ${printVarFile('$f')}`,
      '    else',
      '      echo "unplanned issue view: $3" >&2; exit 1',
      '    fi',
      '    ;;',
      '  "pr list")',
      '    route "$*"',
      '    printf \'%s\' \'[]\'',
      '    ;;',
      '  "issue list")',
      '    route "$*"',
      `    ${printFile(boardFile)}`,
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

  let scratch: ScratchRepo;
  let boardFile: string;
  let logPath: string;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(
      scratch.repo,
      `roadmap:\n  issue: ${String(ROADMAP)}\npr:\n  provider: gh\n  base: main\n${NATIVE_CONFIG}`,
    );
    gitSetup(scratch);
    const data = join(dirname(scratch.repo), 'data');
    boardFile = join(data, 'board.json');
    logPath = join(dirname(scratch.repo), 'gh-calls.log');
    mkdirSync(data, { recursive: true });
    writeFileSync(boardFile, boardJson('OPEN'), 'utf8');
    writeGhStub(scratch, data, boardFile, logPath);
  });

  it(`skips #${String(FIRST)} while #${String(BLOCKER)} is open and proposes #${String(SECOND)}, sending no label write`, RUN_TIMEOUT, () => {
    rmSync(logPath, { force: true });

    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe([
      `📍 #${String(SECOND)} is next on the roadmap and carries \`${SPEC_READY_LABEL}\`.`,
      `👉 create the plan for #${String(SECOND)} — rafa plan create --next`,
      '⏹ --dry-run: nothing ran.',
    ].join('\n') + '\n');
    expect(run.stdout).not.toContain(`#${String(FIRST)}`);

    const calls = readFileSync(logPath, 'utf8').split('\n')
      .filter((line) => line !== '');
    expect(calls.some((call) => call.startsWith('issue edit'))).toBe(false);
    expect(calls.join('\n')).not.toContain('spec:blocked');
  });

  it(`proposes #${String(FIRST)} once #${String(BLOCKER)} closes, still sending no label write`, RUN_TIMEOUT, () => {
    writeFileSync(boardFile, boardJson('CLOSED'), 'utf8');
    rmSync(logPath, { force: true });

    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe([
      `📍 #${String(FIRST)} is next on the roadmap and carries \`${SPEC_READY_LABEL}\`.`,
      `👉 create the plan for #${String(FIRST)} — rafa plan create --next`,
      '⏹ --dry-run: nothing ran.',
    ].join('\n') + '\n');
    expect(run.stdout).not.toContain(`#${String(SECOND)}`);

    const calls = readFileSync(logPath, 'utf8').split('\n')
      .filter((line) => line !== '');
    expect(calls.some((call) => call.startsWith('issue edit'))).toBe(false);
    expect(calls.join('\n')).not.toContain('spec:blocked');
  });
});

describe('rafa next --roadmap in native mode, spawned', () => {
  /** The board's own repository. */
  const REPOSITORY = 'acme/board';

  const BOARD_A = 1;
  const EPIC_HOME = 5;
  const H = 10;
  const BOARD_B = 2;
  const EPIC_FAR = 6;
  const C = 21;

  /** A linked issue as `gh issue list --json` answers it. */
  function link(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
    return { id: `I_${String(number)}`, number, state, title: `Issue ${String(number)}`, url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
  }

  /** A relationship list of `nodes`, none of it truncated. */
  function links(nodes: readonly object[]): object {
    return { nodes, totalCount: nodes.length };
  }

  /** The fields a case may set on a native row. */
  interface Row {
    readonly number: number;
    readonly title: string;
    readonly body?: string;
    readonly labels?: readonly string[];
    readonly parent?: number;
    readonly blockedBy?: readonly object[];
  }

  /** `row` as `gh issue list --json` answers it in native mode. */
  function rowOf(row: Row): object {
    return {
      number: row.number,
      title: row.title,
      body: row.body ?? '',
      state: 'OPEN',
      stateReason: '',
      labels: (row.labels ?? []).map((name) => ({ name })),
      parent: row.parent === undefined
        ? null
        : link(row.parent),
      blockedBy: links(row.blockedBy ?? []),
      blocking: links([]),
      subIssuesSummary: { completed: 0, total: 0, percentCompleted: 0 },
      subIssues: links([]),
    };
  }

  /** `row` as `gh issue view` answers it: the same fields, none of the native five. */
  function viewOf(row: Row): object {
    return {
      number: row.number, title: row.title, body: row.body ?? '', state: 'OPEN', stateReason: '', labels: (row.labels ?? []).map((name) => ({ name })), author: { login: 'octocat' },
    };
  }

  /**
   * Board #1 lists epic #5, whose member H (#10) waits on C (#21), a
   * sub-issue of epic #6, which board #2 lists; see the module note.
   */
  const ROWS: readonly Row[] = [
    { number: BOARD_A, title: 'Board Alpha', body: `- [ ] #${String(EPIC_HOME)}\n`, labels: ['type:roadmap'] },
    { number: EPIC_HOME, title: 'Epic home', body: `- [ ] #${String(H)}\n`, labels: ['type:epic', 'horizon:now'] },
    { number: H, title: 'H, blocked by C', labels: [SPEC_READY_LABEL], parent: EPIC_HOME, blockedBy: [link(C)] },
    { number: BOARD_B, title: 'Board Beta', body: `- [ ] #${String(EPIC_FAR)}\n`, labels: ['type:roadmap'] },
    { number: EPIC_FAR, title: 'Epic far', body: `- [ ] #${String(C)}\n`, labels: ['type:epic', 'horizon:now'] },
    { number: C, title: 'C, in epic far', parent: EPIC_FAR },
  ];

  /** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
  function printFile(file: string): string {
    return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
  }

  /** Prints the file the shell variable `name` (e.g. `$f`) names, double-quoted so it is expanded. */
  function printVarFile(name: string): string {
    return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < "${name}"`;
  }

  /**
   * A commit on `main`, pushed to a bare `origin` beside the repository,
   * so the branch scan's remote half never fails and warns onto stdout.
   */
  function gitSetup(scratch: ScratchRepo): void {
    const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
    const git = (args: readonly string[]): void => {
      execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
    };
    git(['checkout', '-q', '-B', 'main']);
    writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
    writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
    git(['add', '-A']);
    git(['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.com', 'commit', '-q', '-m', 'initial']);
    const bare = join(dirname(scratch.repo), 'origin.git');
    git(['init', '-q', '--bare', bare]);
    git(['remote', 'add', 'origin', bare]);
    git(['push', '-q', '-u', 'origin', 'main']);
  }

  /**
   * Writes the stand-in `gh`: the repository, the native listing over
   * both boards, a `type:roadmap`-labelled listing for the owner gate's
   * own (label-mode) board lister, and one `issue view` answer per
   * fixture issue. Anything unplanned fails loudly, naming the call.
   */
  function writeGhStub(scratch: ScratchRepo, data: string): void {
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'repo.json'), JSON.stringify({ nameWithOwner: REPOSITORY }), 'utf8');
    writeFileSync(join(data, 'board.json'), JSON.stringify(ROWS.map(rowOf)), 'utf8');
    const labelled = ROWS.filter((row) => (row.labels ?? []).includes('type:roadmap'));
    writeFileSync(join(data, 'labelled.json'), JSON.stringify(labelled.map(rowOf)), 'utf8');
    for (const row of ROWS) writeFileSync(join(data, `view-${String(row.number)}.json`), JSON.stringify(viewOf(row)), 'utf8');

    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, [
      '#!/bin/sh',
      // The board cache's own watermark read: answered with no timestamp, so the run reads the whole board again.
      'case "$*" in *"issues?state=all&sort=updated"*) printf \'\'; exit 0;; esac',
      // The owner gate's own (label-mode) board lister.
      `case "$*" in *"--label type:roadmap"*) ${printFile(join(data, 'labelled.json'))}; exit 0;; esac`,
      'case "$*" in *"--search "*) printf \'%s\' \'[]\'; exit 0;; esac',
      'case "$1 $2" in',
      '  "repo view")',
      `    ${printFile(join(data, 'repo.json'))}`,
      '    ;;',
      '  "issue view")',
      `    f='${data}'"/view-$3.json"`,
      '    if [ -f "$f" ]; then',
      `      ${printVarFile('$f')}`,
      '    else',
      '      echo "unplanned issue view: $3" >&2; exit 1',
      '    fi',
      '    ;;',
      '  "pr list")',
      '    printf \'%s\' \'[]\'',
      '    ;;',
      '  "issue list")',
      `    ${printFile(join(data, 'board.json'))}`,
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

  let scratch: ScratchRepo;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(
      scratch.repo,
      `roadmap:\n  issue: ${String(BOARD_A)}\npr:\n  provider: gh\n  base: main\n${NATIVE_CONFIG}`,
    );
    gitSetup(scratch);
    const data = join(dirname(scratch.repo), 'data');
    writeGhStub(scratch, data);
  });

  it(`proposes the hop to epic #${String(EPIC_FAR)} on board #${String(BOARD_B)}, #${String(H)}'s blocker read off its native parent`, RUN_TIMEOUT, () => {
    const position = positionFilePath(scratch.repo);
    expect(existsSync(position)).toBe(false);

    const run = runRafa(scratch, scratch.repo, ['next', '--roadmap', '--dry-run']);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe([
      `📍 hop from epic #${String(EPIC_HOME)}: #${String(H)} blocked by #${String(C)}, in epic #${String(EPIC_FAR)}.`,
      `👉 hop to epic #${String(EPIC_FAR)} on board #${String(BOARD_B)} and work #${String(C)}, keeping home`,
      '⏹ --dry-run: nothing ran.',
    ].join('\n') + '\n');
    // A dry run proposes the hop; it never writes the position a real hop would move.
    expect(existsSync(position)).toBe(false);
  });
});
