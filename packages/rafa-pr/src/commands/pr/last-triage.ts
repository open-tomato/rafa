/**
 * The last triage on a pull request, read out of its comments.
 *
 * `rafa pr show` ends with "the last triage", and a triage leaves
 * exactly one comment per pull request, its history in that comment's
 * own edits (per the PR commands spec). The comment is found by
 * the marker {@link TRIAGE_MARKER} its body opens with, and what it says
 * in machine-readable form is a fenced `rafa:triage` block:
 *
 * ````markdown
 * <!-- rafa:pr-triage v1 -->
 * **rafa triage**: `conflict-lockfile`, simple, not resolved
 * ```rafa:triage
 * head: "0badc0ffee..."
 * at: "2026-09-18T12:00:00Z"
 * class: "conflict-lockfile"
 * simple: true
 * attempts: 0
 * files: ["bun.lock"]
 * ```
 * ````
 *
 * The FORMAT is not this module's. `src/pr/triage/comment.ts` writes
 * that comment, edits it on the next assessment and reads its block
 * back, and this module is the `pr show` end of it: the marker comment
 * picked out of a list through `findTriageComment`, its block through
 * `readTriageBlock`, and the two answered as one {@link LastTriage} with
 * the comment's own id, author, URL and time beside them. Which is why
 * there is no second fence reader and no second spelling of the marker
 * here — a reader that disagreed with the writer about either would show
 * `pr show` a triage the triage command cannot see.
 *
 * What it adds over the format module is the {@link LastTriage} record
 * itself, and the author riding on it. WHO wrote the comment is not
 * checked here, and this reading is a DISPLAY: `pr show` prints the
 * stored class and the login that wrote it, and hands nothing on. The
 * check lives where the comment is read as a STORE —
 * `src/commands/pr/triage-trust.ts`, which `rafa pr triage` finds its
 * marker comment through, dropping an untrusted one and reporting it, so
 * that neither the stored head, the attempt count nor the follow-up
 * prompt can come from a planted comment. So a triage `pr show` displays
 * is always attributed, and one nobody trusted is a login the operator
 * does not recognise beside a class they did not ask for.
 */
import type { PullRequestComment } from '../../pr/index.js';
import type { TriageBlock } from '../../pr/triage/comment.js';

import { findTriageComment, readTriageBlock } from '../../pr/triage/comment.js';

export type { TriageBlock } from '../../pr/triage/comment.js';
export { TRIAGE_BLOCK_KIND, TRIAGE_MARKER } from '../../pr/triage/comment.js';

/** The last triage comment on a pull request, and what it says. */
export interface LastTriage {
  /** The comment's provider id, which an edit takes. */
  readonly id: string;
  /** The login that wrote it; see the module note on trust. */
  readonly author: string;
  /** The comment's own URL. */
  readonly url: string;
  /** When the comment last moved, ISO 8601. An edit moves it. */
  readonly updatedAt: string;
  /** What its `rafa:triage` block said, or null when none could be read. */
  readonly block: TriageBlock | null;
  /** What was wrong with the block and its fields; empty when it read clean. */
  readonly problems: readonly string[];
}

/**
 * The last triage on a pull request, from its comments oldest first as
 * the port answers them, or null when none of them carries the marker.
 * A marker comment whose block cannot be read is still a reading: the
 * comment, with a null block and what was wrong with it.
 */
export function readLastTriage(comments: readonly PullRequestComment[]): LastTriage | null {
  const comment = findTriageComment(comments);
  if (comment === null) return null;
  const reading = readTriageBlock(comment.body);
  return {
    id: comment.id,
    author: comment.author.login,
    url: comment.url,
    updatedAt: comment.updatedAt,
    block: reading.block,
    problems: reading.problems,
  };
}
