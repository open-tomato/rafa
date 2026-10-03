/**
 * Tests for the release around the wrap-up session
 * (`src/start/release-stage.ts`): step 1's call into `release/prepare.ts`,
 * and step 3's verification, fragment commit, push and failure
 * sentence. The forecast and the level report the body is given are
 * `./release-stage-forecast.test.ts`'s.
 *
 * Every case drives the stage through a complete stub of its seams
 * (`src/tests/release-stage-fixtures.ts`), so no `git`, no `gh`, no
 * store and no clock is reached: step 1 and step 3's readings are
 * scripted, the git runner records the argv it was handed and answers
 * from a script, and the provider is a whole `PullRequests` whose
 * unused members throw.
 *
 * The commit cases pin the WHOLE argv sequence rather than one command.
 * A `git add -A` sweeping up what the session left behind, a commit
 * made before the staging was read, or a push sent after a refused
 * commit would each pass a presence check on the commit line alone; the
 * sequence refuses all three. The fragment path is named twice in that
 * sequence, once for `add` and once for `commit --only`, and both
 * spellings are read.
 *
 * The prepared record every case works from is built in the fixtures
 * rather than taken from `release/prepare.ts`, so a case pins what the
 * stage does with a record and not what `prepare.ts` makes of a
 * directory. The end-to-end reading over real files is
 * `src/tests/release-stage-integration.test.ts`.
 *
 * `finishRelease` writes through the active output, which is module
 * state, so every case sets a sink and the `afterEach` puts it back to
 * null: an output left set would take the lines of every file bun runs
 * after this one.
 */
import type { ReleaseStageSeams } from './release-stage.js';
import type { PullRequestDetail, PullRequests, PullRequestSummary } from '../pr/index.js';
import type { ReleasePreparation, ReleasePrepared } from '../release/prepare.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { verifyRelease } from '../release/verify.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { sinkOutput } from '../tests/output-sinks.js';
import {
  BRANCH,
  COMMITTED,
  commitArgv,
  detail,
  FORECAST_LINE,
  FRAGMENT_PATH,
  noProvider,
  NOTES,
  OK,
  PLAN_ID,
  PR,
  prepared,
  PROVIDER_GH,
  PROVIDER_NONE,
  PROVIDER_NONE_CONFIGURED,
  PROVIDER_NONE_ELSEWHERE,
  REFUSAL_SENTENCE,
  REFUSED,
  REPO,
  SETTINGS,
  SHA,
  SKIP_SENTENCE,
  SKIPPED,
  STAGE_INPUT,
  STAGED,
  stub,
  stubPulls,
  SUBJECT,
  SUMMARY,
  unreached,
  VERIFIED,
} from '../tests/release-stage-fixtures.js';
import { getCurrentBranch } from '../utils/git.js';

import { bodyWithSentence, finishRelease, prepareReleaseStage, RELEASE_STAGE_SEAMS } from './release-stage.js';

/** A temporary directory this file's own planted-edit case writes into. */
const PLANTED_ROOT = mkdtempSync(join(tmpdir(), 'rafa-release-stage-'));

