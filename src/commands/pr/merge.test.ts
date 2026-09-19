/**
 * Tests for `rafa pr merge` (`merge.ts`): what it refuses before it
 * asks anything, the question and the two ways past it, the merge it
 * sends, each clean-up step it runs, what a failed step leaves, and the
 * follow-ups, and the roadmap tick it writes after the merge.
 *
 * Every case dispatches the real command from a project of its own
 * beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so the config read is the one the case
 * planted and no case reads the real home. Nothing here reaches GitHub
 * or git: the provider is a stub recording every member it was sent,
 * and the git runner is a planted answer per command recording every
 * argv. The task after this one drives the same command over a real
 * repository with a bare remote.
 *
 * Three controls carry readings that would otherwise pass while wrong:
 * the provider records whether `merge` was ever sent, so "it refused
 * and merged nothing" is measured; the git runner records every command,
 * so "the clean-up stopped at the step that failed" is measured rather
 * than inferred from the message; and the prompter throws when it is
 * opened under `--yes`, so "the question was skipped" is measured.
 */
import type { MergeSeams } from './merge.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';
import type {
  ChecksReading,
  GitResult,
  GitRunner,
  MergeOutcome,
  PullRequestDetail,
  PullRequests,
} from '../../pr/index.js';
import type { Prompter } from '../../project/root-choice.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { PR_NEEDS_GH } from '../../pr/index.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createPrMergeCommand, summaryLine } from './merge.js';
import { PR_USAGE } from './pr-context.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.merge;

/** A config naming the GitHub CLI. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** A config naming no pull request provider at all. */
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The head branch of every case's pull request. */
const BRANCH = 'feat/rafa-20-pr-commands';

/** The base branch of every case's pull request. */
const BASE = 'main';

/** The version a planted `package.json` carries. */
const VERSION = '0.4.0';

/** A pull request detail as a stub answers one, filled from `over`. */
function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    number: 41,
    title: 'rafa-20: pull request commands',
    url: 'https://github.com/open-tomato/rafa/pull/41',
    state: 'open',
    headRefName: BRANCH,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-18T11:00:00Z',
    body: '',
    headRefOid: '1f0c2b7de6a94c1a0b5e3d2f4a6b8c0d1e2f3a4b',
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    ...over,
  };
}

/** What a stub provider answers for the members this action can send. */
interface StubAnswers {
  readonly get?: () => Promise<PullRequestDetail | null>;
  readonly checks?: () => Promise<ChecksReading>;
  readonly merge?: () => Promise<MergeOutcome>;
}

/** A stub provider, and the log of every member it was sent. */
interface StubPulls {
  readonly pulls: PullRequests;
  /** Each member reached, in order, a merge written `merge 41 squash`. */
  readonly sent: () => readonly string[];
}

/** A provider answering the three members this action sends, refusing every other call and recording each. */
function stubPulls(answers: StubAnswers = {}): StubPulls {
  const sent: string[] = [];
  const refuse = (name: string) => (): Promise<never> => {
    sent.push(name);
    return Promise.reject(new Error('the stub provider models get, checks and merge alone'));
  };
  const pulls: PullRequests = {
    kind: 'gh',
    findOpen: refuse('findOpen'),
    list: refuse('list'),
    get: (number: number) => {
      sent.push(`get ${number}`);
      return answers.get === undefined
        ? Promise.resolve(detail())
        : answers.get();
    },
    checks: (number: number) => {
      sent.push(`checks ${number}`);
      return answers.checks === undefined
        ? Promise.resolve({ rows: [], verdict: 'green' })
        : answers.checks();
    },
    browse: refuse('browse'),
    merge: (number: number, method: string) => {
      sent.push(`merge ${number} ${method}`);
      return answers.merge === undefined
        ? Promise.resolve({ merged: true, detail: 'Squashed and merged pull request #41' })
        : answers.merge();
    },
    comments: refuse('comments'),
    comment: refuse('comment'),
    editComment: refuse('editComment'),
    failedLog: refuse('failedLog'),
  };
  return { pulls, sent: () => [...sent] };
}

