import type { LensField, LensResult } from '../data/source.js';

import { useDashboard, type LegendItem } from '@open-tomato/atlas-ui';
import { formatCompact, formatDay, formatMinutes, formatPercent, useChartEngine, type LineSeries } from '@open-tomato/charts';
import { useState, type ReactElement } from 'react';

import { PILE_KINDS, PILE_TONES, WEEKLY_TOKEN_BUDGET_TIGHT, WIP_LIMIT_MINUTES, ON_TIME_SHARE, type MockData } from '../data/mock.js';
import { LensGrid } from '../templates/LensGrid.js';

import { LensCard } from './LensCard.js';
import { LensStat } from './LensStat.js';
import { LoadingTiles } from './LoadingTiles.js';
import { zoomFooterVariants } from './ProjectManagerLens.variants.js';
import { cardSpec, plotHeight } from './spec.js';

/** The four-week average completion share the hero tile compares against. */
const COMPLETION_AVERAGE = 0.71;

/** The page-wide scope-creep average the tile compares against. */
const SCOPE_CREEP_AVERAGE = 18;

/** Minutes in an hour, and the tenths the agent hours keep. */
const MINUTES_PER_HOUR = 60;

const BUDGET = cardSpec({
  id: 'pm-budget-burn',
  title: 'Budget burn',
  subtitle: 'tokens this week against the weekly allowance, with last week on the inner arc',
  primitive: 'Gauge',
  note: 'The exceeded case: this week\'s spend is over the allowance, so the arc fills critical, the text gives the true share and the marker shows where the limit sits.',
});

const TOKENS = cardSpec({
  id: 'pm-tokens-per-day',
  title: 'Tokens per day',
  subtitle: 'this period against the previous one; drag the selector under the plot to zoom',
  primitive: 'LineChart',
  legend: { mark: 'line', toggleable: true },
});

const PLANNED = cardSpec({
  id: 'pm-planned-vs-sessions',
  title: 'Planned tasks vs sessions',
  subtitle: 'per plan; sessions above the plan are rework',
  primitive: 'BarChart',
});

const AGENT_HOURS = cardSpec({
  id: 'pm-hours-per-agent',
  title: 'Hours per agent this week',
  subtitle: 'against the 15-hour limit',
  primitive: 'BarChart',
});

const PILE = cardSpec({
  id: 'pm-task-pile',
  title: 'The task pile as drag',
  subtitle: 'what is pending by kind, and how long each item has waited',
  primitive: 'Sunburst',
  span: 'two',
  note: 'the outer ring is age: the older the slice, the more drag it adds; open bugs over four weeks are the ones to look at first.',
  maximise: { size: 'large', legend: 'always' },
});

/** What the budget card says on the live page, where no weekly target is read yet. */
const NO_TARGET = 'no target set';

/** The budget the gauge reads against: the mock's allowance, or on the live page none. */
interface BudgetView {
  readonly mock: MockData;
  /** The weekly allowance; null on the live page, which reads no target yet. */
  readonly target: number | null;
}

/** The budget card's slice of `result`. */
function budgetOf(result: LensResult): BudgetView {
  return {
    mock: result.mock,
    target: result.source === 'mock'
      ? WEEKLY_TOKEN_BUDGET_TIGHT
      : null,
  };
}

/** The budget table: the two weeks' spend and the target, or "no target set". */
function budgetTable({ mock, target }: BudgetView): { columns: string[]; rows: string[][] } {
  return {
    columns: ['Measure', 'Tokens'],
    rows: [['Used this week', formatCompact(mock.tokensThisWeek)], ['Used last week', formatCompact(mock.tokensLastWeek)], ['Weekly budget', target === null
      ? NO_TARGET
      : formatCompact(target)]],
  };
}

const PLANNED_LEGEND: readonly LegendItem[] = [
  { id: 'planned', label: 'Planned tasks', tone: 'series-1' },
  { id: 'sessions', label: 'Task sessions', tone: 'series-2' },
];

