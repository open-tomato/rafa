/**
 * The `conflict-version` run of `rafa pr triage --resolve`: one
 * worktree, one conversion, one push, and the worktree removed.
 *
 * `./triage-resolve.ts` dispatches a pull request whose class is in
 * `CONVERSION_TRIAGE_CLASSES` (`src/pr/triage/classes.ts`) here, ahead
 * of the pinned-plan check that would otherwise read it as "not simple"
 * and ahead of the loop path. What the conversion writes and commits is
 * `src/pr/triage/version-convert.ts`'s; the worktree's add and removal
 * are the resolve run's own, handed in, so both paths add and remove a
 * worktree one way.
 *
 * ## What it does not do, and why
 *
 *   - **No plan, no session, no CI wait.** The fix needs nothing from
 *     what the pull request was for, so it is code.
 *   - **No attempt raised.** The counter guards sessions that may do
 *     nothing; the conversion is the same commit every time, and a second
 *     run over a converted branch answers `unstamped` and writes nothing.
 *   - **No triage comment.** The pushed commit moves the head, and the
 *     next `rafa pr triage` assesses the moved head and edits the comment
 *     then, naming whatever the stamp was hiding: a conflict on another
 *     file, a red check.
 *
 * The push is `pushResolved` (`src/pr/worktree.ts`), never forced. A
 * converted and pushed branch, and a branch the guard no longer reads as
 * stamped, are not failures; a refused conversion or a refused push is,
 * and the caller ends it as a run that did not fix what it was asked
 * about.
 */
import type { Output } from '../../ports/index.js';
import type { GitRunner, PullRequestDetail } from '../../pr/index.js';
import type { SettleSettings } from '../../release/settle.js';

import { conversionLines, convertStampedVersion } from '../../pr/triage/version-convert.js';
import { pushResolved } from '../../pr/worktree.js';

/** How the resolve run adds and removes its worktree. */
export interface ConversionWorktree {
  /** Adds the worktree, or reuses one, answering its path; throws when git refuses. */
  readonly open: () => string;
  /** Removes the worktree at the path, answering the line that says how it went. */
  readonly close: (path: string) => string;
}

/** What one conversion run is handed. */
export interface ConversionRunInput {
  /** The pull request as `gh pr view` answered it. */
  readonly detail: PullRequestDetail;
  /** The pull request number. */
  readonly number: number;
  /** The release settings the conversion reads. */
  readonly release: SettleSettings;
  /** The git runner for a directory. */
  readonly git: (root: string) => GitRunner;
  /** The clock, ISO 8601. */
  readonly now: () => string;
  /** Where the run's first line goes. */
  readonly output: Output;
  /** The worktree's add and removal. */
  readonly worktree: ConversionWorktree;
}

/** What one conversion run came to. */
export interface ConversionRunOutcome {
  /** True when the conversion's commit was made. */
  readonly converted: boolean;
  /** True when the conversion or its push was refused; see the module note. */
  readonly failed: boolean;
  /** The one line naming how the run ended. */
  readonly headline: string;
  /** Every line the report carries, the headline first. */
  readonly lines: readonly string[];
}

/** Runs the conversion for one pull request; see the module note. */
export function runVersionConversion(input: ConversionRunInput): ConversionRunOutcome {
  const { detail, number } = input;
  input.output.info(`🔧 Converting #${number}'s stamped version into a release fragment: no session, no attempt spent`);
  const worktree = input.worktree.open();
  const git = input.git(worktree);
  const conversion = convertStampedVersion({
    git,
    worktree,
    settings: input.release,
    base: detail.baseRefName,
    branch: detail.headRefName,
    pullRequest: number,
    title: detail.title,
    head: detail.headRefOid,
    now: new Date(input.now()),
  });
  const pushed = conversion.outcome === 'converted'
    ? pushResolved(git, detail.headRefName)
    : null;
  const removal = input.worktree.close(worktree);
  const failed = conversion.outcome === 'refused' || pushed?.ok === false;
  const said = conversionLines(conversion, input.release);
  const push = pushed === null
    ? []
    : [pushed.ok
      ? `Pushed ${detail.headRefName}; run rafa pr triage ${number} once its checks have run on the new head.`
      : `The conversion was committed in the worktree but not pushed: ${pushed.command}: ${pushed.said}`];
  const headline = failed
    ? `⛔ rafa pr triage --resolve did not convert #${number}: ${said[0] ?? ''}`
    : `✅ #${number}: ${said[0] ?? ''}`;
  return {
    converted: conversion.outcome === 'converted',
    failed,
    headline,
    lines: [headline, ...said.slice(1), ...push, removal],
  };
}
