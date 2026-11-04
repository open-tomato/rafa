# @open-tomato/charts

React 19 charting for the `@open-tomato` scope: a chart-engine seam with
ECharts 6 behind it, the names of the theme tokens it reads, formatters,
and a headless engine subpath that draws a chart to SVG with no React and
no DOM. Other projects consume it on its own; `@open-tomato/atlas-ui`
builds Atlas's cards on it. The consuming app brings the token values;
`@open-tomato/atlas-demo` is the reference consumer.

## Layout

Each layer is a folder under `src/` with a barrel `index.ts`, and
`src/index.ts` is the root barrel.

| Folder | Holds |
|---|---|
| `seam/` | the `ChartPrimitives` types, tones, formatters and the format spec, the engine and format providers |
| `engine/` | ECharts 6 over `echarts/core`; the only folder importing `echarts` |
| `engine/headless/` | the `./engine` subpath: option builders and `renderToSvg` |
| `theme/` | the token names; no values |
| `lib/` | `cn` |

The engine splits along React. `engine/core.ts` holds the `echarts/core`
registration of every series and component, the `ChartOption` type and
the colour bridge, and imports no React. `engine/shared.tsx` is the React
adapter: it adds the canvas renderer, `useBuiltOption` and the `EChart`
root. Each primitive gets its own folder, named after it:

```text
src/engine/LineChart/
  index.ts                 the primitive's barrel
  LineChart.tsx            the React component: the option over the live tokens, drawn by EChart
  LineChart.option.ts      buildOption(props, tokens): pure, no React, no DOM
  LineChart.stories.tsx    one story per variant value
  LineChart.test.ts        tests of buildOption
```

The primitives draw with the shared chart-root and tooltip variants in
`engine/shared.variants.ts`, so a primitive folder has no variants file of
its own.

## The headless engine

`@open-tomato/charts/engine` (`src/engine/headless/`) draws with no React
and no DOM, for a CLI, a server or a report. It exports every primitive's
`buildOption` as `build<Primitive>Option(props, tokens)`, `OPTION_BUILDERS`
by primitive name, the `ResolvedTokens` type, `tokensFrom`,
`renderToSvg`, and the format spec with its schemas (`formatterFor`,
`valueFormatSchema` and the rest of `seam/format.ts` and
`seam/format.schema.ts`), so a report writes values as a chart does:

```ts
import { renderToSvg, tokensFrom } from '@open-tomato/charts/engine';

const tokens = tokensFrom(values); // every token name, without `--color-`, to a colour
const svg = renderToSvg('LineChart', { ariaLabel: 'Tokens per day', series }, tokens, { width: 480, height: 260 });
```

A headless caller has no CSS variables to read, so it passes a value for
every token. `renderToSvg` uses ECharts' server-side mode
(`echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })`,
`setOption`, `renderToSVGString()`, `dispose()`) over the same
`echarts/core` registration the React adapter uses, with animation off.
The same input gives the same string: ECharts numbers ids and classes from
counters that grow with every instance, so the renderer renumbers them and
prefixes them with a hash of the drawing, or with `idPrefix` when given.
Text is measured on a canvas when the process has a page and estimated
when it has none, so a drawing made under a DOM and one made without can
differ by a pixel in label room.

## Chart height

Every primitive takes `height` (`ChartHeight`, `number | 'fill'`). A
number is the plot height in px, 220 (`DEFAULT_CHART_HEIGHT`) when
absent; the width always follows the container. `'fill'` gives the chart
root `height: 100%`, so the chart takes the full height of its container
and its resize observer follows the container from then on. The
container needs a height of its own: a sized box, or a flex or grid cell
that is stretched. A maximised card's box is the case it was made for.

```tsx
<div className="h-[80vmin]">
  <BarChart ariaLabel="Minutes by agent" categories={categories} series={series} height="fill" />
</div>
```

Two builders read the height as a number. Sunburst sizes its radial
labels from the measured height when it fills, and from 220px until it is
measured. Bullet cannot know a filling height, so ECharts centres its
track and text. `renderToSvg` takes an explicit size, so a headless
`'fill'` fills the drawing. `Engine/BarChart`'s `Fill` story draws one.

## Formatting values

Every primitive takes `valueFormat`, a `(value: number) => string`. A
`ValueFormat` is the same choice as data, which a spec or a data point can
carry: `raw`, `number`, `compact`, `percent` (`signed` for "+12%"),
`money` (`compact` for "$1.2K"), `unit`, `duration` ("1.5 h"), `elapsed`
("1h 3m 10s"), `date`, `relative` ("2 days ago", against the context's
`now` or the clock) or `custom`. `formatterFor(format, context)` turns one into the
function, over a `FormatContext` of locale, currency and custom formatters
(defaults `en-GB`, `USD`, `UTC`). A `custom` format names a formatter the
context registers by id, and an id the context lacks throws when the
formatter is built.

