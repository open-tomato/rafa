/**
 * Tests for the `conflict-version` dispatch of `rafa pr triage --resolve`
 * (`triage-convert.ts`, reached through `resolvePullRequest` in
 * `triage-resolve.ts`), over real repositories: a bare origin and a
 * clone whose `main` released `0.25.0` while a pushed feature branch
 * stamped `0.25.0` too.
 *
 * The assessment each case hands the run is the real classifier's over
 * the real guard's reading of that clone, so the class is the one
 * `rafa pr triage` would print, not a literal. What is measured is the
 * ORIGIN: the branch it holds after the run, its parent, the fragment
 * and the version in that tree. Beside it, the three seams a conversion
 * must never reach — the loop, a re-assessment and the provider — throw
 * and record, so "no session" is a reading and not a claim.
 *
 * The controls: a class that is not converted runs nothing and leaves
 * origin's branch where it was, so the converted case's moved branch is
 * the dispatch's doing; and the two refusals, a head the worktree is not
 * at and a push the remote rejects, exit 3 and leave origin's branch
 * exactly as they found it.
 */
import type { TriageReading } from './triage-report.js';
import type { ResolveRun } from './triage-resolve.js';
import type { Output } from '../../ports/index.js';
import type { PullRequestDetail, PullRequests } from '../../pr/index.js';
import type { TriageClass } from '../../pr/triage/classes.js';
import type { SettleSettings } from '../../release/settle.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../../pr/git.js';
import { classifyTriage } from '../../pr/triage/classify.js';
import { readTriageRerun } from '../../pr/triage/rerun.js';
import { resolveWorktreePath } from '../../pr/worktree.js';
import { parseFragment } from '../../release/fragment.js';
import { readGuard } from '../../release/guard.js';

import { RESOLVE_STOP_EXIT, resolvePullRequest } from './triage-resolve.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-triage-convert-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The release settings every run converts under. */
const SETTINGS: SettleSettings = {
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The stamped branch. */
const BRANCH = 'feat/rafa-356-parallel-thing';

/** Its pull request. */
const NUMBER = 356;

/** The author, trusted through the allow-list so no lookup is spent. */
const AUTHOR = 'someone';

/** The instant every run is stamped with. */
const NOW = '2026-09-29T12:00:00Z';

/** The fragment the conversion writes. */
const FRAGMENT = '.changes/rafa-356-parallel-thing.md';

/** A manifest declaring `version`. */
function manifest(version: string): string {
  return `{\n  "name": "demo",\n  "version": "${version}",\n  "license": "MIT"\n}\n`;
}

/** A changelog of one section per `[version, note]`, newest first. */
function changelog(...sections: readonly (readonly [string, string])[]): string {
  return ['# Changelog', '', ...sections.flatMap(([version, note]) => [`## ${version} — 2026-09-28, t`, '', note, ''])].join('\n');
}

/** A clone of a bare origin, and git in either. */
interface World {
  readonly clone: string;
  readonly home: string;
  /** Runs git in the clone, answering stdout trimmed. */
  readonly git: (args: readonly string[]) => string;
  /** Runs git in the bare origin, answering stdout trimmed. */
  readonly origin: (args: readonly string[]) => string;
  /** The branch's stamped head. */
  readonly head: string;
}

/**
 * The 0.25.0 incident on origin: `main` released 0.25.0, and `BRANCH`,
 * forked at 0.24.0, stamped 0.25.0 with other notes and was pushed. The
 * clone is left on `main`, so the resolve run can add a worktree of the
 * branch.
 */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const originDir = join(dir, 'origin.git');
  const clone = join(dir, 'clone');
  const home = join(dir, 'home');
  for (const path of [clone, home, join(dir, 'no-hooks')]) mkdirSync(path, { recursive: true });
  const run = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' },
  }).trim();
  const git = (args: readonly string[]): string => run(clone, args);
  const commit = (files: Readonly<Record<string, string>>, message: string): string => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(clone, path)), { recursive: true });
      writeFileSync(join(clone, path), text, 'utf8');
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  run(dir, ['init', '-q', '--bare', '--initial-branch=main', originDir]);
  git(['init', '-q', '--initial-branch=main', '.']);
  for (const [key, value] of [
    ['user.name', 'rafa convert'],
    ['user.email', 'convert@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', join(dir, 'no-hooks')],
  ] as const) git(['config', key, value]);
  git(['remote', 'add', 'origin', originDir]);
  commit({ 'package.json': manifest('0.24.0'), 'CHANGELOG.md': changelog(['0.24.0', '- old']), 'src/a.ts': 'a\n' }, 'fork');
  git(['push', '-q', 'origin', 'main']);
  git(['switch', '-q', '-c', BRANCH]);
  const head = commit({
    'src/a.ts': 'a, changed\n',
    'package.json': manifest('0.25.0'),
    'CHANGELOG.md': changelog(['0.25.0', '- Loop: the branch line'], ['0.24.0', '- old']),
  }, 'feat: stamped 0.25.0');
  git(['push', '-q', '-u', 'origin', BRANCH]);
  git(['switch', '-q', 'main']);
  commit({ 'package.json': manifest('0.25.0'), 'CHANGELOG.md': changelog(['0.25.0', '- Effort: the base line'], ['0.24.0', '- old']) }, 'chore: release 0.25.0');
  git(['push', '-q', 'origin', 'main']);
  return { clone, home, git, origin: (args) => run(originDir, args), head };
}

