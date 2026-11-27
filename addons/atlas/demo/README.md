# @open-tomato/atlas-demo

Bun.serve demo, never published: the four lens dashboards over a local
Atlas replica. It holds what the two libraries, `@open-tomato/charts`
(from npm) and `@open-tomato/atlas-ui` (`../ui`), leave to their consumer:
the theme values, the mock data, the live page source and the four lens
pages. The server mounts the Atlas API under `/api/atlas` when the
project root holds an effort store and a replica built from it:
`ATLAS_PROJECT_ROOT` names the root (the repository this folder sits in
otherwise), which a worktree needs because the store lives in the main
checkout, and `RAFA_EFFORT_DIR` names the store and wins over both.

## Run it

```bash
bun run dev      # Bun.serve with hot reload on 127.0.0.1:4319 (PORT overrides)
```

Real data, from a worktree:

```sh
ATLAS_PROJECT_ROOT=<main checkout> bun run --cwd addons/atlas/demo dev
```

then open the page with `?source=live`. The server builds nothing. With
a store and no replica at `<root>/.rafa/atlas/atlas.sqlite`, it mounts no
API and prints the build line that writes one, `rafa module exec
@open-tomato/rafa-atlas build`, which copies the store with `vacuumInto`
and reads only the copy; run it, then start the demo again. With no
store, it serves the page alone, `/api/atlas` answers 404, and the
server prints why. It binds to loopback, since Atlas has no auth.

`src/server.ts` serves `src/index.html` through an HTML import, so Bun
bundles the page's TSX and its stylesheet on request; `bunfig.toml` runs
`bun-plugin-tailwind` over the stylesheet. No Vite and no Storybook here:
the stories live in the two libraries.

URL parameters: `?lens=pm|architect|developer|qa`, `&theme=light|dark`
(absent: the system theme), `&range=now|last-week|past-month|last-year`,
`&source=mock|live` (absent or unknown: mock) and `&still` (no mount
animation, for captures). No capture sets `source=live`.

## The page

| Folder | Holds |
|---|---|
| `src/App.tsx` | the shell: lens tabs, the `RangeSelector`, the theme button, over one `DashboardData` |
| `src/data/` | the mock (`buildMock(seeds)`), the measured workspace and the balance catalogue; `source.ts` is the mock page source, `live.ts` the live one, with the phase-4 metrics' mappers in `live-sources.ts`, the architect cards' in `live-architecture.ts`, and the cell readers both share in `live-read.ts` |
| `src/lenses/` | one file per lens and the `balance/` card; every card is a `LensCard` (a `DashboardCard` with the fields it `reads`) with a `CardSpec` and a `select` |
| `src/templates/` | `LensGrid`: the tile row and the card grid |

The page source (`createLensSource`) answers one `LensResult` per range
after a short delay, so the loading tiles show once. The mock is reseeded
per range; `past-month` draws with the bake-off's seeds and gives its
values. A card's `info` and `table` feed the registry's `info` and
`source` entries; the balance card's index picker is its `indices` entry.

The live source (`createLiveLensSource(client)`, under `?source=live`)
runs the 17 catalogue metrics of the PoC cut over each range's window
(`RANGE_WINDOW`: `now` is today for a KPI and the last 7 days for a
series, `last-week` `7d`, `past-month` `28d`, `last-year` `52w`; only the
red CI share and the active blockers read the KPI window) and maps each
answer into the fields `METRIC_FIELDS` names for it; the tokens per day
and the debt ratio also run over the window before. Each filled field
gets a `FieldMeta` in the result's `fieldMeta`: its metric, its answer's
`meta.rowCount` and, for a proxy, the `proxyNote` `/metrics` lists.
Every other field is marked
in the result's `notWired`, and a card or tile that reads one shows
"Not wired yet" instead of a number; a card names the fields it reads
with `reads`, and one that names none is never live. An API that is not
there fails every card with the run line above.

