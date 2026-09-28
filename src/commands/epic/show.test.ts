/**
 * Tests for `rafa epic show` (`show.ts`), typed here mostly as
 * `rafa epics`, the spelling it kept through its lasting alias: the pure
 * pieces — the argument, the choice of the first `now` epic, the problems
 * kept for one epic and the lines written — and the command dispatched
 * over one planted `gh` and `git` holding four epics, under a registry
 * declaring the `epic` subject, so every `epics` line below is routed
 * through the subject's plural to the alias.
 *
 * The board: epic #80 is `next`, epic #70 is `now` with its one member
 * closed (so `done`, and still open: a disagreement), epic #50 (`alpha`)
 * is `now` and in progress, and epic #60 (`beta`) is `now` and in
 * backlog. The Roadmap names them in that order, so a bare `rafa epics`
 * has to pass #80 by horizon and #70 as done to land on #50; landing on
 * any other epic, or on none, reddens the first dispatched case.
 *
 * "Names no issue of the other epic" is held by reading the printed
 * issue numbers, not by a missing substring alone: the control is the
 * same reading over `rafa epics 60`, which must find #61 and #62, so a
 * reading that found nothing could not pass both.
 *
 * The current place is a position file planted in the case's project.
 * A second board, #90 (`type:roadmap`), names #60 alone, so a bare
 * `rafa epics` on it lands on #60 where the default board lands on #50;
 * the bare case with no position file is the control for each.
 */
import type { EpicsResult } from './show.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { EpicProblem } from '../../board/epic-problems.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { RoadmapLine } from '../../board/roadmap.js';
import type { GitRunner } from '../../pr/git.js';
import type { Place } from '../../project/position.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../../adapters/tracker/github.js';
import { BOARDS_LIST_ARGS } from '../../board/boards.js';
import { renderCancelledEpicNotice } from '../../board/epic-cancel-notice.js';
import { readEpics } from '../../board/epics.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { unweighedPositionNotice } from '../../board/roadmap-rows.js';
import { ROADMAP_REFUSAL_EXIT } from '../../board/roadmap.js';
import { positionAt, writePositionFile } from '../../project/position.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';

import {
  createEpicShowCommand,
  epicHead,
  firstNowEpic,
  isProblemOf,
  noNowEpicLine,
  readEpicArgument,
  renderEpics,
} from './show.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epics-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The Roadmap issue the config names. */
const ROADMAP = 1;

/** The Roadmap's body: the four epics in the order the module note gives. */
const ROADMAP_BODY = '- [ ] #80 — later work\n- [ ] #70 — finished\n- [ ] #50 — alpha\n- [ ] #60 — beta\n';

/** One issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function boardIssue(number: number, title: string, body: string, state: 'OPEN' | 'CLOSED', labels: readonly string[]): object {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : null;
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** The board: four epics and their members, #54 labelled alpha and missing from its checklist. */
const BOARD = [
  boardIssue(50, 'Epic alpha', '## Acceptance criteria\n\nAlpha works.\n\nEstimate: 2 weeks\n\n- [ ] #51\n- [x] #52\n- [ ] #53\n', 'OPEN', ['type:epic', 'epic:alpha', 'horizon:now']),
  boardIssue(51, 'Alpha one', completeSpecBody('Alpha one'), 'OPEN', ['epic:alpha', SPEC_READY_LABEL]),
  boardIssue(52, 'Alpha two', 'Done.', 'CLOSED', ['epic:alpha']),
  boardIssue(53, 'Alpha three', completeSpecBody('Alpha three'), 'OPEN', ['epic:alpha']),
  boardIssue(54, 'Alpha stray', 'Labelled only.', 'OPEN', ['epic:alpha']),
  boardIssue(60, 'Epic beta', '## Acceptance criteria\n\nBeta works.\n\nEstimate: 1 week\n\n- [ ] #61\n- [ ] #62\n', 'OPEN', ['type:epic', 'epic:beta', 'horizon:now']),
  boardIssue(61, 'Beta one', completeSpecBody('Beta one'), 'OPEN', ['epic:beta']),
  boardIssue(62, 'Beta two', completeSpecBody('Beta two'), 'OPEN', ['epic:beta']),
  boardIssue(70, 'Epic gamma', '## Acceptance criteria\n\nGamma works.\n\nEstimate: 1 day\n\n- [ ] #71\n', 'OPEN', ['type:epic', 'epic:gamma', 'horizon:now']),
  boardIssue(71, 'Gamma one', 'Done.', 'CLOSED', ['epic:gamma']),
  boardIssue(80, 'Epic delta', '## Acceptance criteria\n\nDelta works.\n\nEstimate: 1 month\n', 'OPEN', ['type:epic', 'epic:delta', 'horizon:next']),
];

