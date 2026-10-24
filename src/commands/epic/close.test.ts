/**
 * Tests for `rafa epic close` (`close.ts`): the line, the epic read off
 * the listing and its refusals, the planning step, and the command
 * dispatched over a planted `gh`, a planted `git`, a planted Claude
 * spawner, a planted effort store and a public tracker that is a `local`
 * one under the case's own project. The report a failed check is filed
 * as, and the line each filed bug is reported with, are tested in
 * `./close-triage.test.ts`.
 *
 * The board: epic #40 on `epic:auth`, open, with two criteria and an
 * estimate, whose members #12 and #13 are closed. Epic #41 on
 * `epic:billing` has #21 open and #22 closed. Epic #42 on `epic:draft`
 * holds only the template's placeholder criterion; epic #43 on
 * `epic:bare` has no criteria section; each has one closed member. Epic
 * #44 on `epic:lonely` has no member, #45 carries no `epic:` label, #50 is
 * a closed epic and #61 is no epic. Epic #46 on `epic:pages`, its member
 * #14 closed, has one criterion naming only a page and one naming a source
 * file beside it.
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
 * - Epic #46's two criteria fail in one run: the one naming a source file
 *   is filed as a bug, so the page-only one reaching no bug is its route
 *   and not a tracker that files nothing.
 *
 * ## The project's own cases
 *
 * The cases adding a filed bug to the project set `board.project.number`
 * and plant a public tracker spied as kind `github`, whose `create`
 * answers a GitHub ref to {@link FILED_ISSUE}. Their `gh` answers the
 * repository read, the roadmap and the listing (the board's, with the
 * filed issue and the roadmap beside it) itself, and routes every
 * `gh api` call to the facts fake (`board/project/facts-fake.ts`) or the
 * project fake (`board/project/project-fake.ts`), as
 * `src/start/triage.test.ts` builds it, so the real refresh fills the
 * added item and no case reaches `gh`. The refused add is read beside the
 * same close with the number unset, whose exit code, bug line and
 * refusal line it matches.
 *
 * ## The triage service
 *
 * With no `triageReport` seam the close files through
 * `activeServices().triageReport`, core's service registry, which the
 * preload has filled with the real set. The stubbed cases register
 * `{ ...activeServices(), triageReport: stub }`, keep what that call
 * answered and put it back in `afterEach`; the unregistered case puts the
 * set to none for its body and back after. The stub skips every bug, so
 * its lines and the tracker's empty call list tell it from the real
 * triage, which files on the planted tracker.
 */
import type { EpicCloseSeams } from './close.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';
import type { CapturedSession, CapturingSpawner } from '@open-tomato/rafa/core/loop';
import type { RafaServices, TriageServiceOptions } from '@open-tomato/rafa/core/services';
import type { IssueRef, Tracker } from '@open-tomato/rafa/ports';
import type { EffortStore } from '@open-tomato/rafa/store/types';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { activeServices, registerServices, restoreServices } from '@open-tomato/rafa/core/services';
import { readStaleDocsForPlan } from '@open-tomato/rafa/store/stale-docs';
import { MEMBERSHIP_NOTE, renderEpicCost } from '@open-tomato/rafa-effort/effort/epic-cost';

import { draftFixture } from '../../adapters/tracker/contract.js';
import { createLocalTracker } from '../../adapters/tracker/local.js';
import { CRITERIA_PLACEHOLDERS, PLACEHOLDER_REASON } from '../../board/epic-template.js';
import { renderCloseComment } from '../../board/epic-trail.js';
import { createFakeFactsGh } from '../../board/project/facts-fake.js';
import { createGhProjectPort } from '../../board/project/gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY } from '../../board/project/project-fake.js';
import { scopeWarning } from '../../board/project/refresh-warnings.js';
import { parseBoardListing } from '../../board/roadmap-board.js';
import { staleDocsTitle } from '../../docs/release-issue.js';
import { splitCriteria, VERIFY_PROMPT_PREFIX } from '../../epic/verify-plan.js';
import { CHECK_PROMPT_PREFIX, verifyWorktreePath } from '../../epic/verify-run.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';
import { triageReport } from '../../triage/triage.js';

