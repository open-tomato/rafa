# Atlas — proof of concept

A map of the codebase: the effort bucket drawn as a 3D graph of dice, one
view of the same nodes for every role. A proof of concept: **private, unpublished, not wired into rafa.** It
has visual quirks to fix before it can count as a finished PoC (listed at
the end).

```bash
cd addons/atlas && bun install && bun run dev
```

Open the printed URL. `bun run snapshot` rebuilds `data/snapshot.json` from
the source tree, the main checkout's effort store (read-only; `--store
<path>` names another), its board cache, and the repo's git log (the
roadmap's dates: task reports per plan, and `rafa-<n>:` merge commits). The snapshot holds store and
board text, so `data/` is gitignored and never committed. URL parameters:
`?dataset=rafa|services`, `?lens=<id>`, `?node=<id>`, and `?timerloop`,
which drives frames from a timer for checking animations in a background tab.

## Layout

One header (project, dataset switch, counters), three columns (lenses,
pins and filters on the left; the graph; the selected node or an overview
on the right) and a thin footer line that says what the pointer is over,
with `?` opening a help and content drawer from the bottom.

## Camera and navigation

Six strict cameras, video-game style (`src/scene/views.ts`,
`src/scene/Navigator.tsx`): four isometric angles, one top, one front.

| Input | Does |
|---|---|
| `Q` / `E` | turn the isometric view a quarter, counter-clockwise / clockwise |
| `I` / `T` / `V` | isometric, top, front |
| `W` `A` `S` `D` | move over the view's plane: the ground for iso and top, upright for front |
| middle drag | the same move with the mouse; left drag on empty space too |
| wheel | iso: zoom; top and front: scroll, shift for sideways |
| ctrl/⌘ + wheel | zoom in any view |

Zooming an iso view right in drops to front; zooming far out rises to
top. The 2D lenses hold the front view, and their dice, like an opened
net, face the camera's axis, so they stay flat on screen anywhere in the
view.

## The contracts

Three declarations, all plain data (`src/contract/types.ts`), each piece
declared once and a `ui` hint mapped to a renderer (`src/contract/registry.tsx`):

| Contract | Type | Who writes it |
|---|---|---|
| data | `Snapshot`: nodes with five known keys and any fields, edges, scenarios | the producer: `scripts/snapshot.ts`, `src/configs/services-demo.ts` |
| widget | `FaceWidgetSpec`: title, icon, `value` binding, `format`, `ui` (counter, label, combo), `background`, `action` | the config |
| view | `AtlasConfig`: entity types (with their die), edge kinds, widgets, `DiceTemplate`s, lenses | `src/configs/<dataset>.ts` |

A binding is a dot path into a node (`metrics.p95`) or a relation
(`@callers`, `@callees`, `@children`); an array reads as its length.
Formats (`src/contract/format.ts`) cover compact numbers, decimals and
units, percent, relative time, dates and cut text. A new dataset is a
producer, a config, and one line in `src/configs/index.ts`.

## Dice

Every node is a die picked by its entity type (`shape`), opened by double
click or Enter (`src/geometry/dice.ts`, `src/scene/UnfoldRig.tsx`):

| Die | Opens into | Used for here |
|---|---|---|
| d20 | the strip net: 5 up, parent and node, 5 down | modules |
| d4 | a big triangle, base up, a title band above; combo widgets per corner | buckets, issues, bugs |
| d6 | the cross, the sixth face to the right; the front is the node's card | packages, tables, external APIs |
| d8 | four diamonds, a title line along the seam | caches, queues |
| d10 | ten kites; their inner halves make a zigzag title band | epics, services |
| d12 | pentagons lift away and its members appear inside as small dice | teams |
| cylinder | the side unrolls into a grid of cells, the caps swing above and below | the effort store, databases |

The nets are laid from the solid itself, face by face along shared edges,
so every face keeps its true shape. Template slots are named per die; a
slot a template does not name takes the widget at the same position.

## Lenses

A lens (`LensSpec`, `lenses` in a config) shows the same nodes for a
different eye. It never changes a node, only which types take part, what
each edge kind does (`line`, `force`, `hidden`), gravity `wells` (with an
optional orbit `ring`), `clouds` (aura, bubble, fog), and `arrange`, a
fixed 2D layout:

| Lens | What it shows |
|---|---|
| Code | packages, modules, the store; the entry lens |
| QA | modules under bug fog; loose mist for bugs no module owns |
| PM | epics as wells with their issues, modules on each epic's sphere, one bubble per epic |
| Architecture | `plots`: one box per package, imports routed at right angles (elkjs) |
| Schema | `plots` with `rows`: the effort store's tables as an ERM |
| Board | `board`: status columns, one lane per epic |
| Roadmap | `timeline`: a column per week under month boxes, one lane per epic; a bar for its worked weeks, ✓ for merges, open work in Planned |
| Time warp | `sequence` (services demo): a use case replayed request by request, forks included |

## 2D board

A rough draft of a flat renderer (`src/board/`), switched with the 3D / 2D
buttons on the canvas or `?render=2d`. It reads the same graph model as the
3D scene (`src/scene/model.ts`), so lenses, filters, depth, selection and
the right pane behave the same. The sheet is a drafting grid; each die is
its wireframe front elevation, hidden edges dashed. One camera: the wheel
zooms at the pointer, a drag on the sheet pans, `F` fits. Double click or
Enter opens a die: its outline morphs into the flat net (a d12 spreads its
faces, the cylinder unrolls), then the same net overlay as 3D shows the
widgets. Names keep one screen size and hide when zoomed far out.

Not drawn on the board yet: PM orbits and bubbles, QA fog, the Time warp
player, dragging a node, and the d12's members inside.

## Known quirks, for the follow-up

- Architecture is dense at 166 import lines; the weight slider thins it.
- Schema text needs zoom: 19 tables fitted on one screen make small boxes.
- Time warp's timeline follows the first branch only.
- PM: modules many epics share pack into one knot where the spheres overlap.
- Shared templates show `—` where a value does not apply (the services
  store template on a cache).
- Package dice in Architecture sit on their plot's header; labels crowd.
- Dragging a node in an arranged lens snaps it back to its place.
- A background tab runs frames at about one a second, so camera moves
  crawl there; the open overlay shows after a short grace period anyway.

## Ideas to check

Suggested during the PoC sessions and not built yet, ranked by value.

Asked for, not built:

1. QA checks whether a bug already exists before filing it: a text search
   over the bugs, with the modules each one names.
2. A DevOps lens: consumers, replicas, req/s against an SLA, and a hint to
   scale out.
3. Small dice as radial-menu items that pop out, then travel to the node
   they stand for.
4. Epics linked to each other through the modules they share (crossing
   the border), drawn as a derived link.
5. Granularity by zoom (semantic zoom): epics, then issues, then bugs as
   the camera comes closer.

Built partly:

1. Board cards that show whether work is moving or a plan is running.
2. A lens that swaps a node's small icon to suit its view.
3. A D4 that opens base up, down, left or right; D10 drawers and floating
   notes in the gaps; D6 text blocks and tiny charts.
4. The cylinder's alternative: three circles with radial gauges or
   spiderweb stats.
5. Time warp: click the moving request for its payload, and fork by a
   payload property (a simulated trigger) instead of a fixed choice.

Smaller: bug tendrils as an alternative to fog; a true orthographic camera
for the 2D views; rotating the whole graph while locked; an "open on
GitHub" link for issues; the organisation scale (one die per project when
one rafa serves many).

## Stack

React 19, React Three Fiber over three.js (WebGL, nothing to install in the
browser), elkjs for the 2D layouts, served by `Bun.serve` with HTML imports.
