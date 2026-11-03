import type { LensResult } from '../data/source.js';

import { Button, DashboardCard, DataTable, Dialog, SourceView, StatTile, useDashboard, type LegendItem } from '@open-tomato/atlas-ui';
import { formatCompact, formatDay, formatPercent, useChartEngine, type HeatmapCell } from '@open-tomato/charts';
import { useState, type ReactElement } from 'react';

import { COMPONENT_KINDS, COMPONENT_TONES, COMPOSITION_TONES, SIZE_ROSE_TONES } from '../data/composition.js';
import { LAYER_ORDER, LAYER_TONES } from '../data/graph.js';
import {
  CHANGE_LEVELS,
  DAYS,
  HOUR_SLOTS,
  LAST_DAY,
  MODELS,
  WEEK_DATES,
  WEEKDAYS,
  preflightHaltDetails,
  preflightHaltsByHour,
  type MockData,
} from '../data/mock.js';
import { LensGrid } from '../templates/LensGrid.js';

import { lensActionsVariants, lensInfoVariants, lensNoteVariants } from './ArchitectLens.variants.js';
import { LoadingTiles } from './LoadingTiles.js';
import { MEASURED_SOURCE, cardSpec, plotHeight } from './spec.js';

/** Debt ratios under these bounds grade A, then B; the rest C. */
const GRADE_A_BELOW = 0.3;
const GRADE_B_BELOW = 0.45;

/** The four-week p90 average the tile compares against. */
const P90_AVERAGE = 58;

/** How many rows the import-flow source table shows. */
const SANKEY_TABLE_LIMIT = 16;

const GRAPH_SOURCE = 'The workspace members and their dependencies, read from each package.json on 2026-11-02 (src/data/graph.ts).';

function gradeOf(debtRatio: number): string {
  if (debtRatio < GRADE_A_BELOW) return 'A';
  return debtRatio < GRADE_B_BELOW
    ? 'B'
    : 'C';
}

const DONUT = cardSpec({
  id: 'arch-minutes-by-kind',
  title: 'Minutes by change kind',
  subtitle: 'last 12 weeks, with the previous 12 on the inner ring',
  primitive: 'Donut',
});

const QUANTILES = cardSpec({
  id: 'arch-task-minutes',
  title: 'Task minutes per week',
  subtitle: 'median and 90th percentile, one axis',
  primitive: 'LineChart',
  legend: { mark: 'line' },
});

const MODEL_TOKENS = cardSpec({
  id: 'arch-tokens-by-model',
  title: 'Tokens by model',
  subtitle: 'per day, stacked',
  primitive: 'LineChart',
  legend: { toggleable: true },
});

const HALTS = cardSpec({
  id: 'arch-preflight-halts',
  title: 'Preflight halts',
  subtitle: 'per weekday and week; click a cell for the checks behind it',
  primitive: 'HeatmapGrid',
  note: 'proxy for uptime: a halt is a preflight check that stopped a loop.',
});

const ROSE = cardSpec({
  id: 'arch-package-size',
  title: 'Package size',
  subtitle: 'one slice per package, the radius is its lines of text; tone by layer',
  primitive: 'Nightingale',
  source: MEASURED_SOURCE,
  note: 'approach one: a Nightingale rose, size only; packages under 1,000 lines are left out.',
});

const COMPOSITION = cardSpec({
  id: 'arch-package-composition',
  title: 'What each package is made of',
  subtitle: 'inner ring the package, outer ring its source, tests, docs, config and fixtures',
  primitive: 'Sunburst',
  source: MEASURED_SOURCE,
  note: 'approach two: a layered sunburst over the real folders, measured on 2026-11-02; config lines include generated JSON, which is what bloats core.',
});

const FLOW = cardSpec({
  id: 'arch-import-flow',
  title: 'Import flow by layer',
  subtitle: 'config → core → platform → feature → addon → app; the lint config\'s edges are left out',
  primitive: 'Sankey',
  source: GRAPH_SOURCE,
  span: 'two',
});

