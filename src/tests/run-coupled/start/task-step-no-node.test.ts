/**
 * The loop's task step (`afterTask` of `start/suite-steps-run.ts`, over
 * `suite-step.ts`'s own `runTaskStep`) driven with a real `tsc` spawned
 * under a PATH with no node (#1033).
 *
 * The test run, git and lint are scripted; the type step spawns the
 * checkout's `node_modules/.bin/tsc` for real through `/usr/bin/env`
 * with a PATH of its own, so the shebang finds no node and the spawn
 * exits 127. The step then holds the run (`afterTask` answers false),
 * its blocker names `tsc`, `node` and the PATH, and the tracker gets no
 * repair line: no repair of the task's files puts node on the PATH. The
 * control is the same step under the runner's own PATH, which goes on.
 */
import type { SuiteResult } from '@open-tomato/rafa/suite/run';
import type { GitResult, GitRunner } from '@open-tomato/rafa-pr/pr/index';
import type { TypeRunOptions, TypeRunResult } from '@open-tomato/rafa-run/start/type-step';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { findNextTask } from '@open-tomato/rafa/utils/tracker';
import { createRunSuiteSteps } from '@open-tomato/rafa-run/start/suite-steps-run';
import { runTsc } from '@open-tomato/rafa-run/start/type-step';

import { baselineOf, baselinePathFor, writeBaseline } from '../../../../packages/rafa-run/src/suite/baseline.js';
import { realNodeModules } from '../../real-node-modules.js';

const BASE = 'base0000';
const HEAD = 'head1111';
const ENV = '/usr/bin/env';
const SYSTEM_DIRS: readonly string[] = ['/usr/bin', '/bin'];
const TEST_TIMEOUT = 30_000;

const TRACKER = [
  '# Plan: fixture',
  '',
  '# Stage: One',
  '',
  '- [x] second task',
  '- [ ] third task',
  '',
].join('\n');

let dir: string;
let trackerPath: string;
let lines: { level: string; message: string }[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'task-step-no-node-'));
  mkdirSync(join(dir, '.rafa', 'plans'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  trackerPath = join(dir, '.rafa', 'plans', 'PLAN_TRACKER-fixture.md');
  writeFileSync(trackerPath, TRACKER, 'utf8');
  writeFileSync(join(dir, 'tsconfig.json'), '{"compilerOptions":{"strict":true,"target":"ES2022","types":[]}}\n', 'utf8');
  writeFileSync(join(dir, 'src', 'a.test.ts'), 'export const a: number = 1;\n', 'utf8');
  symlinkSync(realNodeModules(), join(dir, 'node_modules'));
  const green = suiteResult();
  writeBaseline(baselinePathFor(trackerPath), baselineOf(green, new Date('2026-10-01T00:00:00Z'), BASE));
  lines = [];
  setActiveOutput(sinkOutput({
    info: (message) => lines.push({ level: 'info', message }),
    warn: (message) => lines.push({ level: 'warn', message }),
    error: (message) => lines.push({ level: 'error', message }),
  }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(dir, { recursive: true, force: true });
});

/** A green `bun test` result. */
function suiteResult(): SuiteResult {
  return { command: ['bun', 'test'], exitCode: 0, summary: 'Ran 1 test across 1 file. [1.00ms]', failures: [], errors: 0, junit: 'read', unhandled: [], outputTail: [] };
}

/** A git at {@link HEAD} whose diff from {@link BASE} is one source file and one added test file. */
function gitAtHead(): GitRunner {
  const answers: Record<string, GitResult> = {
    'rev-parse --verify HEAD^{commit}': { ok: true, stdout: `${HEAD}\n`, stderr: '' },
    [`diff --name-only -z --no-renames --diff-filter=d ${BASE} HEAD`]: { ok: true, stdout: 'src/a.test.ts\0', stderr: '' },
    [`diff --name-only -z --no-renames ${BASE} HEAD`]: { ok: true, stdout: 'src/a.test.ts\0', stderr: '' },
    [`diff --name-status -z --find-renames --diff-filter=d ${BASE} HEAD`]: { ok: true, stdout: 'A\0src/a.test.ts\0', stderr: '' },
    [`diff --name-only -z --no-renames ${HEAD} HEAD`]: { ok: true, stdout: '', stderr: '' },
  };
  return (args) => answers[args.join(' ')] ?? { ok: false, stdout: '', stderr: `unscripted: ${args.join(' ')}` };
}

/** A PATH with no node: a directory holding a link to the running bun, plus the system directories when no node sits in them. */
function pathWithNoNode(bin: string): string {
  symlinkSync(process.execPath, join(bin, 'bun'));
  const system = SYSTEM_DIRS.join(':');
  return Bun.which('node', { PATH: system }) === null
    ? `${bin}:${system}`
    : bin;
}

/** The loop's steps over the temporary checkout, its tsc spawned for real under `path`. */
function stepsUnder(path: string): ReturnType<typeof createRunSuiteSteps> {
  const runTypes = (options: TypeRunOptions): Promise<TypeRunResult> => runTsc({ ...options, argv: [ENV, `PATH=${path}`, ...options.argv] });
  return createRunSuiteSteps({
    repoRoot: dir,
    checkout: dir,
    trackerPath,
    sessionId: 'session-1',
    settings: { testsFullSuiteTriggers: [], testsIntegration: [], testsAlwaysRun: [], testsRetakeRedAlone: false, testsContract: [], checksTask: ['affected'], checksStage: [], checksLoop: [] },
    planContent: TRACKER,
    gh: () => Promise.reject(new Error('gh is not read by these cases')),
    seams: {
      runSuite: () => Promise.resolve(suiteResult()),
      appendStep: () => {},
      git: gitAtHead(),
      listTestFiles: () => ['src/a.test.ts'],
      readPreloadFiles: () => ({ state: 'read', files: [] }),
      now: () => new Date('2026-10-01T00:00:00Z'),
      runLint: () => Promise.resolve({ exitCode: 0, stdout: '[]', stderr: '' }),
      runTypes,
    },
  });
}

describe('the task step under a PATH with no node', () => {
  it('holds the run on a blocker naming node and writes no repair line, and the same step under the runner\'s PATH goes on', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'task-step-no-node-bin-'));
    try {
      const path = pathWithNoNode(bin);
      expect(Bun.which('node', { PATH: path })).toBeNull();
      const task = { task: 'second task', lineNum: 4, status: 'unchecked' } as const;

      const held = await stepsUnder(path).afterTask(task, BASE);
      expect(held).toBe(false);
      const blocker = lines.filter((line) => line.level === 'error' || line.level === 'warn').map((line) => line.message)
        .join('\n');
      expect(blocker).toContain('could not start tsc');
      expect(blocker).toContain('node');
      expect(blocker).toContain('put node on the PATH the loop runs under');
      const tracker = readFileSync(trackerPath, 'utf8');
      expect(tracker).toBe(TRACKER);
      expect(tracker).not.toContain('Repair');
      expect(tracker).not.toContain('[BLOCKED]');
      expect(findNextTask(tracker)?.status).toBe('unchecked');

      // Control: the same step, its tsc finding node, goes on.
      lines.length = 0;
      expect(await stepsUnder(process.env.PATH ?? '').afterTask(task, BASE)).toBe(true);
      expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT);
});
