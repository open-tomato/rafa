/**
 * Tests for the project refresh the `rafa epic` actions share
 * (`epic-project.ts`): each action's target read off its result, and
 * `refreshProjectAfterEpic` dispatched through a probe command in a
 * planted project, so the config, the output and the exit code are the
 * dispatcher's own. The refresh is a recording seam but in the add case,
 * where the add goes through the project fake (`project-fake.ts`) and
 * `gh repo view` is answered here. No case reaches GitHub.
 *
 * ## The controls
 *
 *  - The case with `board.project.number` unset runs the same target as
 *    the case with it set, which calls the refresh, so a refresh never
 *    called proves the key and not a seam that was never wired.
 *  - The broken config's problem line is read beside the same config with
 *    a null target, which writes nothing, so the line comes from the
 *    config read and not from the probe.
 *  - The retry cases' refresh sends one call through the runner it is
 *    handed, timed out once; beside them the same call under
 *    `board.project.retries: false` answers the failure with no line.
 */
import type { EpicCancelResult } from './cancel.js';
import type { EpicCloseResult } from './close.js';
import type { EpicProjectSeams, EpicProjectTarget, RefreshEpicItems } from './epic-project.js';
import type { EpicHorizonResult } from './horizon-change.js';
import type { EpicMoveResult } from './move.js';
import type { EpicNewResult } from './new.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { ProjectRefresh, RefreshOptions, RefreshWidening } from '../../board/project/refresh.js';
import type { RafaCommand } from '../../cli/command.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhProjectPort } from '../../board/project/gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY, fakeProjectId } from '../../board/project/project-fake.js';
import { notFoundWarning } from '../../board/project/refresh-warnings.js';
import { answeringGh, flakyGh, recordRetries, TIMED_OUT_STDERR } from '../../board/project/retry-fake.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import {
  cancelTarget,
  closeTarget,
  epicProjectProblemLine,
  horizonTarget,
  moveTarget,
  newEpicTarget,
  refreshProjectAfterEpic,
} from './epic-project.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-project-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the probe is dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** The owner of the fake's repository, and of its project. */
const OWNER = FAKE_PROJECT_REPOSITORY.split('/')[0] ?? '';

/** The project's number. */
const NUMBER = 6;

/** A config naming no project. */
const NO_PROJECT = 'tracker:\n  default: local\n';

/** A config naming project {@link NUMBER}. */
const WITH_PROJECT = `${NO_PROJECT}board:\n  project:\n    number: ${String(NUMBER)}\n`;

/** A config `loadConfig` refuses for its project number. */
const BROKEN = `${NO_PROJECT}board:\n  project:\n    number: six\n`;

/** One call the recording refresh received. */
interface RefreshCall {
  readonly number: number | null;
  readonly issues: readonly number[];
  readonly widening: RefreshWidening;
}

/** A refresh recording each call and answering `answer`. */
function recordingRefresh(answer: () => Promise<ProjectRefresh> = () => Promise.resolve({ kind: 'skipped', reason: 'no-issues', warnings: [] })): {
  readonly refresh: RefreshEpicItems;
  readonly calls: RefreshCall[];
} {
  const calls: RefreshCall[] = [];
  const refresh: RefreshEpicItems = (options: RefreshOptions, issues, widening) => {
    calls.push({ number: options.config.boardProjectNumber, issues, widening });
    return answer();
  };
  return { refresh, calls };
}

/** A `gh` that fails every call, counting them. */
function refusingGh(): { readonly gh: GhRunner; readonly count: () => number } {
  let count = 0;
  const gh: GhRunner = () => {
    count += 1;
    return Promise.resolve({ ok: false, stdout: '', stderr: 'test gh: no call was planted\n' });
  };
  return { gh, count: () => count };
}

