/**
 * The blocker locator (`src/board/blocker-epic.ts`) and the one-hop
 * decision (`./hop-chain.ts`) exercised over a real board listing and a
 * real open-pull-request list, both read through a stand-in `gh`
 * (`createGhRunner`, `src/adapters/tracker/github.ts`) rather than a
 * literal `BoardView` handed in, the way `hop-chain.test.ts` drives them.
 *
 * The fixture holds two boards: `#10` (home), whose checklist lists epic
 * `#20` (`home`), and `#11`, whose checklist lists epic `#40` (`far`).
 * Every blocker this file reads sits in `far`, so locating it is a real
 * cross-board read, not a same-board shortcut.
 *
 *  - `#101` carries no `Blocked by:` line: {@link locateBlockerEpic}
 *    places it in epic `#40` on board `#11`, across boards from home.
 *  - `#102` carries `Blocked by: #103` (`#103` open, unrelated to any
 *    epic): {@link decideHop} halts with the chain `#900 ← #102 ← #103`.
 *  - `#104` carries `Blocked by: #900`, H's own number: {@link decideHop}
 *    halts on the mutual block, the chain `#900 ← #104 ← #900`.
 *  - `#106` carries no `Blocked by:` line, but an open pull request
 *    (`#55`) closes it: {@link decideHop} waits, read off a real
 *    `gh pr list --state open` call.
 */
import type { TakenReadings } from './hop-chain.js';
import type { BoardView } from '../board/epic-board.js';
import type { SpecIssueReader } from '../board/issue.js';
import type { Place } from '../project/position.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhRunner } from '../adapters/tracker/github.js';
import { locateBlockerEpic } from '../board/blocker-epic.js';
import { createGhBoardListing } from '../board/roadmap-board.js';
import { createGhOpenPullRequests, createRoadmapReadings } from '../board/roadmap.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { decideHop } from './hop-chain.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hop-chain-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one case may take: a couple of local `gh` reads, no network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** Home: board #10, epic #20. */
const HOME: Place = { board: 10, epic: 20 };

/** Where `#40 far` sits, across boards from home. */
const FAR: Place = { board: 11, epic: 40 };

/** H: the issue every `decideHop` case here blocks, not itself on the listing. */
const BLOCKED = 900;

/** One issue row as `gh issue list` answers it. */
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
  };
}

/** Every issue the fixture's board listing answers. */
const ALL_ISSUES = [
  issueRow(10, '- [ ] #20\n', ['type:roadmap']),
  issueRow(11, '- [ ] #40\n', ['type:roadmap']),
  issueRow(20, '', ['type:epic', 'epic:home', 'horizon:now']),
  issueRow(40, '', ['type:epic', 'epic:far', 'horizon:now']),
  issueRow(101, '', ['epic:far']),
  issueRow(102, 'Blocked by: #103\n', ['epic:far', 'spec:blocked']),
  issueRow(103, '', []),
  issueRow(104, `Blocked by: #${String(BLOCKED)}\n`, ['epic:far', 'spec:blocked']),
  issueRow(106, '', ['epic:far']),
];

/** The one open pull request the fixture serves, closing `#106`. */
const OPEN_PULL_REQUESTS = [{ number: 55, headRefName: 'feat/rafa-106-x', body: 'Closes #106' }];

