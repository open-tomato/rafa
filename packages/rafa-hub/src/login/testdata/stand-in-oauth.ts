/**
 * A stand-in OAuth provider for the tests: `Bun.serve` on a free
 * loopback port answering the three requests an authorization-code
 * login makes, so no test reaches a real provider.
 *
 *   - `GET /authorize` redirects to the `redirect_uri` it was sent with
 *     a fresh code and the `state` it was sent, for the profile
 *     {@link StandInOAuth.signIn} set, as a provider does once its user
 *     grants the client; with no profile set it redirects with
 *     `error=access_denied`, as a user who refused does.
 *   - `POST /token` exchanges a code once for a bearer token, when the
 *     client id and secret match the ones the stand-in was started with
 *     and `redirect_uri` the one the code was granted for. Another client
 *     is answered `401 {"error":"invalid_client"}`, and an unknown, used
 *     or mismatched code `400 {"error":"invalid_grant"}`.
 *   - `GET /user` answers the profile a token was granted for, or `401`.
 *
 * {@link StandInOAuth.grant} mints a code directly, for a case that
 * drives the callback without following the authorize redirect. Every
 * request is recorded, so a case can hold that the provider was never
 * asked, and {@link StandInOAuth.failWith} makes every request answer
 * one status, or wait, as an outage would.
 */
import { randomBytes } from 'node:crypto';

/** What the stand-in is started with: the client it accepts. */
export interface StandInOAuthOptions {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** One request the stand-in was sent. */
export interface ProviderRequest {
  readonly method: string;
  /** The path alone, without the query. */
  readonly path: string;
  /** The query parameters, or the form body's under `POST`. */
  readonly params: Readonly<Record<string, string>>;
  /** The `Authorization` header, or null. */
  readonly authorization: string | null;
}

/** What every request is answered with while a failure is set. */
export interface ProviderFailure {
  readonly status: number;
  /** The body sent, as written; `{"error":"stand-in failure"}` when left out. */
  readonly body?: string;
  /** How long the stand-in waits before answering. */
  readonly delayMs?: number;
}

/** A running stand-in. */
export interface StandInOAuth {
  /** The provider's root, such as `http://127.0.0.1:41234`. */
  readonly url: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly userUrl: string;
  /** Sets the profile `/authorize` grants a code for, or with null makes it deny. */
  readonly signIn: (profile: Readonly<Record<string, unknown>> | null) => void;
  /** Mints a code for `profile`, bound to `redirectUri`, as `/authorize` would. */
  readonly grant: (profile: Readonly<Record<string, unknown>>, redirectUri: string) => string;
  /** Every request sent so far, oldest first. */
  readonly asked: () => readonly ProviderRequest[];
  /** Answers every request with `failure` until called with null. */
  readonly failWith: (failure: ProviderFailure | null) => void;
  /** Stops the server. */
  readonly stop: () => Promise<void>;
}

/** A code granted and not yet exchanged. */
interface Granted {
  readonly profile: Readonly<Record<string, unknown>>;
  readonly redirectUri: string;
}

/** A JSON answer. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fresh random token, for a code or a bearer. */
function token(): string {
  return randomBytes(24).toString('base64url');
}

/** The parameters of `request`: its query, or its form body under `POST`. */
async function paramsOf(request: Request, url: URL): Promise<Record<string, string>> {
  const source = request.method === 'POST'
    ? new URLSearchParams(await request.text())
    : url.searchParams;
  return Object.fromEntries(source.entries());
}

/** Starts a stand-in provider accepting the client `options` names. */
export function startStandInOAuth(options: StandInOAuthOptions): StandInOAuth {
  const asked: ProviderRequest[] = [];
  const codes = new Map<string, Granted>();
  const tokens = new Map<string, Readonly<Record<string, unknown>>>();
  let signedIn: Readonly<Record<string, unknown>> | null = null;
  let failure: ProviderFailure | null = null;

  const grant = (profile: Readonly<Record<string, unknown>>, redirectUri: string): string => {
    const code = token();
    codes.set(code, { profile, redirectUri });
    return code;
  };

  const authorize = (params: Readonly<Record<string, string>>): Response => {
    const redirectUri = params['redirect_uri'];
    if (redirectUri === undefined || params['client_id'] !== options.clientId) return json(400, { error: 'invalid_request' });

    const target = new URL(redirectUri);
    if (signedIn === null) {
      target.searchParams.set('error', 'access_denied');
    } else {
      target.searchParams.set('code', grant(signedIn, redirectUri));
    }
    if (params['state'] !== undefined) target.searchParams.set('state', params['state']);
    return new Response(null, { status: 302, headers: { location: target.href } });
  };

  const exchange = (params: Readonly<Record<string, string>>): Response => {
    const code = params['code'] ?? '';
    const granted = codes.get(code);
    codes.delete(code);
    if (params['client_id'] !== options.clientId || params['client_secret'] !== options.clientSecret) return json(401, { error: 'invalid_client' });
    const valid = granted !== undefined
      && params['grant_type'] === 'authorization_code'
      && params['redirect_uri'] === granted.redirectUri;
    if (!valid) return json(400, { error: 'invalid_grant' });

    const bearer = token();
    tokens.set(bearer, granted.profile);
    return json(200, { access_token: bearer, token_type: 'bearer' });
  };

  const user = (authorization: string | null): Response => {
    const profile = tokens.get(/^Bearer (\S+)$/.exec(authorization ?? '')?.[1] ?? '');
    return profile === undefined
      ? json(401, { error: 'invalid_token' })
      : json(200, profile);
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const params = await paramsOf(request, url);
      const authorization = request.headers.get('authorization');
      asked.push({ method: request.method, path: url.pathname, params, authorization });

      if (failure !== null) {
        const { status, body, delayMs } = failure;
        if (delayMs !== undefined) await Bun.sleep(delayMs);
        return new Response(body ?? '{"error":"stand-in failure"}', { status, headers: { 'content-type': 'application/json' } });
      }
      if (request.method === 'GET' && url.pathname === '/authorize') return authorize(params);
      if (request.method === 'POST' && url.pathname === '/token') return exchange(params);
      if (request.method === 'GET' && url.pathname === '/user') return user(authorization);
      return json(404, { error: 'not_found' });
    },
  });

  const url = `http://127.0.0.1:${String(server.port)}`;
  return {
    url,
    authorizeUrl: `${url}/authorize`,
    tokenUrl: `${url}/token`,
    userUrl: `${url}/user`,
    signIn: (profile) => {
      signedIn = profile;
    },
    grant,
    asked: () => [...asked],
    failWith: (next) => {
      failure = next;
    },
    stop: async () => {
      await server.stop(true);
    },
  };
}
