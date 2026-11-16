/**
 * `rafa issue comment <id> --body=<text>`: one comment on an issue on the
 * tracker the chain lands on.
 *
 * ## What is read
 *
 * The line first: exactly one argument, the id, and `--body`, required
 * and not blank. Then the tracker, through the chain
 * (`issue-tracker.ts`), and its `comment` on the ref the id names there.
 * The id is the adapter's to check, and on a degraded chain it names an
 * issue on the tracker fallen back to; the module note of
 * `issue-tracker.ts` says why. `github` posts the body with
 * `gh issue comment`, and `local` appends it, stamped with the time, to
 * the issue's file (`adapters/tracker/local.ts`).
 *
 * ## What it writes
 *
 * In text mode, `Commented on <kind> issue <id>.` In json mode the
 * terminal result's `data` is an {@link IssueCommentResult}: the tracker
 * and the ref commented on.
 *
 * ## `--upstream=<tool>`
 *
 * Posts the comment on an issue on the board of a tool the project
 * consumes, the one `collaborate.<tool>` names
 * (`.rafa/specs/rafa-751-report-rafa-gaps-bugs.md`), in this order:
 *
 *  1. **The line**, read as every line is; a blank `--upstream` is
 *     refused with the usage.
 *  2. **The gate**, `resolveUpstream` (`./upstream.ts`): the tool, the
 *     key, this board's owner and visibility, read with one
 *     `gh repo view`, and the same owner, each refusal exit 1 and ending
 *     `Nothing was filed.`, with no `gh issue` or `gh label` call sent.
 *     It writes the config's warnings, so the read of the same config
 *     for the secrets writes none.
 *  3. **The redaction**, `upstreamCommentRedactor` (`./upstream-text.ts`):
 *     the checkout the command runs in (`checkoutOf`, as `./create-bug.ts`
 *     reads it) and the project root taken out as `.`, the home as
 *     `[redacted: HOME]`, then every secret `namedSecrets` names.
 *  4. **The private-name rule**, `privateNameRule` (`./upstream-text.ts`),
 *     after the redaction: unless this board was read `PUBLIC`, its
 *     `owner/name`, its bare name and the package the checkout's and the
 *     project root's `package.json` name (`packageNames`, `./create.ts`)
 *     become `a private sibling repository`.
 *  5. **The comment**, on the `github` tracker made over
 *     `upstreamGhRunner` (`./upstream.ts`), on a ref whose `repo` is the
 *     upstream, so `gh issue comment` names `--repo <upstream>` and no
 *     other call is sent. No chain is resolved and no preflight runs. An
 *     id the upstream holds no issue under fails here, with `gh`'s own
 *     error.
 *
 * Text mode prints `Commented on github issue <id> on <upstream>.`; json
 * mode's {@link IssueCommentResult} carries `upstream`, and its ref the
 * upstream as `repo`.
 *
 * ## Refusals
 *
 * Exit code 1, as `issue-tracker.ts` words them: no id or more than one,
 * a `--body` left out or blank, a blank `--upstream`, each refusal of the
 * gate (`./upstream.ts`), a config refused, a chain landing
 * nowhere, and a `comment` that rejects, such as one for an id no issue
 * holds.
 */
import type { IssueSeams, IssueTrackerData } from './issue-tracker.js';
import type { UpstreamTarget } from './upstream.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { IssueRef } from '@open-tomato/rafa/ports';

import { checkoutOf } from '@open-tomato/rafa/bugs/fill';
import { expectOneArgument } from '@open-tomato/rafa/commands/plan/plan-files';
import { createGitRunner } from '@open-tomato/rafa/core/git';
import { rootPackageOf } from '@open-tomato/rafa/project/package-of';

import { createGhRunner, createGithubTracker } from '../../adapters/tracker/github.js';

import { packageNames } from './create.js';
import { ISSUE_COMMENT_DECLARATION } from './declarations.js';
import {
  DEFAULT_ISSUE_SEAMS,
  issueName,
  issueProject,
  issueRef,
  issueSubjectConfig,
  onTracker,
  readNonBlankFlag,
  readRequiredFlag,
  resolveIssueTracker,
} from './issue-tracker.js';
import { privateNameRule, upstreamCommentRedactor } from './upstream-text.js';
import { resolveUpstream, UPSTREAM_FLAG, upstreamGhRunner } from './upstream.js';

