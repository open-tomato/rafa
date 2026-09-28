/**
 * Tests for the owner gate `rafa next --roadmap` asks (`./owner-gate.ts`):
 * which boards it weighs, where it reads home, and that a reading that
 * fails rejects rather than answering.
 *
 * The listing is planted in-process as `parseBoardListing` reads `gh`'s
 * JSON; every other `gh` command goes to a stand-in answering by argv
 * and logging each call, and the provider is a pair of planted
 * functions. The position file is written under a temporary root with no
 * CODEOWNERS file, so ownership is read off the boards' `Owns:` lines.
 * Nothing here spawns `gh` or reaches GitHub.
 *
 * ## The controls
 *
 *  - The approved case is read beside the same pull request with the
 *    reviewer outside the team, which must answer `waiting`, and with the
 *    owner handle unknown to GitHub, which must answer `unresolved`: a
 *    gate that approved whatever it was handed fails both.
 *  - Home read off the position file is read beside the same line with
 *    no position file, where the default board's listing must be sent;
 *    the log shows which of the two was asked.
 */
import type { GhResult } from '../adapters/tracker/github.js';
import type { BoardIssue } from '../board/roadmap-board.js';
import type { PullRequestReview } from '../pr/types.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseBoardListing } from '../board/roadmap-board.js';
import { positionAt, writePositionFile } from '../project/position.js';

import { gateBoards, nextOwnerGate } from './owner-gate.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-owner-gate-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The pull request every case asks about. */
const PR = 57;

/** One row of `gh issue list --json number,title,body,state,stateReason,labels`. */
interface Row {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly labels: readonly string[];
}

/** The rows as `gh` writes them. */
function json(rows: readonly Row[]): string {
  return JSON.stringify(rows.map((row) => ({ ...row, stateReason: null, labels: row.labels.map((name) => ({ name })) })));
}

/** The rows as the listing answers them. */
function listingOf(rows: readonly Row[]): readonly BoardIssue[] {
  return parseBoardListing(json(rows), 'gh issue list');
}

/** A board row. */
function board(number: number, body: string, over: Partial<Row> = {}): Row {
  return { number, title: `Board ${String(number)}`, body, state: 'OPEN', labels: ['type:roadmap'], ...over };
}

/** Home, board #10, owning `src/home`; the other team's, board #11, owning `src/away`. */
const HOME_BOARD = board(10, 'Owner: @acme/home\nOwns: src/home/');
const AWAY_BOARD = board(11, 'Owner: @acme/away\nOwns: src/away/');
const ROWS: readonly Row[] = [HOME_BOARD, AWAY_BOARD];

/** How many scratch roots a case has been handed. */
let scratches = 0;

/** A project root no other case shares, with the position standing at `home` when one is named. */
function rootAt(home: number | null): string {
  scratches += 1;
  const root = join(tempBase, `case-${String(scratches)}`);
  mkdirSync(root, { recursive: true });
  if (home !== null) writePositionFile(root, positionAt({ board: home, epic: null }));
  return root;
}

