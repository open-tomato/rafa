/**
 * Reading a task's routing declaration off the end of its own line.
 *
 * A plan's task lines may carry a trailing brace block naming what the
 * loop should dispatch the task WITH:
 *
 * ```text
 * - [ ] Update the skill's cap sentence  {agent=doc-updater effort=low}
 * ```
 *
 * The block is the planner's half of a decision the loop otherwise has
 * no way to make. A task carrying none is dispatched exactly as every
 * task was before this module existed — one model, one effort, every
 * tool — so a prose task and a schema migration cost the same, and
 * the only place that knows they should not is the document that
 * wrote them. `start.ts` reads the block off each task on its way to
 * the prompt, which is what makes a declared task the one that runs
 * differently.
 *
 * Two parsers were never told about the block and both had to keep
 * working unchanged, which is what shapes the grammar. `findNextTask`
 * matches `^- \[ \] (.+)` and trims the capture, so the block arrives
 * inside `taskInfo.task` and would otherwise reach the injected prompt
 * verbatim; `updateTrackerLine` rewrites only the checkbox prefix, so
 * the block survives a tick byte-identical. Neither needs a change —
 * the stripping happens here, at the point the text is used. Both
 * halves are driven over real trackers in
 * `tests/tracker-declarations.test.ts`, which is where that claim is
 * measured rather than stated.
 *
 * Four rules keep a brace that a task WROTE ABOUT from being read as a
 * declaration, and each one is a shape that occurs in this repo's own
 * plans:
 *
 *   - The block is anchored at END OF TEXT. A task naming `{}` or a
 *     JSON literal mid-sentence has something after it.
 *   - It carries NO NESTED BRACES, so a task ending on a code span
 *     holding an object literal does not match.
 *   - It holds AT LEAST ONE RECOGNISED key, which is the rule the
 *     scoped grammar turns on. `{ ... }` prose, an empty block and a
 *     block of keys nobody here answers to are all task text.
 *   - It is not the WHOLE text. A line that is only a declaration
 *     leaves no task to dispatch, and stripping it would hand the loop
 *     an empty prompt — the one failure that reads as the loop having
 *     silently lost the task.
 *
 * When none of that holds the answer is today's behaviour exactly:
 * `text` is the input string unchanged and `declaration` is null.
 * Nothing is stripped and no flag is resolved.
 *
 * Priority inside a block is duplicated ON PURPOSE. With `agent`
 * present the loop passes only `--agent`, because an agent definition
 * carries its own model and tool set and a flag beside it would be two
 * authorities for one decision. The other keys are still PARSED and
 * still sit on the record, so the effort collector can report what a
 * planner asked for against what the agent's definition supplied —
 * {@link ResolvedFlags.suppressed} names exactly which ones that was.
 *
 * Nothing here throws. A recognised key whose value this module cannot
 * use lands in {@link TaskDeclaration.issues} and maps to no flag, so
 * the task runs at the loop's defaults instead of stalling on a CLI
 * that refuses `--effort medum`. An unrecognised KEY is not an issue at
 * all: it is retained in {@link TaskDeclaration.extras} for telemetry,
 * which is what lets a grammar grow without every older plan going red.
 */

/** Keys this module answers to, in the order flags are emitted. */
export const DECLARATION_KEYS = [
  'agent',
  'model',
  'effort',
  'tools',
] as const;

/** One of the four keys the grammar recognises. */
export type DeclarationKey = (typeof DECLARATION_KEYS)[number];

/** The granular keys, which an `agent` suppresses. */
export const GRANULAR_KEYS = ['model', 'effort', 'tools'] as const;

/** A key that maps to a flag of its own when no agent is named. */
export type GranularKey = (typeof GRANULAR_KEYS)[number];

/**
 * Model aliases the CLI documents, which is what a plan should spell.
 *
 * A FULL model name is accepted as well ({@link FULL_MODEL_NAME}) —
 * `--model` takes either — but an alias is what survives a model
 * generation changing underneath the plan.
 */
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'] as const;

/** Levels `--effort` accepts, taken from the CLI's own help text. */
export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/** One of the five levels `--effort` accepts. */
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * The trailing block, anchored at end of text and holding no brace of
 * its own. The capture is the body between the braces.
 */
