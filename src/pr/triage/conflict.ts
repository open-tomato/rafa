/**
 * Which files a pull request conflicts on, read with
 * `git merge-tree --write-tree` against the base.
 *
 * Triage needs the conflicting file list to tell `conflict-lockfile`
 * from `conflict-manifest` from `conflict-other` (`./classes.ts`), and
 * GitHub does not hand that list out: `mergeable` and
 * `mergeStateStatus` say THAT a pull request conflicts and never WHICH
 * paths. `git merge-tree --write-tree` answers the same question
 * locally, from two commit-ish, writing nothing to the index, nothing
 * to the working tree and no ref — the merge is computed into the
 * object database and thrown away. So this module is safe to run in the
 * operator's own checkout, mid-work, with a dirty tree.
 *
 * Nothing here classifies. The list and the merge messages come back as
 * data, and `./classify.ts` decides what they mean.
 *
 * ## Exit 1 is ambiguous, which is the whole reason for
 * {@link ConflictReadingKind}
 *
 * `git merge-tree`'s documentation says the exit status is 0 for a
 * clean merge, 1 for a conflicted one, and "something other than 0 or
 * 1" for an error. The second half of that is NOT what git does.
 * Measured on git 2.50.1 (Apple Git-155) under macOS, 2026-09-18, in a
 * scratch repository:
 *
 *   - a real content conflict: exit 1, stdout opening with the merged
 *     tree's OID, stderr empty;
 *   - `git merge-tree --write-tree main no-such-ref`: exit 1 too, with
 *     stdout EMPTY and
 *     `merge-tree: no-such-ref - not something we can merge` on stderr;
 *   - `HEAD~99` on a short history: exit 1, the same shape;
 *   - two branches with no common ancestor: exit 128, stdout empty,
 *     `fatal: refusing to merge unrelated histories` on stderr.
 *
 * So a caller that read exit 1 as "conflicted" would report a
 * conflicting pull request with no conflicting files for every head
 * that is merely not fetched yet — the commonest state a triage meets,
 * since `gh pr view` never fetches the head — and the triage would
 * class it `conflict-other` and assess a conflict that does not exist.
 * The reading is taken from the OUTPUT instead: a conflicted merge
 * always opens with the merged tree's OID, and an error never does.
 * {@link parseMergeTree} is where that discrimination lives, and it is
 * exported so a test can drive it over captured text as well as over a
 * real repository.
 *
 * Because exit 1 alone proves nothing, a reading from this module is
 * only trustworthy beside a LIVENESS CONTROL: a scratch repository
 * holding a constructed two-sided conflict, put through the same
 * command, confirmed to answer exit 1 with a `CONFLICT` message. That
 * control is the first case in `./conflict.test.ts`, and
 * {@link hasConflictMessage} is what it asserts on.
 *
 * ## Why `-z`, and why `--name-only`
 *
 * `--name-only` because triage wants paths, not the (mode, object,
 * stage) tuples, and because it lists a path ONCE however many stages
 * conflict on it: the same scratch repository answered three tuple
 * lines and one name for a single content conflict.
 *
 * `-z` because without it git C-quotes a path through `core.quotePath`,
 * and a quoted path is not the path. Measured in the same repository,
 * an add/add conflict on `wéird'one.txt` printed
 * `"w\303\251ird'one.txt"` with `--name-only`, and the raw bytes with
 * `--name-only -z`. A lockfile or a manifest never needs the quoting,
 * but `conflict-other` carries whatever the pull request touched, and
 * that list is shown to an operator and pasted into a follow-up prompt.
 *
 * `-z` also makes the informational messages machine-readable rather
 * than a human agglomeration: git's own documentation says the
 * non-`-z` message block is "meant for human consumption" and holds
 * "non-stable strings that should not be parsed by scripts", while the
 * `-z` form is records of `<count> <path>* <type> <message>` in which
 * the TYPE is documented as stable (`Auto-merging`,
 * `CONFLICT (rename/delete)`, `CONFLICT (binary)`, …). So
 * {@link hasConflictMessage} reads the stable type and never the prose.
 *
 * ## The shape of the output, as measured
 *
 * With `--write-tree --name-only -z`, on the same git:
 *
 *   - clean: `<oid>NUL` and nothing else, exit 0;
 *   - conflicted: `<oid>NUL`, then one `<path>NUL` per conflicting
 *     path, then an EMPTY record closing that section, then the
 *     informational records, exit 1;
 *   - error: no stdout at all.
 *
 * A message record's free-form half ends with a newline
 * (`Auto-merging a b.txt\n`), which {@link parseMergeTree} strips, and
 * the whole stream ends with a trailing NUL, which leaves an empty
 * final record that the group walk stops on.
 */
import type { GitResult, GitRunner } from '../git.js';

import { gitSaid } from '../git.js';

/**
 * What one reading concluded, and the reason the three are named apart:
 * `conflict` and `error` are both exit 1 (see the module note), so a
 * caller must never collapse them.
 *
 * `clean` means git merged the two without conflict — it does NOT mean
 * GitHub will let the pull request merge, which also depends on checks,
 * reviews and branch protection.
 */
export type ConflictReadingKind = 'clean' | 'conflict' | 'error';

/**
 * One informational record from the `-z` messages section.
 *
 * {@link type} is git's stable short description and is what code
 * matches on; {@link message} is the prose git would have shown a
 * person, kept verbatim except for its trailing newline, because it
 * names the branches and the rename sources that {@link paths} alone
 * does not.
 */
