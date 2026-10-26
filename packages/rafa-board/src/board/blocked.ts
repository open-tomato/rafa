/**
 * The dependency between two issues, as data: the `spec:blocked` label,
 * the `Blocked by: #24 #26` line read out of an issue body, and the four
 * readings this refuses to guess at.
 *
 * `spec:ready` and `spec:needs-work` say whether the SPEC is complete
 * (`./readiness.ts`, `./gate.ts`). {@link SPEC_BLOCKED_LABEL} says
 * something else: the work WAITS on other issues, and an issue may be
 * ready and blocked at once, so the label is read beside those two and
 * never instead of them
 * (`.rafa/specs/rafa-63-one-command-next-step.md`). A blocker is
 * CLEARED when its issue is closed, which is a question for the board
 * and not for this module: nothing here spawns `gh`, opens a file or
 * asks an issue's state. {@link readBlockedBy} is a pure function over
 * the body text and the issue's own number, so every case in
 * `./blocked.test.ts` is a literal string.
 *
 * ## The four readings it refuses to guess at
 *
 * The spec asks for an issue labelled `spec:blocked` with no
 * `Blocked by:` line, or a line naming itself or an id the board has no
 * issue for, to be REPORTED and never guessed at. A fourth falls out of
 * reading the line at all: one that parses to nothing, `Blocked by: the
 * API work`, which names a dependency no code can follow. So
 * {@link BlockedReading.kind} is one of five words, four of them faults:
 *
 *  - `no-line` — the body carries no `Blocked by:` line.
 *  - `no-ids` — a line is there and names no local `#<n>`.
 *  - `self-reference` — the line names the issue it sits in.
 *  - `unknown-issue` — the line names an id the board has no issue for.
 *  - `blocked` — the only reading a caller may ACT on.
 *
 * A fault still carries what parsed, in {@link BlockedReading.blockers},
 * {@link BlockedReading.unknown} and {@link BlockedReading.foreign}, because the report names what was
 * read. It is there to be PRINTED, not to be acted on: an `unblock` run
 * that took a self-referencing line's ids and removed the label would be
 * guessing at exactly the thing the spec says not to guess at. Check
 * `kind === 'blocked'` first, every time.
 *
 * Faults are reported one at a time, in the order above, because each
 * one is a single thing to fix and a list of them would read as several.
 * A line naming both itself and an unknown id is a `self-reference`: the
 * typo is about the issue at hand, and fixing it is what turns the rest
 * of the line into something worth checking.
 *
 * ## The unknown check is the caller's to enable
 *
 * `known` is optional, and when it is left out no id is unknown. This
 * module cannot list a board, and a reader that called every absent id
 * unknown would report every blocker on every board it was not handed.
 * A caller that HAS the board's open and closed issue numbers passes
 * them and gets the fourth reading; one that has not asked yet gets the
 * other three and can ask later.
 *
 * ## What the line looks like
 *
 * `Blocked by: #24 #26`, matched case-insensitively at the start of a
 * line, after up to three spaces and an optional `-`, `*` or `+` bullet,
 * with the emphasis a person may dress it in (`**Blocked by:** #24`)
 * taken off. The colon is required — `Blocked by #24` is prose about
 * being blocked, and the spec writes the field with its colon.
 *
 * Ids are `#<digits>` and nothing else. A bare `24` on the line is not
 * an id: a line reading `Blocked by: the 2 specs` would otherwise name
 * issue #2. Whatever sits between them is separator — a comma, the word
 * `and`, a dash — so no punctuation the author chose changes the
 * reading. An id repeated is read once, in the order the line first
 * names it.
 *
 * ## A blocker on another repository
 *
 * `Blocked by: #24 open-tomato/agentic-research#12` names two blockers,
 * and only the first is on this board. An `owner/repo#<n>` token is
 * kept, exactly as written, in {@link BlockedReading.foreign} and is
 * NOT read as the local id `#<n>`: reading it that way would wait on
 * whatever this board numbers 12, or call the line a self-reference
 * when that number is the issue's own. A foreign token is never checked
 * against `known` either, since `known` is this board's numbers. The
 * token is `owner/repo` spelled as GitHub spells them — letters,
 * digits and `-` for the owner, those plus `.` and `_` for the
 * repository — with `#<digits>` straight after, and is read once when
 * repeated, in line order.
 *
 * What the kind says is about LOCAL ids alone, so a line naming no
 * foreign token reads exactly as it did before foreign tokens were
 * read. A line naming only foreign tokens is `no-ids`, a fault: nothing
 * on this board can clear it, and a `blocked` reading with no local
 * blocker would read to `rafa issue unblock` as every blocker closed.
 * Its fault sentence names the foreign tokens instead of calling the
 * line empty. A foreign blocker's state is not this module's to ask,
 * as a local one's is not.
 *
 * A line inside a fenced block is not the field. That matters more here
 * than it looks: this repository's own specs QUOTE the line while
 * describing it, and a reader that took those would find a spec about
 * blocking blocked by the issues in its example. The first field line
 * outside a fence is the one; a second is left alone, so a body that
 * carries the field twice is read as the document's first answer rather
 * than as two half-answers merged.
 */

