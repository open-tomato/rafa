/**
 * The command line a report points at for a saved copy whose references
 * need reading again: `rafa issue check <n>`.
 *
 * It is spelled once so no two reports can spell the fix differently:
 * `rafa doctor`'s references row (`src/commands/doctor-refs.ts`) and the
 * warning `rafa roadmap` writes for a copy it could not read
 * (`src/board/roadmap-rows.ts`) both name it. It was `doctor-refs.ts`'s
 * until the board module needed it, and `doctor-refs.ts` imports
 * `roadmap-rows.ts` back for its `RefsCell` type, so the two files
 * imported each other; this one imports nothing, so either side takes
 * the spelling from here.
 */

/** The fix a copy holding a suspect or dangling reference is pointed at. */
export function issueCheckCommand(issue: number): string {
  return `rafa issue check ${String(issue)}`;
}
