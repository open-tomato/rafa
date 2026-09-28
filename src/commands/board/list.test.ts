/**
 * Tests for `rafa board list` (`list.ts`): the pure pieces — which
 * boards are listed, the epic count, the owner cell and the line — then
 * the command dispatched over one planted `gh` answering the board
 * listing, the title search and the owner lookups, from a fresh project
 * whose position file a case plants or leaves out.
 *
 * The board: open `type:roadmap` boards #31 (the default, being the
 * lowest-numbered labelled one), #40 and #45, and a closed one, #41. #31
 * is owned by `@alice`, who resolves; #40 by `@acme/payments`, which
 * GitHub answers 404 for; #45 by `@acme/growth`, whose lookup fails with
 * a 403, and it lists no epic. #31 lists epics #50 and #60 and spec line
 * #7; #40 lists #80, #50 and #50 again. #1 is an unlabelled issue titled
 * "Roadmap", which is no board while boards are labelled.
 *
 * The one-listing case holds the listing count at exactly one and the
 * label listing at zero, so a filter that matched no call fails it as a
 * second listing does. The owner case counts the lookups per handle, so
 * a resolver made per board, asking `@alice` twice, would fail it.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../../adapters/tracker/github.js';
import { writePositionFile } from '../../project/position.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import {
  BOARD_LIST_REFUSAL_EXIT,
  boardLine,
  createBoardListCommand,
  epicCount,
  listedBoards,
  ownerCell,
} from './list.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** One issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function raw(number: number, title: string, body: string, labels: readonly string[], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : null;
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** A board body: the owner line when one is given, then a checklist naming `issues`. */
function board(owner: string | null, ...issues: readonly number[]): string {
  const lines = issues.map((number) => `- [ ] #${String(number)}`);
  return (owner === null
    ? lines
    : [`Owner: ${owner}`, '', ...lines]).join('\n');
}

const BOARD_LABELS = ['type:roadmap'];

/** The subject the command is dispatched under. */
const BOARD_SUBJECT = { name: 'board', summary: 'the boards' };

/** An epic labelled `now` with slug `slug`. */
function epic(number: number, title: string, slug: string): object {
  return raw(number, title, '## Acceptance criteria\n\nWorks.\n', ['type:epic', `epic:${slug}`, 'horizon:now']);
}

/** The board the module note describes. */
const LISTING: readonly object[] = [
  raw(1, 'Roadmap', board(null, 50), []),
  raw(7, 'A spec', 'Nothing.', ['type:feature']),
  raw(31, 'Platform board', board('@alice', 50, 7, 60), BOARD_LABELS),
  raw(40, 'Payments board', board('@acme/payments', 80, 50, 50), BOARD_LABELS),
  raw(41, 'Old board', board('@alice', 50), BOARD_LABELS, 'CLOSED'),
  raw(45, 'Growth board', board('@acme/growth'), BOARD_LABELS),
  epic(50, 'Epic alpha', 'alpha'),
  raw(51, 'alpha one', 'Open.', ['epic:alpha']),
  epic(60, 'Epic beta', 'beta'),
  raw(61, 'beta one', 'Open.', ['epic:beta']),
  epic(80, 'Epic delta', 'delta'),
  raw(81, 'delta one', 'Open.', ['epic:delta']),
];

/** How the planted `gh` answers. */
interface Planted {
  readonly listing?: readonly object[];
  readonly search?: readonly object[];
  readonly failListing?: boolean;
}

/** A `gh` answering the board listing, the title search and the owner lookups, recording each call. */
function plantedGh(calls: string[][], planted: Planted): GhRunner {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const failed = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });
  return (args) => {
    calls.push([...args]);
    const [noun, verb] = args;
    if (noun === 'api' && verb === 'users/alice') return Promise.resolve(ok('{"login":"alice"}'));
    if (noun === 'api' && verb === 'orgs/acme/teams/payments') {
      return Promise.resolve(failed('gh: Not Found (HTTP 404)'));
    }
    if (noun === 'api' && verb === 'orgs/acme/teams/growth') {
      return Promise.resolve(failed('gh: Resource not accessible by integration (HTTP 403)'));
    }
    if (noun === 'issue' && verb === 'list' && args.includes('--search')) {
      return Promise.resolve(ok(JSON.stringify(planted.search ?? [{ number: 1, title: 'Roadmap' }])));
    }
    if (noun === 'issue' && verb === 'list' && args.includes('--label')) {
      return Promise.resolve(failed('the label listing is not this command\'s to read'));
    }
    if (noun === 'issue' && verb === 'list' && args.includes('all')) {
      return Promise.resolve(planted.failListing === true
        ? failed('error connecting to api.github.com')
        : ok(JSON.stringify(planted.listing ?? LISTING)));
    }
    return Promise.resolve(failed(`unplanted: gh ${args.join(' ')}`));
  };
}

