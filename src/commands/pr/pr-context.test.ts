/**
 * Tests for what the seven `pr` actions share (`pr-context.ts`): the usage
 * lines, the readers of a line, the provider check and its exit-2
 * refusal, and the pull request an action acts on.
 *
 * The reader cases call the functions directly. Every other case
 * dispatches a probe action, whose subject and registry are this file's
 * own, from a project of its own beside a home of its own under this
 * file's temporary directory (`tests/cli-capture.ts`), so the config
 * read is the one the case planted and no case reads the real home.
 *
 * No case reaches GitHub or spawns `gh`: a provider is either the
 * adapter over the recorded fake (`pr/gh-fake.ts`) or a stub answering
 * what the case wants read. The `origin` probe is a seam in all but the
 * cases measuring it, and the branch reader is git itself only in the
 * three cases that plant a real repository under the project root — a
 * `git init` in a temporary directory, as `effort/report.test.ts` and
 * `plan.test.ts` already do.
 *
 * Two controls carry the readings that could otherwise pass while
 * wrong: the provider factory and the branch reader each record whether
 * they were reached, so "the line is read first" and "an argument reads
 * no branch" are measured rather than assumed.
 */
import type { PrSeams } from './pr-context.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';
import type { PullRequests, PullRequestSummary } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { configFilePath } from '../../config.js';
import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, PR_NEEDS_GH } from '../../pr/index.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import {
  expectNoArguments,
  openPrContext,
  pickPullRequest,
  PR_USAGE,
  readBooleanFlag,
  readPullArgument,
} from './pr-context.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-context-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the probe routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line the reader cases refuse with. */
const USAGE = PR_USAGE.show;

/** A config naming the GitHub CLI, a merge method and a base of its own. */
const GH_CONFIG = 'pr:\n  provider: gh\n  mergeMethod: rebase\n  base: trunk\n';

/** A config naming no provider, so `origin` decides. */
const UNSET_CONFIG = 'loop:\n  maxIterations: 3\n';

/** A config naming no pull request provider at all. */
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** An `origin` that is no GitHub remote. */
const GITLAB_ORIGIN = 'git@gitlab.com:open-tomato/rafa.git';

/** What `run` threw, as its exit code and message for a `CommandExit`, or undefined when it returned. */
function exitOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error instanceof CommandExit
      ? { exitCode: error.exitCode, message: error.message }
      : error;
  }
  return undefined;
}

/** Flag sets as a line's context holds them. */
function flagSets(...sets: readonly Readonly<Record<string, string | boolean>>[]): readonly Readonly<Record<string, string | boolean>>[] {
  return sets;
}

/** A provider answering `findOpen` with `answer` and refusing every other call. */
function stubPulls(answer: () => Promise<PullRequestSummary | null>): PullRequests {
  return createPullRequestsDouble({ findOpen: answer }, { refusal: 'the stub provider models findOpen alone' }).pulls;
}

/** The seams a case hands the probe, with what each of the two controls recorded. */
interface ProbeSeams {
  readonly seams: PrSeams;
  /** Each root a provider was made for, in order. */
  readonly made: () => readonly string[];
  /** How many times the branch was read. */
  readonly branchReads: () => number;
}

/** What a case wants the seams to answer. */
interface SeamOptions {
  readonly pulls?: PullRequests;
  readonly branch?: string | (() => string);
  readonly remote?: string | null;
}

/** Seams recording what they were reached for; see the module note on the two controls. */
function probeSeams(options: SeamOptions = {}): ProbeSeams {
  const roots: string[] = [];
  let reads = 0;
  const branch = options.branch ?? 'feat/rafa-20-pr-commands';
  const seams: PrSeams = {
    pullRequests: (root) => {
      roots.push(root);
      return options.pulls ?? stubPulls(() => Promise.resolve(null));
    },
    readBranch: () => {
      reads += 1;
      return typeof branch === 'string'
        ? branch
        : branch();
    },
    readRemote: () => options.remote ?? null,
  };
  return { seams, made: () => [...roots], branchReads: () => reads };
}

/** A probe action over `run`, registered under the `pr` subject. */
function probe(action: string, run: RafaCommand['run']): RafaCommand {
  return {
    name: `pr ${action}`,
    subject: 'pr',
    action,
    summary: 'probe the shared pull request context',
    description: 'Opens the shared pull request context and gives what it read as its result.',
    args: [],
    flags: [],
    examples: [{ cmd: `rafa pr ${action}`, note: 'Opens the context.' }],
    outputs: ['text', 'json'],
    run,
  };
}

