/**
 * The claim record: what one ownership commit on a claim branch says,
 * how its message is written and read back, and who holds the claim once
 * a branch's ownership commits are read in order.
 *
 * A claim lives in git, on the branch `feat/rafa-<n>-<slug>` the loop
 * already runs on. Every change of ownership is one empty commit on that
 * branch, and its message is the whole record. Nothing here touches git:
 * making, reading and pushing those commits is `./git.ts`'s, and this
 * module only turns a record into a message and a list of messages into
 * an {@link Ownership}.
 *
 * ## The message
 *
 * ```text
 * claim(rafa-<n>): <action>
 *
 * Rafa-Claim: <action>
 * Rafa-Claim-Store: <store id>
 * Rafa-Claim-To: <store id>
 * ```
 *
 * `Rafa-Claim-To` is written on a handover and on nothing else. The
 * store id is the claiming store's `store_meta.store_id`, a UUID today,
 * and is read here as any run of non-blank characters.
 *
 * ## What counts as an ownership commit
 *
 * The trailers decide, not the subject. As git reads trailers, they are
 * the `Key: value` lines of the message's LAST paragraph, and the key is
 * matched without regard to case; a message of one paragraph has none.
 * So a commit whose last paragraph carries none of the three keys is
 * WORK, whatever its subject or its body says: a work commit is never
 * read as a change of owner. A message that carries one of them but is
 * not a well-formed record (an unknown action, a missing or repeated
 * trailer, `Rafa-Claim-To` where it does not belong, a subject that does
 * not match the trailer) is INVALID: it changes nothing, and
 * {@link readOwnership} lists it in `ignored` so a reader can report it
 * rather than lose it.
 *
 * ## Who holds the claim
 *
 * The owner is the store named by the latest ownership commit on the
 * branch, which is the plan's settled design. So {@link readOwnership}
 * folds the ownership commits oldest first and the last one decides:
 *
 * | Latest ownership commit | Answer |
 * |---|---|
 * | none | `none`: the branch carries no claim |
 * | `release` | `released`, naming who released it |
 * | `hand` | `held` by its store, the handover to `Rafa-Claim-To` pending |
 * | `claim`, `withdraw`, `accept`, `take` | `held` by its store, nothing pending |
 *
 * A handover leaves the owner the owner until the receiver's `accept`,
 * and a `withdraw` by the owner clears it. The reader does not police
 * who may push which action — the `--force-with-lease` push and the
 * command that makes the commit do — so an `accept` names its store as
 * the owner whether or not a handover to it was pending.
 */

/** The six ownership actions, in the order a claim usually meets them. */
export const CLAIM_ACTIONS = ['claim', 'release', 'hand', 'withdraw', 'accept', 'take'] as const;

/** One ownership action. */
export type ClaimAction = (typeof CLAIM_ACTIONS)[number];

/** The trailer naming the action. */
export const CLAIM_TRAILER = 'Rafa-Claim';

/** The trailer naming the store that made the commit. */
export const CLAIM_STORE_TRAILER = 'Rafa-Claim-Store';

/** The trailer naming the store a handover is offered to. */
export const CLAIM_TO_TRAILER = 'Rafa-Claim-To';

/** A handover: the owner offers the claim to the store `to`. */
export interface HandoverRecord {
  readonly action: 'hand';
  /** The issue number the claim branch belongs to. */
  readonly issue: number;
  /** The owner's store id. */
  readonly store: string;
  /** The receiving store id. */
  readonly to: string;
}

/** Every ownership change other than a handover. */
export interface PlainClaimRecord {
  readonly action: Exclude<ClaimAction, 'hand'>;
  /** The issue number the claim branch belongs to. */
  readonly issue: number;
  /** The store id that made the commit. */
  readonly store: string;
}

/** What one ownership commit records. */
export type ClaimRecord = HandoverRecord | PlainClaimRecord;

/** What {@link parseClaimMessage} read from one commit message. */
export type ClaimMessageReading =
  /** No claim trailer: an ordinary commit. */
  | { readonly kind: 'work' }
  /** A well-formed ownership commit. */
  | { readonly kind: 'ownership'; readonly record: ClaimRecord }
  /** A claim trailer on a message that is no well-formed record. */
  | { readonly kind: 'invalid'; readonly reason: string };

