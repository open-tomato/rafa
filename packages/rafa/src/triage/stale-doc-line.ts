/**
 * The text of one stale documentation line, as the release's stale-docs
 * issue holds it after its checklist box.
 *
 * {@link staleDocLineText} writes a {@link StaleDocEntry} as
 * `<where>: <what>`, or `<what>` when the entry named no place or a blank
 * one. Both are a session's text, so each goes through {@link oneLine}:
 * every run of white space (U+2028 and U+2029 included) one space, every
 * other control character and DEL dropped, so no entry can open a second
 * item or a heading, and a `!` between `<` and `--` written `\!`, as
 * `escapeBlockerText` writes it, so no entry opens an HTML comment that
 * would hide the rest of the body or forge the issue's marker.
 *
 * The module is pure: it reads no file, no git and no tracker. The issue
 * itself, its title, body and the calls that add or tick a line, stays in
 * `src/docs/release-issue.ts`, which reads both names from here.
 */

/** A run of white space, the line and paragraph separators included. */
const WHITE_SPACE = /\s+/g;

/** True for a control character that is not white space, or DEL. */
function isDroppedControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 0x08 || (code >= 0x0E && code <= 0x1F) || code === 0x7F;
}

/** A `!` that would open an HTML comment after a `<`. */
const COMMENT_OPEN = /(?<=<)!(?=--)/g;

/** One stale documentation line: where it is, and what no longer matches. */
export interface StaleDocEntry {
  /** The file, with the line when known, or null when none was named. */
  readonly where: string | null;
  /** What no longer matches. */
  readonly what: string;
}

/** `text` on one line, each white space run one space, no comment opened. */
export function oneLine(text: string): string {
  return Array.from(text)
    .filter((char) => !isDroppedControl(char))
    .join('')
    .replace(WHITE_SPACE, ' ')
    .trim()
    .replace(COMMENT_OPEN, '\\!');
}

/**
 * The text of the checklist item for `entry`, after its box:
 * `<where>: <what>`, or `<what>` when the entry named no place or a
 * blank one; see the module note for what is escaped.
 */
export function staleDocLineText(entry: StaleDocEntry): string {
  const what = oneLine(entry.what);
  const where = entry.where === null
    ? ''
    : oneLine(entry.where);
  return where === ''
    ? what
    : `${where}: ${what}`;
}
