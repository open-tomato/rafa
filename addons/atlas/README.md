# Atlas

Dashboards over rafa's effort data, in five layers: the effort store (rafa
core), data sources (`data/`), transport (`transport/`), the contract that
query and config share (`data/src/contract/`), and representation (`ui/`,
`demo/`; the charts library, `@open-tomato/charts`, is published from the
`open-tomato/components` repository and read from npm). `rafa-atlas/` is the
rafa bundle: it reads a rafa project into an Atlas replica and serves it.

Design: the main checkout's `.rafa/specs/draft-atlas-dashboard.md`. Each
folder is a workspace member (`addons/atlas/*`); the 3D proof of concept on
`spike/atlas-poc` is not one of them.
