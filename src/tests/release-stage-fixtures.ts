/**
 * What `src/start/release-stage.test.ts` and
 * `src/start/release-stage-forecast.test.ts` share: the plan, the
 * settings and the records a stubbed release stage runs over, and
 * {@link stub}, a complete stub of the stage's seams that records what
 * it was asked.
 *
 * Every effect is scripted: step 1 and step 3's readings are records
 * built here rather than taken from `release/prepare.ts` and
 * `release/verify.ts`, the git runner records the argv it was handed
 * and answers from a script, the forecast answers
 * {@link FORECAST} unless the case names another, and the provider is
 * a whole `PullRequests` whose unused members throw, so a stage
 * that started merging or commenting fails the case rather than
 * passing on an unread call.
 *
 * The provider is TWO seams and {@link stub} fills both: `readProvider`
 * answers which provider the repository resolves to, and `pulls` builds
 * it. A stub that filled only the second would send the real
 * `resolvePrProvider` at `/repo` and take whatever `git remote get-url
 * origin` answered in this checkout.
 *
 * {@link stub} sets the active output, which is module state: a file
 * using it resets it to null in an `afterEach`.
 */
import type { GitResult, PrProviderReading, PullRequestDetail, PullRequests, PullRequestSummary, PushOutcome } from '../pr/index.js';
import type { BranchForecast, BranchForecastInput } from '../release/branch-forecast.js';
import type { ChangelogNote } from '../release/changelog.js';
import type { Fragment } from '../release/fragment.js';
import type { ReleasePrepared, ReleaseSkipped } from '../release/prepare.js';
import type { ReleaseRefused, ReleaseVerified } from '../release/verify.js';
import type { ReleaseStageInput, ReleaseStageSeams, ReleaseStageSettings } from '../start/release-stage.js';

import { setActiveOutput } from '../adapters/output/active.js';
import { RELEASE_AUTO } from '../config-sections.js';
import { serializeFragment } from '../release/fragment.js';

import { sinkOutput } from './output-sinks.js';

export const REPO = '/repo';
export const BRANCH = 'feat/rafa-21-changelog-and-release';
export const PR = 21;
export const PLAN_ID = 'rafa-21-changelog-and-release';
export const FRAGMENT_PATH = `.changes/${PLAN_ID}.md`;
export const SUBJECT = `chore: release fragment ${PLAN_ID}`;
export const SHA = '9f1c0de1c0ffee0000000000000000000000abcd';
export const BASE_COMMIT = 'b'.repeat(40);

/** The settings a case runs under: this repository's defaults. */
export const SETTINGS: ReleaseStageSettings = {
  releaseEnabled: RELEASE_AUTO,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseHeading: '## {version} — {date}, {title}',
  releaseStrategy: 'semver-by-level',
  prBase: null,
};

/** A plan the way the loop writes one: a title heading and a `rafa:plan` block. */
export const PLAN = [
  '# Plan: rafa-21 — changelog and release',
  '',
  '```rafa:plan',
  `stub: ${PLAN_ID}`,
  'issue: "21"',
  'release: minor',
  '```',
  '',
  '- [x] Add the release stage',
].join('\n');

/** The notes the store answers for that plan. */
export const NOTES: readonly ChangelogNote[] = [
  { level: 'minor', area: 'loop', summary: 'the wrap-up now commits the release' },
];

export const STAGE_INPUT: ReleaseStageInput = {
  repoRoot: REPO,
  settings: SETTINGS,
  planStub: PLAN_ID,
  planContent: PLAN,
};

/** The fragment step 1 writes for that plan. */
export const FRAGMENT: Fragment = {
  plan: PLAN_ID,
  title: 'rafa-21 — changelog and release',
  level: 'minor',
  notes: ['- loop: the wrap-up now commits the release'],
};

/** A preparation that wrote the fragment, as `release/prepare.ts` answers one. */
export function prepared(over: Partial<ReleasePrepared> = {}): ReleasePrepared {
  return {
    kind: 'prepared',
    level: 'minor',
    levelSource: 'plan',
    notesLevel: 'minor',
    plan: PLAN_ID,
    fragment: FRAGMENT,
    file: { path: FRAGMENT_PATH, resolved: `${REPO}/${FRAGMENT_PATH}`, before: null, after: serializeFragment(FRAGMENT) },
    base: { ref: 'origin/main', commit: BASE_COMMIT, waiting: [] },
    fetched: true,
    problems: [],
    ...over,
  };
}

/** A preparation that wrote nothing, and the sentence it says so with. */
export const SKIP_SENTENCE = 'no release fragment: release.enabled is false in this project';

