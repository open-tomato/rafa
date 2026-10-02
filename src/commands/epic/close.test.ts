/**
 * Tests for `rafa epic close` (`close.ts`): the line, the epic read off
 * the listing and its refusals, the planning step, the report a failed
 * check is filed as, and the command dispatched over a planted `gh`, a
 * planted `git`, a planted Claude spawner, a planted effort store and a
 * public tracker that is a `local` one under the case's own project.
 *
 * The board: epic #40 on `epic:auth`, open, with two criteria and an
 * estimate, whose members #12 and #13 are closed. Epic #41 on
 * `epic:billing` has #21 open and #22 closed. Epic #42 on `epic:draft`
 * holds only the template's placeholder criterion; epic #43 on
 * `epic:bare` has no criteria section; each has one closed member. Epic
 * #44 on `epic:lonely` has no member, #45 carries no `epic:` label, #50 is
 * a closed epic and #61 is no epic.
 *
 * The planted spawner tells the planning session from a check session by
 * the prompt's first line (`VERIFY_PROMPT_PREFIX`, `CHECK_PROMPT_PREFIX`)
 * and answers each from the case's script; a check is answered by the
 * criterion text its prompt carries.
 *
 * ## The controls
 *
 * - The closing case records an `issue close` call, so the filter every
 *   refusal asserts empty is shown able to find one; and it records three
 *   sessions and the four git steps, so the refusals' empty session and
 *   git lists are readings that could have been otherwise.
 * - The failing criterion is run twice over one project: the first run
 *   creates one issue and the second comments on it, so the recurrence
 *   key is shown stable rather than assumed.
 * - The uncheckable case is run with and without `--accept-unchecked`
 *   over the same script, so the flag is what changes the outcome.
 */
import type { EpicCloseSeams } from './close.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { RafaCommand } from '../../cli/command.js';
import type { EffortStore } from '../../effort/store/types.js';
import type { EpicCriterion } from '../../epic/verify-plan.js';
import type { CheckAnswered } from '../../epic/verify-run.js';
import type { Tracker } from '../../ports/index.js';
import type { GitResult, GitRunner } from '../../pr/git.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { CapturedSession, CapturingSpawner } from '../../utils/claude.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalTracker } from '../../adapters/tracker/local.js';
import { CRITERIA_PLACEHOLDERS, PLACEHOLDER_REASON } from '../../board/epic-template.js';
import { renderCloseComment } from '../../board/epic-trail.js';
import { parseBoardListing } from '../../board/roadmap-board.js';
import { MEMBERSHIP_NOTE, renderEpicCost } from '../../effort/epic-cost.js';
import { splitCriteria, VERIFY_PROMPT_PREFIX } from '../../epic/verify-plan.js';
import { CHECK_PROMPT_PREFIX, verifyWorktreePath } from '../../epic/verify-run.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';
import { bugKeyOf } from '../../triage/triage.js';

import closeCommand, {
  closeTriageFile,
  createEpicCloseCommand,
  EPIC_CLOSE_REFUSAL_EXIT,
  failedCheckArtifact,
  failedCheckReport,
  planFlags,
  planVerification,
  readCloseLine,
  readEpicToClose,
} from './close.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-close-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command is dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** Epic #40's two criteria, as written. */
const CRITERION_1 = '- `rafa roadmap` shows each epic with its state.';
const CRITERION_2 = '- `rafa epics` shows one epic\'s issues.';

/** Epic #40's body. */
const BODY_40 = `Estimate: two weeks\n\n## Acceptance criteria\n\n${CRITERION_1}\n${CRITERION_2}\n\n## Specs\n\n- [x] #12 a\n- [x] #13 b\n`;

