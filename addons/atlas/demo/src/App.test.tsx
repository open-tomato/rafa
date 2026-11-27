/**
 * Smoke tests for the demo page over happy-dom: every lens renders its
 * cards' titles once the page source answers, and the range selector asks
 * the source again and the page shows the new result set; with no
 * `?source` the page draws the mock, and over the live source (a stub
 * client) the cards and tiles a metric feeds draw, with the row count
 * behind them, while the others say "Not wired yet"; the two bug backlog
 * cards draw on both sources, and over a replica with no GitHub data the
 * GitHub-only cards name the `--github` build; the on-time tile draws the
 * `collect` empty state on the live page and its sample on the mock; work
 * done and the balance radar draw from the live answers, an index with no
 * event in 12 weeks reading "none in 12 weeks" on its axis. happy-dom has no canvas, so the page draws with a stub engine
 * whose primitives render a labelled element; the engine is the charts
 * package's to test. The source answers with no delay.
 */
import type { AtlasClient } from '@open-tomato/atlas-transport/client';
import type { DataSource, TimeRange } from '@open-tomato/atlas-ui';
import type { ChartPrimitives, RadarAxis } from '@open-tomato/charts';
import type { ReactElement } from 'react';

import { formatPercent } from '@open-tomato/charts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'bun:test';
import { createElement } from 'react';

import { App } from './App.js';
import { BALANCE_CATALOGUE } from './data/balance.js';
import { NONE_IN_12_WEEKS } from './data/live-balance.js';
import { scopeCreepOf } from './data/live-cards.js';
import { GITHUB_BUILD_LINE, GITHUB_NOT_READ } from './data/live-sources.js';
import { createLiveLensSource, LIVE_METRICS } from './data/live.js';
import { ON_TIME_SHARE, PILE_KINDS, SCOPE_CREEP_AVERAGE } from './data/mock.js';
import { createLensSource, lensResultOf, type LensResult } from './data/source.js';
import { noRowsOf, STUB_SCOPE_CREEP, stubLiveClient } from './data/testdata/live-client.fixture.js';
import { NO_FLAKY_TITLE } from './lenses/QaLens.js';

/** The card titles each lens shows, by the tab that opens it. */
const LENS_CARDS: Readonly<Record<string, readonly string[]>> = {
  'Project Management': ['Budget burn', 'Tokens per day', 'Planned tasks vs sessions', 'Hours per agent', 'The task pile as drag'],
  'Architecture': [
    'Minutes by change kind',
    'Task minutes per week',
    'Tokens by model',
    'Preflight halts',
    'Lines of code per module',
    'Module imports',
    'Package size',
    'What each package is made of',
    'Import flow by layer',
  ],
  'Development': ['Balance: shipping, failing, foundation', 'Work done, 12 weeks', 'Tasks done per week', 'Task cycle time', 'Red CI share', 'Task minutes distribution'],
  'QA': [
    'Bugs by kind per week',
    'Regressions per week',
    'Where bugs went',
    'Bug outcome by loop start',
    'Open bugs per day',
    'Resolution time by priority',
    'Flaky checks, top 10',
  ],
};

/** The balance card's title, and its subtitle on each page. */
const BALANCE_TITLE = 'Balance: shipping, failing, foundation';
const BALANCE_MOCK_SUBTITLE = 'each index divided by its twelve-week median, so the ring at 1 is as usual';
const BALANCE_LIVE_SUBTITLE = 'the 7 days to the replica\'s build over the median of the 12 weeks before, their mean when it is 0; the ring at 1 is as usual';

/** Work done's subtitle on each page: the mock's names its 12 weeks in the title, the live one reads the range. */
const WORK_DONE_MOCK_SUBTITLE = 'kind on the inner ring, the module it landed in on the outer ring';
const WORK_DONE_LIVE_SUBTITLE = 'the change entries by work type on the inner ring, the area each landed in on the outer ring, over the range';

/** A primitive that draws nothing: an image role named by the chart's label. */
function StubChart({ ariaLabel }: { readonly ariaLabel: string }): ReactElement {
  return <div role="img" aria-label={ariaLabel} />;
}

