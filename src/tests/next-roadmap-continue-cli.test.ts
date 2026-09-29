/**
 * Three spawned `bun src/rafa.ts` proofs of `rafa next --roadmap` reading
 * PAST one turn's hop or home step, over fixtures built the way
 * `next-roadmap-hop-cli.test.ts` and `next-roadmap-loop-cli.test.ts`
 * build their own: a stand-in `gh`, a real git repository pushed to a
 * bare `origin`, and (where a case needs one already under way) the
 * position file and the hop record planted directly through their own
 * modules, exactly as `sources-hop.test.ts` plants them for
 * `ghNextBoard`.
 *
 * Each case is its own `describe`, over its own scratch repository, so
 * none of the three shares a fixture, a position file or a hop record
 * with another:
 *
 *  - **passes over H once C's pull request is open.** The hop record is
 *    planted `away`, C's pull request already open. The first turn reads
 *    `away-ended`, runs `home` (`--yes=home`) and comes back to the home
 *    epic; the SAME turn's own board walk, unchanged by this plan, then
 *    reads C as taken and passes H over, so the chain's next turn stops
 *    on the epic's own second line rather than on H again.
 *  - **a dry epic hops to the next `now` epic on the board.** The home
 *    epic's one line is already closed, so the walk answers no line; the
 *    hop-dry row (`--yes=hop`) hops to the next `now` epic on the SAME
 *    board, and the chain's next turn stops on that epic's own line.
 *  - **a `rafa switch` typed during a hop drops the record.** A hop away
 *    is opened first, then the real `rafa switch` command is run BY
 *    HAND to a third epic the hop never went to, re-homing there. The
 *    hop record's home no longer matches the position's, so the very
 *    next `rafa next --roadmap` reads it as stale and follows the new
 *    position instead — never C, never the record's own home — and
 *    leaves the record on disk untouched, exactly as `runHome`
 *    (`src/next/hop-action.ts`) leaves a stale record rather than
 *    closing it.
 *
 * `--output=json` and `eventsOf` (`cli-capture.ts`) are used throughout
 * rather than a byte-exact stdout comparison: each case runs more than
 * one turn, and what is being proved is which issue the chain lands on
 * and what the two files hold, not the exact wording of every turn's two
 * lines, which `next-roadmap-hop-cli.test.ts` already pins.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { HopRecord } from '../next/hop-record.js';
import type { CliEvent } from '../ports/index.js';
import type { Position } from '../project/position.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { readHopRecord, writeHopRecord } from '../next/hop-record.js';
import { positionFilePath, writePositionFile } from '../project/position.js';
import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig, plantScratchRepo, eventsOf, runRafa } from './cli-capture.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-roadmap-continue-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a case may take: a handful of sequential local `gh` and `git` reads, none of them network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The login every planted issue is authored by, and the one `board.trustedAuthors` names. */
const AUTHOR_LOGIN = 'octocat';

/** One `gh issue view`/`issue list` row, labels already named. */
function issueRow(number: number, body: string, labels: readonly string[], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  return {
    number,
    title: `Issue ${String(number)}`,
    body,
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : '',
    labels: labels.map((name) => ({ name })),
    author: { login: AUTHOR_LOGIN },
  };
}