afterAll(() => {
  rmSync(PLANTED_ROOT, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** `path`'s text, or null when it is not there. */
function textAt(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The finish input every case runs under, over `preparation`. */
function finishOf(preparation: ReleasePreparation | null): Parameters<typeof finishRelease>[0] {
  return { repoRoot: REPO, branch: BRANCH, settings: SETTINGS, preparation };
}

/**
 * A preparation whose fragment is REAL, on disk under
 * {@link PLANTED_ROOT}, so the real `verifyRelease` — not the stubbed
 * `verify` seam every other case here scripts — reads and restores
 * actual bytes.
 */
function plantedPrepared(): { readonly prepared: ReleasePrepared; readonly fragment: string } {
  const fragment = join(PLANTED_ROOT, '.changes', `${PLAN_ID}.md`);
  mkdirSync(join(PLANTED_ROOT, '.changes'), { recursive: true });
  const base = prepared();
  return { prepared: prepared({ file: { ...base.file, resolved: fragment } }), fragment };
}

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
      },
    };
  }

  it('hands step 1 the plan id, level, stored notes, title and base branch', () => {
    setActiveOutput(sinkOutput({}));
    const capture = capturing();

    prepareReleaseStage(STAGE_INPUT, capture.seams);

    expect(capture.notes).toEqual([`${REPO} ${PLAN_ID}`]);
    const input = capture.inputs[0];
    expect(input?.repoRoot).toBe(REPO);
    expect(input?.settings).toBe(SETTINGS);
    expect(input?.plan).toBe(PLAN_ID);
    expect(input?.declared).toBe('minor');
    expect(input?.notes).toEqual(NOTES);
    expect(input?.title).toBe('rafa-21 — changelog and release');
    expect(input?.base).toEqual({ branch: 'main' });
  });

  it('reads the notes under the project root and prepares the files in the checkout, where git runs', () => {
    setActiveOutput(sinkOutput({}));
    const capture = capturing();
    const gitMadeIn: string[] = [];
    const checkout = `${REPO}-worktree`;

    prepareReleaseStage({ ...STAGE_INPUT, checkout }, {
      ...capture.seams,
      git: (dir) => {
        gitMadeIn.push(dir);
        return () => OK;
      },
    });

    expect(capture.notes).toEqual([`${REPO} rafa-21-changelog-and-release`]);
    expect(capture.inputs[0]?.repoRoot).toBe(checkout);
    expect(gitMadeIn).toEqual([checkout]);
  });

  it('prepares the files and runs git under the project root when handed no checkout', () => {
    // The control for the case above: the same stage with no checkout
    // makes its git in the root, so the directory above came from the
    // checkout it was handed.
    setActiveOutput(sinkOutput({}));
    const capture = capturing();
    const gitMadeIn: string[] = [];

    prepareReleaseStage(STAGE_INPUT, {
      ...capture.seams,
      git: (dir) => {
        gitMadeIn.push(dir);
        return () => OK;
      },
    });

    expect(capture.inputs[0]?.repoRoot).toBe(REPO);
    expect(gitMadeIn).toEqual([REPO]);
  });

  it('falls back to the plan stub when the plan carries no heading', () => {
    setActiveOutput(sinkOutput({}));
    const capture = capturing();

    prepareReleaseStage({ ...STAGE_INPUT, planContent: '- [x] a checklist and nothing else' }, capture.seams);

    expect(capture.inputs[0]?.title).toBe(PLAN_ID);
    expect(capture.inputs[0]?.declared).toBeNull();
  });

  it('answers step 1 record and says what it wrote', () => {
    const lines: string[] = [];
    setActiveOutput(sinkOutput({ info: (line) => lines.push(line) }));
    const capture = capturing();

    const answer = prepareReleaseStage(STAGE_INPUT, capture.seams);

    expect(answer?.kind).toBe('prepared');
    expect(lines[0]).toContain(`${FRAGMENT_PATH} carries level minor for ${PLAN_ID}`);
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

    const finish = await finishRelease(finishOf(null), world.seams);

    expect(finish).toEqual({
      outcome: 'none',
      fragment: null,
      subject: null,
      sha: null,
      sentence: null,
      forecast: null,
      levelReport: null,
      body: null,
    });
    expect(world.git).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  it('commits the fragment alone under chore: release fragment <plan id> and pushes it', async () => {
    const world = stub({ git: COMMITTED });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('released');
    expect(finish.fragment).toBe(FRAGMENT_PATH);
    expect(finish.subject).toBe(SUBJECT);
    expect(finish.subject).toBe(`chore: release fragment ${PLAN_ID}`);
    expect(finish.sha).toBe(SHA);
    expect(finish.sentence).toBeNull();
    expect(world.git).toEqual(commitArgv());
    expect(world.calls[0]).toBe(`push ${REPO} ${BRANCH}`);
  });

  it('hands the verification the git runner and the settings it reads', async () => {
    const world = stub({ git: COMMITTED });
    const contexts: unknown[] = [];

    await finishRelease(finishOf(prepared()), {
      ...world.seams,
      verify: (_prepared, context) => {
        contexts.push(context.settings);
        return VERIFIED;
      },
    });

    expect(contexts).toEqual([SETTINGS]);
  });

  it('puts a skipped preparation sentence in the pull request body', async () => {
    const world = stub({});

    const finish = await finishRelease(finishOf(SKIPPED), { ...world.seams, verify: () => unreached('verify') });

    expect(finish.outcome).toBe('skipped');
    expect(finish.sentence).toBe(SKIP_SENTENCE);
    expect(finish.body).toEqual({ number: PR, carried: true, already: false, problem: null });
    expect(world.bodies).toEqual([`Closes #21\n\n${SKIP_SENTENCE}`]);
    expect(world.git).toEqual([]);
  });

  it('reaches no pull request and sends no gh command when the resolved provider is none', async () => {
    const world = stub({});

    const finish = await finishRelease(finishOf(SKIPPED), { ...world.seams, readProvider: () => PROVIDER_NONE });

    expect(finish.outcome).toBe('skipped');
    expect(finish.sentence).toBe(SKIP_SENTENCE);
    expect(finish.body?.carried).toBe(false);
    expect(finish.body?.problem).not.toBeNull();
    expect(world.calls).toEqual([]);
    expect(world.bodies).toEqual([]);
  });

  it('writes the sentence into the pull request body when the provider resolves to gh, which is the control', async () => {
    const world = stub({});

    const finish = await finishRelease(finishOf(SKIPPED), { ...world.seams, readProvider: () => PROVIDER_GH });

    expect(finish.outcome).toBe('skipped');
    expect(finish.body).toEqual({ number: PR, carried: true, already: false, problem: null });
    expect(world.calls).toEqual(['findOpen', `get ${PR}`, `editBody ${PR}`]);
    expect(world.bodies).toEqual([`Closes #21\n\n${SKIP_SENTENCE}`]);
  });

  it('prints one line naming the sentence that went unwritten when the provider writes no body', async () => {
    const world = stub({ provider: PROVIDER_NONE });

    const finish = await finishRelease(finishOf(SKIPPED), world.seams);

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

    const finish = await finishRelease(finishOf(SKIPPED), world.seams);

    expect(finish.body?.problem).toBe(noProvider('pr.provider says so'));
    expect(world.calls).toEqual([]);
  });

  it('names the origin that decided when no config named the provider', async () => {
    const world = stub({ provider: PROVIDER_NONE_ELSEWHERE });

    const finish = await finishRelease(finishOf(SKIPPED), world.seams);

    expect(finish.body?.problem).toBe(noProvider('origin is git@gitlab.com:open-tomato/rafa.git'));
    expect(world.calls).toEqual([]);
  });

  it('asks for no provider at all when the reading is none', async () => {
    const world = stub({ provider: PROVIDER_NONE });

    const finish = await finishRelease(finishOf(SKIPPED), { ...world.seams, pulls: () => unreached('pulls') });

    expect(finish.outcome).toBe('skipped');
    expect(finish.body?.carried).toBe(false);
  });

  it('asks for a provider when the reading is gh, which is the control', async () => {
    const world = stub({});

    await expect(finishRelease(finishOf(SKIPPED), { ...world.seams, pulls: () => unreached('pulls') }))
      .rejects.toThrow('unplanned pulls');
  });

  it('carries an uncommitted release sentence no further than the terminal under a none provider', async () => {
    const world = stub({ provider: PROVIDER_NONE, git: [OK, OK] });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('uncommitted');
    expect(world.bodies).toEqual([]);
    expect(world.calls).toEqual([]);
    // The failure is still reported as one, above the line about the body.
    expect(world.error[0]).toContain(finish.sentence ?? '');
    expect(world.info.at(-1)).toContain(`No pull request body carries ${JSON.stringify(finish.sentence ?? '')}`);
  });

  it('puts a refused verification sentence in the body and commits nothing', async () => {
    const world = stub({});

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => REFUSED });

    expect(finish.outcome).toBe('refused');
    expect(finish.sentence).toBe(REFUSAL_SENTENCE);
    expect(finish.sha).toBeNull();
    expect(world.git).toEqual([]);
    expect(world.calls).toEqual(['findOpen', `get ${PR}`, `editBody ${PR}`]);
    expect(world.bodies).toEqual([`Closes #21\n\n${REFUSAL_SENTENCE}`]);
    expect(world.error[0]).toContain(REFUSAL_SENTENCE);
  });

  it('refuses a session that also edited the version file, restores step 1s fragment byte for byte, and carries the refusal into the pull request body', async () => {
    const at = plantedPrepared();
    // The wrap-up session's OWN edit: the fragment rewritten, and the
    // version file changed beside it, which git status names.
    writeFileSync(at.fragment, at.prepared.file.after.replace('now commits', 'commits'));
    const world = stub({ git: [{ ok: true, stdout: ` M package.json\0?? ${FRAGMENT_PATH}\0`, stderr: '' }] });

    const finish = await finishRelease(finishOf(at.prepared), { ...world.seams, verify: verifyRelease });

    expect(finish.outcome).toBe('refused');
    expect(finish.sentence).toContain(`may change ${FRAGMENT_PATH} alone, yet package.json was changed too`);
    expect(finish.sha).toBeNull();
    // Step 1's text is back, byte for byte, not merely "a" text.
    expect(textAt(at.fragment)).toBe(at.prepared.file.after);
    // The one git command is the status reading: no add, no commit.
    expect(world.git).toHaveLength(1);
    expect(world.git[0]).toContain('status --porcelain=v1');
    expect(world.bodies).toEqual([`Closes #21\n\n${finish.sentence}`]);
  });

  it('reports a staging that git refused, and sends no commit', async () => {
    const world = stub({ git: [{ ok: false, stdout: '', stderr: 'fatal: pathspec did not match' }] });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('uncommitted');
    expect(finish.sentence).toBe(
      `no release commit: git could not stage ${FRAGMENT_PATH}, and said "fatal: pathspec did not match"`,
    );
    expect(world.git).toEqual([`${REPO}: git add -- ${FRAGMENT_PATH}`]);
    expect(world.bodies[0]).toContain('no release commit: git could not stage');
  });

  it('reports a fragment with nothing staged as already committed', async () => {
    const world = stub({ git: [OK, OK] });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('uncommitted');
    expect(finish.sentence).toBe(
      `no release commit: ${FRAGMENT_PATH} holds no change against HEAD, so it was already committed`,
    );
    expect(world.git).toEqual(commitArgv().slice(0, 2));
  });

  it('reports a commit git refused, and pushes nothing', async () => {
    const refusal = { ok: false, stdout: '', stderr: 'error: hook declined to update refs/heads/main' };
    const world = stub({ git: [OK, STAGED, refusal] });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('uncommitted');
    expect(finish.sentence).toBe(
      `no release commit: git refused \`${SUBJECT}\` over ${FRAGMENT_PATH},`
        + ' and said "error: hook declined to update refs/heads/main"',
    );
    expect(world.git).toEqual(commitArgv().slice(0, 3));
    expect(world.calls).toEqual(['findOpen', `get ${PR}`, `editBody ${PR}`]);
  });

  it('keeps a release whose sha could not be read', async () => {
    const world = stub({ git: [OK, STAGED, OK, { ok: false, stdout: '', stderr: 'fatal: bad revision' }] });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('released');
    expect(finish.sha).toBeNull();
    expect(world.calls[0]).toBe(`push ${REPO} ${BRANCH}`);
  });

  it('reports a push git refused, naming the commit it left behind, and forecasts nothing', async () => {
    const world = stub({
      git: COMMITTED,
      push: { ok: false, output: 'error: failed to push some refs\nhint: updates were rejected' },
    });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('unpushed');
    expect(finish.sha).toBe(SHA);
    expect(finish.sentence).toBe(
      `the \`${SUBJECT}\` commit ${SHA.slice(0, 7)} was made but could not be pushed`
        + ` to ${BRANCH}: error: failed to push some refs`,
    );
    expect(finish.forecast).toBeNull();
    expect(world.forecasts).toEqual([]);
    expect(world.bodies[0]).toContain('was made but could not be pushed');
  });

  it('leaves a body that already carries the sentence as it is', async () => {
    const world = stub({ detail: detail(`Closes #21\n\n${SKIP_SENTENCE}`) });

    const finish = await finishRelease(finishOf(SKIPPED), world.seams);

    expect(finish.body).toEqual({ number: PR, carried: true, already: true, problem: null });
    expect(world.bodies).toEqual([]);
    expect(world.calls).toEqual(['findOpen', `get ${PR}`]);
  });

  it('reports a branch with no open pull request to write the sentence to', async () => {
    const world = stub({ pull: null });

    const finish = await finishRelease(finishOf(SKIPPED), world.seams);

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

    const finish = await finishRelease(finishOf(SKIPPED), world.seams);

    expect(finish.outcome).toBe('skipped');
    expect(finish.body?.carried).toBe(false);
    expect(finish.body?.problem).toContain('gh: could not authenticate');
  });
});

