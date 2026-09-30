/**
 * `rafa epic move` under `board.relationships: native`: the epic the
 * moving issue leaves, read through the board's relationships port
 * (`src/board/relations/port.ts`), and the sentences the native mode says
 * where the labels mode names a label or a checklist line.
 *
 * In native mode an issue's epic IS its sub-issue parent, so the move is
 * one `gh issue edit <n> --parent <epic>` sent by the port's `setParent`
 * (`src/board/relations/native-writes.ts`), which moves the issue out of
 * its old parent in the same call. No `epic:` label is swapped and no
 * checklist line is written, and every sentence here that says so opens
 * with {@link NATIVE_MODE}, as every native-mode refusal and no-op line
 * does. `./move.ts` holds the move itself; this module holds only what
 * the native mode reads and says differently.
 *
 * ## The epic it leaves
 *
 * {@link nativeEpicLeft} reads the port's `epicOf` answer: an issue in
 * one epic on the listing leaves that epic. One with no parent has no
 * epic to leave, and one whose parent is not an issue typed `epic` on
 * the listing (another repository's issue, an issue the listing does not
 * hold, or one that is no epic) leaves an epic that cannot be read; each
 * is a refusal sentence, which `./move.ts` ends the command with.
 *
 * ## Which mode applies
 *
 * {@link configuredMoveRelations} makes the relationships the project's
 * config names, through `selectBoardRelations`
 * (`src/board/relations/select.ts`). The config is loaded through
 * `../issue/issue-tracker.ts`'s `issueSubjectConfig`, so a config
 * `loadConfig` refuses is refused with exit code 1, and its warnings are
 * DROPPED, as `rafa issue unblock` drops them (`../issue/unblock-native.ts`):
 * this command loaded no config before the native mode existed, and in
 * `labels` mode, the default, it prints what it printed then.
 *
 * The `native` adapter tells a parent on the board's own repository
 * from one on another, so it is made with the board's `owner/name`,
 * read with one `gh repo view --json nameWithOwner` in the project's
 * directory ({@link readBoardRepository}). That call is sent in `native`
 * mode only: a `labels` move sends the calls it sent before the port.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BoardRelations, EpicOfReading } from '../../board/relations/port.js';
import type { ProjectFound } from '../../project/scope.js';

import { selectBoardRelations } from '../../board/relations/select.js';
import { describeValue, isMapping } from '../../config-sections.js';
import { issueSubjectConfig } from '../issue/issue-tracker.js';

/** What every native-mode sentence of the move opens with. */
export const NATIVE_MODE = 'board.relationships is native';

/** A repository as `gh repo view` names it: `owner/name`, each part free of `/` and whitespace. */
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/u;

/** The command {@link readBoardRepository} sends, as a message names it. */
const REPO_VIEW = 'gh repo view --json nameWithOwner';

/** What a native-mode move that `gh` refused tells the person to read before running again. */
export const NATIVE_RETRY_HINT = 'Read its parent epic before running the same line again.';

/** `#40`. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** The epic `reading` puts its issue in, or the sentence refusing the move; see the module note. */
export function nativeEpicLeft(reading: EpicOfReading): number | string {
  switch (reading.kind) {
    case 'epic': {
      return reading.epic;
    }
    case 'none': {
      return `${NATIVE_MODE}: ${ref(reading.issue)} has no parent epic, so it is in no epic to move from`;
    }
    case 'unresolved': {
      const marks = reading.marks.map((each) => each.mark).join(', ');
      return `${NATIVE_MODE}: ${ref(reading.issue)}'s parent ${marks} is not an issue typed epic on the board listing,`
        + ' so the epic it leaves cannot be read';
    }
  }
}

/** The refusal of a move to the epic `issue` is a sub-issue of already. */
export function nativeAlreadyMessage(issue: number, epic: number): string {
  return `${NATIVE_MODE}: ${ref(issue)} is in epic ${ref(epic)} already: its parent is ${ref(epic)}`;
}

/** The line a native-mode move prints where the labels mode prints its two checklist lines. */
export function nativeParentLine(to: number): string {
  return `Set its parent to epic ${ref(to)}; ${NATIVE_MODE}, so no label and no checklist line was written.`;
}

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

/**
 * The relationships `project`'s config names, made over `gh`; see the
 * module note. `readRepository` reads the board's repository, and is
 * called in `native` mode only.
 */
export async function configuredMoveRelations(
  project: ProjectFound,
  gh: GhRunner,
  readRepository: () => Promise<string>,
): Promise<BoardRelations> {
  const config = issueSubjectConfig(project, () => undefined);
  const repository = config.boardRelationships === 'native'
    ? await readRepository()
    : '';
  return selectBoardRelations(config, { gh, repository });
}