/** A git answer that worked, carrying `stdout`. */
function ok(stdout = ''): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A git answer that failed, carrying `stderr`. */
function failed(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** A git runner over planted answers, and the log of every command it was handed. */
interface FakeGit {
  readonly git: (root: string) => GitRunner;
  /** Each command, in order, the words after `git` joined by a space. */
  readonly ran: () => readonly string[];
}

/** The answers every case starts from: a clean tree, this checkout alone, and a remote still holding the branch. */
function defaultAnswers(root: string): Record<string, GitResult> {
  return {
    'status --porcelain': ok(''),
    'worktree list --porcelain': ok(`worktree ${root}\nbranch refs/heads/${BRANCH}\n\n`),
    'rev-parse --show-toplevel': ok(`${root}\n`),
    [`ls-remote --heads origin ${BRANCH}`]: ok(`1f0c2b7\trefs/heads/${BRANCH}\n`),
    [`tag --list v${VERSION}`]: ok(''),
  };
}

/** A git runner answering the planted commands, every other command working and writing nothing. */
function fakeGit(root: string, over: Readonly<Record<string, GitResult>> = {}): FakeGit {
  const ran: string[] = [];
  const answers = { ...defaultAnswers(root), ...over };
  return {
    git: () => (args) => {
      const line = args.join(' ');
      ran.push(line);
      return answers[line] ?? ok('');
    },
    ran: () => [...ran],
  };
}

/** The roadmap issue the tick cases plant, and the body it carries. */
const ROADMAP_ISSUE = 31;

/** The roadmap body the planted issue holds before a tick. */
const ROADMAP_BODY = '- [ ] #20 plans from the board\n- [ ] #33 the board setup\n';

/** A config naming the GitHub CLI and the roadmap issue. */
const ROADMAP_CONFIG = `${GH_CONFIG}roadmap:\n  issue: ${ROADMAP_ISSUE}\n`;

/** A `gh` runner over one planted roadmap issue, and the log of every command it was handed. */
interface FakeGh {
  readonly gh: (root: string) => GhRunner;
  /** Each command, in order, the arguments joined by a space. */
  readonly ran: () => readonly string[];
}

/**
 * A runner serving the roadmap read and write, storing what a PATCH
 * sends. `broken` fails every call, which is how a board that will not
 * take the tick is driven.
 */
function fakeGh(broken = false): FakeGh {
  const ran: string[] = [];
  let stored = ROADMAP_BODY;
  const gh: GhRunner = (args) => {
    ran.push(args.join(' '));
    if (broken) return Promise.resolve({ ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });
    const sent = args.find((arg) => arg.startsWith('body='));
    if (sent !== undefined) stored = sent.slice('body='.length);
    const answered: GhResult = { ok: true, stdout: JSON.stringify({ number: ROADMAP_ISSUE, body: stored }), stderr: '' };
    return Promise.resolve(answered);
  };
  return { gh: () => gh, ran: () => [...ran] };
}

/** A prompter answering `answer` once, then nothing, and recording each question. */
function stubPrompter(answer: string | null): { open: () => Prompter; asked: () => readonly string[] } {
  const asked: string[] = [];
  let left: string | null = answer;
  return {
    open: () => ({
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        const next = left;
        left = null;
        return Promise.resolve(next);
      },
      close: () => undefined,
    }),
    asked: () => [...asked],
  };
}

/** What a case hands the command. */
interface CaseSeams {
  readonly seams: MergeSeams;
  readonly git: FakeGit;
  readonly gh: FakeGh;
  readonly asked: () => readonly string[];
}

