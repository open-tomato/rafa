/**
 * Spawned `bun src/rafa.ts` runs of `rafa next --dry-run` and
 * `rafa plan create --next --dry-run`, over a stand-in `gh` in the
 * scratch `bin/` and a real git repository with a bare `origin` beside
 * it (`.rafa/specs/rafa-244-epics-group-issues-features.md`).
 *
 * `src/board/epic-walk.test.ts` drives the descent itself over planted
 * fakes, `src/next/sources.test.ts` drives `ghNextBoard`'s wiring of it
 * the same way, and `src/board/spec-source.test.ts` drives
 * `pickRoadmapIssue`'s. None of the three runs the real, registered
 * `rafa next` or `rafa plan create` command over a real `gh` on the
 * `PATH`, so none of them can see the two commands agree, or that a
 * roadmap with no epic line still prints exactly what it always did.
 * This file is that end-to-end proof, for both commands, over the same
 * three roadmaps:
 *
 *  - a roadmap whose first line names an open, `now` epic that is not
 *    done: both commands propose the epic's first open checklist spec;
 *  - a roadmap whose first line names an epic that runs DRY — every
 *    checklist line done or taken — with a SECOND epic after it on the
 *    roadmap: both commands stop there, naming neither the second
 *    epic's issue nor its own member's; and
 *  - a roadmap with no epic line at all: both commands print the exact
 *    bytes they always did, proven with `toBe` rather than `toContain`.
 *
 * Every stand-in `gh` here fails loudly — `exit 1` naming the call — on
 * anything it was not planted to answer, so a walk that read an issue it
 * should not have (the second epic's, or its member's) fails the run
 * rather than silently passing.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { SpecIssue } from '../board/issue.js';
import type { RoadmapLine } from '../board/roadmap.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../board/issue.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { parseRoadmapBody } from '../board/roadmap.js';
import { describeIssue, dryRunLine, pickLine, roadmapHeaderLine } from '../board/spec-source.js';
import { DRY_RUN_FLAG as NEXT_DRY_RUN_FLAG } from '../commands/next.js';
import { plural } from '../commands/plan/plan-files.js';
import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { completeSpecBody } from './spec-bodies.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-descent-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The login every planted issue is authored by, and the one `board.trustedAuthors` names. */
const AUTHOR_LOGIN = 'octocat';

/** The roadmap issue's number, named by `roadmap.issue`. */
const ROADMAP = 31;

/** One issue as `gh issue view` answers it, every field filled in unless `over` says otherwise. */
function issueOf(over: Partial<SpecIssue> & { readonly number: number }): SpecIssue {
  return {
    title: `Issue ${String(over.number)}`,
    body: '',
    state: 'OPEN',
    labels: [],
    author: AUTHOR_LOGIN,
    ...over,
  };
}

/** One row of the board listing (`gh issue list --state all`), independent of that issue's own view. */
interface BoardRow {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly stateReason: string | null;
  readonly labels: readonly string[];
}

/** A board row, every field filled in unless `over` says otherwise. */
function rowOf(over: Partial<BoardRow> & { readonly number: number }): BoardRow {
  return {
    title: `Issue ${String(over.number)}`,
    body: '',
    state: 'OPEN',
    stateReason: null,
    labels: [],
    ...over,
  };
}

/** The three labels a `now` epic carries, `slug` its own. */
function epicLabels(slug: string): readonly string[] {
  return ['type:epic', `epic:${slug}`, 'horizon:now'];
}

