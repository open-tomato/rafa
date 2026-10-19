/**
 * The context rafa fills in a bug record itself (#951): the code
 * version, the `Versions` section and the error line. The place it
 * suggests is `./places.ts`'s.
 *
 *   - **The code version** is the short commit of the checkout and
 *     whether a TRACKED file has changes, as `git describe --dirty`
 *     counts them: an untracked file is no change to the code that ran.
 *     Outside a repository there is no commit, and the section says
 *     `unknown`.
 *   - **The `Versions` section** holds one `name: value` line for the
 *     rafa version, the code version, the package the error's file
 *     belongs to (`src/project/package-of.ts`) and that file's path,
 *     relative to the project root. The last two are left out when there
 *     is none.
 *   - **The error line** is the artifact's first line that is not blank,
 *     through the stripping triage's recurrence key uses
 *     (`keyText`, `../triage/bug-key.ts`), so two runs of one failure
 *     give one line.
 */
import type { PackageOwner } from '../project/package-of.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { keyText } from '../triage/bug-key.js';

/** The commit a checkout is on, and whether a tracked file has changes. */
export interface CodeVersion {
  /** The short commit, or null outside a repository. */
  readonly commit: string | null;
  readonly dirty: boolean;
}

/** What follows the commit of a tree with changes. */
export const DIRTY_MARK = '-dirty';

/** What the section says for a checkout with no commit. */
export const NO_COMMIT = 'unknown';

/** The code version of the checkout `git` runs in; see the module note. */
export function codeVersionOf(git: GitRunner): CodeVersion {
  const head = git(['rev-parse', '--short', 'HEAD']);
  const commit = head.stdout.trim();
  if (!head.ok || commit === '') return { commit: null, dirty: false };
  const status = git(['status', '--porcelain', '--untracked-files=no']);
  return { commit, dirty: status.ok && status.stdout.trim() !== '' };
}

/** What the `Versions` section is written from. */
export interface VersionFacts {
  /** The rafa version that files the bug. */
  readonly rafa: string;
  readonly code: CodeVersion;
  /** The package the error's file belongs to, or null for none. */
  readonly owner: PackageOwner | null;
  /** The error's file, relative to the project root, or null for none. */
  readonly path: string | null;
}

/** A package as one word: its name, and its version when it has one. */
function packageText(owner: PackageOwner): string {
  return owner.version === null
    ? owner.name
    : `${owner.name}@${owner.version}`;
}

/** A code version as one word. */
function codeText(code: CodeVersion): string {
  if (code.commit === null) return NO_COMMIT;
  return code.dirty
    ? `${code.commit}${DIRTY_MARK}`
    : code.commit;
}

/** The text of the `Versions` section; see the module note. */
export function versionsText(facts: VersionFacts): string {
  return [
    `rafa: ${facts.rafa}`,
    `code: ${codeText(facts.code)}`,
    ...facts.owner === null
      ? []
      : [`package: ${packageText(facts.owner)}`],
    ...facts.path === null
      ? []
      : [`path: ${facts.path}`],
  ].join('\n');
}

/** The error line of `artifact`, or null for a blank one; see the module note. */
export function errorLineOf(artifact: string): string | null {
  const first = artifact.split(/\r?\n/).find((line) => line.trim() !== '');
  return first === undefined
    ? null
    : keyText(first);
}
