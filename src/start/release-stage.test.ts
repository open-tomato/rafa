/**
 * Tests for the release around the wrap-up session
 * (`src/start/release-stage.ts`).
 *
 * Every case drives the stage through a complete stub of its seams, so
 * no `git`, no `gh`, no store and no clock is reached: step 1 and step
 * 3's readings are scripted, the git runner records the argv it was
 * handed and answers from a script, and the provider is a whole
 * {@link PullRequests} whose nine unused members throw, so a stage that
 * started merging or commenting fails the case rather than passing on
 * an unread call.
 *
 * The commit cases pin the WHOLE argv sequence rather than one command.
 * A `git add -A` sweeping up what the session left behind, a commit
 * made before the staging was read, or a push sent after a refused
 * commit would each pass a presence check on the commit line alone; the
 * sequence refuses all three. The paths are named twice in that
 * sequence, once for `add` and once for `commit --only`, and both
 * spellings are read.
 *
 * The provider is TWO seams and every case stubs both: `readProvider`
 * answers which provider the repository resolves to, and `pulls` builds
 * it. A case that stubbed only the second would send the real
 * `resolvePrProvider` at `/repo` and take whatever `git remote get-url
 * origin` answered in this checkout, so `stub()` names a reading —
 * `gh` unless the case says otherwise — and the `none` cases are the
 * ones that pass their own. Stubbing the pair apart is also what lets a
 * case measure a `none` repository asking for NO provider, which is a
 * different claim from one whose provider was asked nothing.
 *
 * The prepared record every case works from is built here rather than
 * taken from `release/prepare.ts`, so a case pins what the stage does
 * with a record and not what `prepare.ts` makes of a directory. The
 * end-to-end reading over real files is the scratch-repo suite under
 * `src/tests/`, a later task of this stage.
 *
 * `finishRelease` writes through the active output, which is module
 * state, so every case sets a sink and the `afterEach` puts it back to
 * null: an output left set would take the lines of every file bun runs
 * after this one.
 *
 * Seven mutations of `release-stage.ts` were driven against this file on
 * 2026-09-20, one run each, 23 pass either side and the module restored
 * sha256-identical after every one:
 *
 *   - `git add -A` in place of `git add -- <paths>`: 5 cases.
 *   - the `git diff --cached --quiet` reading dropped, so a release is
 *     committed without asking whether anything is staged: 6 cases.
 *   - the body's already-carries check inverted, so the sentence is
 *     written again over a body that has it: 6 cases.
 *   - the sentence put ABOVE the body rather than under it: 3 cases.
 *   - the skip worded here instead of taken from the record, which is
 *     the drift the one sentence exists to prevent: 2 cases.
 *   - the commit subject always naming a version, so a project with no
 *     version file commits `chore: release null`: 1 case.
 *   - the plan title's `Plan:` label left on: 1 case.
 *
 * Those seven ran before the provider reading existed. Three more were
 * driven the same way once it did, on 2026-09-20, one run each, 32 pass
 * either side and the module restored sha256-identical after every one:
 *
 *   - the provider gate dropped, so every repository is asked for a
 *     pull request body whatever it resolves to: 6 cases.
 *   - the provider BUILT before the reading is taken, which is the
 *     `gh` spawn a `none` repository must not pay for: 1 case.
 *   - the unwritten line saying "that line" instead of quoting the
 *     sentence it names: 2 cases.
 */
import type { ReleaseStageInput, ReleaseStageSeams } from './release-stage.js';
import type { GitResult, PrProviderReading, PullRequestDetail, PullRequests, PullRequestSummary, PushOutcome } from '../pr/index.js';
import type { ChangelogEntry, ChangelogNote } from '../release/changelog.js';
import type {
  ReleaseFileEdit,
  ReleasePreparation,
  ReleasePrepared,
  ReleaseSettings,
  ReleaseSkipped,
} from '../release/prepare.js';
import type { ReleaseRefused, ReleaseVerified } from '../release/verify.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { RELEASE_AUTO } from '../config-sections.js';
import { verifyRelease } from '../release/verify.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { bodyWithSentence, finishRelease, prepareReleaseStage, RELEASE_STAGE_SEAMS } from './release-stage.js';

