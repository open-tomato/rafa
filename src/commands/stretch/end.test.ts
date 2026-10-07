/**
 * Tests for `rafa stretch end` (`./end.ts`), dispatched in planted
 * projects whose `pr.base` names `stretch/4`. The provider is the port
 * double (`src/pr/pull-requests-double.ts`), so no case reaches GitHub,
 * and `origin/HEAD` is read through a git seam that answers what the
 * case plants. `report.md`, the ledger, `stretch.json`, the body file
 * and `.rafa/config.yaml` are real files.
 *
 * Controls: every refusal reads the provider factory as never reached
 * and the config file as unchanged, beside a full run that reaches the
 * provider and writes; the dry runs read no body file and an unchanged
 * config beside the real runs that write both; and the `origin/HEAD`
 * case sits beside one where git answers nothing, which falls back to
 * `main`.
 */
import type { StretchEndSeams } from './end.js';
import type { GitResult } from '../../pr/git.js';
import type { PullRequestsAnswers } from '../../pr/pull-requests-double.js';
import type { MergedPullRequest, PullRequestDraft, PullRequestSummary } from '../../pr/types.js';
import type { StretchItem } from '../../stretch/items.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { configFilePath } from '../../config.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { appendItem, itemsPath } from '../../stretch/items.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { bodyPath, closesLines, createStretchEndCommand, endBody, endTitle, reportPath } from './end.js';
import { stretchRecordPath } from './start.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-end-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const STRETCH_SUBJECT = { name: 'stretch', summary: 'stretches' };

/** A config pointing `pr.base` at stretch 4, with a comment the edit must keep. */
const STRETCH_CONFIG = 'version: 1\n# kept: a comment the edit leaves alone\npr:\n  provider: gh\n  base: stretch/4  # the integration branch\n';

const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

const REPORT = '# Stretch 4\n\nWhat merged: #901, #902.\n';