/** One issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function raw(number: number, labels: readonly string[], options: { state?: 'OPEN' | 'CLOSED'; body?: string } = {}): object {
  const state = options.state ?? 'CLOSED';
  return {
    number,
    title: `issue ${String(number)}`,
    body: options.body ?? '',
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: labels.map((name) => ({ name })),
  };
}

/** The board the module note describes. */
const LISTING: readonly object[] = [
  raw(40, ['type:epic', 'epic:auth', 'horizon:now'], { state: 'OPEN', body: BODY_40 }),
  raw(12, ['epic:auth']),
  raw(13, ['epic:auth']),
  raw(41, ['type:epic', 'epic:billing'], { state: 'OPEN', body: BODY_40 }),
  raw(21, ['epic:billing'], { state: 'OPEN' }),
  raw(22, ['epic:billing']),
  raw(42, ['type:epic', 'epic:draft'], { state: 'OPEN', body: `Estimate: soon\n\n## Acceptance criteria\n\n${CRITERIA_PLACEHOLDERS[0] ?? ''}\n` }),
  raw(31, ['epic:draft']),
  raw(43, ['type:epic', 'epic:bare'], { state: 'OPEN', body: 'Estimate: a day\n' }),
  raw(32, ['epic:bare']),
  raw(44, ['type:epic', 'epic:lonely'], { state: 'OPEN', body: BODY_40 }),
  raw(45, ['type:epic'], { state: 'OPEN', body: BODY_40 }),
  raw(50, ['type:epic', 'epic:old']),
  raw(61, ['type:feature'], { state: 'OPEN' }),
];

/** The board, parsed as the command reads it. */
const ISSUES = parseBoardListing(JSON.stringify(LISTING), 'gh issue list');

/** The commit `origin/main` resolves to. */
const COMMIT = 'abc1234def';

/** A planned answer: `check` or `uncheckable` per criterion number. */
type PlanAnswer = Readonly<Record<number, { readonly check: string } | { readonly uncheckable: string }>>;

/** The planning session's output for `answer`. */
function planOutput(answer: PlanAnswer): string {
  const entries = Object.entries(answer).map(([number, entry]) => ('check' in entry
    ? `  - criterion: ${number}\n    check: "${entry.check}"`
    : `  - criterion: ${number}\n    uncheckable: "${entry.uncheckable}"`));
  return `Planned.\n\n\`\`\`rafa:verify\ncriteria:\n${entries.join('\n')}\n\`\`\`\n`;
}

/** A check session's output answering `result`. */
function verdictOutput(result: 'pass' | 'fail', evidence: string): string {
  return `Checked.\n\n\`\`\`rafa:verdict\nresult: ${result}\nevidence: "${evidence}"\n\`\`\`\n`;
}

/** Every criterion planned as a check named after it. */
const BOTH_CHECKS: PlanAnswer = { 1: { check: 'Run rafa roadmap' }, 2: { check: 'Run rafa epics' } };

/** What the planted spawner answers. */
interface Script {
  /** The planning session's output; the exit code is `planExit`. */
  readonly plan?: string;
  readonly planExit?: number;
  /** A check's output, by the check text its prompt carries. */
  readonly checks?: Readonly<Record<string, CapturedSession>>;
}

/** One session the planted spawner started. */
interface Spawned {
  readonly kind: 'plan' | 'check';
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

/** A spawner answering `script`, recording each session. */
function plantedSpawner(script: Script): { spawn: CapturingSpawner; spawned: Spawned[] } {
  const spawned: Spawned[] = [];
  const spawn: CapturingSpawner = (args, prompt, options) => {
    const kind = prompt.startsWith(VERIFY_PROMPT_PREFIX)
      ? 'plan'
      : 'check';
    spawned.push({ kind, args: [...args], cwd: options?.cwd });
    if (kind === 'plan') return Promise.resolve({ exitCode: script.planExit ?? 0, stdout: script.plan ?? planOutput(BOTH_CHECKS) });
    expect(prompt.startsWith(CHECK_PROMPT_PREFIX)).toBe(true);
    const found = Object.entries(script.checks ?? {}).find(([check]) => prompt.includes(check));
    return Promise.resolve(found?.[1] ?? { exitCode: 0, stdout: verdictOutput('pass', 'it printed what it should') });
  };
  return { spawn, spawned };
}

/** A `gh` answering the listing and every close, recording each call. */
function plantedGh(options: { failClose?: boolean } = {}): { gh: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    const words = args.join(' ');
    const answer = (result: GhResult): Promise<GhResult> => Promise.resolve(result);
    if (args[0] === 'issue' && args[1] === 'list' && words.includes('--state all')) {
      return answer({ ok: true, stdout: JSON.stringify(LISTING), stderr: '' });
    }
    if (args[0] === 'issue' && args[1] === 'close') {
      return answer(options.failClose === true
        ? { ok: false, stdout: '', stderr: 'HTTP 403: Resource not accessible' }
        : { ok: true, stdout: '', stderr: '' });
    }
    return answer({ ok: false, stdout: '', stderr: `unplanted: gh ${words}` });
  };
  return { gh, calls };
}