/** The label that says the work waits on other issues. */
export const SPEC_BLOCKED_LABEL = 'spec:blocked';

/** What the line is called, as a report spells it and an author writes it. */
export const BLOCKED_BY_FIELD = 'Blocked by';

/** What a body's `Blocked by:` line was read as. */
export type BlockedReadingKind =
  /** The line named issues, none of them this one or unknown. */
  | 'blocked'
  /** The body carries no `Blocked by:` line. */
  | 'no-line'
  /** A line is there and names no local `#<n>`; it may name foreign ones. */
  | 'no-ids'
  /** The line names the issue it sits in. */
  | 'self-reference'
  /** The line names an id the board has no issue for. */
  | 'unknown-issue';

/** One issue's `Blocked by:` line, read. */
export interface BlockedReading {
  /** What it was read as; only `blocked` may be acted on. */
  readonly kind: BlockedReadingKind;
  /** The issue whose body this was, as the report names it. */
  readonly issue: number;
  /** The 1-based line the field sits on, or null when there is none. */
  readonly line: number | null;
  /** What the line said after the colon, trimmed, or null when there is none. */
  readonly text: string | null;
  /** Every local id the line named, deduped and in line order. */
  readonly blockers: readonly number[];
  /** Every `owner/repo#<n>` the line named, as written, deduped and in line order. */
  readonly foreign: readonly string[];
  /** The named ids `known` has no issue for, in line order. */
  readonly unknown: readonly number[];
}