/** How a case is set up beyond the defaults. */
interface CaseOptions {
  /** Git answers replacing the defaults, keyed by the words after `git`. */
  readonly git?: Readonly<Record<string, GitResult>>;
  /** What the question is answered with. A terminal is assumed unless `terminal` says otherwise. */
  readonly answer?: string | null;
  /** False for a machine with no terminal to ask on. */
  readonly terminal?: boolean;
  /** True for a board that fails every call the roadmap tick makes. */
  readonly brokenBoard?: boolean;
}

/** Seams over `pulls` for a project, with the git and prompter controls. */
function caseSeams(pulls: PullRequests, project: PlantedProject, options: CaseOptions = {}): CaseSeams {
  const git = fakeGit(project.root, options.git ?? {});
  const gh = fakeGh(options.brokenBoard ?? false);
  const prompter = stubPrompter(Object.hasOwn(options, 'answer')
    ? options.answer ?? null
    : 'y');
  return {
    seams: {
      pullRequests: () => pulls,
      readBranch: () => BRANCH,
      readRemote: () => GITHUB_ORIGIN,
      git: git.git,
      gh: gh.gh,
      isTerminal: () => options.terminal ?? true,
      openPrompter: prompter.open,
    },
    git,
    gh,
    asked: prompter.asked,
  };
}