/**
 * The usage line a refusal names. `--upstream=<tool>` is left out of it:
 * `--help` lists the flag, and `src/tests/board-coupled/commands/issue/comment.test.ts`
 * holds this line as it is.
 */
const USAGE = 'rafa issue comment <id> --body=<text>';

/** The tracker an upstream comment is posted on, as json mode gives it: `github`, no chain resolved. */
const UPSTREAM_TRACKER: IssueTrackerData = Object.freeze({ kind: 'github', degraded: false, fallbackReason: null });

/** What json mode gives as the terminal result's `data`. */
export interface IssueCommentResult {
  readonly tracker: IssueTrackerData;
  /** The ref the comment was posted on, its `repo` the upstream under `--upstream`. */
  readonly ref: IssueRef;
  /** The upstream repository, `owner/name`, under `--upstream`; left out otherwise. */
  readonly upstream?: string;
}

/** What an `--upstream` line hands the comment: the id, the body as typed, and the tool. */
interface UpstreamComment {
  readonly id: string;
  readonly body: string;
  readonly tool: string;
}

/** `body` redacted and its private names hidden, for the board `target` read; see the module note. */
async function upstreamBody(context: RafaContext, seams: IssueSeams, body: string, target: UpstreamTarget): Promise<string> {
  const project = issueProject(context);
  // The gate wrote this config's warnings, so this read of it writes none.
  const config = await issueSubjectConfig(project, () => undefined);
  const cwd = (seams.cwd ?? ((): string => process.cwd()))();
  const checkout = checkoutOf(seams.git ?? createGitRunner(cwd), project.root);
  const redact = upstreamCommentRedactor({ roots: [checkout, project.root], home: project.home, config, env: context.env });
  const packages = [rootPackageOf(checkout), rootPackageOf(project.root)].flatMap(packageNames);
  const hide = privateNameRule({ own: target.own, ownIsPublic: target.ownIsPublic, packages });
  return hide(redact(body));
}

/** Posts the comment a line holds on the upstream's issue; see the module note. */
async function commentUpstream(context: RafaContext, seams: IssueSeams, line: UpstreamComment): Promise<IssueCommentResult> {
  const target = await resolveUpstream(context, seams, { action: 'comment', tool: line.tool });
  const body = await upstreamBody(context, seams, line.body, target);
  const gh = seams.gh ?? createGhRunner({ cwd: issueProject(context).root });
  const tracker = createGithubTracker({ gh: upstreamGhRunner(gh, target.upstream) });
  const ref: IssueRef = { ...issueRef(tracker, line.id), repo: target.upstream };
  await onTracker(tracker, `comment on issue ${line.id} on ${target.upstream}`, () => tracker.comment(ref, body));
  return { tracker: UPSTREAM_TRACKER, ref, upstream: target.upstream };
}

/** Posts the comment a line holds; see the module note. */
export async function commentOnIssue(context: RafaContext, seams: IssueSeams): Promise<IssueCommentResult> {
  const id = expectOneArgument(context.args, USAGE);
  const body = readRequiredFlag(context.flags, 'body', USAGE);
  const tool = readNonBlankFlag(context.flags, UPSTREAM_FLAG, USAGE);
  if (tool !== undefined) return commentUpstream(context, seams, { id, body, tool });
  const { tracker, data } = await resolveIssueTracker(context, seams);
  const ref = issueRef(tracker, id);
  await onTracker(tracker, `comment on issue ${id}`, () => tracker.comment(ref, body));
  return { tracker: data, ref };
}

/** The line text mode writes once the comment is posted, naming the upstream when it was posted there. */
export function renderCommented(commented: Pick<IssueCommentResult, 'ref' | 'upstream'>): string {
  const where = commented.upstream === undefined
    ? ''
    : ` on ${commented.upstream}`;
  return `Commented on ${issueName(commented.ref)}${where}.`;
}

/** The command, resolving the chain with `seams`; see the module note. */
export function createIssueCommentCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...ISSUE_COMMENT_DECLARATION,
    run: async (context) => {
      const commented = await commentOnIssue(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(commented);
        return;
      }
      context.output.info(renderCommented(commented));
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createIssueCommentCommand();
export default command;