/** One commit of a claim branch, as `./git.ts` reads it. */
export interface BranchCommit {
  /** The commit's sha. */
  readonly sha: string;
  /** Its full message, subject and body. */
  readonly message: string;
}

/** An ownership commit {@link readOwnership} could not read, and why. */
export interface IgnoredClaimCommit {
  readonly sha: string;
  readonly reason: string;
}

/** A handover the owner offered and nobody has yet accepted or withdrawn. */
export interface PendingHandover {
  /** The receiving store id. */
  readonly to: string;
  /** The sha of the handover commit. */
  readonly sha: string;
}

/** Who holds a branch's claim, read from its ownership commits. */
export type Ownership =
  /** The branch carries no ownership commit at all. */
  | { readonly state: 'none'; readonly ignored: readonly IgnoredClaimCommit[] }
  /** A store holds the claim, with a handover pending or not. */
  | {
    readonly state: 'held';
    readonly owner: string;
    readonly pending: PendingHandover | null;
    readonly ignored: readonly IgnoredClaimCommit[];
  }
  /** The claim was released, by the store named. */
  | { readonly state: 'released'; readonly releasedBy: string; readonly ignored: readonly IgnoredClaimCommit[] };

/** A store id: one run of non-blank characters. */
const STORE_ID = /^\S+$/;

/**
 * The subject every ownership commit carries, `claim(rafa-<n>): <action>`,
 * the issue number captured first and the action second.
 */
export const CLAIM_SUBJECT = /^claim\(rafa-([1-9]\d*)\): (\S+)$/;

/** One trailer line: a key of letters, digits and hyphens, a colon, a value. */
const TRAILER_LINE = /^([A-Za-z0-9-]+):[ \t]*(.*)$/;

/** A paragraph break, blank lines of spaces included. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/;

/** True when `value` is an action this module knows. */
export function isClaimAction(value: string): value is ClaimAction {
  return (CLAIM_ACTIONS as readonly string[]).includes(value);
}

/**
 * Writes the commit message of one ownership record. Throws on a record
 * no reader could read back: an issue that is not a positive integer, a
 * store id that is empty or holds a blank, or a handover to its own
 * store.
 */
export function formatClaimMessage(record: ClaimRecord): string {
  const problem = recordProblem(record);
  if (problem !== null) {
    throw new Error(`claim record: ${problem}`);
  }
  const trailers = [`${CLAIM_TRAILER}: ${record.action}`, `${CLAIM_STORE_TRAILER}: ${record.store}`];
  if (record.action === 'hand') {
    trailers.push(`${CLAIM_TO_TRAILER}: ${record.to}`);
  }
  return `claim(rafa-${record.issue}): ${record.action}\n\n${trailers.join('\n')}\n`;
}

/** What is wrong with a record, or null when it can be written. */
function recordProblem(record: ClaimRecord): string | null {
  if (!Number.isSafeInteger(record.issue) || record.issue <= 0) {
    return `the issue must be a positive integer, not ${String(record.issue)}`;
  }
  if (!STORE_ID.test(record.store)) {
    return `the store id must be one word, not ${JSON.stringify(record.store)}`;
  }
  if (record.action !== 'hand') {
    return null;
  }
  if (!STORE_ID.test(record.to)) {
    return `the receiving store id must be one word, not ${JSON.stringify(record.to)}`;
  }
  return record.to === record.store
    ? `a handover names another store, not its own (${record.store})`
    : null;
}

/**
 * Reads one commit message: `work` when its last paragraph carries none
 * of the three claim trailers, `ownership` when it is a well-formed
 * record, and `invalid` with the reason otherwise. See the module note.
 */
export function parseClaimMessage(message: string): ClaimMessageReading {
  const paragraphs = message
    .replace(/\r\n/g, '\n')
    .trim()
    .split(PARAGRAPH_BREAK);
  if (paragraphs.length < 2) {
    return { kind: 'work' };
  }
  const trailers = readClaimTrailers(paragraphs[paragraphs.length - 1] ?? '');
  if (trailers.size === 0) {
    return { kind: 'work' };
  }
  const subject = (paragraphs[0] ?? '').split('\n')[0] ?? '';
  const read = recordFrom(subject, trailers);
  return typeof read === 'string'
    ? { kind: 'invalid', reason: read }
    : { kind: 'ownership', record: read };
}