/** A ledger item filled from `over`. */
function item(over: Partial<StretchItem> = {}): StretchItem {
  return {
    issue: '812',
    plan: 'rafa-812-one',
    pullRequest: 901,
    mergeCommit: 'a'.repeat(40),
    closes: ['Closes #812'],
    at: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

/** A pull request summary as the double answers one. */
function summary(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 950,
    title: 'Stretch 4',
    url: 'https://github.com/open-tomato/rafa/pull/950',
    state: 'open',
    headRefName: 'stretch/4',
    baseRefName: 'main',
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-10-07T09:00:00Z',
    ...over,
  };
}

/** The merged pull request from `stretch/4`. */
const MERGED_END: MergedPullRequest = {
  number: 950,
  headRefName: 'stretch/4',
  headRefOid: 'b'.repeat(40),
  mergedAt: '2026-10-07T11:00:00Z',
};

/** A merged item pull request, from another head. */
const MERGED_ITEM: MergedPullRequest = { ...MERGED_END, number: 901, headRefName: 'feat/rafa-812-one' };

/** What a case plants beside the config. */
interface Plant {
  readonly config?: string;
  readonly report?: string | null;
  readonly items?: readonly StretchItem[];
  readonly record?: Readonly<Record<string, unknown>> | null;
}

/** A project of this case's own, holding what `plant` names. */
function freshProject(plant: Plant = {}): PlantedProject {
  const project = plantProject(mkdtempSync(join(scope, 'case-')), plant.config ?? STRETCH_CONFIG);
  const report = plant.report === undefined
    ? REPORT
    : plant.report;
  if (report !== null) {
    mkdirSync(dirname(reportPath(project.root, 4)), { recursive: true });
    writeFileSync(reportPath(project.root, 4), report, 'utf8');
  }
  for (const entry of plant.items ?? []) appendItem(project.root, 4, entry);
  const record = plant.record === undefined
    ? { stretch: 4, branch: 'stretch/4', defaultBranch: 'main', prBase: 'develop', startedAt: '2026-10-01T09:00:00.000Z' }
    : plant.record;
  if (record !== null) {
    mkdirSync(dirname(stretchRecordPath(project.root, 4)), { recursive: true });
    writeFileSync(stretchRecordPath(project.root, 4), `${JSON.stringify(record)}\n`, 'utf8');
  }
  return project;
}

/** The seams of one case, with what the provider factory and git were asked. */
interface CaseSeams {
  readonly seams: StretchEndSeams;
  readonly made: () => readonly string[];
  readonly gitCalls: () => readonly (readonly string[])[];
}

/** Seams over the double answering `answers`, git answering `remoteHead` for `origin/HEAD`. */
function caseSeams(answers: PullRequestsAnswers, remoteHead: GitResult = { ok: false, stdout: '', stderr: '' }): CaseSeams & { sent: () => readonly string[] } {
  const double = createPullRequestsDouble(answers);
  const roots: string[] = [];
  const gitCalls: (readonly string[])[] = [];
  return {
    seams: {
      pr: {
        pullRequests: (root) => {
          roots.push(root);
          return double.pulls;
        },
        readBranch: () => 'main',
        readRemote: () => GITHUB_ORIGIN,
      },
      git: () => (args) => {
        gitCalls.push(args);
        return remoteHead;
      },
    },
    made: () => [...roots],
    gitCalls: () => [...gitCalls],
    sent: double.sent,
  };
}

/** Dispatches `rafa stretch end` with `words` from `project`. */
async function ran(seams: StretchEndSeams, project: PlantedProject, words: readonly string[] = []): Promise<CapturedRun> {
  return dispatchInProject(['stretch', 'end', ...words], [STRETCH_SUBJECT], [createStretchEndCommand(seams)], project);
}

/** The lines a run wrote to stdout, blank ones left out. */
function linesOf(run: CapturedRun): string[] {
  return run.stdout.split('\n').filter((line) => line !== '');
}

/** The project's config text. */
function configOf(project: PlantedProject): string {
  return readFileSync(configFilePath(project.root), 'utf8');
}

describe('the body', () => {
  it('appends every Closes line once, in ledger order, after a blank line', () => {
    const closes = closesLines([
      item({ closes: ['Closes #812', 'Closes #604'] }),
      item({ closes: [] }),
      item({ closes: ['Closes #604', 'Closes #706'] }),
    ]);

    expect(closes).toEqual(['Closes #812', 'Closes #604', 'Closes #706']);
    expect(endBody('# Report\n\nText.\n\n\n', closes)).toBe('# Report\n\nText.\n\nCloses #812\nCloses #604\nCloses #706\n');
  });

  it('leaves the report as written when the ledger closes nothing', () => {
    expect(endBody(REPORT, [])).toBe(REPORT);
  });

  it('titles the pull request by the stretch', () => {
    expect(endTitle(4)).toBe('Stretch 4');
  });
});

describe('the first run: the pull request into the default branch', () => {
  it('opens stretch/4 into the recorded default branch with the report and the ledger\'s Closes lines as its body', async () => {
    const drafts: PullRequestDraft[] = [];
    const project = freshProject({ items: [item(), item({ issue: '813', closes: ['Closes #813', 'Closes #812'] })] });
    const seams = caseSeams({
      listMerged: () => Promise.resolve([MERGED_ITEM]),
      findOpen: () => Promise.resolve(null),
      create: (draft) => {
        drafts.push(draft);
        return Promise.resolve(summary());
      },
    });

    const run = await ran(seams.seams, project);

    const body = `${REPORT}\nCloses #812\nCloses #813\n`;
    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(drafts).toEqual([{ head: 'stretch/4', base: 'main', title: 'Stretch 4', body }]);
    expect(readFileSync(bodyPath(project.root, 4), 'utf8')).toBe(body);
    expect(seams.sent().map((call) => call.split(' ')[0])).toEqual(['listMerged', 'findOpen', 'create']);
    expect(seams.sent()[1]).toBe('findOpen stretch/4');
    expect(linesOf(run)).toEqual([
      'stretch end: stretch 4 (stretch/4 into main), 2 Closes line(s) from the ledger',
      `write ${bodyPath(project.root, 4)}: report.md with the ledger's Closes lines`,
      `rafa pr open --head=stretch/4 --base=main '--title=Stretch 4' --body-file=${bodyPath(project.root, 4)}`,
      '✅ Opened #950 Stretch 4 (stretch/4 → main) https://github.com/open-tomato/rafa/pull/950',
      'once #950 has merged, run rafa stretch end again to put pr.base back',
    ]);
    expect(configOf(project)).toBe(STRETCH_CONFIG);
    expect(seams.gitCalls()).toEqual([]);
  });

  it('opens none when stretch/4 already has an open pull request, printing it', async () => {
    const project = freshProject();
    const seams = caseSeams({
      listMerged: () => Promise.resolve([]),
      findOpen: () => Promise.resolve(summary()),
    });

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(0);
    expect(seams.sent()).toEqual(['listMerged', 'findOpen stretch/4']);
    expect(linesOf(run)).toContain('✅ Already open, so none was opened: #950 Stretch 4 (stretch/4 → main) https://github.com/open-tomato/rafa/pull/950');
  });

  it('takes the default branch from origin/HEAD when there is no stretch.json, and main when git answers none', async () => {
    const opened = (): PullRequestsAnswers => ({
      listMerged: () => Promise.resolve([]),
      findOpen: () => Promise.resolve(null),
      create: (draft) => Promise.resolve(summary({ baseRefName: draft.base })),
    });
    const trunk = caseSeams(opened(), { ok: true, stdout: 'origin/trunk\n', stderr: '' });
    const none = caseSeams(opened());

    const fromHead = await ran(trunk.seams, freshProject({ record: null }));
    const fallback = await ran(none.seams, freshProject({ record: null }));

    expect([fromHead.exitCode, fallback.exitCode]).toEqual([0, 0]);
    expect(trunk.gitCalls()).toEqual([['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']]);
    expect(trunk.sent().at(-1)).toStartWith('create ');
    expect(linesOf(fromHead)[0]).toBe('stretch end: stretch 4 (stretch/4 into trunk), 0 Closes line(s) from the ledger');
    expect(linesOf(fallback)[0]).toBe('stretch end: stretch 4 (stretch/4 into main), 0 Closes line(s) from the ledger');
  });

  it('warns about a malformed ledger line and keeps the others', async () => {
    const drafts: PullRequestDraft[] = [];
    const project = freshProject({ items: [item()] });
    writeFileSync(itemsPath(project.root, 4), `${readFileSync(itemsPath(project.root, 4), 'utf8')}not json\n`, 'utf8');
    const seams = caseSeams({
      listMerged: () => Promise.resolve([]),
      findOpen: () => Promise.resolve(null),
      create: (draft) => {
        drafts.push(draft);
        return Promise.resolve(summary());
      },
    });

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(0);
    expect(linesOf(run)).toContain(`warn: skipped ${itemsPath(project.root, 4)}:2: not JSON`);
    expect(drafts[0]?.body).toBe(`${REPORT}\nCloses #812\n`);
  });

  it('prints the steps under --dry-run and writes no body file and opens nothing', async () => {
    const project = freshProject({ items: [item()] });
    const seams = caseSeams({ listMerged: () => Promise.resolve([]) });

    const run = await ran(seams.seams, project, ['--dry-run']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(seams.sent()).toEqual(['listMerged']);
    expect(existsSync(bodyPath(project.root, 4))).toBe(false);
    expect(linesOf(run)).toEqual([
      'stretch end: stretch 4 (stretch/4 into main), 1 Closes line(s) from the ledger, dry run: each step is printed and none is run',
      `write ${bodyPath(project.root, 4)}: report.md with the ledger's Closes lines`,
      `rafa pr open --head=stretch/4 --base=main '--title=Stretch 4' --body-file=${bodyPath(project.root, 4)}`,
      'dry run: would open stretch/4 into main, or print the pull request already open from it; nothing was run',
    ]);
  });
});

describe('the later run: pr.base put back once the pull request has merged', () => {
  it('sets pr.base back to the recorded value, keeping every comment, and opens nothing', async () => {
    const project = freshProject();
    const seams = caseSeams({ listMerged: () => Promise.resolve([MERGED_ITEM, MERGED_END]) });

    const run = await ran(seams.seams, project);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(seams.sent()).toEqual(['listMerged']);
    expect(configOf(project)).toBe(STRETCH_CONFIG.replace('base: stretch/4', 'base: develop'));
    expect(configOf(project)).toContain('# kept: a comment the edit leaves alone');
    expect(linesOf(run).slice(1)).toEqual([
      '#950 from stretch/4 merged at 2026-10-07T11:00:00Z',
      'rafa config set pr.base=develop',
      'pr.base: stretch/4 → develop; stretch 4 is ended',
    ]);
    expect(existsSync(bodyPath(project.root, 4))).toBe(false);
  });

  it('puts back the recorded default branch when the record holds no pr.base, and says so', async () => {
    const project = freshProject({
      record: { stretch: 4, branch: 'stretch/4', defaultBranch: 'trunk', prBase: null, startedAt: '2026-10-01T09:00:00.000Z' },
    });
    const seams = caseSeams({ listMerged: () => Promise.resolve([MERGED_END]) });

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(0);
    expect(configOf(project)).toContain('  base: trunk  # the integration branch\n');
    expect(linesOf(run)).toContain(`${stretchRecordPath(project.root, 4)} records no pr.base, so it is put back as trunk, the branch the stretch was pushed from`);
  });

  it('prints the config set line under --dry-run and leaves the config as it was', async () => {
    const project = freshProject();
    const seams = caseSeams({ listMerged: () => Promise.resolve([MERGED_END]) });

    const run = await ran(seams.seams, project, ['--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(configOf(project)).toBe(STRETCH_CONFIG);
    expect(linesOf(run).slice(-2)).toEqual([
      'rafa config set pr.base=develop',
      'dry run: would put pr.base back to develop; nothing was run',
    ]);
  });

  it('refuses with exit 1 and sets nothing when no stretch.json records what to put back', async () => {
    const project = freshProject({ record: null });
    const seams = caseSeams({ listMerged: () => Promise.resolve([MERGED_END]) });

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`no ${stretchRecordPath(project.root, 4)} records the pr.base to put back`);
    expect(run.stderr).toContain('rafa config set pr.base=<branch>');
    expect(configOf(project)).toBe(STRETCH_CONFIG);
  });
});

describe('the refusals', () => {
  it('refuses a stretch with no report.md, reaching no provider and writing nothing', async () => {
    const project = freshProject({ report: null });
    const seams = caseSeams({});

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`there is no ${reportPath(project.root, 4)}`);
    expect(seams.made()).toEqual([]);
    expect(existsSync(bodyPath(project.root, 4))).toBe(false);
    expect(configOf(project)).toBe(STRETCH_CONFIG);
  });

  it('refuses a pr.base naming no stretch/<n> branch, and one not set, reaching no provider', async () => {
    const onMain = caseSeams({});
    const unset = caseSeams({});

    const main = await ran(onMain.seams, freshProject({ config: 'version: 1\npr:\n  provider: gh\n  base: main\n' }));
    const none = await ran(unset.seams, freshProject({ config: 'version: 1\npr:\n  provider: gh\n' }));

    expect([main.exitCode, none.exitCode]).toEqual([1, 1]);
    expect(main.stderr).toContain('pr.base is "main", expected a stretch/<n> branch');
    expect(none.stderr).toContain('pr.base is not set, expected a stretch/<n> branch');
    expect([...onMain.made(), ...unset.made()]).toEqual([]);
  });

  it('refuses a word after the action and a stretch.json that is not a record', async () => {
    const stray = caseSeams({});
    const broken = freshProject();
    writeFileSync(stretchRecordPath(broken.root, 4), '[1, 2]\n', 'utf8');
    const badRecord = caseSeams({});

    const word = await ran(stray.seams, freshProject(), ['4']);
    const record = await ran(badRecord.seams, broken);

    expect([word.exitCode, record.exitCode]).toEqual([1, 1]);
    expect(word.stderr).toContain('rafa stretch end [--dry-run]');
    expect(record.stderr).toContain(`${stretchRecordPath(broken.root, 4)} holds`);
    expect([...stray.made(), ...badRecord.made()]).toEqual([]);
  });

  it('refuses with exit 2 where pr.provider is not gh, opening nothing', async () => {
    const project = freshProject({ config: 'version: 1\npr:\n  provider: none\n  base: stretch/4\n' });
    const seams = caseSeams({});

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(2);
    expect(seams.made()).toEqual([]);
    expect(existsSync(bodyPath(project.root, 4))).toBe(false);
  });

  it('reaches the provider from the same planted project once nothing is refused, the control', async () => {
    const project = freshProject();
    const seams = caseSeams({ listMerged: () => Promise.resolve([MERGED_END]) });

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(0);
    expect(seams.made()).toEqual([project.root]);
  });
});
