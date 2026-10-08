/**
 * Tests for the decision half of the project step of `rafa init`
 * (`./init-board-project.ts`, `runProjectStep`): whether the step runs,
 * the one question, and the lines it prints. What the five parts come to
 * is held in `./init-board-project.test.ts`; here `setUpProject` is
 * replaced by a recording fake, and the `gh` opener and the prompter
 * each count how often they were opened, so a case that must send or
 * ask nothing is shown to have opened neither.
 *
 * The control for "nothing opened" is the `--project` case, which opens
 * the runner once, and the yes on a terminal, which opens the prompter
 * once: the counters can read something other than zero.
 */
import type { ProjectSetupConfig, ProjectSetupOptions, ProjectSetupReport, ProjectStepOptions } from './init-board-project.js';
import type { BoardStepResult } from './init-board.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Prompter } from '../cli/prompt/confirm.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { projectConfigText } from '../project/scaffold.js';

import {
  PROJECT_HEADING,
  PROJECT_NO_BOARD_WARNING,
  PROJECT_QUESTION,
  PROJECT_STEP_FIX,
  projectStepChanged,
  renderProjectStep,
  runProjectStep,
} from './init-board-project.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-project-step-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A board step that ran. */
const BOARD_RAN: BoardStepResult = { status: 'ran', asked: false, report: null, warnings: [] };

/** The config `init` resolved before the board step. */
const CONFIG: ProjectSetupConfig = {
  boardProjectNumber: null,
  boardProjectWriteBatchSize: 5,
  boardProjectWritePauseMs: 0,
  boardProjectTemplate: 'https://github.com/orgs/open-tomato/projects/6',
  boardRelationships: 'labels',
  roadmapIssue: null,
  releaseFragments: '.changes',
};

/** A report whose parts came to `outcomes`, in the order the module note lists them. */
function reportOf(outcomes: readonly ('created' | 'present' | 'refused')[]): ProjectSetupReport {
  const kinds = ['scope', 'project', 'items', 'fields', 'setting'] as const;
  return {
    parts: outcomes.map((outcome, index) => ({ kind: kinds[index] ?? 'setting', name: `part ${String(index)}`, outcome, detail: 'why' })),
    project: null,
    problems: [],
  };
}

/** A project root holding the config `rafa init` writes, with `extra` appended. */
function rootHolding(extra = ''): string {
  const root = mkdtempSync(join(tempBase, 'root-'));
  mkdirSync(join(root, '.rafa'));
  writeFileSync(join(root, '.rafa', 'config.yaml'), `${projectConfigText()}${extra}`, 'utf8');
  return root;
}

/** The seams a case runs the step over, and what each recorded. */
function harness(answers: readonly (string | null)[] = [], report = reportOf(['present', 'present', 'present', 'present', 'present'])) {
  const record = { ghOpened: 0, prompterOpened: 0, closed: 0, questions: [] as string[], setUps: [] as ProjectSetupOptions[] };
  const queue = [...answers];
  const gh: GhRunner = () => Promise.reject(new Error('the fake setUp sends nothing'));
  const prompter: Prompter = {
    say: () => undefined,
    ask: async (question) => {
      record.questions.push(question);
      return queue.shift() ?? null;
    },
    close: () => {
      record.closed += 1;
    },
  };
  const options = (overrides: Partial<ProjectStepOptions>): ProjectStepOptions => ({
    wanted: null,
    board: BOARD_RAN,
    root: rootHolding(),
    config: CONFIG,
    openGh: () => {
      record.ghOpened += 1;
      return gh;
    },
    isTerminal: () => false,
    openPrompter: () => {
      record.prompterOpened += 1;
      return prompter;
    },
    setUp: (setUpOptions) => {
      record.setUps.push(setUpOptions);
      return Promise.resolve(report);
    },
    ...overrides,
  });
  return { record, options };
}

