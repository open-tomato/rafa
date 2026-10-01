/**
 * A stand-in identity adapter: the port over a table of bearer tokens
 * held in memory, written for the tests so the contract suite runs
 * against an adapter asking nothing outside the process. A token the
 * table grants actions is served, one it grants none is forbidden, and
 * anything else, a missing or malformed `Authorization` header
 * included, is unauthenticated. It is the port's rules and no more.
 */
import type { CredentialHeaders, IdentityContractSubject } from '../contract.js';
import type { HubAction, HubIdentity, IdentityAnswer } from '../port.js';

import { HUB_ACTIONS } from '../port.js';

/** What the stand-in knows of one token: its caller and what it may do. */
export interface MemoryGrant {
  readonly id: string;
  /** Empty for a caller the stand-in knows and refuses as forbidden. */
  readonly may: readonly HubAction[];
}

/** The provider name the stand-in answers with. */
export const MEMORY_PROVIDER = 'memory';

/** The token the contract subject serves, with every action. */
const SERVED_TOKEN = 'memory-served-token-0001';

/** The token the contract subject knows and grants nothing. */
const FORBIDDEN_TOKEN = 'memory-forbidden-token-0002';

/** A well-formed token the contract subject has never heard of. */
const UNRECOGNISED_TOKEN = 'memory-unknown-token-0003';

/** How a bearer credential is written in `Authorization`. */
const BEARER = /^Bearer (\S+)$/;

/** The bearer token `request` carries, or `undefined`. */
function tokenOf(request: Request): string | undefined {
  return BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
}

/** Opens a stand-in over `grants`, keyed by token. */
export function openMemoryIdentity(grants: Readonly<Record<string, MemoryGrant>>): HubIdentity {
  const identify = (request: Request): Promise<IdentityAnswer> => {
    const token = tokenOf(request);
    const grant = token === undefined
      ? undefined
      : grants[token];
    if (grant === undefined) {
      return Promise.resolve({ served: false, refusal: { reason: 'unauthenticated', message: 'Send a bearer token the hub knows.' } });
    }
    if (grant.may.length === 0) {
      return Promise.resolve({ served: false, refusal: { reason: 'forbidden', message: `${grant.id} may not sync with this hub.` } });
    }
    return Promise.resolve({ served: true, caller: { id: grant.id, provider: MEMORY_PROVIDER }, may: grant.may });
  };
  return { identify };
}

/** `Authorization` headers carrying `token`. */
function bearer(token: string): CredentialHeaders {
  return { authorization: `Bearer ${token}` };
}

/** A contract subject over a fresh stand-in knowing one served and one forbidden caller. */
export function memoryIdentitySubject(): IdentityContractSubject {
  const identity = openMemoryIdentity({
    [SERVED_TOKEN]: { id: 'served-caller', may: HUB_ACTIONS },
    [FORBIDDEN_TOKEN]: { id: 'forbidden-caller', may: [] },
  });
  return {
    identity,
    served: bearer(SERVED_TOKEN),
    forbidden: bearer(FORBIDDEN_TOKEN),
    unrecognised: bearer(UNRECOGNISED_TOKEN),
  };
}
