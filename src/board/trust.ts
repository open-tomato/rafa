/**
 * Whether the account behind a piece of board text is allowed to change
 * this repository: the one permission reading, the allow-list beside it,
 * the refusal a failed lookup shares with an outsider, and the sentence
 * both refuse with.
 *
 * Text off the board ends up in an agent's prompt. An issue body becomes
 * the spec a plan is written from, and a `rafa:pr-triage` comment
 * carries a follow-up prompt another session is handed whole, so anyone
 * who can write either can write instructions rafa would otherwise
 * carry out. GitHub lets only the author and the repository's
 * write-holders edit a body, so a trusted AUTHOR is what makes a trusted
 * BODY, and that is the one question this module answers
 * (`.rafa/specs/rafa-20-pr-commands.md`).
 *
 * ONE rule answers it — {@link readAuthorTrust}, the allow-list and
 * then the permission reading — and a second reading spelled somewhere
 * else is a second place for the answer to drift, with the one it would
 * drift towards being a pass. So every caller comes here.
 *
 * A board reader asks it through {@link readBoardTrust}, the one entry
 * point over a {@link BoardTrust}: the lookup, the allow-list and the
 * repository label in one value, so a reader cannot hold half the
 * question. {@link requireTrustedBoardAuthor} is that reading with the
 * refusal on the end, for the callers that refuse rather than ignore.
 * Both are {@link readAuthorTrust} and add no rule of their own.
 *
 * ## The callers
 *
 * TWO are in `src/commands/pr/triage-trust.ts`, both on
 * {@link readAuthorTrust} directly and carrying their own
 * `TriageTrust`: the `rafa:pr-triage` marker-comment reader, and
 * `pr triage --resolve` on the pull request's own author.
 *
 * A THIRD is what {@link readBoardTrust} was added for and is wired:
 * `plan create`, in `src/board/plan-spec.ts`'s `inspectSpecIssue`,
 * which runs {@link requireTrustedBoardAuthor} over the issue's
 * `author` ahead of the label check, the leak refusal and the
 * completeness refusal, so an untrusted body is refused before a byte
 * of it is snapshotted. BOTH `plan create` routes reach it — the
 * issue `--issue=<n>` names, and the line a `--next` walk picks.
 *
 * TWO are still unwired, each a task of its own, and until one lands
 * the route it names runs the checks it ran before:
 *
 *  - the ROADMAP issue's own body, which `plan create --next` reads to
 *    pick a line (`src/plan.ts`, `./roadmap.ts`). The line it picks is
 *    checked; the roadmap that named it is not.
 *  - the `rafa:spec-review` marker comment (`./review-comment.ts`),
 *    whose reader is filtered by author rather than refused.
 *
 * `context/pull-requests.md` carries what closing them costs.
 *
 * ## What a planted spec-review comment can take
 *
 * The spec-review reader is a caller for a DIFFERENT reason from the
 * other two, and this note said for a while that it was no caller at
 * all. Nothing in that comment is read back into a prompt —
 * `findSpecReviewComment` takes a comment's id and nothing else — so no
 * text of a stranger's reaches a session through it, and that much is
 * still true.
 *
 * What a planted marker comment CAN take is the EDIT. The gate keeps
 * one spec-review comment per issue and edits the newest marked one, so
 * a comment somebody else marked is the one it would PATCH. GitHub
 * refuses an edit of another account's comment, so the outcome is not a
 * changed verdict but a LOST REPORT: the gap list the author needed is
 * never posted, run after run, and what a person sees on the issue is
 * whatever the planted comment says. That is worth a lookup, and the
 * reading the filter spends is this module's.
 *
 * ## The reading
 *
 * `gh api repos/{owner}/{repo}/collaborators/<login>/permission`, which
 * answers `permission`, `role_name` and `user`; the readings taken are
 * recorded in `src/pr/gh-fake-shapes.ts`, and they cover `admin` for a
 * write-holder and `read` for an outsider on a public repository.
 *
 * BOTH permission fields are read, and either one naming `admin`,
 * `maintain` or `write` is trust. `maintain` is in the spec's list and
 * in NEITHER reading taken: GitHub DOCUMENTS the legacy `permission`
 * field as answering `admin`, `write`, `read` or `none`, with
 * `role_name` carrying the finer role, so a reader taking one field
 * alone would answer for a role the other would have named. Reading
 * both is the shape that cannot miss a `maintain` whichever field
 * carries it — taken from the documentation, not from a reading, and a
 * maintainer read on a live repository is what would settle it. A
 * reader on a public repository and a triager are neither field's trust
 * and are refused.
 *
 * The path carries the `{owner}/{repo}` placeholders rather than a
 * repository this module was told about, because `gh` resolves the
 * repository of the directory its runner runs in — the rule
 * `src/pr/gh.ts` keeps for every path it builds, and for the same
 * reason: a second source of truth for the repository is a way for the
 * two halves to disagree.
 *
 * Nothing here spawns. {@link createGhPermissions} takes the
 * {@link GhRunner} seam declared in `src/adapters/tracker/github.ts`, as
 * the pull request adapter and the issue tracker do, so the cases in
 * `./trust.test.ts` drive it through the recorded fake and none of them
 * reaches GitHub or reads the configuration `gh` keeps under the home.
 *
 * ## A failed lookup is a refusal
 *
 * A lookup that does not answer — `gh` missing, unauthenticated, offline,
 * rate-limited, a 404 on a login that is no account, or a payload with
 * neither permission field — reads as {@link TrustReading.refusal}
 * `lookup-failed`, never as a pass. That is the whole point of the
 * check: an attacker who can make the lookup fail is exactly the
 * attacker the check exists for, and a reading that fell back to "let it
 * through" would be a check that turns itself off under pressure.
 *
 * The two refusals are held apart rather than merged, because they are
 * different claims about the world. `no-write-access` says GitHub
 * answered and the answer was no; `lookup-failed` says nobody answered,
 * and its sentence must not tell an operator their colleague lacks
 * access when what happened was an expired token.
 *
 * ## The allow-list
 *
 * `board.trustedAuthors` is asked FIRST, and a hit spends no lookup. It
 * exists for the author a permission lookup cannot speak for: a bot
 * account, or a maintainer whose access is held through an organisation
 * the endpoint does not report. Matching is case-insensitive, because
 * GitHub logins are: `Octocat` and `octocat` are one account, and an
 * allow-list that disagreed with GitHub about that would refuse the
 * person it was written for.
 *
 * A login that is not shaped like a GitHub login is refused before
 * either answer is consulted, through `isGitHubLogin`
 * (`src/config-sections.ts`), and refused as `lookup-failed`, since no
 * lookup can be made for it. The shape check is also what keeps the
 * login out of the path's structure: `../../x` or a leading `-` would
 * otherwise reach `gh` as a different path or as a flag. It is checked
 * twice on the `gh` route — here and in {@link createGhPermissions} —
 * because the permission reader is exported and a later caller may reach
 * it without coming through {@link readAuthorTrust}.
 *
 * ## The refusal
 *
 * `CommandExit(2, ...)` from {@link requireTrustedAuthor} — or from
 * {@link requireTrustedBoardAuthor}, which is that call after the
 * reading — thrown before the body is read any further or snapshotted,
 * and its sentence is {@link trustRefusalMessage}'s. Exit 2 is the spec's own code for it.
 * The message names the item, the login, the repository and what the
 * operator must do, because the dispatcher drops a nonzero exit's
 * payload and anything the operator has to read belongs in the message.
 *
 * The sentence is a function and not a constant because two of the
 * callers refuse over different things — an issue whose body would
 * become a spec, and a pull request `--resolve` would edit — and a
 * refusal that named neither would leave the operator guessing which
 * read was refused. What varies is the item and the remedy
 * ({@link REMEDY}); the claim about access is one spelling for both.
 *
 * ## What this module does not do
 *
 * It does not decide what a caller does with an untrusted reading. An
 * issue is refused; a marker comment is IGNORED and reported, so a
 * planted triage comment cannot supply the follow-up prompt; and
 * `pr triage --resolve` refuses unless the author is listed. Those are
 * the callers', and this module answers all three the same way: a
 * reading, with a sentence to print when the answer is no.
 *
 * It does not read comments into anything either. Trusting an author
 * trusts a BODY, which only the author and the write-holders can edit;
 * a comment is not a body and is never read into a plan.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { CommandExit } from '../cli/command.js';
import { describeValue, isGitHubLogin, isMapping, messageOf } from '../config-sections.js';

/** The repository placeholders `gh api` expands from the directory it runs in. */
const REPO_PATH = '{owner}/{repo}';

