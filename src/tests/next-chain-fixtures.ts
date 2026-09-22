/**
 * What `next-chain-integration.test.ts` and
 * `next-chain-zero-checks-integration.test.ts` share: the scratch
 * repository's fixed identity (the base branch, the open pull request's
 * head branch and number, the project config), the stand-in `gh` both
 * probes' `PATH` resolves to, real git run in isolation from the
 * operator's HOME, and the small harness — {@link Scratch}, its record
 * and {@link runProbe} — that spawns a probe script and reads back what
 * it logged. Neither test file owns these: each builds its own probe
 * script and plants its own scratch repository over what is exported
 * here, so the two suites never share a temporary directory or an
 * `afterAll`.
 */
import type { PullRequestDetail, PullRequestSummary } from '../pr/index.js';

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEC_LABEL } from '../board/issue.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';

import { completeSpecBody } from './spec-bodies.js';

/** This module's directory, `src/tests/`, one level under every module a probe imports. */
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** `src/`, where every module a probe imports lives. */
export const SRC_DIR = join(TESTS_DIR, '..');

/** The base branch of the scratch repository. */
export const BASE = 'main';

/** The open pull request's head branch, merged and deleted by the chain. */
export const OLD_BRANCH = 'feat/rafa-63';

/** The pull request number every double answers for. */
export const PR_NUMBER = 41;

/** The roadmap issue `rafa next` and `plan create --next` both resolve. */
export const ROADMAP_ISSUE = 31;

/** The one undone roadmap line, and the issue `plan create` plans from. */
export const NEXT_ISSUE = 64;

/** The login every planted issue is authored by, trusted through the permission stand-in. */
export const AUTHOR_LOGIN = 'octocat';

/** The next issue's title, short enough that every word survives the slug. */
export const NEXT_TITLE = 'Ship next feature';

/** The project config: a GitHub provider so no origin remote needs probing, and the roadmap issue. */
export const CONFIG_TEXT = [
  'pr:',
  '  provider: gh',
  `  base: ${BASE}`,
  'roadmap:',
  `  issue: ${ROADMAP_ISSUE}`,
  '',
].join('\n');

/** Runs real git in `cwd`, isolated from the operator's real HOME; see `merge-driven.test.ts`'s own. */
export function git(cwd: string, home: string, ...args: readonly string[]): { readonly ok: boolean; readonly stdout: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      LC_ALL: 'C',
    },
  });
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() };
}

/** A pull request summary the double answers `findOpen` with, on {@link OLD_BRANCH}. */
export const PR_SUMMARY: PullRequestSummary = Object.freeze({
  number: PR_NUMBER,
  title: 'rafa-63: the open pull request this suite merges',
  url: `https://example.invalid/pull/${PR_NUMBER}`,
  state: 'open',
  headRefName: OLD_BRANCH,
  baseRefName: BASE,
  author: { login: AUTHOR_LOGIN, isBot: false },
  isCrossRepository: false,
  updatedAt: '2026-09-22T11:00:00Z',
});

/** The detail the double answers `get` with: green, mergeable, and closing nothing on the roadmap. */
export const PR_DETAIL: PullRequestDetail = Object.freeze({
  ...PR_SUMMARY,
  body: '',
  headRefOid: 'abc1234',
  mergeable: 'mergeable',
  mergeStateStatus: 'CLEAN',
  labels: [],
});