/** The second board, labelled `type:roadmap`, naming #60 alone. */
const SECOND = 90;

/** The second board's body. */
const SECOND_BODY = '- [ ] #60 — beta\n';

/** How the planted `gh` answers. */
interface Planted {
  readonly roadmapBody?: string;
  readonly failListing?: boolean;
  readonly failRoadmap?: boolean;
  /** Plant the second board on the listing, open or in this state. */
  readonly second?: 'OPEN' | 'CLOSED';
  /** Plant a position file at this place, current and home. */
  readonly position?: Place;
  /** Rows appended to the listing. */
  readonly extra?: readonly object[];
}

/** A `gh` answering the Roadmap read, the board listing and the open pull requests, recording each call. */
function plantedGh(calls: string[][], planted: Planted): GhRunner {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const failed = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });
  const roadmap = JSON.stringify({
    number: ROADMAP,
    title: 'Roadmap',
    body: planted.roadmapBody ?? ROADMAP_BODY,
    state: 'OPEN',
    labels: [],
    author: { login: 'owner' },
  });
  const second = JSON.stringify({ number: SECOND, title: 'Team board', body: SECOND_BODY, state: 'OPEN', labels: [], author: { login: 'owner' } });
  const seconds = planted.second === undefined
    ? []
    : [boardIssue(SECOND, 'Team board', SECOND_BODY, planted.second, ['type:roadmap'])];
  const board = [...BOARD, ...seconds, ...planted.extra ?? []];
  return (args) => {
    calls.push([...args]);
    const [noun, verb, number] = args;
    if (noun === 'issue' && verb === 'view') {
      if (planted.failRoadmap === true) return Promise.resolve(failed('could not resolve to an issue'));
      return Promise.resolve(ok(number === String(SECOND)
        ? second
        : roadmap));
    }
    // No issue carries type:roadmap, so the label listing answers empty
    // and roadmap.issue decides, as before.
    if (noun === 'issue' && verb === 'list' && args.includes('--label')) return Promise.resolve(ok('[]'));
    if (noun === 'issue' && verb === 'list') {
      return Promise.resolve(planted.failListing === true
        ? failed('error connecting to api.github.com')
        : ok(JSON.stringify(board)));
    }
    if (noun === 'pr' && verb === 'list') return Promise.resolve(ok('[]'));
    return Promise.resolve(failed(`unplanted: gh ${args.join(' ')}`));
  };
}

/** The subject the command is declared under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** A `git` holding no branch, locally or on the remote. */
const plantedGit: GitRunner = () => ({ ok: true, stdout: '', stderr: '' });

/** A fresh project whose config names the Roadmap and `local` as the tracker. */
function plantCase(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), `tracker:\n  default: local\nroadmap:\n  issue: ${String(ROADMAP)}\n`);
}

/** Dispatches `words` from a fresh project over the planted `gh`, answering the outcome and the `gh` calls. */
async function run(words: readonly string[], planted: Planted = {}) {
  const calls: string[][] = [];
  const seams = { gh: plantedGh(calls, planted), git: plantedGit, planNames: () => () => [], terminalWidth: () => undefined };
  const project = plantCase();
  if (planted.position !== undefined) writePositionFile(project.root, positionAt(planted.position));
  const outcome = await dispatchInProject(words, [EPIC_SUBJECT], [createEpicShowCommand(seams)], project);
  return { ...outcome, calls };
}