/** Runs `refreshProjectAfterEpic` over `target` in a project whose config is `config`, as a command would. */
async function probe(config: string, seams: EpicProjectSeams, target: EpicProjectTarget | null, outputMode: 'text' | 'json' = 'text') {
  let answered: unknown;
  const command: RafaCommand = {
    name: 'epic probe',
    subject: 'epic',
    action: 'probe',
    summary: 'run the epic project refresh',
    description: 'Runs the epic project refresh over a planted target.',
    args: [],
    flags: [],
    examples: [],
    outputs: ['text', 'json'],
    run: async (context) => {
      context.output.info('own line');
      answered = await refreshProjectAfterEpic(context, seams, target);
    },
  };
  const words = outputMode === 'json'
    ? ['epic', 'probe', '--output=json']
    : ['epic', 'probe'];
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), config);
  const outcome = await dispatchInProject(words, [EPIC_SUBJECT], [command], project);
  return { ...outcome, answered };
}

/** The target of a move of #12 from epic #40 to #50. */
const MOVE_TARGET: EpicProjectTarget = { epics: [40, 50], issues: [12], added: null };

describe('the targets each action names', () => {
  it('names the new epic, added first, for epic new', () => {
    const result = { epic: { number: 77, url: 'u', title: 't' } } as unknown as EpicNewResult;

    expect(newEpicTarget(result)).toEqual({ epics: [77], issues: [], added: 77 });
  });

  it('names the epic for a promote or defer that moved it, and nothing for one that changed nothing', () => {
    const moved = { status: 'moved', epic: 40 } as EpicHorizonResult;

    expect(horizonTarget(moved)).toEqual({ epics: [40], issues: [], added: null });
    expect(horizonTarget({ ...moved, status: 'unasked' })).toBeNull();
    expect(horizonTarget({ ...moved, status: 'blank' })).toBeNull();
  });

  it('names both epics and the issue for a move that landed, and nothing for one that changed nothing', () => {
    const moved = { status: 'moved', issue: 12, from: 40, to: 50, outcome: { commentProblem: '' } } as EpicMoveResult;

    expect(moveTarget(moved)).toEqual(MOVE_TARGET);
    expect(moveTarget({ ...moved, status: 'unasked', outcome: null })).toBeNull();
  });

  it('names the epic, the epics dependents moved from and to and every dependent answered for a cancel that went ahead', () => {
    const applied = [
      { issue: 57, answer: { kind: 'moved', from: 50, to: 90 } },
      { issue: 58, answer: { kind: 'unblocked' } },
      { issue: 59, answer: { kind: 'cancelled' } },
    ];
    const cancelled = { status: 'cancelled', epic: 40, applied } as unknown as EpicCancelResult;

    expect(cancelTarget(cancelled)).toEqual({ epics: [40, 50, 90], issues: [57, 58, 59], added: null });
    expect(cancelTarget({ ...cancelled, status: 'unasked', applied: [] })).toBeNull();
    expect(cancelTarget({ ...cancelled, status: 'ended', applied: [] })).toBeNull();
  });

  it('names the epic for a close', () => {
    expect(closeTarget({ epic: 40 } as EpicCloseResult)).toEqual({ epics: [40], issues: [], added: null });
  });
});

