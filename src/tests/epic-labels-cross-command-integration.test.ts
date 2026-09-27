/**
 * An integration suite over ONE fixture board, dispatched through three
 * real commands: `rafa issue ready`, `rafa doctor` and `rafa roadmap`.
 *
 * `src/tests/epics-board-integration.test.ts` already walks one planted
 * `gh issue list` answer through the three PURE readers
 * (`parseBoardListing`, `readEpics`, `readEpicProblems`). This file is
 * that same idea one level up: the same two faults, planted once, read
 * by the three COMMANDS a person actually runs, each dispatched for
 * real over a planted `gh`, so a fix that keeps every unit suite green
 * but drops the wiring between a command and `readEpicProblems`
 * (`src/board/epic-problems.ts`) would still show here.
 *
 * The fixture: two epics, `epic:auth` (#1) and `epic:billing` (#2), each
 * with its own `horizon:` label and a checklist naming #5, its one
 * member. #5 carries BOTH `epic:auth` and `epic:billing` — an issue
 * belongs to one epic — and #6 carries `epic:atuh`, a slug typoed from
 * `auth` that no `type:epic` issue owns. Every other label on the board
 * reads clean, so `readEpicProblems` answers exactly these two:
 * `several-epic-labels` on #5, `orphan-label` on #6.
 *
 * Three cases, none reaching GitHub or spawning `gh` or `git`:
 *
 *  - `rafa issue ready 5` refuses with exit 2, naming both labels #5
 *    carries, before a prompter could ever be opened;
 *  - `rafa doctor` lists both faults under `Epic labels:`, in the
 *    reader's own words;
 *  - `rafa roadmap`, whose Roadmap checklist names the epic #1 so its
 *    epic table is shown, warns about both faults, in the same words.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { DoctorSeams } from '../commands/doctor.js';
import type { GitRunner } from '../pr/git.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BOARD_LIST_FIELDS } from '../board/roadmap-board.js';
import { EPICS_HEADING } from '../commands/doctor-epics.js';
import { createDoctorCommand } from '../commands/doctor.js';
import { createIssueReadyCommand } from '../commands/issue/ready.js';
import { createRoadmapCommand } from '../commands/roadmap.js';

import { dispatchInProject, plantProject } from './cli-capture.js';
import { completeSpecBody } from './spec-bodies.js';

/** A temporary directory of this file's own, for every project it plants. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-labels-cross-command-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The Roadmap issue every case's `gh` answers `issue view` for. */
const ROADMAP = 100;

/** The Roadmap's body: one line naming the epic, so its table is shown; the other two, its members. */
const ROADMAP_BODY = '- [ ] #1\n- [ ] #5\n- [ ] #6\n';

/** One issue on the fixture board. */
interface FixtureIssue {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

/** The two epics and their two faulted members: the one board every case here reads. */
const ISSUES: Readonly<Record<number, FixtureIssue>> = Object.freeze({
  1: { title: 'Auth epic', body: '- [ ] #5\n', labels: ['type:epic', 'epic:auth', 'horizon:now'] },
  2: { title: 'Billing epic', body: '- [ ] #5\n', labels: ['type:epic', 'epic:billing', 'horizon:next'] },
  5: { title: 'Two epics spec', body: completeSpecBody('Carries two epic labels'), labels: ['type:spec', 'epic:auth', 'epic:billing'] },
  6: { title: 'Mistyped slug spec', body: '', labels: ['type:spec', 'epic:atuh'] },
});

/** The sentences `epicProblemMessage` gives the two faults on this board. */
const SEVERAL_EPIC_LABELS_SENTENCE = '#5 carries 2 epic labels (epic:auth, epic:billing); an issue belongs to one epic, so remove all but one';
const ORPHAN_LABEL_SENTENCE = '#6 carries epic:atuh, which no type:epic issue carries; fix the slug or open the epic';

/** One issue as `gh issue list --json ...` answers it. */
function listedRow(number: number, issue: FixtureIssue): Record<string, unknown> {
  return { number, title: issue.title, body: issue.body, state: 'OPEN', stateReason: '', labels: issue.labels.map((name) => ({ name })) };
}

/**
 * A `gh` runner over the fixture board: `issue view` for the Roadmap and
 * for one of {@link ISSUES}, the one board listing, `octocat`'s write
 * access, an empty open-pull-request list, and every `issue edit`
 * recorded rather than sent. Every other command is refused.
 */
function fixtureGh(): { run: GhRunner; edits: () => readonly string[] } {
  const edits: string[] = [];
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });

  const run: GhRunner = (args) => {
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue view') {
      const number = Number(args[2]);
      if (number === ROADMAP) {
        return ok(JSON.stringify({ number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: { login: 'owner' } }));
      }
      const found = ISSUES[number];
      if (found === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: `no planted issue ${String(number)}` });
      return ok(JSON.stringify({
        number,
        title: found.title,
        body: found.body,
        state: 'OPEN',
        labels: found.labels.map((name) => ({ name })),
        author: { login: 'octocat' },
      }));
    }
    if (route === 'issue edit') {
      edits.push(`#${args[2] ?? ''} -${args[4] ?? ''} +${args[6] ?? ''}`);
      return ok('');
    }
    if (route === 'issue list' && args.includes(BOARD_LIST_FIELDS)) {
      return ok(JSON.stringify(Object.entries(ISSUES).map(([number, issue]) => listedRow(Number(number), issue))));
    }
    if (args[0] === 'api') {
      return args[1] === 'repos/{owner}/{repo}/collaborators/octocat/permission'
        ? ok(JSON.stringify({ permission: 'admin', role_name: 'admin' }))
        : Promise.resolve({ ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });
    }
    if (route === 'pr list') return ok('[]');
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { run, edits: () => edits };
}

