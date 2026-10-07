/**
 * Spawned `bun src/rafa.ts` runs of `rafa epic move`, `rafa epic defer`
 * and `rafa epic new`, each over a fixture board of its own, proving that
 * the REGISTERED commands (`src/commands/index.ts`) reach a real `gh` on
 * the PATH through `createGhRunner`, exactly as `pr-spawn.test.ts` and
 * `issue/create.test.ts`'s own spawned case do for their subjects. Every
 * other case of `move.ts`, `horizon-change.ts` and `new.ts` dispatches
 * over a `GhRunner` built by hand; none of them proves the wiring from
 * the registered command to a `gh` binary spawned for real, which is the
 * one thing this file adds.
 *
 * ## The stand-in `gh`
 *
 * {@link writeEpicGhStub} writes one shell script answering every route
 * the three commands send: the board listing, `label list`, `label
 * create`, `issue create` (answering the URL `data/created-url.txt`
 * holds), `issue edit` (the label swap), `pr list` (empty unless a
 * fixture says otherwise) and the `gh api repos/{owner}/{repo}/issues/<n>`
 * pair a checklist edit reads and writes, kept in `data/body-<n>.txt`
 * across the read, write and re-read `editChecklist` makes, so a case
 * reads back the exact body its own run left. A `POST .../comments` is
 * answered with a fixed comment, since neither command reads what it
 * answers, and every call is logged to `scratch.callLog`, the payload of
 * a body write, a comment post and an issue create left off it, since a
 * checklist body spans several lines and would break the one-call-per-line
 * log every other spawned case here relies on; those payloads are read
 * back from `data/body-<n>.txt` and `data/comments-<n>.log` instead. A
 * call this file did not plan for exits 1, naming it, the same rule every
 * other stand-in `gh` in this suite holds.
 *
 * ## The three fixtures
 *
 * `rafa epic move` moves issue #12, CLOSED so no branch or pull request
 * is read, from epic #10 (`epic:auth`) to epic #40 (`epic:billing`),
 * proving the label swap, the one checklist line moved between the two
 * epics' bodies and the one breadcrumb comment, with no `issue create` or
 * `issue close` sent.
 *
 * `rafa epic defer` moves epic #40 (`epic:proj`, `horizon:now`) to
 * `later`, in progress on a closed member (#41) and an open one (#42)
 * carrying a real branch `feat/rafa-42-fix-thing`, planted with one empty
 * commit and a reachable empty bare `origin` so the branch scan's remote
 * half never fails and warns. `--reason` is passed, so the label swaps and
 * the reason is commented, and since a spawned run has no terminal
 * (`switch-next-plan-cli.test.ts` measures the same), the keep question is
 * never asked and its open branch is kept and named.
 *
 * `rafa epic new` creates the label, the epic issue from the shipped
 * template and its line on the current board, board #100
 * (`type:roadmap`), reached with no default-board resolution at all: a
 * position file naming it current and home stands, since the board
 * carries the label, so `resolveDefaultBoard`'s own listing and title
 * search are never asked.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { positionAt, writePositionFile } from '../project/position.js';

import { expectExit, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-lifecycle-spawn-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** One `gh issue list` row, labels named plainly. */
function row(
  number: number,
  title: string,
  body: string,
  state: 'OPEN' | 'CLOSED',
  labels: readonly string[],
  stateReason = '',
): object {
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** What {@link writeEpicGhStub} answers `gh` with, beyond the board listing. */
interface GhFixture {
  readonly board: readonly object[];
  /** Label names the repository holds; empty unless a case names one. */
  readonly labels?: readonly string[];
  /** Open pull requests `gh pr list` answers; empty unless a case names one. */
  readonly pulls?: readonly object[];
  /** The initial checklist body of every issue a checklist edit reads or writes, by number. */
  readonly bodies?: Readonly<Record<number, string>>;
  /** The URL `gh issue create` answers with; only read when a case sends one. */
  readonly createdIssueUrl?: string;
}

/**
 * Writes the stand-in `gh` into `scratch.bin`, backed by the fixture
 * files this answers `writeEpicGhStub` writes under a `data/` directory
 * beside `scratch.repo`; see the module note. Answers that directory, so
 * a case can read back what a run left in it.
 */
function writeEpicGhStub(scratch: ScratchRepo, fixture: GhFixture): string {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'board.json'), JSON.stringify(fixture.board), 'utf8');
  writeFileSync(join(data, 'labels.json'), JSON.stringify((fixture.labels ?? []).map((name) => ({ name }))), 'utf8');
  writeFileSync(join(data, 'pulls.json'), JSON.stringify(fixture.pulls ?? []), 'utf8');
  writeFileSync(join(data, 'created-url.txt'), fixture.createdIssueUrl ?? '', 'utf8');
  for (const [issue, body] of Object.entries(fixture.bodies ?? {})) {
    writeFileSync(join(data, `body-${issue}.txt`), body, 'utf8');
  }

  const gh = join(scratch.bin, 'gh');
  const script = [
    '#!/bin/sh',
    `DATA='${data}'`,
    `LOG='${scratch.callLog}'`,
    '',
    'read_file() {',
    '  IFS= read -r line < "$1" || true',
    '  printf \'%s\' "$line"',
    '}',
    '',
    'json_escape() {',
    '  first=1',
    '  while IFS= read -r line || [ -n "$line" ]; do',
    '    if [ "$first" -eq 1 ]; then first=0; else printf \'\\n\'; fi',
    '    printf \'%s\' "$line"',
    '  done',
    '}',
    '',
    'route() {',
    '  printf \'%s\\n\' "$1" >> "$LOG"',
    '}',
    '',
    'case "$1 $2" in',
    '  "issue list")',
    '    route "$*"',
    '    read_file "$DATA/board.json"',
    '    ;;',
    '  "label list")',
    '    route "$*"',
    '    read_file "$DATA/labels.json"',
    '    ;;',
    '  "label create")',
    '    route "$*"',
    '    printf \'\'',
    '    ;;',
    '  "issue create")',
    '    route "issue create $3 $5 $6 $7"',
    '    read_file "$DATA/created-url.txt"',
    '    ;;',
    '  "issue edit")',
    '    route "$*"',
    '    printf \'\'',
    '    ;;',
    '  "pr list")',
    '    route "$*"',
    '    read_file "$DATA/pulls.json"',
    '    ;;',
    '  "api "*)',
    '    case "$4" in',
    '      PATCH)',
    '        val="$6"',
    '        val="${val#body=}"',
    '        num="${2##*/}"',
    '        printf \'%s\' "$val" > "$DATA/body-$num.txt"',
    '        route "api $2 -X PATCH"',
    '        json=$(printf \'%s\' "$val" | json_escape)',
    '        printf \'{"body": "%s"}\' "$json"',
    '        ;;',
    '      POST)',
    '        val="$6"',
    '        val="${val#body=}"',
    '        stripped="${2%/comments}"',
    '        num="${stripped##*/}"',
    '        printf \'%s\\n---\\n\' "$val" >> "$DATA/comments-$num.log"',
    '        route "api $2 -X POST"',
    '        printf \'{"id": 1, "body": "posted", "user": {"login": "octocat"}}\'',
    '        ;;',
    '      *)',
    '        num="${2##*/}"',
    '        route "api $2"',
    '        json=$(json_escape < "$DATA/body-$num.txt")',
    '        printf \'{"body": "%s"}\' "$json"',
    '        ;;',
    '    esac',
    '    ;;',
    '  *)',
    '    echo "unplanned gh call: $*" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n');
  writeFileSync(gh, script, 'utf8');
  chmodSync(gh, 0o755);
  return data;
}

