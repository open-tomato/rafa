/** UI state for the PoC: one reducer, read through context. Positions live in the layout, not here. */
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';

import type { EdgeKind, EntityType } from './types.ts';

/** `none`, or the id of a config widget whose value lights the dice. */
export type HeatKey = string;

/** `front` fits the graph looking straight down the z axis, for a flat lens. */
export type CameraKind = 'fit' | 'front' | 'zoom-in' | 'zoom-out' | 'reset';

export type DepthDirection = 'both' | 'upstream' | 'downstream';

export type Hover =
  | { readonly kind: 'node'; readonly id: string }
  | { readonly kind: 'face'; readonly slot: string }
  | { readonly kind: 'ui'; readonly text: string; readonly more?: string }
  | null;

export interface DrawerItem {
  readonly kind: string;
  readonly text: string;
  readonly meta?: string;
}

export type DrawerContent =
  | { readonly kind: 'list'; readonly title: string; readonly items: readonly DrawerItem[] }
  | { readonly kind: 'doc'; readonly title: string; readonly path: string }
  | { readonly kind: 'plan'; readonly title: string; readonly stub: string };

export interface Radial {
  readonly slot: string;
  readonly title: string;
  readonly items: readonly { readonly label: string; readonly open?: DrawerContent }[];
}

export interface Highlight {
  readonly label: string;
  readonly ids: readonly string[];
}

export interface UiState {
  readonly selected: string | null;
  readonly hover: Hover;
  readonly expanded: string | null;
  /** True once the unfold animation and the camera have both settled. */
  readonly unfolded: boolean;
  /** True while the net folds back, before `expanded` clears. */
  readonly collapsing: boolean;
  readonly locked: boolean;
  readonly pinned: readonly string[];
  readonly hiddenTypes: readonly EntityType[];
  readonly hiddenGroups: readonly string[];
  readonly hiddenEdgeKinds: readonly EdgeKind[];
  readonly minImportWeight: number;
  /** Hops from the selected node a node may be and still show; 0 shows the whole graph. */
  readonly depth: number;
  readonly depthDirection: DepthDirection;
  readonly heat: HeatKey;
  /** The lens id; the view falls back to the config's first lens. */
  readonly lens: string;
  /** The scenario the sequence view replays. */
  readonly scenario: string | null;
  readonly highlight: Highlight | null;
  readonly drawer: { readonly open: boolean; readonly tab: 'help' | 'content'; readonly content: DrawerContent | null };
  /** Widgets dropped onto faces, by template id, over what the template places. */
  readonly faceOverrides: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly radial: Radial | null;
  /** Bumped to ask the camera for a fit, a zoom step or a reset. */
  readonly cameraCommand: { readonly kind: CameraKind; readonly at: number } | null;
}

export type Action =
  | { readonly type: 'select'; readonly id: string | null }
  | { readonly type: 'hover'; readonly hover: Hover }
  | { readonly type: 'expand'; readonly id: string }
  | { readonly type: 'collapse' }
  | { readonly type: 'collapsed' }
  | { readonly type: 'unfolded'; readonly done: boolean }
  | { readonly type: 'toggle-lock' }
  | { readonly type: 'toggle-pin'; readonly id: string }
  | { readonly type: 'toggle-type'; readonly entity: EntityType }
  | { readonly type: 'toggle-group'; readonly group: string }
  | { readonly type: 'toggle-edge'; readonly kind: EdgeKind }
  | { readonly type: 'min-weight'; readonly value: number }
  | { readonly type: 'depth'; readonly depth: number }
  | { readonly type: 'depth-direction'; readonly direction: DepthDirection }
  | { readonly type: 'heat'; readonly heat: HeatKey }
  | { readonly type: 'lens'; readonly lens: string; readonly heat?: HeatKey }
  | { readonly type: 'scenario'; readonly id: string | null }
  | { readonly type: 'highlight'; readonly highlight: Highlight | null }
  | { readonly type: 'drawer'; readonly open: boolean; readonly tab?: 'help' | 'content' }
  | { readonly type: 'show'; readonly content: DrawerContent }
  | { readonly type: 'assign'; readonly template: string; readonly slot: string; readonly widget: string }
  | { readonly type: 'radial'; readonly radial: Radial | null }
  | { readonly type: 'camera'; readonly kind: CameraKind }
  | { readonly type: 'escape' };

