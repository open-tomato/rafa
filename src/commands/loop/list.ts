/**
 * `rafa loop list`: the sessions running in the project.
 *
 * ## What is listed
 *
 * Every record under `.rafa/runs/` reading `running` or `paused`, oldest
 * first (`loop/sessions.ts`), with the tasks of its plan counted as
 * `rafa loop status` counts them (`loop/session-readings.ts`), the phase
 * its run is in beside the tasks done over total, `task` for a record
 * from a rafa older than the field. A record whose pid
 * is gone reads `stopped` and is not listed, nor is one that reads `done`.
 * No branch is read: the list is the project's, whatever is checked out.
 *
 * Until phase 6 a plan runs in one session at a time, so a row is a plan
 * running; `rafa loop status` gives one of them in full.
 *
 * ## What it writes
 *
 * In json mode the terminal result's `data` holds `sessions`, each its
 * `session` record, its `phase` as it reads, and its `tasks` counts, or null when neither its plan
 * nor its tracker is there. Text mode writes `Running sessions:` and one
 * row per session, or `No running sessions.` alone.
 *
 * A row's last column is where the session runs: `in worktree <path>`
 * for a record carrying a `worktree` (`loop/sessions.ts`), the path
 * relative to the project root when the worktree sits under it, as the
 * default `loop.worktreeDir` of `.rafa/worktrees` does, and absolute
 * otherwise; `in the main checkout` for a record carrying none. In json
 * mode the record's own `worktree` key, absolute, is the column.
 *
 * ## Refusals
 *
 * Exit code 1 for an argument, and for records that cannot be read. The
 * command declares no flag.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { LoopSessionSeams, ResolvedLoopSeams } from '../../loop/session-readings.js';
import type { SessionPhase, SessionRecord } from '../../loop/sessions.js';
import type { TaskCounts } from '../../plan/plan-files.js';

import { isAbsolute, relative } from 'node:path';

import {
  isLive,
  readRecords,
  readSessionChecklist,
  resolveLoopSeams,
  sessionLine,
} from '../../loop/session-readings.js';
import { sessionPhase } from '../../loop/sessions.js';
import { countTasks } from '../../plan/plan-files.js';
import { expectNoArgument } from '../plan/plan-files.js';

import {
  phasedCounts,
  phaseNote,
  projectRoot,
} from './loop-sessions.js';

/** The usage line a refusal names. */
const USAGE = 'rafa loop list';

/** One running session, as the list holds it. */
export interface SessionListing {
  readonly session: SessionRecord;
  /** The phase the session reads as: its record's, or `task` when the record carries none. */
  readonly phase: SessionPhase;
  readonly tasks: TaskCounts | null;
}

/** The running sessions of a project. */
export interface SessionList {
  readonly sessions: readonly SessionListing[];
}

/** A worktree's path as a row names it: relative to `root` when under it, absolute otherwise. */
function worktreeLabel(root: string, worktree: string): string {
  const under = relative(root, worktree);
  return under === '' || under.startsWith('..') || isAbsolute(under)
    ? worktree
    : under;
}

/** Where a session runs, as a row's last column. See the module note. */
export function checkoutColumn(root: string, session: SessionRecord): string {
  return session.worktree === undefined
    ? 'in the main checkout'
    : `in worktree \`${worktreeLabel(root, session.worktree)}\``;
}

/** The lines text mode writes for the list of the project at `root`. */
export function renderSessionList(root: string, list: SessionList): string[] {
  if (list.sessions.length === 0) return ['No running sessions.'];
  return [
    'Running sessions:',
    ...list.sessions.map(({ session, tasks }) => {
      const counts = tasks === null
        ? `no plan or tracker to count ${phaseNote(session)}`
        : phasedCounts(tasks, session);
      return `  ${sessionLine(session)}; ${counts}; ${checkoutColumn(root, session)}`;
    }),
  ];
}

/** Lists the running sessions. See the module note. */
async function runList(context: RafaContext, seams: ResolvedLoopSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const root = projectRoot(context);
  const sessions = readRecords(root, seams)
    .filter(isLive)
    .map((session): SessionListing => {
      const checklist = readSessionChecklist(root, session);
      return {
        session,
        phase: sessionPhase(session),
        tasks: checklist === null
          ? null
          : countTasks(checklist.tasks),
      };
    });

  const list: SessionList = { sessions };
  if (context.outputMode === 'json') {
    context.output.result(list);
    return;
  }
  for (const line of renderSessionList(root, list)) context.output.info(line);
}

/** The command, reaching the system through `seams`. See the module note. */
export function createLoopListCommand(seams: LoopSessionSeams = {}): RafaCommand {
  const resolved = resolveLoopSeams(seams);
  const command: RafaCommand = {
    name: 'loop list',
    subject: 'loop',
    action: 'list',
    summary: 'list the running sessions, with the tasks done in each plan',
    description: 'Lists every session record under `.rafa/runs/` that reads `running` or `paused`, oldest'
      + ' first: its id, plan, branch, state, pid and start, the tasks of its plan done, blocked and'
      + ' open with the phase its run is in beside them, and the worktree it runs in, or the main checkout. A record whose pid is gone reads `stopped` and is not listed. Until phase 6 a plan runs in'
      + ' one session at a time, so each row is a plan running. With `--output=json` the sessions are the'
      + ' data of the terminal result event.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa loop list',
        note: 'Prints one row per running session: its id, plan, branch, state, tasks done and worktree.',
      },
      {
        cmd: 'rafa loop list --output=json',
        note: 'Writes a start event, then a result event whose data is the sessions.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runList(context, resolved),
  };
  return Object.freeze(command);
}

export default createLoopListCommand();