const PILE_LEGEND: readonly LegendItem[] = PILE_KINDS.map(({ id, label, tone }) => ({ id, label, tone }));

/** The two token series: this period and the one before. */
function tokenSeries(mock: MockData): LineSeries[] {
  return [
    { id: 'current', label: 'This period', tone: 'series-1', points: mock.tokensPerDay },
    { id: 'previous', label: 'Previous 12 weeks', tone: 'series-2', points: mock.tokensPerDayPrevious },
  ];
}

/** The fields the tokens card reads, all three filled by `pm.tokens-per-day` on the live page. */
const TOKEN_FIELDS: readonly LensField[] = ['tokensPerDay', 'tokensPerDayPrevious', 'tokensDailyAverage'];

/** How many days the tokens table lists, the latest last. */
const TOKEN_TABLE_DAYS = 12;

/** The tokens table: the latest days, each beside the previous period's value drawn on the same day. */
function tokenTable(mock: MockData): { columns: string[]; rows: string[][] } {
  const previous = new Map(mock.tokensPerDayPrevious.map((point) => [point.x.getTime(), point.y]));
  return {
    columns: ['Day', 'This period', 'Previous'],
    rows: mock.tokensPerDay.slice(-TOKEN_TABLE_DAYS).map((point) => [formatDay(point.x), formatCompact(point.y), formatCompact(previous.get(point.x.getTime()) ?? 0)]),
  };
}

const TOKEN_LEGEND: readonly LegendItem[] = [
  { id: 'current', label: 'This period', tone: 'series-1' },
  { id: 'previous', label: 'Previous 12 weeks', tone: 'series-2' },
];

/** A week's completed plans over its started ones; 0 for a week that started none. */
function completionOf(week: { readonly started: number; readonly completed: number }): number {
  return week.started > 0
    ? week.completed / week.started
    : 0;
}

function ProjectTiles({ result }: { readonly result: LensResult }): ReactElement {
  const { mock } = result;
  const onMock = result.source === 'mock';
  const lastWeek = mock.plansPerWeek.at(-1) ?? { started: 1, completed: 0 };
  const completion = completionOf(lastWeek);
  return (
    <>
      <LensStat
        hero
        label="Plans completed this week"
        reads={['plansPerWeek']}
        value={lastWeek.completed}
        goal={lastWeek.started}
        delta={onMock
          ? { text: `${formatPercent(completion)} completion, vs 71% four-week average`, direction: completion > COMPLETION_AVERAGE
            ? 'up'
            : 'down' }
          : { text: `${formatPercent(completion)} completion`, direction: 'flat' }}
        trend={mock.plansPerWeek.map(completionOf)}
      />
      <LensStat
        label="Active blockers"
        reads={['activeBlockers']}
        value={String(mock.activeBlockers.length)}
        delta={onMock
          ? { text: '1 fewer than last week', direction: 'down', upIsGood: false }
          : undefined}
      />
      <LensStat label="Out-of-scope entries this week" value={String(mock.scopeCreepPerWeek.at(-1) ?? 0)} trend={mock.scopeCreepPerWeek} delta={{ text: `vs ${SCOPE_CREEP_AVERAGE} a week average`, direction: 'up', upIsGood: false }} />
      <LensStat label="Plans landed on their CI-green week" value={formatPercent(ON_TIME_SHARE)} note="proxy for on-time delivery: no due dates exist" />
    </>
  );
}