const REPO = '/repo';
const BRANCH = 'feat/rafa-21-changelog-and-release';
const PR = 21;
const VERSION = '0.5.0';
const HEADING = `## ${VERSION} — 2026-09-20, rafa-21 — changelog and release`;
const SHA = '9f1c0de1c0ffee0000000000000000000000abcd';

/** The `release` settings a case runs under: this repository's defaults. */
const SETTINGS: ReleaseSettings = {
  releaseEnabled: RELEASE_AUTO,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseHeading: '## {version} — {date}, {title}',
};

/** A plan the way the loop writes one: a title heading and a `rafa:plan` block. */
const PLAN = [
  '# Plan: rafa-21 — changelog and release',
  '',
  '```rafa:plan',
  'stub: rafa-21-changelog-and-release',
  'issue: "21"',
  'release: minor',
  '```',
  '',
  '- [x] Add the release stage',
].join('\n');

/** The notes the store answers for that plan. */
const NOTES: readonly ChangelogNote[] = [
  { level: 'minor', area: 'loop', summary: 'the wrap-up now commits the release' },
];

const STAGE_INPUT: ReleaseStageInput = {
  repoRoot: REPO,
  settings: SETTINGS,
  planStub: 'rafa-21-changelog-and-release',
  planContent: PLAN,
};

/** One file step 1 wrote, in both its states. */
function edit(path: string, before: string, after: string): ReleaseFileEdit {
  return { path, resolved: `${REPO}/${path}`, before, after };
}

/** The entry step 1 rendered, as the record carries it. */
const ENTRY: ChangelogEntry = {
  heading: HEADING,
  lines: ['- loop: the wrap-up now commits the release'],
  groups: [{ area: 'loop', summaries: ['the wrap-up now commits the release'] }],
  text: `${HEADING}\n\n- loop: the wrap-up now commits the release`,
  noneNotes: 0,
  duplicateNotes: 0,
  blankNotes: 0,
};

/** A preparation that wrote both files, as `release/prepare.ts` answers one. */
function prepared(over: Partial<ReleasePrepared> = {}): ReleasePrepared {
  return {
    kind: 'prepared',
    level: 'minor',
    levelSource: 'plan',
    notesLevel: 'minor',
    version: VERSION,
    baseVersion: '0.4.0',
    fetched: true,
    entry: ENTRY,
    insertPoint: 'before-next-heading',
    insertLine: 8,
    changelog: edit('CHANGELOG.md', '# Changelog\n', `# Changelog\n\n${ENTRY.text}\n`),
    versionFile: edit('package.json', '{"version":"0.4.0"}', '{"version":"0.5.0"}'),
    problems: [],
    ...over,
  };
}

/** A preparation that wrote nothing, and the sentence it says so with. */
const SKIP_SENTENCE = 'the plan declares release: none, so this pull request ships no version bump and no changelog entry';

const SKIPPED: ReleaseSkipped = {
  kind: 'skipped',
  reason: 'level-none',
  sentence: SKIP_SENTENCE,
  problems: [],
  level: 'none',
  levelSource: 'plan',
  notesLevel: null,
};

/** A verification that passed, over the record above. */
const VERIFIED: ReleaseVerified = {
  kind: 'verified',
  version: VERSION,
  heading: HEADING,
  section: [HEADING, '- loop: the wrap-up commits the release'],
  lines: ['- loop: the wrap-up commits the release'],
  changelog: `# Changelog\n\n${HEADING}\n\n- loop: the wrap-up commits the release\n`,
};

/** A verification that refused, with step 1's text already back on disk. */
const REFUSAL_SENTENCE = 'no release commit: CHANGELOG.md line 1 reads "# Changes" where the loop left "# Changelog",'
  + ' outside the section, and CHANGELOG.md and package.json were restored to the text the loop wrote';

