## Atlas

Dashboards and metrics over rafa's effort data, as five layers and six
workspace members under `addons/atlas/*` (the second `workspaces` glob):

| Layer | Member | Owns |
|---|---|---|
| 1 effort storage | rafa core | the live store, the board cache, plans, git |
| 2 data sources | `data` (`@open-tomato/atlas-data`) + the readers in `rafa-atlas` | bucket tables in a SQLite replica, a tabular query engine |
| 3 transport | `transport` | a pure request handler, fetch and Express adapters, a typed client with a replaceable `Transport` |
| 4 contracts | `data/src/contract/` | descriptors, query params, results, metric definitions, the envelope and `ATLAS_CONTRACT_VERSION` |
| 5 representation | `charts`, `ui`, `demo` | the chart seam over ECharts and a headless SVG engine; atoms to templates and the card cascade; the demo page |

The design is the main checkout's `.rafa/specs/draft-atlas-dashboard.md`
(gitignored): the metric and chart gap lists, the bucket DDL, the
contracts, the handler, the PoC cut. The 3D graph-of-dice proof of
concept stays on `spike/atlas-poc`, outside the glob, and ships in no
package.

**The live effort store is copied, never opened in place.** The build
takes a `vacuumInto` snapshot under `<root>/.rafa/atlas/snapshot/` and
opens the copy read-only, so a dev build never migrates the loop's store
and no reader goes through `withSqliteStore`. The replica it writes is
`<root>/.rafa/atlas/atlas.sqlite`, built beside and renamed over the old
file, so a reader sees one whole replica or the other.

**A worktree holds neither the store nor the board cache.** A run against
real data names the main checkout through `ATLAS_PROJECT_ROOT`;
`RAFA_EFFORT_DIR` wins over both, as it does for every store reader.

**`rafa-atlas` is a rafa module, reached through exec.** Its commands are
`rafa module exec @open-tomato/rafa-atlas build|serve|describe`; `rafa
atlas` routes nothing. The module imports core types with `import type`
and calls only pure core functions, because the repo's source can be a
second copy of core beside the runtime that loaded the module: a refusal
is `ctx.output.error` plus a plain `Error`, never a `CommandExit`.

**The public members depend on public packages only.** `atlas-data`,
`atlas-transport`, `@open-tomato/charts` and `@open-tomato/atlas-ui` are
written to publish, so `@open-tomato/pre-components` joins `ui` only once
it is on npmjs (it is on the private registry today), and no private
host, home path or private repo name appears in their code, READMEs or
fixtures. `charts` is scope-wide: other projects consume it on its own,
and `ui` depends on it (`workspace:*`), never on `echarts` directly.

**TSX lints through `@open-tomato/rafa-eslint-config/react`**
(`packages/eslint-config/react.mjs`: eslint-plugin-react, react-hooks,
jsx-a11y), laid over the base by the leaf configs of `charts`, `ui` and
`demo`; the base parses `.tsx` and resolves `addons/atlas/*/tsconfig.json`.

**Conventions for layer 5 live in `addons/atlas/charts/README.md`.** It
is the authority for the folder layout (one folder per component),
CVA variants with the `ot/cva-only-classname` rule, the token names
`charts` ships against the values the demo ships, the story rules,
`bun test` over happy-dom, the local-only Playwright visual suite, the
gate order, the publish shape and the privacy sweep, which lives in
`charts` and sweeps all of `addons/atlas/`.
`addons/atlas/ui/README.md` adds what is `ui`'s own: the atomic layers,
`context`, `modes` and `contract`, and the card cascade. The formatting
layer is `charts`' (`src/seam/format.ts`): one `ValueFormat` per axis,
tooltip or stat (`raw`, `number`, `compact`, `percent`, `money`, `unit`,
`duration`, `elapsed`, `relative`, `date`, `custom`), resolved against a
`FormatContext` (locale, currency, time zone, `now`, custom formatters)
by `formatterFor` or the `useFormatter` hook under `FormatProvider`, so a
dashboard sets its locale once and every card writes the same way; the
README's formatting section lists the kinds. Both libraries
are publishable and depend on no private member. The root `bun test`
skips `charts`, `ui` and `demo` (`pathIgnorePatterns` in the root
`bunfig.toml`): each runs its own tests from its folder, and CI's `atlas`
job runs the two libraries' gates, one matrix leg per package.