/** A project of this case's own, holding `config`. */
function freshProject(config: string = GH_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** Writes a `package.json` under the project root. */
function plantPackage(project: PlantedProject, text: string): void {
  writeFileSync(join(project.root, 'package.json'), text, 'utf8');
}

/** What one run left: what it wrote, and its events when it wrote NDJSON. */
interface Ran {
  readonly run: CapturedRun;
  readonly events: readonly CliEvent[];
  readonly lines: readonly string[];
}

/** Dispatches `rafa pr merge` over `seams` from `project`, with `words` after the action. */
async function ran(seams: MergeSeams, project: PlantedProject, words: readonly string[] = []): Promise<Ran> {
  const command: RafaCommand = createPrMergeCommand(seams);
  const run = await dispatchInProject(['pr', 'merge', ...words], SUBJECTS, [command], project);
  return {
    run,
    events: words.includes('--output=json')
      ? eventsOf(run.stdout)
      : [],
    lines: run.stdout.split('\n').filter((line) => line !== ''),
  };
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): Record<string, unknown> {
  return (events.at(-1) as { data?: Record<string, unknown> }).data ?? {};
}

describe('the summary line', () => {
  it('names the pull request, both branches and the method', () => {
    expect(summaryLine(detail(), 'squash')).toBe(`#41 rafa-20: pull request commands — ${BRANCH} → ${BASE} — squash`);
  });

  it('names the number alone where the title is blank, with no stray space', () => {
    expect(summaryLine(detail({ title: '  ' }), 'rebase')).toBe(`#41 — ${BRANCH} → ${BASE} — rebase`);
  });
});

describe('the line it is given', () => {
  it('refuses a method that is none of the three, naming them, and merges nothing', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const { run } = await ran(caseSeams(stub.pulls, project).seams, project, ['--method=fast-forward']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('"fast-forward" is no merge method; one of: squash, merge, rebase');
    expect(run.stderr).toContain(`Usage: ${USAGE}`);
    expect(stub.sent()).toEqual([]);
  });

  it('refuses a --yes that swallowed the number, naming the order that works', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const { run } = await ran(caseSeams(stub.pulls, project).seams, project, ['--yes', '41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('type the pull request number before the flags');
    expect(stub.sent()).toEqual([]);
  });

  it('refuses a project whose provider is not gh with exit code 2 and the shared message', async () => {
    const stub = stubPulls();
    const project = freshProject(NONE_CONFIG);
    const { run } = await ran(caseSeams(stub.pulls, project).seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(PR_NEEDS_GH);
    expect(stub.sent()).toEqual([]);
  });

  it('refuses a number the repository has no pull request for, having read nothing else', async () => {
    const stub = stubPulls({ get: () => Promise.resolve(null) });
    const project = freshProject();
    const { run } = await ran(caseSeams(stub.pulls, project).seams, project, ['9', '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('No pull request #9 at');
    expect(stub.sent()).toEqual(['get 9']);
  });
});

describe('what it refuses before asking anything', () => {
  it('refuses a dirty working tree, listing what git wrote, and merges nothing', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, {
      git: { 'status --porcelain': ok(' M src/pr/merge.ts\n?? notes.md\n') },
    });
    const { run } = await ran(seams.seams, project, ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('rafa pr merge refuses: the working tree has 2 changes.');
    expect(run.stderr).toContain('?? notes.md');
    expect(stub.sent()).toEqual(['get 41', 'checks 41']);
    expect(seams.asked()).toEqual([]);
  });

  it('refuses a pull request that does not merge, naming what GitHub said and pointing at triage', async () => {
    const stub = stubPulls({
      get: () => Promise.resolve(detail({ mergeable: 'conflicting', mergeStateStatus: 'DIRTY' })),
      checks: () => Promise.resolve({ rows: [], verdict: 'none' }),
    });
    const project = freshProject();
    const { run } = await ran(caseSeams(stub.pulls, project).seams, project, ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`#41 does not merge into ${BASE} — GitHub says conflicting (DIRTY)`);
    expect(run.stderr).toContain('Run rafa pr triage 41 to see why.');
  });

  it('refuses a pull request that is not green, naming the verdict', async () => {
    const stub = stubPulls({ checks: () => Promise.resolve({ rows: [], verdict: 'red' }) });
    const project = freshProject();
    const { run } = await ran(caseSeams(stub.pulls, project).seams, project, ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('#41 is not green — its checks failed (red)');
  });

  it('refuses a branch checked out in another worktree, naming it with the command that removes it', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const elsewhere = join(tempBase, 'other worktree');
    const seams = caseSeams(stub.pulls, project, {
      git: {
        'worktree list --porcelain':
          ok(`worktree ${project.root}\nbranch refs/heads/${BASE}\n\nworktree ${elsewhere}\nbranch refs/heads/${BRANCH}\n\n`),
      },
    });
    const { run } = await ran(seams.seams, project, ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`branch ${BRANCH} is checked out in another worktree`);
    expect(run.stderr).toContain(`git worktree remove '${elsewhere}'`);
    expect(seams.asked()).toEqual([]);
  });

  it('refuses a git reading that failed, naming what was being read and what git said', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, {
      git: { 'status --porcelain': failed('fatal: not a git repository') },
    });
    const { run } = await ran(seams.seams, project, ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Could not read the working tree: fatal: not a git repository');
    expect(seams.git.ran()).toEqual(['status --porcelain']);
  });
});

describe('the question', () => {
  it('shows the summary, asks Merge? [y/N], and merges on y', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, { answer: 'y' });
    const { run, lines } = await ran(seams.seams, project, ['41']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(seams.asked()).toEqual(['Merge? [y/N] ']);
    expect(lines[0]).toBe(summaryLine(detail(), 'squash'));
    expect(stub.sent()).toContain('merge 41 squash');
  });

  it('merges nothing on an answer that is not yes, and ends 0 saying so', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, { answer: '' });
    const { run, lines } = await ran(seams.seams, project, ['41']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(lines.at(-1)).toBe('Nothing was merged.');
    expect(stub.sent()).toEqual(['get 41', 'checks 41']);
    expect(seams.git.ran()).not.toContain(`branch -D ${BRANCH}`);
  });

  it('merges nothing when the input ends before an answer is typed', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const { run } = await ran(caseSeams(stub.pulls, project, { answer: null }).seams, project, ['41']);

    expect(run.exitCode).toBe(0);
    expect(stub.sent()).toEqual(['get 41', 'checks 41']);
  });

  it('refuses without a terminal and without --yes, naming the flag, and merges nothing', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, { terminal: false });
    const { run } = await ran(seams.seams, project, ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('standard input is no terminal');
    expect(run.stderr).toContain('--yes');
    expect(run.stderr).toContain(summaryLine(detail(), 'squash'));
    expect(run.stdout).toBe('');
    expect(stub.sent()).toEqual(['get 41', 'checks 41']);
  });

  it('asks nothing under --yes, opening no prompter at all, even with no terminal', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams: MergeSeams = {
      ...caseSeams(stub.pulls, project, { terminal: false }).seams,
      openPrompter: () => {
        throw new Error('--yes must open no prompter');
      },
    };
    const { run } = await ran(seams, project, ['41', '--yes']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(stub.sent()).toContain('merge 41 squash');
  });
});