/** A `git` whose steps succeed unless `failFetch`, or `silentRemove` fails the removal saying nothing; recording every call. */
function plantedGit(options: { failFetch?: boolean; silentRemove?: boolean } = {}): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = (args): GitResult => {
    calls.push([...args]);
    if (args[0] === 'fetch' && options.failFetch === true) return { ok: false, stdout: '', stderr: 'fatal: unable to access origin' };
    if (args[0] === 'rev-parse') return { ok: true, stdout: `${COMMIT}\n`, stderr: '' };
    if (args[1] === 'remove' && options.silentRemove === true) return { ok: false, stdout: '', stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  };
  return { git, calls };
}

/** A store holding one session of member #12, one of #13 by plan stub, and one of an issue in no epic. */
function plantedStore(): EffortStore {
  const usage = { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  const rows = [
    { sessionId: 's1', issueIdentifier: 'RAFA-12', planStub: null, firstTimestamp: '2026-09-01T10:00:00Z', lastTimestamp: '2026-09-01T11:00:00Z', usage },
    { sessionId: 's2', issueIdentifier: null, planStub: 'rafa-13-thing', firstTimestamp: '2026-09-02T10:00:00Z', lastTimestamp: '2026-09-02T10:30:00Z', usage },
    { sessionId: 's3', issueIdentifier: 'RAFA-99', planStub: null, firstTimestamp: '2026-09-02T10:00:00Z', lastTimestamp: '2026-09-02T12:00:00Z', usage },
  ];
  const read = (() => rows) as unknown as EffortStore['read'];
  return { read, append: () => { throw new Error('the gate appends nothing'); }, keys: () => new Set() } as unknown as EffortStore;
}

/** A tracker that records every create and comment before a `local` tracker makes them. */
function spiedTracker(inner: Tracker): { tracker: Tracker; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    tracker: {
      ...inner,
      create: (draft) => {
        calls.push(`create ${draft.title}`);
        return inner.create(draft);
      },
      comment: (issue, body) => {
        calls.push(`comment ${issue.externalId}`);
        return inner.comment(issue, body);
      },
    },
  };
}

/** What one case runs with. */
interface CaseSetup {
  readonly script?: Script;
  readonly failClose?: boolean;
  readonly failFetch?: boolean;
  readonly silentRemove?: boolean;
  readonly failStore?: boolean;
  /** The project to run in; a fresh one when left out. */
  readonly project?: PlantedProject;
  readonly env?: Readonly<Record<string, string>>;
}

/** A fresh project whose public tracker is `local`. */
function plantCase(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: local\n');
}

/** Dispatches `rafa epic close <words>` over every planted seam. */
async function run(words: readonly string[], setup: CaseSetup = {}) {
  const project = setup.project ?? plantCase();
  const gh = plantedGh({ failClose: setup.failClose });
  const git = plantedGit({ failFetch: setup.failFetch, silentRemove: setup.silentRemove });
  const claude = plantedSpawner(setup.script ?? {});
  const publicTracker = spiedTracker(createLocalTracker({ issuesDir: join(project.root, '.rafa', 'issues'), fallbackReason: null }));
  let ids = 0;
  const seams: EpicCloseSeams = {
    gh: gh.gh,
    git: git.git,
    spawn: claude.spawn,
    sessionId: () => {
      ids += 1;
      return `session-${String(ids)}`;
    },
    openStore: () => {
      if (setup.failStore === true) throw new Error('store.db is locked');
      return plantedStore();
    },
    resolve: () => Promise.resolve({ tracker: publicTracker.tracker, degraded: false, reason: null } as never),
  };
  const commands: RafaCommand[] = [createEpicCloseCommand(seams)];
  const outcome = await dispatchInProject(['epic', 'close', ...words], [EPIC_SUBJECT], commands, project, setup.env);
  return { ...outcome, project, ghCalls: gh.calls, gitCalls: git.calls, spawned: claude.spawned, trackerCalls: publicTracker.calls };
}

/** The `gh issue close` calls a run made. */
function closesOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[0] === 'issue' && call[1] === 'close');
}

/** One criterion by its text, as `splitCriteria` cuts #40's section. */
function criterionOf(text: string): EpicCriterion {
  const found = splitCriteria(`${CRITERION_1}\n${CRITERION_2}`).find((each) => each.text === text);
  if (found === undefined) throw new Error(`no criterion ${text}`);
  return found;
}

