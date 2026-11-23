/** The server side: a pure handler from a plain request to a plain response, and its fetch and Express adapters. */
export type {
  ExpressAdapterOptions,
  ExpressLikeRequest,
  ExpressLikeResponse,
  ExpressMiddleware,
} from './express.js';
export type { FetchAdapterOptions } from './fetch.js';
export type { AtlasHandler, AtlasRegistry, HandlerOptions } from './handler.js';
export type { AtlasRequest, AtlasResponse } from './request.js';
export { toExpressHandler } from './express.js';
export { toFetchHandler } from './fetch.js';
export { createAtlasHandler } from './handler.js';
