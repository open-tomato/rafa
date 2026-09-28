/**
 * Tests for the owner gate reading (`src/pr/owner-approval.ts`): which
 * paths are gated, the five answers, the latest-review rule, and the
 * team membership lookup over `gh`.
 *
 * The gate is driven through {@link createPullRequestsDouble}, a fake
 * owner resolver and a fake membership reader, each recording what it
 * was asked, so no case spawns a process. The membership lookup is
 * driven through a stubbed runner answering the envelopes measured on
 * 2026-09-28 with `gh` 2.100.0 (the module note) and recorded in
 * `./gh-fake-shapes.ts`.
 *
 * ## The controls
 *
 *  - Every `not-gated` case has a twin that changes one fact and is
 *    gated, so a gate answering `not-gated` for everything fails it.
 *  - Every `approved` case has a `waiting` twin differing in one review
 *    or one membership, so a gate approving on any review fails it.
 *  - The 404 membership case has a 403 twin, so a reader treating every
 *    failure as "not a member" fails it.
 *  - Every failed reading is asserted `unknown`, never `approved`, and
 *    the cases that stop early assert the reads they did NOT send.
 */
import type { GatedOwner, OwnerApproval, OwnerApprovalRequest, TeamMembership } from './owner-approval.js';
import type { PullRequestReview } from './types.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { OwnedBoard } from '../board/board-owns.js';
import type { OwnerResolution } from '../board/owner-resolve.js';

import { describe, expect, it } from 'bun:test';

import { parseCodeowners } from '../board/codeowners.js';

import { httpFailure, notFound } from './gh-fake-shapes.js';
import { createGhTeamMembership, readOwnerApproval, teamMembershipArgs } from './owner-approval.js';
import { createPullRequestsDouble } from './pull-requests-double.js';

const MEMBERSHIP_DOCS = 'https://docs.github.com/rest/teams/members#get-team-membership-for-a-user';

/** The pull request every case reads. */
const PULL = 41;

/** Home: board #10, owned by `@org/home`. */
const HOME = 10;

/** Four boards under one CODEOWNERS file; home is #10. */
const BOARDS: readonly OwnedBoard[] = [
  { number: 10, owner: '@org/home', owns: [] },
  { number: 20, owner: '@org/web', owns: [] },
  { number: 25, owner: '@ORG/Web', owns: [] },
  { number: 30, owner: '@alice', owns: [] },
];

/** Who owns which folder. #25 names #20's team in another case, so it owns nothing. */
const CODEOWNERS = parseCodeowners([
  '/src/ @org/home',
  '/web/ @org/web',
  '/docs/ @alice',
].join('\n'));

/** A request for {@link PULL} against home under {@link CODEOWNERS}. */
function request(overrides: Partial<OwnerApprovalRequest> = {}): OwnerApprovalRequest {
  return { pullRequest: PULL, home: HOME, boards: BOARDS, codeowners: CODEOWNERS, ...overrides };
}

/** A review by `login` in `state` at `at` o'clock on 2026-09-28. */
function review(login: string, state: string, at: number): PullRequestReview {
  return { login, state, submittedAt: `2026-09-28T${String(at).padStart(2, '0')}:00:00Z` };
}

/** What a gate case hands the reading, and what it can read back. */
interface GateWorld {
  /** The files the pull request changes, or an error `changedFiles` rejects with. */
  readonly files?: readonly string[] | Error;
  /** The reviews, or an error `reviews` rejects with. */
  readonly reviews?: readonly PullRequestReview[] | Error;
  /** Resolution states by handle; every other handle resolves. */
  readonly resolutions?: Readonly<Record<string, OwnerResolution>>;
  /** Memberships by `team login`; every other pair is not a member. */
  readonly memberships?: Readonly<Record<string, TeamMembership>>;
}

