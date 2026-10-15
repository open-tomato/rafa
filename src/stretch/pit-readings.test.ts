/**
 * Tests for the pit-stop readings (`pit-readings.ts`): the CI reading
 * over the recorded `run list` fake and a captured failed log, the open
 * bug count through a stand-in tracker's `openIssues('bug')`, the bugs
 * filed since a cut-off through the same stand-in's
 * `filedIssues('bug', since)`, each reading's failure held apart from
 * the others, and the lines rendered from them.
 *
 * No case spawns `gh`: `run list` is answered by `src/ci/runs-fake.ts`
 * and `run view --log-failed` by a stand-in handing back the capture
 * under `src/ci/testdata/`. Controls: the green case reads the call log
 * beside the red case, so its missing `run view` is read against a run
 * that sends one; the cut-off case lists a bug filed after it beside one
 * filed at it, which the GitHub adapter can answer since it writes the
 * cut-off to the second, so the filter is seen to drop as well as keep;
 * the unparsed-time case runs the same bugs dated beside it, so the
 * refusal is seen to come from the time alone; a `filedIssues` that
 * throws runs beside an `openIssues` that answers, and the other way
 * round, so each reading is seen to stand alone; a body of several lines
 * runs beside an empty one, and a first line over
 * {@link FIRST_LINE_MAX} characters beside one under it.
 */
import type { PitSeams } from './pit-readings.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { FakeRun } from '../ci/runs-fake.js';
import type { FiledIssue, OpenIssue, Tracker } from '@open-tomato/rafa/ports';

import { describe, expect, it } from 'bun:test';

import { createFakeRunsGh } from '../ci/runs-fake.js';

import { FIRST_LINE_MAX, NO_FILED_ISSUES, NO_OPEN_ISSUES, readPitReadings, renderPitReadings } from './pit-readings.js';

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

/** A bug filed at `createdAt`, with `body`; as the open listing and the filed listing both answer it. */
function bug(id: string, title: string, createdAt: string, body = ''): FiledIssue {
  const ref: FiledIssue['ref'] = { opt: 0, kind: 'github', externalId: id, url: `https://example.test/issues/${id}` };
  return { ref, title, body, createdAt };
}

/** What a stand-in tracker was asked. */
interface Asked {
  readonly open: string[];
  readonly filed: (readonly [string, string])[];
}

/**
 * A tracker listing `open` as its open bugs and `filed` as the bugs filed
 * since, answered as given, and what it was asked. `filed` left out, the
 * filed listing is the open one.
 */
function caseTracker(open: readonly FiledIssue[], filed: readonly FiledIssue[] = open): {
  tracker: Pick<Tracker, 'openIssues' | 'filedIssues'>;
  asked: Asked;
} {
  const asked: Asked = { open: [], filed: [] };
  return {
    tracker: {
      openIssues: (type) => {
        asked.open.push(type);
        return Promise.resolve(open.map((issue): OpenIssue => ({ ...issue })));
      },
      filedIssues: (type, since) => {
        asked.filed.push([type, since.toISOString()]);
        return Promise.resolve([...filed]);
      },
    },
    asked,
  };
}

/** Filed at {@link SINCE}, not after it, as the GitHub adapter's `created:>=`, to the second, can answer it. */
const AT_CUT = bug('802', 'a bug filed at the cut-off', '2026-10-07T10:00:00Z');
/** Filed before {@link SINCE}. */
const OLD = bug('801', 'an old bug', '2026-10-06T09:00:00Z');
const OLDER = bug('790', 'an older bug', '2026-10-01T09:00:00Z');
/** Filed after {@link SINCE}, the later of the two listed first so the order read is not the order given. */
const NEW_A = bug('812', 'a bug from this item', '2026-10-07T12:00:00Z', 'The gate read red.\n\nMore below.');
const NEW_B = bug('813', 'another bug from this item', '2026-10-07T11:00:00Z');