/** A fresh project with no `roadmap.issue`, unless `config` names one. */
function plantCase(config = 'tracker:\n  default: local\n'): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** Dispatches `words` from `project` over the planted `gh`, answering the outcome and the `gh` calls. */
async function run(words: readonly string[], project: PlantedProject = plantCase(), planted: Planted = {}) {
  const calls: string[][] = [];
  const outcome = await dispatchInProject(['board', 'list', ...words], [BOARD_SUBJECT], [createBoardListCommand({ gh: plantedGh(calls, planted) })], project);
  return { ...outcome, calls };
}

/** The listing as `BoardIssue`s, read as the listing reads them. */
function boardIssues(listing: readonly object[] = LISTING): readonly BoardIssue[] {
  return listing.map((row) => {
    const issue = row as { number: number; title: string; body: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null; labels: { name: string }[] };
    const labels = issue.labels.map((label) => label.name);
    return { ...issue, labels, type: typeOfLabels(labels), module: 'unassigned' };
  });
}

/** The row of `number` in `listing`. */
function rowOf(number: number, listing: readonly BoardIssue[] = boardIssues()): BoardIssue {
  const found = listing.find((issue) => issue.number === number);
  if (found === undefined) throw new Error(`no #${String(number)} in the listing`);
  return found;
}

describe('listedBoards', () => {
  it('keeps the open labelled boards, lowest first, and leaves a labelled default as it is', () => {
    expect(listedBoards(boardIssues(), 31).map((issue) => issue.number)).toEqual([31, 40, 45]);
  });

  it('adds an unlabelled default board in number order', () => {
    expect(listedBoards(boardIssues(), 1).map((issue) => issue.number)).toEqual([1, 31, 40, 45]);
  });

  it('adds no default the listing holds closed or does not hold', () => {
    expect(listedBoards(boardIssues(), 41).map((issue) => issue.number)).toEqual([31, 40, 45]);
    expect(listedBoards(boardIssues(), 999).map((issue) => issue.number)).toEqual([31, 40, 45]);
  });
});

describe('epicCount', () => {
  it('counts the distinct epics a checklist names, leaving a spec line out', () => {
    expect(epicCount(rowOf(31), boardIssues())).toBe(2);
    expect(epicCount(rowOf(40), boardIssues())).toBe(2);
    expect(epicCount(rowOf(45), boardIssues())).toBe(0);
  });
});

describe('ownerCell and boardLine', () => {
  it('prints a resolved owner bare and spells unresolved and unknown out', () => {
    expect(ownerCell(null)).toBe('no owner');
    expect(ownerCell({ handle: '@alice', state: 'resolved' })).toBe('@alice');
    expect(ownerCell({ handle: '@acme/x', state: 'unresolved' })).toBe('@acme/x (unresolved)');
    expect(ownerCell({ handle: '@acme/x', state: 'unknown', reason: 'offline' })).toBe('@acme/x (unknown)');
  });

  it('marks current and home, and counts one epic in the singular', () => {
    const row = { number: 31, title: 'Platform', owner: null, epics: 1, current: true, home: true };

    expect(boardLine(row)).toBe('#31 Platform · no owner · 1 epic · current · home');
    expect(boardLine({ ...row, epics: 0, current: false })).toBe('#31 Platform · no owner · 0 epics · home');
    expect(boardLine({ ...row, current: false, home: false })).toBe('#31 Platform · no owner · 1 epic');
  });
});

