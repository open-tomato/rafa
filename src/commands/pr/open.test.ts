/**
 * Tests for `rafa pr open` (`open.ts`): a pull request opened over the
 * recorded `gh`, the one already open on the head printed and none
 * opened, the refusals of the line and of the body file, and what the
 * command writes in each mode.
 *
 * Every dispatching case runs the real command from a project of its
 * own beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so the config read is the one the case
 * planted and no case reads the real home. No case reaches GitHub or
 * spawns `gh`: the provider is the adapter over the recorded fake
 * (`pr/gh-fake.ts`) or the port double (`pr/pull-requests-double.ts`),
 * and the `origin` probe is a seam.
 *
 * Two controls keep a refusal from passing while wrong: the provider
 * factory records each root it was made for, so "a refused line makes
 * no provider" is a reading beside a valid line that does make one; and
 * the "none opened" cases read the fake's or the double's own call log,
 * beside a first run whose log shows the create the second one skips.
 */
import type { PrSeams } from './pr-context.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';
import type { PullRequests, PullRequestSummary } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, PR_NEEDS_GH } from '../../pr/index.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createPrOpenCommand, readOpenBody } from './open.js';
import { PR_USAGE } from './pr-context.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-open-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.open;

/** A config naming the GitHub CLI. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** A config naming no pull request provider at all. */
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The head every case opens from, and the base it opens into. */
const HEAD = 'feat/rafa-9-one-item';
const BASE = 'stretch/9';

/** The title every case opens with. */
const TITLE = 'rafa-9: one item';

/** A body as a caller writes it: markdown, quotes, a trailing newline. */
const BODY = 'Closes #9.\n\n## What changed\n\n- `one` "item"\n';

/** A body file holding `text`, under a directory of this case's own. */
function bodyFile(text: string = BODY): string {
  const path = join(mkdtempSync(join(tempBase, 'body-')), 'body.md');
  writeFileSync(path, text, 'utf8');
  return path;
}

/** The four flags of a valid line, the body file named by `path`. */
function lineFor(path: string, over: Readonly<Record<string, string>> = {}): string[] {
  const flags = { head: HEAD, base: BASE, title: TITLE, 'body-file': path, ...over };
  return Object.entries(flags).map(([name, value]) => `--${name}=${value}`);
}

/** A summary as the double answers one, filled from `over`. */
function summary(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 41,
    title: TITLE,
    url: 'https://github.com/open-tomato/rafa/pull/41',
    state: 'open',
    headRefName: HEAD,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-10-07T09:00:00Z',
    ...over,
  };
}

/** The seams a case hands the command, with what the provider control recorded. */
interface CaseSeams {
  readonly seams: PrSeams;
  /** Each root a provider was made for, in order. */
  readonly made: () => readonly string[];
}

/** Seams over `pulls`, recording every root a provider was made for. */
function caseSeams(pulls: PullRequests): CaseSeams {
  const roots: string[] = [];
  return {
    seams: {
      pullRequests: (root) => {
        roots.push(root);
        return pulls;
      },
      readBranch: () => 'main',
      readRemote: () => GITHUB_ORIGIN,
    },
    made: () => [...roots],
  };
}

