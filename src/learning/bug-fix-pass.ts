/**
 * The bug-fix pass: the bug findings of the effort store paired with the
 * loops that fixed them, and each new pair pushed into the `local`
 * library as one lesson with two sources.
 *
 * {@link runBugFixPass} composes the four steps of the join, each
 * of them its own module's:
 *
 *   1. `readBugFixRows` (`@open-tomato/rafa-effort`) reads the store's bug
 *      findings, their sessions' out-of-scope bugs, the resolved findings
 *      and the `done` task reports under the project root;
 *   2. {@link readPlanStageLinks} reads the plan stages of every plan
 *      file in `plan.dir`, resolved against the project root as
 *      `plansDirAt` resolves it;
 *   3. `pairBugFixes` (`@open-tomato/rafa-inventory`) joins them, and
 *   4. `pushBugFixPairs` pushes each pair the push log does not hold yet
 *      through the `local` learning adapter, made as the adapter
 *      registry's `learning/local` entry makes it: the library under
 *      `.rafa/instincts/` of the root, the roots' `home` and
 *      `learning.bless.minConfidence`.
 *
 * It answers how many pairs were pushed, how many the push log already
 * held, and how many bug findings stayed unpaired. A second pass over an
 * unchanged store therefore pushes nothing and skips every pair the
 * first one pushed.
 *
 * ## The config
 *
 * `plan.dir`, `learning.adapter` and `learning.bless.minConfidence` are
 * read off the config the caller hands in its seams, or off the one that
 * resolves for the roots when it hands none. That load's own warnings are
 * not written: the pass's caller loaded the same config and wrote them.
 *
 * The pass pushes through the `local` adapter only, the one whose push
 * log keeps a pair from being pushed twice. A config whose
 * `learning.adapter` names another adapter is a failure of the pass.
 *
 * ## It never throws
 *
 * A failure of any step, a config that does not load included, is one
 * warning naming it, and the pass answers zero for each count, having
 * pushed nothing. Each pair the adapter refused is one line of a single
 * warning, and the other pairs stay pushed. A store with no
 * `effort.sqlite` holds no bug, so it answers zeros and warns nothing. A
 * plan file `readPlanStageLinks` passes over is its own warning, as that
 * reader writes it.
 */
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { ConfigRoots } from '@open-tomato/rafa/core/config/load';

import { readBugFixRows } from '@open-tomato/rafa-effort';
import { localInstinctsDir, pairBugFixes, pushBugFixPairs } from '@open-tomato/rafa-inventory';

import { loadConfig } from '@open-tomato/rafa/core/config/load';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { plansDirAt } from '@open-tomato/rafa/core/plan';

import { readPlanStageLinks } from './plan-stage-links.js';

/** The learning adapter the pass pushes through. */
const PASS_ADAPTER = 'local';

/** What every warning of the pass opens with. */
const WARNING = 'bug-fix pass';

/** The config keys the pass reads. */
export type BugFixPassConfig = Pick<RafaConfig, 'planDir' | 'learningAdapter' | 'learningBlessMinConfidence'>;

/** What {@link runBugFixPass} can be handed. */
export interface BugFixPassSeams {
  /** The config to read; the one that resolves for the roots when left out. See the module note. */
  readonly config?: BugFixPassConfig;
  /** The clock each lesson and each merge is stamped from. The system clock when left out. */
  readonly now?: () => Date;
  /** Where each warning goes. The active output's `warn` when left out. */
  readonly warn?: (message: string) => void;
}

/** What {@link runBugFixPass} answers: counts, each zero after a failure. */
export interface BugFixPassResult {
  /** The pairs whose lessons this pass pushed. */
  readonly pushed: number;
  /** The pairs the push log already held, so pushed by an earlier pass. */
  readonly skipped: number;
  /** The bug findings no fixing loop was found for. */
  readonly unpaired: number;
}

/** The answer of a pass that pushed nothing. */
const NOTHING: BugFixPassResult = { pushed: 0, skipped: 0, unpaired: 0 };

/** Writes `message` as a warning of the active output. */
function warnThroughActiveOutput(message: string): void {
  activeOutput().warn(message);
}

/** The config that resolves for `roots`, its warnings not written. See the module note. */
async function resolvedConfig(roots: ConfigRoots): Promise<BugFixPassConfig> {
  return (await loadConfig(roots, {}, () => {})).config;
}

/** The pass itself, throwing on any failure. */
async function pass(
  roots: ConfigRoots,
  seams: BugFixPassSeams,
  warn: (message: string) => void,
): Promise<BugFixPassResult> {
  const config = seams.config ?? await resolvedConfig(roots);
  if (config.learningAdapter !== PASS_ADAPTER) {
    throw new Error(`learning.adapter is \`${config.learningAdapter}\`, and the pass pushes through \`${PASS_ADAPTER}\` only`);
  }
  const { rows, note } = readBugFixRows(roots.root);
  if (note !== null) return NOTHING;
  const links = await readPlanStageLinks(plansDirAt(roots.root, config.planDir).path, { warn });
  const now = (seams.now ?? ((): Date => new Date()))();
  const { pairs, unpaired } = pairBugFixes(rows, links, now);
  const push = await pushBugFixPairs({
    instinctsDir: localInstinctsDir(roots.root),
    home: roots.home,
    minConfidence: config.learningBlessMinConfidence,
    warn,
  }, pairs, now);
  if (push.problems.length > 0) {
    warn([`${WARNING}: ${push.problems.length} of ${pairs.length} pairs were not pushed:`,
      ...push.problems.map((problem) => `   ${problem}`)].join('\n'));
  }
  return { pushed: push.pushed.length, skipped: push.skipped.length, unpaired: unpaired.length };
}

/**
 * Pairs the store's bug findings with their fixing loops and pushes each
 * pair not pushed before as one lesson; see the module note. Never
 * rejects: a failure is one warning, and the answer is zeros.
 *
 * @param roots - the project root, whose store, plans and library are read, and the home.
 * @param seams - the config, the clock and the warning sink, each defaulted.
 * @returns how many pairs were pushed and skipped, and how many bugs stayed unpaired.
 */
export async function runBugFixPass(
  roots: ConfigRoots,
  seams: BugFixPassSeams = {},
): Promise<BugFixPassResult> {
  const warn = seams.warn ?? warnThroughActiveOutput;
  try {
    return await pass(roots, seams, warn);
  } catch (error) {
    warn(`${WARNING}: nothing was pushed: ${messageOf(error)}`);
    return NOTHING;
  }
}