describe('refreshProjectAfterEpic', () => {
  it('calls no refresh and opens no runner with board.project.number unset', async () => {
    const recorded = recordingRefresh();
    const gh = refusingGh();

    const outcome = await probe(NO_PROJECT, { gh: gh.gh, projectRefresh: recorded.refresh }, MOVE_TARGET);

    expect(outcome).toMatchObject({ exitCode: 0, stdout: 'own line\n', answered: null });
    expect(recorded.calls).toEqual([]);
    expect(gh.count()).toBe(0);
  });

  it('asks one refresh for the epics then the issues, widened by the epics\' members and the shifted Ranks', async () => {
    const recorded = recordingRefresh();

    const outcome = await probe(WITH_PROJECT, { gh: refusingGh().gh, projectRefresh: recorded.refresh }, MOVE_TARGET);

    expect(outcome.exitCode).toBe(0);
    expect(recorded.calls).toEqual([{ number: NUMBER, issues: [40, 50, 12], widening: { membersOf: [40, 50], shiftedRanks: true } }]);
    expect(outcome.answered).toEqual({ issues: [40, 50, 12], membersOf: [40, 50], added: null, warnings: [] });
  });

  it('names an issue once though the target names it as an epic and an issue', async () => {
    const recorded = recordingRefresh();

    await probe(WITH_PROJECT, { projectRefresh: recorded.refresh }, { epics: [40], issues: [40, 57], added: null });

    expect(recorded.calls.map(({ issues }) => issues)).toEqual([[40, 57]]);
  });

  it('writes the refresh\'s warnings after the command\'s own line and keeps exit 0', async () => {
    const refreshed = { kind: 'skipped', reason: 'no-issues', warnings: ['first warning', 'second warning'] } as const;
    const recorded = recordingRefresh(() => Promise.resolve(refreshed));

    const outcome = await probe(WITH_PROJECT, { projectRefresh: recorded.refresh }, MOVE_TARGET);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe('own line\nwarn: first warning\nwarn: second warning\n');
  });

  it('answers a refresh that rejected as one line naming the issues and rafa board sync, keeping exit 0', async () => {
    const recorded = recordingRefresh(() => Promise.reject(new Error('gh repo view: not a repository')));

    const outcome = await probe(WITH_PROJECT, { projectRefresh: recorded.refresh }, MOVE_TARGET);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(`own line\nwarn: ${epicProjectProblemLine([40, 50, 12], 'gh repo view: not a repository')}\n`);
    expect(outcome.stdout).toContain('Run `rafa board sync` to catch up.');
  });

  it('answers a config that cannot be read as one line, keeping exit 0', async () => {
    const recorded = recordingRefresh();

    const outcome = await probe(BROKEN, { projectRefresh: recorded.refresh }, MOVE_TARGET);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toStartWith('own line\nwarn: The project was not updated for #40, #50, #12: The config cannot be used: ');
    expect(outcome.stdout.split('\n').filter((line) => line !== '')).toHaveLength(2);
    expect(recorded.calls).toEqual([]);
  });

  it('reads no config and writes nothing for a null target, over the same broken config', async () => {
    const recorded = recordingRefresh();

    const outcome = await probe(BROKEN, { projectRefresh: recorded.refresh }, null);

    expect(outcome).toMatchObject({ exitCode: 0, stdout: 'own line\n', answered: null });
    expect(recorded.calls).toEqual([]);
  });

  it('writes the warnings as warn log events in json mode, after the command\'s own and before the result', async () => {
    const refreshed = { kind: 'skipped', reason: 'no-issues', warnings: ['a warning'] } as const;
    const recorded = recordingRefresh(() => Promise.resolve(refreshed));

    const outcome = await probe(WITH_PROJECT, { projectRefresh: recorded.refresh }, MOVE_TARGET, 'json');

    expect(outcome.exitCode).toBe(0);
    const shown = eventsOf(outcome.stdout).map((event) => ('message' in event
      ? [event.type, event.level, event.message]
      : [event.type]));

    expect(shown).toEqual([
      ['start'],
      ['log', 'info', 'own line'],
      ['log', 'warn', 'a warning'],
      ['result'],
    ]);
  });
});

