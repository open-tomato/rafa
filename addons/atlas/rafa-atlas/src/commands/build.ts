/**
 * `build`: one pass of `buildAtlas` over the project root, writing the
 * replica at `<root>/.rafa/atlas/atlas.sqlite`.
 *
 * It prints the replica's path, the rows of each bucket and a warning
 * per source read in part, and in json mode hands the build summary to
 * `output.result`. The live effort store is copied with core's
 * `vacuumInto` and only the copy is read. With no store under the root
 * the build refuses, naming the path it looked at, and writes nothing.
 * The build reads no `gh`: GitHub reads are phase 4's, behind a flag.
 */
import type { BuildSummary } from '../build/index.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa-core/core/command';

import { buildAtlas } from '../build/index.js';

import { execLine, projectRootOf, refusing, SUBJECT } from './shared.js';

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

/** Builds the replica under the context's project root and prints what it wrote. */
export async function runBuild(context: RafaContext): Promise<BuildSummary> {
  const summary = await buildAtlas({ projectRoot: projectRootOf(context), env: context.env });
  for (const line of buildLines(summary)) context.output.info(line);
  for (const line of partialLines(summary)) context.output.warn(line);
  return summary;
}

export const buildCommand: RafaCommand = {
  name: 'atlas build',
  subject: SUBJECT,
  action: 'build',
  summary: 'build the Atlas replica from a copy of the effort store',
  description: 'Copies the effort store with vacuumInto, reads the copy and the plan folder, and writes the replica at <root>/.rafa/atlas/atlas.sqlite in one rename. Prints the rows of each bucket and every source read in part. The root is ATLAS_PROJECT_ROOT, or the working directory; RAFA_EFFORT_DIR names the store and wins. Exits 1 with an error line when there is no store.',
  args: [],
  flags: [],
  examples: [
    { cmd: execLine('build'), note: 'builds the replica of the project in the working directory' },
    { cmd: `ATLAS_PROJECT_ROOT=<main checkout> ${execLine('build')}`, note: 'builds from a worktree, over the main checkout\'s store' },
  ],
  outputs: ['text', 'json'],
  needsProject: false,
  run: (context) => refusing(context, async () => {
    const summary = await runBuild(context);
    if (context.outputMode === 'json') context.output.result(summary);
    else context.output.info(`atlas: serve it with ${execLine('serve')}`);
  }),
};
