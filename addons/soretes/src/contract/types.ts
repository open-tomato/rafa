/**
 * The S.O.R.E.T.E.S. contracts, in the shape of a command-metadata contract
 * (an argument spec with a `ui` hint, mapped to a widget): every piece is
 * declared once, as data, and a small registry turns the `ui` hint into a renderer.
 *
 *   data contract    Snapshot: what a producer hands over (nodes, edges, any fields)
 *   widget contract  FaceWidgetSpec: what a dice face reads, shows and does
 *   view contract    SoretesConfig: types, links and the templates that place widgets on dice
 *
 * Nothing here is validated; a binding that finds nothing shows "—".
 */
import type { ShapeId } from '../geometry/dice.ts';
import type { ValueFormat } from './format.ts';

// ── data contract ─────────────────────────────────────────────────────────────

/** A node as any producer hands it over: five known keys, and whatever fields its widgets bind to. */
export interface GraphNode {
  readonly id: string;
  readonly label: string;
  /** A key of `SoretesConfig.entityTypes`. */
  readonly type: string;
  /** Another node's id (its parent, region A) or a free group name. */
  readonly group: string;
  /** The one line under the die. */
  readonly legend: string;
  readonly [field: string]: unknown;
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  /** A key of `SoretesConfig.edgeKinds`. */
  readonly kind: string;
  readonly weight: number;
}

/**
 * One message of a scenario, played by the sequence view as a request moving
 * from node to node. A step with a `choice` stops the clock until the viewer
 * picks a branch; each option jumps to another step.
 */
export interface ScenarioStep {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  /** What hovering the moving request shows: method, url, body, status… */
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly ms?: number;
  /** A reply travels back along the same link, drawn dashed. */
  readonly reply?: boolean;
  readonly choice?: { readonly prompt: string; readonly options: readonly { readonly label: string; readonly goto: number }[] };
  /** Where the clock goes after this step; the next step when omitted, the end at -1. */
  readonly next?: number;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly ScenarioStep[];
}

export interface Snapshot {
  /** The config that knows how to draw it: a key of the config registry. */
  readonly dataset: string;
  readonly project: { readonly org: string; readonly name: string; readonly version?: string; readonly scope: string };
  readonly generatedAt: string;
  /** Header counters, label → count. */
  readonly summary?: Readonly<Record<string, number>>;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Use cases the sequence view can replay, when the producer has them. */
  readonly scenarios?: readonly Scenario[];
}

// ── widget contract ───────────────────────────────────────────────────────────

/**
 * Where a value comes from: a dot path into the node (`stats.bugs`,
 * `metrics.p95`), or a graph relation (`@callers`, `@callees`, `@children`: the nodes whose group
 * is this node). An array
 * counts as its length wherever a number is wanted.
 */
export type Binding = string;

/** How a face draws its widget; the registry maps each hint to a renderer, like `widget_for(arg.ui)`. */
export type FaceUi = 'counter' | 'label' | 'combo';

/** One value of a combo widget: up to four share a face, one per corner and one in the middle. */
export interface ComboPart {
  readonly title: string;
  readonly value: Binding;
  readonly format?: ValueFormat;
}

/** The open slot behind a face's text: a faint icon, a sparkline over a numeric array, and more kinds later. */
export type BackgroundSpec =
  | { readonly kind: 'none' }
  | { readonly kind: 'icon'; readonly opacity?: number }
  | { readonly kind: 'sparkline'; readonly values: Binding; readonly color?: string };

/** What a list item shows: paths into each item when items are objects. */
export interface ItemShape {
  readonly text?: string;
  readonly tag?: string;
  readonly meta?: string;
}

/** A reader the server offers for an item: a context page, or a plan's task reports. */
export type OpenSpec = { readonly kind: 'doc' } | { readonly kind: 'plan' };

export type ActionSpec =
  | { readonly kind: 'none' }
  /** Fold back and light up the related nodes, or the node ids a field lists. */
  | { readonly kind: 'highlight'; readonly relation: 'callers' | 'callees' }
  | { readonly kind: 'highlight'; readonly ids: Binding }
  /** Spread the items around the face; `open` makes each one open in the drawer. */
  | { readonly kind: 'radial'; readonly items: Binding; readonly shape?: ItemShape; readonly open?: OpenSpec }
  /** List the items in the drawer. */
  | { readonly kind: 'list'; readonly items: Binding; readonly shape?: ItemShape };

