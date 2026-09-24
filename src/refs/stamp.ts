/**
 * The fingerprint of a reference's target, the stamp a saved copy keeps
 * of it, the state a live fingerprint reads against that stamp, and the
 * codec of the `<!-- rafa:refs` block the stamps are written in.
 *
 * This is the third of the readings under `src/refs/`. `./extract.ts`
 * answers WHAT a spec points at and `./verify.ts` whether the target is
 * there; this module answers whether it CHANGED since the spec was read
 * (`.rafa/specs/rafa-151-references-specs-bugs-are.md`). Nothing here
 * spawns, reads a file or asks the board: a fingerprint is built from
 * what a caller read, and the codec reads and writes text, so every
 * case in `./stamp.test.ts` is a literal.
 *
 * ## The fingerprints
 *
 * | Target | Fingerprint | Written as |
 * |---|---|---|
 * | an issue, here or on another repository | sha256 over title and body, a sha256 per `##` section, and its state | `sha256:<hex>` |
 * | a file | its blob sha, as `git rev-parse HEAD:<path>` answers it | `blob:<sha>` |
 * | a symbol, a command, a flag, a key | that it exists | `present` |
 * | any target that does not exist | that it does not | `absent` |
 *
 * `absent` is both what a missing target reads live and what
 * `--accept-refs` stamps for one, so accepting a missing target is
 * writing its live fingerprint like any other.
 *
 * ## An issue's fingerprint
 *
 * The title and the body are normalised the same way before they are
 * hashed: every line break (`\r\n`, and a `\r` alone) becomes `\n`,
 * every line loses its trailing whitespace, and the text loses its
 * trailing whitespace, blank lines included. An editor that strips
 * trailing spaces or a forge that answers CRLF therefore changes no
 * fingerprint. The digest is sha256 over the UTF-8 of
 * `JSON.stringify([title, body])`, which cannot read one title and body
 * as another the way a plain join could.
 *
 * Beside it, each `##` section of the body is hashed on its own, so a
 * changed issue can name the headings whose text changed
 * (`suspect #7: heading "Design" changed`) without keeping the old
 * text. A section is a `##` heading line — up to three spaces, exactly
 * two `#`, then a space, a tab or the line's end — outside a fenced
 * block, with every line after it up to the next such line. A `###`
 * or `#` line is text of the section it sits in, so every change to
 * the body below the first `##` heading lands in some section; a
 * change above it, or to the title, changes the digest and names no
 * heading. A section is named by its heading without the `#` marks,
 * and hashed with its heading line; two sections under one name are
 * hashed as one text, joined by `\n`, so the name stays a key.
 *
 * The issue's state (`open` or `closed`) is kept beside the digest and
 * is NOT part of it: closing an issue is not a change to what it says,
 * and the state is what the `resolved` reading below asks.
 *
 * ## The states
 *
 * {@link compareToStamp} reads a live fingerprint against a stamp, in
 * this order, and the first rule that matches answers:
 *
 *  1. `unknown` — the target could not be read ({@link UNREADABLE}),
 *     which only a cross-repository issue answers. It never refuses.
 *  2. With no stamp, `dangling` when the target is `absent` and `ok`
 *     otherwise: a target that does not exist is dangling even on the
 *     first read, and one that does is stamped and read as it is.
 *  3. `dangling` — the target is `absent` and the stamp is not.
 *  4. `ok` — both are `absent`: the missing target was accepted.
 *  5. `suspect` — the stamp is `absent` and the target now exists.
 *  6. `resolved` — the reference is a `Blocked by:` target, stamped
 *     `open` and now `closed`.
 *  7. `ok` when the fingerprints are the same, `suspect` when not.
 *
 * `resolved` is read before sameness on purpose: a blocker that closed
 * is the news, and the `rafa issue unblock` it leads to is where the
 * spec is re-read anyway. Its changed headings are still answered, so
 * a caller can print them beside it.
 *
 * With no stamp there is nothing to have closed SINCE, so a blocker
 * already closed on its first read is stamped `closed` and reads `ok`.
 *
 * ## The block
 *
 * The stamps live in the saved copy under `specs.dir` and never on the
 * forge. The block is an HTML comment on the copy's first lines — its
 * opening line exactly {@link REFS_BLOCK_OPEN}, its closing line
 * exactly {@link REFS_BLOCK_CLOSE}, both with LF endings as
 * `snapshotText` writes every copy — and one blank line after it, which
 * {@link readRefsBlock} strips with the block so the body it answers
 * starts at the body's own line 1. Between the two lines is YAML:
 *
 * ```yaml
 * refs:
 *   - kind: issue
 *     text: "#7"
 *     stamp: "sha256:<hex>"
 *     state: open
 *     headings:
 *       - ["Design", "<hex>"]
 *   - kind: path
 *     text: "src/a.ts"
 *     stamp: "blob:<sha>"
 * ```
 *
 * Headings are a list of pairs rather than a mapping because
 * `Bun.YAML.parse` answers a mapping as an object, which puts
 * integer-like keys first: on bun 1.3.14, `__proto__`, `"2"`, `b` read
 * back as `"2"`, `__proto__`, `b`. A list keeps the order the body
 * names its headings in, whatever they are called.
 *
 * Every string the block carries is written double-quoted, with `>`
 * and every control or format character escaped as a `\u` code point,
 * so no heading an issue holds can write the `-->` that would close
 * the comment early.
 *
 * A copy with no block and a copy with an empty one are told apart:
 * {@link readRefsBlock} answers `null` stamps for the first — a copy
 * written before stamps existed, whose first check stamps it — and an
 * empty list for the second, and {@link writeRefsBlock} writes each
 * back as it was read, so a round trip is byte for byte. A block that
 * opens and does not close, is not YAML, or holds an entry this module
 * would not have written throws {@link RefsBlockError}: reading it as
 * no stamps would stamp every target afresh and hide what changed.
 *
 * `src/board/issue.ts` is where the saved copy is read and written, and
 * it uses this codec both ways: `readSnapshotChange` compares the copy
 * with its block stripped, and `writeSpecSnapshot` writes a refresh or
 * a notes rebuild through {@link carryRefsBlock}, so the stamps survive
 * the new text. A copy moved to `previous/` is moved whole, block and
 * all.
 */