/** A `git` runner answering every command with nothing, so no branch scan warns and no origin is claimed. */
const fixtureGit: GitRunner = () => ({ ok: true, stdout: '', stderr: '' });

/** A prompter no case here may open: the epic label check must refuse before any question is put. */
function unopenedPrompter(): () => Prompter {
  return (): Prompter => {
    throw new Error('a run refused before the label question must open no prompter');
  };
}

/** A project of one case's own, under this file's own temporary directory. */
function freshProject(text?: string): ReturnType<typeof plantProject> {
  return plantProject(mkdtempSync(join(tempBase, 'project-')), text);
}

describe('rafa issue ready, over the fixture board carrying two epic labels', () => {
  it('refuses #5 with exit 2, naming both labels, opening no prompter and writing nothing', async () => {
    const gh = fixtureGh();
    const command = createIssueReadyCommand({
      openGh: () => gh.run,
      openGit: () => fixtureGit,
      isTerminal: () => true,
      openPrompter: unopenedPrompter(),
    });

    const outcome = await dispatchInProject(
      ['issue', 'ready', '5', '--no-hint'],
      [{ name: 'issue', summary: 'issues' }],
      [command],
      freshProject(),
    );

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toBe(`issue #5 cannot be marked spec:ready: ${SEVERAL_EPIC_LABELS_SENTENCE}\n`);
    expect(gh.edits()).toEqual([]);
  });
});

describe('rafa doctor, over the fixture board carrying two epic labels', () => {
  it('lists the two-epic-label issue and the mistyped slug under Epic labels:', async () => {
    const gh = fixtureGh();
    const seams: DoctorSeams = {
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
      openGh: () => gh.run,
      riskRunners: () => ({
        git: () => ({ ok: false, stdout: '', stderr: 'error: No such remote \'origin\'\n' }),
        gh: () => Promise.resolve({ ok: false, stdout: '', stderr: 'gh: not planted' }),
      }),
      checks: {
        now: () => 0,
        runProbe: () => Promise.resolve({ exitCode: 0, stderr: '', timedOut: false }),
      },
    };
    const command = createDoctorCommand(seams);

    const outcome = await dispatchInProject(['doctor'], [], [command], freshProject());

    expect(outcome.exitCode).toBe(0);
    const lines = outcome.stdout.trimEnd().split('\n');
    const heading = lines.indexOf(EPICS_HEADING);
    expect(heading).toBeGreaterThan(-1);
    expect(lines.slice(heading, heading + 3)).toEqual([
      EPICS_HEADING,
      `  ${SEVERAL_EPIC_LABELS_SENTENCE}`,
      `  ${ORPHAN_LABEL_SENTENCE}`,
    ]);
  });
});

describe('rafa roadmap, over the fixture board carrying two epic labels', () => {
  it('warns about the two-epic-label issue and the mistyped slug', async () => {
    const gh = fixtureGh();
    const seams = { gh: gh.run, git: fixtureGit, planNames: () => (): readonly string[] => [], terminalWidth: () => undefined };
    const command = createRoadmapCommand(seams);
    const project = freshProject(`tracker:\n  default: local\nroadmap:\n  issue: ${String(ROADMAP)}\n`);

    const outcome = await dispatchInProject(['roadmap'], [], [command], project);

    expect(outcome.exitCode).toBe(0);
    const warnings = outcome.stdout.split('\n').filter((line) => line.startsWith('warn: '));
    expect(warnings).toEqual([
      `warn: ${SEVERAL_EPIC_LABELS_SENTENCE}`,
      `warn: ${ORPHAN_LABEL_SENTENCE}`,
    ]);
  });
});
