/**
 * The four errors the client raises. Each extends `Error` and carries a
 * readonly `code`, so a caller can branch on the code or on the class:
 *
 * - `AtlasRequestError`: the server answered an error envelope (400, 404,
 *   405, 503, 500), with its code, status and details.
 * - `AtlasContractMismatch`: the server answered 409, or its envelope names
 *   another contract major than the client's.
 * - `AtlasTransportError`: the request never got an answer (a network
 *   failure); an abort is not one, it is rethrown as the signal raised it.
 * - `AtlasResponseInvalid`: the body failed the envelope schema.
 */
import type { AtlasErrorCode } from '@open-tomato/atlas-data/contract';

/** The server answered an error envelope. */
export class AtlasRequestError extends Error {
  override readonly name = 'AtlasRequestError';
  readonly code: AtlasErrorCode;
  readonly status: number;
  /** Field names and validation issues only, as the server sent them. */
  readonly details?: unknown;

  constructor(code: AtlasErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

/** The server speaks another contract major, by a 409 or by `meta.version`. */
export class AtlasContractMismatch extends Error {
  override readonly name = 'AtlasContractMismatch';
  readonly code = 'contract_mismatch';
  /** The version the server named, or null when only its 409 said so. */
  readonly serverVersion: string | null;

  constructor(message: string, serverVersion: string | null) {
    super(message);
    this.serverVersion = serverVersion;
  }
}

/** The request got no answer: the network failed under it. Never raised for an abort. */
export class AtlasTransportError extends Error {
  override readonly name = 'AtlasTransportError';
  readonly code = 'transport_error';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/** The body failed the envelope schema, so the server is of another shape. */
export class AtlasResponseInvalid extends Error {
  override readonly name = 'AtlasResponseInvalid';
  readonly code = 'response_invalid';
  readonly status: number;
  /** The schema's issues, or none when the envelope was valid but its data missing. */
  readonly issues: readonly unknown[];

  constructor(message: string, status: number, issues: readonly unknown[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}