const DECLARATION_BLOCK = /\{([^{}]*)\}$/;

/** A `key=value` token. The value runs to the next space. */
const ENTRY_TOKEN = /^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$/;

/** A model spelled in full, as `--model` also accepts. */
const FULL_MODEL_NAME = /^claude-[a-z0-9][a-z0-9.-]*$/;

/** An agent name, as a file under `.claude/agents/` is named. */
const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** One tool name from the built-in set. */
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** One `key=value` pair, exactly as it was written. */
export interface DeclarationEntry {
  /** Key as written. Matched case-sensitively against the grammar. */
  key: string;
  /** Value as written, with no unescaping of any kind. */
  value: string;
}

/** Why a token could not be used. */
export type DeclarationIssueReason =
  /** A recognised key appearing twice. The first occurrence wins. */
  | 'duplicate-key'
  /** A recognised key whose value this module cannot pass on. */
  | 'unusable-value'
  /** A token inside the block carrying no `=` at all. */
  | 'stray-token';

/** One thing the block said that did not become a flag. */
export interface DeclarationIssue {
  reason: DeclarationIssueReason;
  /** Key it concerns, or the empty string for a stray token. */
  key: string;
  /** The token as written, so a log line can quote it. */
  text: string;
}

/** What one block declared. */
export interface TaskDeclaration {
  /** The block as it appeared, braces included. */
  raw: string;
  /** Every `key=value` token, in source order, recognised or not. */
  entries: readonly DeclarationEntry[];
  /** Entries whose key is none of {@link DECLARATION_KEYS}. */
  extras: readonly DeclarationEntry[];
  /** What was dropped, and why. Empty on a clean block. */
  issues: readonly DeclarationIssue[];
  /** Agent to dispatch under, or null. */
  agent: string | null;
  /** Model alias or full name, or null. */
  model: string | null;
  /** Effort level, or null. */
  effort: EffortLevel | null;
  /** Tool names, deduped in first-seen order, or null. */
  tools: readonly string[] | null;
}

/** A task text split from the declaration it carried. */
export interface ParsedTask {
  /**
   * The text the loop should dispatch. The input unchanged when no
   * declaration was found, and the text before the block otherwise.
   */
  text: string;
  /** What the block declared, or null when there was no block. */
  declaration: TaskDeclaration | null;
}

/** What a declaration resolves to on the command line. */
export interface ResolvedFlags {
  /** CLI arguments, in {@link DECLARATION_KEYS} order. */
  args: readonly string[];
  /**
   * Keys present on the record that deliberately map to no flag.
   * Non-empty only when an `agent` outranked them.
   */
  suppressed: readonly GranularKey[];
}

/** True when `value` is one of the five effort levels. */
export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * True when `value` is a model this module will pass on: one of the
 * documented aliases, or a full name spelled the way the CLI's own
 * help spells one.
 */
export function isModelValue(value: string): boolean {
  if ((MODEL_ALIASES as readonly string[]).includes(value)) return true;
  return FULL_MODEL_NAME.test(value);
}

/**
 * Splits a `tools=` value into names, or answers null when it is not
 * usable.
 *
 * Membership is deliberately NOT checked against a list of tool names.
 * The built-in set lives in the CLI and moves with it, so a list kept
 * here would eventually refuse a tool that exists — a failure that
 * reads as a broken declaration rather than as a stale constant. The
 * SHAPE is checked instead, which catches the mistakes a plan actually
 * makes: an empty value, a doubled comma, a stray quote.
 */
export function parseToolList(value: string): readonly string[] | null {
  const parts = value.split(',');
  if (parts.length === 0) return null;

  const tools: string[] = [];
  for (const part of parts) {
    if (!TOOL_NAME.test(part)) return null;
    if (!tools.includes(part)) tools.push(part);
  }

  return tools;
}

/** The issue a recognised key with an unusable value produces. */
function unusableValue(key: string, token: string): DeclarationIssue {
  return { reason: 'unusable-value', key, text: token };
}

/** True when `key` is one of the four the grammar recognises. */
function isDeclarationKey(key: string): key is DeclarationKey {
  return (DECLARATION_KEYS as readonly string[]).includes(key);
}

