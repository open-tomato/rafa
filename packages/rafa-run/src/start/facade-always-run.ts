/**
 * The facade tests a task's added deep imports reach: for each added line
 * of the task's diff that imports `@open-tomato/<pkg>/<path>` from a file
 * outside `packages/<pkg>/`, the test `packages/<pkg>/index.test.ts`, when
 * the checkout holds one. The task step (`runTaskStep`,
 * `suite-task-step.ts`) joins them to its `tests.alwaysRun` files.
 *
 * ## Why the facade test needs a join of its own
 *
 * A facade test holds a package's `index.ts` to the names the rest of the
 * tree takes from the package (`scripts/survey/facade-check.ts`), none
 * missing and none extra. A task that adds a deep import from outside the
 * package can take a name the facade lacks, and no other part of the task
 * step reads the facade test:
 *
 * - `bun test --changed=<base>` follows the import graph from the changed
 *   files, and `packages/<pkg>/index.test.ts` imports none of them: the
 *   importing file is outside the package and imports the deep path, not
 *   the test.
 * - `tests.alwaysRun` names content sweeps by glob, by default each
 *   `*.sweep.test.ts` under `src/`, and `index.test.ts` matches no such
 *   glob.
 * - `tsc` resolves a deep path through the package's `exports` map
 *   (`"./*": "./src/*.ts"`) without reading `index.ts`, so the type step
 *   stays green.
 *
 * So a task passed every loop step and CI failed on the facade test after
 * the merge, as it did after #1480 (fixed by #1623). Run alone from the
 * checkout root, `bun test packages/rafa-board/index.test.ts` took 7.55s
 * and 7.48s by bun's own time (`4 pass, 0 fail`), so the join runs only the
 * facade tests the diff reaches rather than all of them.
 *
 * ## What is read
 *
 * `git diff --unified=0 --no-renames --no-color <base> HEAD`, the range
 * `readDiff` in `suite-step.ts` names the task's changed files from. Only
 * added lines count, a `+` line inside a hunk, and only in a script file
 * (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`): a
 * Markdown page quoting an import runs no facade check. A line counts when
 * it carries a deep specifier after `from` (a single-line `import` or
 * `export … from`, an `import type`, and the closing `} from '…'` line of
 * a multi-line import, the one line of it that holds the specifier), after
 * a bare `import`, or inside a dynamic `import(…)`, in single or double
 * quotes. `--no-renames` reads a moved file as all its lines added, so a
 * file moved out of a package is read as importing into it anew.
 *
 * Each file's path is read from its `+++ b/<path>` header, before its
 * first hunk. Measured on git 2.53.0: a path with a space is written
 * unquoted with a tab after it (`+++ b/a b.ts\t`), and one with a
 * non-ASCII byte is quoted (`+++ "b/\303\251.ts"`); both are read back as
 * the path. A deleted file's `+++ /dev/null` header names no file and has
 * no added line.
 *
 * ## What adds nothing
 *
 * - A root specifier, `@open-tomato/<pkg>` with no path after it: `tsc`
 *   already fails on a root name `index.ts` lacks.
 * - A deep import from a file under `packages/<pkg>/`, for that `<pkg>`:
 *   a package reaching its own deep paths is no facade use.
 * - A `<pkg>` with no `packages/<pkg>/index.test.ts` in the checkout. The
 *   file's existence is the whole rule, so a package that gains a facade
 *   test is read with no list to keep, and a project with none gets
 *   nothing added.
 * - A removed line, and so a removed deep import, which leaves an `extra`
 *   name in the facade for the next sweep to find.
 * - A diff git does not answer: the reader warns and answers none, and the
 *   step runs what it ran before the reader existed. It never throws.
 *
 * The answer is sorted by test path, each test once, beside the first file
 * in diff order that reached it, which the step's printout names.
 */
import type { GitRunner } from '@open-tomato/rafa-pr';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { unquoteGitPath } from '@open-tomato/rafa/core/git';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { gitSaid } from '@open-tomato/rafa-pr';

/** One facade test the task's diff reaches, with the file whose added import reached it. */
export interface FacadeCheck {
  /** The facade test, `packages/<pkg>/index.test.ts`, relative to the checkout root. */
  readonly test: string;
  /** The first file, in diff order, that added a deep import of `<pkg>`. */
  readonly file: string;
}

/** The file name of a package's facade test. */
const FACADE_TEST = 'index.test.ts';

/** The extensions of the files whose added lines are read; see the module note. */
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

/**
 * A deep `@open-tomato/<pkg>/<path>` specifier after `from` or `import`,
 * or inside `import(`, in either quote; group 2 is `<pkg>`.
 */
const DEEP_SPECIFIER = /\b(?:from|import)\s*\(?\s*(['"])@open-tomato\/([a-z0-9][a-z0-9._-]*)\/[^'"\n]+\1/g;

/** The header naming the new side of a file in the diff. */
const NEW_SIDE = '+++ ';

/** One added line of the diff, with the file it was added to. */
interface AddedLine {
  readonly file: string;
  readonly text: string;
}

/**
 * The path a `+++` header names, or null for `/dev/null`. The tab git
 * writes after a path holding a space is dropped; see the module note.
 */
function newSidePath(header: string): string | null {
  const raw = unquoteGitPath(header.slice(NEW_SIDE.length).replace(/\t$/, ''));
  return raw.startsWith('b/')
    ? raw.slice(2)
    : null;
}

/** The added lines of a `--unified=0` diff, each with its file, in diff order. */
function addedLines(diff: string): readonly AddedLine[] {
  const added: AddedLine[] = [];
  let file: string | null = null;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
      inHunk = false;
    } else if (!inHunk && line.startsWith(NEW_SIDE)) {
      file = newSidePath(line);
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && file !== null && line.startsWith('+')) {
      added.push({ file, text: line.slice(1) });
    }
  }
  return added;
}

/** The packages whose deep paths `line` imports from outside them. */
function reachedPackages(line: AddedLine): readonly string[] {
  if (!SCRIPT_FILE.test(line.file)) return [];
  return [...line.text.matchAll(DEEP_SPECIFIER)]
    .map((match) => match[2] ?? '')
    .filter((name) => name !== '' && !line.file.startsWith(`packages/${name}/`));
}

/** Orders two checks by test path, compared by code unit rather than by locale. */
function byTest(left: FacadeCheck, right: FacadeCheck): number {
  if (left.test === right.test) return 0;
  return left.test < right.test
    ? -1
    : 1;
}

/**
 * The facade tests `git`'s diff from `base` to `HEAD` reaches through an
 * added deep import, among those `root` holds. None, with a warning, when
 * git does not answer. See the module note.
 */
export function readFacadeAlwaysRun(git: GitRunner, base: string, root: string): readonly FacadeCheck[] {
  const result = git(['diff', '--unified=0', '--no-renames', '--no-color', base, 'HEAD']);
  if (!result.ok) {
    activeOutput().warn(`⚠️  git diff from ${base} did not answer (${gitSaid(result) || 'nothing said'}); the task step adds no facade test.`);
    return [];
  }
  const firstFile = new Map<string, string>();
  for (const line of addedLines(result.stdout)) {
    for (const name of reachedPackages(line)) {
      const test = `packages/${name}/${FACADE_TEST}`;
      if (!firstFile.has(test) && existsSync(join(root, test))) firstFile.set(test, line.file);
    }
  }
  return [...firstFile.entries()]
    .map(([test, file]) => ({ test, file }))
    .sort(byTest);
}