```tsx
<FormatProvider context={{ locale: 'de-DE', currency: 'EUR' }}>
  <Chart />
</FormatProvider>

// inside Chart
const valueFormat = useFormatter({ kind: 'money', digits: 0 });
return <LineChart ariaLabel="Spend per day" series={series} valueFormat={valueFormat} />;
```

- `compact` is `formatCompact` as it was: "1K" and "1.2M", with a capital
  K in every locale, so a chart with no format and one with `compact`
  read the same.
- `formatMeasured({ value, unit, format }, context, specFormat)` writes a
  value that carries its own unit or format. The point's format wins over
  the spec's, and the context fills what both leave out. A `unit` follows
  a bare number (`raw`, `number`, `compact`); the other kinds write their
  own unit and drop it.
- `formatElapsed(seconds)` writes a count of seconds as "1h 3m 10s", zero
  units left out; `formatRelative(value, now, locale)` climbs a ladder
  from a clock time on the same UTC day through "6 hours ago",
  "yesterday", "last week" and "2 months ago", mirrored for the future.
- Dates are UTC everywhere: `formatDay`, `formatWeek`, `formatDate` and
  the `date` kind read UTC, and every option sets ECharts' `useUTC`, so a
  time-axis tick sits at midnight UTC where its label names the day.
- A weekly `xFormat` goes with `xStep: 'week'` on `LineChart`: the axis
  starts on the Monday of its first point and its labels sit on the
  Mondays of the span (`axisLabel.customValues`), because the time
  scale's own interval ignores a forced `interval` and lands "w/c" labels
  on days that start no week.
- `valueFormatSchema` and `formatContextSchema` (zod v4) validate a format
  and a context that arrive as data. A context's `customFormatters` are
  functions, so they validate in code only.

The `Engine/Formats` stories draw one series under each kind.

## Styles are CVA variants

- Every class a component paints lives in a `*.variants.ts` file, as `cva`
  calls: `engine/shared.variants.ts` for the chart root and the tooltip,
  and `chartTone` in `seam/tones.ts` for a tone's colour. The file exports
  the variant props type, and the component's props extend it.
- A passthrough `className` prop is for layout context only (margin,
  alignment, grid placement), never colour or size. It merges last:
  `cn(chartRootVariants({ cursor }), className)`. `cn` (`src/lib/cn.ts`)
  is clsx plus tailwind-merge, so the later class wins a conflict.
- No inline `style`, and no class string written on an element. The lint
  rule `ot/cva-only-classname` (in `@open-tomato/rafa-eslint-config/react`)
  allows a `className` value only as a variants call, a `cn(...)` over
  variants calls and the passthrough, or the passthrough alone. Stories and
  tests are exempt.
- The repo compiles with `isolatedDeclarations`, so an exported `cva` call
  carries an explicit function type, as `chartRootVariants` does.

## Theming

The package ships token names only: `src/theme/` lists every CSS custom
property it reads (`--color-series-1` to `-8`, the four status colours,
surface, plane, ink, ink-2, muted, grid, baseline, ring, the `seq-100` to
`seq-700` ramp, `diverge-mid`, the six pole colours, `delta-up`). Each is a
Tailwind v4 colour token, so `--color-series-1` is also `bg-series-1`.

The consuming app defines every name: light values in its Tailwind
`@theme` block, the dark re-step under `:root[data-theme="dark"]`, and
`@custom-variant dark` on that attribute. Dark mode is
`data-theme="dark"` on `<html>`. The demo's `src/styles.css` is the
reference set, and the demo's test holds it to the names listed here. The
app's stylesheet adds `@source` for this package's files so Tailwind
generates the classes the components use. Canvas cannot read CSS
variables, so the React engine reads the tokens from the computed style
(`useResolvedTokens`) and re-reads them on a theme flip.

## Stories

Storybook 10 on `@storybook/react-vite`. Vite is Storybook's own builder
and appears nowhere else: the package builds with `bun build` and the demo
serves with `Bun.serve`. `.storybook/preview.ts` imports the demo's
`styles.css`, which Tailwind compiles there, so no story imports tokens.
Its `theme` toolbar global sets `data-theme` on the document.

