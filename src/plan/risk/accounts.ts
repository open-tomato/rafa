/**
 * The accounts reading `rafa plan risk` reports: which remote a run
 * pushes to and whether that repository is public, which tracker issues
 * may be filed on, and which pull request provider the run goes
 * through. Four findings, every one a `note`, printed whatever they say.
 *
 * ## Where each answer comes from
 *
 * - **The push remote** is `origin`, because that is the remote the
 *   loop itself pushes to: `pushBranch` in `src/pr/none.ts` runs
 *   `git push --set-upstream origin <branch>`, and `src/pr/worktree.ts`
 *   and `src/pr/merge.ts` default their remote to `origin` too. Its URL
 *   is read with `git remote get-url --push origin`, which honours a
 *   `pushurl` where the plain form would print the fetch URL. With no
 *   `origin`, git exits 2 with `error: No such remote '<name>'`
 *   (measured, git on macOS, 2026-09-23), and the finding says the push
 *   would fail rather than naming a remote.
 * - **Its visibility** is `gh repo view <host>/<owner>/<repo> --json
 *   nameWithOwner,visibility`, asked only when the push URL names a
 *   GitHub host (`isGitHubRemote`, `src/pr/provider.ts`). `gh` answers
 *   `{"nameWithOwner":"open-tomato/rafa","visibility":"PUBLIC"}` for
 *   this repository and exits 1 with `GraphQL: Could not resolve to a
 *   Repository with the name '…'` for one that does not exist, both
 *   measured on 2026-09-23. A non-GitHub host, a failed `gh` and an
 *   answer with no visibility each say so in the finding: the reading
 *   never guesses `private`.
 * - **The issue tracker** is the chain the config names,
 *   `tracker.default` then `tracker.fallback`, each kind once at its
 *   first place, the order `src/adapters/tracker/resolve.ts` tries them.
 *   When the chain holds `github`, the repository that adapter files on
 *   is named too: it passes no `--repo`, so `gh` resolves the
 *   repository of the directory it runs in, which `gh repo view --json
 *   nameWithOwner` with no argument reads. The chain is NOT resolved:
 *   that runs each adapter's preflight, and this reading makes no
 *   tracker.
 * - **The pull request provider** is `resolvePrProvider`'s answer over
 *   the configured `pr.provider` and `origin`'s fetch URL, read through
 *   the same git seam. Under `gh` the repository `gh` resolves is named,
 *   the one a pull request is opened on.
 *
 * ## Seams
 *
 * git and `gh` are reached only through the two runners in
 * {@link AccountSeams}: the `pr` subject's synchronous `GitRunner` and
 * the tracker adapter's `GhRunner`, both of which answer instead of
 * throwing. The configuration arrives as {@link AccountSettings}. So
 * this module spawns nothing, reads no file and no environment, and
 * every unit test plants what git and `gh` say. `gh` is asked at most
 * twice, once for the push remote and once for the directory's own
 * repository, and the second only when the tracker chain holds `github`
 * or the provider is `gh`.
 *
 * ## Credentials in a remote URL
 *
 * A remote can carry a credential, `https://user:ghp_…@github.com/o/r`,
 * and a report is the last place it should appear. Every URL is printed
 * through {@link redactRemote}, which replaces the user-info of a
 * scheme URL with `***`.
 */
import type { RiskLevel } from './commands.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { PrProvider } from '../../config-sections.js';
import type { GitRunner } from '../../pr/git.js';

import { isGitHubRemote, remoteHost, resolvePrProvider } from '../../pr/provider.js';
import { normalizeRemote } from '../../schema/project-id.js';

/** The remote the loop pushes a branch to; see the module note. */
export const PUSH_REMOTE = 'origin';

/** The tracker kind whose adapter files through `gh`. */
const GITHUB_TRACKER = 'github';

/** The user-info of a scheme URL: everything between `://` and `@`. */
const URL_USER_INFO = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^@/]+@/;

