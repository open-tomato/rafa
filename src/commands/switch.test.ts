/**
 * Tests for `rafa switch` (`switch.ts`): the line's target and flag,
 * then the command dispatched over one planted `gh` answering the board
 * listing and the title search, from a fresh project whose position file
 * a case plants or leaves out.
 *
 * The board: three open `type:roadmap` boards, #31 (the default, being
 * the lowest-numbered labelled one), #40 and #45, and a closed one, #41.
 * #31 lists epics #50 and #60; #40 lists #80, #50 and #85; #45 lists
 * #85. #90 is an epic no board lists, #95 a closed epic, #7 a plain
 * issue. Every epic is `now` and in progress, so a board lands on the
 * first epic its checklist names.
 *
 * Each case reads the position file back rather than trusting the
 * printed line alone, and each refusal is held to have written no file,
 * so a refusal that wrote first and threw after could not pass. The
 * one-listing case holds the listing count at exactly one, so a filter
 * that matched no call, reading zero, fails it as a second listing does.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BoardIssue } from '../board/roadmap-board.js';
import type { GitRunner } from '../pr/git.js';
import type { Place, Position } from '../project/position.js';
import type { PlantedProject } from '../tests/cli-capture.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { readEpics } from '../board/epics.js';
import { positionFilePath, readPositionFile, writePositionFile } from '../project/position.js';
import { dispatchInProject, eventsOf, plantProject } from '../tests/cli-capture.js';

import {
  createSwitchCommand,
  kindOf,
  placeLine,
  readRehome,
  readSwitchTarget,
  SWITCH_REFUSAL_EXIT,
} from './switch.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-switch-')));

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

/** A checklist naming `issues`, unticked. */
function checklist(...issues: readonly number[]): string {
  return issues.map((number) => `- [ ] #${String(number)}`).join('\n');
}

const BOARD_LABELS = ['type:roadmap'];

/** An epic labelled `now` with slug `slug`. */
function epic(number: number, title: string, slug: string, state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  return raw(number, title, '## Acceptance criteria\n\nWorks.\n', ['type:epic', `epic:${slug}`, 'horizon:now'], state);
}

/** One open and one closed member of epic `slug`, numbered from `from`. */
function members(from: number, slug: string): object[] {
  return [
    raw(from, `${slug} one`, 'Open.', [`epic:${slug}`]),
    raw(from + 1, `${slug} two`, 'Done.', [`epic:${slug}`], 'CLOSED'),
  ];
}

/** The board the module note describes. */
const LISTING: readonly object[] = [
  raw(7, 'A plain issue', 'Nothing.', ['type:bug']),
  raw(31, 'Platform board', checklist(50, 60), BOARD_LABELS),
  raw(40, 'Payments board', checklist(80, 50, 85), BOARD_LABELS),
  raw(41, 'Old board', checklist(50), BOARD_LABELS, 'CLOSED'),
  raw(45, 'Growth board', checklist(85), BOARD_LABELS),
  epic(50, 'Epic alpha', 'alpha'),
  ...members(51, 'alpha'),
  epic(60, 'Epic beta', 'beta'),
  ...members(61, 'beta'),
  epic(80, 'Epic delta', 'delta'),
  ...members(81, 'delta'),
  epic(85, 'Epic kappa', 'kappa'),
  ...members(86, 'kappa'),
  epic(90, 'Epic stray', 'stray'),
  ...members(91, 'stray'),
  epic(95, 'Epic gone', 'gone', 'CLOSED'),
];

/** How the planted `gh` answers. */
interface Planted {
  readonly listing?: readonly object[];
  readonly search?: readonly object[];
  readonly failListing?: boolean;
}