- A story sits beside its component as `{C}.stories.tsx`.
- The header is `import type { Meta, StoryObj } from '@storybook/react-vite'`,
  and the meta ends in `satisfies Meta<typeof C>`.
- `title` is `Engine/<Name>`; `tags: ['autodocs']`;
  `parameters.layout` is `'padded'`.
- One story per variant value.
- Stories are deterministic: fixed data (`engine/fixtures.ts`), fixed
  reference dates, an explicit `locale: 'en-US'`, no `Date.now()`,
  animations off.
- A story carries no assertion and never imports vitest. A `play()`
  imports only from `storybook/test`.

Stories are type-checked by `tsconfig.stories.json` with
`isolatedDeclarations` off: a `satisfies` meta cannot carry the
annotation the flag asks for, and stories never ship.

## Tests

`bun test`, never vitest. `bunfig.toml` preloads `test/happy-dom.ts`,
which registers happy-dom's globals and cleans up Testing Library after
each test. Component tests use `@testing-library/react`.

- Pure parts first: formatters, tones, the token bridge, the chrome.
  `src/lib/cn.test.ts` is the example.
- happy-dom has no canvas, so a primitive is tested through its pure
  option builder (props in, ECharts option out), never by drawing. The
  picture is the visual suite's job.
- The headless engine is tested by drawing: a line chart and a radar to
  SVG, the same string twice, a bundle of the entry with no React import,
  and a drawing in a child process with no DOM.
- The root's `bun test` skips this package (the root `bunfig.toml`'s
  `pathIgnorePatterns`), so run its tests from this folder.

## Visual regression

A native Playwright suite (`visual/`) over the built Storybook: every
story in light and in dark, picked with the `theme` global and checked on
`data-theme` before the shot; Chromium, animations disabled, fonts
settled, a 0.1% pixel budget. `@storybook/test-runner` with
`jest-image-snapshot` was not used: it runs Jest, which the repo does not
use, and plain Playwright's `toHaveScreenshot` needs no second runner.

Baselines are per machine and untracked, in
`visual/__image_snapshots__/` (gitignored with `visual/__diff_output__/`).
A machine only ever compares against baselines it wrote:
`bun run test:visual:update` writes them, `bun run test:visual` compares.
CI runs no visual gate yet, because baselines have no durable store there.
The suite's file is `stories.visual.ts`, never `.spec.ts`, so `bun test`
never picks it up. Playwright is pinned to an exact version, since a new
Chromium moves pixels. The suite serves on port 6016; `@open-tomato/atlas-ui`'s
serves on 6017, so the two can run at once.

## Gate order

Run from this folder, in this order:

```bash
bun run check-types       # tsc --build, then tsconfig.stories.json
bun test
bun run lint
bun run build             # dist/: bun build (ESM, browser) + tsc declarations
bun run build:storybook   # storybook-static/
bun run check:stories     # every story, light and dark, no console or page error
bun run test:visual       # local only, against this machine's baselines
```

CI's `atlas` job in `.github/workflows/verify.yml` runs all but the last
on `ubuntu-latest`, as one matrix leg per package.

## Publish shape

- `type: module`, `sideEffects: false`, ESM only. The package ships no
  CSS: the app's stylesheet compiles the classes.
- `exports`: `.` (the seam, the React engine, `cn` and the theme),
  `./theme`, `./engine` (the headless engine), each with `types` before
  `import`, and `./package.json`.
- `files`: `dist` and this README. `bun run build` writes `dist/` from
  `src/index.ts`, `src/theme/index.ts` and `src/engine/headless/index.ts`
  with shared chunks, every package external, then the declarations with
  `tsc -p tsconfig.build.json`.
- An entry barrel re-exports with `export *` only. With
  `sideEffects: false`, bun 1.3 drops an entry module's own named
  re-exports from the bundle, so `engine/headless/index.ts` is
  `export * from './headless.js'` and `headless.ts` holds the list.
- `publishConfig` names npmjs for the registry and for the
  `@open-tomato` scope, and `access: public`.
- Peer: `react` ^19. Dependencies: `echarts`, `class-variance-authority`,
  `clsx`, `tailwind-merge` and `zod`, all from the public npm registry. No
  dependency on a private workspace member: the graph check refuses one
  for a publishable member.

## Privacy

This package is public. No tracked file under `addons/atlas/` names a
host, a home path, an IP, a LAN name, a private registry, a self-hosted
runner or a private repository. `privacy.sweep.test.ts`, which lives here
once for all of `addons/atlas/`, enforces it: it holds sha256 hashes of
the banned lowercase terms, so the terms never appear in it, and its
header gives the one-line command that prints the hash of a new term.