/** Answers `value`, or rejects with it when it is an error. */
function answer<T>(value: T | Error): Promise<T> {
  return value instanceof Error
    ? Promise.reject(value)
    : Promise.resolve(value);
}

/** Runs the gate over `world`, answering the reading and every call it sent. */
async function gate(world: GateWorld, over: OwnerApprovalRequest = request()): Promise<{
  readonly approval: OwnerApproval;
  readonly sent: readonly string[];
  readonly resolved: readonly string[];
  readonly asked: readonly string[];
}> {
  const resolved: string[] = [];
  const asked: string[] = [];
  const double = createPullRequestsDouble({
    changedFiles: () => answer(world.files ?? []),
    reviews: () => answer(world.reviews ?? []),
  });
  const approval = await readOwnerApproval(over, {
    pullRequests: double.pulls,
    resolveOwner: (handle) => {
      resolved.push(handle);
      return Promise.resolve(world.resolutions?.[handle] ?? { handle, state: 'resolved' });
    },
    membership: (team, login) => {
      asked.push(`${team} ${login}`);
      return Promise.resolve(world.memberships?.[`${team} ${login}`] ?? { state: 'not-member' });
    },
  });
  return { approval, sent: double.sent(), resolved, asked };
}

/** The reason of a not-approved answer; throws on any other. */
function reasonOf(approval: OwnerApproval): string {
  if (approval.state === 'not-gated' || approval.state === 'approved') {
    throw new Error(`expected a not-approved answer, got ${approval.state}`);
  }
  return approval.reason;
}

/** The gated owners of an answer; throws on `not-gated`. */
function ownersOf(approval: OwnerApproval): readonly GatedOwner[] {
  if (approval.state === 'not-gated') throw new Error('expected a gated answer, got not-gated');
  return approval.owners.map((owner) => ({ handle: owner.handle, boards: owner.boards }));
}

describe('readOwnerApproval: which paths are gated', () => {
  it('answers not-gated when every changed path is home\'s, reading no review and resolving no one', async () => {
    const { approval, sent, resolved } = await gate({ files: ['src/a.ts', 'src/b/c.ts'] });

    expect(approval).toEqual({ state: 'not-gated' });
    expect(sent).toEqual([`changedFiles ${String(PULL)}`]);
    expect(resolved).toEqual([]);
  });

  it('gates the same pull request once one path is another board\'s (control)', async () => {
    const { approval } = await gate({ files: ['src/a.ts', 'web/page.ts'] });

    expect(approval.state).toBe('waiting');
    expect(ownersOf(approval)).toEqual([{ handle: '@org/web', boards: [20] }]);
  });

  it('answers not-gated for a path owned by a board sharing home\'s owner, compared case folded', async () => {
    const boards: OwnedBoard[] = [
      { number: 10, owner: '@org/home', owns: ['src'] },
      { number: 40, owner: '@ORG/Home', owns: ['shared'] },
    ];

    const { approval } = await gate({ files: ['shared/x.ts'] }, request({ boards, codeowners: null }));

    expect(approval).toEqual({ state: 'not-gated' });
  });

  it('gates that path once the other board names another owner (control)', async () => {
    const boards: OwnedBoard[] = [
      { number: 10, owner: '@org/home', owns: ['src'] },
      { number: 40, owner: '@org/other', owns: ['shared'] },
    ];

    const { approval } = await gate({ files: ['shared/x.ts'] }, request({ boards, codeowners: null }));

    expect(ownersOf(approval)).toEqual([{ handle: '@org/other', boards: [40] }]);
  });

  it('answers not-gated when neither board names an owner', async () => {
    const boards: OwnedBoard[] = [
      { number: 10, owner: null, owns: ['src'] },
      { number: 40, owner: null, owns: ['shared'] },
    ];

    const { approval } = await gate({ files: ['shared/x.ts'] }, request({ boards, codeowners: null }));

    expect(approval).toEqual({ state: 'not-gated' });
  });

  it('answers unresolved when home names an owner and the other board names none (control)', async () => {
    const boards: OwnedBoard[] = [
      { number: 10, owner: '@org/home', owns: ['src'] },
      { number: 40, owner: null, owns: ['shared'] },
    ];

    const { approval, sent } = await gate({ files: ['shared/x.ts'] }, request({ boards, codeowners: null }));

    expect(approval.state).toBe('unresolved');
    expect(reasonOf(approval)).toBe('board #40 names no Owner:, so nobody can approve its paths');
    expect(sent).toEqual([`changedFiles ${String(PULL)}`]);
  });

  it('answers not-gated for a path no board owns, as GitHub asks no review for it', async () => {
    const { approval } = await gate({ files: ['README.md'] });

    expect(approval).toEqual({ state: 'not-gated' });
  });

  it('answers not-gated for a pull request that changes nothing', async () => {
    const { approval } = await gate({ files: [] });

    expect(approval).toEqual({ state: 'not-gated' });
  });

  it('groups two boards naming one handle, case folded, into one owner resolved once', async () => {
    const boards: OwnedBoard[] = [
      { number: 10, owner: '@org/home', owns: ['src'] },
      { number: 25, owner: '@ORG/Web', owns: ['app'] },
      { number: 20, owner: '@org/web', owns: ['web'] },
    ];

    const { approval, resolved } = await gate(
      { files: ['app/b.ts', 'web/a.ts'] },
      request({ boards, codeowners: null }),
    );

    expect(ownersOf(approval)).toEqual([{ handle: '@org/web', boards: [20, 25] }]);
    expect(resolved).toEqual(['@org/web']);
  });

  it('names a CODEOWNERS path by the lowest board naming its handle', async () => {
    const codeowners = parseCodeowners('/web/ @org/web\n/app/ @ORG/Web\n');

    const { approval } = await gate({ files: ['web/a.ts', 'app/b.ts'] }, request({ codeowners }));

    expect(ownersOf(approval)).toEqual([{ handle: '@org/web', boards: [20] }]);
  });
});

