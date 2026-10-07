/**
 * Tests for the pit-stop readings (`pit-readings.ts`): the CI reading
 * over the recorded `run list` fake and a captured failed log, the open
 * bug count and the bugs filed since a cut-off through a stand-in
 * tracker, each reading's failure held apart from the others, and the
 * lines rendered from them.
 *
 * No case spawns `gh`: `run list` is answered by `src/ci/runs-fake.ts`
 * and `run view --log-failed` by a stand-in handing back the capture
 * under `src/ci/testdata/`. Controls: the green case reads the call log
 * beside the red case, so its missing `run view` is read against a run
 * that sends one; the cut-off case lists a bug filed after it beside one
 * filed before it, so the filter is seen to drop as well as keep.
 */
import type { FiledAtReader, PitSeams } from './pit-readings.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { FakeRun } from '../ci/runs-fake.js';
import type { OpenIssue, Tracker } from '../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { createFakeRunsGh } from '../ci/runs-fake.js';

import { NO_FILED_AT, NO_OPEN_ISSUES, readPitReadings, renderPitReadings } from './pit-readings.js';

const BRANCH = 'stretch/9';
const WORKFLOW = 'verify';
const SHA = 'c4da2c4c63b2e9d585d3a76ffbda1c49e3ce60d1';

/** The captured failed log of run 37190089292: three cases in one file. */
const THREE_CASES = await Bun.file(new URL('../ci/testdata/three-cases.log-failed.txt', import.meta.url)).text();
const GATE_FILE = 'src/tests/task-gate-spawned.test.ts';

/** The cut-off every case reads from. */
const SINCE = new Date('2026-10-07T10:00:00.000Z');

function plantedRun(fields: Partial<FakeRun> = {}): FakeRun {
  return {
    databaseId: 37190089292,
    workflowName: WORKFLOW,
    headBranch: BRANCH,
    headSha: SHA,
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-10-07T03:00:00Z',
    ...fields,
  };
}

/** A runner over the recorded fake, answering `run view` with `log`, and its call log. */
function caseGh(runs: readonly FakeRun[], log: GhResult = { ok: true, stdout: THREE_CASES, stderr: '' }): {
  gh: GhRunner;
  calls: () => readonly (readonly string[])[];
} {
  const fake = createFakeRunsGh(runs);
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'run' && args[1] === 'view') return Promise.resolve(log);
    return fake.gh(args);
  };
  return { gh, calls: () => [...calls] };
}

function bug(id: string, title: string): OpenIssue {
  return { ref: { opt: 0, kind: 'github', externalId: id, url: `https://example.test/issues/${id}` }, title, body: '' };
}

/** A tracker listing `bugs` as its open bugs, and the types it was asked for. */
function caseTracker(bugs: readonly OpenIssue[]): { tracker: Pick<Tracker, 'openIssues'>; asked: string[] } {
  const asked: string[] = [];
  return {
    tracker: {
      openIssues: (type) => {
        asked.push(type);
        return Promise.resolve([...bugs]);
      },
    },
    asked,
  };
}

/** A filing-time reader over `times`, keyed by issue number. */
function filedAtOf(times: Readonly<Record<string, string | null>>): FiledAtReader {
  return (ref) => {
    const at = times[ref.externalId];
    return Promise.resolve(at === undefined || at === null
      ? null
      : new Date(at));
  };
}

const OLD = bug('801', 'an old bug');
const NEW_A = bug('812', 'a bug from this item');
const NEW_B = bug('813', 'another bug from this item');
const TIMES = {
  '801': '2026-10-06T09:00:00Z',
  '812': '2026-10-07T12:00:00Z',
  '813': '2026-10-07T11:00:00Z',
};

/** Seams over `gh` and `bugs`; a null `filedAt` hands over no filing-time reader. */
function seams(gh: GhRunner, bugs: readonly OpenIssue[], filedAt: FiledAtReader | null = filedAtOf(TIMES)): PitSeams {
  const { tracker } = caseTracker(bugs);
  return filedAt === null
    ? { gh, tracker }
    : { gh, tracker, filedAt };
}

describe('the CI reading', () => {
  it('reads a green run with no log, and a red run with its failed cases by file', async () => {
    const green = caseGh([plantedRun()]);
    const red = caseGh([plantedRun({ conclusion: 'failure' })]);

    const greenReading = await readPitReadings(seams(green.gh, []), { branch: BRANCH, workflow: WORKFLOW, since: SINCE });
    const redReading = await readPitReadings(seams(red.gh, []), { branch: BRANCH, workflow: WORKFLOW, since: SINCE });

    expect(greenReading.ci.ok && greenReading.ci.value.verdict).toBe('green');
    expect(green.calls().some((args) => args[1] === 'view')).toBe(false);
    expect(red.calls()).toContainEqual(['run', 'view', '37190089292', '--log-failed']);
    if (!redReading.ci.ok) throw new Error(redReading.ci.reason);
    expect(redReading.ci.value.verdict).toBe('red');
    expect(redReading.ci.value.failed?.map((file) => file.file)).toEqual([GATE_FILE]);
    expect(redReading.ci.value.failed?.[0]?.cases).toHaveLength(3);
  });

  it('sends --workflow only when one is named', async () => {
    const any = caseGh([plantedRun()]);

    await readPitReadings(seams(any.gh, []), { branch: BRANCH, since: SINCE });

    expect(any.calls()[0]).not.toContain('--workflow');
  });

  it('holds a gh failure as not read, and still reads the bugs', async () => {
    const unknownWorkflow = caseGh([plantedRun()]);

    const reading = await readPitReadings(seams(unknownWorkflow.gh, [OLD]), { branch: BRANCH, workflow: 'nope', since: SINCE });

    expect(reading.ci.ok).toBe(false);
    expect(!reading.ci.ok && reading.ci.reason).toContain('could not find any workflows named nope');
    expect(reading.openBugs).toEqual({ ok: true, value: 1 });
  });
});

