import type { ChartPrimitives } from './types.js';
import type { ReactElement } from 'react';

import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { ChartEngineProvider, useChartEngine } from './ChartEngineProvider.js';

const engine = { id: 'echarts', label: 'Test engine', notes: [] } as unknown as ChartPrimitives;

function Reader(): ReactElement {
  return <p>{useChartEngine().label}</p>;
}

describe('ChartEngineProvider', () => {
  it('puts its engine in scope for the charts below it', () => {
    render(<ChartEngineProvider engine={engine}><Reader /></ChartEngineProvider>);

    expect(screen.getByText('Test engine')).toBeDefined();
  });

  it('throws outside a provider, so a missing wrap is loud', () => {
    expect(() => renderHook(() => useChartEngine())).toThrow('ChartEngineProvider');
  });
});
