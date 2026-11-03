/**
 * The next hidden set after a reader toggles `id`: a hidden series comes
 * back, a shown one hides, unless it is the last one shown out of
 * `total` — a chart never goes blank from its own legend.
 */
export function nextHidden(hidden: ReadonlySet<string>, id: string, total: number): ReadonlySet<string> {
  const next = new Set(hidden);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  if (next.size >= total - 1) return hidden;
  next.add(id);
  return next;
}
