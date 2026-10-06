/**
 * The shared input and output of the survey map scripts under
 * `scripts/survey/`: which tracked files a script was meant to read, the
 * coverage line naming the ones it missed, and the writer putting a
 * script's `<name>.json` and `<name>.md` under `.rafa/survey/`.
 *
 * The survey reads and reports. Every reading goes to `.rafa/survey/`,
 * which `.gitignore` covers through `.rafa/`, so running a script leaves
 * no tracked file changed.
 *
 * ## Coverage
 *
 * A script that silently drops a file reads as one that covered it, so
 * every summary opens with {@link coverageLine}: the tracked files the
 * script was meant to read (from {@link listTrackedFiles}), how many it
 * read, and each one it missed by path. A file the script read that was
 * never expected is not counted: coverage is measured over the expected
 * list only.
 */
import { join } from 'node:path';

/** Where every survey reading goes, relative to the repository root. */
export const SURVEY_DIR = '.rafa/survey';

/** A script's name as its output files carry it: lowercase words joined by `-`. */
const SURVEY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The files a script was meant to read, the ones it read, and the ones it missed. */
export interface Coverage {
  /** Every tracked file the script was meant to read, sorted. */
  readonly expected: readonly string[];
  /** The expected files the script read, sorted. */
  readonly read: readonly string[];
  /** The expected files the script did not read, sorted. */
  readonly missed: readonly string[];
}

/** One script's reading, as {@link writeSurvey} writes it. */
export interface SurveyOutput<T> {
  /** What the script measured, written to the JSON file under `data`. */
  readonly data: T;
  /** The markdown summary's body, written after the coverage line. */
  readonly markdown: string;
  /** The script's coverage, opening the summary and written to the JSON file. */
  readonly coverage: Coverage;
}

/** The two files {@link writeSurvey} wrote, as absolute paths. */
export interface SurveyPaths {
  readonly json: string;
  readonly markdown: string;
}

/**
 * The files `git ls-files` lists under `repoRoot`, limited to `pathspecs`
 * when any are given, as repository-relative paths sorted by name.
 * Throws naming git's own message when the listing fails, such as outside
 * a repository.
 */
export async function listTrackedFiles(repoRoot: string, pathspecs: readonly string[] = []): Promise<string[]> {
  const result = await Bun.$`git ls-files -z -- ${[...pathspecs]}`
    .cwd(repoRoot)
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${repoRoot}: ${result.stderr.toString().trim()}`);
  }
  const paths = result.stdout
    .toString()
    .split('\0')
    .filter((path) => path.length > 0);
  return [...new Set(paths)].sort();
}

/**
 * The coverage of a script that was meant to read `expected` and read
 * `read`. A path in `read` that `expected` does not hold is left out.
 */
export function measureCoverage(expected: readonly string[], read: Iterable<string>): Coverage {
  const readSet = new Set(read);
  const expectedSorted = [...new Set(expected)].sort();
  return {
    expected: expectedSorted,
    read: expectedSorted.filter((path) => readSet.has(path)),
    missed: expectedSorted.filter((path) => !readSet.has(path)),
  };
}

/**
 * The line a summary opens with: the expected count, the read count, and
 * every missed file by path, or `none` when nothing was missed.
 */
export function coverageLine(coverage: Coverage): string {
  const missed = coverage.missed.length === 0
    ? 'none'
    : coverage.missed.map((path) => `\`${path}\``).join(', ');
  return `Coverage: ${coverage.expected.length} tracked, ${coverage.read.length} read, `
    + `${coverage.missed.length} missed: ${missed}`;
}

/**
 * Writes `output` as `<repoRoot>/.rafa/survey/<name>.json`, holding the
 * name, the coverage and the data, and `<name>.md`, opening with the
 * coverage line, creating the folder when it is absent. Throws on a name
 * that is not lowercase words joined by `-`, before writing anything.
 */
export async function writeSurvey<T>(repoRoot: string, name: string, output: SurveyOutput<T>): Promise<SurveyPaths> {
  if (!SURVEY_NAME.test(name)) {
    throw new Error(`survey name must be lowercase words joined by '-', got '${name}'`);
  }
  const dir = join(repoRoot, SURVEY_DIR);
  const paths: SurveyPaths = { json: join(dir, `${name}.json`), markdown: join(dir, `${name}.md`) };
  const json = { name, coverage: output.coverage, data: output.data };
  const body = output.markdown.trim();
  const markdown = body.length === 0
    ? `${coverageLine(output.coverage)}\n`
    : `${coverageLine(output.coverage)}\n\n${body}\n`;
  await Bun.write(paths.json, `${JSON.stringify(json, null, 2)}\n`);
  await Bun.write(paths.markdown, markdown);
  return paths;
}
