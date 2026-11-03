# @open-tomato/atlas-transport

A pure request handler for the Atlas contracts, a fetch adapter (Bun.serve,
Hono, Next route handlers), an Express middleware, and a typed client with
a replaceable `Transport` (`fetchTransport` by default, `localTransport`
for in-process calls). It helps with transport and enforces none of it.

`src/server/` holds the handler, routes and adapters; `src/client/` the
client, transports and errors.
