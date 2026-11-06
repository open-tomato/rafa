/**
 * Tests for the pit-stop readings (`pit-readings.ts`): the CI reading
 * over the recorded `run list` fake and a captured failed log, the open
 * bug count through a stand-in tracker's `openIssues('bug')`, the bugs
 * filed since a cut-off through the same stand-in's
 * `filedIssues('bug', since)`, each reading's failure held apart from
 * the others, and the lines rendered from them.
 *
 * The CI reading is the per-workflow one `rafa ci status --branch`
 * reads: every workflow on the head commit, or one named workflow's
 * newest run, the verdict the worst of the lines'.
 *
 * No case spawns `gh`: `run list` is answered by `src/ci/runs-fake.ts`
 * and `run view --log-failed` by a stand-in handing back the capture
 * under `src/ci/testdata/`. Controls: the newer skipped run of another
 * workflow is read alone beside the case where it sits over a failed
 * one, so the red is seen to come from the failed workflow; the green
 * case reads the call log
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
 *
 * The effort reading reads a planted dashboard through planted
 * `runCollect`, `readDashboard` and `now` seams, and the rechecks a
 * planted judge that answers `gone` for every bug and logs what it was
 * handed, so no case runs `rafa`, reads the store or spawns a test. The
 * five readings are rendered whole in their order; a dashboard that
 * throws runs beside the four others read, and a filed-since reading
 * that is not read beside the judge's call log, which the ordered case
 * shows at one call.
 */
import type { DashboardReadOptions } from './pit-effort.js';
import type { PitSeams } from './pit-readings.js';
import type { PitJudge, PitJudgedBug } from './pit-recheck.js';
import type { FakeRun } from '../ci/runs-fake.js';
import type { FiledIssue, OpenIssue, Tracker } from '@open-tomato/rafa/ports';
import type { GhResult, GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';
import type { Dashboard } from '@open-tomato/rafa-effort';

import { describe, expect, it } from 'bun:test';

import { createFakeRunsGh, RECORDED_STRETCH_111 } from '../ci/runs-fake.js';
import { headRunsArgs, runListArgs } from '../ci/runs.js';

import { FIRST_LINE_MAX, NO_FILED_ISSUES, NO_OPEN_ISSUES, readPitReadings, renderPitReadings } from './pit-readings.js';

const BRANCH = 'stretch/9';
const WORKFLOW = 'verify';
const SHA = 'c4da2c4c63b2e9d585d3a76ffbda1c49e3ce60d1';
/** A commit older than {@link SHA} on the same branch. */
const OLDER_SHA = '7ade9b90aa11bb22cc33dd44ee55ff6677889900';
/** A second workflow, as its runs carry it. */
const FRAGMENT = 'Release bot fragment';

/** The captured failed log of run 37190089292: three cases in one file. */
const THREE_CASES = await Bun.file(new URL('../ci/testdata/three-cases.log-failed.txt', import.meta.url)).text();
const GATE_FILE = 'src/tests/task-gate-spawned.test.ts';

/** The cut-off every case reads from. */
const SINCE = new Date('2026-10-07T10:00:00.000Z');

/** The item's plan stub, the key of its planted effort row. */
const STUB = 'rafa-812-pit-readings';

/** The root and stub every case reads the effort for. */
const ITEM = { root: '/planted/root', stub: STUB };

/** The `Effort:` line the planted dashboard renders. */
const EFFORT_LINE = `Effort: ${STUB}: 5 tasks, p50 1.5 min against 2.0 min, max 4.3 min.`;

/** A dashboard holding the item's plan row, five tasks, and a `minutes` baseline of 2 min. */
function plantedDashboard(): Dashboard {
  const planted = {
    trend: { metrics: [{ name: 'minutes', baselineP50: 2 }] },
    loops: { rows: [{ key: STUB, kind: 'plan', tasks: 5, perTask: { minutes: { min: null, avg: null, p50: 1.483, max: 4.318 } } }] },
  };
  return planted as unknown as Dashboard;
}

/** What the planted effort and recheck seams were asked. */
interface PlantedLog {
  /** The bugs of each judge call. */
  readonly judged: (readonly PitJudgedBug[])[];
  readonly dashboards: DashboardReadOptions[];
}

/** The effort and recheck seams: a collect ending 0, the planted dashboard or `read`, and a judge answering `gone`. */
function plantedSeams(read: () => Promise<Dashboard> = () => Promise.resolve(plantedDashboard())): {
  seams: Pick<PitSeams, 'runCollect' | 'readDashboard' | 'now' | 'judge'>;
  log: PlantedLog;
} {
  const log: PlantedLog = { judged: [], dashboards: [] };
  const judge: PitJudge = (bugs) => {
    log.judged.push([...bugs]);
    return Promise.resolve({
      rows: bugs.map((entry) => ({ issue: entry.issue, verdict: 'gone' as const, runs: 3, failedRuns: null, reason: null, reproduce: null })),
    });
  };
  return {
    seams: {
      runCollect: () => Promise.resolve(0),
      readDashboard: (options) => {
        log.dashboards.push(options);
        return read();
      },
      now: () => new Date('2026-10-07T13:00:00.000Z'),
      judge,
    },
    log,
  };
}

/** `seams` with the planted effort and recheck seams beside them. */
function withPlanted(seams: Pick<PitSeams, 'gh' | 'tracker'>): PitSeams {
  return { ...seams, ...plantedSeams().seams };
}

/** The rendered lines before the `Effort:` line: CI and the two bug readings. */
function bugLines(lines: readonly string[]): string[] {
  const effort = lines.findIndex((line) => line.startsWith('Effort:'));
  return effort === -1
    ? [...lines]
    : lines.slice(0, effort);
}

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
  return withPlanted({ gh, tracker: caseTracker(open, filed).tracker });
}