/** A `gh` answering the board listing and the title search, recording each call. */
function plantedGh(calls: string[][], planted: Planted): GhRunner {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const failed = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });
  return (args) => {
    calls.push([...args]);
    const [noun, verb] = args;
    if (noun === 'issue' && verb === 'list' && args.includes('--search')) {
      return Promise.resolve(ok(JSON.stringify(planted.search ?? [])));
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

/** A place. */
function at(board: number, epicNumber: number | null): Place {
  return { board, epic: epicNumber };
}

/** A `git` whose branch reads answer `refs` on both sides, recording each call. */
function plantedGit(calls: string[][], refs: readonly string[] = []): GitRunner {
  return (args) => {
    calls.push([...args]);
    const [verb] = args;
    if (verb === 'for-each-ref') return { ok: true, stdout: refs.join('\n'), stderr: '' };
    if (verb === 'ls-remote') return { ok: true, stdout: '', stderr: '' };
    return { ok: false, stdout: '', stderr: `unplanted: git ${args.join(' ')}` };
  };
}

/**
 * Dispatches `words` from `project` over the planted `gh` and `git`
 * (branches `refs`), answering the outcome and the calls of each.
 */
async function run(words: readonly string[], project: PlantedProject = plantCase(), planted: Planted = {}, refs: readonly string[] = []) {
  const calls: string[][] = [];
  const gitCalls: string[][] = [];
  const seams = { gh: plantedGh(calls, planted), git: plantedGit(gitCalls, refs) };
  const outcome = await dispatchInProject(['switch', ...words], [], [createSwitchCommand(seams)], project);
  return { ...outcome, calls, gitCalls, project };
}

/** The position `project` holds, or null when its file reads unset. */
function positionOf(project: PlantedProject): Position | null {
  const reading = readPositionFile(project.root);
  return reading.set
    ? reading.position
    : null;
}

/** The listing as `BoardIssue`s, read as the listing reads them. */
function boardIssues(listing: readonly object[] = LISTING): readonly BoardIssue[] {
  return listing.map((row) => {
    const issue = row as { number: number; title: string; body: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null; labels: { name: string }[] };
    const labels = issue.labels.map((label) => label.name);
    return { ...issue, labels, type: typeOfLabels(labels), module: 'unassigned' };
  });
}

/** The pure pieces' view of the board, the default answered as `fallback`. */
function switchBoard(fallback = 31, configured: number | null = null) {
  const listing = boardIssues();
  return {
    listing,
    rows: new Map(listing.map((issue) => [issue.number, issue])),
    configured,
    defaultBoard: () => Promise.resolve(fallback),
  };
}

describe('readSwitchTarget', () => {
  it('reads a whole number from 1 as that number, and - as the previous place', () => {
    expect(readSwitchTarget(['252'])).toEqual({ kind: 'number', number: 252 });
    expect(readSwitchTarget(['-'])).toEqual({ kind: 'back' });
  });

  it.each([[[]], [['0']], [['07']], [['#5']], [['five']], [['--']], [['5', '6']]])('refuses %j with exit code 1 naming the usage', (args) => {
    expect(() => readSwitchTarget(args)).toThrow('Usage: rafa switch <n | -> [--no-rehome]');
  });
});

describe('readRehome', () => {
  it('re-homes unless --no-rehome, and refuses a value read into the flag', () => {
    expect(readRehome({})).toBe(true);
    expect(readRehome({ rehome: true })).toBe(true);
    expect(readRehome({ rehome: false })).toBe(false);
    expect(() => readRehome({ rehome: '31' })).toThrow('--rehome takes no value');
  });
});

describe('kindOf', () => {
  it('reads a labelled row as a board and an epic-typed row as an epic, asking no default for either', async () => {
    let asked = 0;
    const board = { ...switchBoard(), defaultBoard: () => { asked += 1; return Promise.resolve(31); } };

    expect(await kindOf(40, board)).toEqual({ kind: 'board' });
    expect(await kindOf(80, board)).toEqual({ kind: 'epic' });
    expect(asked).toBe(0);
  });

  it('reads an unlabelled row as a board only when it is the default board', async () => {
    expect(await kindOf(7, switchBoard(7))).toEqual({ kind: 'board' });
    expect(await kindOf(7, switchBoard(31))).toEqual({ why: '#7 is neither a board nor an epic: it carries neither type:roadmap nor type:epic' });
  });

  it('reads a number off the listing as a board only when roadmap.issue names it', async () => {
    expect(await kindOf(500, switchBoard(31, 500))).toEqual({ kind: 'board' });
    expect(await kindOf(500, switchBoard())).toEqual({ why: '#500 is not on the board listing, so it is no board and no epic' });
  });

  it('refuses a closed board and a closed epic, naming which', async () => {
    expect(await kindOf(41, switchBoard())).toEqual({ why: '#41 is a closed board' });
    expect(await kindOf(95, switchBoard())).toEqual({ why: '#95 is a closed epic' });
  });
});

describe('placeLine', () => {
  const epics = readEpics({ issues: boardIssues(), claims: new Set(), today: new Date('2026-09-28') });

  it('names the board, the epic with its title and horizon, and its progress', () => {
    expect(placeLine(at(40, 80), switchBoard(), epics)).toBe('board #40 · epic #80 Epic delta (now) · 1/2 done');
  });

  it('names a board with no epic', () => {
    expect(placeLine(at(31, null), switchBoard(), epics)).toBe('board #31 · no epic');
  });
});

describe('rafa switch <n>', () => {
  it('moves to a board at its first now epic, re-homes, and keeps where it stood as previous', async () => {
    const result = await run(['40']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('board #40 · epic #80 Epic delta (now) · 1/2 done\n');
    expect(result.stderr).toBe('');
    expect(positionOf(result.project)).toEqual({ current: at(40, 80), previous: at(31, 50), home: at(40, 80) });
  });

  it('moves to an epic and the board its checklist lists it on', async () => {
    const result = await run(['85']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('board #40 · epic #85 Epic kappa (now) · 1/2 done\n');
    expect(positionOf(result.project)?.current).toEqual(at(40, 85));
  });

  it('moves an epic from the current board when it lists it, over the default', async () => {
    const project = plantCase();
    writePositionFile(project.root, { current: at(40, 80), previous: null, home: at(40, 80) });

    const result = await run(['50'], project);

    expect(positionOf(project)).toEqual({ current: at(40, 50), previous: at(40, 80), home: at(40, 50) });
    expect(result.exitCode).toBe(0);
  });

  it('keeps home under --no-rehome', async () => {
    const result = await run(['40', '--no-rehome']);

    expect(result.exitCode).toBe(0);
    expect(positionOf(result.project)).toEqual({ current: at(40, 80), previous: at(31, 50), home: at(31, 50) });
  });

  it('reads the board listing once and never the label listing', async () => {
    const result = await run(['80']);
    const listings = result.calls.filter((call) => call[0] === 'issue' && call[1] === 'list' && call.includes('all'));

    expect(result.exitCode).toBe(0);
    expect(listings).toHaveLength(1);
    expect(result.calls.filter((call) => call.includes('--label'))).toEqual([]);
  });

  it('gives the new places as the json result', async () => {
    const result = await run(['40', '--no-rehome', '--output=json']);
    const data = eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: unknown } | undefined;

    expect(result.exitCode).toBe(0);
    expect(data?.data).toEqual({
      asked: 'board',
      current: at(40, 80),
      previous: at(31, 50),
      home: at(31, 50),
      rehomed: false,
      line: 'board #40 · epic #80 Epic delta (now) · 1/2 done',
    });
  });

  it('takes an unlabelled issue titled Roadmap as the board where nothing is labelled', async () => {
    const listing = [raw(1, 'Roadmap', checklist(50), []), epic(50, 'Epic alpha', 'alpha'), ...members(51, 'alpha')];
    const result = await run(['1'], plantCase(), { listing, search: [{ number: 1, title: 'Roadmap' }] });

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(positionOf(result.project)?.current).toEqual(at(1, 50));
  });

  it('warns that a lost current place fell back, and moves from the fallback', async () => {
    const project = plantCase();
    writePositionFile(project.root, { current: at(41, null), previous: null, home: at(41, null) });

    const result = await run(['80'], project);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith('warn: The current place and home lost board #41, which is closed; falling back to the default board #31 at epic #50\n');
    expect(result.stdout).toEndWith('board #40 · epic #80 Epic delta (now) · 1/2 done\n');
    expect(positionOf(project)?.previous).toEqual(at(31, 50));
  });

  it.each([
    ['999', '#999 is not on the board listing'],
    ['7', '#7 is neither a board nor an epic'],
    ['41', '#41 is a closed board'],
    ['95', '#95 is a closed epic'],
  ])('refuses %s with exit code 2, writing nothing', async (word, why) => {
    const result = await run([word]);

    expect(result.exitCode).toBe(SWITCH_REFUSAL_EXIT);
    expect(result.stderr).toContain(`Cannot switch to #${word}: ${why}`);
    expect(existsSync(positionFilePath(result.project.root))).toBe(false);
  });

  it('refuses with exit code 2 when the board listing cannot be read', async () => {
    const result = await run(['40'], plantCase(), { failListing: true });

    expect(result.exitCode).toBe(SWITCH_REFUSAL_EXIT);
    expect(result.stderr).toContain('Could not read the board');
    expect(existsSync(positionFilePath(result.project.root))).toBe(false);
  });

  it('refuses a line with no target with exit code 1, reading nothing', async () => {
    const result = await run([]);

    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
});

describe('rafa switch -', () => {
  it('goes back to the previous place and re-homes there', async () => {
    const project = plantCase();
    await run(['40'], project);

    const back = await run(['-'], project);

    expect(back.exitCode).toBe(0);
    expect(back.stdout).toBe('board #31 · epic #50 Epic alpha (now) · 1/2 done\n');
    expect(positionOf(project)).toEqual({ current: at(31, 50), previous: at(40, 80), home: at(31, 50) });
  });

  it('keeps home under --no-rehome', async () => {
    const project = plantCase();
    await run(['40'], project);

    await run(['-', '--no-rehome'], project);

    expect(positionOf(project)).toEqual({ current: at(31, 50), previous: at(40, 80), home: at(40, 80) });
  });

  it('refuses with exit code 2 with no position file, writing none', async () => {
    const result = await run(['-']);

    expect(result.exitCode).toBe(SWITCH_REFUSAL_EXIT);
    expect(result.stderr).toContain('There is no previous place to go back to: there is no position at');
    expect(existsSync(positionFilePath(result.project.root))).toBe(false);
  });

  it('refuses with exit code 2 when the position holds no previous place, leaving the file as it was', async () => {
    const project = plantCase();
    const planted = { current: at(40, 80), previous: null, home: at(40, 80) };
    writePositionFile(project.root, planted);

    const result = await run(['-'], project);

    expect(result.exitCode).toBe(SWITCH_REFUSAL_EXIT);
    expect(result.stderr).toContain('this checkout has not moved since it was placed');
    expect(positionOf(project)).toEqual(planted);
  });

  it('refuses with exit code 2 a previous place whose board has closed since, naming it', async () => {
    const project = plantCase();
    const planted = { current: at(40, 80), previous: at(41, null), home: at(40, 80) };
    writePositionFile(project.root, planted);

    const result = await run(['-'], project);

    expect(result.exitCode).toBe(SWITCH_REFUSAL_EXIT);
    expect(result.stderr).toContain('The previous place, board #41, no longer stands: #41 is a closed board');
    expect(positionOf(project)).toEqual(planted);
  });
});

describe('the drift report', () => {
  /** {@link LISTING} with #31's line for #50 ticked while #51 still carries rafa:in-development, and #7 rafa:claimed. */
  const DRIFTED = [
    ...LISTING.filter((row) => ![7, 31].includes((row as { number: number }).number)),
    raw(7, 'A plain issue', 'Nothing.', ['type:bug', 'rafa:claimed']),
    raw(31, 'Platform board', '- [ ] #50\n- [x] #51\n- [ ] #60', BOARD_LABELS),
  ];

  it('warns each drift line ahead of the new place, exiting 0 with the position written', async () => {
    const result = await run(['40'], plantCase(), { listing: DRIFTED });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe([
      'warn: claim drift: #7 is labelled rafa:claimed (open) but no feat/rafa-7-* claim branch names it',
      'board #40 · epic #80 Epic delta (now) · 1/2 done',
      '',
    ].join('\n'));
    expect(positionOf(result.project)?.current).toEqual(at(40, 80));
  });

  it('reports a ticked line still labelled, and nothing once a branch names the labelled issue', async () => {
    const listing = DRIFTED.map((row) => (row as { number: number }).number === 51
      ? raw(51, 'alpha one', 'Open.', ['epic:alpha', 'rafa:in-development'])
      : row);

    const drifted = await run(['40'], plantCase(), { listing });
    const branched = await run(['40'], plantCase(), { listing: DRIFTED }, ['refs/heads/feat/rafa-7-x']);

    expect(drifted.stdout).toContain('warn: claim drift: #51 is ticked on #31 (line 2) but still labelled rafa:in-development (open)\n');
    expect(branched.stdout).not.toContain('claim drift');
    expect(branched.exitCode).toBe(0);
  });

  it('reads no branch when no issue carries a stage label, where a labelled board reads them', async () => {
    const clean = await run(['40']);
    const labelled = await run(['40'], plantCase(), { listing: DRIFTED });

    expect(clean.stdout).not.toContain('claim drift');
    expect(clean.gitCalls).toEqual([]);
    expect(labelled.gitCalls.map((call) => call[0])).toEqual(['for-each-ref', 'ls-remote']);
  });

  it('reads the board listing once and sends gh nothing but reads, the drift report included', async () => {
    const result = await run(['40'], plantCase(), { listing: DRIFTED });

    const listings = result.calls.filter((call) => call[0] === 'issue' && call[1] === 'list' && call.includes('all'));

    expect(result.stdout).toContain('claim drift');
    expect(listings).toHaveLength(1);
    expect(result.calls.filter((call) => !(call[0] === 'issue' && call[1] === 'list'))).toEqual([]);
  });

  it('reports no drift for a refused switch, reading no branch', async () => {
    const result = await run(['41'], plantCase(), { listing: DRIFTED });

    expect(result.exitCode).toBe(SWITCH_REFUSAL_EXIT);
    expect(result.stdout).not.toContain('claim drift');
    expect(result.gitCalls).toEqual([]);
  });

  it('keeps the json result terminal, the drift lines as warnings ahead of it', async () => {
    const result = await run(['40', '--output=json'], plantCase(), { listing: DRIFTED });
    const events = eventsOf(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(events.at(-1)?.type).toBe('result');
    expect(JSON.stringify(events.slice(0, -1))).toContain('claim drift: #7 is labelled rafa:claimed');
  });
});
