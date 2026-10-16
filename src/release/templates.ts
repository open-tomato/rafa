/**
 * The release ladder's shipped workflow templates, and the writer that
 * puts one into a project's `.github/workflows/`.
 *
 * A template is a GitHub Actions workflow under `./templates/` beside
 * this module in a checkout. The build copies that tree's `*.yml` to
 * `dist/release-templates/` ({@link RELEASE_TEMPLATES_DIRNAME}), the
 * `release/templates:release-templates` row of the `build` script's
 * asset-tree loop, because `dist/templates/` already holds the board's
 * templates. A bundle answers its own directory through
 * `import.meta.url`, which is `dist/` for `cli.js` and `src/release/` in
 * a checkout, so {@link releaseTemplateSource} looks under
 * `release-templates/` first and `templates/` second; neither is
 * reachable from the other layout.
 *
 * `release-publish.yml` ({@link RELEASE_PUBLISH_FILE}) is level 2's:
 * a pushed tag, or a `workflow_call` naming a `ref`, runs the gates and
 * then `rafa release publish`.
 *
 * `release-tag.yml` ({@link RELEASE_TAG_FILE}) is level 3's: the merge
 * of the release pull request from `rafa/release` checks the base
 * branch out at the merge commit, runs `rafa release tag --push`, and
 * calls the publish workflow through `workflow_call` with the merge
 * commit as `ref`, since a tag pushed with the workflow's token starts
 * no other run.
 *
 * `release-settle.yml` ({@link RELEASE_SETTLE_FILE}) is level 4's: a
 * push to the repository's default branch runs `rafa release settle`
 * with a git identity set, and, when settle pushed a release commit and
 * tagged it, calls the publish workflow through `workflow_call` with
 * that commit as `ref`, for the same reason.
 *
 * `release-bot-fragment.yml` ({@link RELEASE_BOT_FRAGMENT_FILE}) is
 * needed at levels 3 and 4 while `.github/dependabot.yml` exists: a
 * Dependabot pull request, run on `pull_request_target`, gets the
 * fragment `rafa release fragment --plan=dependabot-<number>` writes from
 * the base branch's checkout, committed and pushed to the pull request's
 * branch, from which nothing runs.
 *
 * {@link writeReleaseWorkflow} writes through `../board/setup.ts`'s
 * {@link writeShippedFile}, the writer the epic guard uses: an existing
 * file is left byte for byte as it is, whatever it holds, and a
 * directory at the path is refused. Nothing here reaches GitHub.
 */
import type { BoardPart } from '../board/setup.js';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEMPLATES_DIRNAME, writeShippedFile } from '../board/setup.js';

/** This module's own directory: where the shipped templates are looked for. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The directory the build copies the release templates to, under `dist/`. */
export const RELEASE_TEMPLATES_DIRNAME = 'release-templates';

/** The level 2 publish workflow's name, in the templates directory and under `.github/workflows/`. */
export const RELEASE_PUBLISH_FILE = 'release-publish.yml';

/** The level 3 tag workflow's name, in the templates directory and under `.github/workflows/`. */
export const RELEASE_TAG_FILE = 'release-tag.yml';

/** The level 4 settle workflow's name, in the templates directory and under `.github/workflows/`. */
export const RELEASE_SETTLE_FILE = 'release-settle.yml';

/** The bot fragment workflow's name, in the templates directory and under `.github/workflows/`. */
export const RELEASE_BOT_FRAGMENT_FILE = 'release-bot-fragment.yml';

/** Where a project's workflows live, under its root. */
const WORKFLOWS_DIR: string = join('.github', 'workflows');

/**
 * The places `file` is looked for, in order: `release-templates/` under
 * `moduleDir` (a build) and then `templates/` (a checkout).
 */
function candidatesOf(file: string, moduleDir: string): readonly string[] {
  return [join(moduleDir, RELEASE_TEMPLATES_DIRNAME, file), join(moduleDir, TEMPLATES_DIRNAME, file)];
}

/**
 * Where the shipped template `file` is read from: the first candidate
 * holding it, or the build's candidate when neither does.
 */
export function releaseTemplateSource(file: string, moduleDir: string = MODULE_DIR): string {
  const candidates = candidatesOf(file, moduleDir);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/**
 * The text of the shipped template `file`.
 *
 * @throws Error naming every path looked at when the build dropped it.
 */
export function readReleaseTemplate(file: string, moduleDir: string = MODULE_DIR): string {
  const source = candidatesOf(file, moduleDir).find((candidate) => existsSync(candidate));
  if (source === undefined) {
    const looked = candidatesOf(file, moduleDir).join(' or ');
    throw new Error(`release templates: the workflow ${file} is missing: no file at ${looked}`);
  }
  return readFileSync(source, 'utf8');
}

/**
 * Writes the shipped template `file` to `.github/workflows/<file>` under
 * `root` when nothing is at that path, and answers its part: `created`,
 * `present` for a file already there, whatever it holds, or `refused`
 * with the reason.
 */
export function writeReleaseWorkflow(root: string, file: string, moduleDir: string = MODULE_DIR): BoardPart {
  return writeShippedFile(root, {
    path: join(WORKFLOWS_DIR, file),
    source: releaseTemplateSource(file, moduleDir),
    what: 'the workflow',
    read: () => readReleaseTemplate(file, moduleDir),
  });
}
