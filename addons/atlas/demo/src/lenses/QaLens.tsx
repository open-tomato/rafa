import type { LensResult } from '../data/source.js';

import { DashboardCard, DataTable, useDashboard } from '@open-tomato/atlas-ui';
import { formatDay, formatPercent, useChartEngine } from '@open-tomato/charts';
import { type ReactElement } from 'react';

import { BUG_KINDS, DEFECT_DENSITY, OPEN_BUGS, ROUTES, WEEK_DATES, type MockData } from '../data/mock.js';
import { LensGrid } from '../templates/LensGrid.js';

import { LensStat } from './LensStat.js';
import { LoadingTiles } from './LoadingTiles.js';
import { cardSpec, plotHeight } from './spec.js';

/** The four-week average of bugs the hero tile compares against. */
const BUGS_AVERAGE = 19;

const BUGS = cardSpec({ id: 'qa-bugs-by-kind', title: 'Bugs by kind per week', primitive: 'BarChart' });

const REGRESSIONS = cardSpec({ id: 'qa-regressions', title: 'Regressions per week', subtitle: 'own-fallout routes', primitive: 'LineChart' });

const ROUTED = cardSpec({ id: 'qa-bug-routes', title: 'Where bugs went', subtitle: 'share per week', primitive: 'BarChart' });

const RESOLUTION = cardSpec({
  id: 'qa-resolution-time',
  title: 'Resolution time by priority',
  subtitle: 'days from opened to closed',
  primitive: 'BoxPlot',
  note: 'a gap chart: the box plot needs the engine; the dates need one gh read.',
});

const FLAKY = cardSpec({
  id: 'qa-flaky-checks',
  title: 'Flaky checks, top 10',
  subtitle: 'checks that failed most often across CI readings',
  primitive: 'DataTable',
  span: 'two',
});

function sumOf(row: Readonly<Record<string, number>>): number {
  return Object.values(row).reduce((sum, value) => sum + value, 0);
}

function QaTiles({ mock }: { readonly mock: MockData }): ReactElement {
  const totals = mock.bugsByKindPerWeek.map(sumOf);
  const bugsLastWeek = totals.at(-1) ?? 0;
  return (
    <>
      <LensStat hero label="Bugs recorded this week" value={String(bugsLastWeek)} trend={totals} delta={{ text: `vs ${BUGS_AVERAGE} four-week average`, direction: bugsLastWeek > BUGS_AVERAGE
        ? 'up'
        : 'down', upIsGood: false }} />
      <LensStat label="Regressions (own-fallout) this week" value={String(mock.bugsByKindPerWeek.at(-1)?.['own-fallout'] ?? 0)} trend={mock.regressionsPerWeek.map((point) => point.y)} />
      <LensStat label="Open bug issues" value={String(OPEN_BUGS)} />
      <LensStat label="Defect density" value={`${DEFECT_DENSITY} / kLOC`} note="bugs attributed to modules by the paths their text names" />
    </>
  );
}

/** A per-week table of kinds: the week, then one column per kind. */
function weeklyTable(rows: readonly Readonly<Record<string, number>>[], kinds: readonly { id: string; label: string }[]): { columns: string[]; rows: (string | number)[][] } {
  return {
    columns: ['Week', ...kinds.map((kind) => kind.label)],
    rows: rows.map((row, index) => [formatDay(WEEK_DATES[index] ?? new Date(0)), ...kinds.map((kind) => row[kind.id] ?? 0)]),
  };
}

/** The QA lens: defects, regressions, resolution and flaky checks. */
export function QaLens(): ReactElement {
  const { BarChart, LineChart, BoxPlot } = useChartEngine();
  const { data } = useDashboard<LensResult>();

  return (
    <LensGrid
      tiles={data === undefined
        ? <LoadingTiles count={4} />
        : <QaTiles mock={data.mock} />}
      cards={(
        <>
          <DashboardCard config={BUGS} select={(result: LensResult) => result.mock.bugsByKindPerWeek} legend={BUG_KINDS} table={(rows) => weeklyTable(rows, BUG_KINDS)}>
            {({ data: rows, animate, height }) => (
              <BarChart
                ariaLabel="Bugs by kind per week, stacked"
                categories={WEEK_DATES.map(formatDay)}
                series={BUG_KINDS.map((kind) => ({ ...kind, values: rows.map((row) => row[kind.id] ?? 0) }))}
                mode="stacked"
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </DashboardCard>
          <DashboardCard
            config={REGRESSIONS}
            select={(result: LensResult) => result.mock.regressionsPerWeek}
            table={(points) => ({ columns: ['Week', 'Regressions'], rows: points.map((point) => [formatDay(point.x), point.y]) })}
          >
            {({ data: points, animate, height }) => (
              <LineChart
                ariaLabel="Regressions per week"
                series={[{ id: 'regressions', label: 'Regressions', tone: 'series-2', points }]}
                xFormat={formatDay}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </DashboardCard>
          <DashboardCard config={ROUTED} select={(result: LensResult) => result.mock.filedSharePerWeek} legend={ROUTES} table={(rows) => weeklyTable(rows, ROUTES)}>
            {({ data: rows, animate, height }) => (
              <BarChart
                ariaLabel="Share of bugs by route per week"
                categories={WEEK_DATES.map(formatDay)}
                series={ROUTES.map((route) => ({ ...route, values: rows.map((row) => row[route.id] ?? 0) }))}
                mode="stacked100"
                valueFormat={formatPercent}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </DashboardCard>
          <DashboardCard
            config={RESOLUTION}
            select={(result: LensResult) => result.mock.resolutionByPriority}
            table={(groups) => ({ columns: ['Priority', 'min', 'q1', 'median', 'q3', 'max'], rows: groups.map((group) => [group.label, group.min, group.q1, group.median, group.q3, group.max]) })}
          >
            {({ data: groups, animate, height }) => (
              <BoxPlot ariaLabel="Resolution days by priority as box plots" groups={groups} unit="days" animate={animate} height={plotHeight(220, height)} />
            )}
          </DashboardCard>
          <DashboardCard config={FLAKY} select={(result: LensResult) => result.mock.flakyChecks}>
            {({ data: checks }) => (
              <DataTable
                caption="Checks that failed most often across CI readings"
                columns={['Check', 'Failures', 'Readings', 'Failure share']}
                rows={checks.map((check) => [check.name, check.failures, check.readings, formatPercent(check.failures / check.readings)])}
                sortable
              />
            )}
          </DashboardCard>
        </>
      )}
    />
  );
}
