/**
 * The fence a bug's free text is shown in, shared by the loop's own
 * filing (`../triage/issue-text.ts`, which re-exports it) and the bug
 * record (`./record.ts`). A leaf: it imports nothing, so either side
 * reaches it without importing the other.
 */

/** The shortest fence a value is shown in. */
const MIN_FENCE_LENGTH = 3;

/** A value in a fence one backtick longer than any run of backticks it holds. */
export function fenced(value: string): string {
  const runs = Array.from(value.matchAll(/`+/g), (run) => run[0].length);
  const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, ...runs.map((length) => length + 1)));
  const body = value.endsWith('\n')
    ? value
    : `${value}\n`;
  return `${fence}\n${body}${fence}`;
}
