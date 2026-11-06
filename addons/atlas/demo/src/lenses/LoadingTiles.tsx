import type { ReactElement } from 'react';

import { Card, ChartSkeleton } from '@open-tomato/atlas-ui';

/** The stat row's height at the hero's scale, less the card's padding, so the row keeps its size while the tiles load. */
const TILE_HEIGHT = 118;

/** The tile row's placeholder while the page's first result set loads: the outline of each tile. */
export function LoadingTiles({ count }: { readonly count: number }): ReactElement {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} label="Loading" padding="sm">
          <ChartSkeleton kind="tile" height={TILE_HEIGHT} />
        </Card>
      ))}
    </>
  );
}
