/**
 * An integration test over check 4 of the readiness gate, driven
 * through `rafa plan create --issue` itself: a scratch git repository
 * with a bare `origin`, a planted board (one stand-in `gh` answering
 * the spec issue and the issues it names), and a fixture planner
 * standing in for a Claude Code session.
 *
 * `src/board/refs-gate.test.ts` and `src/commands/plan/refs-check.test.ts`
 * drive the gate over fake verifiers; `./refs-reading-integration.test.ts`
 * drives the reading over a planted repository. This file drives the
 * seam across them and `src/plan.ts`: that a refusal is printed in the
 * words a person reads, exits 2, and starts no planner session; that
 * `--accept-refs` plans and leaves the new stamps in the saved copy; and
 * that `dangerous.acceptStaleRefs` prints its pass line and plans.
 *
 * Each case runs the command as a process, as `plan-board-integration.test.ts`
 * does and for the same reason: the board route builds its own `gh` and
 * `git` runners, and `plan create` reads the notices file under HOME.
 * The planner fixture appends a line to a log on every session, so "no
 * session was spent" is read off a file, not a claim.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../board/issue.js';
import { specPath } from '../board/naming.js';
import { BOARD_REFUSAL_EXIT } from '../board/plan-spec.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { ACCEPT_REFS_FLAG, acceptStaleRefsPassLine } from '../board/refs-gate.js';
import { readRefsBlock } from '../refs/stamp.js';

import { plantProjectConfig } from './cli-capture.js';
import { completeSpecBody } from './spec-bodies.js';

/** `src/`, where every module the probe imports lives. */
const SRC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Where `--issue` writes its snapshot; a project's own default. */
const SPECS_DIR = '.rafa/specs';

/** The spec issue every case plans from, and the issue its body names. */
const SPEC_ISSUE = 20;
const NAMED_ISSUE = 7;
const SPEC_TITLE = 'The board routes';

/**
 * The child process: the `plan create` command over a registry holding
 * a fixture planner. The planner logs each session to the first
 * argument's sibling `sessions.log` and writes a minimal plan.
 */
const PROBE = [
  'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  `import { createAdapterRegistry } from ${JSON.stringify(join(SRC_DIR, 'adapters', 'registry.ts'))};`,
  `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
  `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
  `import declared from ${JSON.stringify(join(SRC_DIR, 'commands', 'plan', 'create.ts'))};`,
  `import { wrapPhaseZeroCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'wrap.ts'))};`,
  `import plan from ${JSON.stringify(join(SRC_DIR, 'plan.ts'))};`,
  '',
  'const [sessions, ...args] = process.argv.slice(2);',
  'const registry = createAdapterRegistry([{',
  '  port: "planner",',
  '  kind: "claude",',
  '  portVersion: 1,',
  '  create: (context) => ({',
  '    create: async (request) => {',
  '      appendFileSync(sessions, request.stub + "\\n");',
  '      const planPath = context.planDir + "/PLAN-" + request.stub + ".md";',
  '      mkdirSync(join(context.repoRoot, context.planDir), { recursive: true });',
  '      writeFileSync(',
  '        join(context.repoRoot, planPath),',
  '        "# Plan\\n\\n```rafa:plan\\nstub: " + request.stub + "\\n```\\n\\n- [ ] one task\\n",',
  '      );',
  '      return { planPath, prerequisitesPath: null };',
  '    },',
  '  }),',
  '}]);',
  'const command = wrapPhaseZeroCommand(declared, (words, root) => plan(words, root, registry));',
  'const commands = createCommandRegistry({ subjects: [{ name: "plan", summary: "plans" }], commands: [command] });',
  'const { exitCode } = await dispatch(["plan", "create", ...args], { registry: commands });',
  'process.exitCode = exitCode;',
  '',
].join('\n');

let tempDir = '';
let planted = 0;

beforeAll(() => {
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-gate-integration-')));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** The isolated environment every git call here runs under. */
function gitEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'rafa test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'rafa test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    LC_ALL: 'C',
  };
}

/** A run of real git, throwing what it wrote to stderr when it failed. */
function git(scratch: { readonly home: string }, cwd: string, ...args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd, env: gitEnv(scratch.home) });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
}

/** One planted issue of the stand-in board. */
interface BoardIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
}