export interface MergeTreeMessage {
  /** The stable type, such as `Auto-merging` or `CONFLICT (add/add)`. */
  readonly type: string;
  /** The paths or branch names the record is about, in git's order. */
  readonly paths: readonly string[];
  /** The free-form message, its trailing newline removed. */
  readonly message: string;
}

/** Everything one `git merge-tree --write-tree` answered. */
export interface ConflictReading {
  /** Which of the three outcomes this was; see {@link ConflictReadingKind}. */
  readonly kind: ConflictReadingKind;
  /**
   * The conflicting paths, in git's order, each once, unquoted. Empty
   * for `clean` and for `error` — an error reading knows no paths, so a
   * caller must branch on {@link kind} and never on this being empty.
   */
  readonly files: readonly string[];
  /** The informational records; empty unless {@link kind} is `conflict`. */
  readonly messages: readonly MergeTreeMessage[];
  /**
   * The merged tree's OID, present for `clean` and `conflict`. Triage
   * does not use it; it is kept because it is the one thing that
   * distinguishes the two exit-1 readings, so a report about a
   * surprising reading can show what was actually discriminated on.
   */
  readonly mergedTree: string | undefined;
  /**
   * What git said, its standard error first ({@link gitSaid}). Carried
   * for every kind so an `error` reading can be reported with git's own
   * words rather than a rephrasing.
   */
  readonly said: string;
}

/**
 * The record separator the `-z` output uses, and the empty record that
 * closes the conflicting-file section.
 */
const NUL = '\0';

/**
 * A merged tree's OID: 40 hex digits under SHA-1, 64 under SHA-256.
 * Both are accepted because a repository initialised with
 * `--object-format=sha256` writes the longer one, and the whole
 * discrimination in the module note rests on recognising this line.
 */
const OID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The prefix of every stable type git calls a conflict. */
const CONFLICT_TYPE_PREFIX = 'CONFLICT';

/**
 * The argv after `git` for reading a merge of `head` into `base`.
 *
 * `base` goes first because that is the branch being merged INTO, the
 * way GitHub merges a pull request, and git's messages name the two
 * sides in that order (`… deleted in <second> and modified in
 * <first>`). Exported so a caller reporting a failed reading can print
 * the exact command, and so a test can assert the argv without
 * spawning.
 */
export function mergeTreeArgs(base: string, head: string): readonly string[] {
  return ['merge-tree', '--write-tree', '--name-only', '-z', base, head];
}

/** Whether a record looks like the merged tree's OID. */
function isOid(record: string | undefined): record is string {
  return record !== undefined && OID_PATTERN.test(record);
}

/**
 * The informational records after the empty separator, walked as
 * groups of `<count> <path>* <type> <message>`.
 *
 * The walk stops rather than throwing on anything it cannot read: a
 * truncated stream, or a future git that adds a field, costs the
 * messages and never the file list, which is what triage actually
 * classifies on.
 */
function parseMessages(records: readonly string[], from: number): readonly MergeTreeMessage[] {
  const messages: MergeTreeMessage[] = [];
  let at = from;
  while (at < records.length) {
    const countRecord = records[at];
    if (countRecord === undefined || countRecord === '') break;
    const count = Number(countRecord);
    if (!Number.isInteger(count) || count < 0) break;
    const typeAt = at + 1 + count;
    const messageAt = typeAt + 1;
    const type = records[typeAt];
    const message = records[messageAt];
    if (type === undefined || message === undefined) break;
    messages.push({
      type,
      paths: records.slice(at + 1, typeAt),
      message: message.replace(/\n$/, ''),
    });
    at = messageAt + 1;
  }
  return messages;
}

/**
 * Reads one `git merge-tree --write-tree --name-only -z` result.
 *
 * Pure, so the ambiguity the module note records can be measured from
 * captured text as well as from a repository. Exit 0 is `clean`
 * whatever it printed; a nonzero exit is `conflict` only when stdout
 * opens with the merged tree's OID, and `error` otherwise.
 */
export function parseMergeTree(result: GitResult): ConflictReading {
  const records = result.stdout.split(NUL);
  const first = records[0];
  const said = gitSaid(result);
  if (result.ok) {
    return {
      kind: 'clean',
      files: [],
      messages: [],
      mergedTree: isOid(first)
        ? first
        : undefined,
      said,
    };
  }
  if (!isOid(first)) {
    return { kind: 'error', files: [], messages: [], mergedTree: undefined, said };
  }
  const endOfFiles = records.indexOf('', 1);
  const files = endOfFiles === -1
    ? records.slice(1).filter((record) => record !== '')
    : records.slice(1, endOfFiles);
  return {
    kind: 'conflict',
    files,
    messages: endOfFiles === -1
      ? []
      : parseMessages(records, endOfFiles + 1),
    mergedTree: first,
    said,
  };
}

/**
 * Whether the reading carries at least one record whose stable type git
 * calls a conflict.
 *
 * This is what the liveness control asserts: a constructed two-sided
 * conflict must answer exit 1 WITH such a record, which is the part an
 * error reading can never fake.
 */
export function hasConflictMessage(reading: ConflictReading): boolean {
  return reading.messages.some((message) => message.type.startsWith(CONFLICT_TYPE_PREFIX));
}

/**
 * Runs `git merge-tree --write-tree` for `head` against `base` through
 * `git` and reads what it answered.
 *
 * Both arguments must be resolvable in the repository the runner was
 * made for. A head that was never fetched is not an exception here: it
 * comes back as an `error` reading whose {@link ConflictReading.said}
 * is git's own `not something we can merge`, and the caller decides
 * whether to fetch and read again.
 */
export function readConflict(git: GitRunner, base: string, head: string): ConflictReading {
  return parseMergeTree(git(mergeTreeArgs(base, head)));
}
