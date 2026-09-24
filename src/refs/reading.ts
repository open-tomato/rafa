/**
 * The reading of one saved copy's references: `./extract.ts`,
 * `./verify.ts` and `./stamp.ts` composed into one row per reference,
 * and the re-stamp that writes what the targets hold now back into the
 * copy (`.rafa/specs/rafa-151-references-specs-bugs-are.md`).
 *
 * Nothing here spawns a process. The targets are read through the
 * {@link RefVerifier} a caller hands in, built by `createRefVerifier`
 * over its seams, so `./reading.test.ts` drives a planted repository
 * and a fake issue reader. A verifier that rejects — the board's issue
 * or git could not be read — rejects the reading with the same error,
 * and nothing is written.
 *
 * ## A row
 *
 * Each reference the copy's body names, in the order `extractRefs`
 * answers them, is one {@link RefRow}: its kind, its text and its
 * 1-based line in the body with the refs block stripped, as the issue
 * was written; its `state`; its live `fingerprint`; the `stamp` it is
 * held to; and the `changedHeadings` a suspect or resolved issue names.
 * A `resolved` row also names the command that takes the spec off its
 * blocked line, `rafa issue unblock <n>` with the spec's own issue
 * number, in {@link RefRow.unblock}; every other row holds null there.
 *
 * ## Reading stamps what it has not seen
 *
 * {@link readRefsText} reads each live fingerprint against the stamp
 * the copy keeps (`compareToStamp`). A reference the copy keeps no
 * stamp for — every reference of a copy written before stamps existed,
 * and a reference a refresh added — is stamped with its live
 * fingerprint on that read, and reads `ok`. Two readings are NOT
 * stamped then: `absent`, since a target that does not exist is
 * `dangling` on its first read and only a re-stamp accepts it; and an
 * unreadable cross-repository issue, which has no fingerprint to stamp
 * and reads `unknown`. The new stamps are appended after the ones the
 * copy kept, and a stamp whose reference the body no longer names is
 * kept as it is: a reading drops nothing.
 *
 * Without a stamp written back, the next reading would stamp afresh
 * against whatever the target holds by then, and no change would ever
 * read `suspect`; so {@link readCopyRefs} writes the copy when the
 * reading stamped anything, and leaves the file untouched when it did
 * not. A copy with no block and no stamp to add stays without one.
 *
 * ## Re-stamping
 *
 * {@link restampRefsText} is what `--accept-refs` and `rafa issue check
 * --stamp` do: the block is rewritten to hold exactly the references
 * the body names, each stamped with its live fingerprint — `absent` for
 * a missing target, which then reads `ok` until it appears. An
 * unreadable target keeps the stamp it had, or none. The rows it
 * answers are read against the new stamps, so every row reads `ok`
 * except an `unknown` one. {@link restampCopyRefs} always writes the
 * block, an empty one included, so a re-stamped copy is told apart
 * from one never checked.
 */
import type { Ref, RefKind } from './extract.js';
import type { Fingerprint, LiveReading, RefStamp, RefState } from './stamp.js';
import type { RefVerifier } from './verify.js';

import { readFileSync, writeFileSync } from 'node:fs';

import { extractRefs } from './extract.js';
import { compareToStamp, findStamp, readRefsBlock, writeRefsBlock } from './stamp.js';

/** One reference of a saved copy, as {@link readRefsText} reads it. */
export interface RefRow {
  /** What the reference points at. */
  readonly kind: RefKind;
  /** The reference as the body writes it. */
  readonly text: string;
  /** The 1-based body line it is first named on, the refs block stripped. */
  readonly line: number;
  /** What the live fingerprint reads as against the stamp. */
  readonly state: RefState;
  /** The target as it is now. */
  readonly fingerprint: LiveReading;
  /** The stamp the copy holds it to after this reading, or null when it holds none. */
  readonly stamp: Fingerprint | null;
  /** The `##` headings of an issue whose text changed since the stamp. */
  readonly changedHeadings: readonly string[];
  /** `rafa issue unblock <n>` on a `resolved` row, null on every other. */
  readonly unblock: string | null;
}

/** What one reading, or one re-stamp, of a copy answered. */
export interface RefsReading {
  /** One row per reference, in body order. */
  readonly rows: readonly RefRow[];
  /** The stamps the copy keeps after it, or null when it keeps no block. */
  readonly stamps: readonly RefStamp[] | null;
  /** The copy's text after it: the input unchanged when nothing was stamped. */
  readonly copy: string;
  /** True when {@link RefsReading.copy} differs from the copy read. */
  readonly changed: boolean;
}

/** What a reading of a copy's text is handed. */
export interface RefsTextOptions {
  /** The saved copy, its refs block included when it has one. */
  readonly copy: string;
  /** The issue the copy is a spec of, named by a resolved row's unblock command. */
  readonly issue: number;
  /** Reads each target as it is now. */
  readonly verify: RefVerifier;
}