describe('readCloseLine', () => {
  it('reads one epic number and the flag', () => {
    expect(readCloseLine({ args: ['40'], flags: {} })).toEqual({ epic: 40, acceptUnchecked: false });
    expect(readCloseLine({ args: ['40'], flags: { 'accept-unchecked': true } })).toEqual({ epic: 40, acceptUnchecked: true });
  });

  it.each([
    [[], 'Expected one epic number, got none'],
    [['40', '41'], 'Expected one epic number, got 2: 40 41'],
    [['0'], '"0" is no epic number'],
    [['#40'], '"#40" is no epic number'],
  ])('refuses %j with exit code 1', (args, message) => {
    expect(() => readCloseLine({ args, flags: {} })).toThrow(message);
  });

  it('refuses a value typed into --accept-unchecked', () => {
    expect(() => readCloseLine({ args: ['40'], flags: { 'accept-unchecked': 'yes' } })).toThrow('--accept-unchecked takes no value');
  });
});

describe('readEpicToClose', () => {
  it('answers the epic, its slug, its closed members and its body', () => {
    const target = readEpicToClose(ISSUES, 40);

    expect(target.slug).toBe('auth');
    expect(target.members.map((member) => member.number)).toEqual([12, 13]);
    expect(target.body.estimate).toBe('two weeks');
  });

  it('refuses an open member, naming each open one and no closed one', () => {
    let thrown: unknown;
    try {
      readEpicToClose(ISSUES, 41);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as { exitCode?: number }).exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect((thrown as Error).message).toContain('Epic #41 has 1 open member: #21 issue 21.');
    expect((thrown as Error).message).not.toContain('#22');
    expect((thrown as Error).message).toContain('No session was started');
  });

  it.each([
    [99, '#99 is not on the board listing'],
    [61, '#61 is not an epic'],
    [50, 'Epic #50 is closed already'],
    [45, 'Epic #45 carries no epic: label'],
    [44, 'Epic #44 has no members'],
  ])('refuses #%d', (number, message) => {
    expect(() => readEpicToClose(ISSUES, number)).toThrow(message);
  });
});

describe('planVerification', () => {
  const criteria = splitCriteria(`${CRITERION_1}\n${CRITERION_2}`);
  const epic = ISSUES.find((issue) => issue.number === 40);
  if (epic === undefined) throw new Error('no #40');

  it('spawns one planning session in the root with Read, Grep and Glob, and reads its answer', async () => {
    const claude = plantedSpawner({});

    const planning = await planVerification({ epic, criteria, root: '/r', settingSources: ['project'], spawn: claude.spawn, sessionId: () => 'plan-1' });

    expect(planning.status).toBe('planned');
    expect(claude.spawned).toHaveLength(1);
    expect(claude.spawned[0]?.cwd).toBe('/r');
    expect(claude.spawned[0]?.args.slice(-4)).toEqual(planFlags('plan-1'));
    expect(planFlags('plan-1')).toEqual(['--session-id', 'plan-1', '--tools', 'Read,Grep,Glob']);
  });

  it('answers absent for a session that exited non-zero, even with a block', async () => {
    const claude = plantedSpawner({ planExit: 1 });

    const planning = await planVerification({ epic, criteria, root: '/r', settingSources: [], spawn: claude.spawn, sessionId: () => 'p' });

    expect(planning).toEqual({ status: 'absent', sessionId: 'p', text: 'the planning session exited 1' });
  });

  it('starts no session when every criterion is a placeholder, answering each uncheckable', async () => {
    const claude = plantedSpawner({});
    const placeholders = splitCriteria(CRITERIA_PLACEHOLDERS[0] ?? '');

    const planning = await planVerification({ epic, criteria: placeholders, root: '/r', settingSources: [], spawn: claude.spawn, sessionId: () => 'p' });

    expect(claude.spawned).toHaveLength(0);
    expect(planning.status === 'planned' && planning.verdicts.map((verdict) => verdict.kind === 'uncheckable' && verdict.reason)).toEqual([PLACEHOLDER_REASON]);
  });
});

