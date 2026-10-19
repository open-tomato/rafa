/**
 * The version the running build answers with, and the one line that
 * spells it.
 *
 * `version` is read from the root `package.json` by name, which `bun build`
 * inlines into `dist/cli.js`, as `src/commands/describe.ts` reads it. So
 * an installed runtime answers with the version it was built from and
 * never with the version of a checkout beside it, and
 * `rafa --version` says which build a shell resolved.
 *
 * The manifest read is the root's, the one `release.versionFile` bumps,
 * and not the manifest of core's package beside it (#1090): until #808
 * publishes core under rafa's name, the root's version is the one a
 * build answers with. It is the one import inside core that lands
 * outside it, and `src/tests/core-package.sweep.test.ts` names it.
 *
 * {@link versionLine} is that one line, `rafa <version>`. Two places
 * write it: the dispatcher, for the version route `src/cli/route.ts`
 * reads `--version` into, and `rafa doctor`, whose first line it is. They
 * share this module so the two can never drift apart.
 */
import { version } from '../../../../../package.json';

/** The `version` of `package.json`, inlined into the build that reads it. */
export const RAFA_VERSION: string = version;

/** The line `rafa --version` prints and `rafa doctor` opens with: `rafa <version>`. */
export function versionLine(): string {
  return `rafa ${RAFA_VERSION}`;
}