/** Every `#<n>` the text names, in the order it names them, deduped. */
function issuesNamed(text: string): readonly number[] {
  return [...new Set([...text.matchAll(/#(\d+)/gu)].map((match) => Number(match[1])))];
}

/** How many calls were the board listing: an `issue list` with no title search and no label filter. */
function listings(calls: readonly string[][]): number {
  return calls.filter((call) => call[0] === 'issue' && call[1] === 'list' && !call.includes('--search') && !call.includes('--label')).length;
}

/** The board as `BoardIssue`s, read as the listing reads them. */
function boardIssues(): readonly BoardIssue[] {
  return BOARD.map((raw) => {
    const issue = raw as { number: number; title: string; body: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null; labels: { name: string }[] };
    const labels = issue.labels.map((label) => label.name);
    return { ...issue, labels, type: typeOfLabels(labels), module: null } as unknown as BoardIssue;
  });
}

/** A roadmap line naming `issue`. */
function line(issue: number, ticked = false): RoadmapLine {
  return { issue, ticked, why: '', lineNumber: issue };
}

describe('readEpicArgument', () => {
  it('reads no word as no epic, and a whole number from 1 as that epic', () => {
    expect(readEpicArgument([])).toBeNull();
    expect(readEpicArgument(['252'])).toBe(252);
  });

  it.each([[['0']], [['07']], [['#5']], [['five']], [['5', '6']]])('refuses %j with exit code 1 naming the usage', (args) => {
    expect(() => readEpicArgument(args)).toThrow('Usage: rafa epics [<n>]');
  });
});

describe('firstNowEpic', () => {
  const epics = readEpics({ issues: boardIssues(), claims: new Set(), today: new Date('2026-09-15') });

  it('passes a next epic and a done one, and answers the first open now epic not done, in roadmap order', () => {
    expect(firstNowEpic([line(80), line(70), line(50), line(60)], boardIssues(), epics)?.number).toBe(50);
    expect(firstNowEpic([line(60), line(50)], boardIssues(), epics)?.number).toBe(60);
  });

  it('passes a ticked line and a line naming no epic, and answers null when nothing is left', () => {
    expect(firstNowEpic([line(51), line(50, true), line(60)], boardIssues(), epics)?.number).toBe(60);
    expect(firstNowEpic([line(80), line(70), line(51)], boardIssues(), epics)).toBeNull();
  });
});

describe('isProblemOf', () => {
  const [alpha] = readEpics({ issues: boardIssues(), claims: new Set(), today: new Date('2026-09-15') }).epics;

  it.each<[EpicProblem, boolean]>([
    [{ kind: 'unlisted-member', issue: 54, slug: 'alpha', epic: 50 }, true],
    [{ kind: 'unlisted-member', issue: 64, slug: 'beta', epic: 60 }, false],
    [{ kind: 'unlabelled-checklist', issue: 55, slug: 'alpha', epic: 50, lineNumber: 3 }, true],
    [{ kind: 'horizon', issue: 50, slug: 'alpha', horizons: [] }, true],
    [{ kind: 'horizon', issue: 60, slug: 'beta', horizons: [] }, false],
    [{ kind: 'several-epic-labels', issue: 56, slug: 'beta', slugs: ['beta', 'alpha'] }, true],
    [{ kind: 'several-epic-labels', issue: 57, slug: 'beta', slugs: ['beta', 'gamma'] }, false],
    [{ kind: 'orphan-label', issue: 58, slug: 'alpah' }, false],
  ])('reads %j as about epic #50: %p', (problem, expected) => {
    expect(alpha?.number).toBe(50);
    expect(alpha === undefined
      ? null
      : isProblemOf(problem, alpha)).toBe(expected);
  });
});

describe('renderEpics', () => {
  const base: EpicsResult = { roadmap: 1, asked: null, epic: null, unknown: null, rows: [], problems: [], warnings: [] };

  it('prints the Roadmap\'s epics unknown with no number, and the epic unknown with one', () => {
    expect(renderEpics({ ...base, unknown: 'offline' })).toEqual(['Roadmap #1 · epics unknown: offline']);
    expect(renderEpics({ ...base, roadmap: null, asked: 60, unknown: 'offline' })).toEqual(['Epic #60 · unknown: offline']);
  });

  it('prints one line when no epic was chosen', () => {
    expect(renderEpics(base)).toEqual([noNowEpicLine(1)]);
  });

  it('prints the head, the disagreement indented, and No issues. for an epic with no line left', () => {
    const gamma = readEpics({ issues: boardIssues(), claims: new Set(), today: new Date('2026-09-15') }).epics
      .find((epic) => epic.number === 70);

    expect(gamma === undefined
      ? []
      : renderEpics({ ...base, epic: gamma })).toEqual([
      'Epic #70 · Epic gamma · done, 1/1 done',
      '  done, but epic #70 is still open',
      'No issues.',
    ]);
    expect(gamma === undefined
      ? ''
      : epicHead(gamma)).toBe('Epic #70 · Epic gamma · done, 1/1 done');
  });
});

describe('rafa epics, dispatched', () => {
  it('runs as rafa epic show, rafa epic and rafa epics alike, printing no deprecation line for any', async () => {
    const plural = await run(['epics', '60']);
    const canonical = await run(['epic', 'show', '60']);
    const subject = await run(['epic', '60']);

    expect(plural.exitCode).toBe(0);
    expect(plural.stdout.split('\n')[0]).toBe('Epic #60 · Epic beta · backlog, 0/2 done');
    expect(plural.stderr).toBe('');
    expect(canonical).toEqual(plural);
    expect(subject).toEqual(plural);
  });

  it('prints the first now epic not done, its unticked checklist then its label-only member, from one listing', async () => {
    const outcome = await run(['epics']);
    const [warning, ...lines] = outcome.stdout.split('\n');

    expect(outcome.exitCode).toBe(0);
    expect(warning).toStartWith('warn: #54 carries epic:alpha but is not on epic #50\'s checklist');
    expect(lines[0]).toBe('Epic #50 · Epic alpha · in-progress, 1/4 done');
    expect(lines.slice(2)
      .filter((text) => text.startsWith('#'))
      .map((text) => text.split(' ')[0])).toEqual(['#51', '#53', '#54']);
    expect(listings(outcome.calls)).toBe(1);
    // The Roadmap is the default board, found after one type:roadmap listing.
    expect(outcome.calls.filter((call) => call.includes('--label'))).toEqual([[...BOARDS_LIST_ARGS]]);
  });

  it('names no issue of another epic, the control being the other epic\'s own reading', async () => {
    const alpha = await run(['epics', '50']);
    const beta = await run(['epics', '60']);

    expect(issuesNamed(alpha.stdout + alpha.stderr).filter((issue) => issue >= 60)).toEqual([]);
    expect(issuesNamed(beta.stdout + beta.stderr)).toEqual([60, 61, 62]);
    expect(alpha.stdout).toContain('Epic #50 · Epic alpha');
    expect(beta.stdout.split('\n')[0]).toBe('Epic #60 · Epic beta · backlog, 0/2 done');
  });

  it('reads no Roadmap for a numbered epic, whatever its horizon', async () => {
    const outcome = await run(['epics', '80']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe('Epic #80 · Epic delta · empty, 0/0 done\nNo issues.\n');
    expect(outcome.calls.filter((call) => call[1] === 'view')).toEqual([]);
  });

  it('prints a done epic\'s disagreement under its head', async () => {
    const outcome = await run(['epics', '70']);

    expect(outcome.stdout.split('\n').slice(0, 2)).toEqual(['Epic #70 · Epic gamma · done, 1/1 done', '  done, but epic #70 is still open']);
  });

  it('prints one line and exits 0 when the Roadmap names no now epic that is not done', async () => {
    const outcome = await run(['epics'], { roadmapBody: '- [ ] #80\n- [ ] #70\n- [ ] #51\n' });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(`${noNowEpicLine(ROADMAP)}\n`);
  });

  it('prints the epic unknown with the listing\'s reason, never backlog, and asks for no pull request', async () => {
    const numbered = await run(['epics', '60'], { failListing: true });
    const bare = await run(['epics'], { failListing: true });

    expect(numbered.exitCode).toBe(0);
    expect(numbered.stdout).toStartWith('Epic #60 · unknown: ');
    expect(numbered.stdout).toContain('error connecting to api.github.com');
    expect(numbered.stdout).not.toContain('backlog');
    expect(bare.stdout).toStartWith(`Roadmap #${String(ROADMAP)} · epics unknown: `);
    expect([...numbered.calls, ...bare.calls].filter((call) => call[0] === 'pr')).toEqual([]);
  });

  it.each([
    [['epics', '51'], '#51 is not an epic: it does not carry type:epic'],
    [['epics', '999'], '#999 is not on the board listing'],
  ])('refuses %j with exit code 1', async (words, message) => {
    const outcome = await run(words);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(message);
  });

  it('refuses a word that is no number before any gh call', async () => {
    const outcome = await run(['epics', 'alpha']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.calls).toEqual([]);
  });

  it('refuses a Roadmap that cannot be read with the roadmap refusal code', async () => {
    const outcome = await run(['epics'], { failRoadmap: true });

    expect(outcome.exitCode).toBe(ROADMAP_REFUSAL_EXIT);
    expect(outcome.stderr).toContain('Could not read the roadmap');
  });

  it('prints the current place\'s epic, whatever its horizon, reading no board body, the control being no position file', async () => {
    const moved = await run(['epics'], { position: { board: ROADMAP, epic: 80 } });
    const control = await run(['epics']);

    expect(moved.exitCode).toBe(0);
    expect(moved.stdout).toBe('Epic #80 · Epic delta · empty, 0/0 done\nNo issues.\n');
    expect(moved.calls.filter((call) => call[1] === 'view')).toEqual([]);
    expect(listings(moved.calls)).toBe(1);
    expect(control.stdout).toContain('Epic #50 · Epic alpha');
  });

  it('takes the first now epic not done on the current place\'s board when the place names a board alone', async () => {
    const moved = await run(['epics', '--output=json'], { second: 'OPEN', position: { board: SECOND, epic: null } });
    const control = await run(['epics', '--output=json'], { second: 'OPEN' });
    const data = (text: string): EpicsResult | undefined => (eventsOf(text).find((event) => event.type === 'result') as { data?: EpicsResult } | undefined)?.data;

    expect(data(moved.stdout)?.roadmap).toBe(SECOND);
    expect(data(moved.stdout)?.epic?.number).toBe(60);
    expect(moved.calls.filter((call) => call[1] === 'view').map((call) => call[2])).toEqual([String(SECOND)]);
    expect(listings(moved.calls)).toBe(1);
    expect(data(control.stdout)?.roadmap).toBe(ROADMAP);
    expect(data(control.stdout)?.epic?.number).toBe(50);
  });

  it('keeps an explicit number over the current place', async () => {
    const outcome = await run(['epics', '60'], { position: { board: ROADMAP, epic: 80 } });

    expect(outcome.stdout.split('\n')[0]).toBe('Epic #60 · Epic beta · backlog, 0/2 done');
  });

  it('warns a lost place and falls back to the default board\'s first now epic', async () => {
    const outcome = await run(['epics'], { second: 'CLOSED', position: { board: SECOND, epic: 60 } });
    const [warning, ...lines] = outcome.stdout.split('\n');

    expect(outcome.exitCode).toBe(0);
    expect(warning).toStartWith(`warn: The current place and home lost board #${String(SECOND)}, which is closed;`);
    expect(lines.find((text) => text.startsWith('Epic #'))).toBe('Epic #50 · Epic alpha · in-progress, 1/4 done');
  });

  it('warns that the position was not weighed when the listing fails, and prints the default board\'s epics unknown', async () => {
    const outcome = await run(['epics'], { failListing: true, position: { board: ROADMAP, epic: 60 } });

    expect(outcome.exitCode).toBe(0);
    const [warning, unknown] = outcome.stdout.split('\n');

    expect(warning).toBe(`warn: ${unweighedPositionNotice(ROADMAP)}`);
    expect(unknown).toStartWith(`Roadmap #${String(ROADMAP)} · epics unknown: `);
    expect(unknown).toContain('error connecting to api.github.com');
  });

  it('gives the epic, its rows and its problems as the result data in json mode', async () => {
    const events = eventsOf((await run(['epics', '50', '--output=json'])).stdout);
    const result = events.find((event) => event.type === 'result') as { data?: EpicsResult } | undefined;

    expect(result?.data?.epic?.number).toBe(50);
    expect(result?.data?.rows.map((row) => row.line.issue)).toEqual([51, 53, 54]);
    expect(result?.data?.problems.map((problem) => problem.kind)).toEqual(['unlisted-member']);
    expect(events.some((event) => event.type === 'log' && event.level === 'warn')).toBe(true);
  });

  it('is epic show, aliased epic for good, declaring no spends, one optional argument and no flag', () => {
    const command = createEpicShowCommand();

    expect([command.subject, command.action, command.spends, command.flags]).toEqual(['epic', 'show', undefined, []]);
    expect([command.aliases, command.lastingAliases]).toEqual([['epic'], ['epic']]);
    expect(command.args.map((arg) => [arg.name, arg.required])).toEqual([['n', false]]);
  });
});

describe('rafa epics, with an epic closed as not planned', () => {
  /** Epic #40 closed as not planned, its open member #41, and #43, in no epic, waiting on #41. */
  const CANCELLED = [
    { ...boardIssue(40, 'Epic omega', 'Omega.', 'CLOSED', ['type:epic', 'epic:omega', 'horizon:now']), stateReason: 'NOT_PLANNED' },
    boardIssue(41, 'Omega one', 'Open still.', 'OPEN', ['epic:omega']),
    boardIssue(43, 'Waiting', 'Prose.\n\nBlocked by: #41\n', 'OPEN', []),
  ];
  const NOTICE = renderCancelledEpicNotice({ epic: 40, dependents: [43] });

  it('warns the notice last, over the one listing, whichever epic is shown', async () => {
    const outcome = await run(['epics', '60'], { extra: CANCELLED });
    const lines = outcome.stdout.split('\n');

    expect(outcome.exitCode).toBe(0);
    expect(lines[0]).toBe(`warn: ${NOTICE}`);
    expect(lines[1]).toBe('Epic #60 · Epic beta · backlog, 0/2 done');
    expect(listings(outcome.calls)).toBe(1);
  });

  it('writes no notice line when no epic is cancelled (control)', async () => {
    const outcome = await run(['epics', '60']);

    expect(outcome.stdout).not.toContain('closed as not planned');
    expect(outcome.stdout.split('\n')[0]).toBe('Epic #60 · Epic beta · backlog, 0/2 done');
  });

  it('warns it when no now epic is left to show, too', async () => {
    const outcome = await run(['epics'], { extra: CANCELLED, roadmapBody: '- [ ] #80 — later work\n' });

    expect(outcome.stdout.split('\n')).toEqual([`warn: ${NOTICE}`, noNowEpicLine(ROADMAP), '']);
  });

  it('carries it among the json warnings', async () => {
    const outcome = await run(['epics', '60', '--output=json'], { extra: CANCELLED });
    const result = eventsOf(outcome.stdout).find((event) => event.type === 'result') as { data: EpicsResult } | undefined;

    expect(result?.data.warnings).toEqual([NOTICE]);
  });
});
