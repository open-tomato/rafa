/**
 * The since-last-command notice as the dispatcher's command hook
 * (`CommandHook`, `src/cli/dispatch.ts`): `before` compares the snapshot
 * the last command left with a fresh reading and answers the one stderr
 * line, and `after` writes a fresh reading as the next command's
 * snapshot. `src/rafa.ts` hands {@link createStatusHook}'s hook to the
 * dispatcher, which calls it only around a command that runs inside a
 * project in text mode, so nothing here reads the output mode or tells
 * help from a command.
 *
 * ## Each half
 *
 * Both halves read the project's config first, through `loadConfig` with
 * its warnings dropped, since the command that runs prints its own. With
 * `status.notice` false, neither reads anything more: no line, and no
 * snapshot written, so the file the last command left stays as it was.
 *
 * - **`before`** answers null for the `status` and `cleanup` commands
 *   ({@link QUIET_COMMANDS}), which read no snapshot, since the one names
 *   what the line would and the other acts on it. Every other command
 *   takes the reading (`takeSeenSnapshot`, `./seen.ts`) and answers
 *   `noticeLine` (`./notice.ts`) against the file, which is null for a
 *   first run and when nothing is new. It writes nothing.
 * - **`after`** takes the reading once the command has ended, the quiet
 *   commands included, and writes it over the file (`writeSeenFile`), so
 *   what the command itself did, a worktree `rafa cleanup` removed or a
 *   loop that ran in the foreground and stopped, is never told as news
 *   by the next one.
 *
 * ## When a half fails
 *
 * A reading that answers `{ ok: false }` is thrown as an error carrying
 * its detail, and so is a config `loadConfig` refuses and a file that
 * cannot be written. The dispatcher swallows each into a `debug` line,
 * so none of them prints at the default verbosity, and none changes the
 * command's exit code. A failed `before` prints no line; a failed `after`
 * leaves the file the last command wrote.
 *
 * ## Local only
 *
 * The reading is `seen.ts`'s, which runs git at the project root with no
 * fetch and builds no `gh` runner and no pull request provider, so
 * neither half waits on the network.
 */
import type { SeenConfig, SeenInput, SeenReading, SeenSnapshot } from './seen.js';
import type { CommandHook } from '../cli/dispatch.js';
import type { CommandRoute } from '../cli/route.js';
import type { RafaConfig } from '../config.js';
import type { ProjectFound } from '../project/scope.js';

import { loadConfig } from '../config-load.js';

import { noticeLine } from './notice.js';
import { readSeenFile, takeSeenSnapshot, writeSeenFile } from './seen.js';

/** The core commands `before` answers no line for; see the module note. */
export const QUIET_COMMANDS: readonly string[] = Object.freeze(['status', 'cleanup']);

/** What the hook reads of the config. */
export type StatusHookConfig = SeenConfig & Pick<RafaConfig, 'statusNotice'>;

/** How the hook reaches the system; each left out is the system's own. */
export interface StatusHookSeams {
  /** The config resolved for `project`. `loadConfig` with its warnings dropped when left out. */
  readonly config?: (project: ProjectFound) => StatusHookConfig;
  /** Takes the reading. `takeSeenSnapshot` with its own seams when left out. */
  readonly take?: (input: SeenInput) => Promise<SeenReading>;
}

/** The config `loadConfig` resolves for `project`, its warnings dropped. Throws on one it refuses. */
function projectConfig(project: ProjectFound): StatusHookConfig {
  return loadConfig({ root: project.root, home: project.home }, {}, () => undefined).config;
}

/** True for a core command `before` answers no line for. */
export function isQuietCommand(route: CommandRoute): boolean {
  return route.module === null && QUIET_COMMANDS.includes(route.command.name);
}

/** The hook, reading through `seams`; see the module note. */
export function createStatusHook(seams: StatusHookSeams = {}): CommandHook {
  const configOf = seams.config ?? projectConfig;
  const take = seams.take ?? (async (input: SeenInput): Promise<SeenReading> => takeSeenSnapshot(input));

  /** The fresh reading's snapshot, or null with `status.notice` false. Throws on a failed reading. */
  const snapshot = async (project: ProjectFound): Promise<SeenSnapshot | null> => {
    const config = configOf(project);
    if (!config.statusNotice) return null;
    const reading = await take({ root: project.root, home: project.home, config });
    if (!reading.ok) throw new Error(`the status reading failed: ${reading.detail}`);
    return reading.snapshot;
  };

  return Object.freeze({
    before: async (route: CommandRoute, project: ProjectFound): Promise<string | null> => {
      if (isQuietCommand(route)) return null;
      const current = await snapshot(project);
      return current === null
        ? null
        : noticeLine(readSeenFile(project.root), current);
    },
    after: async (_route: CommandRoute, project: ProjectFound): Promise<void> => {
      const current = await snapshot(project);
      if (current !== null) writeSeenFile(project.root, current);
    },
  });
}
