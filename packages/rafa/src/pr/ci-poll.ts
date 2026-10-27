/**
 * How often a wait on a pull request's checks reads them again.
 *
 * Two waits poll the same checks: run's CI gate
 * (`src/start/pr-lifecycle.ts`), and pr's `rafa pr wait`
 * (`src/commands/pr/wait.ts`) and `rafa pr triage --resolve`
 * (`src/commands/pr/triage-resolve.ts`). They read one interval, this
 * file's, so they agree about how often a pending check is read. It
 * sits in core because pr moves into its package before run does, and a
 * package may not import a package that moves after it (the seventh
 * decouple item of #808).
 */

/** Seconds between polls. CI here settles in 2-5 minutes. */
export const CI_POLL_INTERVAL_MS = 20_000;