import type { RefKind } from './extract.js';

import { createHash } from 'node:crypto';

/** An issue's state, as a stamp keeps it. */
export type IssueState = 'open' | 'closed';

/** One `##` section's digest. */
export interface HeadingDigest {
  /** The heading without its `#` marks. */
  readonly name: string;
  /** sha256 in hex over the section's heading line and text. */
  readonly digest: string;
}

/** An issue's fingerprint: its title and body hashed, section by section too. */
export interface IssueFingerprint {
  readonly kind: 'issue';
  /** sha256 in hex over the normalised title and body. */
  readonly digest: string;
  /** Its state when read; not part of {@link IssueFingerprint.digest}. */
  readonly state: IssueState;
  /** One digest per `##` heading name, in the order the body first names them. */
  readonly headings: readonly HeadingDigest[];
}

/** A file's fingerprint: the blob sha git holds for it. */
export interface BlobFingerprint {
  readonly kind: 'blob';
  /** 40 hex digits, or 64 in a sha256 repository. */
  readonly sha: string;
}

/** A target that exists and has nothing further to hash. */
export interface PresentFingerprint {
  readonly kind: 'present';
}

/** A target that does not exist. */
export interface AbsentFingerprint {
  readonly kind: 'absent';
}

/** What a target reads as when it was read, and what a stamp keeps. */
export type Fingerprint = IssueFingerprint | BlobFingerprint | PresentFingerprint | AbsentFingerprint;