/** Seams over `gh`, `open` as the open bugs and `filed` as the filed listing, the open one when left out. */
function seams(gh: GhRunner, open: readonly FiledIssue[], filed: readonly FiledIssue[] = open): PitSeams {
  return { gh, tracker: caseTracker(open, filed).tracker };
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

  it('asks for the branch\'s newest run, with no --commit, whether or not a workflow is named', async () => {
    const named = caseGh([plantedRun()]);
    const unnamed = caseGh([plantedRun()]);

    await readPitReadings(seams(named.gh, []), { branch: BRANCH, workflow: WORKFLOW, since: SINCE });
    await readPitReadings(seams(unnamed.gh, []), { branch: BRANCH, since: SINCE });

    const listCalls = [...named.calls(), ...unnamed.calls()].filter((args) => args[0] === 'run' && args[1] === 'list');
    expect(listCalls).toHaveLength(2);
    for (const args of listCalls) {
      expect(args).toContain('--branch');
      expect(args).not.toContain('--commit');
    }
  });

  it('holds a gh failure as not read, and still reads the bugs', async () => {
    const unknownWorkflow = caseGh([plantedRun()]);

    const reading = await readPitReadings(seams(unknownWorkflow.gh, [OLD]), { branch: BRANCH, workflow: 'nope', since: SINCE });

    expect(reading.ci.ok).toBe(false);
    expect(!reading.ci.ok && reading.ci.reason).toContain('could not find any workflows named nope');
    expect(reading.openBugs).toEqual({ ok: true, value: 1 });
  });
});

describe('the open-bug count', () => {
  it('counts the open bugs through openIssues(\'bug\') alone, not the filed listing', async () => {
    const closedSince = bug('814', 'a bug filed and closed during the item', '2026-10-07T11:30:00Z');
    const { tracker, asked } = caseTracker([OLD, NEW_A, NEW_B], [NEW_A, NEW_B, closedSince]);

    const reading = await readPitReadings({ gh: caseGh([]).gh, tracker }, { branch: BRANCH, since: SINCE });

    expect(asked.open).toEqual(['bug']);
    expect(reading.openBugs).toEqual({ ok: true, value: 3 });
    expect(reading.filedSince.ok && reading.filedSince.value.bugs).toHaveLength(3);
  });

  it('reads as not read on a tracker without openIssues, never as zero, and still lists the filed bugs', async () => {
    const filedOnly: Pick<Tracker, 'openIssues' | 'filedIssues'> = { filedIssues: () => Promise.resolve([NEW_A]) };

    const reading = await readPitReadings({ gh: caseGh([]).gh, tracker: filedOnly }, { branch: BRANCH, since: SINCE });

    expect(reading.openBugs).toEqual({ ok: false, reason: NO_OPEN_ISSUES });
    expect(reading.filedSince.ok && reading.filedSince.value.bugs.map((filed) => filed.id)).toEqual(['812']);
  });

  it('holds an openIssues that throws as not read, and still lists the filed bugs', async () => {
    const tracker: Pick<Tracker, 'openIssues' | 'filedIssues'> = {
      openIssues: () => Promise.reject(new Error('gh issue list failed: offline')),
      filedIssues: () => Promise.resolve([NEW_A]),
    };

    const reading = await readPitReadings({ gh: caseGh([plantedRun()]).gh, tracker }, { branch: BRANCH, since: SINCE });

    expect(reading.openBugs).toEqual({ ok: false, reason: 'gh issue list failed: offline' });
    expect(reading.filedSince.ok).toBe(true);
    expect(reading.ci.ok).toBe(true);
  });
});

