/**
 * `resolvePlace` (`place.ts`) exercised over a position file that was
 * true when it was written and has since gone stale, past what
 * `place.test.ts` covers with a listing built once, beside a file
 * planted with the same call.
 *
 * The position is written for real with `writePositionFile` while its
 * board stands: open and labelled `type:roadmap`. The board listing
 * `resolvePlace` is then handed reads that same board CLOSED, the
 * shape a listing takes once someone closes it between the write and
 * the read; nothing here rewrites the file, since only a switch does
 * that. The answer is the default board's fallback place, and the one
 * notice names the closed board and the fallback it fell to.
 */
import type { BoardIssue } from './roadmap-board.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { positionAt, writePositionFile } from '../project/position.js';

import { resolvePlace } from './place.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-place-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let caseCount = 0;

/** A fresh project root for one case. */
function freshRoot(): string {
  caseCount += 1;
  const root = join(tempBase, `case-${String(caseCount)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** The fields a case may set on an issue. */
interface IssueFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly body?: string;
}

/** One listing row, its type read from its labels, as `parseBoardListing` reads a real one. */
function issue(number: number, fields: IssueFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
  };
}

const BOARD = ['type:roadmap'];

/** A checklist naming `issues`, unticked. */
function checklist(...issues: readonly number[]): string {
  return issues.map((number) => `- [ ] #${String(number)}`).join('\n');
}

/** The default board #31 at its one now epic #50; the board #40 the case moves off of. */
function listing(boardFortyState: 'OPEN' | 'CLOSED'): readonly BoardIssue[] {
  return [
    issue(31, { labels: BOARD, body: checklist(50) }),
    issue(50, { labels: ['type:epic', 'epic:alpha', 'horizon:now'] }),
    issue(51, { labels: ['epic:alpha'] }),
    issue(40, { labels: BOARD, body: checklist(80), state: boardFortyState }),
    issue(80, { labels: ['type:epic', 'epic:delta', 'horizon:now'] }),
    issue(81, { labels: ['epic:delta'] }),
  ];
}

/** A default board stand-in that always answers #31. */
function defaultBoard(): Promise<number> {
  return Promise.resolve(31);
}

describe('resolvePlace over a position written before its board closed', () => {
  it('resolves to the default board with the fallback notice once the board is closed', async () => {
    const root = freshRoot();
    writePositionFile(root, positionAt({ board: 40, epic: 80 }));

    // Read straight after the write, board #40 still stands: no fallback.
    const whileOpen = await resolvePlace({ root, listing: listing('OPEN'), defaultBoard });
    expect(whileOpen.current).toEqual({ board: 40, epic: 80 });
    expect(whileOpen.notices).toEqual([]);

    // The same file, unrewritten, read once board #40 has since closed.
    const afterClose = await resolvePlace({ root, listing: listing('CLOSED'), defaultBoard });
    expect(afterClose.current).toEqual({ board: 31, epic: 50 });
    expect(afterClose.home).toEqual({ board: 31, epic: 50 });
    expect(afterClose.fallback).toEqual({ place: { board: 31, epic: 50 }, boardListed: true });
    expect(afterClose.notices).toEqual([{
      kind: 'lost',
      slots: ['current', 'home'],
      place: { board: 40, epic: 80 },
      losses: [{ what: 'board', number: 40, why: 'closed' }],
      message: 'The current place and home lost board #40, which is closed; '
        + 'falling back to the default board #31 at epic #50',
    }]);
  });
});
