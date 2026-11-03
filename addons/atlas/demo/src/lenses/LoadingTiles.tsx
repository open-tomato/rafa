import type { ReactElement } from 'react';

import { Card, ChartSkeleton } from '@open-tomato/atlas-ui';

/** A stat tile's inner height, so the row keeps its size while the tiles load. */
const TILE_HEIGHT = 84;

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