describe('readOwnerApproval: a reading that fails is unknown', () => {
  it('answers unknown when the changed files cannot be read, asking nothing else', async () => {
    const { approval, sent, resolved } = await gate({ files: new Error('gh pr view 41 --json changedFiles,files failed: offline') });

    expect(approval.state).toBe('unknown');
    expect(reasonOf(approval)).toBe('could not read the changed files of #41: gh pr view 41 --json changedFiles,files failed: offline');
    expect(ownersOf(approval)).toEqual([]);
    expect(sent).toEqual([`changedFiles ${String(PULL)}`]);
    expect(resolved).toEqual([]);
  });

  it('answers unknown when home is not among the boards and a path is another board\'s', async () => {
    const { approval } = await gate({ files: ['web/a.ts'] }, request({ home: 99 }));

    expect(approval.state).toBe('unknown');
    expect(reasonOf(approval)).toBe('home board #99 is not among the boards read, so its owner is unknown');
  });

  it('answers unknown when an owner cannot be resolved, reading no review', async () => {
    const { approval, sent } = await gate({
      files: ['web/a.ts'],
      resolutions: { '@org/web': { handle: '@org/web', state: 'unknown', reason: 'gh api orgs/org/teams/web failed: HTTP 403' } },
      reviews: [review('bob', 'APPROVED', 9)],
    });

    expect(approval.state).toBe('unknown');
    expect(reasonOf(approval)).toBe('could not resolve owner @org/web of board #20: gh api orgs/org/teams/web failed: HTTP 403');
    expect(sent).toEqual([`changedFiles ${String(PULL)}`]);
  });

  it('answers unknown when the reviews cannot be read', async () => {
    const { approval } = await gate({ files: ['web/a.ts'], reviews: new Error('gh pr view 41 --json reviews failed: offline') });

    expect(approval.state).toBe('unknown');
    expect(reasonOf(approval)).toBe('could not read the reviews of #41: gh pr view 41 --json reviews failed: offline');
    expect(ownersOf(approval)).toEqual([{ handle: '@org/web', boards: [20] }]);
  });

  it('answers unknown when the only approver\'s membership lookup failed', async () => {
    const { approval } = await gate({
      files: ['web/a.ts'],
      reviews: [review('bob', 'APPROVED', 9)],
      memberships: { '@org/web bob': { state: 'unknown', reason: 'gh api … failed: HTTP 403' } },
    });

    expect(approval.state).toBe('unknown');
    expect(reasonOf(approval)).toBe('could not tell whether owner @org/web of board #20 approved #41: gh api … failed: HTTP 403');
  });

  it('answers approved past a failed lookup when another approver is an active member', async () => {
    const { approval, asked } = await gate({
      files: ['web/a.ts'],
      reviews: [review('bob', 'APPROVED', 9), review('carol', 'APPROVED', 10)],
      memberships: {
        '@org/web bob': { state: 'unknown', reason: 'HTTP 403' },
        '@org/web carol': { state: 'active' },
      },
    });

    expect(approval).toEqual({ state: 'approved', owners: [{ handle: '@org/web', boards: [20], approvedBy: 'carol' }] });
    expect(asked).toEqual(['@org/web bob', '@org/web carol']);
  });
});