/** The radar's stub: the image, with each axis label as text, so a test reads what an axis says. */
function StubRadar({ ariaLabel, axes }: { readonly ariaLabel: string; readonly axes: readonly RadarAxis[] }): ReactElement {
  return (
    <div role="img" aria-label={ariaLabel}>
      {axes.map((axis) => <span key={axis.id}>{axis.label}</span>)}
    </div>
  );
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
  Radar: StubRadar,
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

    expect(screen.getAllByRole('region', { name: 'Loading' })).toHaveLength(4);
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

  it('draws the two bug backlog cards on the mock page, the outcome by its loop start day', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('tab', { name: 'QA' }));
    await settle();

    expect(screen.getByRole('img', { name: 'Bugs loops filed by what became of them, stacked per loop start day' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Open bugs per day, all of them and those a loop filed' })).toBeDefined();
    expect(screen.getByText('counted on the day its loop started')).toBeDefined();
  });

  it('draws the WIP tile from the seeded mock field, against its ceiling', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Development' }));
    await settle();
    const { wip } = lensResultOf('past-month').mock;

    expect(within(screen.getByRole('region', { name: 'Work in progress' })).getByText(String(wip.now))).toBeDefined();
    expect(within(screen.getByRole('region', { name: 'Work in progress' })).queryByText('not wired yet')).toBeNull();
  });
});

