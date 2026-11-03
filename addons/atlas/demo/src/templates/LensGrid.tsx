import type { ReactElement, ReactNode } from 'react';

/** A lens page's two slots: the stat tiles and the cards. */
export interface LensGridProps {
  readonly tiles: ReactNode;
  readonly cards: ReactNode;
}

/** One row of stat tiles, then a two-column grid of cards. */
export function LensGrid({ tiles, cards }: LensGridProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{tiles}</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{cards}</div>
    </div>
  );
}