export interface FaceWidgetSpec {
  readonly title: string;
  readonly icon: string;
  /** The footer line and the help drawer read this. */
  readonly description: string;
  readonly value: Binding;
  readonly format?: ValueFormat;
  readonly ui?: FaceUi;
  /** For `ui: 'combo'`: the values sharing the face. */
  readonly parts?: readonly ComboPart[];
  readonly background?: BackgroundSpec;
  readonly action?: ActionSpec;
}

// ── view contract ─────────────────────────────────────────────────────────────

export interface EntityTypeSpec {
  readonly name: string;
  readonly icon: string;
  /** The die's edge colour. */
  readonly stroke: string;
  readonly help: string;
  /** A fixed die size for the type, over the config's `size` binding. */
  readonly radius?: number;
  /** The line under the die: name and legend (default), the name alone, or nothing until hovered or selected. */
  readonly label?: 'full' | 'name' | 'none';
  /** The die it is drawn as; a d20 when omitted. */
  readonly shape?: ShapeId;
}

export interface EdgeKindSpec {
  readonly label: string;
  readonly color: string;
  /** 0 draws a solid line. */
  readonly dash: number;
  readonly help: string;
  /** Spring length and pull in the layout. */
  readonly rest?: number;
  readonly stiffness?: number;
  /** True when the edge means "calls / depends on", for the callers and callees relations. */
  readonly calls?: boolean;
}

export interface RegionLine {
  readonly label?: string;
  readonly value: Binding;
  readonly format?: ValueFormat;
}

/** A section of the right column: a list or a row of chips over an array field. */
export interface PanelList {
  readonly title: string;
  readonly items: Binding;
  readonly shape?: ItemShape;
  readonly display?: 'list' | 'chips';
  readonly open?: OpenSpec;
  readonly limit?: number;
}

/** Which widgets a die of some type carries, and what its middle strip and the right column show. */
export interface DiceTemplate {
  readonly id: string;
  /** Entity types or node ids this template draws; `*` for any. A node id wins over a type, a type over `*`. */
  readonly appliesTo: readonly string[] | '*';
  /**
   * Widget id per face slot of the die (d20: up0…down4; d4: corner0…2, center; d6: top, bottom,
   * left, right, back; d8, d10: up0…, down0…; cylinder: c0…c7). A slot the template does not
   * name takes the template's widget at the same position in this list.
   */
  readonly faces: Readonly<Record<string, string>>;
  /** What a d12 reveals inside when it opens: node ids. The node's group members when omitted. */
  readonly members?: Binding;
  /** Region B's lines under the node's name; region A always shows the parent. */
  readonly details: readonly RegionLine[];
  /** The right column's counters: widget ids. */
  readonly summary: readonly string[];
  readonly lists?: readonly PanelList[];
}

// ── lens contract ─────────────────────────────────────────────────────────────

/**
 * What a relation does under a lens: drawn as a line, felt only as a force
 * in the layout (it still pulls nodes together), or left out entirely.
 */
export type RelationRole = 'line' | 'force' | 'hidden';

/**
 * A cloud drawn around nodes instead of a line.
 *   aura    soft puffs on each of a holder's members: a set, a hyperedge
 *   bubble  one area of effect per holder, centred on it and inflated to reach its farthest
 *           visible member: the members pass their volume up, and bubbles overlap where sets do
 *   fog     puffs hung on the node itself, thicker the larger `amount` is (bugs as miasma)
 */
export interface CloudSpec {
  readonly look: 'aura' | 'bubble' | 'fog';
  /** Entity types or node ids that carry the cloud. */
  readonly on: readonly string[];
  /** Puffs per node, read on a log scale; an aura without it puts a few puffs on each member. */
  readonly amount?: Binding;
  /** For an aura or a bubble: the ids it wraps, from one field or several. Omitted, the cloud sits on the node. */
  readonly members?: Binding | readonly Binding[];
  /** Omitted, an aura takes the holder's colour. */
  readonly color?: string;
  readonly radius?: number;
}