/** A probe opening the context and giving what it read. */
function contextProbe(seams: PrSeams): RafaCommand {
  return probe('context', (context) => {
    const pr = openPrContext(context, seams);
    context.output.result({
      provider: pr.reading.provider,
      source: pr.reading.source,
      host: pr.reading.host,
      mergeMethod: pr.mergeMethod,
      base: pr.base,
    });
    return Promise.resolve();
  });
}

/** A probe reading its line first, then the context, then picking a pull request. */
function pickProbe(seams: PrSeams): RafaCommand {
  return probe('pick', async (context) => {
    const asked = readPullArgument(context.args, USAGE);
    const pr = openPrContext(context, seams);
    const pick = await pickPullRequest(pr, asked, USAGE);
    context.output.result({
      number: pick.number,
      source: pick.source,
      branch: pick.branch,
      title: pick.summary === null
        ? null
        : pick.summary.title,
    });
  });
}

/** What one probe dispatched in json mode left: what it wrote, and its events. */
interface Probed {
  readonly run: CapturedRun;
  readonly events: readonly CliEvent[];
}

/** A project of this case's own, holding `config`. */
function freshProject(config: string): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** Dispatches `command` in json mode from `project`, with `words` after the action. */
async function probed(command: RafaCommand, project: PlantedProject, words: readonly string[] = []): Promise<Probed> {
  const run = await dispatchInProject(
    ['pr', command.action, ...words, '--output=json'],
    SUBJECTS,
    [command],
    project,
  );
  return { run, events: eventsOf(run.stdout) };
}

/** Runs `git` in `cwd`, throwing what it wrote when it fails. */
function git(cwd: string, ...args: readonly string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
}

/** Makes the project root a git repository on branch `branch`, with one commit. */
function plantRepo(project: PlantedProject, branch: string): void {
  git(project.root, 'init', '-q', '-b', branch, '.');
  git(project.root, '-c', 'user.email=rafa@example.test', '-c', 'user.name=rafa', 'commit', '-q', '--allow-empty', '-m', 'one');
}

describe('the usage lines', () => {
  it('names all seven actions, the five taking a number carrying an optional one, and is frozen', () => {
    const actions = ['current', 'show', 'view', 'list', 'merge', 'triage', 'wait'] as const;

    expect(Object.keys(PR_USAGE)).toEqual([...actions]);
    expect(actions.map((action) => PR_USAGE[action].startsWith(`rafa pr ${action}`))).toEqual(actions.map(() => true));
    expect(actions.filter((action) => PR_USAGE[action].includes('[<n>]')))
      .toEqual(['show', 'view', 'merge', 'triage', 'wait']);
    expect(Object.isFrozen(PR_USAGE)).toBe(true);
  });

  it('puts every flag after the number, so the usage line is the order that works', () => {
    expect(PR_USAGE.merge).toBe('rafa pr merge [<n>] [--yes] [--skip-checks] [--method=squash|merge|rebase]');
    expect(PR_USAGE.triage).toBe('rafa pr triage [<n>] [--no-comment] [--resolve] [--max-attempts=<count>]');
    expect(PR_USAGE.wait).toBe('rafa pr wait [<n>] [--timeout=<minutes>]');
  });
});

describe('reading a line', () => {
  it('takes no argument where an action takes none, and refuses any word naming it and the usage', () => {
    expect(expectNoArguments([], PR_USAGE.list)).toBeUndefined();
    expect([['12'], ['12', 'x']].map((args) => exitOf(() => expectNoArguments(args, PR_USAGE.list)))).toEqual([
      { exitCode: 1, message: `❌ Expected no arguments, got 1: 12\nUsage: ${PR_USAGE.list}` },
      { exitCode: 1, message: `❌ Expected no arguments, got 2: 12 x\nUsage: ${PR_USAGE.list}` },
    ]);
  });

  it('reads an optional pull request number, answering null for a line naming none', () => {
    expect([readPullArgument([], USAGE), readPullArgument(['12'], USAGE), readPullArgument(['7'], USAGE)]).toEqual([null, 12, 7]);
  });

  it('refuses a word that is no whole number from 1, and a second word, naming both and the usage', () => {
    const refusals = [['0'], ['-1'], ['012'], ['1.5'], ['#12'], ['x']].map((args) => exitOf(() => readPullArgument(args, USAGE)));

    expect(refusals).toEqual([['0', '-1', '012', '1.5', '#12', 'x'].map((word) => ({
      exitCode: 1,
      message: `❌ "${word}" is no pull request number, which is a whole number from 1\nUsage: ${USAGE}`,
    }))].flat());
    expect(exitOf(() => readPullArgument(['12', '13'], USAGE))).toEqual({
      exitCode: 1,
      message: `❌ Expected at most one pull request number, got 2: 12 13\nUsage: ${USAGE}`,
    });
  });

  it('reads a boolean flag bare, negated and written out, and a line leaving it out as the fallback', () => {
    const read = (flags: Readonly<Record<string, string | boolean>>): boolean => readBooleanFlag(flags, 'yes', PR_USAGE.merge);

    expect(flagSets({}, { yes: true }, { yes: false }, { yes: 'true' }, { yes: 'false' }).map(read)).toEqual([false, true, false, true, false]);
    expect(readBooleanFlag({}, 'comment', PR_USAGE.triage, true)).toBe(true);
    expect(readBooleanFlag({ comment: false }, 'comment', PR_USAGE.triage, true)).toBe(false);
  });

  it('refuses the number parseArgs handed a bare flag as its value, naming the order that works', () => {
    expect(exitOf(() => readBooleanFlag({ yes: '12' }, 'yes', PR_USAGE.merge))).toEqual({
      exitCode: 1,
      message: '❌ --yes takes no value, and read "12" as one;'
        + ` type the pull request number before the flags\nUsage: ${PR_USAGE.merge}`,
    });
  });
});