/** Which of the four account readings a finding is. */
export type AccountSubject = 'push-remote' | 'visibility' | 'issue-tracker' | 'pr-provider';

/** One account reading. */
export interface AccountFinding {
  /** Always `note`: an account is a thing to know, not a refusal. */
  readonly level: RiskLevel;
  /** Always `account`. */
  readonly kind: 'account';
  /** Which reading this is. */
  readonly subject: AccountSubject;
  /** The line a report prints. */
  readonly text: string;
}

/** What the configuration says about accounts. */
export interface AccountSettings {
  /** `pr.provider` as the config resolved it: null when nobody has said. */
  readonly prProvider: PrProvider | null;
  /** `tracker.default`. */
  readonly trackerDefault: string;
  /** `tracker.fallback`, in the order written. */
  readonly trackerFallback: readonly string[];
}

/** The two runners every probe goes through; see the module note. */
export interface AccountSeams {
  /** Runs git in the repository being read. */
  readonly git: GitRunner;
  /** Runs `gh` in the repository being read. */
  readonly gh: GhRunner;
}

/** What `gh repo view` answered, or why it answered nothing. */
type RepoView =
  | { readonly ok: true; readonly name: string | null; readonly visibility: string | null }
  | { readonly ok: false; readonly reason: string };

/**
 * `url` with the user-info of a scheme URL replaced by `***`, so a
 * credential a remote carries never reaches a report. An scp-style
 * `git@host:path` carries no secret and is left as written.
 */
export function redactRemote(url: string): string {
  return url.trim().replace(URL_USER_INFO, '$1***@');
}

/**
 * The tracker kinds in the order the chain tries them: the default,
 * then each fallback, a kind named twice kept at its first place.
 */
export function trackerChain(settings: AccountSettings): readonly string[] {
  return [...new Set([settings.trackerDefault, ...settings.trackerFallback])];
}

/**
 * Reads the four account findings for the repository the seams run in.
 * Never throws: a missing remote, a missing `gh` and a failed probe are
 * each an answer in the finding's text.
 *
 * @param settings - What the configuration says.
 * @param seams - The git and `gh` runners.
 * @returns The push remote, its visibility, the issue tracker and the
 *   pull request provider, in that order.
 */
export async function readAccounts(
  settings: AccountSettings,
  seams: AccountSeams,
): Promise<readonly AccountFinding[]> {
  const pushUrl = remoteUrl(seams.git, ['remote', 'get-url', '--push', PUSH_REMOTE]);
  const fetchUrl = remoteUrl(seams.git, ['remote', 'get-url', PUSH_REMOTE]);
  const chain = trackerChain(settings);
  const reading = resolvePrProvider({
    configured: settings.prProvider,
    dir: '',
    readRemote: () => fetchUrl,
  });
  const needsOwnRepo = chain.includes(GITHUB_TRACKER) || reading.provider === 'gh';
  const ownRepo = needsOwnRepo
    ? await viewRepo(seams.gh, [])
    : null;

  return [
    finding('push-remote', pushRemoteText(pushUrl)),
    finding('visibility', await visibilityText(pushUrl, seams.gh)),
    finding('issue-tracker', trackerText(chain, ownRepo)),
    finding('pr-provider', providerText(reading.provider, reading.source, ownRepo)),
  ];
}

/** One `note` account finding. */
function finding(subject: AccountSubject, text: string): AccountFinding {
  return { level: 'note', kind: 'account', subject, text };
}

/** The URL git answered, trimmed, or null when it answered none. */
function remoteUrl(git: GitRunner, args: readonly string[]): string | null {
  const result = git(args);
  const url = result.stdout.trim();
  return result.ok && url !== ''
    ? url
    : null;
}

/** The push-remote line. */
function pushRemoteText(pushUrl: string | null): string {
  return pushUrl === null
    ? `push remote: no ${PUSH_REMOTE} remote, so the loop's push would fail`
    : `push remote: ${PUSH_REMOTE} → ${redactRemote(pushUrl)}`;
}