/** The values of the three claim trailers in `paragraph`, keyed by lower-cased key. */
function readClaimTrailers(paragraph: string): ReadonlyMap<string, readonly string[]> {
  const wanted = [CLAIM_TRAILER, CLAIM_STORE_TRAILER, CLAIM_TO_TRAILER].map((key) => key.toLowerCase());
  const found = new Map<string, readonly string[]>();
  for (const line of paragraph.split('\n')) {
    const match = TRAILER_LINE.exec(line.trim());
    const key = match?.[1]?.toLowerCase();
    if (match === null || key === undefined || !wanted.includes(key)) {
      continue;
    }
    found.set(key, [...(found.get(key) ?? []), (match[2] ?? '').trim()]);
  }
  return found;
}

/** The one value of trailer `key`, or the reason there is not exactly one. */
function single(trailers: ReadonlyMap<string, readonly string[]>, key: string): string | { readonly problem: string } {
  const values = trailers.get(key.toLowerCase()) ?? [];
  if (values.length === 1 && values[0] !== undefined) {
    return values[0];
  }
  const problem = values.length === 0
    ? `no ${key} trailer`
    : `${values.length} ${key} trailers`;
  return { problem };
}

/** The record the subject and trailers make, or the reason they make none. */
function recordFrom(subject: string, trailers: ReadonlyMap<string, readonly string[]>): ClaimRecord | string {
  const action = single(trailers, CLAIM_TRAILER);
  const store = single(trailers, CLAIM_STORE_TRAILER);
  if (typeof action !== 'string') {
    return action.problem;
  }
  if (!isClaimAction(action)) {
    return `unknown ${CLAIM_TRAILER} action ${JSON.stringify(action)}`;
  }
  if (typeof store !== 'string') {
    return store.problem;
  }
  const match = CLAIM_SUBJECT.exec(subject.trim());
  if (match?.[2] !== action) {
    return `the subject ${JSON.stringify(subject)} is not claim(rafa-<n>): ${action}`;
  }
  const issue = Number(match[1]);
  const record = withReceiver({ action, issue, store }, trailers);
  if (typeof record === 'string') {
    return record;
  }
  return recordProblem(record) ?? record;
}

/** Adds `Rafa-Claim-To` to a handover, and refuses it on anything else. */
function withReceiver(
  base: { readonly action: ClaimAction; readonly issue: number; readonly store: string },
  trailers: ReadonlyMap<string, readonly string[]>,
): ClaimRecord | string {
  const { action, issue, store } = base;
  if (action !== 'hand') {
    return trailers.has(CLAIM_TO_TRAILER.toLowerCase())
      ? `a ${CLAIM_TO_TRAILER} trailer on a ${action} commit`
      : { action, issue, store };
  }
  const to = single(trailers, CLAIM_TO_TRAILER);
  return typeof to === 'string'
    ? { action, issue, store, to }
    : to.problem;
}

/**
 * Who holds a branch's claim, from its commits OLDEST FIRST. Work commits
 * are passed over, invalid ownership commits are passed over and listed
 * in `ignored`, and the latest ownership commit decides. See the module
 * note for the table.
 */
export function readOwnership(commits: readonly BranchCommit[]): Ownership {
  const ignored: IgnoredClaimCommit[] = [];
  let latest: { readonly record: ClaimRecord; readonly sha: string } | null = null;
  for (const commit of commits) {
    const reading = parseClaimMessage(commit.message);
    if (reading.kind === 'invalid') {
      ignored.push({ sha: commit.sha, reason: reading.reason });
    } else if (reading.kind === 'ownership') {
      latest = { record: reading.record, sha: commit.sha };
    }
  }
  if (latest === null) {
    return { state: 'none', ignored };
  }
  const { record, sha } = latest;
  if (record.action === 'release') {
    return { state: 'released', releasedBy: record.store, ignored };
  }
  const pending = record.action === 'hand'
    ? { to: record.to, sha }
    : null;
  return { state: 'held', owner: record.store, pending, ignored };
}
