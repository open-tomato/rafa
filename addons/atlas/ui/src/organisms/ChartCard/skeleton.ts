import type { SkeletonKind } from '../../contract/schemas.js';

/** The families, matched against a primitive's name in order; the first hit wins. */
const FAMILIES: readonly (readonly [RegExp, SkeletonKind])[] = [
  [/stat|tile/i, 'tile'],
  [/table|heatmap|sankey|tree/i, 'rows'],
  [/line|scatter|area/i, 'line'],
  [/donut|pie|gauge|sunburst|nightingale|rose|radar/i, 'ring'],
];

/** The loading shape for a chart primitive, by its name; bars when nothing matches. */
export function skeletonFor(primitive: string): SkeletonKind {
  const hit = FAMILIES.find(([pattern]) => pattern.test(primitive));
  return hit === undefined
    ? 'bars'
    : hit[1];
}