/** A project of this case's own, holding `config`. */
function freshProject(config: string = GH_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** Dispatches `rafa pr open` over `seams` from `project`, with `words` after the action. */
async function ran(seams: PrSeams, project: PlantedProject, words: readonly string[]): Promise<CapturedRun> {
  const command: RafaCommand = createPrOpenCommand(seams);
  return dispatchInProject(['pr', 'open', ...words], SUBJECTS, [command], project);
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): unknown {
  return (events.at(-1) as { data?: unknown }).data;
}

/** The lines a run wrote to stdout, blank ones left out. */
function linesOf(run: CapturedRun): string[] {
  return run.stdout.split('\n').filter((line) => line !== '');
}

describe('opening a pull request over the recorded gh', () => {
  it('opens one from the head into the base with the body file whole, and prints it', async () => {
    const fake = createFakePrGh();
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));

    const run = await ran(seams.seams, freshProject(), lineFor(bodyFile()));

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(linesOf(run)).toEqual([
      `✅ Opened #1 ${TITLE} (${HEAD} → ${BASE}) https://github.com/open-tomato/rafa/pull/1`,
    ]);
    expect(fake.calls().map((call) => call.slice(0, 2))).toEqual([['pr', 'list'], ['pr', 'create'], ['pr', 'view']]);
    expect(fake.calls()[1]).toEqual(['pr', 'create', '--head', HEAD, '--base', BASE, '--title', TITLE, '--body', BODY]);
  });

  it('opens none on a second run, printing the pull request the first one opened', async () => {
    const fake = createFakePrGh();
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));
    const path = bodyFile();
    const project = freshProject();

    const first = await ran(seams.seams, project, lineFor(path));
    const createsAfterFirst = fake.calls().filter((call) => call[1] === 'create').length;
    const second = await ran(seams.seams, project, lineFor(path));

    expect([first.exitCode, second.exitCode]).toEqual([0, 0]);
    expect(createsAfterFirst).toBe(1);
    expect(fake.calls().filter((call) => call[1] === 'create')).toHaveLength(1);
    expect(linesOf(second)).toEqual([
      `✅ Already open, so none was opened: #1 ${TITLE} (${HEAD} → ${BASE}) https://github.com/open-tomato/rafa/pull/1`,
    ]);
  });

  it('gives whether it opened one, the two branches and the pull request as the json result', async () => {
    const fake = createFakePrGh();
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));

    const run = await ran(seams.seams, freshProject(), [...lineFor(bodyFile()), '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(dataOf(eventsOf(run.stdout))).toMatchObject({
      opened: true,
      head: HEAD,
      base: BASE,
      pull: { number: 1, title: TITLE, state: 'open', headRefName: HEAD, baseRefName: BASE },
    });
  });
});

describe('a head that already has an open pull request', () => {
  it('prints it and sends no create', async () => {
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(summary()) });
    const seams = caseSeams(double.pulls);

    const run = await ran(seams.seams, freshProject(), lineFor(bodyFile()));

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(double.sent()).toEqual([`findOpen ${HEAD}`]);
    expect(linesOf(run)).toEqual([
      `✅ Already open, so none was opened: #41 ${TITLE} (${HEAD} → ${BASE}) https://github.com/open-tomato/rafa/pull/41`,
    ]);
  });

  it('warns naming both bases when the open one is into another base, and still opens none', async () => {
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(summary({ baseRefName: 'main' })) });
    const seams = caseSeams(double.pulls);

    const run = await ran(seams.seams, freshProject(), lineFor(bodyFile()));

    expect(run.exitCode).toBe(0);
    expect(double.sent()).toEqual([`findOpen ${HEAD}`]);
    expect(linesOf(run)[0]).toBe(`warn: #41 is open from "${HEAD}" into "main", not into "${BASE}"`);
  });

  it('answers opened false in json mode', async () => {
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(summary()) });

    const run = await ran(caseSeams(double.pulls).seams, freshProject(), [...lineFor(bodyFile()), '--output=json']);

    expect(dataOf(eventsOf(run.stdout))).toEqual({ opened: false, head: HEAD, base: BASE, pull: summary() });
  });
});

