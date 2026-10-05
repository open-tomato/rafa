/**
 * A spawned-CLI capture harness, run BEFORE any module in
 * `src/board/relations/` exists (`context/pull-requests.md`, "Native
 * relationships"; this plan's stage note): over one fixture labels
 * board it writes golden captures of `rafa roadmap`, `rafa roadmap
 * --full`, `rafa next --dry-run` and `rafa plan create --next
 * --dry-run` — each command's stdout and the stand-in `gh` call log it
 * ran under — to `src/tests/fixtures/relations-labels/`, committed
 * alongside this file.
 *
 * This same file also carries the labels comparison the plan's last
 * stage names: `captureRun` reads each golden pair back BEFORE
 * overwriting it with this run's own capture, so once the port and its
 * `labels` adapter are wired in — as they now are — every case diffs
 * today's stdout and `gh` call log against the bytes committed here
 * from the pre-port baseline, byte for byte, instead of against bytes
 * this same call just wrote. That diff is the hard rule itself: "with
 * `board.relationships` unset, every command prints byte-identical
 * output" (and sends the same `gh` calls) as before this plan. Every
 * case also asserts on the capture directly, so a fixture that stopped
 * exercising what it claims to — the epic's checklist, the blocked
 * issue's two local blockers and its foreign token — fails loudly here
 * rather than baking a hollow capture into the golden files.
 *
 * ## The fixture board
 *
 * One `type:roadmap` issue (`ROADMAP`, #1), whose checklist names two
 * lines, in order:
 *
 *  - `#100`, `epic:relations-labels`, `horizon:now`: a checklist of its
 *    own naming `#101` (closed, already done) then `#102` (open,
 *    `spec:ready`) — so the epic reads `in-progress`, `--full` prints
 *    both members under its row, and `rafa next --dry-run` and `rafa
 *    plan create --next --dry-run` descend into it and stop on `#102`,
 *    the first undone line, never reaching the second roadmap line.
 *  - `#150`, `spec:blocked`, carrying `Blocked by: #151 #152
 *    external-owner/external-repo#999`: `#151` open, `#152` closed, and
 *    a foreign token naming no issue on this board at all. Named on the
 *    roadmap directly rather than on the epic's own checklist, so it
 *    prints in the roadmap's own issue table (`src/commands/roadmap.ts`,
 *    "the lines naming no epic ... as the issue table") without
 *    changing what `next` or `plan create --next` propose.
 *
 * `board.trustedAuthors` names the login every planted issue is
 * authored by, so no collaborator-permission call is needed to trust
 * the roadmap the way `next-roadmap-halt-cli.test.ts` and
 * `switch-next-plan-cli.test.ts` already do it. `main` is pushed to a
 * bare `origin` beside the repository, so the branch scan's remote half
 * never fails and warns onto stdout, which would land inside the
 * captured bytes.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { SPEC_LABEL } from '../board/issue.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { projectConfigText } from '../project/scaffold.js';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { completeSpecBody } from './spec-bodies.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-relations-labels-baseline-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Where every golden capture is written; committed beside this file. */
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/relations-labels/', import.meta.url));

/** How long a case may take: a handful of sequential local `gh` and `git` reads, none of them network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The login every planted issue is authored by, and the one `board.trustedAuthors` names. */
const AUTHOR_LOGIN = 'octocat';

/** The roadmap issue's number. */
const ROADMAP = 1;

/** The home epic, its members, the roadmap-level blocked issue and its two local blockers. */
const EPIC = 100;
const DONE_MEMBER = 101;
const READY_MEMBER = 102;
const BLOCKED_ISSUE = 150;
const OPEN_BLOCKER = 151;
const CLOSED_BLOCKER = 152;

/** A blocker on another repository, named exactly as `Blocked by:` writes one; see `src/board/blocked.ts`. */
const FOREIGN_TOKEN = 'external-owner/external-repo#999';

/** One `gh issue view`/`issue list` row, labels already named. */
function issueRow(
  number: number,
  title: string,
  body: string,
  labels: readonly string[],
  state: 'OPEN' | 'CLOSED' = 'OPEN',
): object {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : '';
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })), author: { login: AUTHOR_LOGIN } };
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * A commit on `main`, pushed to a bare `origin` beside the repository,
 * so the branch scan's remote half never fails and warns onto stdout;
 * see the module note.
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
 * Writes the stand-in `gh` into `scratch`'s `bin/`: one `issue view`
 * answer per fixture issue, the board content for the bare `issue
 * list`, an empty `pr list`, the board cache's own watermark read
 * (`src/board/board-cache.ts`) answered with no timestamp so the cache
 * is read but never written, and the label and title searches
 * `resolveDefaultBoard` would fall back to if `roadmap.issue` were ever
 * not enough, answered empty since it always is. Every call, planned or
 * not, is appended to `logPath` first, so a refused call still shows in
 * the golden log; anything left unplanned still fails loudly, naming
 * the call, on stderr.
 */