/** A JSON payload quoted for a single-quoted shell string. */
function shellQuoted(payload: unknown): string {
  return JSON.stringify(payload).replace(/'/gu, String.raw`'\''`);
}

/**
 * Writes the stand-in `gh`: one `issue view` answer per `issues` entry,
 * one `issue list --state all` answer over `listing`, an empty
 * `type:roadmap` listing and an empty `pr list`. Anything else fails loudly, naming what it was asked, so a
 * read this suite did not plant for — the second epic's issue among
 * them — fails the run rather than passing quietly.
 */
function writeGhStub(bin: string, issues: readonly SpecIssue[], listing: readonly BoardRow[] = []): void {
  const lines = ['#!/bin/sh'];
  for (const issue of issues) {
    lines.push(`if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${String(issue.number)}" ]; then`);
    lines.push(`  printf '%s' '${shellQuoted({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels.map((name) => ({ name })),
      author: { login: issue.author },
    })}'`);
    lines.push('  exit 0');
    lines.push('fi');
  }
  // No issue carries type:roadmap: its listing answers empty, told apart
  // from the board listing by its label flag.
  lines.push('case "$*" in *"--label type:roadmap"*) printf \'%s\' \'[]\'; exit 0;; esac');
  lines.push('if [ "$1" = "issue" ] && [ "$2" = "list" ] && [ "$3" = "--state" ] && [ "$4" = "all" ]; then');
  lines.push(`  printf '%s' '${shellQuoted(listing.map((row) => ({
    number: row.number,
    title: row.title,
    body: row.body,
    state: row.state,
    stateReason: row.stateReason,
    labels: row.labels.map((name) => ({ name })),
  })))}'`);
  lines.push('  exit 0');
  lines.push('fi');
  lines.push('if [ "$1" = "pr" ] && [ "$2" = "list" ]; then');
  lines.push('  printf \'%s\' \'[]\'');
  lines.push('  exit 0');
  lines.push('fi');
  lines.push('echo "the stand-in gh was asked $*" >&2');
  lines.push('exit 1');
  lines.push('');
  const gh = join(bin, 'gh');
  writeFileSync(gh, lines.join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** The project config: `pr.provider`, `board.trustedAuthors` and `roadmap.issue`, over `rafa init`'s own text. */
function configText(): string {
  return `${projectConfigText()}pr:\n  provider: gh\n  base: main\nboard:\n  trustedAuthors:\n    - ${AUTHOR_LOGIN}\nroadmap:\n  issue: ${String(ROADMAP)}\n`;
}

/**
 * A commit on `main`, pushed to a bare `origin` beside the repository,
 * and one local branch per name in `branches`: the shape both commands'
 * board walks need to read no problems into their own output — a
 * missing `origin` or an unborn `main` would each warn on stdout and
 * break the byte-identical case below.
 */
function gitSetup(scratch: ScratchRepo, branches: readonly string[] = []): void {
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(scratch.repo, 'README.md'), 'a scratch repository for the epic descent cli suite\n', 'utf8');
  git(['add', '.gitignore', 'README.md']);
  git(['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.com', 'commit', '-q', '-m', 'init']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', '-u', 'origin', 'main']);
  for (const branch of branches) git(['branch', branch]);
}

/** Plants a scratch project over `issues` and `listing`, with `branches` cut off `main`. */
function plant(issues: readonly SpecIssue[], listing: readonly BoardRow[] = [], branches: readonly string[] = []): ScratchRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  plantProjectConfig(scratch.repo, configText());
  gitSetup(scratch, branches);
  writeGhStub(scratch.bin, issues, listing);
  return scratch;
}

describe('rafa next --dry-run and rafa plan create --next --dry-run, over the epic descent', () => {
  describe('a roadmap whose first line names an open, now epic that is not done', () => {
    const EPIC = 80;
    const EPIC_BODY = '- [ ] #81\n- [ ] #82\n';

    const issues: readonly SpecIssue[] = [
      issueOf({ number: ROADMAP, title: 'Roadmap', body: `- [ ] #${String(EPIC)}\n` }),
      issueOf({ number: EPIC, title: 'Walk the epic', body: EPIC_BODY, labels: epicLabels('walk') }),
      issueOf({ number: 81, title: 'Done thing', state: 'CLOSED' }),
      issueOf({
        number: 82,
        title: 'Second thing',
        body: completeSpecBody('Second thing'),
        labels: [SPEC_LABEL, SPEC_READY_LABEL],
      }),
    ];
    const listing: readonly BoardRow[] = [
      rowOf({ number: EPIC, title: 'Walk the epic', body: EPIC_BODY, labels: epicLabels('walk') }),
      rowOf({ number: 81, title: 'Done thing', state: 'CLOSED', stateReason: 'COMPLETED', labels: ['epic:walk'] }),
      rowOf({ number: 82, title: 'Second thing', body: completeSpecBody('Second thing'), labels: ['epic:walk'] }),
    ];

    it('rafa next --dry-run proposes #82, the epic\'s first open checklist spec', () => {
      const scratch = plant(issues, listing);
      const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain(`#82 is next on the roadmap and carries \`${SPEC_READY_LABEL}\``);
      expect(run.stdout).toContain('create the plan for #82');
    });

    it('rafa plan create --next --dry-run walks into the epic and would plan from #82', () => {
      const scratch = plant(issues, listing);
      const run = runRafa(scratch, scratch.repo, ['plan', 'create', '--next', '--dry-run', '--no-progress']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain(`walking into epic #${String(EPIC)}`);
      expect(run.stdout).toContain('Next on the roadmap: issue #82');
      expect(run.stdout).toContain('would plan from issue #82 "Second thing". Nothing was written.');
    });
  });

  describe('a roadmap whose first line names a dry epic, a second epic after it', () => {
    const EPIC = 80;
    const SECOND_EPIC = 90;
    const EPIC_BODY = '- [ ] #81\n- [ ] #82\n';

    // #81 is closed, #82 is open but taken by a branch: the epic is not
    // done (only 1 of 2 members is), yet every one of its lines is done
    // or taken, so it runs dry. #90 and #91 — the second epic and its
    // own member — are named on the roadmap but planted into neither the
    // stand-in `gh` nor the listing: a walk that read either fails the
    // run rather than passing.
    const issues: readonly SpecIssue[] = [
      issueOf({ number: ROADMAP, title: 'Roadmap', body: `- [ ] #${String(EPIC)}\n- [ ] #${String(SECOND_EPIC)}\n` }),
      issueOf({ number: EPIC, title: 'Walk the epic', body: EPIC_BODY, labels: epicLabels('walk') }),
      issueOf({ number: 81, title: 'Done thing', state: 'CLOSED' }),
      issueOf({ number: 82, title: 'Taken thing' }),
    ];
    const listing: readonly BoardRow[] = [
      rowOf({ number: EPIC, title: 'Walk the epic', body: EPIC_BODY, labels: epicLabels('walk') }),
      rowOf({ number: 81, title: 'Done thing', state: 'CLOSED', stateReason: 'COMPLETED', labels: ['epic:walk'] }),
      rowOf({ number: 82, title: 'Taken thing', labels: ['epic:walk'] }),
    ];

    it('rafa next --dry-run stops at the dry epic, naming neither #90 nor #91', () => {
      const scratch = plant(issues, listing, ['feat/rafa-82-taken']);
      const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain(`the roadmap, issue #${String(ROADMAP)}, has no line left that is not done or taken (${plural(2, 'line')} passed)`);
      expect(run.stdout).not.toContain('#90');
      expect(run.stdout).not.toContain('#91');
    });

    it('rafa plan create --next --dry-run stops at the dry epic, naming neither #90 nor #91', () => {
      const scratch = plant(issues, listing, ['feat/rafa-82-taken']);
      const run = runRafa(scratch, scratch.repo, ['plan', 'create', '--next', '--dry-run', '--no-progress']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain(`epic #${String(EPIC)} Walk the epic has run dry`);
      expect(run.stdout).toContain('does not move on to another epic');
      expect(run.stdout).not.toContain('#90');
      expect(run.stdout).not.toContain('#91');
    });
  });

  describe('a roadmap with no epic line at all', () => {
    const ISSUE = 20;
    const TITLE = 'Ship it';

    const roadmapIssue = issueOf({ number: ROADMAP, title: 'Roadmap', body: `- [ ] #${String(ISSUE)}\n` });
    const nextIssue = issueOf({
      number: ISSUE,
      title: TITLE,
      body: completeSpecBody(TITLE),
      labels: [SPEC_LABEL, SPEC_READY_LABEL],
    });
    const issues: readonly SpecIssue[] = [roadmapIssue, nextIssue];

    it('rafa next --dry-run prints exactly the two lines and the stop, byte for byte', () => {
      const scratch = plant(issues);
      const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

      const expected = [
        `📍 #${String(ISSUE)} is next on the roadmap and carries \`${SPEC_READY_LABEL}\`.`,
        `👉 create the plan for #${String(ISSUE)} — rafa plan create --next`,
        `⏹ --${NEXT_DRY_RUN_FLAG}: nothing ran.`,
      ].join('\n') + '\n';

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe(expected);
    });

    it('rafa plan create --next --dry-run prints exactly the walk and the stop, byte for byte', () => {
      const scratch = plant(issues);
      const run = runRafa(scratch, scratch.repo, ['plan', 'create', '--next', '--dry-run', '--no-progress', '--no-hint']);

      const [line] = parseRoadmapBody(roadmapIssue.body) as [RoadmapLine];
      const expected = [
        roadmapHeaderLine(ROADMAP),
        pickLine(line),
        dryRunLine(describeIssue(nextIssue)),
      ].join('\n') + '\n';

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe(expected);
    });
  });
});
