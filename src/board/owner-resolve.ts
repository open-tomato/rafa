/**
 * Whether a board's `Owner:` handle names someone GitHub knows.
 *
 * `.rafa/specs/rafa-245-boards-several-roadmaps-per.md` has `rafa board
 * list` show an owner that resolves to nobody as unresolved, because
 * GitHub reads CODEOWNERS with "a handle that does not resolve matches
 * nobody". This module is that one reading; showing it and refusing on
 * it (#247's owner gate) belong to the callers.
 *
 * ## The lookup
 *
 * One `gh api` command per handle, chosen by its shape
 * ({@link ownerLookupArgs}):
 *
 * - `@org/team` asks `gh api orgs/<org>/teams/<slug>`;
 * - `@login` asks `gh api users/<login>`, which answers for a user and
 *   an organisation alike.
 *
 * A handle that is not one `@login` or `@org/team` (`isOwnerHandle` in
 * `./board-body.js`, the rule the `Owner:` reader applies) sends nothing:
 * its text never becomes part of an API path.
 *
 * ## The three answers
 *
 * {@link OwnerResolution} is one of:
 *
 * - `resolved` — `gh` exited 0. The body is not read: GitHub answered
 *   the path, so the account or team exists.
 * - `unresolved` — `gh` failed with `(HTTP 404)` on stderr, the shape
 *   `src/pr/gh-fake-shapes.ts` records off `gh` 2.100.0. GitHub also
 *   answers a secret team the token cannot see with a 404, so
 *   `unresolved` means "no one this token can see", which is the reading
 *   CODEOWNERS itself gets.
 * - `unknown` with a `reason` — any other failure: `gh` missing,
 *   unauthenticated, offline, a 403 or rate limit, or a malformed
 *   handle. Nobody said the handle is wrong, so it is never reported as
 *   unresolved; the reason is what `gh` wrote, or why nothing was sent.
 *
 * ## Once per command
 *
 * {@link createOwnerResolver} keeps each answer for the resolver's life,
 * keyed by the handle case folded (GitHub compares handles without case),
 * and keeps the pending lookup rather than the settled one, so two boards
 * naming one team, asked at once, still send one command. A command makes
 * one resolver and drops it on exit, so a handle is read once per command
 * and never across two.
 *
 * Nothing here spawns: the {@link GhRunner} seam from
 * `src/adapters/tracker/github.ts` arrives with the options, and
 * `./owner-resolve.test.ts` drives a recorded fake.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { isOwnerHandle } from './board-body.js';

/** What one handle's lookup answered; see the module note. */
export type OwnerResolution =
  | { readonly handle: string; readonly state: 'resolved' }
  | { readonly handle: string; readonly state: 'unresolved' }
  | { readonly handle: string; readonly state: 'unknown'; readonly reason: string };

/** The three states an {@link OwnerResolution} can be in. */
export type OwnerResolutionState = OwnerResolution['state'];

/** Resolves one owner handle; see {@link createOwnerResolver}. */
export type OwnerResolver = (handle: string) => Promise<OwnerResolution>;

/** What {@link createOwnerResolver} is made with. */
export interface OwnerResolverOptions {
  /** Runs the one `gh api` command a handle's lookup sends. */
  readonly gh: GhRunner;
}

/** What a 404 from `gh api` carries on stderr. */
const NOT_FOUND = '(HTTP 404)';

/**
 * The `gh` arguments that look `handle` up: `['api', 'orgs/<org>/teams/<slug>']`
 * for `@org/team`, `['api', 'users/<login>']` for `@login`, and null for
 * text that is not one handle.
 */
export function ownerLookupArgs(handle: string): readonly string[] | null {
  if (!isOwnerHandle(handle)) {
    return null;
  }

  const [account = '', slug] = handle.slice(1).split('/');
  return slug === undefined
    ? ['api', `users/${account}`]
    : ['api', `orgs/${account}/teams/${slug}`];
}

/** What a failed command wrote, for an `unknown` reason. Never empty. */
function failureReason(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** One lookup of `handle` over `gh`, uncached. */
async function lookUp(gh: GhRunner, handle: string): Promise<OwnerResolution> {
  const args = ownerLookupArgs(handle);
  if (args === null) {
    return { handle, state: 'unknown', reason: `${JSON.stringify(handle)} is not an @login or @org/team handle, so nothing was asked` };
  }

  const result = await gh(args);
  if (result.ok) {
    return { handle, state: 'resolved' };
  }

  return result.stderr.includes(NOT_FOUND)
    ? { handle, state: 'unresolved' }
    : { handle, state: 'unknown', reason: failureReason(result, `gh ${args.join(' ')}`) };
}

/**
 * A resolver over `options.gh` that reads each handle once for its life;
 * see the module note. Make one per command.
 */
export function createOwnerResolver(options: OwnerResolverOptions): OwnerResolver {
  const { gh } = options;
  const answers = new Map<string, Promise<OwnerResolution>>();

  return (handle: string): Promise<OwnerResolution> => {
    const key = handle.toLowerCase();
    const known = answers.get(key);
    if (known !== undefined) {
      return known.then((answer) => ({ ...answer, handle }));
    }

    const pending = lookUp(gh, handle);
    answers.set(key, pending);
    return pending;
  };
}