/** A JSON payload quoted for a single-quoted shell string; `plan-board-integration.test.ts`'s own. */
function shellQuoted(payload: unknown): string {
  return JSON.stringify(payload).replace(/'/gu, String.raw`'\''`);
}

/**
 * Writes the stand-in `gh` a probe's `PATH` resolves to: the roadmap
 * issue (its body given by `roadmapBody`), the next issue, the
 * collaborator permission both are trusted through, and an empty
 * `pr list`/`issue list` for the walk's other reads. Anything else fails
 * loudly, naming what it was asked.
 */
export function writeStandInGh(bin: string, roadmapBody: string): void {
  const roadmapIssue = {
    number: ROADMAP_ISSUE,
    title: 'Roadmap',
    body: roadmapBody,
    state: 'OPEN',
    labels: [],
    author: { login: AUTHOR_LOGIN },
  };
  const nextIssue = {
    number: NEXT_ISSUE,
    title: NEXT_TITLE,
    body: completeSpecBody(NEXT_TITLE),
    state: 'OPEN',
    labels: [{ name: SPEC_LABEL }, { name: SPEC_READY_LABEL }],
    author: { login: AUTHOR_LOGIN },
  };
  const lines = [
    '#!/bin/sh',
    `if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${ROADMAP_ISSUE}" ]; then`,
    `  printf '%s' '${shellQuoted(roadmapIssue)}'`,
    '  exit 0',
    'fi',
    `if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${NEXT_ISSUE}" ]; then`,
    `  printf '%s' '${shellQuoted(nextIssue)}'`,
    '  exit 0',
    'fi',
    `if [ "$1" = "api" ] && [ "$2" = "repos/{owner}/{repo}/collaborators/${AUTHOR_LOGIN}/permission" ]; then`,
    `  printf '%s' '${shellQuoted({ permission: 'admin', role_name: 'admin' })}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
    '  printf \'%s\' \'[]\'',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "list" ]; then',
    '  printf \'%s\' \'[]\'',
    '  exit 0',
    'fi',
    'echo "the stand-in gh was asked $*" >&2',
    'exit 1',
    '',
  ];
  const gh = join(bin, 'gh');
  writeFileSync(gh, lines.join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** A scratch repository, its bare remote, and the process it is driven through. */
export interface Scratch {
  /** Where everything for one case sits. */
  readonly root: string;
  /** The work tree, checked out on {@link OLD_BRANCH}, which the probe dispatches over. */
  readonly work: string;
  /** The HOME the probe runs under. */
  readonly home: string;
  /** The probe script, ready to spawn. */
  readonly probe: string;
  /** The PATH the probe runs under: its own `bin/`, then git's real directory. */
  readonly path: string;
}

/** What the probe recorded: the shared log, and how the chain ended. */
export interface ProbeRecord {
  readonly events: readonly string[];
  readonly outcome: {
    readonly ok: boolean;
    readonly exitCode?: number;
    readonly error?: string;
  };
}

/** The index every `needle` is found at in `haystack`, in the order given; `-1` for a miss. */
export function positionsOf(haystack: readonly string[], needles: readonly string[]): readonly number[] {
  return needles.map((needle) => haystack.indexOf(needle));
}

/** One spawn of the probe: the shared event log and how the chain ended, plus what it printed. */
export interface ProbeRun {
  readonly record: ProbeRecord;
  /** What a person reading a terminal would see: the state, proposal and stop lines this invocation wrote. */
  readonly stdout: string;
  /** The one line a refusal writes, for the cases that never reach the chain at all. */
  readonly stderr: string;
}

/**
 * Spawns the probe over `scratch` with `words` — everything `rafa next`
 * reads past its own name, `--yes=merge,plan` or `--dry-run` among them
 * — and reads back its record and console text. `name` tells two runs
 * against the same scratch apart, since each writes its own record file
 * rather than one call's overwriting the other's before it is read.
 */
export function runProbe(scratch: Scratch, words: readonly string[], name = 'record.json'): ProbeRun {
  const recordPath = join(scratch.root, name);
  const proc = Bun.spawnSync([process.execPath, scratch.probe, recordPath, ...words], {
    cwd: scratch.work,
    env: { PATH: scratch.path, HOME: scratch.home, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' },
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0 || !existsSync(recordPath)) {
    throw new Error(`the probe exited ${String(proc.exitCode)}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  const record = JSON.parse(readFileSync(recordPath, 'utf8')) as ProbeRecord;
  return { record, stdout, stderr };
}

/** A fresh temporary directory a suite's own scratch repositories sit under; the caller owns its clean-up. */
export function makeTempBase(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}
