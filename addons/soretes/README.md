# S.O.R.E.T.E.S. — proof of concept

Single Origin Related Typified Entities: the effort bucket drawn as a 3D
graph of dice, one view of the same nodes for every role. A working name,
and a proof of concept: **private, unpublished, not wired into rafa.** It
has visual quirks to fix before it can count as a finished PoC (listed at
the end).

```bash
cd addons/soretes && bun install && bun run dev
```

Open the printed URL. `bun run snapshot` rebuilds `data/snapshot.json` from
the source tree, the main checkout's effort store (read-only; `--store
<path>` names another) and its board cache. The snapshot holds store and
board text, so `data/` is gitignored and never committed. URL parameters:
`?dataset=rafa|services`, `?lens=<id>`, `?node=<id>`, and `?timerloop`,
which drives frames from a timer for checking animations in a background tab.

## Layout

One header (project, dataset switch, counters), three columns (lenses,
pins and filters on the left; the graph; the selected node or an overview
on the right) and a thin footer line that says what the pointer is over,
with `?` opening a help and content drawer from the bottom.

## The contracts

Three declarations, all plain data (`src/contract/types.ts`), each piece
declared once and a `ui` hint mapped to a renderer (`src/contract/registry.tsx`):

| Contract | Type | Who writes it |
|---|---|---|
| data | `Snapshot`: nodes with five known keys and any fields, edges, scenarios | the producer: `scripts/snapshot.ts`, `src/configs/services-demo.ts` |
| widget | `FaceWidgetSpec`: title, icon, `value` binding, `format`, `ui` (counter, label, combo), `background`, `action` | the config |
| view | `SoretesConfig`: entity types (with their die), edge kinds, widgets, `DiceTemplate`s, lenses | `src/configs/<dataset>.ts` |

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
| Time warp | `sequence` (services demo): a use case replayed request by request, forks included |

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

## Stack

React 19, React Three Fiber over three.js (WebGL, nothing to install in the
browser), elkjs for the 2D layouts, served by `Bun.serve` with HTML imports.
