/**
 * Tests for `rafa pr show` (`show.ts`): the report it renders, the three
 * provider reads behind it, the two that are allowed to fail, and its
 * refusals.
 *
 * {@link renderShow} is pure and total, so every shape of the report —
 * a blank title, a bot author, no checks, checks that could not be read,
 * no triage, a triage whose block did not read, a triage made against a
 * head the pull request has moved off — is driven by calling it, where
 * provoking a provider into each one would measure the provider instead.
 *
 * The cases that dispatch the command run it from a project of its own
 * beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so the config read is the one the case
 * planted and no case reads the real home. None of them reaches GitHub
 * or spawns `gh`: the provider is either the adapter over the recorded
 * fake (`pr/gh-fake.ts`) or a stub answering what the case wants read,
 * and the branch and the `origin` probe are seams.
 *
 * Three controls carry readings that would otherwise pass while wrong:
 * the provider factory records whether it was reached, so "a refused
 * line makes no provider" is measured; the recorded fake's own call log
 * is asserted, so a whole report is known to have come from the `gh`
 * commands and not from a default; and the `<n>` case asserts that the
 * call log holds NO `pr list`, so "the number on the line is used
 * instead of the branch" is a reading rather than an assumption.
 */
import type { PrSeams } from './pr-context.js';
import type { PrShowReading } from './show.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';
import type {
  ChecksReading,
  PullRequestComment,
  PullRequestDetail,
  PullRequests,
} from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, PR_NEEDS_GH } from '../../pr/index.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { TRIAGE_MARKER } from './last-triage.js';
import { PR_USAGE } from './pr-context.js';
import { createPrShowCommand, renderShow } from './show.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-show-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.show;

/** A config naming the GitHub CLI. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** A config naming no pull request provider at all. */
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The branch every case's seam answers. */
const BRANCH = 'feat/rafa-20-pr-commands';

/** The URL the recorded fake gives pull request 41 of its own repository. */
const PULL_URL = 'https://github.com/open-tomato/rafa/pull/41';

/** The head commit the planted pull request is on. */
const HEAD_OID = '0badc0ffee1234567890abcdef1234567890abcd';

/** The fence a triage block opens with, spelled in parts so this file carries no block of its own. */
const FENCE = '```';

/** The URL the recorded fake gives the planted triage comment. */
const COMMENT_URL = `${PULL_URL}#issuecomment-77`;

/** A triage comment body carrying `block` as its `rafa:triage` block. */
function triageBody(block: readonly string[]): string {
  return [TRIAGE_MARKER, '**rafa triage**: `conflict-lockfile`, simple', `${FENCE}rafa:triage`, ...block, FENCE, '']
    .join('\n');
}

/** The triage comment the planted pull request carries. */
const TRIAGE_BODY = triageBody([
  `head: "${HEAD_OID}"`,
  'at: "2026-09-18T12:00:00Z"',
  'class: "conflict-lockfile"',
  'simple: true',
  'attempts: 1',
  'files: ["bun.lock"]',
]);

/** A detail as a provider answers one, filled from `over`. */
function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    number: 41,
    title: 'rafa-20: pull request commands',
    url: PULL_URL,
    state: 'open',
    headRefName: BRANCH,
    baseRefName: 'main',
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-18T11:00:00Z',
    body: 'what this pull request does',
    headRefOid: HEAD_OID,
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    ...over,
  };
}

/** A reading with everything readable, which a case narrows from. */
function reading(over: Partial<PrShowReading> = {}): PrShowReading {
  return {
    detail: detail(),
    checks: {
      rows: [{ name: 'gates', state: 'SUCCESS', link: 'https://github.com/open-tomato/rafa/runs/1', outcome: 'pass' }],
      verdict: 'green',
    },
    checksProblem: null,
    triage: {
      id: '77',
      author: 'rafa-bot',
      url: COMMENT_URL,
      updatedAt: '2026-09-18T12:30:00Z',
      block: {
        head: HEAD_OID,
        at: '2026-09-18T12:00:00Z',
        class: 'conflict-lockfile',
        simple: true,
        attempts: 1,
        files: ['bun.lock'],
      },
      problems: [],
    },
    triageProblem: null,
    ...over,
  };
}

/** The lines of a rendered report, blank ones included. */
function linesOf(text: string): readonly string[] {
  return text.split('\n');
}

/** What a stub provider answers for the three members this action sends. */
interface StubAnswers {
  readonly get?: () => Promise<PullRequestDetail | null>;
  readonly checks?: () => Promise<ChecksReading>;
  readonly comments?: () => Promise<readonly PullRequestComment[]>;
  readonly findOpen?: () => Promise<PullRequestDetail | null>;
}

