import type { ChartPrimitives } from '../seam/types.js';

import { BarChart } from './BarChart/index.js';
import { BoxPlot } from './BoxPlot/index.js';
import { Bullet } from './Bullet/index.js';
import { Donut } from './Donut/index.js';
import { Gauge } from './Gauge/index.js';
import { HeatmapGrid } from './HeatmapGrid/index.js';
import { Histogram } from './Histogram/index.js';
import { LineChart } from './LineChart/index.js';
import { NetworkGraph } from './NetworkGraph/index.js';
import { Nightingale } from './Nightingale/index.js';
import { Radar } from './Radar/index.js';
import { Sankey } from './Sankey/index.js';
import { ScatterChart } from './ScatterChart/index.js';
import { Sunburst } from './Sunburst/index.js';
import { Treemap } from './Treemap/index.js';

/** Apache ECharts 6, tree-shaken, painted on canvas from the resolved tokens. */
export const echartsEngine: ChartPrimitives = {
  id: 'echarts',
  label: 'ECharts 6',
  notes: [
    'All fifteen primitives are native ECharts series (bar, line, scatter, boxplot, gauge, pie, treemap, heatmap, graph, sankey, sunburst, radar); structural: canvas cannot read CSS variables, so every option is rebuilt from useResolvedTokens() and set with notMerge on a theme flip (the zoomable line chart merges instead, replacing only its series, so the zoom window survives a legend toggle).',
    'Line zoom: native dataZoom (slider + inside, pinch or ctrl+wheel); the window is read back from the instance on each datazoom event and fed into every rebuilt option.',
    'Gauge compare and overflow: a second gauge series is the inner arc; the max marker is a third, zero-span gauge whose only split line sits at the arc end, since the gauge has no marker of its own.',
    'Donut compare: a second pie series is the inner ring; the shared tooltip matches the slice across rings by id.',
    'Heatmap click: native click event and a per-item ink border for the selected cell (drawn last so no neighbour gap paints over it). Keyboard is a canvas gap: cells cannot take focus, so Enter/Space are not supported. The heatmap view ignores the series cursor, so a root class removes the pointer when cells are not buttons.',
    'Sankey: columns come from groupOrder via node depth, spread over ECharts\' own column count (the longest path), which it uses whatever depths the nodes carry; links inside one layer have no column to cross and draw as short back-curves.',
    'Bar stacked100: no built-in percent stack; the values are normalised to category shares before the option, with a percent formatter.',
    'Bullet: no bullet series; composed from three stacked bar series (the bands) and an 8px bar on a second hidden category axis, the target as a markLine, the value text as graphic elements.',
    'Box plot: one borderColor strokes box, whiskers and median; it is set to ink-2 and a custom series redraws the median as a 2px ink line on top.',
    'Treemap: native labels truncate rather than hide; a labelLayout hook measures the text against the node rect and parks unfit labels off the canvas.',
    'Scatter: dots are hit-tested at their drawn size; an invisible 24px scatter series takes the hover and highlights the visible dot.',
    'Histogram: ticks at bin edges come from a second category axis with n+1 entries and no boundary gap over the band axis.',
    'Nightingale: native pie with roseType "area" (equal angles, radius by value; ECharts\' "radius" rose sizes the angles too); labels under 4% of the total are switched off per item.',
    'Sunburst: native sunburst; the two rings are levels with their own radii, labels hide natively under 18 degrees (minAngle), nodeClick is off and a click maps the item id to its root-to-node path for onNodeClick.',
    'Radar: native radar and radar series; the sectors are a silent pie behind it whose wedges span each sector\'s axes, labelled outside with icon and name; the baseline is a second one-axis radar sized to the baseline value, its ring in ink-2 and its axis name as the label; the per-axis tooltip comes from a transparent pie with one slice per axis on top, since the radar series only reports whole shapes.',
  ],
  BarChart,
  LineChart,
  ScatterChart,
  Histogram,
  BoxPlot,
  Gauge,
  Bullet,
  Donut,
  Treemap,
  HeatmapGrid,
  NetworkGraph,
  Sankey,
  Nightingale,
  Sunburst,
  Radar,
};