/** The pull request as `gh pr view` would answer it for the branch at `head`. */
function detailAt(head: string): PullRequestDetail {
  return {
    number: NUMBER,
    title: 'Parallel thing',
    url: `https://github.com/open-tomato/demo/pull/${String(NUMBER)}`,
    state: 'open',
    headRefName: BRANCH,
    baseRefName: 'main',
    author: { login: AUTHOR, isBot: false },
    isCrossRepository: false,
    updatedAt: NOW,
    body: '',
    headRefOid: head,
    mergeable: 'conflicting',
    mergeStateStatus: 'DIRTY',
    labels: [],
    closes: [],
  };
}

/** The reading `rafa pr triage` would hand the run: the real guard, classified; `as` overrides the class. */
function readingOf(w: World, detail: PullRequestDetail, as?: TriageClass): TriageReading {
  const guard = readGuard({
    git: createGitRunner(w.clone),
    settings: SETTINGS,
    base: 'origin/main',
    branch: { ref: detail.headRefOid, name: BRANCH, pullRequest: NUMBER },
    now: new Date(NOW),
  });
  const classified = classifyTriage({
    pr: detail,
    rows: [],
    step: undefined,
    conflictFiles: ['CHANGELOG.md'],
    workflowCount: null,
    guard: guard.ok
      ? guard.verdict
      : null,
  });
  const assessment = as === undefined
    ? classified
    : { ...classified, triageClass: as, simple: false };
  return {
    detail,
    rerun: readTriageRerun({ comment: null, head: detail.headRefOid, rows: [] }),
    ignored: [],
    assessment,
    logs: null,
    workflows: null,
    conflict: null,
    prompt: null,
    write: null,
    writeProblem: null,
    attempts: 1,
    maxAttempts: 2,
  };
}

/** What a run touched that it must not, and what it said. */
interface Seams {
  readonly touched: string[];
  readonly lines: string[];
}

/** A provider every member of which records its name and throws. */
function untouchablePulls(seams: Seams): PullRequests {
  return new Proxy({}, {
    get: (_target, key) => () => {
      seams.touched.push(`pulls.${String(key)}`);
      throw new Error(`pulls.${String(key)} was reached`);
    },
  }) as PullRequests;
}

/** An output that records every line. */
function recordingOutput(seams: Seams): Output {
  const record = (message: string): void => {
    seams.lines.push(message);
  };
  return { info: record, warn: record, error: record, debug: record, emit: () => undefined, result: () => undefined };
}

/** The run `resolvePullRequest` is handed over `reading`. */
function runOf(w: World, reading: TriageReading, seams: Seams): ResolveRun {
  return {
    pulls: untouchablePulls(seams),
    trust: {
      permissions: () => {
        seams.touched.push('permissions');
        return Promise.reject(new Error('no lookup should be spent'));
      },
      trustedAuthors: [AUTHOR],
      repo: 'open-tomato/demo',
    },
    root: w.clone,
    home: w.home,
    release: SETTINGS,
    number: NUMBER,
    reading,
    maxAttempts: 2,
    budgetUsd: 0.5,
    now: () => NOW,
    output: recordingOutput(seams),
    git: createGitRunner,
    runLoop: () => {
      seams.touched.push('runLoop');
      return Promise.reject(new Error('no loop should run'));
    },
    reassess: () => {
      seams.touched.push('reassess');
      return Promise.reject(new Error('no re-assessment should run'));
    },
  };
}

/** Fresh seams. */
function seams(): Seams {
  return { touched: [], lines: [] };
}

