/**
 * Tests for `rafa pr triage` (`triage.ts`): its refusals, the order it
 * reads in, which pull request it assesses, what it writes on GitHub and
 * what it gives json mode.
 *
 * The cases that dispatch the command run it from a project of its own
 * beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so the config read is the one the case
 * planted and no case reads the real home. None of them reaches GitHub
 * or spawns `gh`: the provider is the adapter over the recorded fake
 * (`pr/gh-fake.ts`), and the branch, the `origin` probe, git and the
 * clock are seams. No case spawns git either — every conflict reading
 * here goes through a stub runner, since what `git merge-tree` says is
 * measured against the real git in `triage-read.test.ts` and in
 * `src/pr/triage/conflict.test.ts`.
 *
 * The permission lookup behind the trust check is a seam too, made over
 * the same recorded fake, so the account a marker comment was written by
 * is answered by the planted repository and no case spawns `gh` for it.
 *
 * The ending an assessment that ended 0 names the next step with is
 * driven through an {@link endingProbe} — one state from a literal, the
 * readings counted — or turned off with `--no-hint`, which every case
 * that hands no `ending` seams types. Left to the system seams it would
 * read the real project: `git` and `gh` spawned in the scratch
 * directory the case planted.
 *
 * Five controls carry readings that would otherwise pass while wrong:
 *
 *   - The provider factory records whether it was reached, so "a refused
 *     line makes no provider" is measured rather than assumed.
 *   - The recorded fake's own call log is asserted, so a whole report is
 *     known to have come from the `gh` commands and not from a default.
 *   - The `<n>` case asserts the call log holds NO `pr list`, so "the
 *     number on the line is used instead of the branch" is a reading.
 *   - `--no-comment` asserts the log holds no `-X POST`, where the run
 *     without it holds one, so "writes none" is measured against a run
 *     that did write.
 *   - the planted marker comment is read TWICE, once written by an
 *     account the repository gives `read` and once by one it gives
 *     `admin`, so "an untrusted comment is ignored" is measured against
 *     the same comment being read as the store it is.
 *
 * The two remaining legs of the trust check the spec names —
 * `.specs/rafa-20-pr-commands.md`'s "write-holder passes, outsider
 * refused, lookup failure refused, allow-list honoured, a planted
 * outsider triage comment ignored and reported" — are measured through
 * this command too: a login the fake has never heard of is a failed
 * lookup rather than `read`, and `board.trustedAuthors` is read off the
 * project config this file plants, not handed over as a literal, so the
 * allow-list case measures the actual config wiring
 * (`src/commands/pr/pr-context.ts`) and not only `board/trust.ts`
 * itself.
 */
import type { TriageSeams } from './triage.js';
import type { RafaCommand } from '../../cli/command.js';
import type { NextEndingSeams } from '../../next/ending.js';
import type { CliEvent } from '../../ports/index.js';
import type { FakePrComment, FakePrGh, FakePullRequestSeed } from '../../pr/gh-fake.js';
import type { GitResult, GitRunner, PullRequests } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhPermissions } from '../../board/trust.js';
import { createFakePrGh, logFailedText } from '../../pr/gh-fake.js';
import { createGhPullRequests, PR_NEEDS_GH } from '../../pr/index.js';
import { TRIAGE_MARKER } from '../../pr/triage/comment.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';
import { ENDING_LINE, ENDING_QUESTION, endingProbe } from '../../tests/ending-probe.js';

import { PR_USAGE } from './pr-context.js';
import { createPrTriageCommand, DEFAULT_MAX_ATTEMPTS, readMaxAttempts } from './triage.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-triage-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.triage;

/** A config naming the GitHub CLI. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** A config naming no pull request provider at all. */
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The branch the seams answer unless a case says otherwise. */
const BRANCH = 'feat/pr-41';

/** The login the recorded fake writes a comment as, which every case gives write access. */
const FAKE_COMMENT_AUTHOR = 'rafa-fake';

/** The Actions run the failing check of the planted pull request points at. */
const RUN_ID = '9006';

/** The instant every assessment is stamped with, so no case reads a clock. */
const NOW = '2026-09-19T09:00:00Z';

/** A failing `gates` check pointing at {@link RUN_ID}. */
const FAILING_GATES = {
  name: 'gates',
  state: 'FAILURE',
  link: `https://github.com/open-tomato/rafa/actions/runs/${RUN_ID}/job/1`,
};

