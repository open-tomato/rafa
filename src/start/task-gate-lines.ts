/**
 * The task prompt's gate lines: the words that hand a session its task's
 * base commit and the `bun test --changed=<base>` it runs as its scoped
 * test gate. `buildTaskPrompt` (`dispatch.ts`) places them after the
 * blocker line and ahead of the sections.
 */

/**
 * What opens the prompt line handing a session its task's base commit.
 * The loop's words open it, as they open the blocker line.
 */
export const BASE_PROMPT_PREFIX = 'The base commit of this task is ';

/** A full or abbreviated git object name, the only shape a base may take. */
const COMMIT_NAME = /^[0-9a-f]{7,64}$/;

/**
 * The prompt line naming `base` and the `bun test --changed=<base>` the
 * session runs, or none for no base. Throws on a base that is not a
 * commit name: it is pasted into a shell command the session runs, and
 * the loop only ever hands it the HEAD git answered.
 */
export function baseLines(base: string | null): string[] {
  if (base === null) return [];
  if (!COMMIT_NAME.test(base)) {
    throw new Error(`The task's base \`${base}\` is not a commit name; the prompt pastes it into \`bun test --changed=\`.`);
  }
  return [`${BASE_PROMPT_PREFIX}${base}: run \`bun test --changed=${base}\` for the tests your changes reach.`];
}