function writeGhStub(scratch: ScratchRepo, board: readonly object[], views: readonly object[], logPath: string): void {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  const boardFile = join(data, 'board.json');
  writeFileSync(boardFile, JSON.stringify(board), 'utf8');
  for (const issue of views) {
    const { number } = issue as { readonly number: number };
    writeFileSync(join(data, `view-${String(number)}.json`), JSON.stringify(issue), 'utf8');
  }
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `printf '%s\\n' "gh $*" >> '${logPath}'`,
    'case "$*" in *"--label type:roadmap"*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$*" in *"--label spec:blocked"*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$*" in *"--search "*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$*" in *"issues?state=all&sort=updated"*) printf \'%s\' \'\'; exit 0;; esac',
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
    `  "issue list") ${printFile(boardFile)};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** The project config every capture shares: `gh`, `main` as base, `octocat` trusted, the roadmap named. */
function configText(): string {
  return `${projectConfigText()}pr:\n  provider: gh\n  base: main\nroadmap:\n  issue: ${String(ROADMAP)}\n`
    + `board:\n  trustedAuthors:\n    - ${AUTHOR_LOGIN}\n`;
}

/** The fixture board's issues, less the roadmap issue itself, which a separate `issue view` answers. */
const EPIC_BODY = `- [ ] #${String(DONE_MEMBER)}\n- [ ] #${String(READY_MEMBER)}\n`;
const BLOCKED_BODY = `Blocked by: #${String(OPEN_BLOCKER)} #${String(CLOSED_BLOCKER)} ${FOREIGN_TOKEN}\n`;
const ROADMAP_BODY = `- [ ] #${String(EPIC)}\n- [ ] #${String(BLOCKED_ISSUE)}\n`;

const BOARD = [
  issueRow(EPIC, 'Relations epic', EPIC_BODY, ['type:epic', 'epic:relations-labels', 'horizon:now']),
  issueRow(DONE_MEMBER, 'Epic member, already done', '', ['epic:relations-labels'], 'CLOSED'),
  issueRow(READY_MEMBER, 'Epic member, ready', completeSpecBody('Epic member, ready'), ['epic:relations-labels', SPEC_LABEL, SPEC_READY_LABEL]),
  issueRow(BLOCKED_ISSUE, 'Blocked on two locals and a foreign token', BLOCKED_BODY, [SPEC_BLOCKED_LABEL]),
  issueRow(OPEN_BLOCKER, 'Open blocker', '', []),
  issueRow(CLOSED_BLOCKER, 'Closed blocker', '', [], 'CLOSED'),
];

const ROADMAP_VIEW = issueRow(ROADMAP, 'Roadmap', ROADMAP_BODY, ['type:roadmap']);

/** One golden capture: what a command printed, and the `gh` calls it made, both written under {@link FIXTURES_DIR}. */
interface Capture {
  readonly stdout: string;
  readonly ghCalls: readonly string[];
  /** The bytes {@link FIXTURES_DIR} held for this name before this run's capture overwrote them. */
  readonly golden: {
    readonly stdout: string | undefined;
    readonly ghCalls: string | undefined;
  };
}

/** Reads `path`, or answers `undefined` when it does not exist yet. */
function readIfExists(path: string): string | undefined {
  return existsSync(path)
    ? readFileSync(path, 'utf8')
    : undefined;
}

/**
 * Runs `words` in `scratch`, over a `gh` call log reset first so the
 * capture holds only this run's own calls. Reads the golden files
 * {@link FIXTURES_DIR} already held for `name` BEFORE writing this run's
 * own capture over them, so the labels comparison below diffs this
 * run's bytes against the committed baseline rather than against bytes
 * this same call just wrote — a case that only read back its own
 * write would pass no matter what the command printed. Then refreshes
 * both `name.stdout.txt` and `name.gh-calls.txt` with this run's own
 * capture, and answers both, so a case can assert on either.
 */
function captureRun(scratch: ScratchRepo, logPath: string, words: readonly string[], name: string): Capture {
  rmSync(logPath, { force: true });
  const run = runRafa(scratch, scratch.repo, words);
  expectExit(run, 0, scratch);
  const ghCalls = existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split('\n')
      .filter((line) => line !== '')
    : [];
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const stdoutPath = join(FIXTURES_DIR, `${name}.stdout.txt`);
  const ghCallsPath = join(FIXTURES_DIR, `${name}.gh-calls.txt`);
  const golden = { stdout: readIfExists(stdoutPath), ghCalls: readIfExists(ghCallsPath) };
  writeFileSync(stdoutPath, run.stdout, 'utf8');
  writeFileSync(ghCallsPath, `${ghCalls.join('\n')}\n`, 'utf8');
  return { stdout: run.stdout, ghCalls, golden };
}

describe('golden captures of the labels-mode board, before board.relationships exists', () => {
  let scratch: ScratchRepo;
  let logPath: string;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, configText());
    gitSetup(scratch);
    logPath = join(dirname(scratch.repo), 'gh-calls.log');
    writeGhStub(scratch, BOARD, [ROADMAP_VIEW, ...BOARD], logPath);
  });

  it('rafa roadmap: the epic row alone, plus one line naming the blocked issue leaves the epic table', RUN_TIMEOUT, () => {
    const capture = captureRun(scratch, logPath, ['roadmap'], 'roadmap');

    expect(capture.stdout).toContain(`#${String(EPIC)}`);
    expect(capture.stdout).toContain('in-progress');
    expect(capture.stdout).toContain(`#${String(BLOCKED_ISSUE)}`);
    // Neither member, nor the blockers' own detail, is named without --full: the epic table alone.
    expect(capture.stdout).not.toContain(`#${String(DONE_MEMBER)}`);
    expect(capture.stdout).not.toContain(`#${String(READY_MEMBER)}`);
    expect(capture.stdout).not.toContain(FOREIGN_TOKEN);

    expect(capture.ghCalls.some((call) => call.includes('issue view'))).toBe(true);
    expect(capture.stdout).toBe(capture.golden.stdout);
    expect(`${capture.ghCalls.join('\n')}\n`).toBe(capture.golden.ghCalls);
  });

  it('rafa roadmap --full: both epic members, and the blocked issue\'s two local blockers and its foreign token', RUN_TIMEOUT, () => {
    const capture = captureRun(scratch, logPath, ['roadmap', '--full'], 'roadmap-full');

    expect(capture.stdout).toContain('Epic member, already done');
    expect(capture.stdout).toContain('Epic member, ready');
    expect(capture.stdout).toContain(`#${String(BLOCKED_ISSUE)}`);
    expect(capture.stdout).toContain(`#${String(OPEN_BLOCKER)}`);
    expect(capture.stdout).toContain(`#${String(CLOSED_BLOCKER)}`);
    expect(capture.stdout).toContain(FOREIGN_TOKEN);
    expect(capture.stdout).toContain('still open');
    expect(capture.stdout).toContain('closed');
    expect(capture.stdout).toContain('state unknown');

    const doneMember = capture.stdout.indexOf('Epic member, already done');
    const readyMember = capture.stdout.indexOf('Epic member, ready');
    expect(doneMember).toBeGreaterThan(-1);
    expect(readyMember).toBeGreaterThan(doneMember);

    expect(capture.stdout).toBe(capture.golden.stdout);
    expect(`${capture.ghCalls.join('\n')}\n`).toBe(capture.golden.ghCalls);
  });

  it('rafa next --dry-run: descends into the epic and proposes its ready member, never the roadmap\'s second line', RUN_TIMEOUT, () => {
    const capture = captureRun(scratch, logPath, ['next', '--dry-run'], 'next-dry-run');

    expect(capture.stdout).toContain(`#${String(READY_MEMBER)} is next on the roadmap and carries \`${SPEC_READY_LABEL}\``);
    expect(capture.stdout).not.toContain(`#${String(BLOCKED_ISSUE)}`);
    expect(capture.stdout).not.toContain(`#${String(DONE_MEMBER)}`);

    expect(capture.stdout).toBe(capture.golden.stdout);
    expect(`${capture.ghCalls.join('\n')}\n`).toBe(capture.golden.ghCalls);
  });

  it('rafa plan create --next --dry-run: the same epic member, reading and writing nothing', RUN_TIMEOUT, () => {
    const capture = captureRun(scratch, logPath, ['plan', 'create', '--next', '--dry-run', '--no-progress'], 'plan-create-next-dry-run');

    expect(capture.stdout).toContain(`#${String(READY_MEMBER)}`);
    expect(capture.stdout).not.toContain(`#${String(BLOCKED_ISSUE)}`);
    expect(existsSync(join(scratch.repo, '.rafa', 'plans'))).toBe(false);

    expect(capture.stdout).toBe(capture.golden.stdout);
    expect(`${capture.ghCalls.join('\n')}\n`).toBe(capture.golden.ghCalls);
  });
});