/** A passing `gates` check. */
const PASSING_GATES = {
  name: 'gates',
  state: 'SUCCESS',
  link: `https://github.com/open-tomato/rafa/actions/runs/${RUN_ID}/job/1`,
};

/** The `--log-failed` capture of a lint failure, in the recorded TAB shape. */
const LINT_LOG = logFailedText('gates', [
  '##[group]Run bunx eslint .',
  'src/pr/triage/select.ts',
  '  42:7  error  unused is assigned a value but never used  no-unused-vars',
  '##[endgroup]',
  '##[error]Process completed with exit code 1.',
]);

/**
 * The record separator the `-z` merge-tree output uses, built from its
 * codepoint so this source carries no control byte of its own.
 */
const NUL = String.fromCharCode(0);

/** A merged tree OID, which is what a conflicted merge-tree stdout opens with. */
const OID = '0'.repeat(40);

/** A git runner that resolves nothing, so no conflict is read locally. */
const NO_REFS: GitRunner = () => ({ ok: false, stdout: '', stderr: 'stub git: no such ref' });

/**
 * A fake `gh` repository, with `seeds` planted and the lint log under
 * {@link RUN_ID}, and write access for the account the fake writes a
 * comment as, which is what makes the triage comment it stores a
 * comment the next run may read back (`triage-trust.ts`).
 */
function plantedFake(seeds: readonly FakePullRequestSeed[]): ReturnType<typeof createFakePrGh> {
  const fake = createFakePrGh({ now: () => '2026-09-19T09:00:05Z' });
  for (const seed of seeds) fake.plant(seed);
  fake.plantRun(RUN_ID, LINT_LOG);
  fake.plantPermission(FAKE_COMMENT_AUTHOR, 'admin');
  return fake;
}

/** The seams a case hands the command, with what the provider control recorded. */
interface CaseSeams {
  readonly seams: TriageSeams;
  /** Each root a provider was made for, in order. */
  readonly made: () => readonly string[];
}

/** What a case varies about the seams. */
interface SeamOptions {
  readonly branch?: string;
  readonly readBranch?: () => string;
  readonly git?: GitRunner;
}

/**
 * Seams over `fake`, recording every root a provider was made for.
 *
 * The permission lookup is made over the same recorded fake, so the
 * trust reading behind the marker comment is answered by the planted
 * repository and no case spawns `gh` for it.
 */
function caseSeams(fake: ReturnType<typeof createFakePrGh>, options: SeamOptions = {}): CaseSeams {
  const pulls: PullRequests = createGhPullRequests({ gh: fake.run });
  const roots: string[] = [];
  return {
    seams: {
      pullRequests: (root) => {
        roots.push(root);
        return pulls;
      },
      readBranch: options.readBranch ?? ((): string => options.branch ?? BRANCH),
      readRemote: () => GITHUB_ORIGIN,
      permissions: () => createGhPermissions({ gh: fake.run }),
      git: () => options.git ?? NO_REFS,
      now: () => NOW,
    },
    made: () => [...roots],
  };
}