/** The visibility line, asking `gh` only for a GitHub push remote. */
async function visibilityText(pushUrl: string | null, gh: GhRunner): Promise<string> {
  if (pushUrl === null) {
    return 'visibility: not read, there is no push remote';
  }
  if (!isGitHubRemote(pushUrl)) {
    const host = remoteHost(pushUrl) ?? 'a local path';
    return `visibility: not read, ${host} is not a GitHub host`;
  }
  const slug = repoSlug(pushUrl);
  const view = await viewRepo(gh, [slug]);
  if (!view.ok) {
    return `visibility: not read, ${view.reason}`;
  }
  const name = view.name ?? slug;
  return view.visibility === null
    ? `visibility: not read, gh named no visibility for ${name}`
    : `visibility: ${name} is ${view.visibility}`;
}

/**
 * The `HOST/OWNER/REPO` form `gh repo view` takes for a GitHub remote:
 * `normalizeRemote`'s answer with a port dropped, and GitHub's SSH
 * endpoint `ssh.github.com` read as the `github.com` it serves.
 */
export function repoSlug(url: string): string {
  return normalizeRemote(url)
    .replace(/^([^/]+):\d+\//, '$1/')
    .replace(/^ssh\.github\.com\//, 'github.com/');
}

/** The issue-tracker line. */
function trackerText(chain: readonly string[], ownRepo: RepoView | null): string {
  const [first, ...rest] = chain;
  const fallback = rest.length === 0
    ? ''
    : `, falling back to ${rest.join(', then ')}`;
  const where = chain.includes(GITHUB_TRACKER) && ownRepo !== null
    ? `; github files on ${repoPhrase(ownRepo)}`
    : '';
  return `issue tracker: ${first ?? 'none configured'}${fallback}${where}`;
}

/** The pull-request-provider line. */
function providerText(provider: PrProvider, source: 'config' | 'remote', ownRepo: RepoView | null): string {
  const from = source === 'config'
    ? 'set in the config'
    : `inferred from ${PUSH_REMOTE}`;
  const effect = provider === 'gh' && ownRepo !== null
    ? `, opening pull requests on ${repoPhrase(ownRepo)}`
    : '';
  const none = provider === 'none'
    ? ', so the loop pushes and opens no pull request'
    : '';
  return `pull request provider: ${provider} (${from})${effect}${none}`;
}

/** The repository `gh` resolved, or why it resolved none. */
function repoPhrase(view: RepoView): string {
  if (!view.ok) {
    return `the repository gh resolves, which it could not: ${view.reason}`;
  }
  return view.name ?? 'the repository gh resolves, which it did not name';
}

/**
 * Asks `gh repo view` for a repository's name and visibility: the one
 * named in `target`, or the directory's own when it is empty.
 */
async function viewRepo(gh: GhRunner, target: readonly string[]): Promise<RepoView> {
  const result = await gh(['repo', 'view', ...target, '--json', 'nameWithOwner,visibility']);
  if (!result.ok) {
    return { ok: false, reason: `gh repo view: ${firstLine(result.stderr) ?? 'gh exited non-zero'}` };
  }
  const parsed = parseJsonObject(result.stdout);
  if (parsed === null) {
    return { ok: false, reason: 'gh repo view: answered no JSON object' };
  }
  return {
    ok: true,
    name: stringField(parsed, 'nameWithOwner'),
    visibility: stringField(parsed, 'visibility')?.toLowerCase() ?? null,
  };
}

/** `text` read as a JSON object, or null when it is not one. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** A non-empty string field of `object`, or null. */
function stringField(object: Record<string, unknown>, key: string): string | null {
  const value = object[key];
  return typeof value === 'string' && value !== ''
    ? value
    : null;
}

/** The first non-empty line of `text`, trimmed, or null. */
function firstLine(text: string): string | null {
  return text.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? null;
}