describe('the bugs filed since', () => {
  it('asks filedIssues(\'bug\', since) once, with the cut-off', async () => {
    const { tracker, asked } = caseTracker([OLD], [NEW_A]);

    await readPitReadings({ gh: caseGh([]).gh, tracker }, { branch: BRANCH, since: SINCE });

    expect(asked.filed).toEqual([['bug', SINCE.toISOString()]]);
  });

  it('lists the bugs filed after the cut-off, oldest first, and drops one filed at it', async () => {
    const reading = await readPitReadings(seams(caseGh([]).gh, [], [AT_CUT, NEW_A, NEW_B]), { branch: BRANCH, since: SINCE });

    if (!reading.filedSince.ok) throw new Error(reading.filedSince.reason);
    expect(reading.filedSince.value.since).toBe(SINCE.toISOString());
    expect(reading.filedSince.value.bugs.map((filed) => filed.id)).toEqual(['813', '812']);
  });

  it('reads no bug as filed since when the listing holds none after the cut-off', async () => {
    const reading = await readPitReadings(seams(caseGh([]).gh, [OLD, OLDER], []), { branch: BRANCH, since: SINCE });

    expect(reading.filedSince).toEqual({ ok: true, value: { since: SINCE.toISOString(), bugs: [] } });
    expect(reading.openBugs).toEqual({ ok: true, value: 2 });
  });

  it('reads the times off the filed listing, with no gh call for a bug', async () => {
    const quiet = caseGh([]);

    const reading = await readPitReadings(seams(quiet.gh, [OLD], [NEW_A, NEW_B]), { branch: BRANCH, since: SINCE });

    if (!reading.filedSince.ok) throw new Error(reading.filedSince.reason);
    expect(reading.filedSince.value.bugs.map((filed) => filed.filedAt)).toEqual(['2026-10-07T11:00:00.000Z', '2026-10-07T12:00:00.000Z']);
    expect(quiet.calls().filter((args) => args[0] === 'issue')).toEqual([]);
    expect(quiet.calls().some((args) => args[0] === 'run')).toBe(true);
  });

  it('refuses to guess when a time does not parse, naming every such bug, and keeps the count', async () => {
    const dated = await readPitReadings(seams(caseGh([]).gh, [OLD], [NEW_A, NEW_B]), { branch: BRANCH, since: SINCE });
    const reading = await readPitReadings(
      seams(caseGh([]).gh, [OLD], [bug('812', NEW_A.title, 'soon'), NEW_B, bug('815', 'a third bug', '')]),
      { branch: BRANCH, since: SINCE },
    );

    expect(dated.filedSince.ok).toBe(true);
    expect(reading.filedSince).toEqual({ ok: false, reason: 'no filing time for #812, #815' });
    expect(reading.openBugs).toEqual({ ok: true, value: 1 });
  });

  it('reads as not read on a tracker without filedIssues, never as none, and keeps the count', async () => {
    const openOnly: Pick<Tracker, 'openIssues' | 'filedIssues'> = { openIssues: () => Promise.resolve([OLD, NEW_A]) };

    const reading = await readPitReadings({ gh: caseGh([]).gh, tracker: openOnly }, { branch: BRANCH, since: SINCE });

    expect(reading.openBugs).toEqual({ ok: true, value: 2 });
    expect(reading.filedSince).toEqual({ ok: false, reason: NO_FILED_ISSUES });
  });

  it('reads both bug readings as not read, each with its own reason, on a tracker with neither member', async () => {
    const reading = await readPitReadings({ gh: caseGh([]).gh, tracker: {} }, { branch: BRANCH, since: SINCE });

    expect(reading.openBugs).toEqual({ ok: false, reason: NO_OPEN_ISSUES });
    expect(reading.filedSince).toEqual({ ok: false, reason: NO_FILED_ISSUES });
  });

  it('holds a filedIssues that throws as not read, while the count from openIssues prints', async () => {
    const tracker: Pick<Tracker, 'openIssues' | 'filedIssues'> = {
      openIssues: () => Promise.resolve([OLD, NEW_A]),
      filedIssues: () => Promise.reject(new Error('gh issue list --search failed: rate limited')),
    };

    const lines = renderPitReadings(await readPitReadings({ gh: caseGh([]).gh, tracker }, { branch: BRANCH, since: SINCE }));

    expect(lines.slice(-2)).toEqual([
      'Bugs: 2 open.',
      'Filed since the last item: not read: gh issue list --search failed: rate limited',
    ]);
  });

  it('reads a cut-off that is no time as not read, and asks the tracker nothing for it', async () => {
    const { tracker, asked } = caseTracker([OLD], [NEW_A]);

    const reading = await readPitReadings({ gh: caseGh([]).gh, tracker }, { branch: BRANCH, since: new Date('not a time') });

    expect(reading.filedSince).toEqual({ ok: false, reason: 'the cut-off is not a valid time' });
    expect(asked.filed).toEqual([]);
    expect(reading.openBugs).toEqual({ ok: true, value: 1 });
  });
});