import closeCommand, {
  createEpicCloseCommand,
  EPIC_CLOSE_REFUSAL_EXIT,
  planFlags,
  planVerification,
  readCloseLine,
  readEpicToClose,
} from './close.js';
import { EPIC_PROJECT_NUMBER, recordingEpicRefresh, withProjectNumber } from './epic-project-fake.js';

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

/** Epic #46's two criteria: a page alone, and a source file beside it. */
const PAGE_CRITERION = '- `context/triage.md` names the four channels.';
const SOURCE_CRITERION = '- `src/triage/triage.ts` and `context/triage.md` agree on the channels.';

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
  raw(46, ['type:epic', 'epic:pages'], { state: 'OPEN', body: `Estimate: a day\n\n## Acceptance criteria\n\n${PAGE_CRITERION}\n${SOURCE_CRITERION}\n` }),
  raw(14, ['epic:pages']),
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
function plantedGh(options: { failClose?: boolean; route?: GhRunner } = {}): { gh: GhRunner; calls: (readonly string[])[] } {
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
    if (options.route !== undefined) return options.route(args);
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

/**
 * A tracker that records every create and comment before a `local` tracker
 * makes them; with `github`, one of kind `github` whose every create
 * answers that ref instead.
 */
function spiedTracker(inner: Tracker, githubRefs?: IssueRef | readonly IssueRef[]): { tracker: Tracker; calls: string[]; bodies: string[] } {
  const calls: string[] = [];
  const bodies: string[] = [];
  const refs = githubRefs === undefined || Array.isArray(githubRefs)
    ? githubRefs as readonly IssueRef[] | undefined
    : [githubRefs as IssueRef];
  const github = refs?.[0];
  let created = 0;
  return {
    calls,
    bodies,
    tracker: {
      ...inner,
      kind: github === undefined
        ? inner.kind
        : 'github',
      create: (draft) => {
        calls.push(`create ${draft.title}`);
        bodies.push(draft.body);
        // The nth create answers the nth ref, the last one thereafter.
        const ref = refs?.[Math.min(created, (refs.length) - 1)];
        created += 1;
        return ref === undefined
          ? inner.create(draft)
          : Promise.resolve(ref);
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
  /** The project refresh; the system's own when left out. */
  readonly projectRefresh?: EpicCloseSeams['projectRefresh'];
  /** Triages each failed check; the system's own when left out. */
  readonly triageReport?: EpicCloseSeams['triageReport'];
  /** The ref each create answers in turn (the last one repeating), on a public tracker of kind `github`; a `local` one's own when left out. */
  readonly github?: IssueRef | readonly IssueRef[];
  /** Answers the `gh` calls the planted `gh` was not planted for; refused when left out. */
  readonly route?: GhRunner;
}

/** The version every case's stale-docs issue is titled for. */
const STALE_DOCS_VERSION = '1.4.0';

/** The config every case runs with but those opting into a project. */
const LOCAL_CONFIG = 'tracker:\n  default: local\n';

/** A fresh project whose public tracker is `local`, its config `config`. */
function plantCase(config: string = LOCAL_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** Dispatches `rafa epic close <words>` over every planted seam. */
async function run(words: readonly string[], setup: CaseSetup = {}) {
  const project = setup.project ?? plantCase();
  const gh = plantedGh({ failClose: setup.failClose, route: setup.route });
  const git = plantedGit({ failFetch: setup.failFetch, silentRemove: setup.silentRemove });
  const claude = plantedSpawner(setup.script ?? {});
  const publicTracker = spiedTracker(createLocalTracker({ issuesDir: join(project.root, '.rafa', 'issues'), fallbackReason: null }), setup.github);
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
    staleDocsVersion: () => STALE_DOCS_VERSION,
    sleep: () => Promise.resolve(),
    ...setup.projectRefresh === undefined
      ? {}
      : { projectRefresh: setup.projectRefresh },
    ...setup.triageReport === undefined
      ? {}
      : { triageReport: setup.triageReport },
  };
  const commands: RafaCommand[] = [createEpicCloseCommand(seams)];
  const outcome = await dispatchInProject(['epic', 'close', ...words], [EPIC_SUBJECT], commands, project, setup.env);
  return {
    ...outcome, project, git: git.git, ghCalls: gh.calls, gitCalls: git.calls, spawned: claude.spawned, trackerCalls: publicTracker.calls,
    trackerBodies: publicTracker.bodies,
  };
}

/** The `gh issue close` calls a run made. */
function closesOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[0] === 'issue' && call[1] === 'close');
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
    // The title is rendered from the record: the epic's module and action
    // ahead of the summary, which is cut to the default 80 code points.
    expect(first.trackerCalls).toEqual(['create epic - close: Epic #40 acceptance criterion 2 fails against main: - `rafa epics` shows one...']);
    expect(first.stdout).toContain('Criterion 2: filed on the public tracker as local issue');
    expect(closesOf(first.ghCalls)).toEqual([]);

    const second = await run(['40'], { script, project: first.project });

    expect(second.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(second.trackerCalls.map((call) => call.split(' ')[0])).toEqual(['comment']);
    expect(second.stdout).toContain('Criterion 2: recurs in local issue');
  });

  it('hands triage the root as the checkout, the run\'s git, its environment and its config, and the bug its module, action and reproduce', async () => {
    const script: Script = {
      checks: { 'Run rafa epics': { exitCode: 0, stdout: verdictOutput('fail', 'it printed no issues') } },
    };
    const handed: TriageServiceOptions[] = [];
    const spy: RafaServices['triageReport'] = (options) => {
      handed.push(options);
      return triageReport(options);
    };
    const env = { RAFA_CLOSE_PROBE: 'on' };

    const project = plantCase(`${LOCAL_CONFIG}issues:\n  vocabulary:\n    modules: [epic, triage]\n`);

    const outcome = await run(['40'], { script, env, project, triageReport: spy });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(handed).toHaveLength(1);
    const [options] = handed;
    expect(options?.checkout).toBe(outcome.project.root);
    expect(options?.repoRoot).toBe(outcome.project.root);
    expect(options?.git).toBe(outcome.git);
    expect(options?.env?.RAFA_CLOSE_PROBE).toBe('on');
    expect(options?.bugRules?.modules).toEqual(['epic', 'triage']);
    const bug = options?.report.outOfScopeBugs[0];
    expect([bug?.module, bug?.action, bug?.reproduce, bug?.cause]).toEqual(['epic', 'close', 'rafa epic close 40', null]);
    expect(outcome.trackerBodies).toHaveLength(1);
    const body = outcome.trackerBodies[0] ?? '';
    expect(body).toContain(`## What\n\n\`\`\`\n${bug?.what ?? 'no what'}\n\`\`\``);
    expect(body).toContain('## Task\n\n```\nrafa epic close 40\n```');
  });

  it('sends a failed page-only criterion to the docs channel and still files one naming a source file as a bug', async () => {
    const script: Script = {
      plan: planOutput({ 1: { check: 'Read the triage page' }, 2: { check: 'Compare the module with the page' } }),
      checks: {
        'Read the triage page': { exitCode: 0, stdout: verdictOutput('fail', 'it names three channels') },
        'Compare the module with the page': { exitCode: 0, stdout: verdictOutput('fail', 'they disagree') },
      },
    };

    const outcome = await run(['46'], { script });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.trackerCalls).toHaveLength(2);
    expect(outcome.trackerCalls[0]).toBe(`create ${staleDocsTitle(STALE_DOCS_VERSION)}`);
    expect(outcome.trackerCalls[1]).toStartWith('create epic - close: Epic #46 acceptance criterion 2 fails against main: - `src/triage/triage.ts`');
    expect(outcome.stdout).toContain(`Criterion 1: names only documentation, so no bug is filed; opened local issue 1, ${staleDocsTitle(STALE_DOCS_VERSION)}, with the line.`);
    expect(outcome.stdout).toContain('Criterion 2: filed on the public tracker as local issue 2.');
    expect(outcome.stderr).toContain('1 criterion failed its check, each filed as a bug, and 1 criterion naming only documentation failed,'
      + ' each a line on the release\'s stale-docs issue.');
    const rows = readStaleDocsForPlan(outcome.project.root, null);
    expect(rows.map((row) => [row.kind, row.planStub, row.what])).toEqual([
      ['unsettled', null, `Epic #46 acceptance criterion 1 fails against main: ${PAGE_CRITERION}`],
    ]);
    expect(closesOf(outcome.ghCalls)).toEqual([]);
  });

  it('adds a repeated page-only failure to the same issue once, filing no bug', async () => {
    const script: Script = {
      plan: planOutput({ 1: { check: 'Read the triage page' }, 2: { check: 'Compare the module with the page' } }),
      checks: { 'Read the triage page': { exitCode: 0, stdout: verdictOutput('fail', 'it names three channels') } },
    };
    const first = await run(['46'], { script });

    const second = await run(['46'], { script, project: first.project });

    expect(first.trackerCalls).toEqual([`create ${staleDocsTitle(STALE_DOCS_VERSION)}`]);
    expect(second.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(second.trackerCalls).toEqual([]);
    expect(second.stdout).toContain(`Criterion 1: names only documentation, so no bug is filed; local issue 1, ${staleDocsTitle(STALE_DOCS_VERSION)}, already holds the line.`);
    expect(second.stderr).toContain('1 criterion naming only documentation failed, each a line on the release\'s stale-docs issue.');
    expect(second.stderr).not.toContain('filed as a bug');
  });

  /** A fresh project under `extraConfig` whose local tracker holds one open bug worded near criterion 2's failure. */
  async function projectWithNearBug(extraConfig: string): Promise<PlantedProject> {
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), `tracker:\n  default: local\n${extraConfig}`);
    const body = [
      '## What', '', '```', 'Epic #40 acceptance criterion 2 fails against main: rafa epics shows one epic\'s issues', '```', '',
      '## Artifact', '', '```', 'epic #40 acceptance criterion: rafa epics lists one epic\'s issues', '```', '',
    ].join('\n');
    const draft = draftFixture({ title: 'rafa epics lists one epic\'s issues', body, module: 'unassigned', priority: null, project: null });
    await createLocalTracker({ issuesDir: join(project.root, '.rafa', 'issues'), fallbackReason: null }).create(draft);
    return project;
  }

  it('comments on an open bug worded near a failed check, under the run\'s similarity settings', async () => {
    const script: Script = {
      checks: { 'Run rafa epics': { exitCode: 0, stdout: verdictOutput('fail', 'it printed no issues') } },
    };

    const outcome = await run(['40'], { script, project: await projectWithNearBug('') });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.trackerCalls).toEqual(['comment 1']);
    expect(outcome.stdout).toContain('Criterion 2: recurs in local issue 1 on the public tracker; commented on it.');
  });

  it('files the failed check beside that open bug with the similarity step turned off, the control', async () => {
    const script: Script = {
      checks: { 'Run rafa epics': { exitCode: 0, stdout: verdictOutput('fail', 'it printed no issues') } },
    };
    const off = 'triage:\n  similarity:\n    threshold: false\n';

    const outcome = await run(['40'], { script, project: await projectWithNearBug(off) });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.trackerCalls.map((call) => call.split(' ')[0])).toEqual(['create']);
    expect(outcome.stdout).toContain('Criterion 2: filed on the public tracker as local issue 2.');
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

describe('rafa epic close, and the project', () => {
  it('refreshes the closed epic with its members and the shifted Ranks, its warning after the cost', async () => {
    const recorded = recordingEpicRefresh(['a project warning']);

    const outcome = await run(['40'], { project: plantCase(withProjectNumber(LOCAL_CONFIG)), projectRefresh: recorded.refresh });

    expect(outcome.exitCode).toBe(0);
    expect(recorded.calls()).toEqual([{ number: EPIC_PROJECT_NUMBER, issues: [40], widening: { membersOf: [40], shiftedRanks: true } }]);
    expect(outcome.stdout).toEndWith(`${MEMBERSHIP_NOTE}\nwarn: a project warning\n`);
  });

  it('calls no refresh for the same close with board.project.number unset, the control of the case above', async () => {
    const recorded = recordingEpicRefresh(['a project warning']);

    const outcome = await run(['40'], { projectRefresh: recorded.refresh });

    expect(outcome.exitCode).toBe(0);
    expect(recorded.calls()).toEqual([]);
    expect(outcome.stdout).toEndWith(`${MEMBERSHIP_NOTE}\n`);
  });

  it('calls no refresh for a close the gate refused or gh would not make', async () => {
    const recorded = recordingEpicRefresh();
    const config = withProjectNumber(LOCAL_CONFIG);

    const open = await run(['41'], { project: plantCase(config), projectRefresh: recorded.refresh });
    const refused = await run(['40'], { failClose: true, project: plantCase(config), projectRefresh: recorded.refresh });

    expect([open.exitCode, refused.exitCode]).toEqual([EPIC_CLOSE_REFUSAL_EXIT, 1]);
    expect(recorded.calls()).toEqual([]);
  });
});

/** The owner of the fake repository and of its project. */
const PROJECT_OWNER = 'open-tomato';

/** The issue the `github` public tracker files each bug as: one the fake repository holds, on no epic. */
const FILED_ISSUE = 70;

/** The issue the second failed check's bug is filed as. */
const SECOND_FILED_ISSUE = 71;

/** The ref the `github` public tracker answers for the second bug it files. */
const SECOND_FILED_REF: IssueRef = {
  opt: 0,
  kind: 'github',
  externalId: String(SECOND_FILED_ISSUE),
  url: `https://github.com/${FAKE_PROJECT_REPOSITORY}/issues/${String(SECOND_FILED_ISSUE)}`,
};

/** Both criteria's checks failing. */
const FAIL_BOTH: Script = {
  checks: {
    'Run rafa roadmap': { exitCode: 0, stdout: verdictOutput('fail', 'it showed no epic') },
    'Run rafa epics': { exitCode: 0, stdout: verdictOutput('fail', 'it printed no issues') },
  },
};

/** The roadmap issue the scene's listing and facts hold. */
const ROADMAP_ISSUE = 1;

/** The ref the `github` public tracker answers for each bug it files. */
const FILED_REF: IssueRef = {
  opt: 0,
  kind: 'github',
  externalId: String(FILED_ISSUE),
  url: `https://github.com/${FAKE_PROJECT_REPOSITORY}/issues/${String(FILED_ISSUE)}`,
};

/** GitHub's documented refusal for a token with no project scope, as `board/project/add-issue.test.ts` plants it; NOT a reading. */
const SCOPE_STDERR = 'gh: Your token has not been granted the required scopes to execute this query. The \'projectV2\' field requires one of the following scopes: [\'read:project\'], but your token has only been granted the: [\'repo\'] scopes.\n';

/** A failed check of criterion 2, the one each project case files. */
const FAIL_2: Script = {
  checks: { 'Run rafa epics': { exitCode: 0, stdout: verdictOutput('fail', 'it printed no issues') } },
};

/** The line criterion 2's bug is reported with once filed as {@link FILED_REF}. */
const FILED_LINE = `Criterion 2: filed on the public tracker as ${FILED_REF.url ?? ''}.`;

/** The project fake holding no item, and the router answering what the planted `gh` was not planted for. */
interface ProjectScene {
  readonly project: ReturnType<typeof createFakeProjectGh>;
  readonly route: GhRunner;
}

/** {@link ProjectScene}: the repository read and the roadmap answered here, every `gh api` call routed to a fake. */
function projectScene(): ProjectScene {
  const project = createFakeProjectGh({
    projects: [{ owner: PROJECT_OWNER, number: EPIC_PROJECT_NUMBER, items: [] }],
    owners: [PROJECT_OWNER],
    repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues: [FILED_ISSUE, SECOND_FILED_ISSUE] }],
  });
  const facts = createFakeFactsGh({
    issues: [
      { number: ROADMAP_ISSUE, state: 'OPEN', labels: ['type:roadmap'] },
      { number: FILED_ISSUE, state: 'OPEN', labels: ['type:bug'] },
      { number: SECOND_FILED_ISSUE, state: 'OPEN', labels: ['type:bug'] },
    ],
  });
  const answered = (value: unknown): Promise<GhResult> => Promise.resolve({ ok: true, stdout: JSON.stringify(value), stderr: '' });
  const route: GhRunner = (args) => {
    const line = args.join(' ');
    if (line === 'repo view --json nameWithOwner') return answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY });
    if (line.startsWith('issue list --label type:roadmap --state open')) return answered([raw(ROADMAP_ISSUE, ['type:roadmap'], { state: 'OPEN' })]);
    if (args[0] === 'api' && args.includes('owner={owner}')) return facts.gh(args);
    if (args[0] === 'api') return project.gh(args);
    return Promise.resolve({ ok: false, stdout: '', stderr: `unrouted: gh ${line}` });
  };
  return { project, route };
}