/** A scratch repository, its own `bin/`, and where a spawned `gh` reads from. */
interface ScratchWorld {
  readonly repo: string;
  readonly bin: string;
  readonly path: string;
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * Plants the stand-in `gh`: the board listing `createGhBoardListing`
 * sends, and the open pull request list `createGhOpenPullRequests`
 * sends. Anything unplanned fails loudly, naming the call.
 */
function plantWorld(): ScratchWorld {
  const root = realpathSync(mkdtempSync(join(tempBase, 'world-')));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const data = join(root, 'data');
  for (const dir of [repo, bin, data]) mkdirSync(dir, { recursive: true });

  writeFileSync(join(data, 'issues.json'), JSON.stringify(ALL_ISSUES), 'utf8');
  writeFileSync(join(data, 'pulls.json'), JSON.stringify(OPEN_PULL_REQUESTS), 'utf8');

  const gh = join(bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'case "$1 $2" in',
    '  "issue list")',
    '    case "$*" in',
    `      *"--state all"*) ${printFile(join(data, 'issues.json'))};;`,
    '      *) echo "unplanned issue list: $*" >&2; exit 1;;',
    '    esac',
    '    ;;',
    '  "pr list")',
    '    case "$*" in',
    `      *"--state open"*) ${printFile(join(data, 'pulls.json'))};;`,
    '      *) echo "unplanned pr list: $*" >&2; exit 1;;',
    '    esac',
    '    ;;',
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  return { repo, bin, path: [bin, dirname(gitBinary)].join(':') };
}

/** A `SpecIssueReader` no case here ever calls: `decideHop`'s taken readings read state off the listing, not this reader. */
const UNUSED_ISSUES: SpecIssueReader = () => Promise.reject(new Error('the taken readings this suite drives never read an issue by id'));

/** A `BoardView` over the fixture's real board listing, read once through `gh`. */
async function boardView(gh: ReturnType<typeof createGhRunner>): Promise<BoardView> {
  const listing = await createGhBoardListing({ gh })();
  return {
    listing,
    rows: new Map(listing.map((issue) => [issue.number, issue])),
    defaultBoard: () => Promise.resolve(HOME.board),
  };
}

describe('locateBlockerEpic, over a real board listing spanning two boards', () => {
  it('places #101 in epic #40 on board #11, across boards from home', RUN_TIMEOUT, async () => {
    const world = plantWorld();
    const gh = createGhRunner({ cwd: world.repo, env: { PATH: world.path, ...scratchHomeEnv(world.repo) } });
    const view = await boardView(gh);

    const located = await locateBlockerEpic({ blocker: 101, home: HOME, view });

    expect(located).toEqual({ kind: 'located', blocker: 101, epic: FAR.epic, slug: 'far', board: FAR.board });
  });
});

describe('decideHop, halt, over a real board listing', () => {
  it('halts with the chain when C (#102) has an open blocker B (#103)', RUN_TIMEOUT, async () => {
    const world = plantWorld();
    const gh = createGhRunner({ cwd: world.repo, env: { PATH: world.path, ...scratchHomeEnv(world.repo) } });
    const view = await boardView(gh);
    const taken: TakenReadings = { branchFor: () => null, pullRequestFor: () => Promise.resolve(null) };

    const decision = await decideHop({ blocked: BLOCKED, blocker: 102, position: { current: HOME, home: HOME }, view, taken });

    expect(decision).toEqual({
      kind: 'halt',
      reason: 'blocked-blocker',
      chain: { blocked: BLOCKED, blocker: 102, next: [103], mutual: false },
      from: HOME,
      to: FAR,
      fault: null,
    });
  });

  it('halts on the mutual block when C (#104) is blocked by H itself', RUN_TIMEOUT, async () => {
    const world = plantWorld();
    const gh = createGhRunner({ cwd: world.repo, env: { PATH: world.path, ...scratchHomeEnv(world.repo) } });
    const view = await boardView(gh);
    const taken: TakenReadings = { branchFor: () => null, pullRequestFor: () => Promise.resolve(null) };

    const decision = await decideHop({ blocked: BLOCKED, blocker: 104, position: { current: HOME, home: HOME }, view, taken });

    expect(decision).toEqual({
      kind: 'halt',
      reason: 'blocked-blocker',
      chain: { blocked: BLOCKED, blocker: 104, next: [BLOCKED], mutual: true },
      from: HOME,
      to: FAR,
      fault: null,
    });
  });
});

describe('decideHop, wait, over a real open pull request list', () => {
  it('waits when an open pull request (#55) closes C (#106)', RUN_TIMEOUT, async () => {
    const world = plantWorld();
    const gh = createGhRunner({ cwd: world.repo, env: { PATH: world.path, ...scratchHomeEnv(world.repo) } });
    const view = await boardView(gh);
    const readings = createRoadmapReadings({
      issues: UNUSED_ISSUES,
      branches: { refs: [], problems: [] },
      pullRequests: createGhOpenPullRequests({ gh }),
    });
    const taken: TakenReadings = { branchFor: () => null, pullRequestFor: readings.pullRequestFor };

    const decision = await decideHop({ blocked: BLOCKED, blocker: 106, position: { current: HOME, home: HOME }, view, taken });

    expect(decision).toEqual({
      kind: 'wait',
      blocked: BLOCKED,
      blocker: 106,
      epic: FAR.epic,
      board: FAR.board,
      taken: { by: 'pull-request', pullRequest: 55 },
    });
  });
});
