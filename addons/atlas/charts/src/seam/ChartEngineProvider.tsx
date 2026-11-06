import type { ChartPrimitives } from './types.js';

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

const EngineContext = createContext<ChartPrimitives | null>(null);

/** The props of {@link ChartEngineProvider}. */
export interface ChartEngineProviderProps {
  /** The engine every chart below draws with. */
  readonly engine: ChartPrimitives;
  readonly children: ReactNode;
}

/** Puts one engine in scope for the charts below it. */
export function ChartEngineProvider({ engine, children }: ChartEngineProviderProps): ReactElement {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

/** The engine in scope; throws outside a provider so a missing wrap is loud. */
export function useChartEngine(): ChartPrimitives {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useChartEngine needs a ChartEngineProvider above it');
  return engine;
}