/** A JSON payload quoted for a single-quoted shell string. */
function shellQuoted(payload: unknown): string {
  return JSON.stringify(payload).replace(/'/gu, String.raw`'\''`);
}

/** Writes the stand-in `gh` answering `issues` and the author's permission; anything else fails loudly. */
function writeGh(bin: string, issues: readonly BoardIssue[]): void {
  const lines = ['#!/bin/sh'];
  for (const issue of issues) {
    lines.push(`if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${String(issue.number)}" ]; then`);
    lines.push(`  printf '%s' '${shellQuoted({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state ?? 'OPEN',
      labels: (issue.labels ?? []).map((name) => ({ name })),
      author: { login: 'octocat' },
    })}'`);
    lines.push('  exit 0', 'fi');
  }
  lines.push('if [ "$1" = "api" ] && [ "$2" = "repos/{owner}/{repo}/collaborators/octocat/permission" ]; then');
  lines.push(`  printf '%s' '${shellQuoted({ permission: 'admin', role_name: 'admin' })}'`, '  exit 0', 'fi');
  lines.push('echo "the stand-in gh was asked $*" >&2', 'exit 1', '');
  const gh = join(bin, 'gh');
  writeFileSync(gh, lines.join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** One scratch repository with its bare remote, board and process environment. */
interface Scratch {
  readonly root: string;
  readonly repo: string;
  readonly bin: string;
  readonly home: string;
  readonly path: string;
  readonly probe: string;
  readonly sessions: string;
}

/**
 * Plants a repository holding a tracked `src/a.ts` and pushed to a bare
 * `origin.git`, with `.rafa/` ignored so the snapshot and plans never
 * dirty the tree, and the project's `config`.
 */
function plantScratch(config = ''): Scratch {
  planted += 1;
  const root = join(tempDir, `run-${String(planted)}`);
  const repo = join(root, 'repo');
  const bare = join(root, 'origin.git');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });
  const scratch = { home };

  git(scratch, root, 'init', '-q', '--bare', '--initial-branch=main', bare);
  git(scratch, repo, 'init', '-q', '--initial-branch=main');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const alphaValue = 1;\n', 'utf8');
  git(scratch, repo, 'add', '--all');
  git(scratch, repo, 'commit', '-q', '-m', 'first');
  git(scratch, repo, 'remote', 'add', 'origin', bare);
  git(scratch, repo, 'push', '-q', '-u', 'origin', 'main');
  plantProjectConfig(repo, `pr:\n  provider: gh\n  base: main\n${config}`);

  const claude = join(bin, 'claude');
  writeFileSync(claude, ['#!/bin/sh', 'echo "the stand-in claude ran" >&2', 'exit 97', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');

  const probe = join(root, 'probe.ts');
  writeFileSync(probe, PROBE, 'utf8');
  return { root, repo, bin, home, path: [bin, dirname(gitBinary)].join(delimiter), probe, sessions: join(root, 'sessions.log') };
}

/** The spec issue with `lines` as the prose under its first heading. */
function specIssue(...lines: readonly string[]): BoardIssue {
  return {
    number: SPEC_ISSUE,
    title: SPEC_TITLE,
    body: completeSpecBody(SPEC_TITLE, lines.join('\n')),
    labels: [SPEC_LABEL, SPEC_READY_LABEL],
  };
}

/** A referenced issue whose `## Design` section reads `design`. */
function namedIssue(design: string, state: 'OPEN' | 'CLOSED' = 'OPEN'): BoardIssue {
  return { number: NAMED_ISSUE, title: 'Named', body: `## Design\n\n${design}\n\n## Notes\n\nSame.\n`, state };
}

/** What one `plan create` run did. */
interface Run {
  readonly exitCode: number;
  readonly output: string;
}

/** Runs `plan create --issue=20` in `scratch` with `extra` words; the two streams are read as one. */
function runPlan(scratch: Scratch, ...extra: readonly string[]): Run {
  const proc = Bun.spawnSync(
    [process.execPath, scratch.probe, scratch.sessions, `--issue=${String(SPEC_ISSUE)}`, '--no-progress', ...extra],
    { cwd: scratch.repo, env: { PATH: scratch.path, HOME: scratch.home, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' } },
  );
  return { exitCode: proc.exitCode, output: `${proc.stdout.toString()}\n${proc.stderr.toString()}` };
}

/** How many planner sessions the scratch has spent. */
function sessionsSpent(scratch: Scratch): number {
  return existsSync(scratch.sessions)
    ? readFileSync(scratch.sessions, 'utf8').split('\n')
      .filter((line) => line !== '').length
    : 0;
}

/** The plan files written, so a second run is not refused for the first's. */
function clearPlans(scratch: Scratch): void {
  rmSync(join(scratch.repo, '.rafa', 'plans'), { recursive: true, force: true });
}

/** The saved copy of the spec issue. */
function copyOf(scratch: Scratch): string {
  return readFileSync(join(scratch.repo, specPath(SPECS_DIR, SPEC_ISSUE, SPEC_TITLE)), 'utf8');
}

/** The prose lines that put `text` on line 12 of the body, as the issue was written. */
function proseWithAt12(text: string): readonly string[] {
  return [...Array.from({ length: 7 }, (_, at) => `Filler line ${String(at + 1)} of the spec.`), text];
}

describe('check 4 through plan create --issue', () => {
  it('refuses a spec naming a deleted src/a.ts as `dangling src/a.ts (line 12)`, spending no session and writing no plan', () => {
    const scratch = plantScratch();
    git(scratch, scratch.repo, 'rm', '-q', 'src/a.ts');
    git(scratch, scratch.repo, 'commit', '-q', '-m', 'delete a');
    writeGh(scratch.bin, [specIssue(...proseWithAt12('It reads `src/a.ts` first.'))]);

    const run = runPlan(scratch);

    expect(run.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(run.output).toContain('dangling src/a.ts (line 12)');
    expect(run.output).toContain(ACCEPT_REFS_FLAG);
    expect(sessionsSpent(scratch)).toBe(0);
    expect(existsSync(join(scratch.repo, '.rafa', 'plans'))).toBe(false);
  });

  describe('a named issue whose body changed after the spec was read', () => {
    /** Plans once over the original `## Design`, so its stamp is in the copy, then edits the issue. */
    function driftedScratch(config = ''): Scratch {
      const scratch = plantScratch(config);
      writeGh(scratch.bin, [specIssue('It follows #7 for context.'), namedIssue('One.')]);
      const first = runPlan(scratch);
      expect(first.exitCode).toBe(0);
      expect(sessionsSpent(scratch)).toBe(1);
      clearPlans(scratch);
      writeGh(scratch.bin, [specIssue('It follows #7 for context.'), namedIssue('Two.')]);
      return scratch;
    }

    it('refuses with `suspect #7: heading "Design" changed`, spending no second session', () => {
      const scratch = driftedScratch();

      const run = runPlan(scratch);

      expect(run.exitCode).toBe(BOARD_REFUSAL_EXIT);
      expect(run.output).toContain('suspect #7: heading "Design" changed');
      expect(sessionsSpent(scratch)).toBe(1);
      expect(existsSync(join(scratch.repo, '.rafa', 'plans'))).toBe(false);
    });

    it('plans on the same run under --accept-refs and leaves the new stamps in the copy', () => {
      const scratch = driftedScratch();
      const stale = readRefsBlock(copyOf(scratch)).stamps;

      const run = runPlan(scratch, ACCEPT_REFS_FLAG);

      expect(run.exitCode).toBe(0);
      expect(sessionsSpent(scratch)).toBe(2);
      const stamped = readRefsBlock(copyOf(scratch)).stamps;
      expect(stamped).not.toEqual(stale);
      expect(JSON.stringify(stamped)).toContain('#7');

      // The stamps now describe the edited issue: the same board reads clean without the flag.
      clearPlans(scratch);
      const again = runPlan(scratch);
      expect(again.exitCode).toBe(0);
      expect(again.output).not.toContain('suspect');
    });

    it('prints the pass and plans under dangerous.acceptStaleRefs: true, without the flag', () => {
      const scratch = driftedScratch('dangerous:\n  acceptStaleRefs: true\n');

      const run = runPlan(scratch);

      expect(run.exitCode).toBe(0);
      expect(run.output).toContain(acceptStaleRefsPassLine());
      expect(sessionsSpent(scratch)).toBe(2);
    });
  });

  it('prints `resolved #7 — rafa issue unblock 20` for a blocker closed since the stamp, and plans', () => {
    const scratch = plantScratch();
    writeGh(scratch.bin, [specIssue('Blocked by: #7'), namedIssue('One.')]);
    expect(runPlan(scratch).exitCode).toBe(0);
    clearPlans(scratch);
    writeGh(scratch.bin, [specIssue('Blocked by: #7'), namedIssue('One.', 'CLOSED')]);

    const run = runPlan(scratch);

    expect(run.exitCode).toBe(0);
    expect(run.output).toContain(`resolved #7 — rafa issue unblock ${String(SPEC_ISSUE)}`);
    expect(sessionsSpent(scratch)).toBe(2);
  });
});