/** The base the process's own checkout sits on under `--as-worktree` (#627). */
const BASE_BRANCH = 'stretch/1';

/** The pull request whose head is the base: the one a regression would write to. */
const BASE_PR = 627;

/** Runs git in `cwd` with no global or system config, throwing with what it said when it fails. */
function gitIn(cwd: string, args: readonly string[]): void {
  const run = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: PLANTED_ROOT, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...gitIdentityEnv(), LC_ALL: 'C' },
  });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
}

/** A repository under {@link PLANTED_ROOT} with one empty commit on {@link BASE_BRANCH}. */
function checkoutOnBase(): string {
  const dir = mkdtempSync(join(PLANTED_ROOT, 'main-checkout-'));
  gitIn(dir, ['init', '-q', '-b', BASE_BRANCH]);
  gitIn(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

/**
 * A provider with TWO open pull requests, one headed by the run's branch
 * and one by the base, each answering only for its own head, so a body
 * written through the wrong branch lands in the wrong pull request.
 */
function twoHeads(): { readonly pulls: PullRequests; readonly asked: string[]; readonly edits: string[] } {
  const asked: string[] = [];
  const edits: string[] = [];
  const heads: Record<string, PullRequestSummary> = {
    [BRANCH]: SUMMARY,
    [BASE_BRANCH]: { ...SUMMARY, number: BASE_PR, headRefName: BASE_BRANCH, baseRefName: 'main' },
  };
  const bodies: Record<number, PullRequestDetail> = {
    [PR]: detail('Closes #21'),
    [BASE_PR]: { ...detail('Stretch work'), number: BASE_PR, headRefName: BASE_BRANCH },
  };
  const pulls: PullRequests = {
    ...stubPulls({}, [], []),
    findOpen: async (branch: string) => {
      asked.push(branch);
      return Promise.resolve(heads[branch] ?? null);
    },
    get: async (number: number) => Promise.resolve(bodies[number] ?? null),
    editBody: async (number: number, body: string) => {
      edits.push(`#${number}: ${body}`);
      await Promise.resolve();
    },
  };
  return { pulls, asked, edits };
}

describe('finishRelease on the run\'s head branch', () => {
  const cwd = process.cwd();

  afterEach(() => {
    process.chdir(cwd);
  });

  it('pushes the run\'s branch and writes into its pull request while the process sits on the base', async () => {
    const checkout = checkoutOnBase();
    process.chdir(checkout);
    // The control: every other way of reading a branch answers the base,
    // so a finish that read one instead of its input would push the base
    // and write into pull request #627.
    expect(getCurrentBranch()).toBe(BASE_BRANCH);
    expect(getCurrentBranch(checkout)).toBe(BASE_BRANCH);
    const world = stub({ git: COMMITTED });
    const provider = twoHeads();

    const finish = await finishRelease(
      { repoRoot: checkout, branch: BRANCH, settings: SETTINGS, preparation: prepared() },
      { ...world.seams, verify: () => VERIFIED, pulls: () => provider.pulls },
    );

    expect(finish.outcome).toBe('released');
    expect(world.calls[0]).toBe(`push ${checkout} ${BRANCH}`);
    expect(provider.asked).toEqual([BRANCH]);
    expect(finish.body).toEqual({ number: PR, carried: true, already: false, problem: null });
    expect(provider.edits).toHaveLength(1);
    expect(provider.edits[0]).toStartWith(`#${PR}: Closes #21`);
    expect(provider.edits[0]).toContain(FORECAST_LINE);
  });

  it('writes a skip sentence into the run\'s pull request, not the base\'s', async () => {
    const checkout = checkoutOnBase();
    process.chdir(checkout);
    const world = stub({});
    const provider = twoHeads();

    const finish = await finishRelease(
      { repoRoot: checkout, branch: BRANCH, settings: SETTINGS, preparation: SKIPPED },
      { ...world.seams, pulls: () => provider.pulls },
    );

    expect(finish.body?.number).toBe(PR);
    expect(provider.asked).toEqual([BRANCH]);
    expect(provider.edits).toEqual([`#${PR}: Closes #21\n\n${SKIP_SENTENCE}`]);
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
      'forecast',
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