const REFUSED: ReleaseRefused = {
  kind: 'refused',
  reason: 'changelog-changed',
  sentence: REFUSAL_SENTENCE,
  restores: [
    { path: 'CHANGELOG.md', restored: true, problem: null },
    { path: 'package.json', restored: true, problem: null },
  ],
};

/**
 * What `resolvePrProvider` answers for a repository with no GitHub
 * origin: the resolution the stage must read before it reaches for
 * `gh` at all. See `src/pr/provider.ts`.
 */
const PROVIDER_NONE: PrProviderReading = { provider: 'none', source: 'remote', remote: null, host: null };

/** What that same reading answers for a GitHub origin, the control beside it. */
const PROVIDER_GH: PrProviderReading = {
  provider: 'gh',
  source: 'remote',
  remote: 'git@github.com:open-tomato/rafa.git',
  host: 'github.com',
};

/** A `none` an operator asked for, over an origin that reads as GitHub. */
const PROVIDER_NONE_CONFIGURED: PrProviderReading = { ...PROVIDER_GH, provider: 'none', source: 'config' };

/** A `none` an origin decided, that origin being somewhere else. */
const PROVIDER_NONE_ELSEWHERE: PrProviderReading = {
  provider: 'none',
  source: 'remote',
  remote: 'git@gitlab.com:open-tomato/rafa.git',
  host: 'gitlab.com',
};

/** The problem a reading that is not `gh` leaves in the record. */
function noProvider(because: string): string {
  return `this repository resolves to pr.provider: none, because ${because},`
    + ' so there is no pull request to write it to';
}