describe('the merge it sends', () => {
  it('sends pr.mergeMethod where the line names none', async () => {
    const stub = stubPulls();
    const project = freshProject('pr:\n  provider: gh\n  mergeMethod: merge\n');
    const { run } = await ran(caseSeams(stub.pulls, project).seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(stub.sent()).toContain('merge 41 merge');
  });

  it('sends the method the line names, over the one the config gives', async () => {
    const stub = stubPulls();
    const project = freshProject('pr:\n  provider: gh\n  mergeMethod: merge\n');
    const { run } = await ran(caseSeams(stub.pulls, project).seams, project, ['41', '--yes', '--method=rebase']);

    expect(run.exitCode).toBe(0);
    expect(stub.sent()).toContain('merge 41 rebase');
  });

  it('refuses with what the provider said when it would not merge, and cleans up nothing', async () => {
    const stub = stubPulls({ merge: () => Promise.resolve({ merged: false, detail: 'Pull request is not mergeable' }) });
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project);
    const { run } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('gh would not merge #41: Pull request is not mergeable');
    expect(seams.git.ran()).not.toContain(`switch ${BASE}`);
  });
});

describe('the clean-up', () => {
  it('runs the five steps in order and reports each, then says what is ready', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project);
    const { run, lines } = await ran(seams.seams, project, ['41', '--yes']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(seams.git.ran()).toEqual([
      'status --porcelain',
      'worktree list --porcelain',
      'rev-parse --show-toplevel',
      `ls-remote --heads origin ${BRANCH}`,
      `switch ${BASE}`,
      'pull --ff-only',
      `branch -D ${BRANCH}`,
      `push origin --delete ${BRANCH}`,
      'fetch --prune',
    ]);
    expect(lines).toContain(`Merged #41 into ${BASE} (squash).`);
    expect(lines).toContain(`switch to ${BASE}: done`);
    expect(lines).toContain(`delete origin/${BRANCH}: done`);
    expect(lines.at(-1)).toBe(`${BASE} is checked out and pulled, and ${BRANCH} is gone locally and on origin.`);
  });

  it('leaves the remote delete out where the remote no longer holds the branch, and says so', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, {
      git: { [`ls-remote --heads origin ${BRANCH}`]: ok('') },
    });
    const { run, lines } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(seams.git.ran()).not.toContain(`push origin --delete ${BRANCH}`);
    expect(lines.at(-1)).toBe(`${BASE} is checked out and pulled, and ${BRANCH} is gone locally; origin had already deleted it.`);
  });

  it('warns about a remote probe that failed, leaves the delete out, and cleans up the rest', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, {
      git: { [`ls-remote --heads origin ${BRANCH}`]: failed('fatal: could not read from remote repository') },
    });
    const { run } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('origin could not be asked whether it still holds');
    expect(seams.git.ran()).not.toContain(`push origin --delete ${BRANCH}`);
    expect(seams.git.ran()).toContain('fetch --prune');
  });

  it('stops at the step that failed, prints the rest as commands, and leaves the merge alone', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, {
      git: { 'pull --ff-only': failed('fatal: Not possible to fast-forward, aborting.') },
    });
    const { run, lines } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ pull ${BASE}, fast-forward only: failed`);
    expect(run.stderr).toContain('fatal: Not possible to fast-forward, aborting.');
    expect(run.stderr).toContain('#41 is merged, and the merge is left alone. Run the rest yourself:');
    expect(run.stderr).toContain('git pull --ff-only');
    expect(run.stderr).toContain(`git branch -D ${BRANCH}`);
    expect(run.stderr).toContain('git fetch --prune');
    expect(seams.git.ran().filter((line) => line.startsWith('branch -D'))).toEqual([]);
    expect(lines).toContain(`Merged #41 into ${BASE} (squash).`);
    expect(stub.sent()).toContain('merge 41 squash');
  });

  it('names no revert, reset or force-push anywhere in what a failed step leaves', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, {
      git: { [`branch -D ${BRANCH}`]: failed('error: branch not found') },
    });
    const { run } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).not.toContain('revert');
    expect(run.stderr).not.toContain('reset');
    expect(run.stderr).not.toContain('--force');
    expect(run.stderr).toContain(`git push origin --delete ${BRANCH}`);
  });
});