const LAYER_LEGEND: readonly LegendItem[] = LAYER_ORDER.map((layer) => ({ id: layer, label: layer, tone: LAYER_TONES[layer] }));
const CHANGE_LEGEND: readonly LegendItem[] = CHANGE_LEVELS.map(({ id, label, tone }) => ({ id, label, tone }));
const MODEL_LEGEND: readonly LegendItem[] = MODELS.map(({ id, label, tone }) => ({ id, label, tone }));
const COMPONENT_LEGEND: readonly LegendItem[] = COMPONENT_KINDS.map((kind) => ({ id: kind, label: kind, tone: COMPONENT_TONES[kind] }));
const QUANTILE_LEGEND: readonly LegendItem[] = [
  { id: 'p50', label: 'p50', tone: 'series-1' },
  { id: 'p90', label: 'p90', tone: 'series-2' },
];

const ROSE_INFO = (
  <div className={lensInfoVariants()}>
    <p>One slice per package with equal angles, so only the radius carries meaning: the package&apos;s lines of text. The tone is the package&apos;s layer. It answers &quot;which packages are big&quot; and nothing else; the sunburst beside it answers &quot;made of what&quot;.</p>
  </div>
);

const COMPOSITION_INFO = (
  <div className={lensInfoVariants()}>
    <p>The inner ring is the package, the outer ring its parts. A thick outer slice is what bloats that package. Click a package to zoom into it; the tone of each part is the same across packages, so the parts can be compared by colour.</p>
  </div>
);

const FLOW_INFO = (
  <div className={lensInfoVariants()}>
    <p>Each column is a layer, left to right in the order a dependency may point: config, core, platform, feature, add-on, app. A ribbon is one import edge; its width is the same for every edge, so a wide node is a package many others depend on.</p>
  </div>
);

function ArchitectTiles({ result }: { readonly result: LensResult }): ReactElement {
  const { mock, workspace } = result;
  const p90 = mock.taskMinutesQuantiles.at(-1)?.p90 ?? 0;
  const totalHalts = mock.preflightHalts.flat().reduce((sum, value) => sum + value, 0);
  return (
    <>
      <StatTile hero label="Debt ratio (fix + refactor + chore minutes)" value={`${gradeOf(mock.debtRatio)} · ${formatPercent(mock.debtRatio)}`} note="proxy: no remediation estimate exists" />
      <StatTile label="Task minutes p90, this week" value={`${p90} min`} trend={mock.taskMinutesQuantiles.map((week) => week.p90)} delta={{ text: `vs ${P90_AVERAGE} min four-week average`, direction: 'down', upIsGood: false }} />
      <StatTile label="Preflight halts, 12 weeks" value={String(totalHalts)} />
      <StatTile label="Workspace members" value={String(workspace.members.length)} note={`${workspace.edges.length} internal dependency edges`} />
    </>
  );
}

/** The table behind the halts heatmap, for the grid or one zoomed week. */
function haltsTable(halts: readonly (readonly number[])[], zoomed: boolean): { columns: string[]; rows: (string | number)[][] } {
  const columns = zoomed
    ? HOUR_SLOTS
    : WEEK_DATES.map(formatDay);
  return { columns: ['Weekday', ...columns], rows: WEEKDAYS.map((day, index) => [day, ...(halts[index] ?? [])]) };
}

/** The tokens-by-model table: the last ten days. */
function modelTable(mock: MockData): { columns: string[]; rows: string[][] } {
  const LAST_DAYS = 10;
  return {
    columns: ['Day', ...MODELS.map((model) => model.label)],
    rows: mock.tokensPerDay.slice(-LAST_DAYS).map((point, index) => [formatDay(point.x), ...mock.tokensByModel.map((series) => formatCompact(series.points[DAYS - LAST_DAYS + index]?.y ?? 0))]),
  };
}

