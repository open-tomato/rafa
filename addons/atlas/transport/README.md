# @open-tomato/atlas-transport

Atlas layer 3: a pure request handler for the Atlas contracts, a fetch
adapter for it, and a typed client whose HTTP mechanism is a replaceable
`Transport`. It helps with transport and enforces none of it: a server of
another shape fails at the client's edge, not in a chart.

| Entry | Holds |
|---|---|
| `.` | the shared request and response types |
| `./server` | `createAtlasHandler` (the pure handler), `toFetchHandler` (the `(Request) => Promise<Response>` adapter) |
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
for `Bun.serve`, Hono or a Next route handler. There is no Express
adapter in this package.

The client sends `x-atlas-contract` with its major and reads every answer
against the envelope schema. A `Transport` is any function from an
`AtlasRequest` to a status and body: `fetchTransport` sends it to an
absolute base URL, and `localTransport` calls a handler in-process, passing
bodies through JSON so the client sees what the wire would carry.

```ts
import { toFetchHandler } from '@open-tomato/atlas-transport/server';
import { createAtlasClient, localTransport } from '@open-tomato/atlas-transport/client';

// Server: mount the handler under a base path.
const fetchHandler = toFetchHandler(handler, { basePath: '/api/atlas' });

// Client: in-process, or fetchTransport over the mounted base URL.
const client = createAtlasClient({ baseUrl: 'http://127.0.0.1:4317/api/atlas', transport: localTransport(handler) });
```
