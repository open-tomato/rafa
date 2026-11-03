import type { ReactElement } from 'react';

import { StatTile } from '@open-tomato/atlas-ui';

/** The tile row's placeholder while the page's first result set loads. */
export function LoadingTiles({ count }: { readonly count: number }): ReactElement {
  return (
    <>
      {Array.from({ length: count }, (_, index) => <StatTile key={index} label="Loading" value="…" />)}
    </>
  );
}