/** A board issue's checklist, one unticked line per item. */
function checklist(items: readonly number[]): string {
  return items.map((item) => `- [ ] #${String(item)}\n`).join('');
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/** An open pull request as the stand-in `gh pr list` answers it: enough fields for `pullRequestFor` to read it. */
function pullRow(number: number, closes: number): object {
  return {
    number,
    headRefName: `pull-${String(number)}`,
    baseRefName: 'main',
    body: `Closes #${String(closes)}`,
    title: `the pull request that closes #${String(closes)}`,
    url: `https://example.invalid/pull/${String(number)}`,
    state: 'OPEN',
    author: { login: AUTHOR_LOGIN, isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/**
 * A commit on `main`, pushed to a bare `origin` beside the repository, so
 * the branch scan's remote half never fails and warns onto stdout, which
 * would break a byte-for-byte comparison; see `next-roadmap-hop-cli.test.ts`.
 */
function gitSetup(scratch: ScratchRepo): void {
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
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
 * Writes the stand-in `gh` into `scratch`'s `bin/`: the `type:roadmap`
 * listing, one `issue view` answer per fixture issue, the whole listing
 * for `issue list --state all`, `pr list` served off `pulls`, and
 * `--head ...` always empty, since nothing any of these three fixtures
 * plants is ever open on the branch the checkout stays on (`main`).
 * Anything else unplanned fails loudly, naming the call.
 */
function writeGhStub(scratch: ScratchRepo, issues: readonly object[], pulls: readonly object[]): void {
  const labelled = issues.filter((issue) => (issue as { readonly labels: readonly { readonly name: string }[] }).labels
    .some((label) => label.name === 'type:roadmap'));
  const data = join(dirname(scratch.repo), 'data');
  const labelledFile = join(data, 'labelled.json');
  const allFile = join(data, 'all.json');
  const pullsFile = join(data, 'pulls.json');
  mkdirSync(data, { recursive: true });
  writeFileSync(labelledFile, JSON.stringify(labelled), 'utf8');
  writeFileSync(allFile, JSON.stringify(issues), 'utf8');
  writeFileSync(pullsFile, JSON.stringify(pulls), 'utf8');
  for (const issue of issues) {
    const { number } = issue as { readonly number: number };
    writeFileSync(join(data, `view-${String(number)}.json`), JSON.stringify(issue), 'utf8');
  }
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `case "$*" in *"--label type:roadmap"*) ${printFile(labelledFile)}; exit 0;; esac`,
    'case "$*" in *"--label spec:blocked"*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$*" in *"--head "*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$1 $2" in',
    '  "issue view")',
    `    f='${data}'"/view-$3.json"`,
    '    if [ -f "$f" ]; then',
    '      while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$f"',
    '    else',
    '      echo "unplanned issue view: $3" >&2; exit 1',
    '    fi',
    '    ;;',
    `  "pr list") ${printFile(pullsFile)};;`,
    `  "issue list") ${printFile(allFile)};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** Plants a scratch repository, its config, its git history and its `gh` stand-in, ready for the case to plant its own position and hop files. */
function plantFixture(issues: readonly object[], pulls: readonly object[] = []): ScratchRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n  base: main\nboard:\n  trustedAuthors:\n    - ${AUTHOR_LOGIN}\n`);
  gitSetup(scratch);
  writeGhStub(scratch, issues, pulls);
  return scratch;
}

/** Runs `rafa` with `words` and `--output=json`, answering its parsed events. Fails loudly on a non-zero exit. */
function run(scratch: ScratchRepo, words: readonly string[]): readonly CliEvent[] {
  const captured = runRafa(scratch, scratch.repo, [...words, '--output=json'], { GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' });
  if (captured.exitCode !== 0) {
    throw new Error(`rafa ${words.join(' ')} exited ${String(captured.exitCode)}\nstdout:\n${captured.stdout}\nstderr:\n${captured.stderr}`);
  }
  return eventsOf(captured.stdout);
}

/** Every `log` message of `events`, joined with newlines, for a substring check. */
function joinedLog(events: readonly CliEvent[]): string {
  return events
    .filter((event) => event.type === 'log')
    .map((event) => (event as { message: string }).message)
    .join('\n');
}

/** The `result` event's `data`, or throws when there is none. */
function resultData(events: readonly CliEvent[]): Record<string, unknown> {
  const found = events.find((event) => event.type === 'result') as { data?: Record<string, unknown> } | undefined;
  if (found?.data === undefined) throw new Error('the run printed no result event');
  return found.data;
}

describe('rafa next --roadmap passes over H once C\'s pull request is open, spawned', () => {
  /** Board Alpha (#10), epic Alpha (#100): H (#103), then N (#104). */
  const BOARD_A = 10;
  const EPIC_A = 100;
  const H = 103;
  const N = 104;

  /** Board Beta (#20), epic Beta (#200): C (#203), already ready and open. */
  const BOARD_B = 20;
  const EPIC_B = 200;
  const C = 203;

  /** The pull request already open, closing C, before the first turn runs. */
  const PR_NUMBER = 555;

  const ISSUES = [
    issueRow(BOARD_A, checklist([EPIC_A]), ['type:roadmap']),
    issueRow(EPIC_A, checklist([H, N]), ['type:epic', 'epic:alpha', 'horizon:now']),
    issueRow(H, `Blocked by: #${String(C)}\n`, [SPEC_BLOCKED_LABEL]),
    issueRow(N, '', ['epic:alpha', SPEC_READY_LABEL]),
    issueRow(BOARD_B, checklist([EPIC_B]), ['type:roadmap']),
    issueRow(EPIC_B, checklist([C]), ['type:epic', 'epic:beta', 'horizon:now']),
    issueRow(C, '', ['epic:beta', SPEC_READY_LABEL]),
  ];

  /** The away hop this fixture starts with: current at C's epic, home at Alpha. */
  const HOME_PLACE = { board: BOARD_A, epic: EPIC_A };
  const AWAY_PLACE = { board: BOARD_B, epic: EPIC_B };
  const AWAY_POSITION: Position = { current: AWAY_PLACE, previous: HOME_PLACE, home: HOME_PLACE };
  const AWAY_RECORD: HopRecord = {
    kind: 'blocker',
    home: HOME_PLACE,
    from: HOME_PLACE,
    blocked: H,
    target: C,
    targetEpic: EPIC_B,
    targetBoard: BOARD_B,
    state: 'away',
    pullRequest: null,
    startedAt: '2026-01-01T00:00:00.000Z',
  };

  it('runs home once C\'s pull request is open, then passes H over for N', RUN_TIMEOUT, () => {
    const scratch = plantFixture(ISSUES, [pullRow(PR_NUMBER, C)]);
    writePositionFile(scratch.repo, AWAY_POSITION);
    writeHopRecord(scratch.repo, AWAY_RECORD);

    const events = run(scratch, ['next', '--roadmap', '--yes=home']);
    const joined = joinedLog(events);

    // The first turn comes home, naming C's own pull request, never H.
    expect(joined).toContain(`has pull request #${String(PR_NUMBER)} open`);
    expect(joined).toContain(`back home: epic #${String(EPIC_A)} on board #${String(BOARD_A)}`);
    // The chain's next turn reads C as taken and stops on N, not on H again.
    expect(joined).toContain(`#${String(N)} is next on the roadmap and carries \`${SPEC_READY_LABEL}\``);
    expect(joined).not.toContain(`create the plan for #${String(H)}`);

    const data = resultData(events);
    expect(data.stop).toBe('unasked');
    const hops = data.hops as readonly { readonly action: string; readonly closing?: string; readonly pullRequest?: number | null }[];
    expect(hops).toHaveLength(1);
    expect(hops[0]).toMatchObject({ action: 'home', closing: 'waiting', pullRequest: PR_NUMBER });

    const position = readPositionOf(scratch.repo);
    expect(position.current).toEqual(HOME_PLACE);
    expect(position.home).toEqual(HOME_PLACE);

    const closed = readHopRecord(scratch.repo);
    if (!closed.set) throw new Error(`the hop record did not read: ${closed.detail}`);
    expect(closed.record.state).toBe('waiting');
    expect(closed.record.pullRequest).toBe(PR_NUMBER);
  });
});

describe('a fixture epic whose lines are all done hops to the next `now` epic on the board, spawned', () => {
  /** Board Alpha (#10): epic Alpha (#100, its one line already closed), then epic Gamma (#150). */
  const BOARD_A = 10;
  const EPIC_A = 100;
  const DONE = 103;
  const EPIC_G = 150;
  const G = 160;

  const HOME_PLACE = { board: BOARD_A, epic: EPIC_A };
  const HOME_POSITION: Position = { current: HOME_PLACE, previous: HOME_PLACE, home: HOME_PLACE };

  const ISSUES = [
    issueRow(BOARD_A, checklist([EPIC_A, EPIC_G]), ['type:roadmap']),
    issueRow(EPIC_A, checklist([DONE]), ['type:epic', 'epic:alpha', 'horizon:now']),
    issueRow(DONE, '', ['epic:alpha'], 'CLOSED'),
    issueRow(EPIC_G, checklist([G]), ['type:epic', 'epic:gamma', 'horizon:now']),
    issueRow(G, '', ['epic:gamma', SPEC_READY_LABEL]),
  ];

  it('hops from the dry epic to the next `now` epic on the same board, and stops on its own line', RUN_TIMEOUT, () => {
    const scratch = plantFixture(ISSUES);
    writePositionFile(scratch.repo, HOME_POSITION);

    const events = run(scratch, ['next', '--roadmap', '--yes=hop']);
    const joined = joinedLog(events);

    expect(joined).toContain(`hop from epic #${String(EPIC_A)}: it ran dry, next \`now\` epic #${String(EPIC_G)} on board #${String(BOARD_A)}`);
    expect(joined).toContain(`#${String(G)} is next on the roadmap and carries \`${SPEC_READY_LABEL}\``);
    expect(joined).not.toContain(`#${String(DONE)}`);

    const data = resultData(events);
    expect(data.stop).toBe('unasked');
    const hops = data.hops as readonly { readonly action: string; readonly opening?: { readonly kind: string; readonly targetEpic: number; readonly targetBoard: number } }[];
    expect(hops).toHaveLength(1);
    expect(hops[0]).toMatchObject({ action: 'hop', opening: { kind: 'dry', targetEpic: EPIC_G, targetBoard: BOARD_A } });

    const position = readPositionOf(scratch.repo);
    expect(position.current).toEqual({ board: BOARD_A, epic: EPIC_G });
    expect(position.home).toEqual(HOME_PLACE);

    const record = readHopRecord(scratch.repo);
    if (!record.set) throw new Error(`the hop record did not read: ${record.detail}`);
    expect(record.record).toMatchObject({
      kind: 'dry', home: HOME_PLACE, from: HOME_PLACE, blocked: null, target: null, targetEpic: EPIC_G, targetBoard: BOARD_A, state: 'away',
    });
  });
});

describe('a `rafa switch` typed during a hop drops the record and the loop follows the new position, spawned', () => {
  /** Board Alpha (#10): epic Alpha (#100, home, H blocked by C), then epic Gamma (#150, G ready). */
  const BOARD_A = 10;
  const EPIC_A = 100;
  const H = 103;
  const EPIC_G = 150;
  const G = 160;

  /** Board Beta (#20), epic Beta (#200): C (#203), where the hop goes. */
  const BOARD_B = 20;
  const EPIC_B = 200;
  const C = 203;

  const HOME_PLACE = { board: BOARD_A, epic: EPIC_A };
  const GAMMA_PLACE = { board: BOARD_A, epic: EPIC_G };
  const HOME_POSITION: Position = { current: HOME_PLACE, previous: HOME_PLACE, home: HOME_PLACE };

  const ISSUES = [
    issueRow(BOARD_A, checklist([EPIC_A, EPIC_G]), ['type:roadmap']),
    issueRow(EPIC_A, checklist([H]), ['type:epic', 'epic:alpha', 'horizon:now']),
    issueRow(H, `Blocked by: #${String(C)}\n`, [SPEC_BLOCKED_LABEL]),
    issueRow(EPIC_G, checklist([G]), ['type:epic', 'epic:gamma', 'horizon:now']),
    issueRow(G, '', ['epic:gamma', SPEC_READY_LABEL]),
    issueRow(BOARD_B, checklist([EPIC_B]), ['type:roadmap']),
    issueRow(EPIC_B, checklist([C]), ['type:epic', 'epic:beta', 'horizon:now']),
    issueRow(C, '', ['epic:beta', SPEC_READY_LABEL]),
  ];

  it('drops the stale record and reads the new position\'s own epic, never C', RUN_TIMEOUT, () => {
    const scratch = plantFixture(ISSUES);
    writePositionFile(scratch.repo, HOME_POSITION);

    // Opens the hop away, to C's epic on board Beta, home kept at Alpha.
    run(scratch, ['next', '--roadmap', '--yes=hop']);
    const away = readHopRecord(scratch.repo);
    if (!away.set) throw new Error(`the hop record did not read: ${away.detail}`);
    expect(away.record).toMatchObject({ state: 'away', target: C, home: HOME_PLACE });

    // A person types `rafa switch` by hand, to a THIRD epic the hop never went to, re-homing there.
    const switched = run(scratch, ['switch', String(EPIC_G)]);
    expect(resultData(switched)).toMatchObject({ current: GAMMA_PLACE, home: GAMMA_PLACE });

    // The next `rafa next --roadmap` reads the record as stale off the new home and follows Gamma, never C.
    const events = run(scratch, ['next', '--roadmap', '--dry-run']);
    const joined = joinedLog(events);
    expect(joined).toContain(`#${String(G)} is next on the roadmap and carries \`${SPEC_READY_LABEL}\``);
    expect(joined).not.toContain(`#${String(C)}`);
    expect(joined).not.toContain(`#${String(H)}`);
    expect(joined).not.toContain('hop');
    expect(joined).not.toContain('away');

    // Neither the position nor the hop record moved: --dry-run reads and writes nothing.
    const position = readPositionOf(scratch.repo);
    expect(position.current).toEqual(GAMMA_PLACE);
    expect(position.home).toEqual(GAMMA_PLACE);

    const stillAway = readHopRecord(scratch.repo);
    if (!stillAway.set) throw new Error(`the hop record did not read: ${stillAway.detail}`);
    expect(stillAway.record).toMatchObject({ state: 'away', target: C, home: HOME_PLACE });
  });
});

/** Reads `.rafa/position.json` straight off disk, for an assertion on its `current` and `home` places. */
function readPositionOf(root: string): Position {
  return JSON.parse(readFileSync(positionFilePath(root), 'utf8')) as Position;
}