describe('the CI reading', () => {
  it('reads a green run with no log, and a red run with its failed cases by file', async () => {
    const green = caseGh([plantedRun()]);
    const red = caseGh([plantedRun({ conclusion: 'failure' })]);

    const greenReading = await readPitReadings(seams(green.gh, []), { branch: BRANCH, workflow: WORKFLOW, since: SINCE, ...ITEM });
    const redReading = await readPitReadings(seams(red.gh, []), { branch: BRANCH, workflow: WORKFLOW, since: SINCE, ...ITEM });

    expect(greenReading.ci.ok && greenReading.ci.value.verdict).toBe('green');
    expect(green.calls().some((args) => args[1] === 'view')).toBe(false);
    expect(red.calls()).toContainEqual(['run', 'view', '37190089292', '--log-failed']);
    if (!redReading.ci.ok) throw new Error(redReading.ci.reason);
    expect(redReading.ci.value.verdict).toBe('red');
    expect(redReading.ci.value.exitCode).toBe(1);
    const [line] = redReading.ci.value.workflows;
    expect(line?.failed?.map((file) => file.file)).toEqual([GATE_FILE]);
    expect(line?.failed?.[0]?.cases).toHaveLength(3);
  });

  it('reads red when a failed workflow sits under a newer skipped run of another on the head commit', async () => {
    const skipped = plantedRun({ databaseId: 37190099001, workflowName: FRAGMENT, conclusion: 'skipped', createdAt: '2026-10-07T04:00:00Z' });
    const failed = plantedRun({ conclusion: 'failure' });
    const both = caseGh([skipped, failed]);
    const alone = caseGh([skipped]);

    const reading = await readPitReadings(seams(both.gh, []), { branch: BRANCH, since: SINCE, ...ITEM });
    const control = await readPitReadings(seams(alone.gh, []), { branch: BRANCH, since: SINCE, ...ITEM });

    if (!reading.ci.ok) throw new Error(reading.ci.reason);
    expect(reading.ci.value.verdict).toBe('red');
    expect(reading.ci.value.exitCode).toBe(1);
    expect(reading.ci.value.commit).toBe(SHA);
    expect(reading.ci.value.workflows.map((line) => [line.workflow, line.verdict])).toEqual([[FRAGMENT, 'green'], [WORKFLOW, 'red']]);
    expect(both.calls()).toContainEqual(['run', 'view', '37190089292', '--log-failed']);
    expect(both.calls()).not.toContainEqual(['run', 'view', '37190099001', '--log-failed']);
    expect(control.ci.ok && control.ci.value.verdict).toBe('green');
  });

  it('reads the head commit\'s workflows alone, not an older commit\'s red run', async () => {
    const head = plantedRun({ databaseId: 37190099002, conclusion: 'success', createdAt: '2026-10-07T04:00:00Z' });
    const older = plantedRun({ databaseId: 37190011111, headSha: OLDER_SHA, conclusion: 'failure', createdAt: '2026-10-06T04:00:00Z' });
    const ci = caseGh([head, older]);

    const reading = await readPitReadings(seams(ci.gh, []), { branch: BRANCH, since: SINCE, ...ITEM });

    if (!reading.ci.ok) throw new Error(reading.ci.reason);
    expect(reading.ci.value.verdict).toBe('green');
    expect(reading.ci.value.workflows.map((line) => line.run.id)).toEqual([37190099002]);
    expect(ci.calls().some((args) => args[1] === 'view')).toBe(false);
  });

  it('holds the red verdict and exit 1 on the planted 90471b00 pair, a skipped run newest above two failed ones', async () => {
    const pair = RECORDED_STRETCH_111.filter((run) => run.headSha.startsWith('90471b00'));
    const ci = caseGh(pair);

    const reading = await readPitReadings(seams(ci.gh, []), { branch: 'stretch/111', since: SINCE, ...ITEM });

    if (!reading.ci.ok) throw new Error(reading.ci.reason);
    expect(reading.ci.value.verdict).toBe('red');
    expect(reading.ci.value.exitCode).toBe(1);
    expect(reading.ci.value.workflows.map((line) => [line.workflow, line.verdict, line.run.id]))
      .toEqual([[FRAGMENT, 'green', 41456634201], [WORKFLOW, 'red', 41456633215]]);
  });

  it('reads running while one workflow of the head commit has not finished beside a green one', async () => {
    const running = plantedRun({ databaseId: 37190099003, workflowName: FRAGMENT, status: 'in_progress', conclusion: '', createdAt: '2026-10-07T04:00:00Z' });
    const ci = caseGh([running, plantedRun()]);

    const reading = await readPitReadings(seams(ci.gh, []), { branch: BRANCH, since: SINCE, ...ITEM });

    expect(reading.ci.ok && [reading.ci.value.verdict, reading.ci.value.exitCode]).toEqual(['running', 3]);
  });

  it('sends --workflow only when one is named', async () => {
    const any = caseGh([plantedRun()]);

    await readPitReadings(seams(any.gh, []), { branch: BRANCH, since: SINCE, ...ITEM });

    expect(any.calls().filter((args) => args[1] === 'list').length).toBeGreaterThan(0);
    for (const args of any.calls()) expect(args).not.toContain('--workflow');
  });

  it('reads one workflow\'s newest run when one is named, and the head commit\'s runs when none is', async () => {
    const named = caseGh([plantedRun()]);
    const unnamed = caseGh([plantedRun()]);

    await readPitReadings(seams(named.gh, []), { branch: BRANCH, workflow: WORKFLOW, since: SINCE, ...ITEM });
    await readPitReadings(seams(unnamed.gh, []), { branch: BRANCH, since: SINCE, ...ITEM });

    const lists = (calls: readonly (readonly string[])[]): (readonly string[])[] => calls.filter((args) => args[0] === 'run' && args[1] === 'list');
    expect(lists(named.calls())).toEqual([runListArgs({ branch: BRANCH, workflow: WORKFLOW })]);
    expect(lists(unnamed.calls())).toEqual([runListArgs({ branch: BRANCH }), headRunsArgs(BRANCH, SHA)]);
  });

  it('holds a gh failure as not read, and still reads the bugs', async () => {
    const unknownWorkflow = caseGh([plantedRun()]);

    const reading = await readPitReadings(seams(unknownWorkflow.gh, [OLD]), { branch: BRANCH, workflow: 'nope', since: SINCE, ...ITEM });

    expect(reading.ci.ok).toBe(false);
    expect(!reading.ci.ok && reading.ci.reason).toContain('could not find any workflows named nope');
    expect(reading.openBugs).toEqual({ ok: true, value: 1 });
  });
});

