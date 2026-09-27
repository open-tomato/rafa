/**
 * The epic guard: an optional GitHub Actions workflow that keeps an issue
 * in one epic at most, and the file `rafa init --board --epic-guard`
 * writes it to.
 *
 * An issue is a member of the epic whose `epic:<slug>` label it carries,
 * and an issue carrying two is a problem `./epic-problems.ts` reads and
 * `rafa issue ready`, `rafa doctor` and the views report. Nothing rafa
 * runs is there when somebody adds the second label on GitHub, and
 * GitHub's checks belong to commits and pull requests, not to issues, so
 * the one place a label can be answered as it lands is a workflow
 * triggered by `issues: [labeled]`. The shipped
 * `./templates/epic-guard.yml` is that workflow: when the label just added
 * starts with `epic:` and the issue carries another, it removes the one
 * just added with `gh issue edit --remove-label` and comments why. Which
 * label is kept, and why two labels added in one edit leave the same one
 * whichever run reads first, is the template's own header.
 *
 * The guard is optional: a repository without it is read exactly as
 * before, and `rafa doctor` still lists an issue with two `epic:` labels.
 * Whether it is written is `src/commands/init-board.ts`'s decision; this
 * module is where it lives and how it is written, through
 * `./setup.ts`'s {@link writeShippedFile}, so an existing file is left
 * byte for byte as it is and a directory at the path is refused.
 *
 * The template sits beside the spec issue template under
 * `./templates/`, and the build copies that tree's `*.md` and `*.yml` to
 * `dist/templates/`, where a bundle's own directory finds it.
 *
 * Nothing here reaches GitHub: the workflow is a file in the checkout
 * until somebody pushes it. `./epic-guard.test.ts` reads the shipped
 * template and writes under its own temporary root.
 */
import type { BoardPart } from './setup.js';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEMPLATES_DIRNAME, writeShippedFile } from './setup.js';

/** This module's own directory: where the shipped workflow is looked for. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The path the workflow is written to, under the project root. */
export const EPIC_GUARD_PATH = join('.github', 'workflows', 'epic-guard.yml');

/** The name the shipped workflow carries in the templates directory. */
export const EPIC_GUARD_FILE = 'epic-guard.yml';

/**
 * Where the shipped workflow is looked for: `templates/epic-guard.yml`
 * under this module's directory, which is `src/board/templates/` in a
 * checkout and `dist/templates/` in a build.
 */
export function epicGuardSource(moduleDir: string = MODULE_DIR): string {
  return join(moduleDir, TEMPLATES_DIRNAME, EPIC_GUARD_FILE);
}

/**
 * The text of the shipped workflow.
 *
 * @throws Error naming the path when the build dropped it.
 */
export function readEpicGuard(moduleDir: string = MODULE_DIR): string {
  const source = epicGuardSource(moduleDir);
  if (!existsSync(source)) {
    throw new Error(`board setup: the epic guard workflow is missing: no file at ${source}`);
  }
  return readFileSync(source, 'utf8');
}

/**
 * Writes {@link EPIC_GUARD_PATH} under `root` when nothing is at that
 * path, and answers its part: `created`, `present` for a file already
 * there, whatever it holds, or `refused` with the reason.
 */
export function writeEpicGuard(root: string, moduleDir: string = MODULE_DIR): BoardPart {
  return writeShippedFile(root, {
    path: EPIC_GUARD_PATH,
    source: epicGuardSource(moduleDir),
    what: 'the workflow',
    read: () => readEpicGuard(moduleDir),
  });
}
