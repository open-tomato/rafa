/** The client side: knows the contracts, makes the request, nothing else. */
export type { AtlasClient, AtlasClientOptions } from './client.js';
export type { FetchTransportOptions, Transport, TransportResponse } from './transport.js';
export { createAtlasClient } from './client.js';
export {
  AtlasContractMismatch,
  AtlasRequestError,
  AtlasResponseInvalid,
  AtlasTransportError,
} from './errors.js';
export { fetchTransport, localTransport } from './transport.js';
