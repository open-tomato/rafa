/**
 * Gate 3 of `rafa issue edit`, the text: the leak refusal over the text
 * an edit adds, and the completeness refusal over the whole new body of
 * a spec that was complete before the edit
 * (`.rafa/specs/rafa-812-spec-rafa-issue-edit.md`).
 *
 * Nothing here reads or writes the board. The command hands
 * {@link requireEditText} the body it read, the text it is about to add
 * and the body it is about to write, and runs it before any write, so a
 * refused edit leaves nothing behind on the board.
 *
 * ## The added text
 *
 * `requireNoLeak` (`./leak.ts`) runs over the ADDED text alone: for an
 * append the text below the `Updated` heading, for a replace the whole
 * new body. The body already on the board is not this edit's to refuse;
 * a leak in it was published before the edit and stays the author's to
 * remove. The added text is read before the completeness check, so an
 * edit that both leaks and breaks the template is refused for the leak,
 * the refusal that matters on a public board.
 *
 * What the leak check reads for is `./leak.ts`'s: home paths and token
 * shapes. A LAN hostname on its own (`buildbox.lan`) is not one of its
 * shapes, so a text naming one is refused only when it also holds a
 * home path or a token.
 *
 * ## The whole new body
 *
 * For an issue labelled `type:spec` (`SPEC_LABEL`, `./issue.ts`) whose
 * body read before the edit passes `requireCompleteSpec`
 * (`./readiness.ts`), the body after the edit must pass it too, so an
 * append never leaves a ready spec failing its template
 * ({@link completenessApplies}). A spec that was
 * already incomplete is not held to it: the edit cannot make it fail a
 * check it already failed, and refusing would block the very edit that
 * fills it in. An issue without the label is never held to it.
 *
 * Both refusals throw `CommandExit(2, ...)` with the sentence the
 * module they come from words, `LEAK_REFUSAL_EXIT` and
 * `READINESS_REFUSAL_EXIT` both being 2.
 */
import { hasSpecLabel } from './issue.js';
import { requireNoLeak } from './leak.js';
import { findReadinessGaps, requireCompleteSpec } from './readiness.js';

/** What gate 3 is handed: the issue and the three texts of one edit. */
export interface EditTextInput {
  /** The issue's number, which each refusal names. */
  readonly issue: number;
  /** The issue's labels as read before the edit. */
  readonly labels: readonly string[];
  /** The body read before the edit. */
  readonly before: string;
  /** The text the edit adds: an append's text, or a replace's whole body. */
  readonly added: string;
  /** The whole body the edit would write. */
  readonly after: string;
}

/** What the leak refusal names the added text as. */
export function addedTextSource(issue: number): string {
  return `the text added to issue #${String(issue)}`;
}

/** What the completeness refusal names the new body as. */
export function editedBodySource(issue: number): string {
  return `issue #${String(issue)} as edited`;
}

/**
 * True when the whole new body is held to the completeness check: the
 * issue carries `type:spec` and its body before the edit has no
 * readiness gap.
 */
export function completenessApplies(labels: readonly string[], before: string): boolean {
  return hasSpecLabel(labels) && findReadinessGaps(before).length === 0;
}

/**
 * Lets an edit's text through, and throws `CommandExit(2, ...)` for
 * added text carrying a leak or, when {@link completenessApplies}, a new
 * body failing the spec template. The leak is checked first.
 */
export function requireEditText(input: EditTextInput): void {
  requireNoLeak(addedTextSource(input.issue), input.added);
  if (!completenessApplies(input.labels, input.before)) return;
  requireCompleteSpec(editedBodySource(input.issue), input.after);
}