describe('refreshProjectAfterEpic: a new epic, added to the project first', () => {
  /** The project fake behind a router answering `gh repo view`, holding issue #77. */
  function wired(): { readonly gh: GhRunner; readonly project: ReturnType<typeof createFakeProjectGh> } {
    const project = createFakeProjectGh({
      projects: [{ owner: OWNER, number: NUMBER }],
      repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues: [77] }],
    });
    const gh: GhRunner = (args) => (args.join(' ') === 'repo view --json nameWithOwner'
      ? Promise.resolve({ ok: true, stdout: JSON.stringify({ nameWithOwner: FAKE_PROJECT_REPOSITORY }), stderr: '' } satisfies GhResult)
      : project.gh(args));
    return { gh, project };
  }

  it('adds the epic to the project, then asks the widened refresh for it', async () => {
    const routed = wired();
    const recorded = recordingRefresh();

    const outcome = await probe(WITH_PROJECT, { gh: routed.gh, projectRefresh: recorded.refresh }, { epics: [77], issues: [], added: 77 });
    const items = await createGhProjectPort(routed.project.gh).items(fakeProjectId({ owner: OWNER, number: NUMBER }));

    expect(outcome.exitCode).toBe(0);
    expect(items.map(({ content }) => content)).toEqual([{ kind: 'issue', repository: FAKE_PROJECT_REPOSITORY, number: 77 }]);
    expect(recorded.calls).toEqual([{ number: NUMBER, issues: [77], widening: { membersOf: [77], shiftedRanks: true } }]);
  });

  it('writes the not-found line and asks no refresh for a number naming no project', async () => {
    const routed = wired();
    const recorded = recordingRefresh();
    const config = `${NO_PROJECT}board:\n  project:\n    number: ${String(NUMBER + 1)}\n`;

    const outcome = await probe(config, { gh: routed.gh, projectRefresh: recorded.refresh }, { epics: [77], issues: [], added: 77 });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(`own line\nwarn: ${notFoundWarning({ owner: OWNER, number: NUMBER + 1 })}\n`);
    expect(recorded.calls).toEqual([]);
  });
});

describe('refreshProjectAfterEpic: a call failing on a network error', () => {
  /** A refresh sending one call for #12 through the runner it is handed, recording what it answered. */
  function sendingRefresh(): { readonly refresh: RefreshEpicItems; readonly answers: GhResult[] } {
    const answers: GhResult[] = [];
    const refresh: RefreshEpicItems = async (options) => {
      answers.push(await options.gh(['api', 'graphql', '-F', 'number=12']));
      return { kind: 'skipped', reason: 'no-issues', warnings: [] };
    };
    return { refresh, answers };
  }

  it('sends the call again after the wait and prints one retrying line after the action\'s own', async () => {
    const flaky = flakyGh(answeringGh('{}'), [TIMED_OUT_STDERR]);
    const sending = sendingRefresh();
    const recorder = recordRetries();

    const outcome = await probe(WITH_PROJECT, { gh: flaky.gh, projectRefresh: sending.refresh, sleep: recorder.seams.sleep }, MOVE_TARGET);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe('own line\nretrying #12 (1 of 3): operation timed out\n');
    expect(sending.answers.map((answer) => answer.ok)).toEqual([true]);
    expect(recorder.waits()).toEqual([2000]);
  });

  it('control: with board.project.retries false the same call is sent once and answers the failure', async () => {
    const flaky = flakyGh(answeringGh('{}'), [TIMED_OUT_STDERR]);
    const sending = sendingRefresh();

    const outcome = await probe(`${WITH_PROJECT}    retries: false\n`, { gh: flaky.gh, projectRefresh: sending.refresh, sleep: () => Promise.resolve() }, MOVE_TARGET);

    expect(outcome.stdout).toBe('own line\n');
    expect([sending.answers.map((answer) => answer.ok), flaky.sent().length]).toEqual([[false], 1]);
  });

  it('writes the retry as one retry event in json mode', async () => {
    const flaky = flakyGh(answeringGh('{}'), [TIMED_OUT_STDERR]);
    const sending = sendingRefresh();

    const outcome = await probe(WITH_PROJECT, { gh: flaky.gh, projectRefresh: sending.refresh, sleep: () => Promise.resolve() }, MOVE_TARGET, 'json');
    const retries = eventsOf(outcome.stdout).filter((event) => event.type === 'event' && event.name === 'retry');

    expect(retries.map((event) => event.type === 'event' && event.summary)).toEqual(['retrying #12 (1 of 3): operation timed out']);
  });
});
