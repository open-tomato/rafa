# @open-tomato/atlas-ui

A React 19 card library for Atlas. It holds the atoms to templates, the
card cascade and its four modes, and the card contract as zod schemas. The
charts come from `@open-tomato/charts`: the seam types, the ECharts engine,
the tones, the formatters, `cn` and the theme token names. Nothing here
imports `echarts`. The consuming app brings the token values and its own
transport; `@open-tomato/atlas-demo` is the reference consumer.

`@open-tomato/charts`'s README is the authority for the conventions both
packages share: CVA variants, theming, stories, tests, the visual suite,
the gate order and the privacy sweep. This README repeats what a reader of
this package needs at hand and adds what is its own.

## Layout

Each layer is a folder under `src/` with a barrel `index.ts`, and
`src/index.ts` is the root barrel. A layer whose barrel still holds
`export {};` is not re-exported from the root yet, because `import/export`
refuses an `export *` from a module with no names; the work that fills a
layer adds its line there.

| Folder | Holds |
|---|---|
| `atoms/` | engine-free building blocks, the layout set (`Grid`, `GridItem`, `Content`, `Divider`) among them |
| `molecules/` | small compositions of atoms; `SectionCard` is the section and chart shell |
| `organisms/` | `CardLayout` (slots and the modal registry), `ChartCard` |
| `templates/` | page-level grids of cards |
| `context/` | `CardData`, `CardSpec`, `DashboardData`: a context and a hook each |
| `modes/` | the four compositions: snapshot, widget, dashboard, report |
| `contract/` | zod schemas with inferred types, and `describe()` |

A component gets its own folder, named after it, holding five files:

```text
src/atoms/Swatch/
  index.ts              the component's barrel
  Swatch.tsx            the component
  Swatch.variants.ts    its cva calls and the exported variant type
  Swatch.stories.tsx    one story per variant value
  Swatch.test.tsx       its render test
```

`Swatch` is the worked example of every rule below.

## The card cascade

A card is a cascade of layers, each owning one concern and reading only the
layer above through its hook; a chart is a pure component under them:

```text
<CardData>            source + range → { data, status, error, refresh }   (context/CardData.tsx)
  <CardSpecProvider>  the descriptor (title, chart, menu, modals)         (context/CardSpec.tsx)
    <CardLayout>      slots header, menu, content, footer; the modal registry; an inner CardBoundary around content
      <Chart />       props in, pixels out (@open-tomato/charts)
```

`ChartCard` (organisms) composes them and adds an outer `CardBoundary` for
the frame. The modal registry takes three entry shapes: content (default
chrome), a component `({ close, card }) => ReactNode`, or a `ModalDefinition`
(`{ label, icon, title, placement, chrome, tone, menu, render }`) when the
entry needs its own menu label, or `menu: false` to stay out of the menu.
The content slot and the header slot may be functions of the card's handle
(`{ title, error, maximised, open, close, retry }`), so a chart opens the
entry behind a cell or a node and a header action opens one too;
`ChartCard` hands its child `open` and a function `actions` the handle.
Built-in keys: `info`, `source`, `config`, `errors`
(present once the boundary caught, or an `error` prop is passed), `maximise`
(on `maximisable` cards). The four modes in `modes/` (`SnapshotCard`,
`WidgetCard`, `DashboardCard`, `ReportCard`) are compositions of the same
layers; a snapshot renders with `renderToStaticMarkup` and has no menu. A
new `config` object follows into a mounted card's chrome (the uncontrolled
`CardSpecProvider` reseeds from it), so a page changes a title or a note
without a new `key`; `DashboardCard` also takes `onConfigChange` and an
`onRefresh` that replaces the page refresh behind Try again.

The `maximise` entry renders the `MaximiseView` molecule: a page dialog
whose chart box is a square of the viewport's smaller side, medium (70%,
`Dialog` size `fit-70`) or large (90%, `fit-90`), switched in its header;
the card itself is the small size. The box opens at the size the spec's
`maximise.size` names, medium when absent. The content fills the box:
`ChartCard`'s child receives `{ data, hidden, animate, maximised, height }`,
with `height` set to `'fill'` there and to the charts' default 220px in the
card, which a child with a base height of its own ignores. The card's
legend and source table (left out when the card has none) stand beside
the box on a landscape viewport and under it on a portrait one, each as
`maximise.legend` and `maximise.table` say: `always`, `toggle` (a header
toggle, off at first; the default) or `toggle-on`. The dialog grows for
them up to its clearance, then that pane scrolls. A `TableData` may carry
`limit` and `sortable`, so a card with a long table caps the Source entry
(and the maximise table) without overriding the registry entry.