/** A project of this case's own, holding `config`. */
function freshProject(config: string = GH_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** What one run left: what it wrote, and its events when it wrote NDJSON. */
interface Ran {
  readonly run: CapturedRun;
  readonly events: readonly CliEvent[];
}

/**
 * Typed by every case driving no ending of its own, so that no case
 * composes the real sources and spawns `git` and `gh` in the scratch
 * project it planted. A case that hands the command `ending` seams
 * leaves it off and drives the ending through them.
 */
const NO_HINT = '--no-hint';

/** Dispatches `rafa pr triage` over `seams` from `project`, with `words` after the action. */
async function ran(seams: TriageSeams, project: PlantedProject, words: readonly string[] = []): Promise<Ran> {
  const command: RafaCommand = createPrTriageCommand(seams);
  const line = seams.ending === undefined
    ? [...words, NO_HINT]
    : words;
  const run = await dispatchInProject(['pr', 'triage', ...line], SUBJECTS, [command], project);
  return {
    run,
    events: words.includes('--output=json')
      ? eventsOf(run.stdout)
      : [],
  };
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): Record<string, unknown> {
  return (events.at(-1) as { data?: Record<string, unknown> }).data ?? {};
}

/** Every `gh` command handed to the fake, each as one line. */
function calls(fake: ReturnType<typeof createFakePrGh>): readonly string[] {
  return fake.calls().map((call) => call.join(' '));
}

/** A whole run over one planted pull request, through the recorded fake. */
async function overFake(
  seeds: readonly FakePullRequestSeed[],
  words: readonly string[] = [],
  options: SeamOptions = {},
  ending?: NextEndingSeams,
): Promise<Ran & { readonly fake: ReturnType<typeof createFakePrGh> }> {
  const fake = plantedFake(seeds);
  const seams = caseSeams(fake, options);
  const over: TriageSeams = ending === undefined
    ? seams.seams
    : { ...seams.seams, ending };
  return { ...await ran(over, freshProject(), words), fake };
}

/** A pull request that is red on `gates`, on the branch the seams answer. */
const RED_41: FakePullRequestSeed = {
  number: 41,
  title: 'rafa-20: pull request commands',
  headRefName: BRANCH,
  checks: [FAILING_GATES],
};

/**
 * A pull request that reports no checks at all, on the branch the seams
 * answer. The fake plants no workflow for it, so its workflow count
 * reads 0 — the `no-workflow` case — the same repository
 * `.pull-requests-double.ts` and `unchecked.ts` describe as having none.
 */
const NO_CHECKS_41: FakePullRequestSeed = {
  number: 41,
  title: 'rafa-20: pull request commands',
  headRefName: BRANCH,
  checks: [],
};

describe('the line', () => {
  it('refuses a second word, naming the usage line, and makes no provider', async () => {
    const seams = caseSeams(plantedFake([RED_41]));

    const outcome = await ran(seams.seams, freshProject(), ['41', '42']);

    expect(outcome.run.exitCode).toBe(1);
    expect(outcome.run.stderr).toContain('Expected at most one pull request number, got 2');
    expect(outcome.run.stderr).toContain(USAGE);
    expect(seams.made()).toEqual([]);
  });

  it('refuses a word that is no pull request number', async () => {
    const outcome = await overFake([RED_41], ['forty-one']);

    expect(outcome.run.exitCode).toBe(1);
    expect(outcome.run.stderr).toContain('"forty-one" is no pull request number');
    expect(calls(outcome.fake)).toEqual([]);
  });

  it('refuses a --max-attempts that is no whole number from 1, naming the order that works', async () => {
    const outcome = await overFake([RED_41], ['--max-attempts=0']);

    expect(outcome.run.exitCode).toBe(1);
    expect(outcome.run.stderr).toContain('"0" is no attempt count, which is a whole number from 1');
    expect(outcome.run.stderr).toContain('type the pull request number before the flags');
  });

  it('refuses --max-attempts with no value, which is how a flag swallows nothing', () => {
    expect(() => readMaxAttempts({ 'max-attempts': true }, USAGE)).toThrow('--max-attempts with no value');
  });

  it('reads no flag as the default cap, and a whole number as itself', () => {
    expect(readMaxAttempts({}, USAGE)).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(readMaxAttempts({ 'max-attempts': '5' }, USAGE)).toBe(5);
  });

  it('refuses a repository whose provider is not gh with exit code 2 and the shared message', async () => {
    const seams = caseSeams(plantedFake([RED_41]));

    const outcome = await ran(seams.seams, freshProject(NONE_CONFIG), ['41']);

    expect(outcome.run.exitCode).toBe(2);
    expect(outcome.run.stderr).toContain(PR_NEEDS_GH);
  });

  it('refuses a number the repository has no pull request under', async () => {
    const outcome = await overFake([RED_41], ['99']);

    expect(outcome.run.exitCode).toBe(1);
    expect(outcome.run.stderr).toContain('No pull request #99 in the repository at');
  });
});

describe('assessing the pull request a number names', () => {
  it('reads it, its checks, its comments and the failing run log, and never lists pull requests', async () => {
    const outcome = await overFake([RED_41], ['41']);

    expect(outcome.run.exitCode).toBe(0);
    expect(calls(outcome.fake).filter((call) => call.startsWith('pr list'))).toEqual([]);
    expect(calls(outcome.fake).some((call) => call.startsWith('pr view 41 --json'))).toBe(true);
    expect(calls(outcome.fake).some((call) => call.startsWith('pr checks 41'))).toBe(true);
    expect(calls(outcome.fake)).toContain(`run view ${RUN_ID} --log-failed`);
  });

  it('classes it from the failing step and prints the class, the evidence and the follow-up prompt', async () => {
    const outcome = await overFake([RED_41], ['41']);

    expect(outcome.run.stdout).toContain('ci-lint — not simple — attempts 0 of 2');
    expect(outcome.run.stdout).toContain('Failing step: bunx eslint .');
    expect(outcome.run.stdout).toContain('is assigned a value but never used');
    expect(outcome.run.stdout).toContain('# Assessed pull request: act on this triage');
  });

  it('classes a zero-check pull request no-checks, naming the workflow count read and the --skip-checks line', async () => {
    const outcome = await overFake([NO_CHECKS_41], ['41']);

    expect(outcome.run.exitCode).toBe(0);
    expect(calls(outcome.fake)).toContain('api repos/{owner}/{repo}/actions/workflows');
    expect(outcome.run.stdout).toContain('no-checks — not simple — attempts 0 of 2');
    expect(outcome.run.stdout).toContain('the head reports no checks at all; the repository defines 0 workflows;'
      + ' to merge it anyway, run rafa pr merge 41 --skip-checks');
    expect(outcome.run.stdout).toContain('Workflows: The repository defines 0 workflows.');
    expect(outcome.run.stdout)
      .toContain('nothing on GitHub has tested this branch; you are relying on the checks run locally');
    expect(outcome.run.stdout)
      .toContain('To merge it anyway: rafa pr merge 41 --skip-checks (it asks first; --yes may answer it)');
  });

  it('leaves one triage comment carrying the marker, the class and the head it was read at', async () => {
    const outcome = await overFake([RED_41], ['41']);
    const posted = outcome.fake.pull(41)?.comments ?? [];

    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toContain(TRIAGE_MARKER);
    expect(posted[0]?.body).toContain('class: "ci-lint"');
    expect(posted[0]?.body).toContain(`at: "${NOW}"`);
    expect(outcome.run.stdout).toContain('Posted the triage comment:');
  });

  it('reads the conflicting files through git for a head GitHub says does not merge', async () => {
    const sent: string[][] = [];
    const git: GitRunner = (args): GitResult => {
      sent.push([...args]);
      if (args[0] === 'rev-parse') return { ok: true, stdout: '', stderr: '' };
      return { ok: false, stdout: [OID, 'bun.lock', '', ''].join(NUL), stderr: '' };
    };

    const outcome = await overFake(
      [{ ...RED_41, checks: [], mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }],
      ['41'],
      { git },
    );

    expect(sent.some((args) => args[0] === 'merge-tree')).toBe(true);
    expect(outcome.run.stdout).toContain('conflict-lockfile — simple — attempts 0 of 2');
    expect(outcome.run.stdout).toContain('Conflicting files: bun.lock');
  });

  it('asks git nothing for a head GitHub says merges cleanly', async () => {
    const sent: string[][] = [];
    const git: GitRunner = (args): GitResult => {
      sent.push([...args]);
      return { ok: false, stdout: '', stderr: '' };
    };

    await overFake([RED_41], ['41'], { git });

    expect(sent).toEqual([]);
  });
});

describe('writing the comment, and not writing it', () => {
  it('edits the one comment already there when the head has moved, rather than posting a second', async () => {
    const fake = plantedFake([RED_41]);
    const seams = caseSeams(fake);
    const project = freshProject();

    await ran(seams.seams, project, ['41']);
    fake.update(41, (pull) => ({ ...pull, headRefOid: '1'.repeat(40) }));
    const second = await ran(seams.seams, project, ['41']);

    expect(fake.pull(41)?.comments).toHaveLength(1);
    expect(second.run.stdout).toContain('Edited the triage comment:');
  });

  it('writes nothing under --no-comment, where the same run without it posts', async () => {
    const quiet = await overFake([RED_41], ['41', '--no-comment']);
    const loud = await overFake([RED_41], ['41']);

    expect(calls(quiet.fake).filter((call) => call.includes('-X POST'))).toEqual([]);
    expect(calls(loud.fake).filter((call) => call.includes('-X POST'))).toHaveLength(1);
    expect(quiet.run.stdout).toContain('No comment was written.');
    expect(quiet.fake.pull(41)?.comments ?? []).toEqual([]);
  });

  it('assesses nothing and shows the stored comment when the head has not moved', async () => {
    const fake = plantedFake([RED_41]);
    const seams = caseSeams(fake);
    const project = freshProject();

    await ran(seams.seams, project, ['41']);
    const again = await ran(seams.seams, project, ['41']);

    expect(again.run.stdout).toContain('already assessed at');
    expect(again.run.stdout).toContain('class ci-lint');
    expect(again.run.stdout).not.toContain('Follow-up prompt:');
    expect(calls(fake).filter((call) => call.startsWith('run view'))).toHaveLength(1);
  });

  it('says a green pull request has nothing to triage and writes no comment', async () => {
    const outcome = await overFake([{ ...RED_41, checks: [PASSING_GATES] }], ['41']);

    expect(outcome.run.stdout).toContain('so there is nothing to triage');
    expect(outcome.fake.pull(41)?.comments ?? []).toEqual([]);
  });
});

describe('who the stored comment is read from', () => {
  /** A marker comment written by `login`, pinned to the pull request's own head. */
  function plantedTriage(login: string, head: string): FakePrComment {
    const block = [
      '```rafa:triage',
      `head: "${head}"`,
      'at: "2026-09-19T08:00:00Z"',
      'class: "ci-lint"',
      'simple: false',
      'attempts: 0',
      'files: []',
      '```',
    ].join('\n');
    return {
      id: 77,
      author: { login, isBot: false, name: login },
      body: `${TRIAGE_MARKER}\n**rafa triage**: \`ci-lint\`, not simple, not resolved\n\n${block}\n`,
      createdAt: '2026-09-19T08:00:00Z',
      updatedAt: '2026-09-19T08:00:00Z',
    };
  }

  /**
   * A run over pull request 41 carrying one marker comment written by
   * `login`, whom the repository gives `permission` when one is named.
   */
  async function overPlantedComment(
    login: string,
    permission?: string,
  ): Promise<Ran & { readonly fake: FakePrGh }> {
    const fake = plantedFake([RED_41]);
    if (permission !== undefined) fake.plantPermission(login, permission);
    const head = fake.pull(41)?.headRefOid ?? '';
    fake.update(41, (pull) => ({ ...pull, comments: [plantedTriage(login, head)] }));
    const outcome = await ran(caseSeams(fake).seams, freshProject(), ['41']);
    return { ...outcome, fake };
  }

  it('ignores a marker comment nobody trusted, reports it, and posts its own beside it', async () => {
    const outcome = await overPlantedComment('stranger', 'read');

    expect(outcome.run.exitCode).toBe(0);
    expect(outcome.run.stdout)
      .toContain('was written by stranger, who has no write access to open-tomato/rafa');
    expect(outcome.run.stdout).toContain('it was ignored and nothing in it was read');
    expect(outcome.run.stdout).toContain('Posted the triage comment:');
    expect(outcome.fake.pull(41)?.comments.map((one) => one.author.login))
      .toEqual(['stranger', FAKE_COMMENT_AUTHOR]);
  });

  it('reads the same comment as the store it is when a write-holder wrote it', async () => {
    const outcome = await overPlantedComment(FAKE_COMMENT_AUTHOR);

    expect(outcome.run.stdout).toContain('already assessed at');
    expect(outcome.run.stdout).not.toContain('was ignored');
    expect(outcome.fake.pull(41)?.comments).toHaveLength(1);
  });

  it('ignores a marker comment whose lookup failed, reporting that access could not be read', async () => {
    // No permission is planted for `octocat`, so the fake answers 404
    // and the reading is `lookup-failed` rather than `no-write-access`.
    const outcome = await overPlantedComment('octocat');

    expect(outcome.run.exitCode).toBe(0);
    expect(outcome.run.stdout)
      .toContain('whose write access to open-tomato/rafa could not be read');
    expect(outcome.run.stdout).toContain('it was ignored and nothing in it was read');
    expect(outcome.fake.pull(41)?.comments.map((one) => one.author.login))
      .toEqual(['octocat', FAKE_COMMENT_AUTHOR]);
  });

  it('honours board.trustedAuthors read off the project config, spending no lookup on it', async () => {
    const fake = plantedFake([RED_41]);
    const head = fake.pull(41)?.headRefOid ?? '';
    fake.update(41, (pull) => ({ ...pull, comments: [plantedTriage('rafa-bot', head)] }));
    const config = `${GH_CONFIG}board:\n  trustedAuthors: [rafa-bot]\n`;

    const outcome = await ran(caseSeams(fake).seams, freshProject(config), ['41']);

    expect(outcome.run.stdout).toContain('already assessed at');
    expect(outcome.run.stdout).not.toContain('was ignored');
    expect(calls(fake).some((call) => call.includes('collaborators/rafa-bot/permission'))).toBe(false);
  });
});

describe('which pull request a bare line assesses', () => {
  it('takes the open pull request of the branch checked out at the project root, whatever colour it is', async () => {
    const outcome = await overFake([RED_41]);

    expect(outcome.run.stdout).toContain(`assessing #41, the pull request open on ${BRANCH}`);
    expect(outcome.run.stdout).toContain('ci-lint — not simple');
  });

  it('falls back on the red pull requests when the branch has none, and skips the green ones', async () => {
    const outcome = await overFake(
      [
        { ...RED_41, headRefName: 'feat/pr-41' },
        { number: 42, title: 'green one', checks: [PASSING_GATES], updatedAt: NOW },
      ],
      [],
      { branch: 'main' },
    );

    expect(outcome.run.stdout).toContain('1 red: assessing #41');
    expect(outcome.run.stdout).not.toContain('#42');
  });

  it('says so and assesses nothing where no pull request is red and none is on the branch', async () => {
    const outcome = await overFake([{ number: 42, checks: [PASSING_GATES] }], [], { branch: 'main' });

    expect(outcome.run.exitCode).toBe(0);
    expect(outcome.run.stdout).toContain('no red pull request to triage');
  });

  it('skips a zero-check pull request off the branch, selecting none rather than reading it as red', async () => {
    const outcome = await overFake(
      [{ ...NO_CHECKS_41, headRefName: 'feat/pr-41' }],
      [],
      { branch: 'main' },
    );

    expect(outcome.run.exitCode).toBe(0);
    expect(outcome.run.stdout).toContain('no red pull request to triage');
    expect(outcome.run.stdout).not.toContain('#41');
  });

  it('warns at a detached HEAD and reads the red pull requests instead of refusing', async () => {
    const outcome = await overFake([RED_41], [], { branch: 'HEAD' });

    expect(outcome.run.exitCode).toBe(0);
    expect(outcome.run.stdout).toContain('is on no branch');
    expect(outcome.run.stdout).toContain('1 red: assessing #41');
  });

  it('warns when git cannot read the branch at all, and still reads the red pull requests', async () => {
    const outcome = await overFake([RED_41], [], {
      readBranch: (): string => {
        throw new Error('fatal: not a git repository');
      },
    });

    expect(outcome.run.exitCode).toBe(0);
    expect(outcome.run.stdout).toContain('cannot be read');
    expect(outcome.run.stdout).toContain('1 red: assessing #41');
  });
});

describe('json mode', () => {
  it('gives the selection, every reading and the rendered text as the terminal result data', async () => {
    const outcome = await overFake([RED_41], ['41', '--output=json']);
    const data = dataOf(outcome.events);
    const readings = data['readings'] as readonly Record<string, unknown>[];

    expect(data['selection']).toBeNull();
    expect(readings).toHaveLength(1);
    expect((readings[0]?.['assessment'] as Record<string, unknown>)['triageClass']).toBe('ci-lint');
    expect(readings[0]?.['maxAttempts']).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(String(data['text'])).toContain('ci-lint — not simple');
  });

  it('carries the selection for a bare line, and writes no report line to stdout beside the events', async () => {
    const outcome = await overFake([RED_41], ['--output=json']);
    const data = dataOf(outcome.events);

    expect((data['selection'] as Record<string, unknown>)['decision']).toBe('branch');
    expect(outcome.events.map((event) => event.type)).toEqual(['start', 'result']);
  });
});

describe('the ending it names the next step with', () => {
  it('ends an assessment that ran by printing the step that follows, last of all', async () => {
    const probe = endingProbe();
    const outcome = await overFake([RED_41], ['41'], {}, probe.seams);

    expect(outcome.run.exitCode).toBe(0);
    expect(outcome.run.stdout.trimEnd().split('\n')
      .at(-1)).toBe(ENDING_LINE);
    expect([probe.reads(), probe.asked()]).toEqual([1, []]);
  });

  it('puts the question where there is a terminal, printing no line', async () => {
    const probe = endingProbe({ terminal: true });
    const outcome = await overFake([RED_41], ['41'], {}, probe.seams);

    expect(probe.asked()).toEqual([ENDING_QUESTION]);
    expect(outcome.run.stdout).not.toContain(ENDING_LINE);
  });

  it('reads nothing and prints nothing under --no-hint, which the run without it does both of', async () => {
    const off = endingProbe();
    const on = endingProbe();
    const quiet = await overFake([RED_41], ['41', NO_HINT], {}, off.seams);
    const loud = await overFake([RED_41], ['41'], {}, on.seams);

    expect([off.reads(), quiet.run.stdout.includes('Next:')]).toEqual([0, false]);
    expect([on.reads(), loud.run.stdout.includes(ENDING_LINE)]).toEqual([1, true]);
  });
});
