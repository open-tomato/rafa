/**
 * `./status.ts` dispatched in-process over a planted project: the text
 * lines written at the level `renderStatus` names, the JSON data of the
 * terminal result, and the three exit codes.
 *
 * The sections are a literal handed in through the `read` seam, so a
 * case names which were read; reading them is `src/status/sections.ts`'s
 * and wording them `src/status/render.ts`'s, each with suites of their
 * own. One case runs the default seam, the real reader, over a planted
 * project that is no git repository and has no `origin`, so no `gh` is
 * spawned and nothing waits on the network.
 *
 * ## The controls
 *
 * - The refused config sits beside a config that is read, over the same
 *   seam: the refusal is exit 1 with the reader never called, and the
 *   read config is exit 0 with it called once. So the exit 1 is the
 *   config's, and not a command that always refused.
 * - The case with every section unread exits 0 beside the case with
 *   every section read, which also exits 0 and writes no `warn` line:
 *   so the five `warn` lines are the sections', and a section not read
 *   is proved not to be a failure.
 * - The positional word exits 2 with the reader never called, beside
 *   the same line without the word, which reads.
 */
import type { StatusCommandSeams } from './status.js';
import type { StatusInput, StatusSections } from '../status/sections.js';
import type { CapturedRun, PlantedProject } from '../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { renderStatus, statusData } from '../status/render.js';
import { dispatchInProject, eventsOf, plantProject } from '../tests/cli-capture.js';

import statusCommand, { createStatusCommand, STATUS_ARGUMENT_EXIT, STATUS_USAGE } from './status.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-command-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** A fresh project under this file's directory, its config `text` when a case names one. */
function plant(text?: string): PlantedProject {
  planted += 1;
  const scope = realpathSync(mkdtempSync(join(tempBase, `case-${String(planted)}-`)));
  return text === undefined
    ? plantProject(scope)
    : plantProject(scope, text);
}

/** Every section read, with one blocked task under the loops line. */
const ALL_READ: StatusSections = {
  branch: {
    read: true,
    branch: 'feat/rafa-101-rafa-status',
    plan: {
      stub: 'rafa-101-rafa-status',
      plan: '/project/.rafa/plans/PLAN-rafa-101-rafa-status.md',
      tracker: '/project/.rafa/plans/PLAN_TRACKER-rafa-101-rafa-status.md',
      tasks: { total: 3, done: 1, blocked: 1, open: 1 },
      issues: 0,
    },
    notes: [],
  },
  loops: {
    read: true,
    live: [],
    blocked: [{
      session: {
        sessionId: 'session-0090',
        planStub: 'rafa-101-rafa-status',
        plan: '.rafa/plans/PLAN-rafa-101-rafa-status.md',
        branch: 'feat/rafa-101-rafa-status',
        pid: 4242,
        startedAt: '2026-09-24T10:00:00.000Z',
        state: 'stopped',
        task: null,
      },
      checklist: '/project/.rafa/plans/PLAN_TRACKER-rafa-101-rafa-status.md',
      tasks: [{ line: 12, text: 'Add the spawned test', blocker: 'gh never answers' }],
    }],
  },
  pull: { read: true, pull: null, notes: [] },
  board: { read: true, roadmap: 31, next: null, passed: 4, blockedIssues: 0, notes: [] },
  housekeeping: {
    read: true,
    counts: { merged: 1, stale: 0, notPushed: 0, worktrees: 0 },
    idleWorktrees: 0,
    notes: [],
  },
};

/** Every section not read, each naming why. */
const NONE_READ: StatusSections = {
  branch: { read: false, problem: 'fatal: not a git repository' },
  loops: { read: false, problem: 'a session record cannot be read' },
  pull: { read: false, problem: 'the pull request was not read within the 5000ms network deadline' },
  board: { read: false, problem: 'the board was not read within the 5000ms network deadline' },
  housekeeping: { read: false, problem: 'fatal: not a git repository' },
};

/** What a case's `read` seam was handed, once per call. */
interface Reads {
  readonly inputs: StatusInput[];
}

/** Dispatches `words` over the command reading `sections` through its seam, in `project`. */
async function run(
  words: readonly string[],
  sections: StatusSections,
  project: PlantedProject = plant(),
): Promise<CapturedRun & { readonly reads: Reads }> {
  const reads: Reads = { inputs: [] };
  const seams: StatusCommandSeams = {
    read: (input) => {
      reads.inputs.push(input);
      return Promise.resolve(sections);
    },
  };
  const outcome = await dispatchInProject(['status', ...words], [], [createStatusCommand(seams)], project);
  return { ...outcome, reads };
}

/** A captured stream's lines, the empty last one left out. */
function lines(text: string): readonly string[] {
  return text.split('\n').filter((line) => line !== '');
}

