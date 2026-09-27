/**
 * Tests for `rafa epics` (`epics.ts`): the pure pieces — the argument,
 * the choice of the first `now` epic, the problems kept for one epic and
 * the lines written — and the command dispatched over one planted `gh`
 * and `git` holding four epics.
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
 */
import type { EpicsResult } from './epics.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { EpicProblem } from '../board/epic-problems.js';
import type { BoardIssue } from '../board/roadmap-board.js';
import type { RoadmapLine } from '../board/roadmap.js';
import type { GitRunner } from '../pr/git.js';
import type { PlantedProject } from '../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { BOARDS_LIST_ARGS } from '../board/boards.js';
import { readEpics } from '../board/epics.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { ROADMAP_REFUSAL_EXIT } from '../board/roadmap.js';
import { dispatchInProject, eventsOf, plantProject } from '../tests/cli-capture.js';
import { completeSpecBody } from '../tests/spec-bodies.js';

import {
  createEpicsCommand,
  epicHead,
  firstNowEpic,
  isProblemOf,
  noNowEpicLine,
  readEpicArgument,
  renderEpics,
} from './epics.js';

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

/** How the planted `gh` answers. */
interface Planted {
  readonly roadmapBody?: string;
  readonly failListing?: boolean;
  readonly failRoadmap?: boolean;
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
  return (args) => {
    calls.push([...args]);
    const [noun, verb] = args;
    if (noun === 'issue' && verb === 'view') {
      return Promise.resolve(planted.failRoadmap === true
        ? failed('could not resolve to an issue')
        : ok(roadmap));
    }
    // No issue carries type:roadmap, so the label listing answers empty
    // and roadmap.issue decides, as before.
    if (noun === 'issue' && verb === 'list' && args.includes('--label')) return Promise.resolve(ok('[]'));
    if (noun === 'issue' && verb === 'list') {
      return Promise.resolve(planted.failListing === true
        ? failed('error connecting to api.github.com')
        : ok(JSON.stringify(BOARD)));
    }
    if (noun === 'pr' && verb === 'list') return Promise.resolve(ok('[]'));
    return Promise.resolve(failed(`unplanted: gh ${args.join(' ')}`));
  };
}

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
  const outcome = await dispatchInProject(words, [], [createEpicsCommand(seams)], plantCase());
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

  it('gives the epic, its rows and its problems as the result data in json mode', async () => {
    const events = eventsOf((await run(['epics', '50', '--output=json'])).stdout);
    const result = events.find((event) => event.type === 'result') as { data?: EpicsResult } | undefined;

    expect(result?.data?.epic?.number).toBe(50);
    expect(result?.data?.rows.map((row) => row.line.issue)).toEqual([51, 53, 54]);
    expect(result?.data?.problems.map((problem) => problem.kind)).toEqual(['unlisted-member']);
    expect(events.some((event) => event.type === 'log' && event.level === 'warn')).toBe(true);
  });

  it('is a top-level command declaring no spends, one optional argument and no flag', () => {
    const command = createEpicsCommand();

    expect([command.subject, command.action, command.spends, command.flags]).toEqual(['epics', 'epics', undefined, []]);
    expect(command.args.map((arg) => [arg.name, arg.required])).toEqual([['n', false]]);
  });
});