export const SKIPPED: ReleaseSkipped = {
  kind: 'skipped',
  reason: 'disabled',
  sentence: SKIP_SENTENCE,
  problems: [],
  level: 'minor',
  levelSource: 'plan',
  notesLevel: null,
};

/** A verification that passed, over the record above, the notes rewritten. */
export const VERIFIED: ReleaseVerified = {
  kind: 'verified',
  path: FRAGMENT_PATH,
  fragment: { ...FRAGMENT, notes: ['- loop: the wrap-up commits the release'] },
  text: serializeFragment({ ...FRAGMENT, notes: ['- loop: the wrap-up commits the release'] }),
};

/** A verification that refused, with step 1's text already back on disk. */
export const REFUSAL_SENTENCE = `no release commit: ${FRAGMENT_PATH} carries the level major, not the plan's minor,`
  + ` and ${FRAGMENT_PATH} was restored to the text the loop wrote`;

export const REFUSED: ReleaseRefused = {
  kind: 'refused',
  reason: 'level-changed',
  sentence: REFUSAL_SENTENCE,
  restore: { path: FRAGMENT_PATH, restored: true, problem: null },
};

/** What a pushed fragment's forecast answers unless a case names another. */
export const FORECAST: BranchForecast = {
  ok: true,
  ref: 'origin/main',
  baseVersion: '0.4.0',
  waiting: ['rafa-19'],
  forecast: {
    kind: 'ships',
    strategy: 'semver-by-level',
    baseVersion: '0.4.0',
    waiting: ['rafa-19'],
    version: '0.5.0',
    bump: 'minor',
    section: '## 0.5.0 — 2026-09-20, rafa-19; rafa-21 — changelog and release',
    sentence: 'ships as the next minor, 0.5.0 if merged now',
  },
  problems: [],
};

/** The forecast line {@link FORECAST} renders. */
export const FORECAST_LINE = 'Release forecast: this branch ships as the next minor, 0.5.0 if merged now'
  + ' (semver-by-level, origin/main at 0.4.0, 1 fragment waiting)';

/**
 * What `resolvePrProvider` answers for a repository with no GitHub
 * origin: the resolution the stage must read before it reaches for
 * `gh` at all. See `src/pr/provider.ts`.
 */
export const PROVIDER_NONE: PrProviderReading = { provider: 'none', source: 'remote', remote: null, host: null };

/** What that same reading answers for a GitHub origin, the control beside it. */
export const PROVIDER_GH: PrProviderReading = {
  provider: 'gh',
  source: 'remote',
  remote: 'git@github.com:open-tomato/rafa.git',
  host: 'github.com',
};

/** A `none` an operator asked for, over an origin that reads as GitHub. */
export const PROVIDER_NONE_CONFIGURED: PrProviderReading = { ...PROVIDER_GH, provider: 'none', source: 'config' };

/** A `none` an origin decided, that origin being somewhere else. */
export const PROVIDER_NONE_ELSEWHERE: PrProviderReading = {
  provider: 'none',
  source: 'remote',
  remote: 'git@gitlab.com:open-tomato/rafa.git',
  host: 'gitlab.com',
};

/** The problem a reading that is not `gh` leaves in the record. */
export function noProvider(because: string): string {
  return `this repository resolves to pr.provider: none, because ${because},`
    + ' so there is no pull request to write it to';
}

/** The pull request the provider answers for the branch. */
export const SUMMARY: PullRequestSummary = {
  number: PR,
  title: 'rafa-21: changelog and release in the loop',
  url: `https://github.com/open-tomato/rafa/pull/${PR}`,
  state: 'open',
  headRefName: BRANCH,
  baseRefName: 'main',
  author: { login: 'markosth', isBot: false },
  isCrossRepository: false,
  updatedAt: '2026-09-20T12:00:00Z',
};

/** That pull request in full, with the body a case plants. */
export function detail(body: string): PullRequestDetail {
  return {
    ...SUMMARY,
    body,
    headRefOid: 'deadbeef',
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
  };
}

/** A port member the stage must never reach. */
export function unreached(member: string): never {
  throw new Error(`unplanned ${member}`);
}

/** What a case plans for the stubbed effects to answer. */
export interface Script {
  /** What each git command answers, in the order they are sent. */
  readonly git?: readonly GitResult[];
  /** How the push ends. Absent, it succeeds. */
  readonly push?: PushOutcome;
  /** The pull request the branch has, or null for none. */
  readonly pull?: PullRequestSummary | null;
  /** That pull request read back in full, or null for none. */
  readonly detail?: PullRequestDetail | null;
  /** What the provider throws instead of answering, if anything. */
  readonly throws?: string;
  /** Which provider the repository resolves to. Absent, `gh`. */
  readonly provider?: PrProviderReading;
  /** What the forecast answers. Absent, {@link FORECAST}. */
  readonly forecast?: BranchForecast;
}