/** Splits a block body into its tokens, dropping empty runs. */
function tokenise(body: string): string[] {
  const trimmed = body.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/);
}

/**
 * Reads a block body into a declaration, or answers null when it
 * carries no recognised key and is therefore ordinary task text.
 */
function readBlock(raw: string, body: string): TaskDeclaration | null {
  const entries: DeclarationEntry[] = [];
  const extras: DeclarationEntry[] = [];
  const issues: DeclarationIssue[] = [];
  const seen = new Set<string>();

  let agent: string | null = null;
  let model: string | null = null;
  let effort: EffortLevel | null = null;
  let tools: readonly string[] | null = null;

  for (const token of tokenise(body)) {
    const match = token.match(ENTRY_TOKEN);
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined) {
      issues.push({ reason: 'stray-token', key: '', text: token });
      continue;
    }

    const entry: DeclarationEntry = { key, value };
    entries.push(entry);

    if (!isDeclarationKey(key)) {
      extras.push(entry);
      continue;
    }
    if (seen.has(key)) {
      issues.push({ reason: 'duplicate-key', key, text: token });
      continue;
    }
    seen.add(key);

    if (key === 'agent') {
      if (AGENT_NAME.test(value)) agent = value;
      else issues.push(unusableValue(key, token));
      continue;
    }
    if (key === 'model') {
      if (isModelValue(value)) model = value;
      else issues.push(unusableValue(key, token));
      continue;
    }
    if (key === 'effort') {
      if (isEffortLevel(value)) effort = value;
      else issues.push(unusableValue(key, token));
      continue;
    }

    const parsed = parseToolList(value);
    if (parsed === null) issues.push(unusableValue(key, token));
    else tools = parsed;
  }

  if (seen.size === 0) return null;

  return { raw, entries, extras, issues, agent, model, effort, tools };
}

/**
 * Splits a task's text from the declaration block it may carry.
 *
 * Takes the TEXT of a task rather than a whole tracker line, which is
 * what `findNextTask` hands its caller. The anchor is therefore end of
 * text, and a trailing space is tolerated because the tracker's own
 * spelling puts two before the block.
 */
export function parseTaskDeclaration(taskText: string): ParsedTask {
  const trimmed = taskText.trimEnd();
  const match = trimmed.match(DECLARATION_BLOCK);
  const raw = match?.[0];
  const body = match?.[1];
  if (raw === undefined || body === undefined) {
    return { text: taskText, declaration: null };
  }

  const before = trimmed.slice(0, trimmed.length - raw.length).trimEnd();
  if (before.length === 0) return { text: taskText, declaration: null };

  const declaration = readBlock(raw, body);
  if (declaration === null) return { text: taskText, declaration: null };

  return { text: before, declaration };
}

/** The task text alone, for a caller with no use for the record. */
export function stripTaskDeclaration(taskText: string): string {
  return parseTaskDeclaration(taskText).text;
}

/**
 * Maps a declaration onto the flags the loop spawns Claude with.
 *
 * An `agent` outranks the granular keys entirely: the agent definition
 * already names a model and a tool set, and passing a flag beside it
 * would leave two authorities for one decision with no way to tell
 * which won. The suppressed keys are named rather than dropped, which
 * is what lets a report say a plan asked for something the agent did
 * not supply.
 *
 * A key whose value did not parse is absent from the record and so
 * emits nothing here — the task runs at the loop's defaults, which is
 * the failure worth having.
 */
export function resolveDeclarationFlags(
  declaration: TaskDeclaration | null,
): ResolvedFlags {
  if (declaration === null) return { args: [], suppressed: [] };

  if (declaration.agent !== null) {
    const isPresent = (key: GranularKey) => declaration[key] !== null;
    const suppressed = GRANULAR_KEYS.filter(isPresent);
    return { args: ['--agent', declaration.agent], suppressed };
  }

  const args: string[] = [];
  if (declaration.model !== null) args.push('--model', declaration.model);
  if (declaration.effort !== null) args.push('--effort', declaration.effort);
  if (declaration.tools !== null) {
    args.push('--tools', declaration.tools.join(','));
  }

  return { args, suppressed: [] };
}