describe('the first line of a filed bug', () => {
  it('reads the first non-blank line, trimmed, of a body of several lines, and none of an empty or blank body', async () => {
    const several = bug('820', 'several lines', '2026-10-07T11:00:00Z', '\n  \r\n   The run read red on main.  \r\nSecond line.\n');
    const empty = bug('821', 'empty body', '2026-10-07T11:01:00Z', '');
    const blank = bug('822', 'blank body', '2026-10-07T11:02:00Z', ' \n\t\n');

    const reading = await readPitReadings(seams(caseGh([]).gh, [], [several, empty, blank]), { branch: BRANCH, since: SINCE });

    if (!reading.filedSince.ok) throw new Error(reading.filedSince.reason);
    expect(reading.filedSince.value.bugs.map((filed) => filed.firstLine)).toEqual(['The run read red on main.', null, null]);
    expect(renderPitReadings(reading).slice(-3)).toEqual([
      '   #820 several lines: The run read red on main.',
      '   #821 empty body',
      '   #822 blank body',
    ]);
  });

  it(`cuts a first line over ${String(FIRST_LINE_MAX)} characters to its first ${String(FIRST_LINE_MAX)}, and keeps one under it whole`, async () => {
    const long = `${'a'.repeat(FIRST_LINE_MAX)}TAIL`;
    const short = 'b'.repeat(FIRST_LINE_MAX - 1);
    const over = bug('830', 'a long line', '2026-10-07T11:00:00Z', `${long}\nnext`);
    const under = bug('831', 'a short line', '2026-10-07T11:01:00Z', short);

    const reading = await readPitReadings(seams(caseGh([]).gh, [], [over, under]), { branch: BRANCH, since: SINCE });

    if (!reading.filedSince.ok) throw new Error(reading.filedSince.reason);
    expect(reading.filedSince.value.bugs.map((filed) => filed.firstLine)).toEqual(['a'.repeat(FIRST_LINE_MAX), short]);
  });
});

describe('stretch 7: a bug filed after the cut-off and closed before the reading', () => {
  it('lists the closed bug from the filed listing, and keeps the open count', async () => {
    // Stretch 7: #1084 was filed at 03:04:38Z, after the cut-off, and closed
    // by the operator, so the open listing holds only the three older bugs
    // while the filed listing, in any state, holds #1084.
    const cutoff = new Date('2026-10-14T01:29:39.610Z');
    const open = [
      bug('1001', 'an open bug', '2026-10-10T09:00:00Z'),
      bug('1040', 'another open bug', '2026-10-12T09:00:00Z'),
      bug('1070', 'a third open bug', '2026-10-13T09:00:00Z'),
    ];
    const closed = bug('1084', 'the bug the loop filed', '2026-10-14T03:04:38Z', 'A gate failed on the stretch branch.\n\nDetails.');

    const lines = renderPitReadings(await readPitReadings(seams(caseGh([]).gh, open, [closed]), { branch: 'stretch/7', since: cutoff }));

    expect(lines.slice(-3)).toEqual([
      'Bugs: 3 open.',
      'Filed since 2026-10-14T01:29:39.610Z: 1.',
      '   #1084 the bug the loop filed: A gate failed on the stretch branch.',
    ]);
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
      '   #812 a bug from this item: The gate read red.',
    ]);
  });

  it('prints a branch with no run, no new bug, and each reading not read with its reason', async () => {
    const quiet = renderPitReadings(await readPitReadings(seams(caseGh([]).gh, [OLD], []), { branch: BRANCH, since: SINCE }));
    const unread = renderPitReadings({
      ci: { ok: false, reason: 'gh offline' },
      openBugs: { ok: false, reason: NO_OPEN_ISSUES },
      filedSince: { ok: false, reason: NO_FILED_ISSUES },
    });

    expect(quiet).toEqual([`CI: ⚪ No run on ${BRANCH}.`, 'Bugs: 1 open.', `Filed since ${SINCE.toISOString()}: none.`]);
    expect(unread).toEqual([
      'CI: not read: gh offline',
      `Bugs: not read: ${NO_OPEN_ISSUES}`,
      `Filed since the last item: not read: ${NO_FILED_ISSUES}`,
    ]);
  });
});
