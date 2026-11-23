import type { LensResult } from '../data/source.js';

import { DataTable, useDashboard } from '@open-tomato/atlas-ui';
import { formatDay, formatPercent, useChartEngine } from '@open-tomato/charts';
import { type ReactElement } from 'react';

import { BUG_KINDS, DEFECT_DENSITY, OPEN_BUG_LINES, OPEN_BUGS, OUTCOMES, ROUTES, type BugOutcomeDay, type Kind } from '../data/mock.js';
import { LensGrid } from '../templates/LensGrid.js';

import { kindsOf } from './kinds.js';
import { LensCard } from './LensCard.js';
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
  note: 'the open and close dates come from GitHub: only a build run with --github reads them.',
});

const OUTCOME = cardSpec({
  id: 'qa-bug-outcome',
  title: 'Bug outcome by loop start',
  subtitle: 'counted on the day its loop started',
  primitive: 'BarChart',
  note: 'a view of where bugs come from, not a burndown: each bug counts on its loop\'s start day, whatever became of it. Open bugs per day is the backlog.',
});

const OPEN_BUGS_PER_DAY = cardSpec({
  id: 'qa-open-bugs',
  title: 'Open bugs per day',
  subtitle: 'open at the end of each day: all of them, and those a loop filed',
  primitive: 'LineChart',
});

/** The outcomes stacked on the outcome card, by the key a day holds each under. */
type Outcome = keyof Omit<BugOutcomeDay, 'day'>;

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

function QaTiles({ result }: { readonly result: LensResult }): ReactElement {
  const { mock } = result;
  const totals = mock.bugsByKindPerWeek.map(sumOf);
  const bugsLastWeek = totals.at(-1) ?? 0;
  return (
    <>
      <LensStat
        hero
        label="Bugs recorded this week"
        reads={['bugsByKindPerWeek']}
        value={String(bugsLastWeek)}
        trend={totals}
        delta={result.source === 'mock'
          ? { text: `vs ${BUGS_AVERAGE} four-week average`, direction: bugsLastWeek > BUGS_AVERAGE
            ? 'up'
            : 'down', upIsGood: false }
          : undefined}
      />
      <LensStat label="Regressions (own-fallout) this week" reads={['regressionsPerWeek']} value={String(mock.regressionsPerWeek.at(-1)?.y ?? 0)} trend={mock.regressionsPerWeek.map((point) => point.y)} />
      <LensStat label="Open bug issues" value={String(OPEN_BUGS)} />
      <LensStat label="Defect density" value={`${DEFECT_DENSITY} / kLOC`} note="bugs attributed to modules by the paths their text names" />
    </>
  );
}

/** One weekly stacked card's slice: an entry per week of `weeks`, and the kinds its rows name. */
interface WeeklyKinds {
  readonly weeks: readonly Date[];
  readonly rows: readonly Readonly<Record<string, number>>[];
  readonly kinds: readonly Kind[];
}

/** The slice of a weekly stacked card: the result's weeks, `rows`, and their kinds from `known`. */
function weeklyKindsOf(result: LensResult, rows: readonly Readonly<Record<string, number>>[], known: readonly Kind[]): WeeklyKinds {
  return { weeks: result.weeks, rows, kinds: kindsOf(rows, known) };
}

/** A per-week table of kinds: the week, then one column per kind. */
function weeklyTable({ weeks, rows, kinds }: WeeklyKinds): { columns: string[]; rows: (string | number)[][] } {
  return {
    columns: ['Week', ...kinds.map((kind) => kind.label)],
    rows: rows.map((row, index) => [formatDay(weeks[index] ?? new Date(0)), ...kinds.map((kind) => row[kind.id] ?? 0)]),
  };
}

/** The legend of a weekly stacked card: its kinds. */
function weeklyLegend({ kinds }: WeeklyKinds): Kind[] {
  return kinds.map(({ id, label, tone }) => ({ id, label, tone }));
}

