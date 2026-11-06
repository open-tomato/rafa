import type { TableRowDrop } from './Table.variants.js';

import { useEffect, useRef, useState, type DragEvent } from 'react';

/**
 * Row reordering for the grip column: native HTML5 drag re-hosted on
 * `<tr>`, the row's midpoint deciding above or below, an insert line at
 * the drop. Controlled: the parent owns the list and the hook emits the
 * next order. A drag starts only from the grip (a pointer down on it
 * arms the row's dragstart), so text selection in cells keeps working;
 * a window-level pointer up or cancel disarms it, because the release
 * may land anywhere. Reordering has no keyboard path yet; a caller that
 * needs one exposes explicit move actions.
 */

/** `items` with the item at `from` moved to insert position `to` (0 to length). */
export function moveRow<T>(items: readonly T[], from: number, to: number): readonly T[] {
  const moved = items[from];
  if (moved === undefined) return items;
  const rest = items.filter((_, index) => index !== from);
  const at = from < to
    ? to - 1
    : to;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** What the hook takes: the rows in order, and where to send the next order. */
export interface UseRowReorderOptions<Row> {
  readonly data: readonly Row[];
  readonly onReorder?: (next: readonly Row[]) => void;
}

/** What the hook gives: the props for the grip and each row, and the per-row feedback. */
export interface UseRowReorderResult {
  /** Spread on the grip's wrapper: arms the row drag. */
  readonly handleProps: () => { readonly onPointerDown: () => void };
  /** Spread on each `<tr>`. */
  readonly rowProps: (index: number) => {
    readonly draggable: boolean;
    readonly onDragStart: (event: DragEvent<HTMLTableRowElement>) => void;
    readonly onDragEnd: () => void;
    readonly onDragOver: (event: DragEvent<HTMLTableRowElement>) => void;
    readonly onDrop: (event: DragEvent<HTMLTableRowElement>) => void;
  };
  /** Where the insert line sits for row `index`. */
  readonly dropFor: (index: number) => TableRowDrop;
  readonly isDragging: (index: number) => boolean;
}

/** Wires drag-to-reorder onto a table's rows; see the module note. */
export function useRowReorder<Row>({ data, onReorder }: UseRowReorderOptions<Row>): UseRowReorderResult {
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const armed = useRef(false);
  const disarmRef = useRef<(() => void) | null>(null);

  useEffect(() => () => disarmRef.current?.(), []);

  const clear = (): void => {
    armed.current = false;
    disarmRef.current?.();
    setFrom(null);
    setOver(null);
  };

  const handleProps = (): { readonly onPointerDown: () => void } => ({
    onPointerDown: () => {
      disarmRef.current?.();
      armed.current = true;
      const reset = (): void => {
        armed.current = false;
        window.removeEventListener('pointerup', reset);
        window.removeEventListener('pointercancel', reset);
        disarmRef.current = null;
      };
      disarmRef.current = reset;
      window.addEventListener('pointerup', reset);
      window.addEventListener('pointercancel', reset);
    },
  });

  const rowProps = (index: number): ReturnType<UseRowReorderResult['rowProps']> => ({
    draggable: true,
    onDragStart: (event) => {
      if (!armed.current) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
      setFrom(index);
    },
    onDragEnd: clear,
    onDragOver: (event) => {
      if (from === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const rect = event.currentTarget.getBoundingClientRect();
      const past = event.clientY - rect.top > rect.height / 2;
      setOver(past
        ? index + 1
        : index);
    },
    onDrop: (event) => {
      if (from === null || over === null) {
        clear();
        return;
      }
      event.preventDefault();
      if (over !== from && over !== from + 1) onReorder?.(moveRow(data, from, over));
      clear();
    },
  });

  const dropFor = (index: number): TableRowDrop => {
    if (from === null || over === null) return 'none';
    if (over === index) return 'above';
    if (over === data.length && index === data.length - 1) return 'below';
    return 'none';
  };

  return { handleProps, rowProps, dropFor, isDragging: (index) => from === index };
}
