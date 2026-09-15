/**
 * Runtime snapshot: `bun run snapshot`, a thin caller of
 * `src/runtime/install.ts`, which `rafa self-update` calls too. That
 * module's note is the long form: what it reads, the order it runs in, the
 * refusals, and how it replaces a runtime in use.
 *
 * Usage:
 *   bun run snapshot
 *
 * It installs this checkout: builds it, copies `dist/` into
 * `~/.rafa/runtime/<version>/`, links `~/.rafa/bin/rafa` at the copied
 * `cli.js`, and prints the path the link resolves to. It refuses while a
 * tracker in `plan.dir` has an open or blocked task, before building.
 *
 * Every line goes out after `[snapshot] `: progress to stdout, and a
 * refusal, a failure and a config warning to stderr. After an install it
 * warns, on stderr, when `~/.rafa/bin` is not on this process's `PATH`
 * ahead of `~/.bun/bin` (`src/project/bin-path.ts`), since a `rafa` found
 * first in `~/.bun/bin` would run instead; a warning never changes the
 * exit code.
 *
 * Exit codes: 0 done, 1 refused, 2 the snapshot could not run.
 *
 * ## Seams
 *
 * {@link defaultSeams} takes the home, `homedir()` unless a test names
 * another, and {@link runSnapshot} the seams, where a refusal goes and the
 * `PATH` it reads, so a test points every path under a temporary directory
 * of its own and never runs the real build.
 */
import type { InstallSeams } from '../src/runtime/install.js';

import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { messageOf } from '../src/config-sections.js';
import { readBinPath } from '../src/project/bin-path.js';
import { EXIT_COULD_NOT_RUN, exitCodeFor, installRuntime, outcomeProblem, runBuild } from '../src/runtime/install.js';

/** Prefix on every line this script writes. */
export const TAG = '[snapshot]';

/** The seams `bun run snapshot` runs with: this checkout, the home, the real build, and the console. */
export function defaultSeams(home: string = homedir()): InstallSeams {
  return {
    repoRoot: resolve(import.meta.dir, '..'),
    home,
    build: (repoRoot) => runBuild(repoRoot),
    log: (line) => console.log(`${TAG} ${line}`),
    warn: (line) => console.error(`${TAG} warn: ${line}`),
  };
}

/**
 * Takes one snapshot over `seams`, writing why it refused or could not run
 * and the `PATH` warning to `error`, and answers the exit code.
 */
export function runSnapshot(seams: InstallSeams, error: (line: string) => void, pathValue: string | undefined): number {
  const outcome = installRuntime(seams);
  const problem = outcomeProblem(outcome, seams.repoRoot);
  for (const line of problem ?? []) error(`${TAG} ${line}`);
  if (outcome.kind === 'done') {
    const { warning } = readBinPath(pathValue, seams.home);
    if (warning !== null) error(`${TAG} warn: ${warning}`);
  }
  return exitCodeFor(outcome);
}

if (import.meta.main) {
  let code = EXIT_COULD_NOT_RUN;
  try {
    code = runSnapshot(defaultSeams(), (line) => console.error(line), process.env['PATH']);
  } catch (err) {
    console.error(`${TAG} FAIL — ${messageOf(err)}`);
  }
  process.exit(code);
}
