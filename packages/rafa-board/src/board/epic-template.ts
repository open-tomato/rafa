/**
 * The epic issue template, and the body `rafa epic new` creates an epic
 * with.
 *
 * The shipped `./templates/epic.md` is the body whole: an
 * `Acceptance criteria` section holding one placeholder line, a `Scope`
 * section carrying the `Estimate:`, `Date:` and `Owns:` lines with
 * nothing after their colons, and a `Specs` section with no checklist
 * line under it. It sits beside the spec issue template, and the build
 * copies that tree's `*.md` to `dist/templates/`, where a bundle's own
 * directory finds it, as `./epic-guard.ts` finds its workflow.
 *
 * ## What `readEpicBody` makes of it
 *
 * `./epic-body.ts` reads the rendered body, and `./epic-template.test.ts`
 * holds each reading:
 *
 * - The CRITERIA are the placeholder line alone. The `Scope` heading is
 *   there so the section ends before the field lines: a criteria heading
 *   with no heading after it runs to the end of the body, field lines and
 *   checklist included, and all of that would reach the planner verbatim.
 * - The ESTIMATE is null and reported as `no-estimate` on its line, which
 *   is the truth of a new epic: an author owes one.
 * - The DATE is null, and a `Date:` line with nothing after its colon is
 *   ALSO reported as `malformed-date`, text `""`. That is the reader's
 *   rule for any `Date:` line that is not a day, not a choice made here;
 *   the date is optional and the epic is read as having none, which is
 *   what a blank line means.
 * - The OWNS list is empty: an empty `Owns:` line reads as no folders.
 *   A placeholder folder would be read as a folder, so the guidance sits
 *   in the comment above the line rather than on it.
 * - The CHECKLIST is empty. The `Specs` heading is the body's last, so a
 *   line appended at the end of the body lands under it.
 *
 * No comment in the template opens a line with a field name, so no
 * guidance is read as a field, and none sits inside the criteria section,
 * whose text is kept as written.
 *
 * ## The placeholders are named
 *
 * {@link CRITERIA_PLACEHOLDERS} holds each placeholder line exactly as the
 * template writes it, and {@link placeholderCriteria} answers the ones a
 * criteria section still holds, each with the reason it reads as
 * UNCHECKED: a placeholder states nothing a check against main could
 * hold, so the closing gate treats it as a criterion it could not check
 * rather than one that passed. A line is a placeholder when, trimmed, it
 * equals one of them; a line an author edited, however little, is the
 * author's own criterion and is read as written.
 *
 * {@link renderEpicBody} reads the template it is handed through
 * `readEpicBody` before answering it, and throws when that reading has
 * no criteria, holds a checklist line or has lost a placeholder, so an
 * edited template fails where it is rendered rather than creating an
 * epic the gate cannot read.
 *
 * Nothing here reaches GitHub; reading the shipped file is the one
 * effect, and every function takes the directory it reads from.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEpicBody } from './epic-body.js';
import { TEMPLATES_DIRNAME } from './setup.js';

/** This module's own directory: where the shipped template is looked for. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The name the shipped epic template carries in the templates directory. */
export const EPIC_TEMPLATE_FILE = 'epic.md';

/** Every placeholder line the template's criteria section holds, as written. */
export const CRITERIA_PLACEHOLDERS: readonly string[] = Object.freeze([
  '- Placeholder: one line per thing that makes this epic finished,'
  + ' written so a check against main can tell whether it holds.',
]);

/** Why a placeholder line reads as unchecked, as a report prints it. */
export const PLACEHOLDER_REASON = 'the line is still the epic template\'s placeholder, so there is nothing to check';

/** A placeholder line a criteria section still holds. */
export interface UncheckedPlaceholder {
  /** The line, trimmed, as the template writes it. */
  readonly text: string;
  /** Why it reads as unchecked: {@link PLACEHOLDER_REASON}. */
  readonly reason: string;
}

/**
 * Where the shipped template is looked for: `templates/epic.md` under
 * this module's directory, which is `src/board/templates/` in a checkout
 * and `dist/templates/` in a build.
 */
export function epicTemplateSource(moduleDir: string = MODULE_DIR): string {
  return join(moduleDir, TEMPLATES_DIRNAME, EPIC_TEMPLATE_FILE);
}

/**
 * The text of the shipped template.
 *
 * @throws Error naming the path when the build dropped it.
 */
export function readEpicTemplate(moduleDir: string = MODULE_DIR): string {
  const source = epicTemplateSource(moduleDir);
  if (!existsSync(source)) {
    throw new Error(`epic template: the epic issue template is missing: no file at ${source}`);
  }
  return readFileSync(source, 'utf8');
}

/**
 * The placeholder lines `criteria` still holds, in the order it holds
 * them, each read as unchecked. Empty for null criteria and for criteria
 * holding none.
 */
export function placeholderCriteria(criteria: string | null): readonly UncheckedPlaceholder[] {
  if (criteria === null) return Object.freeze([]);

  const held = criteria.split(/\r\n?|\n/u)
    .map((line) => line.trim())
    .filter((line) => CRITERIA_PLACEHOLDERS.includes(line));
  return Object.freeze(held.map((text) => Object.freeze({ text, reason: PLACEHOLDER_REASON })));
}

/**
 * The body a new epic is created with: `template`, once `readEpicBody`
 * reads criteria holding every placeholder and an empty checklist in it.
 *
 * @throws Error naming what the reading lacks when the template is not
 *   such a body.
 */
export function renderEpicBody(template: string = readEpicTemplate()): string {
  const read = readEpicBody(template);

  if (read.criteria === null) {
    throw new Error('epic template: the template carries no acceptance criteria section with a placeholder under it');
  }
  const missing = CRITERIA_PLACEHOLDERS.length - placeholderCriteria(read.criteria).length;
  if (missing > 0) {
    throw new Error(`epic template: the acceptance criteria section has lost ${String(missing)} of its placeholder lines`);
  }
  if (read.lines.length > 0) {
    throw new Error(`epic template: the template carries ${String(read.lines.length)} checklist lines; a new epic has none`);
  }
  return template;
}
