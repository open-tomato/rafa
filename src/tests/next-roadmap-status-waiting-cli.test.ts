/**
 * Spawned `bun src/rafa.ts` runs of `rafa status` over a fixture whose
 * `.rafa/hop.json` says a `rafa next --roadmap` hop came home with C's
 * pull request open and not yet approved
 * (`.rafa/specs/rafa-247-rafa-next-roadmap.md`, "`rafa status` while C
 * waits").
 *
 * One board, `BOARD_HOME` (#10), holds the home epic `EPIC_HOME` (#100).
 * A second board, `BOARD_TARGET` (#20), names `Owner: @beta-team` and
 * `Owns: target`, and holds the target epic `EPIC_TARGET` (#200) whose
 * member `MEMBER_C` (#201) is C, the hop's target. `.rafa/position.json`
 * is planted directly at home (`board 10 · epic 100`), so `resolvePlace`
 * reads it without a default-board lookup, and the hop record's `home`
 * matches it, so it is never read stale.
 *
 * The pull request `PULL` (#555) changes one path under `target/`, which
 * `owningBoard` reads as `BOARD_TARGET`'s, foreign to home; its `Owner:`
 * handle, `@beta-team`, resolves (`gh api users/beta-team` exits 0) but
 * has left no review, so the gate reads `waiting`
 * (`readOwnerApproval`, `src/pr/owner-approval.ts`) and
 * `rafa status` prints the waiting line under the board line.
 *
 * Three cases:
 *
 * 1. The pull request open and unapproved: the waiting line prints.
 * 2. The same pull request merged: `openPullGate` (`./sections.ts`) never
 *    asks the gate, and no waiting line prints.
 * 3. A project with no `.rafa/hop.json` at all: two runs of `rafa status`
 *    over the same project answer byte-identical stdout, and neither
 *    mentions a waiting line — the fixture reused for cases 1 and 2 but
 *    with `hop.json` left unplanted, so the world otherwise matches.
 *
 * The stand-in `gh` tells its callers apart by their own flags, as
 * `board-switch-status-cli.test.ts` does, with three more routes added
 * for the pull request: `pr view <n> --json <fields>`, told apart by
 * which fields were asked, and `api users/beta-team`.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { hopFilePath } from '../next/hop-record.js';
import { positionFilePath } from '../project/position.js';
import { projectConfigText } from '../project/scaffold.js';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-waiting-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a case may take: several sequential local `gh` and `git` reads, none of them network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The home board, naming no owner. */
const BOARD_HOME = 10;
/** The home epic, `BOARD_HOME`'s one `now` epic. */
const EPIC_HOME = 100;
/** The home epic's one open member. */
const MEMBER_H = 101;
/** The board the hop's target sits on, owning `target/` for `@beta-team`. */
const BOARD_TARGET = 20;
/** `BOARD_TARGET`'s one `now` epic. */
const EPIC_TARGET = 200;
/** C, the hop's target: `EPIC_TARGET`'s one open member. */
const MEMBER_C = 201;
/** The pull request C's hop left waiting. */
const PULL = 555;

/** One `gh issue list` or `gh issue view` row, labels already named. */
function issueRow(
  number: number,
  title: string,
  body: string,
  labels: readonly string[],
): { readonly number: number; readonly title: string; readonly body: string; readonly state: 'OPEN'; readonly stateReason: string; readonly labels: readonly { readonly name: string }[] } {
  return { number, title, body, state: 'OPEN', stateReason: '', labels: labels.map((name) => ({ name })) };
}

/** Every issue of the fixture: the two boards, their epics and their epics' members. */
const ALL_ISSUES = [
  issueRow(BOARD_HOME, 'Board Home', `- [ ] #${String(EPIC_HOME)}\n`, ['type:roadmap']),
  issueRow(EPIC_HOME, 'Home work', `- [ ] #${String(MEMBER_H)}\n`, ['type:epic', 'epic:home', 'horizon:now']),
  issueRow(MEMBER_H, 'Home task', '', ['epic:home']),
  issueRow(BOARD_TARGET, 'Board Target', `Owner: @beta-team\nOwns: target\n\n- [ ] #${String(EPIC_TARGET)}\n`, ['type:roadmap']),
  issueRow(EPIC_TARGET, 'Target work', `- [ ] #${String(MEMBER_C)}\n`, ['type:epic', 'epic:beta', 'horizon:now']),
  issueRow(MEMBER_C, 'Target task', '', ['epic:beta']),
];

/** The two open `type:roadmap` boards, as the labelled-board listing answers them. */
const LABELLED_BOARDS = ALL_ISSUES.filter((issue) => issue.labels.some((label) => label.name === 'type:roadmap'));

/** `issue view <n>`'s own fields: the general listing's row, with an author added. */
function viewOf(issue: (typeof ALL_ISSUES)[number]): object {
  return { number: issue.number, title: issue.title, body: issue.body, state: issue.state, labels: issue.labels, author: { login: 'me' } };
}

/** The fields `gh pr view` reads a detail through, as `src/pr/gh.ts` sends them. */
const DETAIL_FIELDS = 'author,baseRefName,headRefName,isCrossRepository,number,state,title,updatedAt,url,body,headRefOid,labels,mergeStateStatus,mergeable,closingIssuesReferences';