/** The QA lens: defects, regressions, the bug backlog pair, resolution and flaky checks. */
export function QaLens(): ReactElement {
  const { BarChart, LineChart, BoxPlot } = useChartEngine();
  const { data } = useDashboard<LensResult>();

  return (
    <LensGrid
      tiles={data === undefined
        ? <LoadingTiles count={4} />
        : <QaTiles result={data} />}
      cards={(
        <>
          <LensCard
            config={BUGS}
            reads={['bugsByKindPerWeek']}
            select={(result: LensResult) => weeklyKindsOf(result, result.mock.bugsByKindPerWeek, BUG_KINDS)}
            legend={weeklyLegend}
            table={weeklyTable}
          >
            {({ data: { weeks, rows, kinds }, animate, height }) => (
              <BarChart
                ariaLabel="Bugs by kind per week, stacked"
                categories={weeks.map(formatDay)}
                series={kinds.map((kind) => ({ ...kind, values: rows.map((row) => row[kind.id] ?? 0) }))}
                mode="stacked"
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={REGRESSIONS}
            reads={['regressionsPerWeek']}
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
          </LensCard>
          <LensCard
            config={ROUTED}
            reads={['filedSharePerWeek']}
            select={(result: LensResult) => weeklyKindsOf(result, result.mock.filedSharePerWeek, ROUTES)}
            legend={weeklyLegend}
            table={weeklyTable}
          >
            {({ data: { weeks, rows, kinds }, animate, height }) => (
              <BarChart
                ariaLabel="Share of bugs by route per week"
                categories={weeks.map(formatDay)}
                series={kinds.map((route) => ({ ...route, values: rows.map((row) => row[route.id] ?? 0) }))}
                mode="stacked100"
                valueFormat={formatPercent}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={OUTCOME}
            reads={['bugOutcomeByLoopStart']}
            select={(result: LensResult) => result.mock.bugOutcomeByLoopStart}
            legend={OUTCOMES}
            table={(days) => ({ columns: ['Loop start', ...OUTCOMES.map((outcome) => outcome.label)], rows: days.map((day) => [formatDay(day.day), day.fixed, day.dropped, day.open]) })}
          >
            {({ data: days, animate, height }) => (
              <BarChart
                ariaLabel="Bugs loops filed by what became of them, stacked per loop start day"
                categories={days.map((day) => formatDay(day.day))}
                series={OUTCOMES.map((outcome) => ({ ...outcome, values: days.map((day) => day[outcome.id as Outcome]) }))}
                mode="stacked"
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={OPEN_BUGS_PER_DAY}
            reads={['openBugsPerDay']}
            select={(result: LensResult) => result.mock.openBugsPerDay}
            legend={OPEN_BUG_LINES}
            table={(days) => ({ columns: ['Day', ...OPEN_BUG_LINES.map((line) => line.label)], rows: days.map((day) => [formatDay(day.day), day.all, day.fromLoops]) })}
          >
            {({ data: days, animate, height }) => (
              <LineChart
                ariaLabel="Open bugs per day, all of them and those a loop filed"
                series={OPEN_BUG_LINES.map((line) => ({ ...line, points: days.map((day) => ({ x: day.day, y: line.id === 'all'
                  ? day.all
                  : day.fromLoops })) }))}
                xFormat={formatDay}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={RESOLUTION}
            reads={['resolutionByPriority']}
            liveSubtitle="days from opened to closed, per bug closed as completed"
            select={(result: LensResult) => result.mock.resolutionByPriority}
            table={(groups) => ({ columns: ['Priority', 'min', 'q1', 'median', 'q3', 'max'], rows: groups.map((group) => [group.label, group.min, group.q1, group.median, group.q3, group.max]) })}
          >
            {({ data: groups, animate, height }) => (
              <BoxPlot ariaLabel="Resolution days by priority as box plots" groups={groups} unit="days" animate={animate} height={plotHeight(220, height)} />
            )}
          </LensCard>
          <LensCard
            config={FLAKY}
            reads={['flakyChecks']}
            liveSubtitle="checks failing on heads that later read green; readings counts those heads"
            select={(result: LensResult) => result.mock.flakyChecks}>
            {({ data: checks }) => (
              <DataTable
                caption="Checks that failed most often across CI readings"
                columns={['Check', 'Failures', 'Readings', 'Failure share']}
                rows={checks.map((check) => [check.name, check.failures, check.readings, formatPercent(check.failures / check.readings)])}
                sortable
              />
            )}
          </LensCard>
        </>
      )}
    />
  );
}