/** The Project Management lens: budget, throughput, plans landed and the task pile. */
export function ProjectManagerLens(): ReactElement {
  const { Gauge, LineChart, BarChart, Sunburst } = useChartEngine();
  const { data } = useDashboard<LensResult>();
  const [zoomRange, setZoomRange] = useState<{ from: Date; to: Date } | null>(null);
  const zoomed = zoomRange === null
    ? 'the whole period'
    : `${formatDay(zoomRange.from)} to ${formatDay(zoomRange.to)}`;

  return (
    <LensGrid
      tiles={data === undefined
        ? <LoadingTiles count={4} />
        : <ProjectTiles result={data} />}
      cards={(
        <>
          <LensCard
            config={BUDGET}
            reads={['tokensThisWeek', 'tokensLastWeek']}
            liveSubtitle="tokens this week against last week; no weekly target is set yet"
            select={budgetOf}
            table={budgetTable}
          >
            {({ data: { mock, target }, animate, height }) => (
              <Gauge
                ariaLabel={target === null
                  ? 'Tokens used this week against last week, no weekly target set'
                  : 'Tokens used this week against the weekly budget, exceeded, with last week as a comparison'}
                value={mock.tokensThisWeek}
                max={target ?? Math.max(mock.tokensThisWeek, mock.tokensLastWeek, 1)}
                label={target === null
                  ? NO_TARGET
                  : 'of weekly budget'}
                thresholds={{ warning: 0.8, critical: 1 }}
                compare={{ value: mock.tokensLastWeek, label: 'last week' }}
                valueFormat={formatCompact}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={TOKENS}
            reads={TOKEN_FIELDS}
            select={(result: LensResult) => result.mock}
            legend={TOKEN_LEGEND}
            footer={<p className={zoomFooterVariants()}>Showing {zoomed}.</p>}
            table={tokenTable}
          >
            {({ data: mock, hidden, animate, height }) => (
              <LineChart
                ariaLabel="Tokens per day, this period against the previous twelve weeks, with a range selector"
                series={tokenSeries(mock).filter((series) => !hidden.has(series.id))}
                baseline={{ value: mock.tokensDailyAverage, label: `avg ${formatCompact(mock.tokensDailyAverage)}` }}
                zoom
                onRangeChange={setZoomRange}
                valueFormat={formatCompact}
                xFormat={formatDay}
                animate={animate}
                height={plotHeight(260, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={PLANNED}
            reads={['plannedVsSessions']}
            select={(result: LensResult) => result.mock.plannedVsSessions}
            legend={PLANNED_LEGEND}
            table={(rows) => ({ columns: ['Plan', 'Planned', 'Sessions'], rows: rows.map((row) => [row.plan, row.planned, row.sessions]) })}
          >
            {({ data: rows, animate, height }) => (
              <BarChart
                ariaLabel="Planned tasks against task sessions, per plan"
                categories={rows.map((row) => row.plan)}
                series={[
                  { id: 'planned', label: 'Planned tasks', tone: 'series-1', values: rows.map((row) => row.planned) },
                  { id: 'sessions', label: 'Task sessions', tone: 'series-2', values: rows.map((row) => row.sessions) },
                ]}
                mode="grouped"
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={AGENT_HOURS}
            select={(result: LensResult) => result.mock.minutesPerAgent}
            table={(rows) => ({ columns: ['Agent', 'Minutes'], rows: rows.map((row) => [row.agent, formatMinutes(row.minutes)]) })}
          >
            {({ data: rows, animate, height }) => (
              <BarChart
                ariaLabel="Hours per agent this week with the limit as a line"
                categories={rows.map((row) => row.agent)}
                series={[{ id: 'hours', label: 'Hours', tone: 'series-1', values: rows.map((row) => Math.round(row.minutes / 6) / 10) }]}
                orientation="horizontal"
                limit={{ value: WIP_LIMIT_MINUTES / MINUTES_PER_HOUR, label: 'limit 15 h' }}
                valueFormat={(value) => `${value} h`}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={PILE}
            select={(result: LensResult) => result.mock.taskPileTree}
            legend={PILE_LEGEND}
            table={(tree) => ({ columns: ['Kind', 'Waiting', 'Items'], rows: tree.flatMap((kind) => kind.children.map((child) => [kind.label, child.label, child.value])) })}
          >
            {({ data: tree, animate, height }) => (
              <Sunburst ariaLabel="Pending work by kind and age as a sunburst" nodes={tree} groupTones={PILE_TONES} unit="items" animate={animate} height={plotHeight(300, height)} />
            )}
          </LensCard>
        </>
      )}
    />
  );
}