describe('the follow-ups', () => {
  it('names both where the version on the base is neither tagged nor installed', async () => {
    const stub = stubPulls();
    const project = freshProject();
    plantPackage(project, `{"version": "${VERSION}", "scripts": {"snapshot": "bun scripts/snapshot-runtime.ts"}}`);
    const { run, lines } = await ran(caseSeams(stub.pulls, project).seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(lines).toContain('Follow-ups:');
    expect(lines.at(-2)).toContain('rafa release tag');
    expect(lines.at(-1)).toContain('bun run snapshot');
  });

  it('names neither for a version that is tagged and already installed as the runtime', async () => {
    const stub = stubPulls();
    const project = freshProject();
    plantPackage(project, `{"version": "${VERSION}", "scripts": {"snapshot": "bun scripts/snapshot-runtime.ts"}}`);
    mkdirSync(join(project.home, '.rafa', 'runtime', VERSION), { recursive: true });
    const seams = caseSeams(stub.pulls, project, {
      git: { [`tag --list v${VERSION}`]: ok(`v${VERSION}\n`) },
    });
    const { run, lines } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(lines).not.toContain('Follow-ups:');
  });

  it('names neither, and asks git for no tag, where the project holds no package.json', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project);
    const { run, lines } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(lines).not.toContain('Follow-ups:');
    expect(seams.git.ran().filter((line) => line.startsWith('tag '))).toEqual([]);
  });
});