/** The pull request the provider answers for the branch. */
const SUMMARY: PullRequestSummary = {
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
function detail(body: string): PullRequestDetail {
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
function unreached(member: string): never {
  throw new Error(`unplanned ${member}`);
}

/** What a case plans for the stubbed effects to answer. */
interface Script {
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
}

/** Everything one stubbed run recorded. */
interface Recorded {
  readonly seams: Partial<ReleaseStageSeams>;
  /** Every git command, as one string per invocation. */
  readonly git: string[];
  /** Every effect that is not a git command, in order. */
  readonly calls: string[];
  /** Every body handed to `editBody`. */
  readonly bodies: string[];
  /** Every message, by level. */
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
}

const OK: GitResult = { ok: true, stdout: '', stderr: '' };
const SHA_READ: GitResult = { ok: true, stdout: `${SHA}\n`, stderr: '' };
/** `git diff --cached --quiet` answering that something IS staged. */
const STAGED: GitResult = { ok: false, stdout: '', stderr: '' };
const PUSHED: PushOutcome = { ok: true, output: `branch '${BRANCH}' set up to track 'origin/${BRANCH}'.` };

/** The four commands a release commit sends when every one of them works. */
const COMMITTED: readonly GitResult[] = [OK, STAGED, OK, SHA_READ];

/** A full stub of the finish's seams, recording what it was asked. */
function stub(script: Script): Recorded {
  const git: string[] = [];
  const calls: string[] = [];
  const bodies: string[] = [];
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  const answers = [...script.git ?? []];

  setActiveOutput(sinkOutput({
    info: (line) => info.push(line),
    warn: (line) => warn.push(line),
    error: (line) => error.push(line),
  }));

  const ask = <T>(member: string, answer: () => T): Promise<T> => {
    calls.push(member);
    if (script.throws !== undefined) return Promise.reject(new Error(script.throws));
    return Promise.resolve(answer());
  };

  const pulls: PullRequests = {
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
    comments: () => unreached('comments'),
    comment: () => unreached('comment'),
    editComment: () => unreached('editComment'),
    failedLog: () => unreached('failedLog'),
  };

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
    pulls: () => pulls,
    // The reading every case but the provider ones runs under: the stage
    // asks it before it asks for a provider, so a stub that left it out
    // would send the real `resolvePrProvider` at `/repo`.
    readProvider: () => script.provider ?? PROVIDER_GH,
    currentBranch: () => BRANCH,
  };

  return { seams, git, calls, bodies, info, warn, error };
}

/** The argv a release commit sends, over the paths named. */
function commitArgv(paths: string, subject = `chore: release ${VERSION}`): string[] {
  return [
    `${REPO}: git add -- ${paths}`,
    `${REPO}: git diff --cached --quiet -- ${paths}`,
    `${REPO}: git commit --cleanup=whitespace --only -m ${subject} -- ${paths}`,
    `${REPO}: git rev-parse HEAD`,
  ];
}

/** A temporary directory this file's own planted-edit case writes into. */
const PLANTED_ROOT = mkdtempSync(join(tmpdir(), 'rafa-release-stage-'));

afterAll(() => {
  rmSync(PLANTED_ROOT, { recursive: true, force: true });
});

/** `path`'s text, or null when it is not there. */
function textAt(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * A preparation whose two files are REAL, on disk under
 * {@link PLANTED_ROOT}, so the real `verifyRelease` — not the stubbed
 * `verify` seam every other case here scripts — reads and restores
 * actual bytes. `before`/`after` mirror a real insertion: `after` puts
 * the entry's heading and line above the older release, leaving the
 * preamble line and the older section's own line untouched around it.
 */
function plantedPrepared(): { readonly prepared: ReleasePrepared; readonly changelog: string; readonly versionFile: string } {
  const changelog = join(PLANTED_ROOT, 'CHANGELOG.md');
  const versionFile = join(PLANTED_ROOT, 'package.json');
  const before = [
    '# Changelog',
    '',
    'Every notable change to this project, newest first.',
    '',
    '## 0.4.0 — 2026-09-19, the one before',
    '',
    '- loop: the loop learned to stop',
    '',
  ].join('\n');
  const after = [
    '# Changelog',
    '',
    'Every notable change to this project, newest first.',
    '',
    HEADING,
    '',
    '- loop: the wrap-up now commits the release',
    '',
    '## 0.4.0 — 2026-09-19, the one before',
    '',
    '- loop: the loop learned to stop',
    '',
  ].join('\n');
  return {
    prepared: prepared({
      changelog: { path: 'CHANGELOG.md', resolved: changelog, before, after },
      versionFile: { path: 'package.json', resolved: versionFile, before: '{"version":"0.4.0"}', after: '{"version":"0.5.0"}' },
    }),
    changelog,
    versionFile,
  };
}

afterEach(() => {
  setActiveOutput(null);
});

describe('prepareReleaseStage', () => {
  /** A stub of step 1 that records the input it was handed. */
  function capturing(answer: ReleasePreparation = prepared()): {
    readonly seams: Partial<ReleaseStageSeams>;
    readonly inputs: Parameters<ReleaseStageSeams['prepare']>[0][];
    readonly notes: string[];
  } {
    const inputs: Parameters<ReleaseStageSeams['prepare']>[0][] = [];
    const notes: string[] = [];
    return {
      inputs,
      notes,
      seams: {
        prepare: (input) => {
          inputs.push(input);
          return answer;
        },
        readNotes: (repoRoot, planStub) => {
          notes.push(`${repoRoot} ${String(planStub)}`);
          return NOTES;
        },
        git: () => () => OK,
        now: () => new Date('2026-09-20T09:00:00Z'),
      },
    };
  }

  it('hands step 1 the plan level, the stored notes, the title and the clock', () => {
    setActiveOutput(sinkOutput({}));
    const capture = capturing();

    prepareReleaseStage(STAGE_INPUT, capture.seams);

    expect(capture.notes).toEqual([`${REPO} rafa-21-changelog-and-release`]);
    const input = capture.inputs[0];
    expect(input?.repoRoot).toBe(REPO);
    expect(input?.settings).toBe(SETTINGS);
    expect(input?.declared).toBe('minor');
    expect(input?.notes).toEqual(NOTES);
    expect(input?.title).toBe('rafa-21 — changelog and release');
    expect(input?.now.toISOString()).toBe('2026-09-20T09:00:00.000Z');
  });

  it('falls back to the plan stub when the plan carries no heading', () => {
    setActiveOutput(sinkOutput({}));
    const capture = capturing();

    prepareReleaseStage({ ...STAGE_INPUT, planContent: '- [x] a checklist and nothing else' }, capture.seams);

    expect(capture.inputs[0]?.title).toBe('rafa-21-changelog-and-release');
    expect(capture.inputs[0]?.declared).toBeNull();
  });

  it('answers step 1 record and says what it wrote', () => {
    const lines: string[] = [];
    setActiveOutput(sinkOutput({ info: (line) => lines.push(line) }));
    const capture = capturing();

    const answer = prepareReleaseStage(STAGE_INPUT, capture.seams);

    expect(answer?.kind).toBe('prepared');
    expect(lines[0]).toContain(`CHANGELOG.md carries ${HEADING}`);
    expect(lines[0]).toContain(`package.json now declares ${VERSION}`);
  });

  it('reports every problem step 1 carried', () => {
    const warned: string[] = [];
    setActiveOutput(sinkOutput({ warn: (line) => warned.push(line) }));
    const capture = capturing(prepared({ fetched: false, problems: ['the fetch of origin main failed'] }));

    prepareReleaseStage(STAGE_INPUT, capture.seams);

    expect(warned).toEqual(['   ⚠️  the fetch of origin main failed']);
  });

  it('says why step 1 wrote nothing when it skipped', () => {
    const lines: string[] = [];
    setActiveOutput(sinkOutput({ info: (line) => lines.push(line) }));
    const capture = capturing(SKIPPED);

    const answer = prepareReleaseStage(STAGE_INPUT, capture.seams);

    expect(answer).toBe(SKIPPED);
    expect(lines[0]).toContain(SKIP_SENTENCE);
  });

  it('answers null and reports when the notes could not be read', () => {
    const errors: string[] = [];
    setActiveOutput(sinkOutput({ error: (line) => errors.push(line) }));
    let prepares = 0;

    const answer = prepareReleaseStage(STAGE_INPUT, {
      readNotes: () => {
        throw new Error('the effort store could not be opened');
      },
      prepare: () => {
        prepares += 1;
        return prepared();
      },
      git: () => () => OK,
    });

    expect(answer).toBeNull();
    expect(prepares).toBe(0);
    expect(errors[0]).toContain('the effort store could not be opened');
  });

  it('answers a record when that same read works, which is the control', () => {
    setActiveOutput(sinkOutput({}));
    const capture = capturing();

    expect(prepareReleaseStage(STAGE_INPUT, capture.seams)).not.toBeNull();
  });
});

describe('finishRelease', () => {
  it('does nothing at all for a preparation that never ran', async () => {
    const world = stub({});

    const finish = await finishRelease({ repoRoot: REPO, preparation: null }, world.seams);

    expect(finish).toEqual({
      outcome: 'none',
      version: null,
      subject: null,
      sha: null,
      sentence: null,
      body: null,
    });
    expect(world.git).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  it('commits the two release files alone and pushes them', async () => {
    const world = stub({ git: COMMITTED });

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: prepared() },
      { ...world.seams, verify: () => VERIFIED },
    );

    expect(finish.outcome).toBe('released');
    expect(finish.version).toBe(VERSION);
    expect(finish.subject).toBe(`chore: release ${VERSION}`);
    expect(finish.sha).toBe(SHA);
    expect(finish.sentence).toBeNull();
    expect(world.git).toEqual(commitArgv('CHANGELOG.md package.json'));
    expect(world.calls).toEqual([`push ${REPO} ${BRANCH}`]);
    expect(world.bodies).toEqual([]);
  });

  it('commits the changelog alone in a project with no version file', async () => {
    const world = stub({ git: COMMITTED });
    const noVersion = prepared({ version: null, baseVersion: null, versionFile: null });

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: noVersion },
      { ...world.seams, verify: () => ({ ...VERIFIED, version: null }) },
    );

    expect(finish.outcome).toBe('released');
    expect(finish.subject).toBe('chore: release');
    expect(world.git).toEqual(commitArgv('CHANGELOG.md', 'chore: release'));
  });

  it('puts a skipped preparation sentence in the pull request body', async () => {
    const world = stub({});

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: SKIPPED },
      { ...world.seams, verify: () => unreached('verify') },
    );

    expect(finish.outcome).toBe('skipped');
    expect(finish.sentence).toBe(SKIP_SENTENCE);
    expect(finish.body).toEqual({ number: PR, carried: true, already: false, problem: null });
    expect(world.bodies).toEqual([`Closes #21\n\n${SKIP_SENTENCE}`]);
    expect(world.git).toEqual([]);
  });

  it('reaches no pull request and sends no gh command when the resolved provider is none', async () => {
    const world = stub({});

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: SKIPPED },
      { ...world.seams, readProvider: () => PROVIDER_NONE } as Partial<ReleaseStageSeams>,
    );

    expect(finish.outcome).toBe('skipped');
    expect(finish.sentence).toBe(SKIP_SENTENCE);
    expect(finish.body?.carried).toBe(false);
    expect(finish.body?.problem).not.toBeNull();
    expect(world.calls).toEqual([]);
    expect(world.bodies).toEqual([]);
  });

  it('writes the sentence into the pull request body when the provider resolves to gh, which is the control', async () => {
    const world = stub({});

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: SKIPPED },
      { ...world.seams, readProvider: () => PROVIDER_GH } as Partial<ReleaseStageSeams>,
    );

    expect(finish.outcome).toBe('skipped');
    expect(finish.body).toEqual({ number: PR, carried: true, already: false, problem: null });
    expect(world.calls).toEqual(['findOpen', `get ${PR}`, `editBody ${PR}`]);
    expect(world.bodies).toEqual([`Closes #21\n\n${SKIP_SENTENCE}`]);
  });

  it('prints one line naming the sentence that went unwritten when the provider writes no body', async () => {
    const world = stub({ provider: PROVIDER_NONE });

    const finish = await finishRelease({ repoRoot: REPO, preparation: SKIPPED }, world.seams);

    // The skip prints the sentence itself first; exactly one line after it
    // says where that sentence did not go, and quotes it.
    const named = world.info.filter((line) => line.includes(SKIP_SENTENCE) && line.includes('pr.provider'));
    expect(named).toEqual([
      `   No pull request body carries ${JSON.stringify(SKIP_SENTENCE)}: ${noProvider('origin is not set')}.`,
    ]);
    expect(finish.body?.problem).toBe(noProvider('origin is not set'));
    // The setting working is not a fault, so nothing is reported as one.
    expect(world.error).toEqual([]);
  });

  it('names pr.provider in the config as what kept the sentence off the pull request', async () => {
    const world = stub({ provider: PROVIDER_NONE_CONFIGURED });

    const finish = await finishRelease({ repoRoot: REPO, preparation: SKIPPED }, world.seams);

    expect(finish.body?.problem).toBe(noProvider('pr.provider says so'));
    expect(world.calls).toEqual([]);
  });

  it('names the origin that decided when no config named the provider', async () => {
    const world = stub({ provider: PROVIDER_NONE_ELSEWHERE });

    const finish = await finishRelease({ repoRoot: REPO, preparation: SKIPPED }, world.seams);

    expect(finish.body?.problem).toBe(noProvider('origin is git@gitlab.com:open-tomato/rafa.git'));
    expect(world.calls).toEqual([]);
  });

  it('asks for no provider at all when the reading is none', async () => {
    const world = stub({ provider: PROVIDER_NONE });

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: SKIPPED },
      { ...world.seams, pulls: () => unreached('pulls') },
    );

    expect(finish.outcome).toBe('skipped');
    expect(finish.body?.carried).toBe(false);
  });

  it('asks for a provider when the reading is gh, which is the control', async () => {
    const world = stub({});

    await expect(finishRelease(
      { repoRoot: REPO, preparation: SKIPPED },
      { ...world.seams, pulls: () => unreached('pulls') },
    )).rejects.toThrow('unplanned pulls');
  });

  it('carries an uncommitted release sentence no further than the terminal under a none provider', async () => {
    const world = stub({ provider: PROVIDER_NONE, git: [OK, OK] });

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: prepared() },
      { ...world.seams, verify: () => VERIFIED },
    );

    expect(finish.outcome).toBe('uncommitted');
    expect(world.bodies).toEqual([]);
    expect(world.calls).toEqual([]);
    // The failure is still reported as one, above the line about the body.
    expect(world.error[0]).toContain(finish.sentence ?? '');
    expect(world.info.at(-1)).toContain(`No pull request body carries ${JSON.stringify(finish.sentence ?? '')}`);
  });

  it('puts a refused verification sentence in the body and commits nothing', async () => {
    const world = stub({});

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: prepared() },
      { ...world.seams, verify: () => REFUSED },
    );

    expect(finish.outcome).toBe('refused');
    expect(finish.sentence).toBe(REFUSAL_SENTENCE);
    expect(finish.sha).toBeNull();
    expect(world.git).toEqual([]);
    expect(world.calls).toEqual(['findOpen', `get ${PR}`, `editBody ${PR}`]);
    expect(world.bodies).toEqual([`Closes #21\n\n${REFUSAL_SENTENCE}`]);
    expect(world.error[0]).toContain(REFUSAL_SENTENCE);
  });

  it('refuses a session that rewrote a line outside the new section, restores step 1s text byte for byte, and carries the refusal into the pull request body', async () => {
    const at = plantedPrepared();
    // The wrap-up session's OWN edit: it merges in a change to the preamble,
    // a line entirely outside the section it was told to rewrite.
    const planted = at.prepared.changelog.after.replace(
      'Every notable change to this project, newest first.',
      'Every notable change to this project, newest first, rewritten.',
    );
    writeFileSync(at.changelog, planted);
    writeFileSync(at.versionFile, at.prepared.versionFile?.after ?? '');
    const world = stub({});

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: at.prepared },
      { ...world.seams, verify: verifyRelease },
    );

    expect(finish.outcome).toBe('refused');
    expect(finish.sentence).toContain('outside the');
    expect(finish.sentence).toContain(
      'reads "Every notable change to this project, newest first, rewritten." where the loop left'
        + ' "Every notable change to this project, newest first."',
    );
    expect(finish.sha).toBeNull();
    // Step 1's text is back, byte for byte, not merely "a" text.
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
    expect(textAt(at.versionFile)).toBe(at.prepared.versionFile?.after ?? null);
    expect(world.git).toEqual([]);
    expect(world.bodies).toEqual([`Closes #21\n\n${finish.sentence}`]);
  });

  it('reports a staging that git refused, and sends no commit', async () => {
    const world = stub({ git: [{ ok: false, stdout: '', stderr: 'fatal: pathspec did not match' }] });

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: prepared() },
      { ...world.seams, verify: () => VERIFIED },
    );

    expect(finish.outcome).toBe('uncommitted');
    expect(finish.sentence).toBe(
      'no release commit: git could not stage CHANGELOG.md and package.json,'
        + ' and said "fatal: pathspec did not match"',
    );
    expect(world.git).toEqual([`${REPO}: git add -- CHANGELOG.md package.json`]);
    expect(world.bodies[0]).toContain('no release commit: git could not stage');
  });

  it('reports the files having nothing staged as the session having committed them', async () => {
    const world = stub({ git: [OK, OK] });

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: prepared() },
      { ...world.seams, verify: () => VERIFIED },
    );

    expect(finish.outcome).toBe('uncommitted');
    expect(finish.sentence).toBe(
      'no release commit: CHANGELOG.md and package.json hold no change against HEAD,'
        + ' so the wrap-up session committed them itself',
    );
    expect(world.git).toEqual(commitArgv('CHANGELOG.md package.json').slice(0, 2));
  });

  it('reports a commit git refused, and pushes nothing', async () => {
    const refusal = { ok: false, stdout: '', stderr: 'error: hook declined to update refs/heads/main' };
    const world = stub({ git: [OK, STAGED, refusal] });

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: prepared() },
      { ...world.seams, verify: () => VERIFIED },
    );

    expect(finish.outcome).toBe('uncommitted');
    expect(finish.sentence).toBe(
      `no release commit: git refused \`chore: release ${VERSION}\` over CHANGELOG.md and package.json,`
        + ' and said "error: hook declined to update refs/heads/main"',
    );
    expect(world.git).toEqual(commitArgv('CHANGELOG.md package.json').slice(0, 3));
    expect(world.calls).toEqual(['findOpen', `get ${PR}`, `editBody ${PR}`]);
  });

  it('keeps a release whose sha could not be read', async () => {
    const world = stub({ git: [OK, STAGED, OK, { ok: false, stdout: '', stderr: 'fatal: bad revision' }] });

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: prepared() },
      { ...world.seams, verify: () => VERIFIED },
    );

    expect(finish.outcome).toBe('released');
    expect(finish.sha).toBeNull();
    expect(world.calls).toEqual([`push ${REPO} ${BRANCH}`]);
  });

  it('reports a push git refused, naming the commit it left behind', async () => {
    const world = stub({
      git: COMMITTED,
      push: { ok: false, output: 'error: failed to push some refs\nhint: updates were rejected' },
    });

    const finish = await finishRelease(
      { repoRoot: REPO, preparation: prepared() },
      { ...world.seams, verify: () => VERIFIED },
    );

    expect(finish.outcome).toBe('unpushed');
    expect(finish.sha).toBe(SHA);
    expect(finish.sentence).toBe(
      `the \`chore: release ${VERSION}\` commit ${SHA.slice(0, 7)} was made but could not be pushed`
        + ` to ${BRANCH}: error: failed to push some refs`,
    );
    expect(world.bodies[0]).toContain('was made but could not be pushed');
  });

  it('leaves a body that already carries the sentence as it is', async () => {
    const world = stub({ detail: detail(`Closes #21\n\n${SKIP_SENTENCE}`) });

    const finish = await finishRelease({ repoRoot: REPO, preparation: SKIPPED }, world.seams);

    expect(finish.body).toEqual({ number: PR, carried: true, already: true, problem: null });
    expect(world.bodies).toEqual([]);
    expect(world.calls).toEqual(['findOpen', `get ${PR}`]);
  });

  it('reports a branch with no open pull request to write the sentence to', async () => {
    const world = stub({ pull: null });

    const finish = await finishRelease({ repoRoot: REPO, preparation: SKIPPED }, world.seams);

    expect(finish.outcome).toBe('skipped');
    expect(finish.body).toEqual({
      number: null,
      carried: false,
      already: false,
      problem: `no open pull request was found for ${BRANCH} to write it to`,
    });
    expect(world.error[0]).toContain('That line is not in the pull request body');
  });

  it('reports a provider that could not be asked rather than throwing', async () => {
    const world = stub({ throws: 'gh: could not authenticate' });

    const finish = await finishRelease({ repoRoot: REPO, preparation: SKIPPED }, world.seams);

    expect(finish.outcome).toBe('skipped');
    expect(finish.body?.carried).toBe(false);
    expect(finish.body?.problem).toContain('gh: could not authenticate');
  });
});

describe('bodyWithSentence', () => {
  it('puts the sentence under the body as its own paragraph', () => {
    expect(bodyWithSentence('Closes #21\n\n## What changed\n\nthings\n', 'no release commit: x'))
      .toBe('Closes #21\n\n## What changed\n\nthings\n\nno release commit: x');
  });

  it('answers the sentence alone for a pull request with no body', () => {
    expect(bodyWithSentence('', 'no release commit: x')).toBe('no release commit: x');
  });
});

describe('RELEASE_STAGE_SEAMS', () => {
  it('names a real helper for every effect the stage reaches through', () => {
    expect(Object.keys(RELEASE_STAGE_SEAMS).sort()).toEqual([
      'currentBranch',
      'git',
      'now',
      'prepare',
      'pulls',
      'push',
      'readNotes',
      'readProvider',
      'verify',
    ]);
    expect(RELEASE_STAGE_SEAMS.now()).toBeInstanceOf(Date);
  });
});
