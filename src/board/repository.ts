/**
 * The board's own repository, `owner/name`, as any folder may read it:
 * one `gh repo view --json nameWithOwner` sent in the project's
 * directory. The `native` relationships adapter
 * (`./relations/native.ts`) is made with this name to tell a parent or
 * a blocker on the board's own repository from one on another, and the
 * board project's readers take its owner from it.
 *
 * This is the library half of `src/commands/epic/move-native.ts`. The
 * command half holds what `rafa epic move` reads and says in `native`
 * mode (the epic an issue leaves, its sentences, and the relationships
 * its config names) and takes the read as an argument, which
 * `src/commands/epic/move.ts` fills with {@link readBoardRepository}.
 * Nothing here imports a file under `src/commands/`.
 *
 * {@link readBoardRepository} READS: it sends the one `gh` call and
 * writes nothing. It keeps no cache of its own, so each call to it
 * sends the `gh` call again.
 */
import type { GhRunner } from '../adapters/tracker/github.js';

import { describeValue, isMapping } from '../config-sections.js';

/** A repository as `gh repo view` names it: `owner/name`, each part free of `/` and whitespace. */
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/u;

/** The command {@link readBoardRepository} sends, as a message names it. */
const REPO_VIEW = 'gh repo view --json nameWithOwner';

/**
 * The board's own repository, `owner/name`, read with one
 * `gh repo view --json nameWithOwner`. Rejects naming the command when
 * `gh` fails or answers no `owner/name`.
 */
export async function readBoardRepository(gh: GhRunner): Promise<string> {
  const result = await gh(['repo', 'view', '--json', 'nameWithOwner']);
  if (!result.ok) throw new Error(`${REPO_VIEW} failed: ${result.stderr.trim() || result.stdout.trim() || 'it wrote nothing'}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${REPO_VIEW} wrote output that is not JSON: ${describeValue(result.stdout)}`);
  }
  const name = isMapping(parsed)
    ? parsed['nameWithOwner']
    : undefined;
  if (typeof name !== 'string' || !REPOSITORY.test(name)) {
    throw new Error(`${REPO_VIEW} answered nameWithOwner ${describeValue(name)}, expected owner/name`);
  }
  return name;
}
