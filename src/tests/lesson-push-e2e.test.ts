/**
 * A finding with a `resolution`, from the stand-in session to a held
 * instinct: `rafa start` runs a one-task plan under a stand-in `claude`
 * whose report carries such a finding, and the project's
 * `.rafa/instincts/<id>.md` has to exist and pass `rafa instinct check`.
 *
 * Like `task-report.test.ts`, the command runs in a scratch repository
 * under a HOME of its own and a PATH holding stand-ins for `claude` and
 * `gh` and git's own directory, so no case reaches a real session.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantProjectConfig } from './cli-capture.js';

const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));
const STUB = 'lesson-loop';
const FENCE = '```';
const KILL_AFTER_MS = 45_000;

const REPORT = [
  'Done: the module is in.',
  '',
  `${FENCE}rafa:report`,
  'status: done',
  'feedback: |',
  '  Added the module.',
  'findings:',
  '  - trigger: "when the stand-in module is built"',
  '    kind: gotcha',
  '    what: "the build needs the generated file"',
  '    cause: "the generator is not part of the default build"',
  '    resolution: "run the generator before the build"',
  '    artifact: "generated file missing"',
  '    signal: loud',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  'changes: []',
  FENCE,
  '',
].join('\n');

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-lesson-e2e-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeScript(path: string, body: string): void {
  writeFileSync(path, body, 'utf8');
  chmodSync(path, 0o755);
}

/** Plants the scratch repository and the stand-ins; answers the run's pieces. */
function plant(): { repo: string; env: Record<string, string> } {
  const root = join(tempRoot, 'run');
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });

  const reportPath = join(root, 'report.md');
  writeFileSync(reportPath, REPORT, 'utf8');
  writeScript(join(bin, 'claude'), `#!/bin/sh\n/bin/cat > /dev/null\necho work > work.txt\n/bin/cat '${reportPath}'\n`);
  writeScript(join(bin, 'gh'), '#!/bin/sh\necho "gh stand-in: not logged in" >&2\nexit 1\n');

  git(repo, 'init', '-q', '.');
  git(repo, 'config', 'user.email', 'loop@example.test');
  git(repo, 'config', 'user.name', 'Rafa Loop');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', join(root, 'hooks'));
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, 'checkout', '-q', '-b', `feat/${STUB}`);
  plantProjectConfig(repo);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), `# Plan: ${STUB}\n\n- [ ] Add the module\n`, 'utf8');

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, gitBinary.slice(0, gitBinary.lastIndexOf('/'))].join(delimiter);
  for (const name of ['claude', 'gh']) {
    if (Bun.which(name, { PATH: path }) !== join(bin, name)) throw new Error(`${name} is not the stand-in`);
  }
  return { repo, env: { PATH: path, HOME: home } };
}

describe('a finding with a resolution, through rafa start', () => {
  it('holds an instinct record under .rafa/instincts that `rafa instinct check` accepts', () => {
    const { repo, env } = plant();

    const start = Bun.spawnSync(
      [process.execPath, RAFA_ENTRY, 'start', `--plan=.plans/PLAN-${STUB}.md`, '--no-ci-wait'],
      { cwd: repo, env, timeout: KILL_AFTER_MS },
    );
    const startOutput = `${start.stdout.toString()}${start.stderr.toString()}`;
    expect(start.exitCode, startOutput).toBe(0);

    const dir = join(repo, '.rafa', 'instincts');
    expect(existsSync(dir), startOutput).toBe(true);
    const records = readdirSync(dir).filter((name) => name.endsWith('.md'));
    expect(records).toHaveLength(1);
    const text = readFileSync(join(dir, records[0] ?? ''), 'utf8');
    expect(text).toContain('run the generator before the build');

    const check = Bun.spawnSync([process.execPath, RAFA_ENTRY, 'instinct', 'check', dir], { cwd: repo, env });
    expect(check.exitCode, `${check.stdout.toString()}${check.stderr.toString()}`).toBe(0);
  }, 60_000);
});
