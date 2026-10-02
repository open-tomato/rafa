/**
 * The key a bug is looked up by, and the artifact it is built from; loop-
 * owned triage (`./triage.ts`) files and looks up every public bug by it.
 *
 * A bug's recurrence key is its artifact WITH the file it was reported
 * against: the base name of the task's tracker file, then the artifact on
 * one line, joined by {@link KEY_SEPARATOR} ({@link bugKeyOf}). The
 * artifact alone is not the defect. Two plans quoting one error string
 * report two different bugs, and keying on that string alone commented the
 * second on the first one's issue; keyed by the file as well, they stay
 * two issues, and two wordings of one defect under one file stay one.
 *
 * The artifact a key is built from has its local paths taken out
 * (`./local-paths.ts`), so one bug keys the same on every machine and a
 * key never holds a user's name. Every key builder takes that artifact,
 * #486's test-failure key too. Step 1 of `./triage.ts`'s public lookup
 * also asks the store for the legacy key, built from the artifact with its
 * paths, when the two differ.
 *
 * A bug with no artifact has no key (roadmap Q18): it is filed every time,
 * with no lookup and no reference stored. An artifact that is blank, or
 * that holds a lone UTF-16 surrogate, which the store cannot key a
 * reference by, counts as none ({@link artifactOf}).
 */
import type { ReportBug } from '../report/parse.js';

import { basename } from 'node:path';

import { textProblem } from '../effort/store/findings.js';

/** What stands between a bug's file and its artifact in its key. */
export const KEY_SEPARATOR = ': ';

/** True for text with something in it. */
export function hasText(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A bug's artifact when it can key a reference, or null; see the module note. */
export function artifactOf(bug: ReportBug): string | null {
  return hasText(bug.artifact) && textProblem(bug.artifact) === null
    ? bug.artifact
    : null;
}

/** `text` on one line, every run of whitespace one space, trimmed. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The key a bug's issue is looked up and kept under: the base name of the
 * tracker file it was reported against, then its artifact on one line,
 * joined by {@link KEY_SEPARATOR}. The base name, rather than the path, so
 * one plan keys the same from two checkouts; see the module note.
 */
export function bugKeyOf(trackerPath: string, artifact: string): string {
  return `${basename(trackerPath)}${KEY_SEPARATOR}${oneLine(artifact)}`;
}
