/**
 * The owner gate (`./owner-approval.ts`) exercised over a real scratch
 * repository — a CODEOWNERS file actually read off disk
 * (`readBoardOwnership`, `src/board/board-owns.ts`), and every reading
 * the gate takes (`changedFiles`, `reviews`, the owner resolution and the
 * team membership lookup) sent to a stand-in `gh`
 * (`createGhRunner`, `src/adapters/tracker/github.ts`) rather than to a
 * literal double, the way `owner-approval.test.ts` drives it.
 *
 * Five boards share one CODEOWNERS file: home (`#10`, `/home/`) and four
 * gated boards, each naming the path this file's four cases each read
 * one pull request against:
 *
 *  - `#20`, `/unresolved/`, owned by `@org/ghost` — a team `gh api`
 *    answers 404: `unresolved`.
 *  - `#30`, `/unknown/`, owned by `@org/flaky` — the owner resolves, but
 *    `gh pr view --json reviews` fails: `unknown`.
 *  - `#40`, `/waiting/`, owned by `@alice` — her only review is
 *    comment-only: `waiting`.
 *  - `#50`, `/approved/`, owned by `@org/web` — bob's `APPROVED` review,
 *    and an active `gh api …/memberships/bob`: `approved`.
 */
import type { OwnerApprovalRequest, OwnerApprovalSeams } from './owner-approval.js';
import type { OwnedBoard } from '../board/board-owns.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhRunner } from '../adapters/tracker/github.js';
import { readBoardOwnership } from '../board/board-owns.js';
import { createOwnerResolver } from '../board/owner-resolve.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';
import { hostToolDirs } from '../tests/stand-in-gh.js';

import { createGhPullRequests } from './gh.js';
import { createGhTeamMembership, readOwnerApproval } from './owner-approval.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-owner-approval-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one case may take: a couple of local `gh` reads, no network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** Home: owns `/home/`, names nobody else's paths. */
const HOME = 10;

/** The five boards this file's CODEOWNERS file names, home first. */
const BOARDS: readonly OwnedBoard[] = [
  { number: HOME, owner: '@org/home', owns: [] },
  { number: 20, owner: '@org/ghost', owns: [] },
  { number: 30, owner: '@org/flaky', owns: [] },
  { number: 40, owner: '@alice', owns: [] },
  { number: 50, owner: '@org/web', owns: [] },
];

/** The CODEOWNERS file every case reads, one folder per board above. */
const CODEOWNERS_TEXT = [
  '/home/       @org/home',
  '/unresolved/ @org/ghost',
  '/unknown/    @org/flaky',
  '/waiting/    @alice',
  '/approved/   @org/web',
].join('\n');

/** A review at `at` o'clock on 2026-09-28, `gh`'s own review shape. */
function reviewOf(login: string, state: string, at: number): object {
  return { author: { login }, state, submittedAt: `2026-09-28T${String(at).padStart(2, '0')}:00:00Z` };
}

/** `gh pr view <n> --json changedFiles,files` answering the one path `path`. */
function filesOf(path: string): object {
  return { changedFiles: 1, files: [{ path }] };
}