/** A provider answering `findOpen`, `get`, `checks` and `comments`, and refusing every other call. */
function stubPulls(answers: StubAnswers): PullRequests {
  return createPullRequestsDouble({
    findOpen: answers.findOpen ?? (() => Promise.resolve(detail())),
    get: answers.get ?? (() => Promise.resolve(detail())),
    checks: answers.checks ?? (() => Promise.resolve({ rows: [], verdict: 'none' })),
    comments: answers.comments ?? (() => Promise.resolve([])),
  }, { refusal: 'the stub provider models the reading members alone' }).pulls;
}

/** The seams a case hands the command, with what the provider control recorded. */
interface CaseSeams {
  readonly seams: PrSeams;
  /** Each root a provider was made for, in order. */
  readonly made: () => readonly string[];
}

/** Seams over `pulls`, recording every root a provider was made for. */
function caseSeams(pulls: PullRequests, branch: string = BRANCH): CaseSeams {
  const roots: string[] = [];
  return {
    seams: {
      pullRequests: (root) => {
        roots.push(root);
        return pulls;
      },
      readBranch: () => branch,
      readRemote: () => GITHUB_ORIGIN,
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

/** Dispatches `rafa pr show` over `seams` from `project`, with `words` after the action. */
async function ran(seams: PrSeams, project: PlantedProject, words: readonly string[] = []): Promise<Ran> {
  const command: RafaCommand = createPrShowCommand(seams);
  const run = await dispatchInProject(['pr', 'show', ...words], SUBJECTS, [command], project);
  return {
    run,
    events: words.includes('--output=json')
      ? eventsOf(run.stdout)
      : [],
  };
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): unknown {
  return (events.at(-1) as { data?: unknown }).data;
}

/** A fake `gh` repository holding pull request 41 green, with the triage comment on it. */
function plantedFake(): ReturnType<typeof createFakePrGh> {
  const fake = createFakePrGh();
  fake.plant({
    number: 41,
    headRefName: BRANCH,
    headRefOid: HEAD_OID,
    title: 'rafa-20: pull request commands',
    checks: [{ name: 'gates', state: 'SUCCESS', link: 'https://github.com/open-tomato/rafa/runs/1' }],
    comments: [
      {
        id: 77,
        author: { login: 'rafa-bot', isBot: false, name: 'rafa bot' },
        body: TRIAGE_BODY,
        createdAt: '2026-09-18T12:00:00Z',
        updatedAt: '2026-09-18T12:30:00Z',
      },
    ],
  });
  return fake;
}

describe('the report', () => {
  it('renders the pull request, its checks and its last triage, one section each', () => {
    expect(linesOf(renderShow(reading()))).toEqual([
      '#41 rafa-20: pull request commands',
      'open — octo — feat/rafa-20-pr-commands → main — mergeable (CLEAN)',
      PULL_URL,
      '',
      'checks green',
      '   pass    gates — SUCCESS (https://github.com/open-tomato/rafa/runs/1)',
      '',
      'triage conflict-lockfile — simple — after 1 attempt — assessed 2026-09-18T12:00:00Z — against this head',
      `   ${COMMENT_URL} — by rafa-bot`,
    ]);
  });

  it('keeps the number alone when the title is blank, and drops the URL line when the URL is', () => {
    const lines = linesOf(renderShow(reading({ detail: detail({ title: '  ', url: '' }) })));

    expect(lines[0]).toBe('#41');
    expect(lines[2]).toBe('');
  });

  it('marks a bot author, so a dependency bump reads as one', () => {
    const bumped = reading({ detail: detail({ author: { login: 'dependabot[bot]', isBot: true } }) });

    expect(linesOf(renderShow(bumped))[1]).toContain('dependabot[bot] (bot)');
  });

  it('names the merge state GitHub reported beside the mergeability it was narrowed to', () => {
    const dirty = reading({ detail: detail({ mergeable: 'conflicting', mergeStateStatus: 'DIRTY' }) });

    expect(linesOf(renderShow(dirty))[1]).toEndWith('conflicting (DIRTY)');
  });
});

describe('the checks section', () => {
  it('says the verdict is none and that nothing was reported, for a pull request GitHub ran nothing for', () => {
    const text = renderShow(reading({ checks: { rows: [], verdict: 'none' } }));

    expect(text).toContain('checks none\n   (no checks reported)');
  });

  it('writes one line per check, with its state and its link, whatever its outcome', () => {
    const mixed = reading({
      checks: {
        rows: [
          { name: 'gates', state: 'FAILURE', link: 'https://github.com/open-tomato/rafa/runs/1', outcome: 'fail' },
          { name: 'e2e', state: 'IN_PROGRESS', link: '', outcome: 'pending' },
        ],
        verdict: 'red',
      },
    });

    expect(renderShow(mixed)).toContain(
      ['checks red', '   fail    gates — FAILURE (https://github.com/open-tomato/rafa/runs/1)', '   pending e2e — IN_PROGRESS'].join('\n'),
    );
  });

  it('says the checks could not be read, with what the provider said, where none could be asked for', () => {
    const said = 'gh pull requests: gh pr checks 41 failed: could not connect';
    const text = renderShow(reading({ checks: null, checksProblem: said }));

    expect(text).toContain(`checks could not be read — ${said}`);
    expect(text).not.toContain('checks none');
  });
});

describe('the triage section', () => {
  it('says there is none, and names the command that makes one', () => {
    expect(renderShow(reading({ triage: null }))).toContain('triage none — run rafa pr triage to assess this pull request');
  });

  it('says the comments could not be read, with what the provider said', () => {
    const said = 'gh pull requests: gh api repos/{owner}/{repo}/issues/41/comments failed: HTTP 403';
    const text = renderShow(reading({ triage: null, triageProblem: said }));

    expect(text).toContain(`triage could not be read — ${said}`);
    expect(text).not.toContain('triage none');
  });

  it('names the head a triage was made against, and the head the pull request is on now', () => {
    const moved = reading({
      triage: { ...reading().triage!, block: { ...reading().triage!.block!, head: 'deadbee1234567890' } },
    });

    expect(renderShow(moved)).toContain('against head deadbee, where the head is now 0badc0f');
  });

  it('leaves out what the block did not say, falling back to when the comment last moved', () => {
    const thin = reading({
      triage: {
        ...reading().triage!,
        block: { head: null, at: null, class: 'ci-test', simple: null, attempts: 0, files: null },
      },
    });

    expect(renderShow(thin)).toContain('triage ci-test — commented 2026-09-18T12:30:00Z\n');
  });

  it('counts more than one attempt, in the plural', () => {
    const twice = reading({
      triage: { ...reading().triage!, block: { ...reading().triage!.block!, attempts: 2 } },
    });

    expect(renderShow(twice)).toContain('after 2 attempts');
  });

  it('reports a triage comment whose block did not read, and still links the comment', () => {
    const broken = reading({
      triage: { ...reading().triage!, block: null, problems: ['its rafa:triage block was never closed'] },
    });
    const lines = linesOf(renderShow(broken));

    expect(lines.at(-3)).toStartWith('triage unreadable — commented ');
    expect(lines.at(-2)).toBe(`   ${COMMENT_URL} — by rafa-bot`);
    expect(lines.at(-1)).toBe('   its rafa:triage block was never closed');
  });
});

describe('the pull request of the branch, over the recorded gh', () => {
  it('reports it from gh pr list --head, gh pr view, gh pr checks and the comments API', async () => {
    const fake = plantedFake();
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));
    const { run } = await ran(seams.seams, freshProject());

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(linesOf(run.stdout.trimEnd())).toEqual([
      '#41 rafa-20: pull request commands',
      'open — octo — feat/rafa-20-pr-commands → main — mergeable (CLEAN)',
      PULL_URL,
      '',
      'checks green',
      '   pass    gates — SUCCESS (https://github.com/open-tomato/rafa/runs/1)',
      '',
      'triage conflict-lockfile — simple — after 1 attempt — assessed 2026-09-18T12:00:00Z — against this head',
      `   ${COMMENT_URL} — by rafa-bot`,
    ]);
    expect(fake.calls().map((call) => call.slice(0, 2))).toEqual([
      ['pr', 'list'],
      ['pr', 'view'],
      ['pr', 'checks'],
      ['api', 'repos/{owner}/{repo}/issues/41/comments'],
    ]);
  });

  it('reads the number on the line instead of the branch, asking gh for no list at all', async () => {
    const fake = plantedFake();
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }), 'some-other-branch');
    const { run } = await ran(seams.seams, freshProject(), ['41']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('#41 rafa-20: pull request commands');
    expect(fake.calls().map((call) => call.slice(0, 2))).toEqual([
      ['pr', 'view'],
      ['pr', 'checks'],
      ['api', 'repos/{owner}/{repo}/issues/41/comments'],
    ]);
  });

  it('gives the pull request, the checks, the triage and the text as the json result', async () => {
    const fake = plantedFake();
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));
    const { run, events } = await ran(seams.seams, freshProject(), ['--output=json']);

    expect(run.exitCode).toBe(0);
    expect(dataOf(events)).toMatchObject({
      detail: { number: 41, mergeable: 'mergeable', mergeStateStatus: 'CLEAN', headRefOid: HEAD_OID },
      checks: { verdict: 'green', rows: [{ name: 'gates', state: 'SUCCESS', outcome: 'pass' }] },
      checksProblem: null,
      triage: { id: '77', author: 'rafa-bot', url: COMMENT_URL, block: { class: 'conflict-lockfile', attempts: 1 } },
      triageProblem: null,
    });
    expect((dataOf(events) as { text: string }).text).toContain('triage conflict-lockfile');
  });
});