describe('rafa pr triage --resolve over conflict-version', () => {
  it('is handed the class the real guard and classifier read off the incident', () => {
    const w = world();

    expect(readingOf(w, detailAt(w.head)).assessment).toMatchObject({ triageClass: 'conflict-version', simple: true });
  });

  it('pushes one conversion commit to the branch and runs no loop, no re-assessment and no provider call', async () => {
    const w = world();
    const s = seams();
    const result = await resolvePullRequest(runOf(w, readingOf(w, detailAt(w.head)), s));

    expect(s.touched).toEqual([]);
    expect(result).toMatchObject({ ran: true, resolved: false, stop: null, attempts: 1, exitCode: 0 });
    const pushed = w.origin(['rev-parse', BRANCH]);
    expect(pushed).not.toBe(w.head);
    expect(w.origin(['rev-parse', `${BRANCH}^`])).toBe(w.head);
    const fragment = parseFragment(w.origin(['show', `${BRANCH}:${FRAGMENT}`]).concat('\n'));
    expect(fragment).toMatchObject({ ok: true, fragment: { level: 'minor', notes: ['- Loop: the branch line'] } });
    expect(w.origin(['show', `${BRANCH}:package.json`])).toBe(manifest('0.24.0').trim());
    expect(result.headline).toStartWith(`✅ #${String(NUMBER)}: Converted the stamped 0.25.0 into ${FRAGMENT}`);
    expect(result.lines).toContain(`Pushed ${BRANCH}; run rafa pr triage ${String(NUMBER)} once its checks have run on the new head.`);
  });

  it('removes the worktree it added, and says it spends no session', async () => {
    const w = world();
    const s = seams();
    const result = await resolvePullRequest(runOf(w, readingOf(w, detailAt(w.head)), s));
    const path = resolveWorktreePath(w.home, NUMBER);

    expect(s.lines).toContain(`🔧 Converting #${String(NUMBER)}'s stamped version into a release fragment: no session, no attempt spent`);
    expect(s.lines).toContain(`   Added the worktree at ${path}`);
    expect(result.lines.at(-1)).toBe(`Removed the worktree at ${path}.`);
    expect(existsSync(path)).toBe(false);
    expect(w.git(['worktree', 'list', '--porcelain'])).not.toContain(path);
  });

  it('control: a class that is not converted runs nothing and leaves origin\'s branch where it was', async () => {
    const w = world();
    const s = seams();
    const result = await resolvePullRequest(runOf(w, readingOf(w, detailAt(w.head), 'conflict-other'), s));

    expect(result).toMatchObject({ ran: false, exitCode: 0 });
    expect(result.headline).toContain('which is not simple, so --resolve ran nothing');
    expect(w.origin(['rev-parse', BRANCH])).toBe(w.head);
    expect(s.touched).toEqual([]);
  });
});

describe('rafa pr triage --resolve refusing a conversion', () => {
  it('exits 3 when the pull request\'s head is not the branch the worktree holds, pushing nothing', async () => {
    const w = world();
    const s = seams();
    const elsewhere = w.git(['rev-parse', 'origin/main']);
    const reading = { ...readingOf(w, detailAt(w.head)), detail: detailAt(elsewhere) };
    const result = await resolvePullRequest(runOf(w, reading, s));

    expect(result).toMatchObject({ ran: false, exitCode: RESOLVE_STOP_EXIT });
    expect(result.headline).toStartWith(`⛔ rafa pr triage --resolve did not convert #${String(NUMBER)}: The stamped version was not converted:`);
    expect(w.origin(['rev-parse', BRANCH])).toBe(w.head);
    expect(s.touched).toEqual([]);
  });

  it('exits 3 when the remote rejects the push, never forcing it', async () => {
    const w = world();
    const s = seams();
    const detail = detailAt(w.head);
    const reading = readingOf(w, detail);
    w.git(['switch', '-q', '-c', 'elsewhere', BRANCH]);
    writeFileSync(join(w.clone, 'src/b.ts'), 'b\n');
    w.git(['add', '-A']);
    w.git(['commit', '-q', '-m', 'someone else pushed']);
    w.git(['push', '-q', 'origin', `elsewhere:${BRANCH}`]);
    const moved = w.git(['rev-parse', 'HEAD']);
    w.git(['switch', '-q', 'main']);
    const result = await resolvePullRequest(runOf(w, reading, s));

    expect(result).toMatchObject({ ran: true, exitCode: RESOLVE_STOP_EXIT });
    expect(result.lines.some((line) => line.startsWith(`The conversion was committed in the worktree but not pushed: git push origin ${BRANCH}:`))).toBe(true);
    expect(w.origin(['rev-parse', BRANCH])).toBe(moved);
  });
});