/** What a `gh` stand-in answers: ok with `stdout`, or a failure writing `stderr`. */
function ok(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A 404 as `gh api` writes one. */
const NOT_FOUND: GhResult = { ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };

/** A `gh` stand-in answering by argv, every call logged; `answers` is keyed by the joined argv. */
function ghStandIn(answers: Readonly<Record<string, GhResult>>): { readonly gh: (args: readonly string[]) => Promise<GhResult>; readonly calls: string[] } {
  const calls: string[] = [];
  const gh = (args: readonly string[]): Promise<GhResult> => {
    const line = args.join(' ');
    calls.push(line);
    const fallback = line.startsWith('issue list')
      ? ok('[]')
      : NOT_FOUND;
    return Promise.resolve(answers[line] ?? fallback);
  };
  return { gh, calls };
}

/** `gh` finding the away team, and `login` an active member of it. */
function teamAnswers(login: string): Record<string, GhResult> {
  return {
    'api orgs/acme/teams/away': ok('{}'),
    [`api orgs/acme/teams/away/memberships/${login}`]: ok('{"state":"active","role":"member"}'),
  };
}

/** A provider changing `paths`, with `reviews` given. */
function pullsOf(paths: readonly string[], reviews: readonly PullRequestReview[]): {
  readonly changedFiles: (number: number) => Promise<readonly string[]>;
  readonly reviews: (number: number) => Promise<readonly PullRequestReview[]>;
} {
  return {
    changedFiles: () => Promise.resolve(paths),
    reviews: () => Promise.resolve(reviews),
  };
}

/** One approval by `login`. */
function approvedBy(login: string): readonly PullRequestReview[] {
  return [{ login, state: 'APPROVED', submittedAt: '2026-09-28T12:00:00Z' }];
}

describe('the boards the gate weighs', () => {
  it('takes every open labelled board, and home besides when the listing holds it unlabelled', () => {
    const listing = listingOf([
      ...ROWS,
      board(12, 'Owner: @acme/gone', { state: 'CLOSED' }),
      board(13, 'Owner: @acme/solo', { title: 'Roadmap', labels: [] }),
      board(14, 'just an issue', { labels: [] }),
    ]);

    expect(gateBoards(listing, 10).map((owned) => owned.number)).toEqual([10, 11]);
    expect(gateBoards(listing, 13).map((owned) => owned.number)).toEqual([10, 11, 13]);
    expect(gateBoards(listing, 12).map((owned) => owned.number)).toEqual([10, 11]);
    expect(gateBoards(listing, 13).at(-1)).toEqual({ number: 13, owner: '@acme/solo', owns: [] });
  });
});

describe('the gate', () => {
  it('approves a pull request into another board\'s folder once an active member of its owner approved', async () => {
    const { gh, calls } = ghStandIn(teamAnswers('bob'));
    const gate = nextOwnerGate({
      gh,
      root: rootAt(10),
      pulls: pullsOf(['src/away/x.ts'], approvedBy('bob')),
      configured: null,
      listing: () => Promise.resolve(listingOf(ROWS)),
    });

    const approval = await gate(PR);

    expect(approval).toEqual({ state: 'approved', owners: [{ handle: '@acme/away', boards: [11], approvedBy: 'bob' }] });
    expect(calls).toEqual(['api orgs/acme/teams/away', 'api orgs/acme/teams/away/memberships/bob']);
  });

  it('answers waiting for a reviewer outside the team, and unresolved for an owner GitHub does not know', async () => {
    const outside = ghStandIn(teamAnswers('bob'));
    const unknownTeam = ghStandIn({});
    const at = (gh: typeof outside.gh, reviewer: string): ReturnType<ReturnType<typeof nextOwnerGate>> => nextOwnerGate({
      gh,
      root: rootAt(10),
      pulls: pullsOf(['src/away/x.ts'], approvedBy(reviewer)),
      configured: null,
      listing: () => Promise.resolve(listingOf(ROWS)),
    })(PR);

    expect((await at(outside.gh, 'eve')).state).toBe('waiting');
    expect((await at(unknownTeam.gh, 'bob')).state).toBe('unresolved');
  });

  it('reads home off the position file, and off the default board with none', async () => {
    const positioned = ghStandIn({});
    const bare = ghStandIn({ 'issue list --label type:roadmap --state open --limit 1000 --json number,title,body,state,stateReason,labels': ok(json(ROWS)) });
    const home = (gh: typeof bare.gh, root: string): ReturnType<ReturnType<typeof nextOwnerGate>> => nextOwnerGate({
      gh,
      root,
      pulls: pullsOf(['src/home/x.ts'], []),
      configured: null,
      listing: () => Promise.resolve(listingOf(ROWS)),
    })(PR);

    expect(await home(positioned.gh, rootAt(11))).toMatchObject({ state: 'unresolved' });
    expect(positioned.calls).toEqual(['api orgs/acme/teams/home']);
    expect(await home(bare.gh, rootAt(null))).toEqual({ state: 'not-gated' });
    expect(bare.calls[0]).toBe('issue list --label type:roadmap --state open --limit 1000 --json number,title,body,state,stateReason,labels');
  });

  it('rejects when the listing fails, which the asking row reads as unknown', async () => {
    const { gh } = ghStandIn({});
    const gate = nextOwnerGate({
      gh,
      root: rootAt(10),
      pulls: pullsOf(['src/away/x.ts'], approvedBy('bob')),
      configured: null,
      listing: () => Promise.reject(new Error('board listing: gh issue list failed: HTTP 502')),
    });

    const rejected: unknown = await gate(PR).catch((error: unknown) => error);

    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe('board listing: gh issue list failed: HTTP 502');
  });
});
