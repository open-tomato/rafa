/**
 * The hub's identity port: who is calling and what they may do, or a
 * refusal, answered for one request. Every route but `GET /health` asks
 * it before doing anything, so the routes are written once and an
 * authentication scheme is an adapter. Repository permission is the
 * first the plan for #325 lays down, as `github.ts` beside this file;
 * hub roles, OAuth or SAML implement this same port and run the same
 * cases, {@link HubIdentity}'s contract suite in `contract.ts`.
 *
 * ## One request, one answer
 *
 * An adapter is handed the whole `Request`, so a scheme reading a
 * cookie or a header other than `Authorization` needs no change here,
 * and answers from it alone: nothing one request carried serves another.
 * It reads the request's headers and URL, never its body, which the
 * route reads after it; `identify` leaves `bodyUsed` false.
 *
 * ## What an answer holds
 *
 *   - **Served:** a {@link HubCaller} and the {@link HubAction}s it may
 *     take, at least one of them. A route whose action is not among
 *     them refuses the caller as forbidden; the port does not know the
 *     route, so that check is the server's.
 *   - **Refused:** an {@link IdentityRefusal}, whose reason tells a
 *     caller who proved nothing (`unauthenticated`), one who proved
 *     who they are and may not sync (`forbidden`), and a request the
 *     adapter could not decide because whatever it asks did not answer
 *     (`unavailable`) apart. Its message is safe to show and to log:
 *     it never repeats the credential the request carried.
 *
 * `identify` resolves with a refusal rather than rejecting; a rejection
 * is an adapter bug, not an answer.
 */

/** Every action a hub route takes, one per route but `GET /health`. */
export const HUB_ACTIONS = [
  /** `GET /v1/status`. */
  'status.read',
  /** `POST /v1/effort/push`. */
  'effort.push',
  /** `GET /v1/effort/pull`. */
  'effort.pull',
  /** `GET /v1/settings/locked`. */
  'settings.read',
] as const;

/** One action a hub route takes. */
export type HubAction = typeof HUB_ACTIONS[number];

/** Who is calling, as the adapter that served the request names them. */
export interface HubCaller {
  /** The caller's stable name under its provider, such as a GitHub login. */
  readonly id: string;
  /** The adapter that answered, such as `github`, so logs tell schemes apart. */
  readonly provider: string;
}

/** Why a request was refused; the server answers 401, 403 and 503 in this order. */
export type IdentityRefusalReason = 'unauthenticated' | 'forbidden' | 'unavailable';

/** A refused request. */
export interface IdentityRefusal {
  readonly reason: IdentityRefusalReason;
  /** One line a caller can act on, never repeating the request's credential. */
  readonly message: string;
}

/** A served request: the caller and what it may do. */
export interface IdentityServed {
  readonly served: true;
  readonly caller: HubCaller;
  /** The actions the caller may take, at least one, each once. */
  readonly may: readonly HubAction[];
}

/** A refused request, holding no caller. */
export interface IdentityRefused {
  readonly served: false;
  readonly refusal: IdentityRefusal;
}

/** What the port answers for one request. */
export type IdentityAnswer = IdentityServed | IdentityRefused;

/** The hub's identity port. */
export interface HubIdentity {
  /** Answers who sent `request` and what they may do, or why they are refused. */
  readonly identify: (request: Request) => Promise<IdentityAnswer>;
}