describe('the open-bug count', () => {
  it('counts the open bugs through openIssues(\'bug\') alone, not the filed listing', async () => {
    const closedSince = bug('814', 'a bug filed and closed during the item', '2026-10-07T11:30:00Z');
    const { tracker, asked } = caseTracker([OLD, NEW_A, NEW_B], [NEW_A, NEW_B, closedSince]);

    const reading = await readPitReadings(withPlanted({ gh: caseGh([]).gh, tracker }), { branch: BRANCH, since: SINCE, ...ITEM });

    expect(asked.open).toEqual(['bug']);
    expect(reading.openBugs).toEqual({ ok: true, value: 3 });
    expect(reading.filedSince.ok && reading.filedSince.value.bugs).toHaveLength(3);
  });

  it('reads as not read on a tracker without openIssues, never as zero, and still lists the filed bugs', async () => {
    const filedOnly: Pick<Tracker, 'openIssues' | 'filedIssues'> = { filedIssues: () => Promise.resolve([NEW_A]) };

    const reading = await readPitReadings(withPlanted({ gh: caseGh([]).gh, tracker: filedOnly }), { branch: BRANCH, since: SINCE, ...ITEM });

    expect(reading.openBugs).toEqual({ ok: false, reason: NO_OPEN_ISSUES });
    expect(reading.filedSince.ok && reading.filedSince.value.bugs.map((filed) => filed.id)).toEqual(['812']);
  });

  it('holds an openIssues that throws as not read, and still lists the filed bugs', async () => {
    const tracker: Pick<Tracker, 'openIssues' | 'filedIssues'> = {
      openIssues: () => Promise.reject(new Error('gh issue list failed: offline')),
      filedIssues: () => Promise.resolve([NEW_A]),
    };

    const reading = await readPitReadings(withPlanted({ gh: caseGh([plantedRun()]).gh, tracker }), { branch: BRANCH, since: SINCE, ...ITEM });

    expect(reading.openBugs).toEqual({ ok: false, reason: 'gh issue list failed: offline' });
    expect(reading.filedSince.ok).toBe(true);
    expect(reading.ci.ok).toBe(true);
  });
});

