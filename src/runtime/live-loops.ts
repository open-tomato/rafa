/**
 * The live loops of one checkout: the reading that says whether a runtime
 * is in use, which `rafa self-update` (`commands/self-update.ts`), the
 * install (`install.ts`) and the follow-ups of `rafa pr merge`
 * (`commands/pr/merge-cleanup.ts`) all ask.
 *
 * A loop is live while its session record under `<root>/.rafa/runs/`
 * (`readSessions`, `loop/sessions.ts`) reads `running` or `paused`, which
 * `readState` answers only while the record's pid is alive. A record
 * whose pid is gone reads `stopped`, and is no live loop however it was
 * left.
 *
 * It lives here and not beside the command that first asked because
 * `install.ts` asks it too, and nothing under `src/runtime/` may import
 * from `src/commands/` (`context/source.md`, the library boundary).
 *
 * The records read are the ones under the root handed in, and no other
 * checkout's: a loop running in a linked worktree records itself under
 * the main checkout, so a caller holding a linked worktree's root reads
 * none of them.
 */
import type { PidProbe, SessionRecord } from '../core/loop/index.js';

import { isPidAlive, readSessions } from '../core/loop/index.js';

/**
 * The loops recorded under `<root>/.rafa/runs/` that read `running` or
 * `paused`, their pid alive, oldest first. Throws `SessionRecordError`
 * for a record that cannot be read.
 *
 * @param root - The checkout whose `.rafa/runs/` is read.
 * @param isAlive - Whether a record's pid is alive; `isPidAlive` when
 *   left out.
 * @returns The live loops' records, each with the state it reads as.
 */
export function liveLoopsOf(root: string, isAlive: PidProbe = isPidAlive): readonly SessionRecord[] {
  return readSessions(root, { isAlive }).filter((record) => record.state === 'running' || record.state === 'paused');
}
