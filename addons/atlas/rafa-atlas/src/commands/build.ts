/**
 * `build`: one pass of `buildAtlas` over the project root, writing the
 * replica at `<root>/.rafa/atlas/atlas.sqlite`.
 *
 * It prints the replica's path, the rows of each bucket and a warning
 * per source read in part, and in json mode hands the build summary to
 * `output.result`. The live effort store is copied with core's
 * `vacuumInto` and only the copy is read. Git runs in the root; when it
 * gives no history there, both git sources are stamped missing and the
 * build goes on. With no store under the root the build refuses, naming
 * the path it looked at, and writes nothing.
 *
 * The build calls no `gh` unless `--github` is given (D9). With it, the
 * pull requests and issue times are read from GitHub; a failed read
 * (D18) is the one warning line of `local.prs`, naming `gh`'s stderr,
 * and the rest is built as without the flag, exit 0.
 */
import type { BuildSummary } from '../build/index.js';
import type { GhRunner } from '@open-tomato/rafa-board';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa-core/core/command';

import { buildAtlas } from '../build/index.js';

import { buildOptionsOf, execLine, GITHUB_FLAG, refusing, SUBJECT } from './shared.js';

/** The lines a build prints, the partial sources aside. */
export function buildLines(summary: BuildSummary): string[] {
  return [
    `atlas: built ${summary.replicaPath} (build ${summary.buildId})`,
    ...Object.entries(summary.tables).map(([table, rows]) => `  ${table}: ${rows} ${rows === 1
      ? 'row'
      : 'rows'}`),
  ];
}

/** One warning per source the build read in part. */
export function partialLines(summary: BuildSummary): string[] {
  return summary.sources
    .filter((stamp) => stamp.partial)
    .map((stamp) => `atlas: ${stamp.source} read in part: ${stamp.reason ?? 'no reason given'}`);
}

/**
 * Builds the replica under the context's project root and prints what it
 * wrote; `gh`, when given, stands in for `gh` under `--github` (a test's
 * stub), and is never asked without the flag.
 */
export async function runBuild(context: RafaContext, gh?: GhRunner): Promise<BuildSummary> {
  const summary = await buildAtlas(buildOptionsOf(context, gh));
  for (const line of buildLines(summary)) context.output.info(line);
  for (const line of partialLines(summary)) context.output.warn(line);
  return summary;
}

export const buildCommand: RafaCommand = {
  name: 'atlas build',
  subject: SUBJECT,
  action: 'build',
  summary: 'build the Atlas replica from a copy of the effort store',
  description: 'Copies the effort store with vacuumInto, reads the copy, the plan folder and the root\'s git history, and writes the replica at <root>/.rafa/atlas/atlas.sqlite in one rename. Prints the rows of each bucket and every source read in part. Calls no gh unless --github is given; with it, a failed GitHub read warns and the rest is built. Runs in the project of the working directory, whose atlas section names the layers, and refuses outside one. The root is ATLAS_PROJECT_ROOT, or that project; RAFA_EFFORT_DIR names the store and wins. Exits 1 with an error line when there is no store.',
  args: [],
  flags: [GITHUB_FLAG],
  examples: [
    { cmd: execLine('build'), note: 'builds the replica of the project in the working directory' },
    { cmd: `ATLAS_PROJECT_ROOT=<main checkout> ${execLine('build')}`, note: 'builds from a worktree, over the main checkout\'s store' },
    { cmd: execLine('build', '--github'), note: 'also reads the pull requests and issue times from GitHub' },
  ],
  outputs: ['text', 'json'],
  needsProject: true,
  run: (context) => refusing(context, async () => {
    const summary = await runBuild(context);
    if (context.outputMode === 'json') context.output.result(summary);
    else context.output.info(`atlas: serve it with ${execLine('serve')}`);
  }),
};