describe('the provider check', () => {
  it('opens the context when the config names gh, carrying the merge method and the base it read', async () => {
    const seams = probeSeams({ remote: GITHUB_ORIGIN });
    const project = freshProject(GH_CONFIG);
    const { run, events } = await probed(contextProbe(seams.seams), project);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.at(-1)).toMatchObject({
      ok: true,
      data: { provider: 'gh', source: 'config', host: 'github.com', mergeMethod: 'rebase', base: 'trunk' },
    });
    expect(seams.made()).toEqual([project.root]);
  });

  it('infers gh from a GitHub origin when the config names no provider', async () => {
    const seams = probeSeams({ remote: GITHUB_ORIGIN });
    const { run, events } = await probed(contextProbe(seams.seams), freshProject(UNSET_CONFIG));

    expect(run.exitCode).toBe(0);
    expect(events.at(-1)).toMatchObject({
      ok: true,
      data: { provider: 'gh', source: 'remote', host: 'github.com', mergeMethod: 'squash', base: null },
    });
  });

  it('refuses a non-GitHub origin with exit code 2 and the shared message, making no provider', async () => {
    const seams = probeSeams({ remote: GITLAB_ORIGIN });
    const { run, events } = await probed(contextProbe(seams.seams), freshProject(UNSET_CONFIG));

    expect(run.exitCode).toBe(2);
    expect(events.at(-1)).toMatchObject({ ok: false, error: { code: 'command_exit', message: PR_NEEDS_GH } });
    expect(seams.made()).toEqual([]);
  });

  it('refuses a config naming provider none with the same message, whatever the origin says', async () => {
    const seams = probeSeams({ remote: GITHUB_ORIGIN });
    const { run, events } = await probed(contextProbe(seams.seams), freshProject(NONE_CONFIG));

    expect(run.exitCode).toBe(2);
    expect(events.at(-1)).toMatchObject({ ok: false, error: { code: 'command_exit', message: PR_NEEDS_GH } });
    expect(seams.made()).toEqual([]);
  });

  it('refuses a config loadConfig refuses with exit code 1, one line per problem, making no provider', async () => {
    const seams = probeSeams({ remote: GITHUB_ORIGIN });
    const project = freshProject('pr:\n  provider: [gh]\n');
    const { run, events } = await probed(contextProbe(seams.seams), project);
    const problem = `${configFilePath(project.root)}: pr.provider is a list, expected one of: gh, none`;

    expect(run.exitCode).toBe(1);
    expect(events.at(-1)).toMatchObject({
      ok: false,
      error: { code: 'command_exit', message: `❌ The config cannot be used:\n  ${problem}` },
    });
    expect(seams.made()).toEqual([]);
  });

  it('reads the line before the config and the provider, so a refused line makes no provider', async () => {
    const seams = probeSeams({ remote: GITHUB_ORIGIN });
    const project = freshProject(NONE_CONFIG);
    const refused = await probed(pickProbe(seams.seams), project, ['x']);
    const control = await probed(pickProbe(seams.seams), project, ['12']);

    expect([refused.run.exitCode, control.run.exitCode]).toEqual([1, 2]);
    expect(refused.events.at(-1)).toMatchObject({
      ok: false,
      error: { message: `❌ "x" is no pull request number, which is a whole number from 1\nUsage: ${USAGE}` },
    });
    expect(control.events.at(-1)).toMatchObject({ ok: false, error: { message: PR_NEEDS_GH } });
    expect(seams.made()).toEqual([]);
  });
});

