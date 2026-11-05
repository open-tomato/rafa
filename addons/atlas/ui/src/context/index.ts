/**
 * The cascade's data, spec and error concerns: `CardData`,
 * `CardSpecProvider` and `DashboardData`, each a context and a hook,
 * and `CardBoundary`. `types.ts` holds the chart-facing types the cascade
 * uses until the seam exports its own.
 */
export { CardBoundary } from './CardBoundary.js';
export type { BoundaryFallback, CardBoundaryProps } from './CardBoundary.js';
export { CardSpecProvider, useCardSpec } from './CardSpec.js';
export type { CardSpecHandle, CardSpecProviderProps } from './CardSpec.js';
export { CardData, useCardData, useOptionalCardData } from './CardData.js';
export type { CardDataHandle, CardDataProps } from './CardData.js';
export { DEFAULT_DASHBOARD_RANGE, DashboardData, useDashboard, useDashboardSlice } from './DashboardData.js';
export type { DashboardDataProps, DashboardHandle, DashboardSlice } from './DashboardData.js';
export { toError } from './errors.js';
export type { CardTone, LegendItem, LegendMark, TableCell, TableData } from './types.js';
export { useSourced } from './useSourced.js';
export type { DataSource, DataStatus, Sourced } from './useSourced.js';