/** A fenced block's opening or closing line. */
const FENCE_LINE = /^ {0,3}(?:```|~~~)/u;

/** The field line: indent, an optional bullet, the name dressed or bare, a colon. */
const FIELD_LINE = /^ {0,3}(?:[-*+]\s+)?[*_]{0,2}blocked\s+by[*_]{0,2}\s*:(.*)$/iu;

/** An issue id as the line names it; nothing but this counts. */
const ISSUE_ID = /#(\d+)/gu;

/** An issue on another repository, `owner/repo#<n>`, as GitHub spells the names. */
const FOREIGN_ID = /[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+#\d+/gu;

/** What an author must do about a fault; one clause, spelled once. */
const REMEDY = `name them as "${BLOCKED_BY_FIELD}: #24 #26", or take the ${SPEC_BLOCKED_LABEL} label off`;

/** True when `labels` carries {@link SPEC_BLOCKED_LABEL}, whatever its case. */
export function hasSpecBlockedLabel(labels: readonly string[]): boolean {
  return labels.some((label) => label.trim().toLowerCase() === SPEC_BLOCKED_LABEL);
}

/** One line of a body: its 1-based number and the text after the colon. */
interface FieldLine {
  /** Its 1-based number, as a report names it. */
  readonly number: number;
  /** What it said after the colon, trimmed. */
  readonly text: string;
}

/** The first `Blocked by:` line outside a fence, or null when there is none. */
function findFieldLine(body: string): FieldLine | null {
  const lines = body.split('\n').map((line) => line.replace(/\r$/u, ''));
  let fenced = false;

  for (const [index, line] of lines.entries()) {
    if (FENCE_LINE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const found = FIELD_LINE.exec(line);
    if (found === null) continue;
    return { number: index + 1, text: (found[1] ?? '').trim() };
  }

  return null;
}

/** Every `#<n>` in `text`, deduped, in the order the text first names them. */
function idsIn(text: string): readonly number[] {
  const found: number[] = [];
  for (const match of text.matchAll(ISSUE_ID)) {
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || id < 1 || found.includes(id)) continue;
    found.push(id);
  }
  return found;
}

/** Every `owner/repo#<n>` in `text`, as written, deduped, in line order. */
function foreignIn(text: string): readonly string[] {
  const found: string[] = [];
  for (const [token] of text.matchAll(FOREIGN_ID)) {
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

/** What a field line named: its local ids and its foreign tokens. */
interface Named {
  /** The local ids, deduped, in line order. */
  readonly ids: readonly number[];
  /** The foreign tokens, as written, deduped, in line order. */
  readonly foreign: readonly string[];
}

/** No ids and no foreign tokens: what a body with no line names. */
const NAMED_NOTHING: Named = { ids: [], foreign: [] };

/** One reading, spelled. */
function reading(
  kind: BlockedReadingKind,
  issue: number,
  found: FieldLine | null,
  named: Named,
  unknown: readonly number[],
): BlockedReading {
  return {
    kind,
    issue,
    line: found?.number ?? null,
    text: found?.text ?? null,
    blockers: named.ids,
    foreign: named.foreign,
    unknown,
  };
}

/**
 * The `Blocked by:` line in `body`, read for the issue numbered
 * `issue`: the local ids and foreign `owner/repo#<n>` tokens it names,
 * or which of the four faults it is.
 *
 * `known` is the board's issue numbers, open and closed alike, and is
 * optional; the module note holds why an absent one makes no id
 * unknown. Never throws and never asks anything of the board: a caller
 * that wants each blocker's state asks for it after this answers
 * `blocked`.
 *
 * Nothing here reads the LABEL. An issue may carry a `Blocked by:` line
 * without `spec:blocked`, and an issue may carry the label with no
 * line — which is the `no-line` fault, and only a caller that checked
 * {@link hasSpecBlockedLabel} knows it is worth reporting.
 */
export function readBlockedBy(
  issue: number,
  body: string,
  known?: ReadonlySet<number>,
): BlockedReading {
  const found = findFieldLine(body);
  if (found === null) return reading('no-line', issue, null, NAMED_NOTHING, []);

  const foreign = foreignIn(found.text);
  const ids = idsIn(found.text.replace(FOREIGN_ID, ' '));
  const named = { ids, foreign };
  if (ids.length === 0) return reading('no-ids', issue, found, named, []);

  const unknown = known === undefined
    ? []
    : ids.filter((id) => id !== issue && !known.has(id));

  if (ids.includes(issue)) return reading('self-reference', issue, found, named, unknown);
  if (unknown.length > 0) return reading('unknown-issue', issue, found, named, unknown);

  return reading('blocked', issue, found, named, unknown);
}

/** `#24 #26`, the way a report names a list of ids. */
function nameIds(ids: readonly number[]): string {
  return ids.map((id) => `#${String(id)}`).join(' ');
}

/** What a fault says, before the remedy. */
function faultClause(read: BlockedReading): string {
  const at = `on line ${String(read.line ?? 0)}`;

  if (read.kind === 'no-line') {
    return `is labelled ${SPEC_BLOCKED_LABEL} and its body carries no "${BLOCKED_BY_FIELD}:" line`;
  }
  if (read.kind === 'no-ids' && read.foreign.length > 0) {
    return `has a "${BLOCKED_BY_FIELD}:" line ${at} naming only issues on other repositories: ${read.foreign.join(' ')}`;
  }
  if (read.kind === 'no-ids') {
    return `has a "${BLOCKED_BY_FIELD}:" line ${at} naming no issue: "${read.text ?? ''}"`;
  }
  if (read.kind === 'self-reference') {
    return `has a "${BLOCKED_BY_FIELD}:" line ${at} naming itself`;
  }
  return `has a "${BLOCKED_BY_FIELD}:" line ${at} naming ${nameIds(read.unknown)}, which the board has no issue for`;
}

/**
 * The sentence a fault is REPORTED with: the issue, what is wrong with
 * its line, and what an author must do about it. `rafa doctor` and
 * `rafa issue unblock` both print it, so an operator reads one wording
 * wherever the fault surfaced.
 *
 * Throws a `TypeError` for a `blocked` reading, as `./readiness.ts` and
 * `./leak.ts` do for a clean one: an issue whose line reads has no
 * fault to name.
 */
export function blockedFaultMessage(read: BlockedReading): string {
  if (read.kind === 'blocked') {
    throw new TypeError(
      `board blocked: #${String(read.issue)} names ${nameIds(read.blockers)} and has no fault to report`,
    );
  }

  return `#${String(read.issue)} ${faultClause(read)}; ${REMEDY}`;
}