describe('which pull request', () => {
  it('takes the number the line names, reading no branch', async () => {
    const seams = probeSeams({ remote: GITHUB_ORIGIN });
    const { run, events } = await probed(pickProbe(seams.seams), freshProject(GH_CONFIG), ['12']);

    expect(run.exitCode).toBe(0);
    expect(events.at(-1)).toMatchObject({ ok: true, data: { number: 12, source: 'argument', branch: null, title: null } });
    expect(seams.branchReads()).toBe(0);
  });

  it('takes the open pull request of the branch when the line names no number, through gh pr list --head', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 41, headRefName: 'feat/rafa-20-pr-commands', title: 'rafa-20: pull request commands' });
    const seams = probeSeams({ remote: GITHUB_ORIGIN, pulls: createGhPullRequests({ gh: fake.run }) });
    const { run, events } = await probed(pickProbe(seams.seams), freshProject(GH_CONFIG));

    expect(run.exitCode).toBe(0);
    expect(events.at(-1)).toMatchObject({
      ok: true,
      data: { number: 41, source: 'branch', branch: 'feat/rafa-20-pr-commands', title: 'rafa-20: pull request commands' },
    });
    expect(seams.branchReads()).toBe(1);
    expect(fake.calls()[0]?.slice(0, 6)).toEqual(['pr', 'list', '--state', 'open', '--head', 'feat/rafa-20-pr-commands']);
  });

  it('refuses a branch with no open pull request, naming the branch, the root and the usage', async () => {
    const fake = createFakePrGh();
    const seams = probeSeams({ remote: GITHUB_ORIGIN, pulls: createGhPullRequests({ gh: fake.run }) });
    const project = freshProject(GH_CONFIG);
    const { run, events } = await probed(pickProbe(seams.seams), project);

    expect(run.exitCode).toBe(1);
    expect(events.at(-1)).toMatchObject({
      ok: false,
      error: {
        message: '❌ No open pull request for the branch "feat/rafa-20-pr-commands"'
          + ` at ${project.root}\nRun rafa pr list to see the open pull requests.\nUsage: ${USAGE}`,
      },
    });
  });

  it('refuses a provider call that rejected, naming what was being read and what it said', async () => {
    const pulls = stubPulls(() => Promise.reject(new Error('gh pull requests: gh pr list failed: could not connect')));
    const seams = probeSeams({ remote: GITHUB_ORIGIN, pulls });
    const { run, events } = await probed(pickProbe(seams.seams), freshProject(GH_CONFIG));

    expect(run.exitCode).toBe(1);
    expect(events.at(-1)).toMatchObject({
      ok: false,
      error: {
        message: '❌ Could not read the open pull request for the branch "feat/rafa-20-pr-commands":'
          + ' gh pull requests: gh pr list failed: could not connect',
      },
    });
  });
});

describe('the branch, read by git at the project root', () => {
  it('reads the branch the project root is on with no seam, and finds its pull request', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 8, headRefName: 'work', title: 'the one on work' });
    const project = freshProject(GH_CONFIG);
    plantRepo(project, 'work');
    const seams: PrSeams = { pullRequests: () => createGhPullRequests({ gh: fake.run }), readRemote: () => GITHUB_ORIGIN };
    const { run, events } = await probed(pickProbe(seams), project);

    expect(run.exitCode).toBe(0);
    expect(events.at(-1)).toMatchObject({ ok: true, data: { number: 8, source: 'branch', branch: 'work' } });
  });

  it('refuses a detached HEAD by name, which git answers as the branch HEAD with exit code 0', async () => {
    const project = freshProject(GH_CONFIG);
    plantRepo(project, 'work');
    git(project.root, 'checkout', '-q', '--detach', 'HEAD');
    const seams: PrSeams = { pullRequests: () => stubPulls(() => Promise.resolve(null)), readRemote: () => GITHUB_ORIGIN };
    const { run, events } = await probed(pickProbe(seams), project);

    expect(Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: project.root }).stdout.toString().trim()).toBe('HEAD');
    expect(run.exitCode).toBe(1);
    expect(events.at(-1)).toMatchObject({
      ok: false,
      error: { message: `❌ ${project.root} is on no branch, and a detached HEAD names no pull request\nUsage: ${USAGE}` },
    });
  });

  it('refuses a root git cannot read a branch at, with the words git wrote', async () => {
    const project = freshProject(GH_CONFIG);
    const seams: PrSeams = { pullRequests: () => stubPulls(() => Promise.resolve(null)), readRemote: () => GITHUB_ORIGIN };
    const { run, events } = await probed(pickProbe(seams), project);
    const message = (events.at(-1) as { error?: { message?: string } }).error?.message ?? '';

    expect(run.exitCode).toBe(1);
    expect(message.startsWith(`❌ The branch checked out at ${project.root} cannot be read:`)).toBe(true);
    expect(message.endsWith(`\nUsage: ${USAGE}`)).toBe(true);
  });
});