describe('readOwnerApproval: an owner that does not resolve', () => {
  it('answers unresolved for a handle GitHub knows nothing of, reading no review', async () => {
    const { approval, sent } = await gate({
      files: ['web/a.ts'],
      resolutions: { '@org/web': { handle: '@org/web', state: 'unresolved' } },
    });

    expect(approval.state).toBe('unresolved');
    expect(reasonOf(approval)).toBe('owner @org/web of board #20 does not resolve to an account or team GitHub knows');
    expect(sent).toEqual([`changedFiles ${String(PULL)}`]);
  });

  it('answers unresolved over unknown when two owners fail differently', async () => {
    const { approval } = await gate({
      files: ['web/a.ts', 'docs/b.md'],
      resolutions: {
        '@org/web': { handle: '@org/web', state: 'unknown', reason: 'offline' },
        '@alice': { handle: '@alice', state: 'unresolved' },
      },
    });

    expect(approval.state).toBe('unresolved');
    expect(reasonOf(approval)).toContain('@alice');
  });
});

describe('readOwnerApproval: an @login owner', () => {
  it('answers approved when the login\'s latest review approves, logins compared case folded', async () => {
    const { approval, asked } = await gate({ files: ['docs/b.md'], reviews: [review('Alice', 'APPROVED', 9)] });

    expect(approval).toEqual({ state: 'approved', owners: [{ handle: '@alice', boards: [30], approvedBy: 'Alice' }] });
    expect(asked).toEqual([]);
  });

  it('answers waiting on a comment-only review (control)', async () => {
    const { approval } = await gate({ files: ['docs/b.md'], reviews: [review('alice', 'COMMENTED', 9)] });

    expect(approval.state).toBe('waiting');
    expect(reasonOf(approval)).toBe('owner @alice of board #30 has not approved #41');
  });

  it('answers waiting when someone else approved', async () => {
    const { approval } = await gate({ files: ['docs/b.md'], reviews: [review('bob', 'APPROVED', 9)] });

    expect(approval.state).toBe('waiting');
  });

  it('answers waiting when a later review follows the approval', async () => {
    const { approval } = await gate({
      files: ['docs/b.md'],
      reviews: [review('alice', 'APPROVED', 9), review('alice', 'COMMENTED', 10)],
    });

    expect(approval.state).toBe('waiting');
  });

  it('reads latest by submitted time, not by the provider\'s order', async () => {
    const later = await gate({
      files: ['docs/b.md'],
      reviews: [review('alice', 'COMMENTED', 10), review('alice', 'APPROVED', 9)],
    });
    const approvedLast = await gate({
      files: ['docs/b.md'],
      reviews: [review('alice', 'COMMENTED', 9), review('alice', 'APPROVED', 10)],
    });

    expect(later.approval.state).toBe('waiting');
    expect(approvedLast.approval.state).toBe('approved');
  });
});