describe('failedCheckReport', () => {
  it('is one public bug and no blocker, its artifact the epic and criterion on one line', () => {
    const criterion = criterionOf(CRITERION_2);
    const failure: CheckAnswered = {
      kind: 'answered',
      check: { kind: 'check', criterion, check: 'Run rafa epics' },
      sessionId: 's',
      result: 'fail',
      evidence: 'it printed nothing',
    };

    const report = failedCheckReport(40, failure, COMMIT);

    expect(report.blockers).toEqual([]);
    expect(report.outOfScopeBugs).toHaveLength(1);
    expect(report.outOfScopeBugs[0]?.security).toBe(false);
    expect(report.outOfScopeBugs[0]?.what).toBe(`Epic #40 acceptance criterion 2 fails against main: ${CRITERION_2}`);
    expect(report.outOfScopeBugs[0]?.artifact).toBe(failedCheckArtifact(40, criterion));
    expect(report.feedback).toContain(`Evidence, against commit ${COMMIT}:\nit printed nothing`);
    expect(bugKeyOf(closeTriageFile('/r', 40), failedCheckArtifact(40, criterion))).toBe(`epic-40-close: epic # acceptance criterion: ${CRITERION_2}`);
  });
});

describe('rafa epic close, dispatched', () => {
  it('refuses with exit 2 while a member is open, naming it, with no session, no git and no write', async () => {
    const outcome = await run(['41']);

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.stderr).toContain('Epic #41 has 1 open member: #21 issue 21.');
    expect(outcome.spawned).toEqual([]);
    expect(outcome.gitCalls).toEqual([]);
    expect(closesOf(outcome.ghCalls)).toEqual([]);
  });

  it('closes the epic when every check passes, with the trail\'s comment, and prints the cost beside the estimate', async () => {
    const outcome = await run(['40']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.spawned.map((session) => session.kind)).toEqual(['plan', 'check', 'check']);
    const worktree = verifyWorktreePath(outcome.project.home, 40);
    expect(outcome.gitCalls).toEqual([
      ['fetch', 'origin'],
      ['rev-parse', '--verify', 'origin/main^{commit}'],
      ['worktree', 'add', '--detach', worktree, COMMIT],
      ['worktree', 'remove', '--force', worktree],
    ]);
    expect(outcome.spawned.slice(1).map((session) => session.cwd)).toEqual([worktree, worktree]);
    const comment = renderCloseComment({ passed: [CRITERION_1, CRITERION_2], unchecked: [] });
    expect(closesOf(outcome.ghCalls)).toEqual([['issue', 'close', '40', '--reason=completed', `--comment=${comment}`]]);
    const [costLine] = renderEpicCost({ runs: 2, wallSeconds: 5400, runsWithoutTime: 0, tokens: 2400 }, 'two weeks');
    expect(outcome.stdout).toContain(`${costLine ?? ''}\n${MEMBERSHIP_NOTE}\n`);
    expect(costLine).toStartWith('cost: 2 runs · ');
    expect(costLine).toEndWith(' — estimate: two weeks');
    expect(outcome.stdout).toContain(`Closed epic #40 as completed: 2 criteria passed against ${COMMIT}.`);
    expect(outcome.trackerCalls).toEqual([]);
  });

  it('files a failed check as one bug and refuses; a second run comments on that issue', async () => {
    const script: Script = {
      checks: { 'Run rafa epics': { exitCode: 0, stdout: verdictOutput('fail', 'it printed no issues') } },
    };
    const first = await run(['40'], { script });

    expect(first.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(first.stderr).toContain(`Epic #40 was not closed: against ${COMMIT}, 1 criterion failed its check, each filed as a bug.`);
    expect(first.trackerCalls).toEqual([`create Epic #40 acceptance criterion 2 fails against main: ${CRITERION_2}`]);
    expect(first.stdout).toContain('Criterion 2: filed on the public tracker as local issue');
    expect(closesOf(first.ghCalls)).toEqual([]);

    const second = await run(['40'], { script, project: first.project });

    expect(second.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(second.trackerCalls.map((call) => call.split(' ')[0])).toEqual(['comment']);
    expect(second.stdout).toContain('Criterion 2: recurs in local issue');
  });

  it('refuses on an uncheckable criterion before any check runs, naming it with its reason', async () => {
    const script: Script = { plan: planOutput({ 1: { check: 'Run rafa roadmap' }, 2: { uncheckable: 'It needs a person to judge.' } }) };

    const outcome = await run(['40'], { script });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.stdout).toContain(`warn: Uncheckable criterion 2: ${CRITERION_2} — It needs a person to judge.`);
    expect(outcome.stderr).toContain('pass --accept-unchecked to close over them');
    expect(outcome.spawned.map((session) => session.kind)).toEqual(['plan']);
    expect(outcome.gitCalls).toEqual([]);
    expect(closesOf(outcome.ghCalls)).toEqual([]);
  });

  it('closes over the uncheckable criterion with --accept-unchecked, naming it in the comment', async () => {
    const script: Script = { plan: planOutput({ 1: { check: 'Run rafa roadmap' }, 2: { uncheckable: 'It needs a person to judge.' } }) };

    const outcome = await run(['40', '--accept-unchecked'], { script });

    expect(outcome.exitCode).toBe(0);
    const comment = renderCloseComment({ passed: [CRITERION_1], unchecked: [{ criterion: CRITERION_2, reason: 'It needs a person to judge.' }] });
    expect(closesOf(outcome.ghCalls)).toEqual([['issue', 'close', '40', '--reason=completed', `--comment=${comment}`]]);
    expect(outcome.stdout).toContain('1 criterion passed against abc1234def, 1 criterion closed over with --accept-unchecked.');
  });

  it('refuses on a check that answered nothing, filing nothing', async () => {
    const script: Script = { checks: { 'Run rafa epics': { exitCode: 0, stdout: '' } } };

    const outcome = await run(['40'], { script });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.stderr).toContain('1 criterion got no answer; run the close again to ask again');
    expect(outcome.trackerCalls).toEqual([]);
    expect(closesOf(outcome.ghCalls)).toEqual([]);
  });

  it('refuses a plan with no rafa:verify block, running no check', async () => {
    const outcome = await run(['40'], { script: { plan: 'I could not decide.' } });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.stderr).toContain('The verification plan for epic #40 answered nothing');
    expect(outcome.gitCalls).toEqual([]);
  });

  it('refuses an epic whose criteria are all placeholders with no session, and an epic with none', async () => {
    const draft = await run(['42']);
    const bare = await run(['43']);

    expect(draft.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(draft.stdout).toContain(`warn: Uncheckable criterion 1: ${CRITERIA_PLACEHOLDERS[0] ?? ''} — ${PLACEHOLDER_REASON}`);
    expect(draft.spawned).toEqual([]);
    expect(bare.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(bare.stderr).toContain('Epic #43 has no acceptance criteria');
    expect(bare.spawned).toEqual([]);
  });

  it('exits 1 when git cannot fetch, running no check and closing nothing', async () => {
    const outcome = await run(['40'], { failFetch: true });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('git fetch origin failed: fatal: unable to access origin');
    expect(outcome.spawned.map((session) => session.kind)).toEqual(['plan']);
    expect(closesOf(outcome.ghCalls)).toEqual([]);
  });

  it('warns when git refuses the worktree removal saying nothing, naming the command, and still closes', async () => {
    const outcome = await run(['40'], { silentRemove: true });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('warn: The verification worktree was not removed: git said nothing; remove it with git worktree remove --force ');
    expect(closesOf(outcome.ghCalls)).toHaveLength(1);
  });

  it('exits 1 when gh refuses the close', async () => {
    const outcome = await run(['40'], { failClose: true });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('Every check passed, but epic #40 could not be closed');
  });

  it('closes and warns when the store cannot be read', async () => {
    const outcome = await run(['40'], { failStore: true });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('warn: The epic is closed, but its cost could not be read from the effort store: store.db is locked');
    expect(closesOf(outcome.ghCalls)).toHaveLength(1);
  });

  it('gives the close as the json result', async () => {
    const outcome = await run(['40', '--output=json']);

    expect(outcome.exitCode).toBe(0);
    const result = eventsOf(outcome.stdout).find((event) => event.type === 'result') as { data?: Record<string, unknown> } | undefined;
    expect(result?.data?.['status']).toBe('closed');
    expect(result?.data?.['passed']).toEqual([1, 2]);
    expect(result?.data?.['commit']).toBe(COMMIT);
    expect(result?.data?.['estimate']).toBe('two weeks');
  });
});

describe('the declaration', () => {
  it('is the close action of the epic subject, with <n> and --accept-unchecked, and always spends', () => {
    expect([closeCommand.name, closeCommand.subject, closeCommand.action]).toEqual(['epic close', 'epic', 'close']);
    expect(closeCommand.args?.map((arg) => [arg.name, arg.required])).toEqual([['n', true]]);
    expect(closeCommand.flags.map((flag) => [flag.name, flag.type])).toEqual([['accept-unchecked', 'boolean']]);
    expect(closeCommand.spends).toEqual({ when: 'always', what: 'one verification planning session and one session per check' });
    expect(closeCommand.outputs).toEqual(['text', 'json']);
    expect(Object.isFrozen(closeCommand)).toBe(true);
  });
});