/** Every call the stand-in logged, blank lines dropped. */
function callLog(scratch: ScratchRepo): readonly string[] {
  return readFileSync(scratch.callLog, 'utf8').split('\n')
    .filter((line) => line !== '');
}

/** What a fixture file under `data` holds. */
function dataFile(data: string, name: string): string {
  return readFileSync(join(data, name), 'utf8');
}

/** The environment every git run in this file uses: `scratch`'s own HOME, global and system config off. */
function gitEnv(scratch: ScratchRepo): Readonly<Record<string, string | undefined>> {
  return {
    ...process.env,
    HOME: scratch.home,
    GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
  };
}

/** One empty commit and a branch named `name` off it, HEAD left where it was. */
function plantBranch(scratch: ScratchRepo, name: string): void {
  const env = gitEnv(scratch);
  const run = (args: readonly string[]): void => {
    execFileSync('git', [...args], { cwd: scratch.repo, stdio: 'pipe', env });
  };
  run(['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'seed']);
  run(['branch', name]);
}

/**
 * Adds a reachable, empty bare `origin` remote, so the branch scan's
 * remote half (`git ls-remote --heads origin`) never fails and warns.
 */
function addOrigin(scratch: ScratchRepo): void {
  const env = gitEnv(scratch);
  const bare = join(dirname(scratch.repo), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', bare], { cwd: scratch.repo, stdio: 'pipe', env });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: scratch.repo, stdio: 'pipe', env });
}

describe('rafa epic move, spawned', () => {
  it('leaves #12 with the new label, one breadcrumb comment and its line moved, sending no issue create or issue close', () => {
    const scratch = plantScratchRepo(tempBase);
    const board = [
      row(10, 'Auth epic', '- [ ] #12', 'OPEN', ['type:epic', 'epic:auth', 'horizon:now']),
      row(40, 'Billing epic', '', 'OPEN', ['type:epic', 'epic:billing', 'horizon:next']),
      row(12, 'Some closed issue', '', 'CLOSED', ['epic:auth'], 'COMPLETED'),
    ];
    const data = writeEpicGhStub(scratch, { board, bodies: { 10: '- [ ] #12', 40: '' } });

    const run = runRafa(scratch, scratch.repo, ['epic', 'move', '12', '--to=40', '--reason=Consolidating with billing']);

    expect(run.stderr).toBe('');
    expectExit(run, 0, scratch);
    expect(run.stdout.split('\n')).toEqual([
      'Moved #12 from epic #10 to #40: Consolidating with billing',
      'Added its line to epic #40\'s checklist.',
      'Took its line off epic #10\'s checklist.',
      '',
    ]);

    const log = callLog(scratch);
    expect(log).toContain('issue edit 12 --remove-label epic:auth --add-label epic:billing');
    expect(log.some((line) => line.includes('issue create'))).toBe(false);
    expect(log.some((line) => line.includes('issue close'))).toBe(false);
    expect(log.filter((line) => line.startsWith('api'))).toEqual([
      'api repos/{owner}/{repo}/issues/40',
      'api repos/{owner}/{repo}/issues/40 -X PATCH',
      'api repos/{owner}/{repo}/issues/40',
      'api repos/{owner}/{repo}/issues/10',
      'api repos/{owner}/{repo}/issues/10 -X PATCH',
      'api repos/{owner}/{repo}/issues/10',
      'api repos/{owner}/{repo}/issues/12/comments -X POST',
    ]);

    expect(dataFile(data, 'body-40.txt')).toBe('- [ ] #12 Some closed issue');
    expect(dataFile(data, 'body-10.txt')).toBe('');
    expect(dataFile(data, 'comments-12.log')).toBe('Moved from epic #10 to #40: Consolidating with billing\n---\n');
  }, SPAWN_TIMEOUT);
});

describe('rafa epic defer, spawned', () => {
  it('swaps the label and comments the reason; with no terminal to ask on it keeps and names the open branch', () => {
    const scratch = plantScratchRepo(tempBase);
    plantBranch(scratch, 'feat/rafa-42-fix-thing');
    addOrigin(scratch);
    const board = [
      row(40, 'Proj epic', '', 'OPEN', ['type:epic', 'epic:proj', 'horizon:now']),
      row(41, 'Proj closed member', '', 'CLOSED', ['epic:proj'], 'COMPLETED'),
      row(42, 'Proj open member', '', 'OPEN', ['epic:proj']),
    ];
    const data = writeEpicGhStub(scratch, { board });

    const run = runRafa(scratch, scratch.repo, ['epic', 'defer', '40', '--to=later', '--reason=waiting on #118']);

    expect(run.stderr).toBe('');
    expectExit(run, 0, scratch);
    expect(run.stdout.split('\n')).toEqual([
      'Moved epic #40 now → later: waiting on #118',
      'No terminal to ask on, so its open work is kept: branch feat/rafa-42-fix-thing.',
      '',
    ]);

    const log = callLog(scratch);
    expect(log).toContain('issue edit 40 --remove-label horizon:now --add-label horizon:later');
    expect(log).toContain('api repos/{owner}/{repo}/issues/40/comments -X POST');
    expect(log.some((line) => line.includes('pr close'))).toBe(false);
    expect(dataFile(data, 'comments-40.log')).toBe('Moved now → later: waiting on #118\n---\n');
  }, SPAWN_TIMEOUT);
});

describe('rafa epic new, spawned', () => {
  it('creates the label, the issue from the template with its labels, and its line on the current board', () => {
    const scratch = plantScratchRepo(tempBase);
    const board = [
      row(100, 'Roadmap', '', 'OPEN', ['type:roadmap']),
    ];
    const data = writeEpicGhStub(scratch, {
      board,
      labels: ['type:epic', 'type:bug'],
      bodies: { 100: '' },
      createdIssueUrl: 'https://github.com/o/r/issues/501',
    });
    writePositionFile(scratch.repo, positionAt({ board: 100, epic: null }));

    const run = runRafa(scratch, scratch.repo, ['epic', 'new', 'Sign-in without passwords', '--slug=passwordless']);

    expect(run.stderr).toBe('');
    expectExit(run, 0, scratch);
    expect(run.stdout.split('\n')).toEqual([
      'Created epic #501 Sign-in without passwords, horizon later; created epic:passwordless.',
      'Added its line to board #100.',
      'https://github.com/o/r/issues/501',
      '',
    ]);

    const log = callLog(scratch);
    expect(log).toContain('label create epic:passwordless --description=A member of the passwordless epic');
    expect(log).toContain('issue create --title=Sign-in without passwords --label=type:epic --label=epic:passwordless --label=horizon:later');
    expect(log.some((line) => line.includes('--label type:roadmap'))).toBe(false);

    expect(dataFile(data, 'body-100.txt')).toBe('- [ ] #501 Sign-in without passwords');
  }, SPAWN_TIMEOUT);
});
