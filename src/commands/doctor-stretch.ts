/**
 * The stretch row of `rafa doctor` (#816): a warning when `pr.base`
 * names a `stretch/*` branch that no live stretch of this project holds.
 *
 * ```text
 * Stretch: pr.base stretch/4 is held by live stretch 4 (tmux session stretch-rafa-4 is open).
 * Stretch: pr.base names stretch/9, which no live stretch of this project holds: .rafa/stretch/9/agent.json is absent and tmux session stretch-rafa-9 is not open. Every pull request opens into stretch/9 until it is put back; run rafa stretch start --n=9 to resume that stretch, or rafa config set pr.base=<branch> to put the base back.
 * ```
 *
 * ## When it reads at all
 *
 * Only a `pr.base` opening with `stretch/` is read. A project whose
 * `pr.base` is unset or names any other branch gets no row and no
 * probe, so `doctor` reads as it did before this row for every project
 * that never ran a stretch.
 *
 * ## What holds a branch
 *
 * Stretch `<n>` holds `stretch/<n>` while it is live, as
 * `stretchLiveness` (`src/stretch/folder.ts`) reads it: its
 * `agent.json` reads `state: running` with a live `pid`, or its tmux
 * session `stretch-<project>-<n>` is open. A `stretch/` branch whose
 * rest is no whole number from 1 (`stretchOfBase`,
 * `./stretch/item.ts`) is no stretch's branch, so nothing can hold it
 * and nothing is probed for it.
 *
 * A branch no live stretch holds is still a valid base: one person
 * batching fixes with `rafa stretch item` and no operators runs exactly
 * so. The row warns because the base outlives the stretch that set it,
 * and a `pr.base` left on a finished stretch sends every later pull
 * request into a branch nobody merges.
 *
 * ## What it prints
 *
 * A held branch is one `info` line in text mode and nothing in json
 * mode. An unheld branch, or a reading that threw (a project root that
 * leaves no tmux project name), is one warning in both modes, a `log`
 * event in json mode. Nothing here changes `doctor`'s exit code,
 * nothing is written, and {@link readDoctorStretch} never throws.
 *
 * The filesystem, the pid probe and the tmux probe are
 * `StretchFolderSeams`; left out, the system's own, so
 * `src/commands/doctor.ts` wires the row with its one call.
 */
import type { RafaContext } from '../cli/command.js';
import type { AgentReading, StretchFolderSeams, StretchLiveness } from '../stretch/folder.js';

import { relative } from 'node:path';

import { messageOf } from '../config-sections.js';
import { defaultSeams, projectName, stretchLiveness, tmuxSessionName } from '../stretch/folder.js';

import { stretchOfBase } from './stretch/item.js';
import { PR_BASE_KEY, STRETCH_BRANCH_PREFIX } from './stretch/start.js';

/** What every line of the row opens with. */
export const STRETCH_ROW_HEAD = 'Stretch:';

/** `pr.base` names no `stretch/*` branch, or none at all: no row. */
export interface StretchRowNone {
  readonly kind: 'none';
}

/** `pr.base` names `stretch/<n>` and stretch `<n>` is live. */
export interface StretchRowHeld {
  readonly kind: 'held';
  readonly base: string;
  readonly liveness: StretchLiveness;
}

/** `pr.base` names a `stretch/*` branch no live stretch holds. */
export interface StretchRowUnheld {
  readonly kind: 'unheld';
  readonly base: string;
  /** The stretch's reading, or null for a branch that names no stretch number. */
  readonly liveness: StretchLiveness | null;
}

/** The liveness of the stretch `pr.base` names could not be read. */
export interface StretchRowUnread {
  readonly kind: 'unread';
  readonly base: string;
  readonly problem: string;
}

/** What {@link readDoctorStretch} found. */
export type DoctorStretchReading = StretchRowNone | StretchRowHeld | StretchRowUnheld | StretchRowUnread;

