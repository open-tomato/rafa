import type { LensResult } from '../data/source.js';

import { useDashboard, type LegendItem } from '@open-tomato/atlas-ui';
import { formatDay, formatPercent, useChartEngine } from '@open-tomato/charts';
import { type ReactElement } from 'react';

import { BRANCH_TYPES, RED_CI_THRESHOLD, WORK_KINDS, WORK_TONES } from '../data/mock.js';
import { LensGrid } from '../templates/LensGrid.js';

import { BalanceCard } from './balance/BalanceCard.js';
import { LensCard } from './LensCard.js';
import { LensStat } from './LensStat.js';
import { LoadingTiles } from './LoadingTiles.js';
import { cardSpec, plotHeight } from './spec.js';

/** The four-week average of tasks done the hero tile compares against. */
const TASKS_AVERAGE = 31;

/** How many recent cycle points the source table lists. */
const CYCLE_TABLE_ROWS = 12;

const WORK_DONE = cardSpec({
  id: 'dev-work-done',
  title: 'Work done, 12 weeks',
  subtitle: 'kind on the inner ring, the module it landed in on the outer ring',
  primitive: 'Sunburst',
});

const TASKS_DONE = cardSpec({
  id: 'dev-tasks-done',
  title: 'Tasks done per week',
  subtitle: 'by branch type',
  primitive: 'BarChart',
});

const CYCLE = cardSpec({
  id: 'dev-cycle-time',
  title: 'Task cycle time',
  subtitle: 'dispatch to report, minutes, last 4 weeks',
  primitive: 'ScatterChart',
});

const RED_CI = cardSpec({
  id: 'dev-red-ci',
  title: 'Red CI share',
  subtitle: 'red readings over all readings, 12 weeks',
  primitive: 'Bullet',
});

const MINUTES = cardSpec({
  id: 'dev-task-minutes',
  title: 'Task minutes distribution',
  subtitle: '400 task sessions, 12 weeks',
  primitive: 'Histogram',
});

const WORK_LEGEND: readonly LegendItem[] = WORK_KINDS.map(({ id, label, tone }) => ({ id, label, tone }));
const CYCLE_LEGEND: readonly LegendItem[] = [
  { id: 'tasks', label: 'Task', tone: 'series-1' },
  { id: 'trend', label: '7-day median', tone: 'series-2' },
];

type BranchType = 'feature' | 'fix' | 'chore';

function DeveloperTiles({ result }: { readonly result: LensResult }): ReactElement {
  const { mock } = result;
  const totals = mock.tasksDonePerWeek.map((week) => week.feature + week.fix + week.chore);
  const doneLastWeek = totals.at(-1) ?? 0;
  return (
    <>
      <LensStat
        hero
        label="Tasks done this week"
        reads={['tasksDonePerWeek']}
        value={String(doneLastWeek)}
        trend={totals}
        delta={result.source === 'mock'
          ? { text: `vs ${TASKS_AVERAGE} four-week average`, direction: doneLastWeek > TASKS_AVERAGE
            ? 'up'
            : 'down' }
          : undefined}
      />
      <LensStat label="Plans completed per week" reads={['plansCompletedPerWeek']} value={String(mock.plansCompletedPerWeek.at(-1)?.y ?? 0)} trend={mock.plansCompletedPerWeek.map((point) => point.y)} />
      <LensStat label="Releases this week" reads={['deploysPerWeek']} value={String(mock.deploysPerWeek.at(-1) ?? 0)} trend={mock.deploysPerWeek} note="v* release tags on the base branch, from the git log" />
      <LensStat label="Work in progress" reads={['wip']} value={mock.wip.now} goal={mock.wip.limit ?? undefined} note="open issues in Claimed or In development" />
    </>
  );
}