/** The Stage each issue's item on the project holds, by issue number, read through the project port. */
async function projectStages(gh: GhRunner): Promise<Readonly<Record<number, string | null>>> {
  return Object.fromEntries(await projectItems(gh));
}

/** The issues on the project with their Stage, in the order its items were added, read through the project port. */
async function projectItems(gh: GhRunner): Promise<readonly (readonly [number, string | null])[]> {
  const port = createGhProjectPort(gh);
  const found = await port.find({ owner: PROJECT_OWNER, number: EPIC_PROJECT_NUMBER });
  const items = await port.items(found?.id ?? '');
  return items.flatMap(({ content, values }) => {
    if (content.kind !== 'issue') return [];
    const stage = values.get('Stage');
    return [[content.number, stage?.kind === 'option'
      ? stage.name
      : null] as const];
  });
}

/** The lines of a text run's stdout, each as written. */
function linesOf(stdout: string): readonly string[] {
  return stdout.split('\n').filter((line) => line !== '');
}

describe('rafa epic close, a failed check\'s bug onto the project', () => {
  it('adds the bug filed on a github tracker to the project with its Stage set, and still refuses the close', async () => {
    const scene = projectScene();

    const outcome = await run(['40'], { script: FAIL_2, project: plantCase(withProjectNumber(LOCAL_CONFIG)), github: FILED_REF, route: scene.route });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.stderr).toContain(`Epic #40 was not closed: against ${COMMIT}, 1 criterion failed its check, each filed as a bug.`);
    expect(linesOf(outcome.stdout)).toContain(FILED_LINE);
    expect(await projectStages(scene.project.gh)).toEqual({ [FILED_ISSUE]: 'Backlog' });
    // The gate's own line for the failed check, and no warning of the add.
    expect(linesOf(outcome.stdout).filter((line) => line.startsWith('warn: '))).toEqual([`warn: ✗ Failed criterion 2: ${CRITERION_2} — it printed no issues`]);
    expect(closesOf(outcome.ghCalls)).toEqual([]);
  });

  it('keeps the exit code, the bug line and the refusal line of the close with no project when the add is refused for the scope, the scope warning after the bug line', async () => {
    const refused = projectScene();
    refused.project.failNext(SCOPE_STDERR);
    const outcome = await run(['40'], { script: FAIL_2, project: plantCase(withProjectNumber(LOCAL_CONFIG)), github: FILED_REF, route: refused.route });

    const unset = projectScene();
    const control = await run(['40'], { script: FAIL_2, github: FILED_REF, route: unset.route });

    expect(control.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.exitCode).toBe(control.exitCode);
    expect(outcome.stderr).toBe(control.stderr);
    expect(outcome.stderr).toContain(`Epic #40 was not closed: against ${COMMIT}, 1 criterion failed its check, each filed as a bug.`);
    const lines = linesOf(outcome.stdout);
    expect(lines).toContain(FILED_LINE);
    expect(linesOf(control.stdout)).toContain(FILED_LINE);
    const scope = `warn: ${scopeWarning()}`;
    expect(lines).toContain(scope);
    expect(linesOf(control.stdout)).not.toContain(scope);
    expect(lines.indexOf(scope)).toBeGreaterThan(lines.indexOf(FILED_LINE));
    expect(await projectStages(refused.project.gh)).toEqual({});
  });

  it('records no project call for a bug filed on a local public tracker, beside the same close with board.project.number unset on a github tracker', async () => {
    const local = projectScene();
    const outcome = await run(['40'], { script: FAIL_2, project: plantCase(withProjectNumber(LOCAL_CONFIG)), route: local.route });

    const unset = projectScene();
    const control = await run(['40'], { script: FAIL_2, github: FILED_REF, route: unset.route });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(control.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.trackerCalls).toHaveLength(1);
    expect(local.project.calls()).toEqual([]);
    expect(linesOf(control.stdout)).toContain(FILED_LINE);
    expect(unset.project.calls()).toEqual([]);
  });

  it('adds the bugs of two failed checks in criterion order, each add warning a warn event in json mode', async () => {
    const scene = projectScene();
    const recorded = recordingEpicRefresh(['a project warning']);

    const outcome = await run(['40', '--output=json'], {
      script: FAIL_BOTH,
      project: plantCase(withProjectNumber(LOCAL_CONFIG)),
      github: [FILED_REF, SECOND_FILED_REF],
      route: scene.route,
      projectRefresh: recorded.refresh,
    });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(await projectItems(scene.project.gh)).toEqual([[FILED_ISSUE, null], [SECOND_FILED_ISSUE, null]]);
    const warnings = eventsOf(outcome.stdout)
      .filter((event) => event.type === 'log' && event.level === 'warn')
      .map((event) => (event as { message: string }).message)
      .filter((message) => message.includes('a project warning'));
    expect(warnings).toHaveLength(2);
  });
});

