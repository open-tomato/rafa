/**
 * The scratch copy: the directory a search session runs in, holding a
 * copy of each ranked candidate's file and nothing else.
 *
 * The session is started with `--tools Read,Grep,Glob` and its working
 * directory set to this copy, so what it can read is what the ranker
 * kept. The copy is made under the run's temp directory (`tmpdir()`
 * unless the caller names another root) in a fresh `rafa-search-`
 * directory, and it is removed afterwards whatever the outcome.
 *
 * ## Layout
 *
 * Each candidate's file is copied to `<scratch>/<name>/<file name>`, so
 * a skill's `SKILL.md` sits at `<scratch>/<name>/SKILL.md` and an
 * agent's `<name>.md` at `<scratch>/<name>/<name>.md`. Only the file is
 * copied, never the directory beside it. A name that is empty, is `.`
 * or `..`, or holds a path separator would leave the scratch directory
 * or collide, so {@link createScratchCopy} refuses it before copying
 * anything; a second candidate with the same name is refused too.
 *
 * ## Removal
 *
 * {@link withScratchCopy} removes the copy in a `finally`, so it is gone
 * when the body resolves (a good answer or a malformed one alike — the
 * block parser's verdict is a value, not an exception) and when the body
 * throws or rejects. {@link createScratchCopy} removes what it already
 * made when a copy fails partway, and throws.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** The prefix of every scratch directory's name. */
export const SCRATCH_PREFIX = 'rafa-search-';

/** One candidate to copy: its name and the absolute path of its file. */
export interface ScratchCandidate {
  readonly name: string;
  readonly path: string;
}

/** A made scratch copy. */
export interface ScratchCopy {
  /** The scratch directory, the session's working directory. */
  readonly dir: string;
  /** From each candidate's name to the path of its copy. */
  readonly paths: ReadonlyMap<string, string>;
  /** Removes the scratch directory; safe to call more than once. */
  readonly remove: () => void;
}

/** True when `name` can be one directory level under the scratch root. */
function safeName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}

/** Throws on an unsafe or repeated name, before anything is made. */
function refuseBadNames(candidates: readonly ScratchCandidate[]): void {
  const seen = new Set<string>();
  for (const { name } of candidates) {
    if (!safeName(name)) {
      throw new Error(`Cannot copy candidate with name '${name}' into the scratch directory`);
    }
    if (seen.has(name)) {
      throw new Error(`Two candidates are named '${name}'`);
    }
    seen.add(name);
  }
}

/**
 * Copies each candidate's file into a new scratch directory under
 * `root`, which defaults to the run's temp directory.
 */
export function createScratchCopy(
  candidates: readonly ScratchCandidate[],
  root: string = tmpdir(),
): ScratchCopy {
  refuseBadNames(candidates);
  const dir = mkdtempSync(join(root, SCRATCH_PREFIX));
  const remove = (): void => rmSync(dir, { recursive: true, force: true });
  try {
    const paths = new Map<string, string>();
    for (const { name, path } of candidates) {
      const target = join(dir, name);
      mkdirSync(target);
      const copy = join(target, basename(path));
      copyFileSync(path, copy);
      paths.set(name, copy);
    }
    return { dir, paths, remove };
  } catch (error) {
    remove();
    throw error;
  }
}

/**
 * Makes the scratch copy, runs `body` with it and removes it afterwards,
 * whether `body` resolves or throws.
 */
export async function withScratchCopy<T>(
  candidates: readonly ScratchCandidate[],
  body: (scratch: ScratchCopy) => Promise<T> | T,
  root?: string,
): Promise<T> {
  const scratch = createScratchCopy(candidates, root);
  try {
    return await body(scratch);
  } finally {
    scratch.remove();
  }
}