describe('the bug readings', () => {
  it('counts the open bugs through openIssues(\'bug\')', async () => {
    const { tracker, asked } = caseTracker([OLD, NEW_A, NEW_B]);

    const reading = await readPitReadings({ gh: caseGh([]).gh, tracker, filedAt: filedAtOf(TIMES) }, { branch: BRANCH, since: SINCE });

    expect(asked).toEqual(['bug']);
    expect(reading.openBugs).toEqual({ ok: true, value: 3 });
  });

  it('lists the bugs filed after the cut-off, oldest first, and drops one filed before it', async () => {
    const reading = await readPitReadings(seams(caseGh([]).gh, [OLD, NEW_A, NEW_B]), { branch: BRANCH, since: SINCE });

    if (!reading.filedSince.ok) throw new Error(reading.filedSince.reason);
    expect(reading.filedSince.value.since).toBe(SINCE.toISOString());
    expect(reading.filedSince.value.bugs.map((filed) => filed.id)).toEqual(['813', '812']);
  });

  it('reads the bugs filed since as not read without a filing-time reader, and keeps the count', async () => {
    const reading = await readPitReadings(seams(caseGh([]).gh, [OLD], null), { branch: BRANCH, since: SINCE });

    expect(reading.filedSince).toEqual({ ok: false, reason: NO_FILED_AT });
    expect(reading.openBugs).toEqual({ ok: true, value: 1 });
  });

  it('refuses to guess when a bug has no filing time', async () => {
    const reading = await readPitReadings(seams(caseGh([]).gh, [OLD, NEW_A], filedAtOf({ '801': TIMES['801'], '812': null })), {
      branch: BRANCH,
      since: SINCE,
    });

    expect(reading.filedSince).toEqual({ ok: false, reason: 'no filing time for #812' });
  });

  it('reads both bug readings as not read on a tracker without openIssues, never as zero', async () => {
    const reading = await readPitReadings({ gh: caseGh([]).gh, tracker: {}, filedAt: filedAtOf(TIMES) }, { branch: BRANCH, since: SINCE });

    expect(reading.openBugs).toEqual({ ok: false, reason: NO_OPEN_ISSUES });
    expect(reading.filedSince).toEqual({ ok: false, reason: NO_OPEN_ISSUES });
  });

  it('holds a tracker that throws as not read', async () => {
    const tracker: Pick<Tracker, 'openIssues'> = { openIssues: () => Promise.reject(new Error('gh issue list failed: offline')) };

    const reading = await readPitReadings({ gh: caseGh([plantedRun()]).gh, tracker }, { branch: BRANCH, since: SINCE });

    expect(reading.openBugs).toEqual({ ok: false, reason: 'gh issue list failed: offline' });
    expect(reading.ci.ok).toBe(true);
  });
});

describe('the rendered lines', () => {
  it('prints the red run, its cases, the count and the new bugs', async () => {
    const red = caseGh([plantedRun({ conclusion: 'failure' })]);

    const lines = renderPitReadings(await readPitReadings(seams(red.gh, [OLD, NEW_A]), { branch: BRANCH, workflow: WORKFLOW, since: SINCE }));

    expect(lines[0]).toBe(`CI: ❌ ${BRANCH} (${WORKFLOW}): ${WORKFLOW} run 37190089292 is failure on c4da2c4.`);
    expect(lines[1]).toBe(`   ${GATE_FILE}`);
    expect(lines.slice(-3)).toEqual([
      'Bugs: 2 open.',
      `Filed since ${SINCE.toISOString()}: 1.`,
      '   #812 a bug from this item (2026-10-07T12:00:00.000Z)',
    ]);
  });

  it('prints a branch with no run, no new bug, and each reading not read with its reason', async () => {
    const quiet = renderPitReadings(await readPitReadings(seams(caseGh([]).gh, [OLD]), { branch: BRANCH, since: SINCE }));
    const unread = renderPitReadings({
      ci: { ok: false, reason: 'gh offline' },
      openBugs: { ok: false, reason: NO_OPEN_ISSUES },
      filedSince: { ok: false, reason: NO_FILED_AT },
    });

    expect(quiet).toEqual([`CI: ⚪ No run on ${BRANCH}.`, 'Bugs: 1 open.', `Filed since ${SINCE.toISOString()}: none.`]);
    expect(unread).toEqual([
      'CI: not read: gh offline',
      `Bugs: not read: ${NO_OPEN_ISSUES}`,
      `Filed since the last item: not read: ${NO_FILED_AT}`,
    ]);
  });
});