/** The Development lens: balance, work done, cycle time and task minutes. */
export function DeveloperLens(): ReactElement {
  const { BarChart, ScatterChart, Bullet, Histogram, Sunburst } = useChartEngine();
  const { data } = useDashboard<LensResult>();

  return (
    <LensGrid
      tiles={data === undefined
        ? <LoadingTiles count={4} />
        : <DeveloperTiles result={data} />}
      cards={(
        <>
          <BalanceCard />
          <LensCard
            config={WORK_DONE}
            select={(result: LensResult) => result.mock.workDoneTree}
            legend={WORK_LEGEND}
            table={(tree) => ({ columns: ['Kind', 'Module', 'Items'], rows: tree.flatMap((kind) => kind.children.map((child) => [kind.label, child.label, child.value])) })}
          >
            {({ data: tree, animate, height }) => (
              <Sunburst ariaLabel="Work done by kind and module as a sunburst" nodes={tree} groupTones={WORK_TONES} unit="items" animate={animate} height={plotHeight(300, height)} />
            )}
          </LensCard>
          <LensCard
            config={TASKS_DONE}
            reads={['tasksDonePerWeek']}
            liveSubtitle="by work type, read from each task's change level"
            select={(result: LensResult) => result.mock.tasksDonePerWeek}
            legend={BRANCH_TYPES}
            table={(rows) => ({ columns: ['Week', 'feature', 'fix', 'chore'], rows: rows.map((row) => [formatDay(row.week), row.feature, row.fix, row.chore]) })}
          >
            {({ data: rows, animate, height }) => (
              <BarChart
                ariaLabel="Tasks done per week, stacked by branch type"
                categories={rows.map((row) => formatDay(row.week))}
                series={BRANCH_TYPES.map((type) => ({ ...type, values: rows.map((row) => row[type.id as BranchType]) }))}
                mode="stacked"
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={CYCLE}
            reads={['taskCycle', 'taskCycleTrend']}
            liveSubtitle="dispatch to report, minutes, over the range"
            select={(result: LensResult) => result.mock}
            legend={CYCLE_LEGEND}
            table={(mock) => ({ columns: ['Task', 'Day', 'Minutes'], rows: mock.taskCycle.slice(-CYCLE_TABLE_ROWS).map((point) => [point.label, formatDay(point.x), point.y]) })}
          >
            {({ data: mock, animate, height }) => (
              <ScatterChart
                ariaLabel="Task cycle minutes per task with a seven-day moving median"
                points={mock.taskCycle}
                trend={mock.taskCycleTrend}
                pointsLabel="Task"
                valueFormat={(value) => `${value} min`}
                trendLabel="7-day median"
                yLabel="minutes"
                xFormat={formatDay}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={RED_CI}
            reads={['redCiShare']}
            liveSubtitle="red readings over all readings, over the range"
            select={(result: LensResult) => result.mock.redCiShare}
            table={(share) => ({ columns: ['Measure', 'Share'], rows: [['Red CI share', formatPercent(share)], ['Threshold', formatPercent(RED_CI_THRESHOLD)]] })}
          >
            {({ data: share, animate, height }) => (
              <Bullet
                ariaLabel="Red CI share against the ten percent threshold"
                value={share}
                target={RED_CI_THRESHOLD}
                max={0.3}
                ranges={[0.1, 0.2]}
                label="red CI share"
                higherIsBetter={false}
                valueFormat={formatPercent}
                animate={animate}
                height={plotHeight(120, height)}
              />
            )}
          </LensCard>
          <LensCard
            config={MINUTES}
            reads={['taskMinutesBins']}
            liveSubtitle="task sessions over the range, by the minutes each ran"
            select={(result: LensResult) => result.mock.taskMinutesBins}
            table={(bins) => ({ columns: ['Minutes', 'Tasks'], rows: bins.map((bin) => [`${bin.from}–${bin.to}`, bin.count]) })}
          >
            {({ data: bins, animate, height }) => (
              <Histogram ariaLabel="Distribution of task minutes" bins={bins} unit="min" animate={animate} height={plotHeight(220, height)} />
            )}
          </LensCard>
        </>
      )}
    />
  );
}