`live-sources.ts` adds the metrics over the git, board, module and
GitHub sources: release tags per week (`deploysPerWeek`), lines of code
per module (`modules`, the treemap), the module imports (the members and
edges of `workspace`, the network graph), WIP against the project's
`wipLimit` (`wip`), and the bug backlog pair: outcome by loop start
(`bugOutcomeByLoopStart`, each bug a loop filed counted on the day its
plan's first session started) and open bugs per day (`openBugsPerDay`),
with the resolution time by priority (`resolutionByPriority`). The
rest of `workspace` comes from `arch.composition` and `arch.import-flow`
(`live-architecture.ts`): the package composition, the rose (folders of
1,000 lines or more), the sunburst, and the import flow with its layer
columns (`layerOrder`, `unassigned` last) and their tones (`layerTones`),
each upward import marked `upward`. The open bugs, the resolution time
and the task pile are GitHub-only: when their metric answers no row, the replica was built
without `--github`, and the card shows "Not wired yet" with the build
line `rafa module exec @open-tomato/rafa-atlas build --github` (the
result's `notWiredDetail`).

On the Project Management lens, the out-of-scope tile reads
`scopeCreepPerWeek` and compares the last week against the window's
weekly average (`scopeCreepAverage`); the task pile reads `taskPileTree`,
the open issues by type label and age, its legend and tones taken from
the branches the answer names. The on-time tile stands in for a
catalogue entry marked `collect`: on the live page it draws the `collect`
empty state, a dash and "needs a collector: needs a due date on plans"
(`LensStat`'s `collect`), distinct from "not wired yet"; the mock page
keeps its sample.

On the Development lens, work done reads `workDoneTree`, the change
entries by work type and tidied area, and its live subtitle says it reads
the range in place of the mock's 12 weeks. The balance radar reads the
result's `balance`, the nine indices of `live-balance.ts`, asked over the
fixed 91 days ending with the replica's build time whatever the range;
an index with no event in its 12 baseline weeks reads "none in 12 weeks"
after its axis label and in the source table, and draws at 0. An answer
naming no build time leaves `balance` marked not wired. The mock page
keeps the catalogue's values and subtitles.

On the Architecture lens, the package size rose reads `workspace.sizeRose`,
the composition sunburst `workspace.composition` and
`compositionSunburst`, and the import flow `workspace.sankeyNodes` and
`sankeyLinks` in the columns of `layerOrder`. All three take their tones
and their legend from `layerTones`, so a layer of `atlas.layers` the mock
does not name shows with its own tone. The charts package's Sankey tones
a ribbon by its source node and takes no tone per link, so an upward
import is told apart in words: the live subtitle counts them, and the
source table lists them first with `upward` in its Direction column.
The mock page keeps its subtitles, legends and two-column flow table.
With every card wired, a live page over a replica built with `--github`
draws no "Not wired yet".

Every card and tile a live metric feeds names its `reads`. On the live
page a wired card's note is `liveNoteOf`'s (`src/lenses/spec.ts`): the
proxy note, when the metric is a proxy, and the row count behind it, so
a thin reading says how little stands behind it. The rose and the
sunburst name `arch.composition` and the import flow `arch.import-flow`
(`metaCard`, read from the result's `workspaceMeta`), while `workspace`
itself keeps `arch.coupling`'s. The weekly cards whose
field holds no dates (bugs by kind, routes, preflight halts) label their
weeks from the result's `weeks`, the series window's Mondays, and the
stacked ones draw the kinds the answer names (`src/lenses/kinds.ts`).
What only the mock knows stays off the live page: the four-week-average
deltas, the halts' per-check drill-down and the budget's allowance, so
the budget gauge reads this week against last week with "no target set".

## The theme values

`src/styles.css` defines every token the charts package names (its
`src/theme/`):
the light values in Tailwind's `@theme` block, the dark re-step under
`:root[data-theme="dark"]`, and `@custom-variant dark` on that attribute.
Dark mode is `data-theme="dark"` on `<html>`. The stylesheet's two
`@source` lines make Tailwind scan charts' published `dist/` (under
`node_modules`) and ui's `src/` for the classes their components use. ui's
Storybook imports this same file, so a story and the demo paint the same
values.
`src/theme-values.test.ts` holds the file to the token list of
`@open-tomato/charts/theme`.

## Reading the libraries

`@open-tomato/charts` (with `./theme` and `./engine`) resolves from
`node_modules` like any npm dependency, through its published declarations,
and `tsconfig.json` has no `paths` entry for it. `tsconfig.json` maps
`@open-tomato/atlas-ui` (with `./contract`) to its source through `paths`,
which both `tsc` and Bun follow, so the demo runs without building ui first.
The import resolver of the lint does not follow `paths`, so the lint config
skips `import/no-unresolved` for the `@open-tomato/atlas-ui` imports and
leaves them to `tsc`.

## Gates

```bash
bun run check-types
bun test
bun run lint
```

`bun test` runs over happy-dom (`test/happy-dom.ts`): the page's smoke
tests draw with a stub engine, since happy-dom has no canvas, and
`src/build.test.ts` bundles `index.html` with the Tailwind plugin.
`src/server.test.ts` serves a fixture replica on port 0 with Bun's own
`fetch` globals, which `test/bun-network.ts` keeps from before happy-dom
replaced them.

Like every file under `addons/atlas/`, nothing here names a host, a home
path or a private repository; `privacy.sweep.test.ts` in
`addons/atlas/ui` reads this folder too.
