/**
 * What the tests of the `loop` actions reading session records plant
 * (`src/commands/loop/`): a project of a case's own holding a plan and its
 * tracker, session records written as `loop start` writes them, and the
 * seams each command is made with, so no case runs git or probes a real
 * pid.
 *
 * The demo plan holds four tasks, at lines 5 to 8. Its tracker ticks the
 * first, blocks the second and leaves the last two open, so a count read
 * from the plan (0 of 4 done) differs from one read from the tracker
 * (1 of 4 done, 1 blocked, 2 open).
 */
import type { PlantedProject } from './cli-capture.js';
import type { SubjectSpec } from '../cli/registry.js';
import type { LoopSessionSeams } from '../commands/loop/loop-sessions.js';
import type { SessionRecord } from '../loop/sessions.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { runsDir, sessionFilePath } from '../loop/sessions.js';

import { eventsOf, plantProject } from './cli-capture.js';

/** The one subject a dispatched `loop` case routes under. */
export const LOOP_SUBJECTS: readonly SubjectSpec[] = Object.freeze([{ name: 'loop', summary: 'the loop' }]);

/** The branch every planted project reads as checked out. */
export const BRANCH = 'feat/demo';

/** The id of the session most cases plant. */
export const SESSION_ID = 'session-0500';

/** When that session started. */
export const STARTED_AT = '2026-09-15T12:00:00.000Z';

/** The pid its record names. */
export const PID = 7171;

/** The plan every planted project holds under `.plans/`. */
export const DEMO_PLAN = [
  '# Plan: demo',
  '',
  '# Stage: one',
  '',
  '- [ ] First task',
  '- [ ] Second task  {effort=low}',
  '- [ ] Third task',
  '- [ ] Fourth task',
  '',
].join('\n');

/** Its tracker: the first task ticked, the second blocked, the rest open. */
export const DEMO_TRACKER = DEMO_PLAN
  .replace('- [ ] First task', '- [x] First task')
  .replace('- [ ] Second task', '- [BLOCKED] Second task');

/** Where the demo plan sits, relative to the project root. */
export const DEMO_PLAN_PATH = '.plans/PLAN-demo.md';

/** Where its tracker sits, relative to the project root. */
export const DEMO_TRACKER_PATH = '.plans/PLAN_TRACKER-demo.md';

/** A record of the demo plan on {@link BRANCH}, running its second task, with `overrides` laid over it. */
export function sessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: SESSION_ID,
    planStub: 'demo',
    plan: DEMO_PLAN_PATH,
    branch: BRANCH,
    pid: PID,
    startedAt: STARTED_AT,
    state: 'running',
    task: { line: 6, text: 'Second task' },
    ...overrides,
  };
}

/** Writes `text` at `path` under `root`, making its directory, and answers the file. */
export function plantFile(root: string, path: string, text: string): string {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return file;
}

/** Writes a record under `root` as `loop start` writes one, and answers its path. */
export function plantSession(root: string, record: SessionRecord): string {
  mkdirSync(runsDir(root), { recursive: true });
  const file = sessionFilePath(root, record.sessionId);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
}

/** The record of `sessionId` under `root`, as its file stores it. */
export function storedSession(root: string, sessionId: string = SESSION_ID): SessionRecord {
  return JSON.parse(readFileSync(sessionFilePath(root, sessionId), 'utf8')) as SessionRecord;
}

/** A project under a fresh directory of `base`, holding the demo plan and its tracker. */
export function plantDemoProject(base: string): PlantedProject {
  const project = plantProject(realpathSync(mkdtempSync(join(base, 'case-'))));
  plantFile(project.root, DEMO_PLAN_PATH, DEMO_PLAN);
  plantFile(project.root, DEMO_TRACKER_PATH, DEMO_TRACKER);
  return project;
}

/** Seams reading {@link BRANCH} at every root and every pid alive, with `overrides` laid over them. */
export function loopSeams(overrides: LoopSessionSeams = {}): LoopSessionSeams {
  return { readBranch: () => BRANCH, isAlive: () => true, ...overrides };
}

/** The last event of a json-mode stdout, which a command that answered ends with. Throws when it is no result. */
export function resultEvent(stdout: string): { readonly ok: boolean; readonly data?: unknown } {
  const last = eventsOf(stdout).at(-1);
  if (last?.type !== 'result') throw new Error(`stdout ends with no result event: ${stdout}`);
  return last;
}
