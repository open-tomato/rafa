/**
 * The budget a `rafa pr triage --resolve` run hands every session it
 * spawns: `pr.resolveBudget` written into the pinned plan's task lines
 * as the `budget=` declaration the loop already reads.
 *
 * The spec gives each resolve run `--max-budget-usd` from
 * `pr.resolveBudget` (`.rafa/specs/rafa-20-pr-commands.md`), and the loop
 * has exactly one way of passing that flag to a session: a task line's
 * trailing declaration block, whose `budget=<usd>` becomes
 * `--max-budget-usd <usd>` on the spawn (`src/utils/declaration.ts`).
 * So the budget is not a flag this command invents and threads through
 * the loop; it is a line the plan carries, written here into the copy
 * of the pinned plan the run is about to execute. A session started by
 * hand over that same file is spawned under the same cap.
 *
 * ## What counts as a task line
 *
 * A plan's tasks are flat `- [ ]` lines at column 0
 * (`src/plan-prompt.md`), and {@link TASK_LINE} is that shape: the
 * marker, whatever is inside its brackets, and a space. Every other
 * line — headings, prose, fenced blocks, indented continuations — comes
 * back byte-identical, so a plan with no task line at all is answered
 * unchanged rather than rewritten.
 *
 * A line inside a fenced block that LOOKS like a task would be
 * rewritten, since this module does not parse markdown. That is
 * deliberate: the four pinned plans carry no such block, the values
 * substituted into them are checked by `./load.ts` before they arrive,
 * and a fence-aware reader here would be a second, weaker copy of
 * `src/plan/blocks.ts` for a file this package ships and controls.
 *
 * ## A declaration already there is joined, never replaced
 *
 * `parseTaskDeclaration` reads the LAST `{...}` of a line as its
 * declaration, so a line that already carries `{agent=build-error-resolver}`
 * must come back as one block holding both entries and not as two
 * blocks — a second block would leave the agent inside the task TEXT,
 * where the loop would quote it into the prompt and route the task
 * nowhere.
 *
 * A line already declaring a budget of its own is left alone. The
 * declaration reader takes the FIRST occurrence of a repeated key and
 * reports the second as a `duplicate-key` issue, so appending would
 * both be ignored and print a warning per task; and a plan that names
 * its own budget has said something this module has no reason to
 * overrule.
 *
 * ## The amount is refused rather than rounded
 *
 * `budget=` accepts a decimal of at most six whole digits and six
 * decimal places, no sign and no exponent ({@link parseBudgetUsd}), and
 * `String` writes an exponent below a millionth. A `pr.resolveBudget`
 * outside that shape passes the config reader — which asks only for a
 * number above zero — and would reach a task line as `1e-7`, a value
 * the declaration reader drops with an `unusable-value` issue and the
 * session then runs uncapped. Silently running uncapped is the one
 * outcome a budget exists to prevent, so {@link budgetEntry} throws
 * instead, naming the value and the shape.
 */
import { parseBudgetUsd } from '../../utils/declaration.js';

/** The declaration key the loop reads a session's budget from. */
export const BUDGET_KEY = 'budget';

/** A flat plan task line: `- [<mark>] ` at column 0; see the module note. */
const TASK_LINE = /^- \[[^\]]*\] /;

/** The trailing declaration block of a line, holding no brace of its own. */
const TRAILING_BLOCK = /\{([^{}]*)\}$/;

/** What every refusal from this module opens with. */
const PREFIX = 'pr triage --resolve budget';

/**
 * `budget=<usd>` as a declaration entry, for an amount the loop can
 * pass on.
 *
 * @throws TypeError when `usd` is no amount `budget=` accepts; see the
 * module note.
 */
export function budgetEntry(usd: number): string {
  const spelled = String(usd);
  if (parseBudgetUsd(spelled) === null) {
    throw new TypeError(
      `${PREFIX}: refused an amount of ${JSON.stringify(usd)}, expected US dollars above zero`
        + ' with at most six whole digits and six decimal places',
    );
  }
  return `${BUDGET_KEY}=${spelled}`;
}

/** Whether a line's declaration block already names a budget of its own. */
function declaresBudget(body: string): boolean {
  return body.split(/\s+/).some((token) => token.startsWith(`${BUDGET_KEY}=`));
}

/** One task line with `entry` joined onto its declaration, or given one. */
function withEntry(line: string, entry: string): string {
  const trimmed = line.trimEnd();
  const match = trimmed.match(TRAILING_BLOCK);
  const raw = match?.[0];
  const body = match?.[1];
  if (raw === undefined || body === undefined) return `${trimmed} {${entry}}`;
  if (declaresBudget(body)) return line;
  const before = trimmed.slice(0, trimmed.length - raw.length).trimEnd();
  if (before.length === 0) return `${trimmed} {${entry}}`;
  return `${before} {${body.trim()} ${entry}}`;
}

/**
 * `plan` with `budget=<usd>` on every task line that declares no budget
 * already, and every other line byte-identical.
 *
 * @throws TypeError when `usd` is no amount `budget=` accepts.
 */
export function withTaskBudget(plan: string, usd: number): string {
  const entry = budgetEntry(usd);
  return plan
    .split('\n')
    .map((line) => (TASK_LINE.test(line)
      ? withEntry(line, entry)
      : line))
    .join('\n');
}
