# @open-tomato/atlas-demo

Bun.serve demo, never published: the four lens dashboards over a local
Atlas replica. It holds what the two libraries, `@open-tomato/charts`
(from npm) and `@open-tomato/atlas-ui` (`../ui`), leave to their consumer:
the theme values, the mock data, the live page source and the four lens
pages. The server mounts the Atlas API under `/api/atlas` when the
project root holds an effort store: `ATLAS_PROJECT_ROOT` names the root
(the repository this folder sits in otherwise), which a worktree needs
because the store lives in the main checkout, and `RAFA_EFFORT_DIR`
names the store and wins over both.

## Run it

```bash
bun run dev      # Bun.serve with hot reload on 127.0.0.1:4319 (PORT overrides)
```

Real data, from a worktree:

```sh
ATLAS_PROJECT_ROOT=<main checkout> bun run --cwd addons/atlas/demo dev
```

then open the page with `?source=live`. With a store and no replica at
`<root>/.rafa/atlas/atlas.sqlite`, the server builds one before it
listens (the build copies the store with `vacuumInto` and reads only the
copy). With no store, it serves the page alone, `/api/atlas` answers
404, and the server prints why. It binds to loopback, since Atlas has no
auth.

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
| `src/data/` | the mock (`buildMock(seeds)`), the measured workspace and the balance catalogue; `source.ts` is the mock page source, `live.ts` the live one |
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