/** The permissions that mean the login may change the repository. */
export const TRUSTED_PERMISSIONS = ['admin', 'maintain', 'write'] as const;

/** One of the three permissions that are trust. */
export type TrustedPermission = (typeof TRUSTED_PERMISSIONS)[number];

/** The exit code a refused read of board text ends with; the spec's own. */
export const TRUST_REFUSAL_EXIT = 2;

/** What the collaborators endpoint answered about one login. */
export interface PermissionReading {
  /** The login asked about, as it was handed over. */
  readonly login: string;
  /** The `permission` field, or null when the lookup answered none. */
  readonly permission: string | null;
  /** The `role_name` field, or null when the lookup answered none. */
  readonly roleName: string | null;
  /** What went wrong, when the lookup failed. Empty when it did not. */
  readonly detail: string;
}

/**
 * Reads one login's permission on the repository. A lookup that fails
 * answers a reading carrying the failure, and never rejects: a refusal
 * is the answer, not an exception the caller has to remember to catch.
 */
export type Permissions = (login: string) => Promise<PermissionReading>;

/** Which answer trusted a login. */
export type TrustSource = 'allow-list' | 'permission';

/** Why a login is not trusted; the module note holds them apart. */
export type TrustRefusal = 'lookup-failed' | 'no-write-access';