/** The pull request `PULL`'s detail, `state` the one thing a case varies. */
function pullDetail(state: 'OPEN' | 'MERGED'): object {
  return {
    number: PULL,
    title: 'feat: C',
    url: `https://github.com/open-tomato/rafa/pull/${String(PULL)}`,
    state,
    headRefName: 'feat/c',
    baseRefName: 'main',
    author: { login: 'someone', is_bot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-29T10:00:00Z',
    body: '',
    headRefOid: 'abc123',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    labels: [],
    closingIssuesReferences: [],
  };
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * Writes the stand-in `gh` into `scratch`'s `bin/`: every route
 * `board-switch-status-cli.test.ts` writes, with three more added for
 * the pull request a hop left waiting: `pr view <n> --json <fields>`,
 * told apart by which fields were asked, and `api users/beta-team`.
 * Anything unplanned fails loudly.
 */
function writeGhStub(scratch: ScratchRepo, pullState: 'OPEN' | 'MERGED'): void {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'labelled.json'), JSON.stringify(LABELLED_BOARDS), 'utf8');
  writeFileSync(join(data, 'all.json'), JSON.stringify(ALL_ISSUES), 'utf8');
  writeFileSync(join(data, 'pull-detail.json'), JSON.stringify(pullDetail(pullState)), 'utf8');
  writeFileSync(join(data, 'pull-files.json'), JSON.stringify({ changedFiles: 1, files: [{ path: 'target/thing.txt' }] }), 'utf8');
  writeFileSync(join(data, 'pull-reviews.json'), JSON.stringify({ reviews: [] }), 'utf8');
  for (const issue of ALL_ISSUES) {
    writeFileSync(join(data, `view-${String(issue.number)}.json`), JSON.stringify(viewOf(issue)), 'utf8');
  }

  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `case "$*" in *"--label type:roadmap"*) ${printFile(join(data, 'labelled.json'))}; exit 0;; esac`,
    'case "$*" in *"--label spec:blocked"*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$*" in *"--search "*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$1 $2" in',
    '  "issue view")',
    `    f='${data}'"/view-$3.json"`,
    '    if [ -f "$f" ]; then',
    '      while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$f"',
    '    else',
    '      echo "unplanned issue view: $3" >&2; exit 1',
    '    fi',
    '    ;;',
    '  "pr list") printf \'%s\' \'[]\';;',
    '  "pr view")',
    '    n=$3',
    '    case "$*" in',
    `      *"--json ${DETAIL_FIELDS}"*) ${printFile(join(data, 'pull-detail.json'))};;`,
    '      *"--json changedFiles,files"*) ' + printFile(join(data, 'pull-files.json')) + ';;',
    '      *"--json reviews"*) ' + printFile(join(data, 'pull-reviews.json')) + ';;',
    '      *) echo "unplanned pr view: $*" >&2; exit 1;;',
    '    esac',
    `    if [ "$n" != "${String(PULL)}" ]; then echo "unplanned pull request: $n" >&2; exit 1; fi`,
    '    ;;',
    '  "api users/beta-team") printf \'%s\' \'{}\';;',
    '  "issue list")',
    '    case "$*" in',
    '      *"--limit 500"*) printf \'%s\' \'[]\';;',
    `      *) ${printFile(join(data, 'all.json'))};;`,
    '    esac',
    '    ;;',
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** Writes `text` to `path`, making its directories. */
function plant(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** The position file: at home, `board 10 · epic 100`, before and after. */
function plantPosition(root: string): void {
  const place = { board: BOARD_HOME, epic: EPIC_HOME };
  plant(positionFilePath(root), `${JSON.stringify({ current: place, previous: place, home: place })}\n`);
}

/** The hop record: a `blocker` hop home with C's (#201) pull request (#555) waiting. */
function plantHop(root: string): void {
  const home = { board: BOARD_HOME, epic: EPIC_HOME };
  const record = {
    kind: 'blocker',
    home,
    from: home,
    blocked: MEMBER_H,
    target: MEMBER_C,
    targetEpic: EPIC_TARGET,
    targetBoard: BOARD_TARGET,
    state: 'waiting',
    pullRequest: PULL,
    startedAt: '2026-09-29T09:00:00.000Z',
  };
  plant(hopFilePath(root), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Makes `scratch` a project with one commit on `main` and a reachable,
 * empty bare `origin`, plants the position file and, unless `withHop` is
 * false, the hop record, and writes the stand-in `gh` answering `PULL`
 * in `pullState`.
 */
function plantWorld(scratch: ScratchRepo, pullState: 'OPEN' | 'MERGED', withHop: boolean): void {
  plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n`);
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['checkout', '-q', '-B', 'main']);
  writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', '-u', 'origin', 'main']);
  writeGhStub(scratch, pullState);
  plantPosition(scratch.repo);
  if (withHop) plantHop(scratch.repo);
}

describe('rafa status, a hop\'s waiting pull request, spawned', () => {
  it('prints the waiting line once the hop came home with C\'s pull request open and unapproved', RUN_TIMEOUT, () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantWorld(scratch, 'OPEN', true);

    const run = runRafa(scratch, scratch.repo, ['status']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`waiting on #${String(MEMBER_C)} (owner review)`);
  });

  it('prints no waiting line once the fixture pull request is merged', RUN_TIMEOUT, () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantWorld(scratch, 'MERGED', true);

    const run = runRafa(scratch, scratch.repo, ['status']);

    expectExit(run, 0, scratch);
    expect(run.stdout).not.toContain('waiting on');
  });

  it('prints byte-identical output, with no waiting line, on a project with no hop record', RUN_TIMEOUT, () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantWorld(scratch, 'OPEN', false);

    const first = runRafa(scratch, scratch.repo, ['status']);
    const second = runRafa(scratch, scratch.repo, ['status']);

    expectExit(first, 0, scratch);
    expectExit(second, 0, scratch);
    expect(first.stdout).not.toContain('waiting on');
    expect(second.stdout).toBe(first.stdout);
    expect(second.stderr).toBe(first.stderr);
  });
});
