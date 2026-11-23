## Atlas

Dashboards and metrics over rafa's effort data, as five layers and five
workspace members under `addons/atlas/*` (the second `workspaces` glob):

| Layer | Member | Built today |
|---|---|---|
| 1 effort storage | rafa core | the live store, read only through core's `vacuumInto`; the board cache, plans, git and the module tree, read in the project root |
| 2 data sources | `data` (`@open-tomato/atlas-data`) + the readers in `rafa-atlas` | the replica writer and reader, the bucket tables, the query engine, `defineTableSource`; the effort ingest, the plan reader, the git ingest, the board ingest, the module ingest and the GitHub ingest (under `--github`) |
| 3 transport | `transport` | the pure handler, the fetch adapter (`toFetchHandler`), the typed client with a replaceable `Transport` (`fetchTransport`, `localTransport`). No Express adapter |
| 4 contracts | `data/src/contract/` | descriptors, query params, results, metric definitions, the envelope and `ATLAS_CONTRACT_VERSION` |
| 5 representation | `ui`, `demo`; `@open-tomato/charts` from npm | atoms to templates and the card cascade; the demo page. The chart seam over ECharts is `@open-tomato/charts`, published from another repository |

The catalogue serves the phase 4 metrics over the git, board, module and
GitHub sources: `dev.wip` counts the open issues in Claimed or In
development by stage, never by label, with `wipLimit` as its goal; every bug
metric leaves out `module` `cli-gap`, keeping a bug with no module; the
five GitHub-only metrics (`feasibility` `gh`) answer rows only after a build
run with `--github`. Still design, not built: the demo cards over them, and
a chart drawing the stretch marks, which the build stores and serves as
`local.marks` (D19). The design is the main
checkout's `.rafa/specs/draft-atlas-dashboard.md` (gitignored): the metric and
chart gap lists, the bucket DDL, the contracts, the handler, the PoC cut. The
3D graph-of-dice proof of concept stays on `spike/atlas-poc`, outside the
glob, and ships in no package.

**Turning the module on takes two keys in `.rafa/config.yaml`.**
Phase 1 core has no `module enable`, so a checkout without the keys answers
the first `rafa module exec @open-tomato/rafa-atlas build` with
`no module "@open-tomato/rafa-atlas" is mounted; mounted: none`. Add the path
under `modules:` and the name under `allowList:`:

```yaml
modules:
  - path: addons/atlas/rafa-atlas
allowList:
  - "@open-tomato/rafa-atlas"
```

The file is gitignored, so each checkout sets its own. `rafa module list` is
the check: it reads `loaded, enabled; types commands; from path
addons/atlas/rafa-atlas`, with the commands entry `(mounted)`. Run it before
any build.

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
atlas` routes nothing. `build` writes the replica. `serve` builds one when
none exists, then serves the API at `/api/atlas` on `127.0.0.1:4317` (the
port `--port` changes), with the targets of
`<root>/.rafa/atlas/config.json` laid over the metrics: `budget.tokensPerWeek`
and `wipLimit`, both null when unset. `describe` opens no replica. The module
imports core types with `import type` and calls only pure core functions,
because the repo's source can be a second copy of core beside the runtime
that loaded the module: a refusal is `ctx.output.error` plus a plain
`Error`, never a `CommandExit`.

**The demo's `?source=live` switch.** The demo page draws the seeded mock
unless the URL says `?source=live`, and no capture sets it. Live reads the
API under `/api/atlas`, which the demo server mounts only when the project
root holds a store and a replica. A run whose root holds no store (a worktree
with no `ATLAS_PROJECT_ROOT`) mounts no API, and each card shows its error
state with the build line
(`rafa module exec @open-tomato/rafa-atlas build`) to run. A solo developer
runs `ATLAS_PROJECT_ROOT=<main checkout> bun run --cwd addons/atlas/demo dev`
from a worktree, then opens `?source=live`.

**Work type is a proxy (D4).** Loop branches carry no type, so the split
reads the highest change level a session reported: `major` and `minor` are
feature, `patch` is fix, `none` is chore or docs. Every metric over it
carries a `ProxyNote`. Dedupe of rows without an origin pair (D3) keys on
the store's own id and `seq`, as `rafa-atlas`'s README sets out.

**Ranges are windows (D6).** The page's four ranges map to fixed windows in
the demo's live source (`RANGE_WINDOW`): `last-week` is `7d`, `past-month`
`28d`, `last-year` `52w`. `now` is the one range whose KPI tiles read today
(`1d`) while its series read the last 7 days. A store of 11 weeks shows the
11 weeks there are.

**The public members depend on public packages only.** `atlas-data`,
`atlas-transport` and `@open-tomato/atlas-ui` are written to publish, so
`@open-tomato/pre-components` joins `ui` only once it is on npmjs (it is
on the private registry today), and no private host, home path or private
repo name appears in their code, READMEs or fixtures. `@open-tomato/charts`
is not a member here: it is published from the public
`open-tomato/components` repository (`packages/charts`), scope-wide so that
other projects consume it on its own, and `ui` depends on its npm release
(`^0.1.0`), never on `echarts` directly.

**TSX lints through `@open-tomato/eslint-config/react` and `/cva`**
(`react`: eslint-plugin-react, react-hooks, jsx-a11y; `cva`: the
`@open-tomato/cva-only-classname` rule), laid over the base by the leaf
configs of `ui` and `demo`; the base parses `.tsx`, and the root's
`eslint.config.mjs` resolves `addons/atlas/*/tsconfig.json`.

**Conventions for layer 5 live in the `@open-tomato/charts` README.** That
README is in the public `open-tomato/components` repository, under
`packages/charts`. It is the authority for the folder layout (one folder per
component), CVA variants with the `@open-tomato/cva-only-classname` rule, the
token names `charts` ships against the values the demo ships, the story
rules, `bun test` over happy-dom, the local-only Playwright visual suite, the
gate order and the publish shape. The privacy sweep lives in `ui`
(`addons/atlas/ui/privacy.sweep.test.ts`) and sweeps all of `addons/atlas/`.
`addons/atlas/ui/README.md` adds what is `ui`'s own: the atomic layers,
`context`, `modes` and `contract`, and the card cascade. The formatting
layer is `charts`' (`src/seam/format.ts`, in the components repository):
one `ValueFormat` per axis, tooltip or stat (`raw`, `number`, `compact`,
`percent`, `money`, `unit`, `duration`, `elapsed`, `relative`, `date`,
`custom`), resolved against a `FormatContext` (locale, currency, time zone,
`now`, custom formatters) by `formatterFor` or the `useFormatter` hook under
`FormatProvider`, so a dashboard sets its locale once and every card writes
the same way; the charts README's Formatting values section lists the
kinds. `ui` is publishable and depends on no private member, and `charts`
is published from its own repository. The root `bun test` skips `ui` and
`demo` (`pathIgnorePatterns` in the root `bunfig.toml`): each runs its own
tests from its folder, and CI's `atlas` job runs `ui`'s gates as its one
matrix leg, `addons/atlas/ui`.