/** A gravity well: holders pull their members toward them, so a set reads as a cluster. */
export interface WellSpec {
  readonly on: readonly string[];
  readonly members: Binding;
  readonly rest?: number;
  readonly stiffness?: number;
  /** Draw the well as an orbit at `rest` around the holder, its members held on it: a flat circle, or a sphere for 3D. */
  readonly ring?: 'circle' | 'sphere';
  /** Entity types that show only while a visible holder of this well lists them; the rest of that type stay out. */
  readonly only?: readonly string[];
}

/**
 * A fixed 2D arrangement, the traditional views. The nodes keep their dice and
 * templates; only where they stand changes, on a flat plane with the camera face-on.
 *   plots     boxes laid out by ELK with right-angle lines routed around them.
 *             `contains` makes a node a box around its targets (architecture);
 *             `rows` makes a node a box listing a field (an ERM entity)
 *   board     a kanban grid: columns by a status field, swim lanes by a group,
 *             the lane's holder at the start of its row
 *   sequence  the scenario's participants on one line, a request replayed between them
 *   timeline  a roadmap: one column per week under month boxes, one lane per group;
 *             cards stand in the week of their `date`, undated ones in a Planned column,
 *             and each lane head's `cells` (week → done/active) and `span` mark its weeks
 */
export type ArrangeSpec =
  | {
    readonly kind: 'plots';
    readonly contains?: string;
    readonly rows?: Binding;
    readonly rowShape?: ItemShape;
    readonly routed: readonly string[];
    readonly direction?: 'RIGHT' | 'DOWN';
  }
  | {
    readonly kind: 'board';
    readonly column: Binding;
    readonly columns: readonly { readonly id: string; readonly title: string }[];
    readonly lane: Binding;
    /** Node types that head a lane; a lane with no head gets a plain title. */
    readonly laneHeads: readonly string[];
  }
  | { readonly kind: 'sequence' }
  | {
    readonly kind: 'timeline';
    readonly date: Binding;
    readonly lane: Binding;
    readonly laneHeads: readonly string[];
    readonly cells?: Binding;
    readonly span?: Binding;
  };

/**
 * A lens: the same nodes for a different eye. It never changes a node, only
 * which ones take part, what each relation does, and what hangs around them.
 */
export interface LensSpec {
  readonly title: string;
  readonly icon: string;
  /** Who it is for and what it answers, shown in the left column. */
  readonly description: string;
  /** Entity types that take part; all when omitted. */
  readonly types?: readonly string[];
  /** Role per edge kind; a kind not listed is a line. */
  readonly relations?: Readonly<Record<string, RelationRole>>;
  readonly wells?: readonly WellSpec[];
  readonly clouds?: readonly CloudSpec[];
  /** The data heat it starts with: a widget id. */
  readonly heat?: string;
  /** Lay the graph out on one plane and face the camera at it: orbits read as rings, a step toward 2D views. */
  readonly flat?: boolean;
  /** A fixed 2D arrangement instead of the force layout; implies `flat`. */
  readonly arrange?: ArrangeSpec;
  /** Label mode per entity type under this lens, over the type's own. */
  readonly labels?: Readonly<Record<string, 'full' | 'name' | 'none'>>;
}

export interface SoretesConfig {
  readonly id: string;
  readonly title: string;
  readonly entityTypes: Readonly<Record<string, EntityTypeSpec>>;
  readonly edgeKinds: Readonly<Record<string, EdgeKindSpec>>;
  /** Face colour by group, then per-node icon and colour overrides. */
  readonly groupColors?: Readonly<Record<string, string>>;
  readonly nodeStyle?: Readonly<Record<string, { readonly icon?: string; readonly color?: string }>>;
  readonly widgets: Readonly<Record<string, FaceWidgetSpec>>;
  readonly templates: readonly DiceTemplate[];
  /** What sizes a die: a numeric binding, read on a log scale. */
  readonly size?: Binding;
  /** Widget ids offered as data heat in the left column, and ranked in the overview. */
  readonly heat: readonly string[];
  /** The import-like edge kind the weight slider thins, if any, and where the slider starts. */
  readonly weightedKind?: string;
  readonly minWeight?: number;
  /** Lenses by id; the first is the entry lens. A config with none gets one that shows everything. */
  readonly lenses?: Readonly<Record<string, LensSpec>>;
  /** Node ids pinned in the left column at start. */
  readonly pinned?: readonly string[];
}