/** A target the reader could not reach: a cross-repository issue it may not read. */
export interface UnreadableTarget {
  readonly kind: 'unreadable';
}

/** What reading a target answers: its fingerprint, or that it could not be read. */
export type LiveReading = Fingerprint | UnreadableTarget;

/** The fingerprint of a symbol, command, flag or key that exists. */
export const PRESENT: PresentFingerprint = Object.freeze({ kind: 'present' });

/** The fingerprint of a target that does not exist. */
export const ABSENT: AbsentFingerprint = Object.freeze({ kind: 'absent' });

/** The reading of a target that could not be read. */
export const UNREADABLE: UnreadableTarget = Object.freeze({ kind: 'unreadable' });

/** What a reference reads as against its stamp; the module note holds the order. */
export type RefState = 'ok' | 'dangling' | 'suspect' | 'resolved' | 'unknown';

/** A reference's state and, for an issue, the headings whose text changed. */
export interface StampComparison {
  readonly state: RefState;
  /**
   * The headings whose digest differs, or that one side has and the
   * other does not: the live issue's order first, then the headings
   * only the stamp has. Empty for any target but an issue.
   */
  readonly changedHeadings: readonly string[];
}

/** What {@link compareToStamp} reads. */
export interface StampComparisonInput {
  /** The target as it reads now. */
  readonly live: LiveReading;
  /** The stamp the saved copy keeps, or null when it keeps none. */
  readonly stamp: Fingerprint | null;
  /** True when the body's `Blocked by:` line names the target. */
  readonly blocker: boolean;
}

/** One reference's stamp, as the block keeps it. */
export interface RefStamp {
  readonly kind: RefKind;
  readonly text: string;
  readonly fingerprint: Fingerprint;
}

/** A saved copy split into its stamps and its body. */
export interface RefsBlockReading {
  /** The stamps, or null when the copy carries no block. */
  readonly stamps: readonly RefStamp[] | null;
  /** The copy less the block and the blank line after it. */
  readonly body: string;
}

/** The line that opens the block. */
export const REFS_BLOCK_OPEN = '<!-- rafa:refs';

/** The line that closes the block. */
export const REFS_BLOCK_CLOSE = '-->';

/** A block the codec will not read: unclosed, not YAML, or holding an entry it would not write. */
export class RefsBlockError extends Error {
  constructor(problem: string, options?: ErrorOptions) {
    super(`rafa:refs block: ${problem}`, options);
    this.name = 'RefsBlockError';
  }
}

/** A `##` heading line. */
const SECTION_HEADING = /^ {0,3}##(?:[ \t]|$)/u;

/** A fenced block's opening or closing line: its fence run and what follows. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/** A sha256 digest in hex. */
const SHA256 = /^[0-9a-f]{64}$/u;

/** A git object id: sha1 or sha256, in hex. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** The characters a quoted block string escapes: `>`, and every control or format character. */
const ESCAPED = /[>\p{C}\p{Zl}\p{Zp}]/gu;

/** The fingerprints each kind of reference may be stamped with. */
const STAMPS_BY_KIND: Readonly<Record<RefKind, readonly Fingerprint['kind'][]>> = {
  'issue': ['issue', 'absent'],
  'cross-issue': ['issue', 'absent'],
  'path': ['blob', 'present', 'absent'],
  'symbol': ['present', 'absent'],
  'command': ['present', 'absent'],
  'flag': ['present', 'absent'],
  'key': ['present', 'absent'],
};