/** Whether one login is trusted with board text, and what said so. */
export interface TrustReading {
  /** The login asked about, as it was handed over. */
  readonly login: string;
  /** True when board text from this login may reach a prompt. */
  readonly trusted: boolean;
  /** Which answer trusted it, or null when neither did. */
  readonly source: TrustSource | null;
  /** Why it is not trusted, or null when it is. */
  readonly refusal: TrustRefusal | null;
  /** The lookup behind it, or null when the allow-list answered first. */
  readonly permission: PermissionReading | null;
}

/** What a refusal calls the thing the login opened. */
export type BoardItemKind = 'issue' | 'pull request';

/**
 * The board item a refusal names, without the repository: what a caller
 * holding a {@link BoardTrust} has to spell, since the trust already
 * carries the label.
 */
export interface BoardItemRef {
  /** What the number names. */
  readonly kind: BoardItemKind;
  /** Its number on the board. */
  readonly number: number;
}

/** The board item a refusal names. */
export interface BoardItem extends BoardItemRef {
  /** The repository, as the refusal spells it: `owner/name`. */
  readonly repo: string;
}

/** What {@link readAuthorTrust} is asked. */
export interface AuthorTrustOptions {
  /** The login that wrote the board text. */
  readonly login: string;
  /** The permission lookup; {@link createGhPermissions} makes the `gh` one. */
  readonly permissions: Permissions;
  /** `board.trustedAuthors`: the logins trusted without a lookup. */
  readonly trustedAuthors: readonly string[];
}

/** What {@link createGhPermissions} is made with. */
export interface GhPermissionsOptions {
  /** Runs the one `gh api` command the lookup sends. */
  readonly gh: GhRunner;
}

/**
 * What a board caller reads trust through, for one repository: the two
 * answers {@link readBoardTrust} asks in order, and the label a refusal
 * spells. The three travel together because a caller holding the
 * lookup without the allow-list would refuse the bot the list exists
 * for, and one holding both without the label could not name the
 * repository its refusal is about.
 *
 * `src/commands/pr/triage-trust.ts` declares its own `TriageTrust` of
 * the same three fields; the shapes are not shared because the triage
 * one is what the PR command passes around, and this one is what a
 * board reader is handed.
 */