export const INITIAL_STATE: UiState = {
  selected: null,
  hover: null,
  expanded: null,
  unfolded: false,
  collapsing: false,
  locked: false,
  pinned: [],
  hiddenTypes: [],
  hiddenGroups: [],
  hiddenEdgeKinds: [],
  minImportWeight: 5,
  depth: 0,
  depthDirection: 'both',
  heat: 'none',
  lens: '',
  scenario: null,
  highlight: null,
  drawer: { open: false, tab: 'help', content: null },
  faceOverrides: {},
  radial: null,
  cameraCommand: null,
};

const toggle = <T,>(list: readonly T[], item: T): readonly T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

function reduce(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'select':
      return state.expanded ? state : { ...state, selected: action.id, radial: null };
    case 'hover':
      return { ...state, hover: action.hover };
    case 'expand':
      return { ...state, selected: action.id, expanded: action.id, unfolded: false, collapsing: false, radial: null };
    case 'collapse':
      return state.expanded ? { ...state, unfolded: false, collapsing: true, radial: null } : state;
    case 'collapsed':
      return { ...state, expanded: null, unfolded: false, collapsing: false };
    case 'unfolded':
      return { ...state, unfolded: action.done };
    case 'toggle-lock':
      return { ...state, locked: !state.locked };
    case 'toggle-pin':
      return { ...state, pinned: toggle(state.pinned, action.id) };
    case 'toggle-type':
      return { ...state, hiddenTypes: toggle(state.hiddenTypes, action.entity) };
    case 'toggle-group':
      return { ...state, hiddenGroups: toggle(state.hiddenGroups, action.group) };
    case 'toggle-edge':
      return { ...state, hiddenEdgeKinds: toggle(state.hiddenEdgeKinds, action.kind) };
    case 'min-weight':
      return { ...state, minImportWeight: action.value };
    case 'depth':
      return { ...state, depth: action.depth };
    case 'depth-direction':
      return { ...state, depthDirection: action.direction };
    case 'heat':
      return { ...state, heat: action.heat };
    case 'scenario':
      return { ...state, scenario: action.id };
    case 'lens':
      return { ...state, lens: action.lens, heat: action.heat ?? 'none', highlight: null, radial: null };
    case 'highlight':
      return { ...state, highlight: action.highlight };
    case 'drawer':
      return { ...state, drawer: { ...state.drawer, open: action.open, tab: action.tab ?? state.drawer.tab } };
    case 'show':
      return { ...state, radial: null, drawer: { open: true, tab: 'content', content: action.content } };
    case 'assign':
      return { ...state, faceOverrides: { ...state.faceOverrides, [action.template]: { ...state.faceOverrides[action.template], [action.slot]: action.widget } } };
    case 'radial':
      return { ...state, radial: action.radial };
    case 'camera':
      return { ...state, cameraCommand: { kind: action.kind, at: performance.now() } };
    case 'escape':
      if (state.radial) return { ...state, radial: null };
      if (state.drawer.open) return { ...state, drawer: { ...state.drawer, open: false } };
      if (state.expanded) return reduce(state, { type: 'collapse' });
      if (state.highlight) return { ...state, highlight: null };
      return { ...state, selected: null };
  }
}

interface Store {
  readonly state: UiState;
  readonly dispatch: Dispatch<Action>;
}

const StoreContext = createContext<Store | null>(null);

interface StoreProviderProps {
  readonly children: ReactNode;
  readonly pinned?: readonly string[];
  readonly minWeight?: number;
  readonly selected?: string | null;
  readonly lens?: string;
  readonly heat?: HeatKey;
}

export function StoreProvider({ children, pinned, minWeight, selected, lens, heat }: StoreProviderProps) {
  const [state, dispatch] = useReducer(reduce, {
    ...INITIAL_STATE,
    pinned: pinned ?? [],
    minImportWeight: minWeight ?? INITIAL_STATE.minImportWeight,
    selected: selected ?? null,
    lens: lens ?? '',
    heat: heat ?? 'none',
  });
  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}