describe('readOwnerApproval: an @org/team owner', () => {
  it('answers approved on an active member\'s approval, asking that one membership', async () => {
    const { approval, asked, sent } = await gate({
      files: ['web/a.ts'],
      reviews: [review('bob', 'APPROVED', 9)],
      memberships: { '@org/web bob': { state: 'active' } },
    });

    expect(approval).toEqual({ state: 'approved', owners: [{ handle: '@org/web', boards: [20], approvedBy: 'bob' }] });
    expect(asked).toEqual(['@org/web bob']);
    expect(sent).toEqual([`changedFiles ${String(PULL)}`, `reviews ${String(PULL)}`]);
  });

  it('answers waiting when the approver is not a member (control)', async () => {
    const { approval } = await gate({ files: ['web/a.ts'], reviews: [review('bob', 'APPROVED', 9)] });

    expect(approval.state).toBe('waiting');
    expect(reasonOf(approval)).toBe('no active member of owner @org/web of board #20 has approved #41');
  });

  it('answers waiting when the approver\'s membership is still pending', async () => {
    const { approval } = await gate({
      files: ['web/a.ts'],
      reviews: [review('bob', 'APPROVED', 9)],
      memberships: { '@org/web bob': { state: 'pending' } },
    });

    expect(approval.state).toBe('waiting');
  });

  it('answers waiting on a member\'s comment-only review, asking no membership', async () => {
    const { approval, asked } = await gate({
      files: ['web/a.ts'],
      reviews: [review('bob', 'COMMENTED', 9)],
      memberships: { '@org/web bob': { state: 'active' } },
    });

    expect(approval.state).toBe('waiting');
    expect(asked).toEqual([]);
  });
});

describe('readOwnerApproval: several owners', () => {
  it('answers approved only when every owner approved', async () => {
    const { approval } = await gate({
      files: ['web/a.ts', 'docs/b.md', 'src/c.ts'],
      reviews: [review('bob', 'APPROVED', 9), review('alice', 'APPROVED', 10)],
      memberships: { '@org/web bob': { state: 'active' } },
    });

    expect(approval).toEqual({
      state: 'approved',
      owners: [
        { handle: '@org/web', boards: [20], approvedBy: 'bob' },
        { handle: '@alice', boards: [30], approvedBy: 'alice' },
      ],
    });
  });

  it('answers waiting when one of two owners has not approved (control)', async () => {
    const { approval } = await gate({
      files: ['web/a.ts', 'docs/b.md'],
      reviews: [review('bob', 'APPROVED', 9)],
      memberships: { '@org/web bob': { state: 'active' } },
    });

    expect(approval.state).toBe('waiting');
    expect(reasonOf(approval)).toBe('owner @alice of board #30 has not approved #41');
    expect(ownersOf(approval)).toEqual([
      { handle: '@org/web', boards: [20] },
      { handle: '@alice', boards: [30] },
    ]);
  });

  it('answers unknown over waiting when one owner\'s lookup failed', async () => {
    const { approval } = await gate({
      files: ['web/a.ts', 'docs/b.md'],
      reviews: [review('bob', 'APPROVED', 9)],
      memberships: { '@org/web bob': { state: 'unknown', reason: 'offline' } },
    });

    expect(approval.state).toBe('unknown');
  });
});

/** A command that exited 0 and wrote `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A runner answering `result` to every command, keeping each. */
function stubGh(result: GhResult): { run: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run: GhRunner = (args) => {
    calls.push([...args]);
    return Promise.resolve(result);
  };
  return { run, calls };
}