/** The Architecture lens: debt, package size and composition, halts and the import flow. */
export function ArchitectLens(): ReactElement {
  const { Donut, LineChart, HeatmapGrid, Nightingale, Sunburst, Sankey } = useChartEngine();
  const { data } = useDashboard<LensResult>();
  const [cell, setCell] = useState<HeatmapCell | null>(null);
  const [zoomWeek, setZoomWeek] = useState<number | null>(null);
  const halts = data?.mock.preflightHalts ?? [];
  const details = cell === null
    ? []
    : preflightHaltDetails(halts, cell.row, cell.col);
  const haltsSpec = zoomWeek === null
    ? HALTS
    : { ...HALTS, title: `Preflight halts, week of ${formatDay(WEEK_DATES[zoomWeek] ?? LAST_DAY)}`, subtitle: 'per weekday and four-hour slot; click a cell for the checks behind it' };
  const flowTable = data === undefined
    ? null
    : { columns: ['From', 'To'], rows: data.workspace.sankeyLinks.map((link) => [link.source, link.target]) };

  return (
    <LensGrid
      tiles={data === undefined
        ? <LoadingTiles count={4} />
        : <ArchitectTiles result={data} />}
      cards={(
        <>
          <DashboardCard
            config={DONUT}
            select={(result: LensResult) => result.mock}
            legend={CHANGE_LEGEND}
            table={(mock) => ({ columns: ['Kind', 'This period', 'Previous'], rows: mock.minutesByChangeKind.map((kind, index) => [kind.label, formatCompact(kind.value), formatCompact(mock.minutesByChangeKindPrevious[index]?.value ?? 0)]) })}
          >
            {({ data: mock, animate, height }) => (
              <Donut
                ariaLabel="Share of minutes by change kind, this period on the outer ring and the previous period on the inner ring"
                slices={mock.minutesByChangeKind}
                compare={{ label: 'previous 12 weeks', slices: mock.minutesByChangeKindPrevious }}
                centerValue={gradeOf(mock.debtRatio)}
                centerLabel="debt grade"
                valueFormat={formatCompact}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </DashboardCard>
          <DashboardCard
            config={QUANTILES}
            select={(result: LensResult) => result.mock.taskMinutesQuantiles}
            legend={QUANTILE_LEGEND}
            table={(rows) => ({ columns: ['Week', 'p50', 'p90'], rows: rows.map((row) => [formatDay(row.week), row.p50, row.p90]) })}
          >
            {({ data: rows, animate, height }) => (
              <LineChart
                ariaLabel="Median and 90th percentile task minutes per week"
                series={[
                  { id: 'p50', label: 'p50', tone: 'series-1', points: rows.map((row) => ({ x: row.week, y: row.p50 })) },
                  { id: 'p90', label: 'p90', tone: 'series-2', points: rows.map((row) => ({ x: row.week, y: row.p90 })) },
                ]}
                valueFormat={(value) => `${value} min`}
                xFormat={formatDay}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </DashboardCard>
          <DashboardCard config={MODEL_TOKENS} select={(result: LensResult) => result.mock} legend={MODEL_LEGEND} table={modelTable}>
            {({ data: mock, hidden, animate, height }) => (
              <LineChart
                ariaLabel="Tokens per day by model, stacked"
                series={mock.tokensByModel.filter((series) => !hidden.has(series.id))}
                variant="stacked-area"
                valueFormat={formatCompact}
                xFormat={formatDay}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </DashboardCard>
          <DashboardCard
            key={zoomWeek ?? 'weeks'}
            config={haltsSpec}
            select={(result: LensResult) => (zoomWeek === null
              ? result.mock.preflightHalts
              : preflightHaltsByHour(result.mock.preflightHalts, zoomWeek))}
            table={(grid) => haltsTable(grid, zoomWeek !== null)}
            actions={zoomWeek !== null && (
              <Button variant="text" onClick={() => setZoomWeek(null)}>← 12 weeks</Button>
            )}
          >
            {({ data: grid, animate, height }) => (
              <HeatmapGrid
                ariaLabel={zoomWeek === null
                  ? 'Preflight halts per weekday and week'
                  : 'Preflight halts per weekday and four-hour slot for one week'}
                rows={WEEKDAYS}
                cols={zoomWeek === null
                  ? WEEK_DATES.map(formatDay)
                  : HOUR_SLOTS}
                cells={grid}
                colLabelEvery={zoomWeek === null
                  ? 2
                  : 1}
                unit="halts"
                onCellClick={zoomWeek === null
                  ? setCell
                  : undefined}
                selected={cell === null
                  ? null
                  : { row: cell.row, col: cell.col }}
                animate={animate}
                height={plotHeight(220, height)}
              />
            )}
          </DashboardCard>
          <Dialog
            open={cell !== null}
            title={cell === null
              ? ''
              : `${WEEKDAYS[cell.row] ?? ''} ${formatDay(WEEK_DATES[cell.col] ?? LAST_DAY)}: ${cell.value} halts`}
            onClose={() => setCell(null)}
          >
            {details.length > 0
              ? <DataTable caption="Halts by check" columns={['Check', 'Halts']} rows={details.map((row) => [row.check, row.halts])} sortable />
              : <p className={lensNoteVariants()}>No halt that day.</p>}
            <div className={lensActionsVariants()}>
              <Button
                variant="primary"
                onClick={() => {
                  if (cell !== null) setZoomWeek(cell.col);
                  setCell(null);
                }}
              >
                Zoom into this week
              </Button>
            </div>
          </Dialog>
          <DashboardCard
            config={ROSE}
            select={(result: LensResult) => result.workspace.sizeRose}
            info={ROSE_INFO}
            legend={LAYER_LEGEND.filter((item) => item.id !== 'app')}
            table={(slices) => ({ columns: ['Package', 'Layer', 'Lines'], rows: slices.map((slice) => [slice.label, slice.group ?? '', formatCompact(slice.value)]) })}
          >
            {({ data: slices, animate, height }) => (
              <Nightingale ariaLabel="Package size as a Nightingale rose, one slice per package" slices={slices} groupTones={SIZE_ROSE_TONES} unit="lines" valueFormat={formatCompact} animate={animate} height={plotHeight(320, height)} />
            )}
          </DashboardCard>
          <DashboardCard
            config={COMPOSITION}
            select={(result: LensResult) => result.workspace}
            info={COMPOSITION_INFO}
            legend={COMPONENT_LEGEND}
            table={(workspace) => ({ columns: ['Package', 'Source', 'Tests', 'Docs', 'Config', 'Fixtures', 'External deps'], rows: workspace.composition.map((pkg) => [pkg.id.replace(/^rafa-/, ''), formatCompact(pkg.source), formatCompact(pkg.tests), formatCompact(pkg.docs), formatCompact(pkg.config), formatCompact(pkg.fixtures), pkg.deps]) })}
          >
            {({ data: workspace, animate, height }) => (
              <Sunburst ariaLabel="Package composition as a sunburst: packages on the inner ring, their parts on the outer ring" nodes={workspace.compositionSunburst} groupTones={COMPOSITION_TONES} unit="lines" valueFormat={formatCompact} animate={animate} height={plotHeight(320, height)} />
            )}
          </DashboardCard>
          <DashboardCard
            config={FLOW}
            select={(result: LensResult) => result.workspace}
            info={FLOW_INFO}
            legend={LAYER_LEGEND}
            modals={{ source: flowTable !== null && <SourceView table={flowTable} caption={FLOW.title} source={FLOW.source} limit={SANKEY_TABLE_LIMIT} /> }}
          >
            {({ data: workspace, animate, height }) => (
              <Sankey
                ariaLabel="Dependency flow between workspace members, columns by layer"
                nodes={workspace.sankeyNodes}
                links={workspace.sankeyLinks}
                groupTones={LAYER_TONES}
                groupOrder={[...LAYER_ORDER]}
                animate={animate}
                height={plotHeight(360, height)}
              />
            )}
          </DashboardCard>
        </>
      )}
    />
  );
}
