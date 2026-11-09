/**
 * The privacy sweep the add-ons share: no file under a folder that git
 * tracks, or would track (untracked and not ignored), names a private
 * host, the self-hosted runner, a home path or a private repository.
 *
 * The banned terms are stored as sha256 hashes of their lowercase form,
 * so no file spells them. The sweep lowercases each file, cuts it into
 * tokens of `[a-z0-9._/~-]`, and hashes every run of whole words in a
 * token, with or without the separator before it: `npm.a.b.com` yields
 * `npm.a.b.com`, `a.b.com`, `.b`, `b` and so on, and `/home/x/y` yields
 * `/home/x`. A term therefore matches only on word boundaries.
 *
 * To ban a term, print its hash and add a line to a list with a label
 * that does not spell it:
 *
 *   bun -e 'console.log(new Bun.CryptoHasher("sha256").update(process.argv[1].toLowerCase()).digest("hex"))' '<term>'
 *
 * A term must be one token: letters, digits and `._/~-` only.
 */
import { join } from 'node:path';

/**
 * sha256 of each banned lowercase term every add-on sweeps for, with a
 * label that does not spell it: hosts and paths. A repository name is
 * banned by the add-on that must not name it, since one add-on's private
 * neighbour can be another's public parent.
 */
export const BASE_BANNED: ReadonlyMap<string, string> = new Map([
  ['946246055a5b44b407673c631fcaf4184fef77849c7a6304e14f197c48f727a2', 'the private registry host'],
  ['3876d564cefdfad18351c192be9e4e20177a5e164e259b16564f4ff26814e205', 'the private registry host without its first label'],
  ['77f1d1c04d32a84a569b4aed05ef453ec4f464fcac98de97bb2f5033df2c4a04', 'the private registry machine name'],
  ['4230793e75a9fa85f545ae072cf77eace73d3c27247dada0a3e418e7dcba10d7', 'the private domain word'],
  ['8be0b5445fca6eb16d14c6f4eaff1cf1d1a3362ef660bfb2b66e74bf309b7e61', 'the word for a home server rack'],
  ['3e55007b27d65a0fbaa4843c40842f60e47aeb882a55c3e076c61e4fd3c4c96a', 'the maintainer\'s home path prefix'],
]);

/** One banned term found: the file, relative to the folder it was listed from, and the term's label. */
export interface SweepHit {
  readonly file: string;
  readonly label: string;
}

/** Characters a token is made of. */
const TOKEN = /[a-z0-9._/~-]+/g;

/** The separators that split a token into words. */
const SEPARATOR = /[._/~-]/;

/** Tokens longer than this are cut into words from their first `MAX_WORDS` only. */
const MAX_WORDS = 24;

/** Files larger than this are read for their first part only. */
const MAX_BYTES = 2_000_000;

/** The sha256 of a term's lowercase form, as hex: the key a banned list holds. */
export function bannedHashOf(term: string): string {
  return new Bun.CryptoHasher('sha256').update(term.toLowerCase())
    .digest('hex');
}

/** Every run of whole words in `token`, each with and without the separator before it. */
function candidates(token: string): string[] {
  const words: { start: number; end: number }[] = [];
  let start = -1;
  for (let index = 0; index <= token.length; index += 1) {
    const isWord = index < token.length && !SEPARATOR.test(token.charAt(index));
    if (isWord && start === -1) start = index;
    if (!isWord && start !== -1) {
      words.push({ start, end: index });
      start = -1;
    }
  }
  const kept = words.slice(0, MAX_WORDS);
  const runs: string[] = [];
  for (let first = 0; first < kept.length; first += 1) {
    const from = kept[first]?.start ?? 0;
    for (let last = first; last < kept.length; last += 1) {
      const to = kept[last]?.end ?? 0;
      runs.push(token.slice(from, to));
      if (from > 0) runs.push(token.slice(from - 1, to));
    }
  }
  return runs;
}

/** The labels of every banned term `text` holds, sorted. */
export function bannedIn(text: string, banned: ReadonlyMap<string, string>): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  for (const token of text.toLowerCase().match(TOKEN) ?? []) {
    for (const candidate of candidates(token)) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const label = banned.get(bannedHashOf(candidate));
      if (label !== undefined) found.add(label);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** The repository root, from git. */
export function repositoryRoot(): string {
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd: import.meta.dir });
  if (result.exitCode !== 0) throw new Error(`git rev-parse failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** Files under `folder` that git tracks or would track, relative to `root`. */
export function sweptFiles(root: string, folder: string): string[] {
  const result = Bun.spawnSync(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '--', folder],
    { cwd: root },
  );
  if (result.exitCode !== 0) throw new Error(`git ls-files failed: ${result.stderr.toString()}`);
  return result.stdout.toString().split('\n')
    .filter((line) => line !== '');
}

/** The banned terms each listed file under `root` holds; a listed file that is gone is skipped. */
export async function sweepFiles(
  root: string,
  files: readonly string[],
  banned: ReadonlyMap<string, string>,
): Promise<readonly SweepHit[]> {
  const hits: SweepHit[] = [];
  for (const relative of files) {
    const file = Bun.file(join(root, relative));
    if (!(await file.exists())) continue;
    const text = await file.slice(0, MAX_BYTES).text();
    for (const label of bannedIn(text, banned)) hits.push({ file: relative, label });
  }
  return hits;
}

/**
 * The banned terms in every file under `folder`, a path relative to the
 * repository root. Refuses a folder git lists no file under, so a
 * misspelt folder never reads as clean.
 */
export async function sweepFolder(folder: string, banned: ReadonlyMap<string, string>): Promise<readonly SweepHit[]> {
  const root = repositoryRoot();
  const files = sweptFiles(root, folder);
  if (files.length === 0) throw new Error(`privacy sweep: git lists no file under ${folder}`);
  return sweepFiles(root, files, banned);
}
