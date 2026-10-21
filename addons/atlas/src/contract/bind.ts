/** Reads a binding off a node: a dot path, or a graph relation. */
import type { GraphIndex } from '../graph/index.ts';
import { formatValue } from './format.ts';
import type { Binding, FaceWidgetSpec, GraphNode, ItemShape } from './types.ts';

export interface BindContext {
  readonly node: GraphNode;
  readonly index: GraphIndex;
}

function path(value: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => (acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), value);
}

/** The raw value a binding points at. */
export function read(binding: Binding, { node, index }: BindContext): unknown {
  if (binding === '@callers') return index.callers(node.id);
  if (binding === '@callees') return index.callees(node.id);
  if (binding === '@children') return index.nodes.filter((n) => n.group === node.id && n.id !== node.id).map((n) => n.id);
  return path(node, binding);
}

/** The binding as a number: an array counts as its length; anything else not a number is null. */
export function readNumber(binding: Binding, ctx: BindContext): number | null {
  const value = read(binding, ctx);
  if (Array.isArray(value)) return value.length;
  return typeof value === 'number' ? value : null;
}

/** The binding as a list; a non-array reads as no items. */
export function readItems(binding: Binding, ctx: BindContext): readonly unknown[] {
  const value = read(binding, ctx);
  return Array.isArray(value) ? value : [];
}

export interface ItemView {
  readonly text: string;
  readonly tag?: string;
  readonly meta?: string;
  /** The item as given, for an `open` reader to use. */
  readonly raw: unknown;
}

/** One list item as text, a tag and a meta line, through the item shape's paths. */
export function viewItem(item: unknown, shape: ItemShape | undefined, label: (id: string) => string): ItemView {
  if (typeof item !== 'object' || item === null) {
    const text = String(item);
    return { text: label(text), raw: item };
  }
  const pick = (p: string | undefined): string | undefined => {
    if (!p) return undefined;
    const value = path(item, p);
    return value === undefined || value === null || value === '' ? undefined : String(value);
  };
  return { text: pick(shape?.text) ?? JSON.stringify(item), tag: pick(shape?.tag), meta: pick(shape?.meta), raw: item };
}

/** A widget's value as the text a face shows, and as a number when it reads as one. */
export function widgetValue(spec: FaceWidgetSpec, ctx: BindContext): { readonly text: string; readonly number: number | null } {
  const number = readNumber(spec.value, ctx);
  const raw = spec.ui === 'label' ? read(spec.value, ctx) : (number ?? read(spec.value, ctx));
  return { text: formatValue(raw, spec.format), number };
}
