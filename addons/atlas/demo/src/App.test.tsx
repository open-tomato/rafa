/**
 * Smoke tests for the demo page over happy-dom: every lens renders its
 * cards' titles once the page source answers, and the range selector asks
 * the source again and the page shows the new result set. happy-dom has
 * no canvas, so the page draws with a stub engine whose primitives render
 * a labelled element; the engine is the charts package's to test. The
 * source answers with no delay.
 */
import type { DataSource, TimeRange } from '@open-tomato/atlas-ui';
import type { ChartPrimitives } from '@open-tomato/charts';
import type { ReactElement } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'bun:test';

import { App } from './App.js';
import { createLensSource, lensResultOf, type LensResult } from './data/source.js';

/** The card titles each lens shows, by the tab that opens it. */
const LENS_CARDS: Readonly<Record<string, readonly string[]>> = {
  'Project Management': ['Budget burn', 'Tokens per day', 'Planned tasks vs sessions', 'Hours per agent this week', 'The task pile as drag'],
  'Architecture': ['Minutes by change kind', 'Task minutes per week', 'Tokens by model', 'Preflight halts', 'Package size', 'What each package is made of', 'Import flow by layer'],
  'Development': ['Balance: shipping, failing, foundation', 'Work done, 12 weeks', 'Tasks done per week', 'Task cycle time', 'Red CI share', 'Task minutes distribution'],
  'QA': ['Bugs by kind per week', 'Regressions per week', 'Where bugs went', 'Resolution time by priority', 'Flaky checks, top 10'],
};

/** A primitive that draws nothing: an image role named by the chart's label. */
function StubChart({ ariaLabel }: { readonly ariaLabel: string }): ReactElement {
  return <div role="img" aria-label={ariaLabel} />;
}

const STUB_ENGINE: ChartPrimitives = {
  id: 'echarts',
  label: 'stub',
  notes: [],
  BarChart: StubChart,
  LineChart: StubChart,
  ScatterChart: StubChart,
  Histogram: StubChart,
  BoxPlot: StubChart,
  Gauge: StubChart,
  Bullet: StubChart,
  Donut: StubChart,
  Treemap: StubChart,
  HeatmapGrid: StubChart,
  NetworkGraph: StubChart,
  Sankey: StubChart,
  Nightingale: StubChart,
  Sunburst: StubChart,
  Radar: StubChart,
};

/** The page over the stub engine and the given source. */
function renderApp(source: DataSource<LensResult, TimeRange> = createLensSource(0)): void {
  render(<App source={source} engine={STUB_ENGINE} />);
}

beforeEach(() => {
  history.replaceState(null, '', '/?still');
});

/** Lets the source's timer and the page's state updates settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

function cardTitles(): string[] {
  return screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent ?? '');
}

function haltsOf(result: LensResult): number {
  return result.mock.preflightHalts.flat().reduce((sum, value) => sum + value, 0);
}

describe('App', () => {
  for (const [lens, titles] of Object.entries(LENS_CARDS)) {
    it(`renders the ${lens} lens with its ${titles.length} cards`, async () => {
      renderApp();
      fireEvent.click(screen.getByRole('tab', { name: lens }));
      await settle();

      expect(screen.getByRole('tab', { name: lens }).getAttribute('aria-selected')).toBe('true');
      expect(cardTitles()).toEqual([...titles]);
      expect(screen.queryByText('Loading')).toBeNull();
    });
  }

  it('shows the loading tiles until the source answers', async () => {
    renderApp(() => new Promise<LensResult>(() => undefined));
    await settle();

    expect(screen.getAllByText('Loading')).toHaveLength(4);
  });

  it('asks the source again on a range switch and shows the new result set', async () => {
    const asked: TimeRange[] = [];
    const inner = createLensSource(0);
    const source: DataSource<LensResult, TimeRange> = (range) => {
      asked.push(range);
      return inner(range);
    };
    renderApp(source);
    fireEvent.click(screen.getByRole('tab', { name: 'Architecture' }));
    await settle();
    const before = String(haltsOf(lensResultOf('past-month')));
    const after = String(haltsOf(lensResultOf('last-year')));

    expect(asked).toEqual(['past-month']);
    expect(screen.getByRole('region', { name: 'Preflight halts, 12 weeks' }).textContent).toContain(before);
    fireEvent.click(screen.getByRole('radio', { name: 'Last year' }));
    await settle();
    expect(asked).toEqual(['past-month', 'last-year']);
    expect(screen.getByRole('radio', { name: 'Last year' }).getAttribute('aria-checked')).toBe('true');
    expect(after).not.toBe(before);
    expect(screen.getByRole('region', { name: 'Preflight halts, 12 weeks' }).textContent).toContain(after);
    expect(location.search).toContain('range=last-year');
  });

  it('switches a balance index from the card menu\'s Indices entry', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Development' }));
    await settle();
    const radar = (count: number): HTMLElement => screen.getByRole('img', { name: `Balance radar: ${count} indices pulled toward three poles, this week against the usual` });

    expect(radar(8)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Balance: shipping, failing, foundation' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Indices…' }));
    expect(screen.getByRole('checkbox', { name: 'red CI share on the radar' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'releases on the radar' }));
    expect(radar(7)).toBeDefined();
    expect(screen.getByText('📦 2 of 3 · 🔥 3 of 3 · 🛠️ 2 of 3')).toBeDefined();
  });

  it('opens a card\'s Source entry with the table behind the chart', async () => {
    renderApp();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Planned tasks vs sessions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Source' }));

    expect(screen.getByRole('table', { name: 'Planned tasks vs sessions' })).toBeDefined();
    expect(screen.getByText('rafa-1266')).toBeDefined();
  });

  it('opens the lens named in the URL', async () => {
    history.replaceState(null, '', '/?lens=qa&still');
    renderApp();
    await settle();

    expect(screen.getByRole('tab', { name: 'QA' }).getAttribute('aria-selected')).toBe('true');
    expect(cardTitles()).toContain('Flaky checks, top 10');
  });
});