/** What a reading of a copy on disk is handed. */
export interface RefsCopyOptions {
  /** The saved copy's file. */
  readonly path: string;
  /** The issue the copy is a spec of. */
  readonly issue: number;
  /** Reads each target as it is now. */
  readonly verify: RefVerifier;
}

/** The command that takes issue `issue` off its blocked line. */
export function unblockCommand(issue: number): string {
  return `rafa issue unblock ${String(issue)}`;
}

/** A reading a stamp can hold: every fingerprint but `absent`, never an unreadable target. */
function firstStamp(live: LiveReading): Fingerprint | null {
  return live.kind === 'unreadable' || live.kind === 'absent'
    ? null
    : live;
}

/** Every reference the body names, each with its live reading; sequential, so `gh` is asked one at a time. */
async function liveReadings(body: string, verify: RefVerifier): Promise<readonly (readonly [Ref, LiveReading])[]> {
  const read: (readonly [Ref, LiveReading])[] = [];
  for (const ref of extractRefs(body)) read.push([ref, await verify(ref)]);
  return read;
}

/** One row: `live` against `stamp`, reported as held to `heldTo`. */
function rowOf(ref: Ref, live: LiveReading, stamp: Fingerprint | null, heldTo: Fingerprint | null, issue: number): RefRow {
  const { state, changedHeadings } = compareToStamp({ live, stamp, blocker: ref.blocker });
  return Object.freeze({
    kind: ref.kind,
    text: ref.text,
    line: ref.line,
    state,
    fingerprint: live,
    stamp: heldTo,
    changedHeadings,
    unblock: state === 'resolved'
      ? unblockCommand(issue)
      : null,
  });
}

/** The answer for `rows` over `copy`, rewritten with `stamps` when `write`. */
function answer(rows: readonly RefRow[], copy: string, body: string, stamps: readonly RefStamp[] | null, write: boolean): RefsReading {
  const text = write
    ? writeRefsBlock(body, stamps)
    : copy;
  return Object.freeze({ rows: Object.freeze(rows), stamps, copy: text, changed: text !== copy });
}

/**
 * Reads every reference of the saved copy `options.copy` against the
 * stamps it keeps, stamping each it keeps none for, by the rules in the
 * module note. Throws `RefsBlockError` for a block the codec will not
 * read, and rejects as `options.verify` does.
 */
export async function readRefsText(options: RefsTextOptions): Promise<RefsReading> {
  const { stamps, body } = readRefsBlock(options.copy);
  const added: RefStamp[] = [];
  const rows = (await liveReadings(body, options.verify)).map(([ref, live]) => {
    const stamp = findStamp(stamps, ref);
    const fresh = stamp === null
      ? firstStamp(live)
      : null;
    if (fresh !== null) added.push(Object.freeze({ kind: ref.kind, text: ref.text, fingerprint: fresh }));
    return rowOf(ref, live, stamp, stamp ?? fresh, options.issue);
  });
  const kept = added.length === 0
    ? stamps
    : Object.freeze([...stamps ?? [], ...added]);
  return answer(rows, options.copy, body, kept, added.length > 0);
}

/**
 * Re-stamps every reference of the saved copy `options.copy` with its
 * live fingerprint, or `absent`, and answers the rows read against the
 * new stamps, by the rules in the module note. Throws and rejects as
 * {@link readRefsText} does.
 */
export async function restampRefsText(options: RefsTextOptions): Promise<RefsReading> {
  const { stamps: old, body } = readRefsBlock(options.copy);
  const stamps: RefStamp[] = [];
  const rows = (await liveReadings(body, options.verify)).map(([ref, live]) => {
    const stamp = live.kind === 'unreadable'
      ? findStamp(old, ref)
      : live;
    if (stamp !== null) stamps.push(Object.freeze({ kind: ref.kind, text: ref.text, fingerprint: stamp }));
    return rowOf(ref, live, stamp, stamp, options.issue);
  });
  return answer(rows, options.copy, body, Object.freeze(stamps), true);
}

/** Reads `path`, runs `reading` over it, and writes the copy back when the reading changed it. */
async function overFile(options: RefsCopyOptions, reading: (text: RefsTextOptions) => Promise<RefsReading>): Promise<RefsReading> {
  const copy = readFileSync(options.path, 'utf8');
  const read = await reading({ copy, issue: options.issue, verify: options.verify });
  if (read.changed) writeFileSync(options.path, read.copy);
  return read;
}

/**
 * {@link readRefsText} over the saved copy at `options.path`, writing
 * the copy back when the reading stamped a reference. Throws when the
 * file cannot be read or written.
 */
export async function readCopyRefs(options: RefsCopyOptions): Promise<RefsReading> {
  return overFile(options, readRefsText);
}

/**
 * {@link restampRefsText} over the saved copy at `options.path`,
 * writing the new block back unless the copy already held exactly it.
 * Throws when the file cannot be read or written.
 */
export async function restampCopyRefs(options: RefsCopyOptions): Promise<RefsReading> {
  return overFile(options, restampRefsText);
}