/** Reads the row for `prBase` at `root`; see the module note. Never throws. */
export function readDoctorStretch(
  root: string,
  prBase: string | null,
  seams: StretchFolderSeams = defaultSeams(),
): DoctorStretchReading {
  if (prBase === null || !prBase.startsWith(STRETCH_BRANCH_PREFIX)) return { kind: 'none' };
  const n = stretchOfBase(prBase);
  if (n === null) return { kind: 'unheld', base: prBase, liveness: null };
  try {
    const liveness = stretchLiveness(root, n, seams);
    return liveness.live
      ? { kind: 'held', base: prBase, liveness }
      : { kind: 'unheld', base: prBase, liveness };
  } catch (error) {
    return { kind: 'unread', base: prBase, problem: messageOf(error) };
  }
}

/** Why the engineer's record does not hold the stretch, the file named from `root`. */
function agentClause(root: string, agent: AgentReading): string {
  const file = relative(root, agent.file);
  if (agent.kind === 'absent') return `${file} is absent`;
  if (agent.kind === 'malformed') return `${file} ${agent.reason}`;
  const { pid, state } = agent.agent;
  if (state !== 'running') {
    return state === null
      ? `${file} names no state`
      : `${file} reads state ${JSON.stringify(state)}`;
  }
  return pid === null
    ? `${file} names no pid`
    : `${file}'s pid ${String(pid)} is not alive`;
}

/** What holds a live stretch, as the held line names it. */
function heldClause(root: string, liveness: StretchLiveness): string {
  const session = `tmux session ${tmuxSessionName(projectName(root), liveness.n)}`;
  if (liveness.tmuxOpen) return `${session} is open`;
  const pid = liveness.agent.kind === 'read'
    ? liveness.agent.agent.pid
    : null;
  return `the engineer's pid ${String(pid)} is alive`;
}

/** What to run about an unheld base. */
function remedy(base: string, n: number | null): string {
  const resume = n === null
    ? `a stretch's branch is ${STRETCH_BRANCH_PREFIX}<n>, <n> a whole number from 1; run`
    : `run rafa stretch start --n=${String(n)} to resume that stretch, or`;
  return `Every pull request opens into ${base} until it is put back; ${resume}`
    + ` rafa config set ${PR_BASE_KEY}=<branch> to put the base back.`;
}

/** The warning for a base no live stretch holds. */
function unheldLine(root: string, reading: StretchRowUnheld): string {
  const head = `${STRETCH_ROW_HEAD} ${PR_BASE_KEY} names ${reading.base}, which no live stretch of this project holds`;
  const { liveness } = reading;
  if (liveness === null) return `${head}. ${remedy(reading.base, null)}`;
  const session = tmuxSessionName(projectName(root), liveness.n);
  const why = `${agentClause(root, liveness.agent)} and tmux session ${session} is not open`;
  return `${head}: ${why}. ${remedy(reading.base, liveness.n)}`;
}

/**
 * The row's one line, and whether it is a warning; null for no row.
 * Never throws: a reading that read cannot fail to render.
 */
export function stretchRow(root: string, reading: DoctorStretchReading): { readonly warn: boolean; readonly line: string } | null {
  switch (reading.kind) {
    case 'none':
      return null;
    case 'held':
      return {
        warn: false,
        line: `${STRETCH_ROW_HEAD} ${PR_BASE_KEY} ${reading.base} is held by live stretch ${String(reading.liveness.n)}`
          + ` (${heldClause(root, reading.liveness)}).`,
      };
    case 'unheld':
      return { warn: true, line: unheldLine(root, reading) };
    case 'unread':
      return {
        warn: true,
        line: `${STRETCH_ROW_HEAD} ${PR_BASE_KEY} names ${reading.base}, and whether a live stretch holds it could`
          + ` not be read: ${reading.problem}`,
      };
  }
}

/**
 * Reads the row and writes it: a warning in both modes, a held line at
 * `info` in text mode alone, and nothing for a `pr.base` naming no
 * `stretch/*` branch.
 */
export function writeDoctorStretch(
  context: Pick<RafaContext, 'output' | 'outputMode'>,
  root: string,
  prBase: string | null,
  seams?: StretchFolderSeams,
): DoctorStretchReading {
  const reading = readDoctorStretch(root, prBase, seams);
  const row = stretchRow(root, reading);
  if (row === null) return reading;
  if (row.warn) context.output.warn(row.line);
  else if (context.outputMode !== 'json') context.output.info(row.line);
  return reading;
}
