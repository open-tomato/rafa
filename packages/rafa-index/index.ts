/**
 * The facade of `rafa-index`: every name a file outside the package
 * imports from it, re-exported from where it lives under `./src/`. No
 * outside file imports one yet, so it holds no statement: a facade entry
 * holds re-exports only, and `export {};` is a local export the facade
 * parser refuses. It grows as the hub's tasks import names, and a name no
 * outside file imports stays a subpath (`@open-tomato/rafa-index/<file>`).
 */
