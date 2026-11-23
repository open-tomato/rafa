# @open-tomato/atlas-transport

Atlas layer 3: a pure request handler for the Atlas contracts, fetch and
Express adapters for it, and a typed client whose HTTP mechanism is a replaceable
`Transport`. It helps with transport and enforces none of it: a server of
another shape fails at the client's edge, not in a chart.

| Entry | Holds |
|---|---|
| `.` | the shared request and response types |
| `./server` | `createAtlasHandler` (the pure handler), `toFetchHandler` (the `(Request) => Promise<Response>` adapter), `toExpressHandler` (the Express middleware) |
| `./client` | `createAtlasClient`, `fetchTransport` (the default), `localTransport` (in-process), the error classes |

The handler serves the routes of `data`'s contract, under the adapter's
`basePath`:

| Method | Path | Answers |
|---|---|---|
| GET | `/sources` | `DataSourceDescriptor[]` |
| GET | `/sources/:id` | `DataSourceDescriptor` |
| POST | `/sources/:id/query` | `QueryResult`, for a `QueryParams` body |
| GET | `/metrics` | `MetricDefinition[]`, `?lens=` filters |
| GET | `/metrics/:id` | `MetricDefinition` |

The fetch adapter answers two faults itself, as envelopes: 404
`unknown_route` for a path outside `basePath`, and 400 `invalid_body` for a
body over 64 KiB or one that is not JSON. The adapter wraps the handler
for `Bun.serve`, Hono or a Next route handler.

The Express adapter is a middleware over structural request and response
types, so the package has no `express` dependency; Node's own
`IncomingMessage` and `ServerResponse` fit the same types. Mount it with
`app.use('/api/atlas', toExpressHandler(handler))`: Express strips the
mount. It takes `req.body` when a parser ran first, and otherwise reads
the stream itself with the fetch adapter's two body faults. It writes
every answer whole and never calls `next`. A handler that throws is
answered 500 `internal` without its message, and `onError` receives the
error.

Nest, on its default Express platform, mounts the same middleware in
`main.ts`, ahead of its own router:
`app.use('/api/atlas', toExpressHandler(handler))` on the
`NestExpressApplication`. Nest's body parser is on by default, so the
adapter reads `req.body`; a body Nest's parser refuses never reaches the
adapter, so it gets Nest's answer, not this package's envelope. On the Fastify platform, use
the fetch adapter instead.

The client sends `x-atlas-contract` with its major and reads every answer
against the envelope schema. A `Transport` is any function from an
`AtlasRequest` to a status and body: `fetchTransport` sends it to an
absolute base URL, and `localTransport` calls a handler in-process, passing
bodies through JSON so the client sees what the wire would carry.

```ts
import { toExpressHandler, toFetchHandler } from '@open-tomato/atlas-transport/server';
import { createAtlasClient, localTransport } from '@open-tomato/atlas-transport/client';

// Server: mount the handler under a base path.
const fetchHandler = toFetchHandler(handler, { basePath: '/api/atlas' });
// Or, in Express: app.use('/api/atlas', toExpressHandler(handler));

// Client: in-process, or fetchTransport over the mounted base URL.
const client = createAtlasClient({ baseUrl: 'http://127.0.0.1:4317/api/atlas', transport: localTransport(handler) });
```