describe('a provider that could not be asked everything', () => {
  it('still reports the pull request, with each section saying what it could not read', async () => {
    const checksSaid = 'gh pull requests: gh pr checks 41 failed: could not connect';
    const commentsSaid = 'gh pull requests: gh api .../comments failed: HTTP 403';
    const pulls = stubPulls({
      checks: () => Promise.reject(new Error(checksSaid)),
      comments: () => Promise.reject(new Error(commentsSaid)),
    });
    const { run } = await ran(caseSeams(pulls).seams, freshProject());

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`checks could not be read — ${checksSaid}`);
    expect(run.stdout).toContain(`triage could not be read — ${commentsSaid}`);
    expect(run.stdout).toContain('#41 rafa-20: pull request commands');
  });

  it('carries what each read said as its own problem in json mode', async () => {
    const pulls = stubPulls({
      checks: () => Promise.reject(new Error('checks: no')),
      comments: () => Promise.reject(new Error('comments: no')),
    });
    const { events } = await ran(caseSeams(pulls).seams, freshProject(), ['--output=json']);

    expect(dataOf(events)).toMatchObject({
      checks: null,
      checksProblem: 'checks: no',
      triage: null,
      triageProblem: 'comments: no',
    });
  });
});

describe('the refusals', () => {
  it('refuses a word that is no pull request number, naming the usage, and makes no provider', async () => {
    const seams = caseSeams(stubPulls({}));
    const { run } = await ran(seams.seams, freshProject(), ['forty-one']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ "forty-one" is no pull request number, which is a whole number from 1\nUsage: ${USAGE}`);
    expect(run.stdout).toBe('');
    expect(seams.made()).toEqual([]);
  });

  it('refuses a second word on the line', async () => {
    const { run } = await ran(caseSeams(stubPulls({})).seams, freshProject(), ['41', '42']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Expected at most one pull request number, got 2: 41 42');
  });

  it('refuses a project whose provider is not gh with exit code 2 and the shared message', async () => {
    const seams = caseSeams(stubPulls({}));
    const { run } = await ran(seams.seams, freshProject(NONE_CONFIG));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(PR_NEEDS_GH);
    expect(seams.made()).toEqual([]);
  });

  it('refuses a number the repository has no pull request under, naming it', async () => {
    const pulls = stubPulls({ get: () => Promise.resolve(null) });
    const { run } = await ran(caseSeams(pulls).seams, freshProject(), ['99']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ No pull request #99 in the repository at ');
    expect(run.stderr).toContain(`Usage: ${USAGE}`);
  });

  it('refuses a branch with no open pull request, naming the branch and pointing at pr list', async () => {
    const pulls = stubPulls({ findOpen: () => Promise.resolve(null) });
    const { run } = await ran(caseSeams(pulls).seams, freshProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`No open pull request for the branch "${BRANCH}"`);
  });

  it('refuses with what the provider said when the pull request itself could not be read', async () => {
    const pulls = stubPulls({ get: () => Promise.reject(new Error('gh pull requests: gh pr view 41 failed: timeout')) });
    const { run } = await ran(caseSeams(pulls).seams, freshProject(), ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ Could not read pull request #41: gh pull requests: gh pr view 41 failed: timeout');
  });
});

describe('the command itself', () => {
  it('routes as pr show, declares both renderings, takes one optional argument and no flag, and is frozen', () => {
    const command = createPrShowCommand();

    expect([command.subject, command.action, command.name]).toEqual(['pr', 'show', 'pr show']);
    expect(command.outputs).toEqual(['text', 'json']);
    expect(command.args.map((arg) => [arg.name, arg.required ?? false])).toEqual([['n', false]]);
    expect(command.flags).toEqual([]);
    expect(Object.isFrozen(command)).toBe(true);
  });

  it('declares a summary, a description and examples, as the describe roster needs', () => {
    const command = createPrShowCommand();

    expect(command.summary.length > 0).toBe(true);
    expect(command.description.length > 0).toBe(true);
    expect(command.examples.map((example) => example.cmd)).toEqual([
      'rafa pr show',
      'rafa pr show 41',
      'rafa pr show 41 --output=json',
    ]);
  });
});