export interface BoardTrust {
  /** The permission lookup; {@link ghBoardTrust} makes the `gh` one. */
  readonly permissions: Permissions;
  /** `board.trustedAuthors`: the logins trusted without a lookup. */
  readonly trustedAuthors: readonly string[];
  /** What a refusal calls the repository: `owner/name`. */
  readonly repo: string;
}

/** What {@link ghBoardTrust} is made with. */
export interface GhBoardTrustOptions {
  /** Runs the one `gh api` command a lookup sends. */
  readonly gh: GhRunner;
  /** `board.trustedAuthors` as the configuration resolved it. */
  readonly trustedAuthors: readonly string[];
  /** What a refusal calls the repository: `owner/name`. */
  readonly repo: string;
}

/** What the operator must do, per item; see the module note. */
const REMEDY: Readonly<Record<BoardItemKind, string>> = Object.freeze({
  issue: 'a member must open the spec',
  'pull request': 'a member must open the pull request',
});

/** What a lookup that failed and said nothing is reported as. */
const UNREPORTED = 'the lookup wrote nothing';

/** What a reading whose lookup failed is reported as. Never empty. */
function failureDetail(reading: TrustReading): string {
  const detail = reading.permission?.detail ?? '';
  return detail === ''
    ? UNREPORTED
    : detail;
}

/** True when either permission field names one of {@link TRUSTED_PERMISSIONS}. */
function isTrustedPermission(value: string | null): boolean {
  return TRUSTED_PERMISSIONS.some((permission) => permission === value);
}

/** The string at a payload key, or null for anything else. */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string'
    ? value
    : null;
}

/** A reading of a lookup that did not answer, carrying what went wrong. */
function lookupFailed(login: string, detail: string): PermissionReading {
  return { login, permission: null, roleName: null, detail };
}

/** What a failed command wrote, for a reading's detail. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/**
 * A permission lookup over `options.gh`: one `gh api` command per
 * login, answered as a reading. See the module note for the path, the
 * two fields read and why a failure is an answer.
 */
export function createGhPermissions(options: GhPermissionsOptions): Permissions {
  const { gh } = options;

  return async (login: string): Promise<PermissionReading> => {
    if (!isGitHubLogin(login)) {
      return lookupFailed(login, `${describeValue(login)} is not a GitHub login, so no permission was read`);
    }

    const path = `repos/${REPO_PATH}/collaborators/${login}/permission`;
    const command = `gh api ${path}`;
    const result = await gh(['api', path]);
    if (!result.ok) return lookupFailed(login, detailOf(result, command));

    let payload: unknown;
    try {
      payload = JSON.parse(result.stdout) as unknown;
    } catch (error) {
      return lookupFailed(login, `${command} wrote output that is not JSON: ${messageOf(error)}`);
    }
    if (!isMapping(payload)) {
      return lookupFailed(login, `${command} answered ${describeValue(payload)}, expected a mapping`);
    }

    const permission = stringOrNull(payload['permission']);
    const roleName = stringOrNull(payload['role_name']);
    return permission === null && roleName === null
      ? lookupFailed(login, `${command} answered neither a permission nor a role_name`)
      : { login, permission, roleName, detail: '' };
  };
}

/**
 * Whether board text from `options.login` may reach a prompt: the
 * allow-list first, then the permission lookup, with a failed lookup
 * refused rather than passed. The module note holds every rule.
 */
export async function readAuthorTrust(options: AuthorTrustOptions): Promise<TrustReading> {
  const { login, permissions, trustedAuthors } = options;

  if (!isGitHubLogin(login)) {
    const detail = `${describeValue(login)} is not a GitHub login, so no permission was read`;
    return {
      login,
      trusted: false,
      source: null,
      refusal: 'lookup-failed',
      permission: lookupFailed(login, detail),
    };
  }

  const wanted = login.toLowerCase();
  const listed = trustedAuthors.some((author) => author.toLowerCase() === wanted);
  if (listed) {
    return { login, trusted: true, source: 'allow-list', refusal: null, permission: null };
  }

  const permission = await permissions(login);
  if (permission.detail !== '') {
    return { login, trusted: false, source: null, refusal: 'lookup-failed', permission };
  }

  const trusted = isTrustedPermission(permission.permission) || isTrustedPermission(permission.roleName);
  return {
    login,
    trusted,
    source: trusted
      ? 'permission'
      : null,
    refusal: trusted
      ? null
      : 'no-write-access',
    permission,
  };
}