describe('the bugs filed since', () => {
  it('asks filedIssues(\'bug\', since) once, with the cut-off', async () => {
    const { tracker, asked } = caseTracker([OLD], [NEW_A]);

    await readPitReadings(withPlanted({ gh: caseGh([]).gh, tracker }), { branch: BRANCH, since: SINCE, ...ITEM });

    expect(asked.filed).toEqual([['bug', SINCE.toISOString()]]);
  });

  it('lists the bugs filed after the cut-off, oldest first, and drops one filed at it', async () => {
    const reading = await readPitReadings(seams(caseGh([]).gh, [], [AT_CUT, NEW_A, NEW_B]), { branch: BRANCH, since: SINCE, ...ITEM });

    if (!reading.filedSince.ok) throw new Error(reading.filedSince.reason);
    expect(reading.filedSince.value.since).toBe(SINCE.toISOString());
    expect(reading.filedSince.value.bugs.map((filed) => filed.id)).toEqual(['813', '812']);
  });

  it('reads no bug as filed since when the listing holds none after the cut-off', async () => {
    const reading = await readPitReadings(seams(caseGh([]).gh, [OLD, OLDER], []), { branch: BRANCH, since: SINCE, ...ITEM });

    expect(reading.filedSince).toEqual({ ok: true, value: { since: SINCE.toISOString(), bugs: [] } });
    expect(reading.openBugs).toEqual({ ok: true, value: 2 });
  });

  it('reads the times off the filed listing, with no gh call for a bug', async () => {
    const quiet = caseGh([]);

    const reading = await readPitReadings(seams(quiet.gh, [OLD], [NEW_A, NEW_B]), { branch: BRANCH, since: SINCE, ...ITEM });

    if (!reading.filedSince.ok) throw new Error(reading.filedSince.reason);
    expect(reading.filedSince.value.bugs.map((filed) => filed.filedAt)).toEqual(['2026-10-07T11:00:00.000Z', '2026-10-07T12:00:00.000Z']);
    expect(quiet.calls().filter((args) => args[0] === 'issue')).toEqual([]);
    expect(quiet.calls().some((args) => args[0] === 'run')).toBe(true);
  });

  it('refuses to guess when a time does not parse, naming every such bug, and keeps the count', async () => {
    const dated = await readPitReadings(seams(caseGh([]).gh, [OLD], [NEW_A, NEW_B]), { branch: BRANCH, since: SINCE, ...ITEM });
    const reading = await readPitReadings(
      seams(caseGh([]).gh, [OLD], [bug('812', NEW_A.title, 'soon'), NEW_B, bug('815', 'a third bug', '')]),
      { branch: BRANCH, since: SINCE, ...ITEM },
    );

    expect(dated.filedSince.ok).toBe(true);
    expect(reading.filedSince).toEqual({ ok: false, reason: 'no filing time for #812, #815' });
    expect(reading.openBugs).toEqual({ ok: true, value: 1 });
  });

  it('reads as not read on a tracker without filedIssues, never as none, and keeps the count', async () => {
    const openOnly: Pick<Tracker, 'openIssues' | 'filedIssues'> = { openIssues: () => Promise.resolve([OLD, NEW_A]) };

    const reading = await readPitReadings(withPlanted({ gh: caseGh([]).gh, tracker: openOnly }), { branch: BRANCH, since: SINCE, ...ITEM });

    expect(reading.openBugs).toEqual({ ok: true, value: 2 });
    expect(reading.filedSince).toEqual({ ok: false, reason: NO_FILED_ISSUES });
  });

  it('reads both bug readings as not read, each with its own reason, on a tracker with neither member', async () => {
    const reading = await readPitReadings(withPlanted({ gh: caseGh([]).gh, tracker: {} }), { branch: BRANCH, since: SINCE, ...ITEM });

    expect(reading.openBugs).toEqual({ ok: false, reason: NO_OPEN_ISSUES });
    expect(reading.filedSince).toEqual({ ok: false, reason: NO_FILED_ISSUES });
  });

  it('holds a filedIssues that throws as not read, while the count from openIssues prints', async () => {
    const tracker: Pick<Tracker, 'openIssues' | 'filedIssues'> = {
      openIssues: () => Promise.resolve([OLD, NEW_A]),
      filedIssues: () => Promise.reject(new Error('gh issue list --search failed: rate limited')),
    };

    const lines = renderPitReadings(await readPitReadings(withPlanted({ gh: caseGh([]).gh, tracker }), { branch: BRANCH, since: SINCE, ...ITEM }));

    expect(bugLines(lines).slice(-2)).toEqual([
      'Bugs: 2 open.',
      'Filed since the last item: not read: gh issue list --search failed: rate limited',
    ]);
  });

  it('reads a cut-off that is no time as not read, and asks the tracker nothing for it', async () => {
    const { tracker, asked } = caseTracker([OLD], [NEW_A]);

    const reading = await readPitReadings(withPlanted({ gh: caseGh([]).gh, tracker }), { branch: BRANCH, since: new Date('not a time'), ...ITEM });

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

    const reading = await readPitReadings(seams(caseGh([]).gh, [], [several, empty, blank]), { branch: BRANCH, since: SINCE, ...ITEM });

    if (!reading.filedSince.ok) throw new Error(reading.filedSince.reason);
    expect(reading.filedSince.value.bugs.map((filed) => filed.firstLine)).toEqual(['The run read red on main.', null, null]);
    expect(bugLines(renderPitReadings(reading)).slice(-3)).toEqual([
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

    const reading = await readPitReadings(seams(caseGh([]).gh, [], [over, under]), { branch: BRANCH, since: SINCE, ...ITEM });

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

    const lines = renderPitReadings(await readPitReadings(seams(caseGh([]).gh, open, [closed]), { branch: 'stretch/7', since: cutoff, ...ITEM }));

    expect(bugLines(lines).slice(-3)).toEqual([
      'Bugs: 3 open.',
      'Filed since 2026-10-14T01:29:39.610Z: 1.',
      '   #1084 the bug the loop filed: A gate failed on the stretch branch.',
    ]);
  });
});

describe('the rendered lines', () => {
  it('prints the red run, its cases, the count and the new bugs', async () => {
    const red = caseGh([plantedRun({ conclusion: 'failure' })]);

    const lines = renderPitReadings(await readPitReadings(seams(red.gh, [OLD, NEW_A]), { branch: BRANCH, workflow: WORKFLOW, since: SINCE, ...ITEM }));

    expect(lines.slice(0, 3)).toEqual([
      `CI: ❌ ${BRANCH} (${WORKFLOW}): red on c4da2c4, 1 workflow.`,
      `   ❌ ${WORKFLOW} run 37190089292 is failure.`,
      `     ${GATE_FILE}`,
    ]);
    expect(bugLines(lines).slice(-3)).toEqual([
      'Bugs: 2 open.',
      `Filed since ${SINCE.toISOString()}: 1.`,
      '   #812 a bug from this item: The gate read red.',
    ]);
  });

  it('prints a branch with no run, no new bug, and each reading not read with its reason', async () => {
    const quiet = renderPitReadings(await readPitReadings(seams(caseGh([]).gh, [OLD], []), { branch: BRANCH, since: SINCE, ...ITEM }));
    const unread = renderPitReadings({
      ci: { ok: false, reason: 'gh offline' },
      openBugs: { ok: false, reason: NO_OPEN_ISSUES },
      filedSince: { ok: false, reason: NO_FILED_ISSUES },
      effort: { effort: { ok: false, reason: 'rafa effort collect could not start' }, collect: { exitCode: null, seconds: 0 } },
      rechecks: { ok: false, reason: NO_FILED_ISSUES },
    });

    expect(quiet).toEqual([
      `CI: ⚪ No run on ${BRANCH}.`,
      'Bugs: 1 open.',
      `Filed since ${SINCE.toISOString()}: none.`,
      EFFORT_LINE,
      'Recheck: no bug filed since.',
    ]);
    expect(unread).toEqual([
      'CI: not read: gh offline',
      `Bugs: not read: ${NO_OPEN_ISSUES}`,
      `Filed since the last item: not read: ${NO_FILED_ISSUES}`,
      'Effort: not read (rafa effort collect could not start).',
      `Recheck: not read (${NO_FILED_ISSUES}).`,
    ]);
  });
});

describe('the effort and recheck readings beside the three others', () => {
  it('prints the five readings in order: CI, Bugs, Filed since, Effort, then a Recheck line per bug filed since', async () => {
    const planted = plantedSeams();
    const ci = caseGh([plantedRun()]);

    const reading = await readPitReadings(
      { gh: ci.gh, tracker: caseTracker([OLD, NEW_A], [NEW_A, NEW_B]).tracker, ...planted.seams },
      { branch: BRANCH, workflow: WORKFLOW, since: SINCE, ...ITEM },
    );

    expect(renderPitReadings(reading)).toEqual([
      `CI: ✅ ${BRANCH} (${WORKFLOW}): green on c4da2c4, 1 workflow.`,
      `   ✅ ${WORKFLOW} run 37190089292 is success.`,
      'Bugs: 2 open.',
      `Filed since ${SINCE.toISOString()}: 2.`,
      '   #813 another bug from this item',
      '   #812 a bug from this item: The gate read red.',
      EFFORT_LINE,
      'Recheck #813: gone',
      'Recheck #812: gone',
    ]);
    expect(reading.effort.collect).toEqual({ exitCode: 0, seconds: 0 });
    expect(planted.log.dashboards.map((options) => options.repoRoot)).toEqual([ITEM.root]);
    expect(planted.log.judged).toEqual([[
      { ref: NEW_B.ref, issue: 813, title: NEW_B.title, body: NEW_B.body, author: null },
      { ref: NEW_A.ref, issue: 812, title: NEW_A.title, body: NEW_A.body, author: null },
    ]]);
  });

  it('prints an effort reading that failed as not read, and the four others still read', async () => {
    const planted = plantedSeams(() => Promise.reject(new Error('the effort store is locked')));

    const lines = renderPitReadings(await readPitReadings(
      { gh: caseGh([]).gh, tracker: caseTracker([OLD], [NEW_A]).tracker, ...planted.seams },
      { branch: BRANCH, since: SINCE, ...ITEM },
    ));

    expect(lines).toEqual([
      `CI: ⚪ No run on ${BRANCH}.`,
      'Bugs: 1 open.',
      `Filed since ${SINCE.toISOString()}: 1.`,
      '   #812 a bug from this item: The gate read red.',
      'Effort: not read (the effort store is locked).',
      'Recheck #812: gone',
    ]);
    expect(planted.log.dashboards).toHaveLength(1);
  });

  it('prints Recheck: not read when the filed-since reading failed, the judge never called', async () => {
    const planted = plantedSeams();
    const tracker: Pick<Tracker, 'openIssues' | 'filedIssues'> = {
      openIssues: () => Promise.resolve([OLD]),
      filedIssues: () => Promise.reject(new Error('gh issue list --search failed: rate limited')),
    };

    const lines = renderPitReadings(await readPitReadings({ gh: caseGh([]).gh, tracker, ...planted.seams }, { branch: BRANCH, since: SINCE, ...ITEM }));

    expect(lines.slice(-3)).toEqual([
      'Filed since the last item: not read: gh issue list --search failed: rate limited',
      EFFORT_LINE,
      'Recheck: not read (gh issue list --search failed: rate limited).',
    ]);
    expect(planted.log.judged).toEqual([]);
  });
});