/** `text` with LF line breaks and no trailing whitespace on any line or at its end. */
export function normaliseIssueText(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

/** sha256 in hex over the UTF-8 of `text`. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8')
    .digest('hex');
}

/** A `##` heading as a section is named: its text without the `#` marks, or the line when that is empty. */
function sectionName(line: string): string {
  const text = line
    .trim()
    .replace(/^##/u, '')
    .replace(/[ \t]+#+$/u, '')
    .trim();
  return text === ''
    ? line.trim()
    : text;
}

/** One `##` section per heading name, its lines joined, in the order the body first names them. */
function sections(body: string): ReadonlyMap<string, readonly string[]> {
  const byName = new Map<string, string[]>();
  let current: string[] | null = null;
  let fence: { char: string; length: number } | null = null;

  for (const line of body.split('\n')) {
    const found = FENCE_LINE.exec(line);
    const run = found?.[1] ?? '';
    if (fence === null && found !== null) {
      fence = { char: run.charAt(0), length: run.length };
    } else if (fence !== null && run.charAt(0) === fence.char && run.length >= fence.length && (found?.[2] ?? '').trim() === '') {
      fence = null;
    } else if (fence === null && SECTION_HEADING.test(line)) {
      const name = sectionName(line);
      current = byName.get(name) ?? [];
      byName.set(name, current);
    }
    current?.push(line);
  }

  return byName;
}

/**
 * The fingerprint of an issue whose title, body and state were read as
 * given; the module note holds the normalisation and the sections.
 */
export function issueFingerprint(issue: { readonly title: string; readonly body: string; readonly state: IssueState }): IssueFingerprint {
  const title = normaliseIssueText(issue.title);
  const body = normaliseIssueText(issue.body);
  const headings = [...sections(body)].map(([name, lines]) => Object.freeze({ name, digest: sha256(lines.join('\n')) }));
  return Object.freeze({
    kind: 'issue',
    digest: sha256(JSON.stringify([title, body])),
    state: issue.state,
    headings: Object.freeze(headings),
  });
}

/** The fingerprint of a file whose blob sha is `sha`; throws a RangeError on anything but a git object id. */
export function blobFingerprint(sha: string): BlobFingerprint {
  if (!OBJECT_ID.test(sha)) throw new RangeError(`not a git object id: ${JSON.stringify(sha)}`);
  return Object.freeze({ kind: 'blob', sha });
}

/** A fingerprint in one word: `present`, `absent`, `blob:<sha>` or `sha256:<hex>`. */
export function fingerprintText(fingerprint: Fingerprint): string {
  switch (fingerprint.kind) {
    case 'issue': return `sha256:${fingerprint.digest}`;
    case 'blob': return `blob:${fingerprint.sha}`;
    case 'present':
    case 'absent': return fingerprint.kind;
  }
}

/** True when `a` and `b` fingerprint the same target text; an issue's state is not compared. */
export function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  return fingerprintText(a) === fingerprintText(b);
}

/** The headings whose digests differ between two issue fingerprints; the live order first. */
function changedHeadingsOf(stamp: Fingerprint, live: Fingerprint): readonly string[] {
  if (stamp.kind !== 'issue' || live.kind !== 'issue') return [];

  const old = new Map(stamp.headings.map((heading) => [heading.name, heading.digest]));
  const now = new Map(live.headings.map((heading) => [heading.name, heading.digest]));
  const names = [...now.keys(), ...[...old.keys()].filter((name) => !now.has(name))];
  return names.filter((name) => old.get(name) !== now.get(name));
}

/** A comparison, frozen. */
function comparison(state: RefState, changedHeadings: readonly string[] = []): StampComparison {
  return Object.freeze({ state, changedHeadings: Object.freeze([...changedHeadings]) });
}

/**
 * The state a reference reads as: its live fingerprint against the
 * stamp the saved copy keeps. The module note holds the rules and their
 * order. Never throws.
 */
export function compareToStamp(input: StampComparisonInput): StampComparison {
  const { live, stamp, blocker } = input;
  if (live.kind === 'unreadable') return comparison('unknown');
  if (stamp === null) {
    return comparison(live.kind === 'absent'
      ? 'dangling'
      : 'ok');
  }
  if (live.kind === 'absent') {
    return comparison(stamp.kind === 'absent'
      ? 'ok'
      : 'dangling');
  }
  if (stamp.kind === 'absent') return comparison('suspect');

  const changed = changedHeadingsOf(stamp, live);
  const closedSince = blocker
    && stamp.kind === 'issue' && stamp.state === 'open'
    && live.kind === 'issue' && live.state === 'closed';
  if (closedSince) return comparison('resolved', changed);
  if (sameFingerprint(stamp, live)) return comparison('ok');
  return comparison('suspect', changed);
}

/** The stamp `stamps` keeps for the reference of `kind` and `text`, or null when it keeps none. */
export function findStamp(stamps: readonly RefStamp[] | null, ref: { readonly kind: RefKind; readonly text: string }): Fingerprint | null {
  const found = stamps?.find((stamp) => stamp.kind === ref.kind && stamp.text === ref.text);
  return found?.fingerprint ?? null;
}

/** `text` as a double-quoted YAML string that cannot close the comment it sits in. */
function quoted(text: string): string {
  return JSON.stringify(text).replace(ESCAPED, (char) => {
    const point = char.codePointAt(0) ?? 0;
    return point > 0xffff
      ? `\\U${point.toString(16).padStart(8, '0')}`
      : `\\u${point.toString(16).padStart(4, '0')}`;
  });
}

/** The YAML lines of one stamp. */
function stampLines(stamp: RefStamp): readonly string[] {
  const { fingerprint } = stamp;
  const lines = [
    `  - kind: ${stamp.kind}`,
    `    text: ${quoted(stamp.text)}`,
    `    stamp: ${quoted(fingerprintText(fingerprint))}`,
  ];
  if (fingerprint.kind !== 'issue') return lines;

  const headings = fingerprint.headings.map((heading) => `      - [${quoted(heading.name)}, ${quoted(heading.digest)}]`);
  return [
    ...lines,
    `    state: ${fingerprint.state}`,
    ...headings.length === 0
      ? ['    headings: []']
      : ['    headings:', ...headings],
  ];
}

/**
 * `body` with the block holding `stamps` on its first lines, or `body`
 * as it is when `stamps` is null: {@link readRefsBlock}'s inverse.
 */
export function writeRefsBlock(body: string, stamps: readonly RefStamp[] | null): string {
  if (stamps === null) return body;

  const yaml = stamps.length === 0
    ? ['refs: []']
    : ['refs:', ...stamps.flatMap(stampLines)];
  return [REFS_BLOCK_OPEN, ...yaml, REFS_BLOCK_CLOSE, '', body].join('\n');
}

/** A plain object's own field, or undefined. */
function field(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.hasOwn(value, name)
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

/** `value` when it is a string, else a throw naming `what`. */
function stringField(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new RefsBlockError(`${what} is not a string`);
  return value;
}

/** An entry's `headings` list. */
function readHeadings(value: unknown, what: string): readonly HeadingDigest[] {
  if (!Array.isArray(value)) throw new RefsBlockError(`${what}: headings is not a list`);
  return value.map((pair: unknown, index) => {
    const at = `${what}: heading ${String(index + 1)}`;
    if (!Array.isArray(pair) || pair.length !== 2) throw new RefsBlockError(`${at} is not a [name, digest] pair`);
    const digest = stringField(pair[1], `${at} digest`);
    if (!SHA256.test(digest)) throw new RefsBlockError(`${at} digest is not sha256 hex`);
    return Object.freeze({ name: stringField(pair[0], `${at} name`), digest });
  });
}

/** The fingerprint an entry's `stamp` field, and an issue's state and headings, spell. */
function readFingerprint(entry: unknown, what: string): Fingerprint {
  const stamp = stringField(field(entry, 'stamp'), `${what}: stamp`);
  if (stamp === 'present') return PRESENT;
  if (stamp === 'absent') return ABSENT;
  if (stamp.startsWith('blob:') && OBJECT_ID.test(stamp.slice('blob:'.length))) {
    return blobFingerprint(stamp.slice('blob:'.length));
  }
  if (!stamp.startsWith('sha256:') || !SHA256.test(stamp.slice('sha256:'.length))) {
    throw new RefsBlockError(`${what}: stamp ${JSON.stringify(stamp)} is not a fingerprint`);
  }

  const state = field(entry, 'state');
  if (state !== 'open' && state !== 'closed') throw new RefsBlockError(`${what}: state is not open or closed`);
  return Object.freeze({
    kind: 'issue',
    digest: stamp.slice('sha256:'.length),
    state,
    headings: Object.freeze(readHeadings(field(entry, 'headings'), what)),
  });
}

/** One entry of the block, checked as {@link stampLines} writes it. */
function readStamp(entry: unknown, index: number): RefStamp {
  const what = `entry ${String(index + 1)}`;
  const kind = field(entry, 'kind');
  if (typeof kind !== 'string' || !Object.hasOwn(STAMPS_BY_KIND, kind)) {
    throw new RefsBlockError(`${what}: kind ${JSON.stringify(kind)} is not a reference kind`);
  }
  const refKind = kind as RefKind;
  const text = stringField(field(entry, 'text'), `${what}: text`);
  const fingerprint = readFingerprint(entry, what);
  if (!STAMPS_BY_KIND[refKind].includes(fingerprint.kind)) {
    throw new RefsBlockError(`${what}: a ${refKind} is not stamped ${fingerprintText(fingerprint)}`);
  }
  return Object.freeze({ kind: refKind, text, fingerprint });
}

/** The stamps the block's YAML holds. */
function parseStamps(yaml: string): readonly RefStamp[] {
  let document: unknown;
  try {
    document = Bun.YAML.parse(yaml);
  } catch (error) {
    throw new RefsBlockError('not valid YAML', { cause: error });
  }
  const refs = field(document, 'refs');
  if (!Array.isArray(refs)) throw new RefsBlockError('refs is not a list');

  const stamps = refs.map((entry: unknown, index) => readStamp(entry, index));
  const seen = new Set<string>();
  for (const stamp of stamps) {
    const id = `${stamp.kind} ${stamp.text}`;
    if (seen.has(id)) throw new RefsBlockError(`${id} is stamped twice`);
    seen.add(id);
  }
  return Object.freeze(stamps);
}

/**
 * The stamps a saved copy keeps and its body without the block: null
 * stamps and the copy as it is when its first line is not
 * {@link REFS_BLOCK_OPEN}. Throws {@link RefsBlockError} for a block
 * that does not close or does not hold what {@link writeRefsBlock}
 * writes.
 */
export function readRefsBlock(copy: string): RefsBlockReading {
  if (!copy.startsWith(`${REFS_BLOCK_OPEN}\n`)) return Object.freeze({ stamps: null, body: copy });

  const inner = REFS_BLOCK_OPEN.length + 1;
  const close = `\n${REFS_BLOCK_CLOSE}\n`;
  const end = copy.indexOf(close, inner - 1);
  if (end === -1) throw new RefsBlockError(`no ${REFS_BLOCK_CLOSE} line closes it`);

  const after = end + close.length;
  const body = copy.startsWith('\n', after)
    ? copy.slice(after + 1)
    : copy.slice(after);
  return Object.freeze({ stamps: parseStamps(copy.slice(inner, end + 1)), body });
}

/**
 * `text` with the block the saved copy `copy` carries, or `text` as it
 * is when there is no copy or it carries none: what a rewrite of a
 * saved copy keeps, so a refresh or a notes rebuild moves the stamps
 * across unchanged and the next check reads them against the new text.
 * Throws {@link RefsBlockError} as {@link readRefsBlock} does, before
 * the caller has touched anything.
 */
export function carryRefsBlock(copy: string | null, text: string): string {
  return writeRefsBlock(text, copy === null
    ? null
    : readRefsBlock(copy).stamps);
}