describe('rafa epic close, the triage service', () => {
  /** What the stub was handed, one entry per call. */
  type TriageCall = TriageServiceOptions;

  /** The set the stubbed setup replaced, put back after each case; undefined when none was set up. */
  let replaced: RafaServices | null | undefined;

  afterEach(() => {
    if (replaced !== undefined) restoreServices(replaced);
    replaced = undefined;
  });

  /** Registers a recording `triageReport` over the active set, skipping every bug; see the stage's stubbed setup. */
  function stubTriage(): readonly TriageCall[] {
    const calls: TriageCall[] = [];
    const stub: RafaServices['triageReport'] = (options) => {
      calls.push(options);
      return Promise.resolve({
        bugs: [{ channel: 'public', action: 'skipped', ref: null, problem: 'the stubbed triage skipped it' }],
        staleDocs: [],
      });
    };
    replaced = registerServices({ ...activeServices(), triageReport: stub });
    return calls;
  }

  it('calls the registered triageReport once per failed check when no triageReport seam is planted', async () => {
    const calls = stubTriage();

    const outcome = await run(['40'], { script: FAIL_BOTH });

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.report.outOfScopeBugs[0]?.what)).toEqual([
      `Epic #40 acceptance criterion 1 fails against main: ${CRITERION_1}`,
      `Epic #40 acceptance criterion 2 fails against main: ${CRITERION_2}`,
    ]);
    expect(calls.map((call) => call.repoRoot)).toEqual([outcome.project.root, outcome.project.root]);
    // The stub answered for the real triage, so the tracker saw nothing.
    expect(outcome.trackerCalls).toEqual([]);
    expect(linesOf(outcome.stdout)).toContain('warn: Criterion 1: not filed: the stubbed triage skipped it.');
    expect(linesOf(outcome.stdout)).toContain('warn: Criterion 2: not filed: the stubbed triage skipped it.');
  });

  it('warns not filed, naming triageReport and the root, while no service is registered, and still refuses the close', async () => {
    const held = registerServices({ ...activeServices() });
    restoreServices(null);
    let outcome: Awaited<ReturnType<typeof run>>;
    try {
      outcome = await run(['40'], { script: FAIL_2 });
    } finally {
      restoreServices(held);
    }

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(linesOf(outcome.stdout)).toContain('warn: Criterion 2: not filed: service registry: no service is registered:'
      + ' call registerCoreServices() from src/service-registry.ts before calling triageReport');
    expect(outcome.trackerCalls).toEqual([]);
    expect(outcome.stderr).toContain(`Epic #40 was not closed: against ${COMMIT}, 1 criterion failed its check, each filed as a bug.`);
  });
});