describe('the roadmap tick', () => {
  it('spends no board call on a pull request whose body closes no issue', async () => {
    const stub = stubPulls();
    const project = freshProject(ROADMAP_CONFIG);
    const seams = caseSeams(stub.pulls, project);
    const { run } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(seams.gh.ran()).toEqual([]);
  });

  it('ticks the line of the issue the merged pull request closes, and says so', async () => {
    const stub = stubPulls({ get: () => Promise.resolve(detail({ body: 'Closes #20' })) });
    const project = freshProject(ROADMAP_CONFIG);
    const seams = caseSeams(stub.pulls, project);
    const { run, lines } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(seams.gh.ran()).toEqual([
      `repos/{owner}/{repo}/issues/${ROADMAP_ISSUE}`,
      `repos/{owner}/{repo}/issues/${ROADMAP_ISSUE} -X PATCH -f body=- [x] #20 plans from the board\n- [ ] #33 the board setup\n`,
    ]);
    expect(lines).toContain(`Ticked #20 on the roadmap, issue #${ROADMAP_ISSUE}.`);
  });

  it('ticks before the clean-up, so a clean-up that fails cannot drop the tick', async () => {
    const stub = stubPulls({ get: () => Promise.resolve(detail({ body: 'Closes #20' })) });
    const project = freshProject(ROADMAP_CONFIG);
    const seams = caseSeams(stub.pulls, project, { git: { [`switch ${BASE}`]: failed('fatal: no such branch') } });
    const { run } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(1);
    expect(seams.gh.ran()).toHaveLength(2);
  });

  it('warns and merges anyway when the board will not take the tick', async () => {
    const stub = stubPulls({ get: () => Promise.resolve(detail({ body: 'Closes #20' })) });
    const project = freshProject(ROADMAP_CONFIG);
    const seams = caseSeams(stub.pulls, project, { brokenBoard: true });
    const { run, lines } = await ran(seams.seams, project, ['41', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(seams.gh.ran()).toHaveLength(2);
    expect(lines.some((line) => line.startsWith('warn: ') && line.includes('was not ticked'))).toBe(true);
    expect(stub.sent()).toContain('merge 41 squash');
  });
});

describe('json mode', () => {
  it('gives the pull request, the method, each step and the follow-ups as the result', async () => {
    const stub = stubPulls();
    const project = freshProject();
    plantPackage(project, `{"version": "${VERSION}"}`);
    const { run, events } = await ran(caseSeams(stub.pulls, project).seams, project, ['41', '--yes', '--output=json']);
    const data = dataOf(events);

    expect(run.exitCode).toBe(0);
    expect(data['number']).toBe(41);
    expect([data['branch'], data['base'], data['method']]).toEqual([BRANCH, BASE, 'squash']);
    expect([data['merged'], data['declined']]).toEqual([true, false]);
    expect((data['steps'] as { id: string }[]).map((step) => step.id)).toEqual([
      'switch-base',
      'pull-base',
      'delete-local',
      'delete-remote',
      'prune-remotes',
    ]);
    expect((data['followUps'] as { id: string }[]).map((followUp) => followUp.id)).toEqual(['release-tag']);
    expect(data['roadmapTick']).toBeNull();
  });

  it('carries what the roadmap tick came to for a pull request that closes an issue', async () => {
    const stub = stubPulls({ get: () => Promise.resolve(detail({ body: 'Closes #20' })) });
    const project = freshProject(ROADMAP_CONFIG);
    const seams = caseSeams(stub.pulls, project);
    const { events } = await ran(seams.seams, project, ['41', '--yes', '--output=json']);

    expect(dataOf(events)['roadmapTick']).toMatchObject({
      roadmap: ROADMAP_ISSUE,
      status: 'ticked',
      ticked: [20],
      attempts: 1,
    });
  });

  it('gives a declined merge as a result carrying no step at all', async () => {
    const stub = stubPulls();
    const project = freshProject();
    const seams = caseSeams(stub.pulls, project, { answer: 'no' });
    const { run, events } = await ran(seams.seams, project, ['41', '--output=json']);
    const data = dataOf(events);

    expect(run.exitCode).toBe(0);
    expect([data['merged'], data['declined'], data['steps']]).toEqual([false, true, []]);
  });
});

describe('the command itself', () => {
  it('routes as pr merge, declares both renderings, one optional number and its two flags, and is frozen', () => {
    const command = createPrMergeCommand();

    expect([command.subject, command.action, command.name]).toEqual(['pr', 'merge', 'pr merge']);
    expect(command.outputs).toEqual(['text', 'json']);
    expect(command.args.map((arg) => [arg.name, arg.required ?? false])).toEqual([['n', false]]);
    expect(command.flags.map((flag) => [flag.name, flag.type])).toEqual([['yes', 'boolean'], ['method', 'string']]);
    expect(Object.isFrozen(command)).toBe(true);
  });

  it('declares a summary, a description and examples, as the describe roster needs', () => {
    const command = createPrMergeCommand();

    expect(command.summary.length > 0).toBe(true);
    expect(command.description.length > command.summary.length).toBe(true);
    expect(command.examples.map((example) => example.cmd)).toEqual([
      'rafa pr merge',
      'rafa pr merge 41 --yes',
      'rafa pr merge 41 --method=rebase --output=json',
    ]);
  });
});
