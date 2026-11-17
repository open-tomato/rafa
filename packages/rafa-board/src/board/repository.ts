/**
 * The board's own repository, `owner/name`, as any folder may read it:
 * one `gh repo view --json nameWithOwner` sent in the project's
 * directory. The `native` relationships adapter
 * (`./relations/native.ts`) is made with this name to tell a parent or
 * a blocker on the board's own repository from one on another, and the
 * board project's readers take its owner from it.
 *
 * This is the library half of `packages/rafa-board/src/commands/epic/move-native.ts`. The
 * command half holds what `rafa epic move` reads and says in `native`
 * mode (the epic an issue leaves, its sentences, and the relationships
 * its config names) and takes the read as an argument, which
 * `packages/rafa-board/src/commands/epic/move.ts` fills with {@link readBoardRepository}.
 * Nothing here imports a file under `src/commands/`.
 *
 * {@link readBoardRepositoryVisibility} reads the same name and the
 * repository's visibility in one
 * `gh repo view --json nameWithOwner,visibility`, for a caller that
 * needs both, such as the `--upstream=rafa` gate of `rafa issue`.
 *
 * Both READ: each sends its one `gh` call and writes nothing. Neither
 * keeps a cache of its own, so each call to one sends the `gh` call
 * again.
 */
import type { GhRunner } from '../adapters/tracker/github.js';

import { describeValue, isMapping } from '@open-tomato/rafa/core/config/sections';

/** A repository as `gh repo view` names it: `owner/name`, each part free of `/` and whitespace. */
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/u;

/** The command {@link readBoardRepository} sends, as a message names it. */
const REPO_VIEW = 'gh repo view --json nameWithOwner';

/** The command {@link readBoardRepositoryVisibility} sends, as a message names it. */
const REPO_VIEW_VISIBILITY = 'gh repo view --json nameWithOwner,visibility';

/** The visibilities `gh repo view --json visibility` answers. */
const VISIBILITIES = ['PUBLIC', 'PRIVATE', 'INTERNAL'] as const;

/**
 * A repository's visibility as `gh` names it, or `UNKNOWN` when its
 * answer held none of the three.
 */
export type RepositoryVisibility = typeof VISIBILITIES[number] | 'UNKNOWN';

/** The board's own repository and its visibility, read in one `gh` call. */
export interface BoardRepositoryVisibility {
  /** The repository, `owner/name`. */
  readonly repository: string;
  /** Its visibility, `UNKNOWN` when `gh` answered none `gh` names. */
  readonly visibility: RepositoryVisibility;
}

/**
 * Sends `gh repo view --json <fields>` and answers its parsed mapping
 * with a checked `nameWithOwner`. Rejects naming `command` when `gh`
 * fails or answers no `owner/name`.
 */
async function viewRepository(gh: GhRunner, fields: string, command: string): Promise<{ name: string; parsed: Readonly<Record<string, unknown>> }> {
  const result = await gh(['repo', 'view', '--json', fields]);
  if (!result.ok) throw new Error(`${command} failed: ${result.stderr.trim() || result.stdout.trim() || 'it wrote nothing'}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${command} wrote output that is not JSON: ${describeValue(result.stdout)}`);
  }
  const mapping = isMapping(parsed)
    ? parsed
    : {};
  const name = mapping['nameWithOwner'];
  if (typeof name !== 'string' || !REPOSITORY.test(name)) {
    throw new Error(`${command} answered nameWithOwner ${describeValue(name)}, expected owner/name`);
  }
  return { name, parsed: mapping };
}

/**
 * The board's own repository, `owner/name`, read with one
 * `gh repo view --json nameWithOwner`. Rejects naming the command when
 * `gh` fails or answers no `owner/name`.
 */
export async function readBoardRepository(gh: GhRunner): Promise<string> {
  const { name } = await viewRepository(gh, 'nameWithOwner', REPO_VIEW);
  return name;
}

/**
 * The board's own repository, `owner/name`, and its visibility, read
 * with one `gh repo view --json nameWithOwner,visibility`. Rejects
 * naming the command as {@link readBoardRepository} does when `gh`
 * fails or answers no `owner/name`; a visibility missing or not one of
 * `PUBLIC`, `PRIVATE` and `INTERNAL` answers `UNKNOWN` rather than
 * rejecting.
 */
export async function readBoardRepositoryVisibility(gh: GhRunner): Promise<BoardRepositoryVisibility> {
  const { name, parsed } = await viewRepository(gh, 'nameWithOwner,visibility', REPO_VIEW_VISIBILITY);
  const read = parsed['visibility'];
  const visibility = VISIBILITIES.find((known) => known === read) ?? 'UNKNOWN';
  return { repository: name, visibility };
}
