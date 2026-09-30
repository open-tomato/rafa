/**
 * The board's relationships a command reads its listing in, as
 * `board.relationships` names them, for a command that has already
 * loaded its config and made its `gh` runner: `rafa roadmap` and
 * `rafa issue list --roadmap` (`src/commands/issue/list.ts`),
 * `rafa switch` (`src/commands/switch.ts`) and `plan create --next`
 * (`./plan-spec.ts`).
 *
 * ## `labels`, the default, reads nothing
 *
 * {@link readConfiguredRelations} answers undefined in the `labels`
 * mode, having sent nothing. Each caller then reads its board with no
 * relations, which is how it read the board before the port, so its
 * output and its `gh` calls stay what
 * `src/tests/relations-labels-baseline.test.ts` captured.
 *
 * ## `native` reads the repository once
 *
 * The `native` adapter tells a blocker or a parent on this board from
 * one on another, so it is made with the board's `owner/name`, read with
 * the one `gh repo view --json nameWithOwner` `readBoardRepository`
 * sends (`src/commands/epic/move-native.ts`), through `selectBoardRelations`
 * (`./relations/select.ts`). A repository `gh` will not name rejects with
 * that function's message; each caller words the refusal as its own
 * reading of the board would.
 *
 * `rafa next` and a command's closing hint load the config themselves and
 * read it in `src/next/relations-mode.ts`, which answers the same
 * adapter.
 */
import type { EpicRelations } from './epics.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { RafaConfig } from '../config.js';

import { readBoardRepository } from '../commands/epic/move-native.js';

import { selectBoardRelations } from './relations/select.js';

/**
 * The relations `config.boardRelationships` names, read through `gh`:
 * undefined, having sent nothing, in `labels` mode; the `native` adapter
 * over the board's repository otherwise. See the module note.
 */
export async function readConfiguredRelations(
  config: Pick<RafaConfig, 'boardRelationships'>,
  gh: GhRunner,
): Promise<EpicRelations | undefined> {
  if (config.boardRelationships !== 'native') return undefined;
  const repository = await readBoardRepository(gh);
  return selectBoardRelations(config, { gh, repository });
}