describe('rafa board list', () => {
  it('lists each open board with its owner, epic count and marks, the default both current and home with no position file', async () => {
    const result = await run([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe([
      'warn: Could not check owner @acme/growth of board #45: gh api orgs/acme/teams/growth failed:'
        + ' gh: Resource not accessible by integration (HTTP 403)',
      '#31 Platform board · @alice · 2 epics · current · home',
      '#40 Payments board · @acme/payments (unresolved) · 2 epics',
      '#45 Growth board · @acme/growth (unknown) · 0 epics',
      '',
    ].join('\n'));
    expect(result.stderr).toBe('');
  });

  it('marks current and home apart when the position holds them apart', async () => {
    const project = plantCase();
    writePositionFile(project.root, { current: { board: 40, epic: 80 }, previous: null, home: { board: 31, epic: 50 } });

    const result = await run([], project);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n').slice(1, 3)).toEqual([
      '#31 Platform board · @alice · 2 epics · home',
      '#40 Payments board · @acme/payments (unresolved) · 2 epics · current',
    ]);
  });

  it('reads the board listing once, never the label listing, and asks each owner once', async () => {
    const listing = [...LISTING, raw(46, 'Second alice board', board('@ALICE', 60), BOARD_LABELS)];
    const result = await run([], plantCase(), { listing });
    const listings = result.calls.filter((call) => call[0] === 'issue' && call[1] === 'list' && call.includes('all'));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('#46 Second alice board · @ALICE · 1 epic\n');
    expect(listings).toHaveLength(1);
    expect(result.calls.filter((call) => call.includes('--label'))).toEqual([]);
    expect(result.calls.filter((call) => call[0] === 'api' && call[1] === 'users/alice')).toHaveLength(1);
  });

  it('gives the rows and the places as the json result', async () => {
    const result = await run(['--output=json']);
    const data = eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: unknown } | undefined;

    expect(result.exitCode).toBe(0);
    expect(data?.data).toEqual({
      boards: [
        { number: 31, title: 'Platform board', owner: { handle: '@alice', state: 'resolved' }, epics: 2, current: true, home: true },
        { number: 40, title: 'Payments board', owner: { handle: '@acme/payments', state: 'unresolved' }, epics: 2, current: false, home: false },
        {
          number: 45,
          title: 'Growth board',
          owner: {
            handle: '@acme/growth',
            state: 'unknown',
            reason: 'gh api orgs/acme/teams/growth failed: gh: Resource not accessible by integration (HTTP 403)',
          },
          epics: 0,
          current: false,
          home: false,
        },
      ],
      current: { board: 31, epic: 50 },
      home: { board: 31, epic: 50 },
    });
  });

  it('lists the unlabelled Roadmap as the one board where nothing is labelled', async () => {
    const listing = [raw(1, 'Roadmap', board(null, 50), []), epic(50, 'Epic alpha', 'alpha'), raw(51, 'alpha one', 'Open.', ['epic:alpha'])];
    const result = await run([], plantCase(), { listing });

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('#1 Roadmap · no owner · 1 epic · current · home\n');
  });

  it('warns that a lost current place fell back to the default board', async () => {
    const project = plantCase();
    writePositionFile(project.root, { current: { board: 41, epic: null }, previous: null, home: { board: 41, epic: null } });

    const result = await run([], project);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith('warn: The current place and home lost board #41, which is closed; falling back to the default board #31 at epic #50\n');
    expect(result.stdout).toContain('#31 Platform board · @alice · 2 epics · current · home\n');
  });

  it('refuses with exit code 2 when the board listing cannot be read', async () => {
    const result = await run([], plantCase(), { failListing: true });

    expect(result.exitCode).toBe(BOARD_LIST_REFUSAL_EXIT);
    expect(result.stderr).toContain('Could not read the board');
    expect(result.stdout).toBe('');
  });

  it('refuses with exit code 2 a project with no board at all', async () => {
    const listing = [epic(50, 'Epic alpha', 'alpha')];
    const result = await run([], plantCase(), { listing, search: [] });

    expect(result.exitCode).toBe(BOARD_LIST_REFUSAL_EXIT);
    expect(result.stderr).toContain('Could not find the default board');
  });

  it('refuses a stray word with exit code 1, reading nothing', async () => {
    const result = await run(['31']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage: rafa board list');
    expect(result.calls).toEqual([]);
  });
});
