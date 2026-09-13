/**
 * What a run reads off its command line and its plan before the first
 * task is dispatched.
 *
 * `start()` resolves the settings it runs on through
 * {@link loadRunConfig}, reads its other flags through {@link argValue},
 * names where the injection mode came from with
 * {@link injectSourceLabel}, and hands the plan to
 * {@link announcePlanIssues} once, at start.
 */
import type { ConfigSource, ResolvedConfig } from '../config.js';
import type { PlanIssue } from '../plan/index.js';

import { loadConfig } from '../config.js';
import { parsePlan } from '../plan/index.js';

/**
 * The value of the first `flag=value` argument, or undefined when no
 * argument starts with `flag=`. A bare `flag` is not one.
 */
export function argValue(args: readonly string[], flag: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit?.slice(flag.length + 1);
}

/** The flag naming how much of the plan each task session is handed. */
const INJECT_FLAG = '--inject';

/**
 * The raw `--inject` value, for `resolveConfig` to validate: undefined
 * without the flag, and the empty string for a bare `--inject`.
 *
 * A bare flag is an empty value rather than no flag, so it is refused.
 * Read as absent, it would dispatch every task under the config's mode
 * while the operator believed they had named one.
 */
function injectFlagValue(args: readonly string[]): string | undefined {
  return args.includes(INJECT_FLAG)
    ? ''
    : argValue(args, INJECT_FLAG);
}

/**
 * Resolves the settings a run starts on: `--inject=` over
 * `.rafa/config.yaml` over the defaults, as `config.ts` ranks them.
 *
 * `--inject` is the one flag. `store` resolves from the file and the
 * default and the loop acts on nothing it says, but the file is judged
 * whole, so an unusable `store:` refuses the run as an unusable
 * `plan.inject:` does.
 *
 * Throws the {@link ConfigError} `loadConfig` throws, naming every
 * problem. A warning per unknown key goes to `warn`, `console.warn`
 * when none is given.
 */
export function loadRunConfig(
  repoRoot: string,
  args: readonly string[],
  warn?: (message: string) => void,
): ResolvedConfig {
  return loadConfig(repoRoot, { inject: injectFlagValue(args) }, warn);
}

/** Where the injection mode came from, as the operator log names it. */
export function injectSourceLabel(source: ConfigSource, configPath: string | null): string {
  if (source === 'cli') return INJECT_FLAG;
  if (source === 'file') return configPath ?? 'the config file';
  return 'the default';
}

/**
 * Names every part of the plan `parsePlan` did not read as written, and
 * answers them. Called once, at start.
 *
 * Nothing here stops a run: the parser never throws, and an issue is a
 * warning. It is printed because two of the reasons change what the
 * loop does and nothing else says so. A task line inside a closed
 * `rafa:*` block is block body and is never dispatched, so a block
 * missing its closing fence, closed instead by a later fence, takes
 * every task between the two out of the run. And every line
 * after a block never closed is read by the model as that block's
 * body, so a `stage` or `task` rendering of a task there falls back to
 * `full`.
 */
export function announcePlanIssues(planContent: string): readonly PlanIssue[] {
  const { issues } = parsePlan(planContent);
  if (issues.length === 0) return issues;

  console.warn(`\n⚠️  The plan holds ${issues.length} part(s) the loop does not read as written:`);
  for (const issue of issues) console.warn(`   line ${issue.line}: ${issue.text}`);
  return issues;
}