While the data loads, the card shows a `ChartSkeleton` in the chart's
box: the outline of the chart's family (bars, line, ring, rows, tile),
built from `Skeleton` atoms, so nothing jumps when the chart arrives.
The spec's `skeleton` names the shape; absent, `skeletonFor` reads it
off the chart primitive's name. The error state stays a `CardStatus`.

The spec layer is `CardSpecProvider` over the contract's `CardSpec` type,
read with `useCardSpec()`; `DashboardData` and `CardData` keep their
names. The modal key `config` and the `ConfigView` molecule keep theirs:
they are the "config options" entry a viewer sees in the card's menu, a
form over the spec's descriptor.

## Styles are CVA variants

- Every class a component paints lives in its `{C}.variants.ts`, as `cva`
  calls. The file exports `type XVariants = VariantProps<typeof xVariants>`,
  and the component's props extend it.
- A passthrough `className` prop is for layout context only (margin,
  alignment, grid placement), never colour or size. It merges last:
  `cn(xVariants({ tone, size }), className)`, with `cn` from
  `@open-tomato/charts` (clsx plus tailwind-merge, so the later class wins
  a conflict).
- No inline `style`, and no class string written on an element. The one
  exception is a measured number the browser hands back or a column's
  own width (a tip's coordinates, a `<col>` track, a body height cap, a
  clamp's line count), set at the site with a comment saying so. The lint
  rule `@open-tomato/cva-only-classname` (in `@open-tomato/eslint-plugin`,
  enabled by `@open-tomato/eslint-config/cva`) allows a `className` value
  only as a variants call, a `cn(...)` over variants calls and the
  passthrough, or the passthrough alone. Files under `templates/` and
  `pages/`, stories and tests are exempt.
- The repo compiles with `isolatedDeclarations`, so an exported `cva` call
  carries an explicit function type, as `swatchVariants` does.

## Theming

This package reads the token names `@open-tomato/charts` lists in its
`src/theme/` and ships no values. The consuming app defines every name
(the demo's `src/styles.css` is the reference set) and adds an `@source`
line for this package's files as well as for `charts`', so Tailwind
generates the classes both use. Dark mode is `data-theme="dark"` on
`<html>`.

## Reading `@open-tomato/charts`

`tsconfig.json` maps `@open-tomato/charts` to the sibling's source through
`paths` and references the sibling project, so `tsc --build` builds it
first and Bun's tests read its source with no build of it. The Storybook
reaches the same source through a Vite alias (`.storybook/main.ts`). The
lint config skips `import/no-unresolved` for the import, since the
resolver does not follow `paths` and the package's exports name a dist/
the lint never builds. `bun run build` keeps it external with a resolve
hook in `scripts/build.ts`: bun follows `paths` ahead of
`--packages external`, so the CLI flags alone would bundle `charts` in.
`tsc -p tsconfig.build.json` reads it from the declarations
`check-types` wrote.

## Stories

Storybook 10 on `@storybook/react-vite`; `.storybook/preview.ts` imports
the demo's `styles.css`, and its `theme` toolbar global sets `data-theme`.

- A story sits beside its component as `{C}.stories.tsx`.
- The header is `import type { Meta, StoryObj } from '@storybook/react-vite'`,
  and the meta ends in `satisfies Meta<typeof C>`.
- `title` is `Atoms/<Name>`, `Molecules/<Name>`, `Organisms/<Name>` or
  `Modes/<Name>`; `tags: ['autodocs']`.
- `parameters.layout` is `'centered'` for atoms and `'padded'` above.
- One story per variant value.
- Stories are deterministic: fixed data, fixed reference dates, an explicit
  `locale: 'en-US'`, no `Date.now()`, animations off.
- A story carries no assertion and never imports vitest. A `play()`
  imports only from `storybook/test`.

Stories are type-checked by `tsconfig.stories.json` with
`isolatedDeclarations` off.

## Tests

`bun test` over happy-dom (`bunfig.toml` preloads `test/happy-dom.ts`),
with `@testing-library/react`.

- Pure parts first: readings, toggles, table sort, the contract.
- One render test per component over happy-dom, by role and name.
  `src/atoms/Swatch/Swatch.test.tsx` is the example.
- The root's `bun test` skips this package, so run its tests from this
  folder.

## Visual regression

The same native Playwright suite as `@open-tomato/charts` (`visual/`):
every story in light and in dark against this machine's untracked
baselines in `visual/__image_snapshots__/`. `bun run test:visual:update`
writes them, `bun run test:visual` compares. It serves the built
Storybook on port 6017, so it can run beside the charts suite on 6016.

## Layout comparison

`bun visual/compare-layout.ts <otherStaticDir> [id[=otherId]...]` compares
this package's built stories with the same stories in another built
Storybook, colour-blind: every text-bearing element's box relative to the
story root, matched by text, with the largest offset and size difference
per story and a `MOVED` flag past 6px. Both screenshots land in
`visual/__compare_output__/`. It is the check a ported component's layout
is held to; the other build's path is an argument, never written here.

## Gate order

Run from this folder, in this order:

```bash
bun run check-types       # tsc --build (charts first), then tsconfig.stories.json
bun test
bun run lint
bun run build             # dist/: scripts/build.ts (ESM, browser) + tsc declarations
bun run build:storybook   # storybook-static/
bun run check:stories     # every story, light and dark, no console or page error
bun run test:visual       # local only, against this machine's baselines
```

CI's `atlas` job in `.github/workflows/verify.yml` runs all but the last
on `ubuntu-latest`, as one matrix leg per package.

## Contract and CLI help

`@open-tomato/atlas-ui/contract` exports zod v4 schemas with their
inferred types: `CardSpec` (`cardSpecSchema`), `ChartDescriptor`,
`MenuItem`, `TimeRange` (`now`, `last-week`, `past-month`, `last-year`)
and `CardMode` (`dashboard`, `widget`, `snapshot`, `report`). They are
minimal on purpose, and every schema carries an explicit zod type for
`isolatedDeclarations`.

`describe()` answers the package's roster as JSON: `cards`, `modes`,
`modalKeys`, `ranges` and `options`, each entry a `name` and a one-line
`summary`, under a `schemaVersion`. Nothing in this package is a
`RafaCommand`. `@open-tomato/rafa-atlas` reaches it through
`rafa module exec` and turns the roster into its help, which rafa renders
as for any command (`context/cli.md`, "Help"): a usage line, the
description, the argument and flag tables, the examples, organised by
subject. A consumer builds its declarations from the document instead of
copying its words:

- a `--mode=<mode>` flag lists `modes` in its table, one row per mode with
  its summary;
- a `--range=<range>` flag lists `ranges` the same way;
- the description names the modal keys from `modalKeys`;
- the examples stay concrete commands, such as
  `rafa module exec @open-tomato/rafa-atlas serve --range=past-month`;
- `rafa module exec @open-tomato/rafa-atlas describe` prints the document
  itself, for a tool that wants the JSON.

## Publish shape

- `type: module`, `sideEffects: false`, ESM only. The package ships no
  CSS: the app's stylesheet compiles the classes.
- `exports`: `.` and `./contract`, each with `types` before `import`, and
  `./package.json`.
- `files`: `dist` and this README. `bun run build` writes `dist/` from
  `src/index.ts` and `src/contract/index.ts` with shared chunks, every
  package external, then the declarations with
  `tsc -p tsconfig.build.json`.
- `publishConfig` names npmjs for the registry and for the
  `@open-tomato` scope, and `access: public`.
- Peers: `react` and `react-dom` ^19. Dependencies: `@open-tomato/charts`
  (`workspace:*`, public), `class-variance-authority`, `lucide-react`,
  `zod`, all from the public npm registry. No dependency on a private
  workspace member: the graph check refuses one for a publishable member.

## Privacy

This package is public, and nothing under `addons/atlas/` names a host, a
home path, an IP, a LAN name, a private registry, a self-hosted runner or
a private repository. The sweep that enforces it lives once, in
`@open-tomato/charts` (`privacy.sweep.test.ts`), and reads this folder
too.