/**
 * A board trust over one `gh` runner: the permission lookup
 * {@link createGhPermissions} makes, the allow-list and the repository
 * label, bundled for the readers that take one.
 *
 * Makes no lookup and spawns nothing — `createGhRunner` answers a
 * function, and the first `gh api` is sent when a login is asked about.
 */
export function ghBoardTrust(options: GhBoardTrustOptions): BoardTrust {
  return {
    permissions: createGhPermissions({ gh: options.gh }),
    trustedAuthors: options.trustedAuthors,
    repo: options.repo,
  };
}

/**
 * THE entry point for a board reader: whether board text `login` wrote
 * may reach a prompt, over `trust`'s allow-list and then its permission
 * reading.
 *
 * The rule is {@link readAuthorTrust}'s and is spelled once; this is
 * that call over a {@link BoardTrust}, so no board reader assembles the
 * two answers itself and none of them can assemble half of them.
 */
export function readBoardTrust(trust: BoardTrust, login: string): Promise<TrustReading> {
  return readAuthorTrust({
    login,
    permissions: trust.permissions,
    trustedAuthors: trust.trustedAuthors,
  });
}

/**
 * The same reading, refused: lets a trusted `login` through and throws
 * `CommandExit(2, {@link trustRefusalMessage})` for an untrusted one,
 * naming `item` in `trust`'s repository.
 *
 * Called before the body is read any further or snapshotted, so a
 * refused read leaves nothing of the untrusted text behind. A caller
 * that IGNORES rather than refuses — the marker-comment readers — calls
 * {@link readBoardTrust} and reads the answer itself.
 */
export async function requireTrustedBoardAuthor(
  item: BoardItemRef,
  trust: BoardTrust,
  login: string,
): Promise<TrustReading> {
  const reading = await readBoardTrust(trust, login);
  requireTrustedAuthor({ kind: item.kind, number: item.number, repo: trust.repo }, reading);
  return reading;
}

/**
 * The claim an untrusted `reading` is refused with, as a clause opening
 * `who`: what GitHub answered about the login's access to `repo`, or
 * that nobody answered and what went wrong.
 *
 * Exported because the refusal is not the only place the claim is made.
 * A marker comment from an untrusted author is IGNORED rather than
 * refused (`src/commands/pr/triage-trust.ts`), and the sentence
 * reporting that says the same thing about access as
 * {@link trustRefusalMessage} does — which it can only keep saying if
 * there is one spelling of it.
 *
 * Throws a `TypeError` for a trusted reading, as
 * {@link trustRefusalMessage} does.
 */
export function trustRefusalClause(repo: string, reading: TrustReading): string {
  if (reading.trusted) {
    throw new TypeError(`board trust: ${reading.login} is trusted, and has no refusal to name`);
  }
  return reading.refusal === 'lookup-failed'
    ? `whose write access to ${repo} could not be read (${failureDetail(reading)})`
    : `who has no write access to ${repo}`;
}

/**
 * The sentence an untrusted `reading` is refused with, naming `item`.
 *
 * Throws a `TypeError` for a trusted reading: there is no refusal to
 * spell for one, and a caller asking for it has read the reading
 * backwards.
 */
export function trustRefusalMessage(item: BoardItem, reading: TrustReading): string {
  const because = trustRefusalClause(item.repo, reading);
  const opened = `${item.kind} #${String(item.number)} was opened by ${reading.login}`;
  return `${opened}, ${because}; ${REMEDY[item.kind]}`;
}

/**
 * Lets a trusted `reading` through, and throws
 * `CommandExit(2, {@link trustRefusalMessage})` for an untrusted one.
 *
 * Called before the body is read any further or snapshotted, so a
 * refused read leaves nothing of the untrusted text behind.
 */
export function requireTrustedAuthor(item: BoardItem, reading: TrustReading): void {
  if (reading.trusted) return;
  throw new CommandExit(TRUST_REFUSAL_EXIT, trustRefusalMessage(item, reading));
}
