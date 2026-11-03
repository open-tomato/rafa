# @open-tomato/atlas-demo

Bun.serve demo, never published: the four lens dashboards over a local
Atlas replica. It holds what the two libraries, `@open-tomato/charts`
and `@open-tomato/atlas-ui`, leave to their consumer: the theme values,
the mock data and the four lens pages. The server will
mount the fetch adapter under `/api/atlas`; `atlas.config.json` will point
it at a rafa project (relative paths only), and `ATLAS_PROJECT_ROOT`
overrides it, which a worktree needs because the store and the board
cache live in the main checkout.

## Run it

```bash
bun run dev      # Bun.serve with hot reload on port 4319 (PORT overrides)
```

`src/server.ts` serves `src/index.html` through an HTML import, so Bun
bundles the page's TSX and its stylesheet on request; `bunfig.toml` runs
`bun-plugin-tailwind` over the stylesheet. No Vite and no Storybook here:
the stories live in the two libraries.

URL parameters: `?lens=pm|architect|developer|qa`, `&theme=light|dark`
(absent: the system theme), `&range=now|last-week|past-month|last-year`
and `&still` (no mount animation, for captures).

## The page

| Folder | Holds |
|---|---|
| `src/App.tsx` | the shell: lens tabs, the `RangeSelector`, the theme button, over one `DashboardData` |
| `src/data/` | the mock (`buildMock(seeds)`), the measured workspace and the balance catalogue; `source.ts` is the page source |
| `src/lenses/` | one file per lens and the `balance/` card; every card is a `DashboardCard` with a `CardSpec` and a `select` |
| `src/templates/` | `LensGrid`: the tile row and the card grid |

The page source (`createLensSource`) answers one `LensResult` per range
after a short delay, so the loading tiles show once. The mock is reseeded
per range; `past-month` draws with the bake-off's seeds and gives its
values. A card's `info` and `table` feed the registry's `info` and
`source` entries; the balance card's index picker is its `indices` entry.

## The theme values

`src/styles.css` defines every token the charts package names (its
`src/theme/`):
the light values in Tailwind's `@theme` block, the dark re-step under
`:root[data-theme="dark"]`, and `@custom-variant dark` on that attribute.
Dark mode is `data-theme="dark"` on `<html>`. The stylesheet's two
`@source` lines make Tailwind scan both libraries' source for the classes
their components use. Both libraries' Storybooks import this same file,
so a story and the demo paint the same values.
`src/theme-values.test.ts` holds the file to the token list of
`@open-tomato/charts/theme`.

## Reading the libraries

`tsconfig.json` maps the libraries' entries (`@open-tomato/charts` with
`./theme` and `./engine`, `@open-tomato/atlas-ui` with `./contract`) to
their source through `paths`, which both `tsc` and Bun follow, so the demo
runs without building either first. The import resolver
of the lint does not follow `paths`, so the lint config skips
`import/no-unresolved` for those imports and leaves them to `tsc`.

## Gates

```bash
bun run check-types
bun test
bun run lint
```

`bun test` runs over happy-dom (`test/happy-dom.ts`): the page's smoke
tests draw with a stub engine, since happy-dom has no canvas, and
`src/build.test.ts` bundles `index.html` with the Tailwind plugin.

Like every file under `addons/atlas/`, nothing here names a host, a home
path or a private repository; `privacy.sweep.test.ts` in
`@open-tomato/charts` reads this folder too.
