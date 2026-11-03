/**
 * The demo's shell: the four lens tabs, the page range, the theme button
 * and the lens page under them, over one `DashboardData` whose source
 * answers a result set per range. URL parameters: `?lens=`, `?theme=`,
 * `?range=` and `?still`.
 */
import type { ChartPrimitives } from '@open-tomato/charts';

import { DashboardData, RangeSelector, TIME_RANGES, useDashboard, Button, type DataSource, type TimeRange } from '@open-tomato/atlas-ui';
import { ChartEngineProvider, echartsEngine } from '@open-tomato/charts';
import { BoxesLinked, Moon, SquareCode, StarCheck, Sun, TrendingUpDown, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';

import {
  lensTabsVariants,
  lensTabVariants,
  shellControlsVariants,
  shellHeaderVariants,
  shellSubtitleVariants,
  shellTitleVariants,
  shellVariants,
} from './App.variants.js';
import { createLensSource, type LensResult } from './data/source.js';
import { ArchitectLens, DeveloperLens, ProjectManagerLens, QaLens } from './lenses/index.js';
import { readParam, writeParam } from './url.js';

export type LensId = 'pm' | 'architect' | 'developer' | 'qa';
type Theme = 'light' | 'dark';

interface LensTab {
  readonly id: LensId;
  readonly name: string;
  readonly summary: string;
  readonly Icon: LucideIcon;
  readonly Page: () => ReactElement;
}

/** The tabs: an icon each; the name is the accessible label, name and summary the tooltip. */
const LENSES: readonly LensTab[] = [
  { id: 'pm', name: 'Project Management', summary: 'budget, throughput, plans landed and the task pile', Icon: TrendingUpDown, Page: ProjectManagerLens },
  { id: 'architect', name: 'Architecture', summary: 'debt, package size and composition, halts and the import flow', Icon: BoxesLinked, Page: ArchitectLens },
  { id: 'developer', name: 'Development', summary: 'balance, work done, cycle time and task minutes', Icon: SquareCode, Page: DeveloperLens },
  { id: 'qa', name: 'QA', summary: 'defects, regressions, resolution and flaky checks', Icon: StarCheck, Page: QaLens },
];

const LENS_IDS: readonly LensId[] = LENSES.map((lens) => lens.id);
const THEMES: readonly Theme[] = ['light', 'dark'];
const DARK_QUERY = '(prefers-color-scheme: dark)';
const ICON_SIZE = 18;

/** The source the page reads unless a test hands it another. */
const DEFAULT_SOURCE: DataSource<LensResult, TimeRange> = createLensSource();

function systemTheme(): Theme {
  return matchMedia(DARK_QUERY).matches
    ? 'dark'
    : 'light';
}

/** The theme: the system's until the viewer picks one; `?theme=` pins it. */
function useTheme(): { theme: Theme; chosen: Theme | null; choose: (theme: Theme) => void } {
  const [chosen, choose] = useState<Theme | null>(() => readParam('theme', THEMES));
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = chosen ?? system;

  useEffect(() => {
    const query = matchMedia(DARK_QUERY);
    const follow = (): void => setSystem(systemTheme());
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    writeParam('theme', chosen);
  }, [theme, chosen]);

  return { theme, chosen, choose };
}

function Shell(): ReactElement {
  const [lens, setLens] = useState<LensId>(() => readParam('lens', LENS_IDS) ?? 'pm');
  const { theme, chosen, choose } = useTheme();
  const { range, setRange } = useDashboard<LensResult>();
  const active = LENSES.find((tab) => tab.id === lens) ?? LENSES[0];
  const ThemeIcon = theme === 'dark'
    ? Sun
    : Moon;
  const nextTheme: Theme = theme === 'dark'
    ? 'light'
    : 'dark';

  useEffect(() => {
    writeParam('lens', lens);
  }, [lens]);

  return (
    <div className={shellVariants()}>
      <header className={shellHeaderVariants()}>
        <div>
          <h1 className={shellTitleVariants()}>Atlas dashboard</h1>
          <p className={shellSubtitleVariants()}>Mock data through the card cascade of @open-tomato/atlas-ui, drawn by @open-tomato/charts on ECharts 6.</p>
        </div>
        <div className={shellControlsVariants()}>
          <RangeSelector value={range} onChange={setRange} size="sm" />
          <div role="tablist" aria-label="Lens" className={lensTabsVariants()}>
            {LENSES.map(({ id, name, summary, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === lens}
                aria-label={name}
                title={`${name} — ${summary}`}
                className={lensTabVariants({ selected: id === lens })}
                onClick={() => setLens(id)}
              >
                <Icon size={ICON_SIZE} aria-hidden="true" />
              </button>
            ))}
          </div>
          <Button
            variant="icon"
            aria-label={`Switch to ${nextTheme} theme`}
            title={chosen === null
              ? `${theme} theme (system)`
              : `${theme} theme (chosen)`}
            onClick={() => choose(nextTheme)}
          >
            <ThemeIcon size={ICON_SIZE} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <main aria-label={active?.name}>
        {active && <active.Page />}
      </main>
    </div>
  );
}

/** The demo's props: the page source and the engine, both replaceable by a test. */
export interface AppProps {
  readonly source?: DataSource<LensResult, TimeRange>;
  readonly engine?: ChartPrimitives;
}

/** The demo page: the engine, the page data over the range, and the shell. */
export function App({ source = DEFAULT_SOURCE, engine = echartsEngine }: AppProps): ReactElement {
  const initialRange = readParam('range', TIME_RANGES) ?? undefined;
  return (
    <ChartEngineProvider engine={engine}>
      <DashboardData source={source} defaultRange={initialRange} onRangeChange={(range) => writeParam('range', range)}>
        <Shell />
      </DashboardData>
    </ChartEngineProvider>
  );
}