describe('teamMembershipArgs', () => {
  it('asks the memberships path of a team for a login', () => {
    expect(teamMembershipArgs('@open-tomato/maintainers', 'marcostomatti'))
      .toEqual(['api', 'orgs/open-tomato/teams/maintainers/memberships/marcostomatti']);
  });

  it('answers null for a handle that is not a team, and for a login that is not one', () => {
    expect(teamMembershipArgs('@octocat', 'bob')).toBeNull();
    expect(teamMembershipArgs('org/team', 'bob')).toBeNull();
    expect(teamMembershipArgs('@org/../repos', 'bob')).toBeNull();
    expect(teamMembershipArgs('@org/team', 'dependabot[bot]')).toBeNull();
    expect(teamMembershipArgs('@org/team', 'bob/../x')).toBeNull();
    expect(teamMembershipArgs('@org/team', '')).toBeNull();
  });
});

describe('createGhTeamMembership', () => {
  const ARGS = ['api', 'orgs/open-tomato/teams/maintainers/memberships/bob'];

  it('answers active on the measured member answer', async () => {
    const { run, calls } = stubGh(wrote('{"state":"active","role":"maintainer","url":"https://api.github.com/x"}'));

    expect(await createGhTeamMembership({ gh: run })('@open-tomato/maintainers', 'bob')).toEqual({ state: 'active' });
    expect(calls).toEqual([ARGS]);
  });

  it('answers pending on an invitation not yet accepted', async () => {
    const { run } = stubGh(wrote('{"state":"pending","role":"member"}'));

    expect(await createGhTeamMembership({ gh: run })('@open-tomato/maintainers', 'bob')).toEqual({ state: 'pending' });
  });

  it('answers not-member on a 404', async () => {
    const { run, calls } = stubGh(notFound('Not Found', MEMBERSHIP_DOCS));

    expect(await createGhTeamMembership({ gh: run })('@open-tomato/maintainers', 'bob')).toEqual({ state: 'not-member' });
    expect(calls).toEqual([ARGS]);
  });

  it('answers unknown on a 403 with the same envelope (control)', async () => {
    const { run } = stubGh(httpFailure(403, 'Resource not accessible by integration', MEMBERSHIP_DOCS));

    const answered = await createGhTeamMembership({ gh: run })('@open-tomato/maintainers', 'bob');

    expect(answered).toEqual({
      state: 'unknown',
      reason: `gh ${ARGS.join(' ')} failed: gh: Resource not accessible by integration (HTTP 403)`,
    });
  });

  it('answers unknown on a failure that wrote nothing', async () => {
    const { run } = stubGh({ ok: false, stdout: '', stderr: '' });

    expect(await createGhTeamMembership({ gh: run })('@open-tomato/maintainers', 'bob'))
      .toEqual({ state: 'unknown', reason: `gh ${ARGS.join(' ')} failed and wrote nothing` });
  });

  it('answers unknown on an exit-0 answer that is not the measured JSON', async () => {
    const notJson = stubGh(wrote('<html>'));
    const noState = stubGh(wrote('{"role":"member"}'));

    expect(await createGhTeamMembership({ gh: notJson.run })('@open-tomato/maintainers', 'bob'))
      .toEqual({ state: 'unknown', reason: `gh ${ARGS.join(' ')} wrote something that is not JSON` });
    expect(await createGhTeamMembership({ gh: noState.run })('@open-tomato/maintainers', 'bob'))
      .toEqual({ state: 'unknown', reason: `gh ${ARGS.join(' ')} answered membership state undefined` });
  });

  it('answers unknown for a bot login, sending nothing', async () => {
    const { run, calls } = stubGh(wrote('{"state":"active"}'));

    const answered = await createGhTeamMembership({ gh: run })('@open-tomato/maintainers', 'dependabot[bot]');

    expect(answered.state).toBe('unknown');
    expect(calls).toEqual([]);
  });
});
