/**
 * `rafa issue list --upstream=<tool>`: the issues on the board of a tool
 * the project consumes, the one `collaborate.<tool>` names
 * (`.rafa/specs/rafa-751-report-rafa-gaps-bugs.md`), narrowed as the
 * `github` tracker's `find` narrows them.
 *
 * `list.ts` reads the line and hands {@link listUpstreamIssues} the tool
 * and the query: `--search` as `text`, `--type`, `--module` and
 * `--limit`, each left out absent. It refuses `--roadmap` and `--state`
 * beside `--upstream` before calling here, and writes what this answers.
 * This module imports nothing of `list.ts`, so the two hold no cycle.
 *
 * ## In order
 *
 *  1. **The gate**, `resolveUpstream` (`./upstream.ts`): the tool, the
 *     key, this board's owner read with one `gh repo view`, and the same
 *     owner. Each refusal is exit 1 and ends `Nothing was read.`, with no
 *     `gh issue` or `gh label` call sent.
 *  2. **The listing**, on the `github` tracker made over
 *     `upstreamGhRunner` (`./upstream.ts`): one `gh issue list` naming
 *     `--repo <upstream>`, 30 issues unless `--limit` says otherwise.
 *  3. **Each issue**, read with `get` on a ref whose `repo` is the
 *     upstream, all at once and in the order the listing answered them:
 *     one `gh issue view --repo <upstream>` per issue.
 *
 * No chain is resolved and no preflight runs: the upstream board is
 * GitHub's whatever `tracker.default` names. A listing or a read that
 * rejects refuses the whole list with exit 1, as `onTracker` words it,
 * naming the upstream.
 *
 * What is listed is read, not filed, so the private-name rule
 * (`./upstream-text.ts`) does not apply: nothing of this board leaves it.
 */
import type { IssueSeams, IssueTrackerData } from './issue-tracker.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { Issue, IssueQuery, IssueRef } from '@open-tomato/rafa/ports';

import { createGhRunner, createGithubTracker } from '../../adapters/tracker/github.js';

import { issueProject, onTracker } from './issue-tracker.js';
import { resolveUpstream, upstreamGhRunner } from './upstream.js';

/** The tracker an upstream listing is read from, as json mode gives it: `github`, no chain resolved. */
const UPSTREAM_TRACKER: IssueTrackerData = Object.freeze({ kind: 'github', degraded: false, fallbackReason: null });

/** What an upstream listing is asked: the tool `--upstream` named, as typed, and the query, with no state. */
export interface UpstreamListRequest {
  readonly tool: string;
  readonly query: Omit<IssueQuery, 'state'>;
}

/** What json mode gives as the terminal result's `data` under `--upstream`. */
export interface UpstreamIssueListResult {
  readonly tracker: IssueTrackerData;
  /** The query `find` was handed, each flag left out absent from it. */
  readonly query: Omit<IssueQuery, 'state'>;
  /** Each issue the listing answered, as `get` read it, its ref's `repo` the upstream. */
  readonly issues: readonly Issue[];
  /** The upstream repository, `owner/name`, as `collaborate.<tool>` writes it. */
  readonly upstream: string;
}

/** Lists the upstream board's issues a request asks for; see the module note. */
export async function listUpstreamIssues(
  context: RafaContext,
  seams: IssueSeams,
  request: UpstreamListRequest,
): Promise<UpstreamIssueListResult> {
  const { upstream } = await resolveUpstream(context, seams, { action: 'list', tool: request.tool });
  const gh = seams.gh ?? createGhRunner({ cwd: issueProject(context).root });
  const tracker = createGithubTracker({ gh: upstreamGhRunner(gh, upstream) });
  const listed = await onTracker(tracker, `list issues on ${upstream}`, () => tracker.find(request.query));
  const refs: IssueRef[] = listed.map((ref) => ({ ...ref, repo: upstream }));
  const issues = await onTracker(
    tracker,
    `read the issues listed on ${upstream}`,
    () => Promise.all(refs.map((ref) => tracker.get(ref))),
  );
  return { tracker: UPSTREAM_TRACKER, query: request.query, issues, upstream };
}
