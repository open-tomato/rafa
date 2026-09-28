/**
 * Tests for the cancelled-epic notice as `rafa next`'s board carries it
 * (`./sources.ts`, `NextBoardOptions.noticeCancelled`): its lines are
 * problems when the walk read the listing, over that one listing, and
 * nothing otherwise. Kept apart from `./sources.test.ts`, which sits
 * near the 800-line cap.
 *
 * The roadmap names epic #80 (`now`, member #82 open), then #99. Epic
 * #30 is closed as not planned; its open member #31 blocks #82.
 *
 * ## The controls
 *
 *  - The same board with epic #30 open prints no notice, so the answer
 *    with the notice is not a line written whatever the board holds.
 *  - The same board without `noticeCancelled`, as `rafa status` builds
 *    it, prints none either.
 *  - A walk that sends no listing (the epic is `later`) prints none, and
 *    the recorded calls hold no listing, so the notice costs no read.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { RafaContext } from '../cli/command.js';
import type { GitRunner } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { renderCancelledEpicNotice } from '../board/epic-cancel-notice.js';
import { createCommandRegistry } from '../cli/registry.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { resolveScope } from '../project/scope.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { ghNextBoard, openNextSources } from './sources.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-cancelled-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The Roadmap issue `roadmap.issue` names. */
const ROADMAP = 1;

/** How the recorded calls name the board listing. */
const LISTING_CALL = 'issue list --state all';

/** One row as the board listing answers it. */
interface Row {
  readonly number: number;
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string;
  readonly labels?: readonly string[];
}

/** An answer `gh` wrote. */
function wrote(stdout: string): Promise<GhResult> {
  return Promise.resolve({ ok: true, stdout, stderr: '' });
}

/** A `gh` answering the roadmap, the issues by number and the listing, recording each call. */
function fakeGh(rows: readonly Row[], roadmap: string): { readonly gh: GhRunner; readonly calls: string[] } {
  const calls: string[] = [];
  const gh: GhRunner = (args) => {
    const route = args.slice(0, 2).join(' ');
    // The listing sends --state all; the type:roadmap listing sends --label.
    const listing = route === 'issue list' && args.includes('--state') && args.includes('all');
    calls.push(listing
      ? LISTING_CALL
      : args.slice(0, 3).join(' '));
    if (listing) {
      return wrote(JSON.stringify(rows.map((row) => ({
        number: row.number,
        title: `Issue ${String(row.number)}`,
        body: row.body ?? '',
        state: row.state ?? 'OPEN',
        stateReason: row.stateReason ?? '',
        labels: (row.labels ?? []).map((name) => ({ name })),
      }))));
    }
    if (route === 'issue list') return wrote('[]');
    if (route === 'pr list') return wrote('[]');
    if (route === 'issue view') {
      const number = Number(args[2]);
      const row = number === ROADMAP
        ? { number, body: roadmap }
        : rows.find((each) => each.number === number) ?? { number };
      return wrote(JSON.stringify({
        number,
        title: `Issue ${String(number)}`,
        body: row.body ?? '',
        state: row.state ?? 'OPEN',
        labels: (row.labels ?? []).map((name) => ({ name })),
        author: { login: 'maintainer' },
      }));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}` });
  };
  return { gh, calls };
}

/** A git holding no branch. */
const git: GitRunner = () => ({ ok: true, stdout: '', stderr: '' });

/** The roadmap: epic #80, then #99. */
const ROADMAP_BODY = '- [ ] #80 the epic\n- [ ] #99 after it\n';

/** The board, epic #80 at `horizon`, epic #30 closed as `reason` (open when null). */
function board(horizon: string, reason: string | null): readonly Row[] {
  const cancelled: Row = reason === null
    ? { number: 30, labels: ['type:epic', 'epic:gone', 'horizon:now'] }
    : { number: 30, state: 'CLOSED', stateReason: reason, labels: ['type:epic', 'epic:gone', 'horizon:now'] };
  return [
    { number: 80, body: '- [ ] #82\n', labels: ['type:epic', 'epic:walk', horizon] },
    { number: 82, body: 'Prose.\n\nBlocked by: #31\n', labels: ['epic:walk'] },
    cancelled,
    { number: 31, labels: ['epic:gone'] },
    { number: 99 },
  ];
}

/** One answer over `rows`, with or without the notice. */
async function answer(rows: readonly Row[], noticeCancelled?: boolean): Promise<{ problems: readonly string[]; calls: readonly string[] }> {
  const { gh, calls } = fakeGh(rows, ROADMAP_BODY);
  const reading = await ghNextBoard({ gh, git, configured: ROADMAP, noticeCancelled }).next();
  return { problems: reading.problems, calls };
}

const NOTICE = renderCancelledEpicNotice({ epic: 30, dependents: [82] });

describe('the cancelled-epic notice on rafa next\'s board', () => {
  it('carries the notice as a problem over the one listing the walk read', async () => {
    const { problems, calls } = await answer(board('horizon:now', 'NOT_PLANNED'), true);

    expect(problems).toEqual([NOTICE]);
    expect(calls.filter((call) => call === LISTING_CALL)).toHaveLength(1);
  });

  it('carries no notice when no epic is cancelled (control)', async () => {
    expect((await answer(board('horizon:now', null), true)).problems).toEqual([]);
    expect((await answer(board('horizon:now', 'COMPLETED'), true)).problems).toEqual([]);
  });

  it('carries no notice for a board built without it, as rafa status builds it', async () => {
    expect((await answer(board('horizon:now', 'NOT_PLANNED'))).problems).toEqual([]);
  });

  it('carries no notice and sends no listing when the walk reads none', async () => {
    const { problems, calls } = await answer(board('horizon:later', 'NOT_PLANNED'), true);

    expect(problems).toEqual([]);
    expect(calls).not.toContain(LISTING_CALL);
  });
});

describe('rafa next\'s own sources', () => {
  /** A context over a project whose config names the roadmap. */
  function context(): RafaContext {
    const root = join(tempBase, 'project');
    const home = join(tempBase, 'home');
    mkdirSync(join(root, '.rafa'), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(root, '.rafa', 'config.yaml'), `roadmap:\n  issue: ${String(ROADMAP)}\n`, 'utf8');
    const scope = resolveScope(root, { home });
    if (!scope.found) throw new Error(`the planted project did not resolve: ${scope.hint}`);
    return Object.freeze({
      args: [],
      flags: {},
      outputMode: 'text',
      verbosity: 2,
      output: sinkOutput({}),
      signal: new AbortController().signal,
      env: {},
      argv: [],
      registry: createCommandRegistry({ subjects: [], commands: [] }),
      project: scope,
    });
  }

  it('build the board with the notice on', async () => {
    const { gh } = fakeGh(board('horizon:now', 'NOT_PLANNED'), ROADMAP_BODY);
    const sources = openNextSources(context(), {
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
      openGh: () => gh,
      openGit: () => git,
      pullRequests: () => createPullRequestsDouble({}).pulls,
    });

    expect((await sources.board.next()).problems).toEqual([NOTICE]);
  });
});