/** A scratch repository, its own `bin/`, and the PATH a spawned `gh` reads with. */
interface ScratchWorld {
  readonly repo: string;
  readonly path: string;
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/** The JSON answers every successful call this file's cases send needs, by route text. */
const SUCCESSES: Record<string, object> = {
  'pr view 21 --json changedFiles,files': filesOf('unresolved/a.ts'),
  'pr view 22 --json changedFiles,files': filesOf('unknown/a.ts'),
  'api orgs/org/teams/flaky': {},
  'pr view 23 --json changedFiles,files': filesOf('waiting/a.ts'),
  'api users/alice': {},
  'pr view 23 --json reviews': { reviews: [reviewOf('alice', 'COMMENTED', 9)] },
  'pr view 24 --json changedFiles,files': filesOf('approved/a.ts'),
  'api orgs/org/teams/web': {},
  'pr view 24 --json reviews': { reviews: [reviewOf('bob', 'APPROVED', 9)] },
  'api orgs/org/teams/web/memberships/bob': { state: 'active' },
};

/**
 * Plants a scratch repository with `.github/CODEOWNERS` on disk and a
 * stand-in `gh` answering the four pull requests, the owner lookups and
 * the one team membership lookup this file's cases send: every route in
 * {@link SUCCESSES} exits 0 with its JSON, `api orgs/org/teams/ghost`
 * (pull request #21's owner) exits 1 with a 404, `pr view 22 --json
 * reviews` (pull request #22's own review read) exits 1 with an outage,
 * and anything unplanned fails loudly, naming the call.
 */
function plantWorld(): ScratchWorld {
  const root = realpathSync(mkdtempSync(join(tempBase, 'world-')));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const data = join(root, 'data');
  mkdirSync(join(repo, '.github'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(repo, '.github', 'CODEOWNERS'), `${CODEOWNERS_TEXT}\n`, 'utf8');

  const lines = Object.entries(SUCCESSES).map(([call, answer], index) => {
    const file = join(data, `${String(index)}.json`);
    writeFileSync(file, JSON.stringify(answer), 'utf8');
    return `  "${call}") ${printFile(file)};;`;
  });

  const gh = join(bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'call="$*"',
    'case "$call" in',
    ...lines,
    '  "api orgs/org/teams/ghost") echo "gh: Not Found (HTTP 404)" >&2; exit 1;;',
    '  "pr view 22 --json reviews") echo "gh: unexpected end of JSON input" >&2; exit 1;;',
    '  *) echo "unplanned gh call: $call" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);

  return { repo, path: [bin, ...hostToolDirs()].join(':') };
}

/** The gate's seams over one spawned `gh`, every reading real. */
function seamsOf(world: ScratchWorld): OwnerApprovalSeams {
  const gh = createGhRunner({ cwd: world.repo, env: { TMPDIR: tmpdir(), PATH: world.path, ...scratchHomeEnv(world.repo) } });
  return {
    pullRequests: createGhPullRequests({ gh }),
    resolveOwner: createOwnerResolver({ gh }),
    membership: createGhTeamMembership({ gh }),
  };
}

/** A request for `pullRequest` against home, under the CODEOWNERS file read off `world.repo`. */
function requestFor(world: ScratchWorld, pullRequest: number): OwnerApprovalRequest {
  const ownership = readBoardOwnership(world.repo, BOARDS);
  return { pullRequest, home: HOME, boards: BOARDS, codeowners: ownership.codeowners };
}

describe('readOwnerApproval, unresolved, over a real 404 from gh api', () => {
  it('answers unresolved for #21, whose owner @org/ghost is a team gh knows nothing of', RUN_TIMEOUT, async () => {
    const world = plantWorld();

    const approval = await readOwnerApproval(requestFor(world, 21), seamsOf(world));

    expect(approval.state).toBe('unresolved');
    if (approval.state === 'unresolved') {
      expect(approval.reason).toContain('@org/ghost');
      expect(approval.reason).toContain('does not resolve');
    }
  });
});

describe('readOwnerApproval, unknown, over a real failed review read', () => {
  it('answers unknown for #22, whose owner @org/flaky resolves but whose reviews cannot be read', RUN_TIMEOUT, async () => {
    const world = plantWorld();

    const approval = await readOwnerApproval(requestFor(world, 22), seamsOf(world));

    expect(approval.state).toBe('unknown');
    if (approval.state === 'unknown') {
      expect(approval.reason).toContain('could not read the reviews of #22');
    }
  });
});

describe('readOwnerApproval, waiting, over a real comment-only review', () => {
  it('answers waiting for #23, whose owner @alice only commented', RUN_TIMEOUT, async () => {
    const world = plantWorld();

    const approval = await readOwnerApproval(requestFor(world, 23), seamsOf(world));

    expect(approval.state).toBe('waiting');
    if (approval.state === 'waiting') {
      expect(approval.reason).toBe('owner @alice of board #40 has not approved #23');
    }
  });
});

describe('readOwnerApproval, approved, over a real active team membership', () => {
  it('answers approved for #24, whose approver bob is an active member of @org/web', RUN_TIMEOUT, async () => {
    const world = plantWorld();

    const approval = await readOwnerApproval(requestFor(world, 24), seamsOf(world));

    expect(approval).toEqual({ state: 'approved', owners: [{ handle: '@org/web', boards: [50], approvedBy: 'bob' }] });
  });
});
