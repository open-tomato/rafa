/**
 * The plan marker the loop stamps onto every prompt it dispatches.
 *
 * Effort attribution used to reach a session's plan through its BRANCH
 * NAME, which works only while a run happens on a branch whose stub
 * resolves. Measured after one run executed on `main`: all 74 of its
 * sessions attributed to the `main` branch group instead of the plan,
 * and the group they landed in mixes every main-branch session ever
 * recorded, so the plan's figures were not recoverable from the store
 * without knowing the run's wall-clock window by hand.
 *
 * Two of those sessions in three could not have been recovered by any
 * derivation either. A task session carries the tracker line it was
 * dispatched with, so its plan is at least derivable from the tracker
 * text; a compaction and a wrap-up session carry neither the plan path
 * nor the stub anywhere in their prompts, measured across both shapes.
 * So the signal did not exist to be inferred, and the fix is to WRITE
 * one rather than to guess better.
 *
 * The marker is an HTML comment because every prompt this loop builds
 * is markdown handed to a model: a comment carries no instruction, and
 * a model that echoes the prompt back cannot turn it into one.
 *
 * It is APPENDED and never prepended, and that is load-bearing rather
 * than cosmetic. `effort/classify.ts` buckets a session by
 * `content.startsWith(shape.prefix)` over the WHOLE prompt, so one
 * line above the body re-buckets every one of the five shapes as
 * `other` — silently, because that module's drift guard is a
 * containment check that would stay green. `start.ts` states the same
 * rule at its compaction builder: add lines after line 1, never
 * before it. {@link planStubFromPrompt} therefore SEARCHES rather than
 * matching a prefix, which is what lets the marker sit at the end.
 *
 * A stub is written verbatim and matched against the same character
 * class `readPlanStubs` derives from a filename, so a stamp can never
 * name a stub the store could not also have resolved from a branch.
 */

/** Characters a plan stub may contain — the filename class, no more. */
const STUB_PATTERN = '[A-Za-z0-9._-]+';

/** Finds the marker anywhere in a prompt, capturing the stub. */
const STAMP_PATTERN = new RegExp(
  `<!--\\s*ralph:plan=(${STUB_PATTERN})\\s*-->`,
);

/** True when the text is usable as a stamped stub. */
export function isStampableStub(stub: string): boolean {
  return new RegExp(`^${STUB_PATTERN}$`).test(stub);
}

/**
 * Builds the marker line for one plan stub.
 *
 * Throws on a stub the pattern would not match, rather than writing a
 * marker {@link planStubFromPrompt} could not read back. A stamp that
 * silently fails to parse is worse than no stamp: it reports as an
 * unattributed session while looking like it was handled.
 */
export function planStampLine(stub: string): string {
  if (!isStampableStub(stub)) {
    throw new Error(`ralph plan stamp: unusable stub ${JSON.stringify(stub)}`);
  }
  return `<!-- ralph:plan=${stub} -->`;
}

/**
 * Reads the stub back out of a dispatched prompt, or null.
 *
 * Null for absent content, for a prompt carrying no marker, and for a
 * marker whose stub does not match the class — the three cases a
 * caller treats alike, since each means the session has no stamped
 * plan and must fall back to its branch.
 */
export function planStubFromPrompt(content: string | null | undefined): string | null {
  if (typeof content !== 'string' || content.length === 0) return null;
  const match = STAMP_PATTERN.exec(content);
  const stub = match?.[1];
  return stub !== undefined && isStampableStub(stub)
    ? stub
    : null;
}

/**
 * Appends the marker to a prompt the loop is about to dispatch.
 *
 * Never prepends: the first line is a classifier key, and the module
 * note above carries the measurement.
 */
export function stampPrompt(stub: string, prompt: string): string {
  return `${prompt}\n${planStampLine(stub)}`;
}

/**
 * Derives a plan stub from a plan or tracker path.
 *
 * `PLAN-q16a-compose-n8n.md` and `PLAN_TRACKER-q16a-compose-n8n.md`
 * both answer `q16a-compose-n8n`; a bare `PLAN.md` answers null,
 * having no stub to name. Null rather than a fallback string: an
 * unstubbed plan is exactly the case a stamp must not invent a group
 * for, and the caller reports it instead.
 */
export function planStubFromPath(planPath: string): string | null {
  const base = planPath.split('/').pop() ?? planPath;
  const match = /^PLAN(?:_TRACKER)?-(.+)\.md$/.exec(base);
  const stub = match?.[1];
  return stub !== undefined && isStampableStub(stub)
    ? stub
    : null;
}
