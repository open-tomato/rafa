/**
 * The board's relationships `rafa next` and a command's closing hint
 * (`./hint.ts`) read the board in, as `board.relationships` names them.
 *
 * {@link openNextRelations} is asked once, before the first turn, and
 * what it answers is handed to `openNextSources` (`./sources.ts`) as
 * `relations`, so every board the chain opens reads its epics and
 * blockers through the one adapter, as `src/commands/pr/merge-freed.ts`
 * reads what a merge freed.
 *
 * ## `labels`, the default, reads nothing
 *
 * In the `labels` mode it answers undefined, having opened no `gh` and
 * sent nothing: `openNextSources` then builds each board with no
 * relations, which is how the board read before the port, so the output
 * and the `gh` calls stay what `src/tests/relations-labels-baseline.test.ts`
 * captured.
 *
 * ## `native` reads the repository once
 *
 * The `native` adapter tells a blocker on this board from one on another,
 * so it is made with the board's `owner/name`, read with the one
 * `gh repo view --json nameWithOwner` `readBoardRepository` sends
 * (`src/board/repository.ts`). A repository `gh` will not name
 * throws, and `rafa next` fails with it before any turn; a hint swallows
 * it as it swallows every reading that failed.
 *
 * ## What it leaves to `openNextSources`
 *
 * A project that is none, a config that cannot be used and a `pr.provider`
 * that is not `gh` each answer undefined here, having sent nothing, so
 * `openNextSources` raises its own refusal for them, worded and coded as
 * before. The config is read with its warnings silenced for the same
 * reason: `openNextSources` reads it again and warns once.
 */
import type { NextSourceSeams } from './sources.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { EpicRelations } from '../board/epics.js';
import type { RafaContext } from '../cli/command.js';
import type { RafaConfig } from '../config.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { selectBoardRelations } from '../board/relations/select.js';
import { readBoardRepository } from '../board/repository.js';
import { loadConfig } from '../config-load.js';
import { ConfigError } from '../config.js';
import { resolvePrProvider } from '../pr/index.js';

/** The settings the mode is read from, or null where `openNextSources` refuses the config. */
function modeConfig(root: string, home: string): RafaConfig | null {
  try {
    return loadConfig({ root, home }, {}, () => undefined).config;
  } catch (error) {
    if (error instanceof ConfigError) return null;
    throw error;
  }
}

/**
 * The relations `board.relationships` names for the project `context`
 * holds: undefined, having sent nothing, in `labels` mode and wherever
 * `openNextSources` refuses; the `native` adapter over the board's
 * repository otherwise. See the module note.
 */
export async function openNextRelations(
  context: RafaContext,
  seams: NextSourceSeams,
): Promise<EpicRelations | undefined> {
  const { project } = context;
  if (project === null) return undefined;
  const config = modeConfig(project.root, project.home);
  if (config?.boardRelationships !== 'native') return undefined;
  const provider = resolvePrProvider({ configured: config.prProvider, dir: project.root, readRemote: seams.readRemote });
  if (provider.provider !== 'gh') return undefined;

  const gh = (seams.openGh ?? ((root: string): GhRunner => createGhRunner({ cwd: root })))(project.root);
  const repository = await readBoardRepository(gh);
  return selectBoardRelations(config, { gh, repository });
}