/** Everything one stubbed run recorded. */
export interface Recorded {
  readonly seams: Partial<ReleaseStageSeams>;
  /** Every git command, as one string per invocation. */
  readonly git: string[];
  /** Every effect that is not a git command, in order. */
  readonly calls: string[];
  /** Every body handed to `editBody`. */
  readonly bodies: string[];
  /** Every input the forecast was asked over. */
  readonly forecasts: BranchForecastInput[];
  /** Every message, by level. */
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
}

export const OK: GitResult = { ok: true, stdout: '', stderr: '' };
export const SHA_READ: GitResult = { ok: true, stdout: `${SHA}\n`, stderr: '' };
/** `git diff --cached --quiet` answering that something IS staged. */
export const STAGED: GitResult = { ok: false, stdout: '', stderr: '' };
export const PUSHED: PushOutcome = { ok: true, output: `branch '${BRANCH}' set up to track 'origin/${BRANCH}'.` };

/** The four commands a fragment commit sends when every one of them works. */
export const COMMITTED: readonly GitResult[] = [OK, STAGED, OK, SHA_READ];

/** The provider {@link stub} answers through, recording into `calls` and `bodies`. */
function stubPulls(script: Script, calls: string[], bodies: string[]): PullRequests {
  const ask = <T>(member: string, answer: () => T): Promise<T> => {
    calls.push(member);
    if (script.throws !== undefined) return Promise.reject(new Error(script.throws));
    return Promise.resolve(answer());
  };
  return {
    kind: 'gh',
    findOpen: (branch: string) => ask('findOpen', () => {
      const found = script.pull === undefined
        ? SUMMARY
        : script.pull;
      return found === null
        ? null
        : { ...found, headRefName: branch };
    }),
    get: (number: number) => ask(`get ${number}`, () => (script.detail === undefined
      ? detail('Closes #21')
      : script.detail)),
    editBody: async (number: number, body: string) => {
      calls.push(`editBody ${number}`);
      bodies.push(body);
      await Promise.resolve();
    },
    list: () => unreached('list'),
    checks: () => unreached('checks'),
    browse: () => unreached('browse'),
    merge: () => unreached('merge'),
    create: () => unreached('create'),
    editTitle: () => unreached('editTitle'),
    editBase: () => unreached('editBase'),
    comments: () => unreached('comments'),
    comment: () => unreached('comment'),
    editComment: () => unreached('editComment'),
    failedLog: () => unreached('failedLog'),
    workflowCount: () => unreached('workflowCount'),
    listMerged: () => unreached('listMerged'),
    changedFiles: () => unreached('changedFiles'),
    reviews: () => unreached('reviews'),
  };
}

/** A full stub of the finish's seams, recording what it was asked. */
export function stub(script: Script): Recorded {
  const git: string[] = [];
  const calls: string[] = [];
  const bodies: string[] = [];
  const forecasts: BranchForecastInput[] = [];
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  const answers = [...script.git ?? []];

  setActiveOutput(sinkOutput({
    info: (line) => info.push(line),
    warn: (line) => warn.push(line),
    error: (line) => error.push(line),
  }));

  const pulls = stubPulls(script, calls, bodies);
  const seams: Partial<ReleaseStageSeams> = {
    git: (repoRoot: string) => (args: readonly string[]) => {
      git.push(`${repoRoot}: git ${args.join(' ')}`);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`unplanned git ${args.join(' ')}`);
      return answer;
    },
    push: (repoRoot: string, branch: string) => {
      calls.push(`push ${repoRoot} ${branch}`);
      return script.push ?? PUSHED;
    },
    forecast: (input: BranchForecastInput) => {
      forecasts.push(input);
      return script.forecast ?? FORECAST;
    },
    pulls: () => pulls,
    // The reading every case but the provider ones runs under: the stage
    // asks it before it asks for a provider, so a stub that left it out
    // would send the real `resolvePrProvider` at `/repo`.
    readProvider: () => script.provider ?? PROVIDER_GH,
    currentBranch: () => BRANCH,
    now: () => new Date('2026-09-20T09:00:00Z'),
  };

  return { seams, git, calls, bodies, forecasts, info, warn, error };
}

/** The argv a fragment commit sends, over the path named. */
export function commitArgv(path = FRAGMENT_PATH, subject = SUBJECT): string[] {
  return [
    `${REPO}: git add -- ${path}`,
    `${REPO}: git diff --cached --quiet -- ${path}`,
    `${REPO}: git commit --cleanup=whitespace --only -m ${subject} -- ${path}`,
    `${REPO}: git rev-parse HEAD`,
  ];
}