describe('App, by page source', () => {
  it('draws the mock page with no ?source and no source handed', () => {
    render(createElement(App, { engine: STUB_ENGINE }));

    expect(screen.getByText(/^Mock data through the card cascade/u)).toBeDefined();
  });

  it('over the live source, draws the wired Project Management cards and tiles and marks the others not wired yet', async () => {
    const { client, calls } = stubLiveClient();
    renderApp(createLiveLensSource(client));
    await settle();

    expect(calls.length).toBeGreaterThan(0);
    expect(screen.getByText(/^Live data from the Atlas API/u)).toBeDefined();
    expect(screen.getByRole('img', { name: /^Tokens per day, this period/u })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Tokens used this week against last week, no weekly target set' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Planned tasks against task sessions, per plan' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Hours of task sessions per agent over the range' })).toBeDefined();
    expect(screen.getByText('task session minutes over the range; no limit is set')).toBeDefined();
    expect(screen.queryByText('Not wired yet')).toBeNull();
    expect(screen.queryByText('not wired yet')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Plans completed this week' })).queryByText('not wired yet')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Active blockers' })).getByText('1')).toBeDefined();
  });

  it('over the live source, draws the out-of-scope tile from the answer, against the window\'s weekly average', async () => {
    renderApp(createLiveLensSource(stubLiveClient().client));
    await settle();
    const { lastWeek, average } = scopeCreepOf(STUB_SCOPE_CREEP);
    const tile = screen.getByRole('region', { name: 'Out-of-scope entries this week' });

    expect(average).not.toBe(SCOPE_CREEP_AVERAGE);
    expect(within(tile).getByText(String(lastWeek))).toBeDefined();
    expect(within(tile).getByText(`vs ${average} a week average`)).toBeDefined();
    expect(within(tile).queryByText('not wired yet')).toBeNull();
  });

  it('over the live source, draws the on-time tile as the collect empty state, naming the due date on plans', async () => {
    renderApp(createLiveLensSource(stubLiveClient().client));
    await settle();
    const tile = screen.getByRole('region', { name: 'Plans landed on their CI-green week' });

    expect(within(tile).getByText('needs a collector: needs a due date on plans')).toBeDefined();
    expect(within(tile).getByText('—')).toBeDefined();
    expect(within(tile).queryByText(formatPercent(ON_TIME_SHARE))).toBeNull();
    expect(within(tile).queryByText('not wired yet')).toBeNull();
  });

  it('over the live source, draws the task pile from the open issues, with the board\'s type labels in the legend', async () => {
    renderApp(createLiveLensSource(stubLiveClient().client));
    await settle();
    const pile = screen.getByRole('region', { name: 'The task pile as drag' });

    expect(within(pile).getByRole('img', { name: 'Pending work by kind and age as a sunburst' })).toBeDefined();
    expect(within(pile).getByText('the open issues by type label, and how long each has waited since it was opened')).toBeDefined();
    expect(within(pile).getByText('bug')).toBeDefined();
    expect(within(pile).queryByText('open bugs')).toBeNull();
  });

  it('over a replica with no GitHub data, names the --github build on the task pile', async () => {
    renderApp(createLiveLensSource(stubLiveClient({ github: false }).client));
    await settle();
    const pile = screen.getByRole('region', { name: 'The task pile as drag' });

    expect(within(pile).queryByRole('img')).toBeNull();
    expect(within(pile).getByText(GITHUB_NOT_READ)).toBeDefined();
    expect(screen.getAllByText('Not wired yet')).toHaveLength(1);
  });

  it('control: the mock page keeps the out-of-scope average, the on-time sample and the pile\'s mock kinds', async () => {
    renderApp();
    await settle();
    const scope = screen.getByRole('region', { name: 'Out-of-scope entries this week' });
    const onTime = screen.getByRole('region', { name: 'Plans landed on their CI-green week' });
    const pile = screen.getByRole('region', { name: 'The task pile as drag' });

    expect(within(scope).getByText(`vs ${SCOPE_CREEP_AVERAGE} a week average`)).toBeDefined();
    expect(within(onTime).getByText(formatPercent(ON_TIME_SHARE))).toBeDefined();
    expect(within(onTime).getByText('proxy for on-time delivery: no due dates exist')).toBeDefined();
    expect(within(onTime).queryByText(/needs a collector/u)).toBeNull();
    expect(within(pile).getByText('what is pending by kind, and how long each item has waited')).toBeDefined();
    for (const kind of PILE_KINDS) expect(within(pile).getByText(kind.label)).toBeDefined();
  });

  it('over the live source, notes the row count behind a wired card in place of the mock note', async () => {
    renderApp(createLiveLensSource(stubLiveClient().client));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Budget burn' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Info' }));

    expect(screen.getByText('2 rows behind it (pm.budget-burn).')).toBeDefined();
    expect(screen.queryByText(/^The exceeded case/u)).toBeNull();
  });

  it('over the live source, draws the Architecture cards a metric feeds, the halts over the window\'s weeks', async () => {
    renderApp(createLiveLensSource(stubLiveClient().client));
    fireEvent.click(screen.getByRole('tab', { name: 'Architecture' }));
    await settle();

    expect(screen.getByRole('img', { name: 'Median and 90th percentile task minutes per week' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Tokens per day by model, stacked' })).toBeDefined();
    expect(screen.getByRole('img', { name: /^Share of minutes by change kind/u })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Preflight halts per weekday and week' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Lines of code per module as a treemap' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Imports between modules as a network graph' })).toBeDefined();
    expect(within(screen.getByRole('region', { name: 'Preflight halts, over the range' })).getByText('3')).toBeDefined();
    expect(within(screen.getByRole('region', { name: 'Workspace members' })).getByText('3')).toBeDefined();
    expect(screen.getAllByText('Not wired yet')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Options for Preflight halts' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Source' }));
    expect(screen.getByRole('columnheader', { name: '26 Oct' })).toBeDefined();
  });

  it('over the live source, draws the Development cards a metric feeds', async () => {
    renderApp(createLiveLensSource(stubLiveClient().client));
    fireEvent.click(screen.getByRole('tab', { name: 'Development' }));
    await settle();

    expect(screen.getByRole('img', { name: 'Tasks done per week, stacked by branch type' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Task cycle minutes per task with a seven-day moving median' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Red CI share against the ten percent threshold' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Distribution of task minutes' })).toBeDefined();
    expect(screen.queryByText('Not wired yet')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Plans completed per week' })).getByText('3')).toBeDefined();
    expect(within(screen.getByRole('region', { name: 'Releases this week' })).getByText('1')).toBeDefined();
    expect(within(screen.getByRole('region', { name: 'Work in progress' })).getByText('3')).toBeDefined();
    expect(within(screen.getByRole('region', { name: 'Work in progress' })).queryByText('not wired yet')).toBeNull();
  });

  it('over the live source, draws every QA card, the two bug backlog cards included, with the kinds the answer names', async () => {
    renderApp(createLiveLensSource(stubLiveClient().client));
    fireEvent.click(screen.getByRole('tab', { name: 'QA' }));
    await settle();

    expect(screen.getByRole('img', { name: 'Bugs by kind per week, stacked' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Regressions per week' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Share of bugs by route per week' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Bugs loops filed by what became of them, stacked per loop start day' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Open bugs per day, all of them and those a loop filed' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Resolution days by priority as box plots' })).toBeDefined();
    expect(screen.getByRole('table', { name: 'Checks that failed most often across CI readings' })).toBeDefined();
    expect(screen.getByText('counted on the day its loop started')).toBeDefined();
    expect(screen.queryByText('Not wired yet')).toBeNull();
    expect(screen.queryByText('not wired yet')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Open bug issues' })).getByText('1')).toBeDefined();
    expect(within(screen.getByRole('region', { name: 'Defect density' })).getByText('1 / kLOC')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bugs by kind per week' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Source' }));
    expect(screen.getByRole('columnheader', { name: 'unknown' })).toBeDefined();
  });

  it('over a replica with no GitHub data, draws the outcome card and names the --github build on the two GitHub-only cards', async () => {
    renderApp(createLiveLensSource(stubLiveClient({ github: false }).client));
    fireEvent.click(screen.getByRole('tab', { name: 'QA' }));
    await settle();
    const openBugs = screen.getByRole('region', { name: 'Open bugs per day' });
    const resolution = screen.getByRole('region', { name: 'Resolution time by priority' });

    expect(screen.getByRole('img', { name: 'Bugs loops filed by what became of them, stacked per loop start day' })).toBeDefined();
    expect(screen.queryByRole('img', { name: 'Open bugs per day, all of them and those a loop filed' })).toBeNull();
    expect(screen.getAllByText('Not wired yet')).toHaveLength(2);
    expect(within(openBugs).getByText(GITHUB_NOT_READ)).toBeDefined();
    expect(within(resolution).getByText(GITHUB_NOT_READ)).toBeDefined();
    expect(within(openBugs).getByText((text) => text.includes(GITHUB_BUILD_LINE))).toBeDefined();
  });

  it('over a range with no flaky reading, says so on the flaky card in place of a table with no rows', async () => {
    const { client } = stubLiveClient();
    const noFlaky: AtlasClient = {
      ...client,
      runMetric: async (id, window, signal) => {
        const answer = await client.runMetric(id, window, signal);
        return id === LIVE_METRICS.flakyChecks
          ? noRowsOf(answer)
          : answer;
      },
    };
    renderApp(createLiveLensSource(noFlaky));
    fireEvent.click(screen.getByRole('tab', { name: 'QA' }));
    await settle();
    const flaky = screen.getByRole('region', { name: 'Flaky checks, top 10' });

    expect(within(flaky).getByText(NO_FLAKY_TITLE)).toBeDefined();
    expect(within(flaky).queryByRole('table')).toBeNull();
  });

  it('control: a card no live metric feeds keeps the general not-wired line, not the --github one', async () => {
    renderApp(createLiveLensSource(stubLiveClient({ github: false }).client));
    fireEvent.click(screen.getByRole('tab', { name: 'Architecture' }));
    await settle();

    expect(screen.getAllByText('Not wired yet')).toHaveLength(3);
    expect(screen.queryByText(GITHUB_NOT_READ)).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Package size' })).getByText(/^No live metric feeds this card yet/u)).toBeDefined();
  });

  it('over the live source, draws work done from the change entries, its subtitle naming the range for the mock\'s 12 weeks', async () => {
    renderApp(createLiveLensSource(stubLiveClient().client));
    fireEvent.click(screen.getByRole('tab', { name: 'Development' }));
    await settle();
    const card = screen.getByRole('region', { name: 'Work done, 12 weeks' });

    expect(within(card).getByRole('img', { name: 'Work done by kind and module as a sunburst' })).toBeDefined();
    expect(within(card).getByText(WORK_DONE_LIVE_SUBTITLE)).toBeDefined();
    expect(within(card).queryByText(WORK_DONE_MOCK_SUBTITLE)).toBeNull();
    expect(within(card).queryByText('Not wired yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Work done, 12 weeks' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Source' }));
    expect(screen.getByRole('cell', { name: 'loop' })).toBeDefined();
    expect(screen.getAllByRole('cell', { name: 'docs' })).toHaveLength(1);
  });

  it('over the live source, draws the balance radar from the live indices, an index with no event reading none in 12 weeks', async () => {
    renderApp(createLiveLensSource(stubLiveClient().client));
    fireEvent.click(screen.getByRole('tab', { name: 'Development' }));
    await settle();
    const card = screen.getByRole('region', { name: BALANCE_TITLE });
    const radar = within(card).getByRole('img', { name: /^Balance radar: 8 indices/u });

    expect(within(radar).getByText('releases')).toBeDefined();
    expect(within(radar).getByText(`regression share: ${NONE_IN_12_WEEKS}`)).toBeDefined();
    expect(within(card).getByText(BALANCE_LIVE_SUBTITLE)).toBeDefined();
    expect(within(card).queryByText('Not wired yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Options for ${BALANCE_TITLE}` }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Source' }));
    expect(screen.getByRole('cell', { name: '2.00×' })).toBeDefined();
    expect(screen.getAllByRole('cell', { name: NONE_IN_12_WEEKS })).toHaveLength(BALANCE_CATALOGUE.length - 1);
  });

  it('control: the mock page keeps work done\'s mock subtitle and the balance radar\'s catalogue values, no axis reading none', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Development' }));
    await settle();
    const work = screen.getByRole('region', { name: 'Work done, 12 weeks' });
    const balance = screen.getByRole('region', { name: BALANCE_TITLE });

    expect(within(work).getByText(WORK_DONE_MOCK_SUBTITLE)).toBeDefined();
    expect(within(work).queryByText(WORK_DONE_LIVE_SUBTITLE)).toBeNull();
    expect(within(balance).getByText(BALANCE_MOCK_SUBTITLE)).toBeDefined();
    expect(within(balance).queryByText(new RegExp(NONE_IN_12_WEEKS, 'u'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Options for ${BALANCE_TITLE}` }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Source' }));
    const releases = lensResultOf('past-month').balance.find((index) => index.id === 'releases');
    expect(screen.getByRole('cell', { name: `${releases?.value.toFixed(2)}×` })).toBeDefined();
  });
});