/** The lines text mode writes for `sections`, `warn` ones carrying the output's prefix. */
function written(sections: StatusSections): readonly string[] {
  return renderStatus(sections).map((line) => line.level === 'warn'
    ? `warn: ${line.text}`
    : line.text);
}

describe('rafa status in text mode', () => {
  it('writes each line renderStatus answers, in order, at info, exiting 0 with no warn line', async () => {
    const outcome = await run([], ALL_READ);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout)).toEqual(written(ALL_READ));
    expect(outcome.stdout).not.toContain('warn:');
    expect(outcome.stdout).toContain('  blocked: plan `rafa-101-rafa-status` line 12: Add the spawned test (gh never answers)\n');
    expect(outcome.stderr).toBe('');
  });

  it('writes a section not read as one warn line and still exits 0, every section unread', async () => {
    const outcome = await run([], NONE_READ);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout)).toEqual(written(NONE_READ));
    expect(lines(outcome.stdout).filter((line) => line.startsWith('warn: '))).toHaveLength(5);
  });

  it('writes the sections read at info beside the one not read at warn', async () => {
    const outcome = await run([], { ...ALL_READ, pull: NONE_READ.pull });

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout).filter((line) => line.startsWith('warn: '))).toEqual([
      'warn: Pull request: not read: the pull request was not read within the 5000ms network deadline',
    ]);
    expect(lines(outcome.stdout)).toContain('Board: roadmap #31 has no line left; 0 issues labelled spec:blocked');
  });
});

describe('rafa status --output=json', () => {
  it('gives statusData as the data of an ok result, and writes no section line', async () => {
    const outcome = await run(['--output=json'], { ...ALL_READ, board: NONE_READ.board });

    expect(outcome.exitCode).toBe(0);
    const events = eventsOf(outcome.stdout);
    const result = events.find((event) => event.type === 'result');
    expect(result).toMatchObject({ type: 'result', ok: true, data: statusData({ ...ALL_READ, board: NONE_READ.board }) });
    expect(outcome.stdout).not.toContain('Housekeeping: ');
    expect(events.filter((event) => event.type === 'log')).toEqual([]);
  });
});

describe('what rafa status reads', () => {
  it('hands the reader the project root, the home and the config the project resolves', async () => {
    const project = plant('pr:\n  base: trunk\n');

    const outcome = await run([], ALL_READ, project);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.reads.inputs).toHaveLength(1);
    expect(outcome.reads.inputs[0]?.root).toBe(project.root);
    expect(outcome.reads.inputs[0]?.home).toBe(project.home);
    expect(outcome.reads.inputs[0]?.config.prBase).toBe('trunk');
  });
});

describe('the exit codes of rafa status', () => {
  it('exits 1 for a config that cannot be used, reading nothing, beside a config it reads', async () => {
    const refused = await run([], ALL_READ, plant('store: nonesuch\n'));
    const read = await run([], ALL_READ, plant('store: sqlite\n'));

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('rafa status: the config cannot be used:');
    expect(refused.stderr).toContain('store is "nonesuch"');
    expect(refused.reads.inputs).toEqual([]);
    expect(read.exitCode).toBe(0);
    expect(read.reads.inputs).toHaveLength(1);
  });

  it('exits 2 for a positional word, reading nothing and naming the usage, beside the line without it', async () => {
    const refused = await run(['now'], ALL_READ);
    const read = await run([], ALL_READ);

    expect(STATUS_ARGUMENT_EXIT).toBe(2);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain('expected no argument, got 1: now');
    expect(refused.stderr).toContain(`Usage: ${STATUS_USAGE}`);
    expect(refused.reads.inputs).toEqual([]);
    expect(read.exitCode).toBe(0);
  });

  it('exits 0 over the real reader in a project that is no git repository, the branch a warn line', async () => {
    const project = plant();

    const outcome = await dispatchInProject(['status'], [], [statusCommand], project);

    expect(outcome.exitCode).toBe(0);
    const written = lines(outcome.stdout);
    expect(written).toHaveLength(5);
    expect(written[0]).toStartWith('warn: Branch: not read: ');
    expect(written[1]).toBe('Loops: 0 running, 0 tasks blocked');
    expect(written[4]).toStartWith('warn: Housekeeping: not read: ');
  });
});

describe('the status declaration', () => {
  it('is top-level, spends nothing, runs inside a project and declares no argument and no flag', () => {
    expect([statusCommand.subject, statusCommand.action]).toEqual(['status', 'status']);
    expect(statusCommand.spends).toBeUndefined();
    expect(statusCommand.needsProject).toBeUndefined();
    expect(statusCommand.args).toEqual([]);
    expect(statusCommand.flags).toEqual([]);
    expect(statusCommand.outputs).toEqual(['text', 'json']);
  });
});