describe('the double, as a control on what the command sends', () => {
  it('sends findOpen then create with the draft whole, the body untrimmed', async () => {
    const body = '\n  Closes #9.\n\n';
    const double = createPullRequestsDouble({
      findOpen: () => Promise.resolve(null),
      create: () => Promise.resolve(summary()),
    });

    const run = await ran(caseSeams(double.pulls).seams, freshProject(), lineFor(bodyFile(body)));

    expect(run.exitCode).toBe(0);
    expect(double.calls().map((call) => [call.member, call.args])).toEqual([
      ['findOpen', [HEAD]],
      ['create', [{ head: HEAD, base: BASE, title: TITLE, body }]],
    ]);
  });

  it('refuses with exit code 1 naming what it was doing when create rejects', async () => {
    const double = createPullRequestsDouble({
      findOpen: () => Promise.resolve(null),
      create: () => Promise.reject(new Error('gh pr create failed: could not connect')),
    });

    const run = await ran(caseSeams(double.pulls).seams, freshProject(), lineFor(bodyFile()));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ Could not open a pull request from "${HEAD}" into "${BASE}": gh pr create failed: could not connect`);
  });
});

describe('the refusals, each before a provider is made', () => {
  it('makes a provider for a valid line, the control the refusals below are read against', async () => {
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(summary()) });
    const seams = caseSeams(double.pulls);
    const project = freshProject();

    const run = await ran(seams.seams, project, lineFor(bodyFile()));

    expect(run.exitCode).toBe(0);
    expect(seams.made()).toEqual([project.root]);
  });

  it('refuses a head equal to the base', async () => {
    const seams = caseSeams(createPullRequestsDouble().pulls);

    const run = await ran(seams.seams, freshProject(), lineFor(bodyFile(), { base: HEAD }));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ --head and --base are both "${HEAD}": a branch cannot be merged into itself\nUsage: ${USAGE}`);
    expect(seams.made()).toEqual([]);
  });

  it('refuses a body file that is not there, and a directory', async () => {
    const seams = caseSeams(createPullRequestsDouble().pulls);
    const missing = join(tempBase, 'no-such-body.md');
    const directory = mkdtempSync(join(tempBase, 'dir-'));

    const runs = [
      await ran(seams.seams, freshProject(), lineFor(missing)),
      await ran(seams.seams, freshProject(), lineFor(directory)),
    ];

    expect(runs.map((run) => run.exitCode)).toEqual([1, 1]);
    expect(runs[0]?.stderr).toContain(`❌ --body-file cannot read "${missing}": `);
    expect(runs[1]?.stderr).toContain(`❌ --body-file cannot read "${directory}": `);
    expect(seams.made()).toEqual([]);
  });

  it('refuses an empty body file, and one holding nothing but whitespace', async () => {
    const seams = caseSeams(createPullRequestsDouble().pulls);
    const empty = bodyFile('');
    const blank = bodyFile(' \n\t\n');

    const runs = [
      await ran(seams.seams, freshProject(), lineFor(empty)),
      await ran(seams.seams, freshProject(), lineFor(blank)),
    ];

    expect(runs.map((run) => run.exitCode)).toEqual([1, 1]);
    expect(runs[0]?.stderr).toContain(`❌ --body-file "${empty}" is empty, and a pull request is not opened with no body\nUsage: ${USAGE}`);
    expect(runs[1]?.stderr).toContain(`❌ --body-file "${blank}" is empty`);
    expect(seams.made()).toEqual([]);
  });

  it('refuses each flag left out, typed bare or blank, and a stray word', async () => {
    const seams = caseSeams(createPullRequestsDouble().pulls);
    const path = bodyFile();
    const valid = lineFor(path);
    const lines: readonly (readonly [readonly string[], string])[] = [
      [valid.filter((word) => !word.startsWith('--head=')), '--head is required: --head=<value>'],
      [valid.filter((word) => !word.startsWith('--body-file=')), '--body-file is required: --body-file=<value>'],
      [[...valid.filter((word) => !word.startsWith('--title=')), '--title'], '--title needs a value: --title=<value>'],
      [lineFor(path, { base: ' ' }), '--base cannot be blank: --base=<value>'],
      [['41', ...valid], 'Expected no arguments, got 1: 41'],
    ];

    for (const [words, problem] of lines) {
      const run = await ran(seams.seams, freshProject(), words);
      expect([run.exitCode, run.stderr]).toEqual([1, expect.stringContaining(`❌ ${problem}\nUsage: ${USAGE}`)]);
    }
    expect(seams.made()).toEqual([]);
  });

  it('refuses with exit code 2 where pr.provider is not gh', async () => {
    const seams = caseSeams(createPullRequestsDouble().pulls);

    const run = await ran(seams.seams, freshProject(NONE_CONFIG), lineFor(bodyFile()));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(PR_NEEDS_GH);
    expect(seams.made()).toEqual([]);
  });
});

describe('the body file reader', () => {
  it('reads a relative path from the directory rafa runs in', async () => {
    const path = relative(process.cwd(), bodyFile());

    expect(isAbsolute(path)).toBe(false);
    expect(await readOpenBody(path)).toBe(BODY);
  });
});