describe('runProjectStep, the order it decides in', () => {
  it('runs nothing when the board did not run, warning only when --project asked', async () => {
    const { record, options } = harness(['y']);
    const notRun: BoardStepResult = { ...BOARD_RAN, status: 'declined' };

    const flagged = await runProjectStep(options({ wanted: true, board: notRun }));
    const silent = await runProjectStep(options({ wanted: null, board: notRun, isTerminal: () => true }));

    expect(flagged).toEqual({ status: 'not-run', asked: false, report: null, warnings: [PROJECT_NO_BOARD_WARNING] });
    expect(silent).toEqual({ status: 'not-run', asked: false, report: null, warnings: [] });
    expect([record.ghOpened, record.prompterOpened, record.setUps.length]).toEqual([0, 0, 0]);
  });

  it('declines under --no-project, opening neither the runner nor the prompter, even on a terminal', async () => {
    const { record, options } = harness(['y']);

    const result = await runProjectStep(options({ wanted: false, isTerminal: () => true }));

    expect(result).toEqual({ status: 'declined', asked: false, report: null, warnings: [] });
    expect([record.ghOpened, record.prompterOpened]).toEqual([0, 0]);
  });

  it('runs under --project without asking, on the runner it opened once', async () => {
    const { record, options } = harness(['n']);

    const result = await runProjectStep(options({ wanted: true, isTerminal: () => true }));

    expect(result).toMatchObject({ status: 'ran', asked: false, warnings: [] });
    expect(result.report?.parts).toHaveLength(5);
    expect([record.ghOpened, record.prompterOpened, record.setUps.length]).toEqual([1, 0, 1]);
  });

  it('leaves the step out with no terminal, opening nothing, and names the line that runs it', async () => {
    const { record, options } = harness(['y']);

    const result = await runProjectStep(options({ wanted: null }));

    expect(result).toEqual({ status: 'unasked', asked: false, report: null, warnings: [] });
    expect([record.ghOpened, record.prompterOpened]).toEqual([0, 0]);
    expect(renderProjectStep(result)).toEqual([`The GitHub project question needs a terminal; run ${PROJECT_STEP_FIX} to create it.`]);
  });

  it('asks its question once on a terminal and runs on y or yes, closing the prompter each time', async () => {
    const { record, options } = harness(['y', ' YES ']);

    const first = await runProjectStep(options({ isTerminal: () => true }));
    const second = await runProjectStep(options({ isTerminal: () => true }));

    expect([first.status, first.asked, second.status, second.asked]).toEqual(['ran', true, 'ran', true]);
    expect(record.questions).toEqual([PROJECT_QUESTION, PROJECT_QUESTION]);
    expect([record.prompterOpened, record.closed, record.ghOpened]).toEqual([2, 2, 2]);
  });

  it('declines on any other answer, the empty one and an ended input included, sending nothing', async () => {
    const { record, options } = harness(['n', '', 'sure']);

    const answers = [];
    for (let asked = 0; asked < 4; asked += 1) answers.push(await runProjectStep(options({ isTerminal: () => true })));

    expect(answers.map((result) => [result.status, result.asked])).toEqual([
      ['declined', true],
      ['declined', true],
      ['declined', true],
      ['declined', true],
    ]);
    expect([record.questions.length, record.closed, record.ghOpened]).toEqual([4, 4, 0]);
    expect(renderProjectStep(answers[0] ?? { status: 'not-run', asked: false, report: null, warnings: [] }))
      .toEqual([`The GitHub project was left out; run ${PROJECT_STEP_FIX} to create it.`]);
  });
});

describe('runProjectStep, the config it sets the project up with', () => {
  it('reads back the roadmap.issue the board step wrote, where a file naming none keeps the config\'s', async () => {
    const { record, options } = harness();

    await runProjectStep(options({ wanted: true, root: rootHolding('\nroadmap:\n  issue: 7\n') }));
    await runProjectStep(options({ wanted: true, config: { ...CONFIG, roadmapIssue: 3 } }));

    expect(record.setUps.map((setUp) => setUp.config.roadmapIssue)).toEqual([7, 3]);
    expect(record.setUps[0]?.config.boardProjectTemplate).toBe(CONFIG.boardProjectTemplate);
  });
});

describe('projectStepChanged and renderProjectStep', () => {
  it('counts a run with a created part as a change, and one with every part present or refused as none', async () => {
    const created = await runProjectStep(harness([], reportOf(['present', 'created', 'refused', 'present', 'created'])).options({ wanted: true }));
    const held = await runProjectStep(harness([], reportOf(['present', 'refused', 'refused', 'refused', 'refused'])).options({ wanted: true }));
    const declined = await runProjectStep(harness().options({ wanted: false }));

    expect([projectStepChanged(created), projectStepChanged(held), projectStepChanged(declined)]).toEqual([true, false, false]);
  });

  it('prints the report\'s rows under the heading, and nothing for a step that did not run', async () => {
    const ran = await runProjectStep(harness([], reportOf(['present', 'refused'])).options({ wanted: true }));
    const notRun = await runProjectStep(harness().options({ wanted: null, board: { ...BOARD_RAN, status: 'not-github' } }));

    expect(renderProjectStep(ran)).toEqual([PROJECT_HEADING, '  present  part 0', '  refused  part 1: why']);
    expect(renderProjectStep(notRun)).toEqual([]);
  });
});
