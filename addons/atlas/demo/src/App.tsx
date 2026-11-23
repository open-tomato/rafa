/**
 * The demo's shell: the four lens tabs, the page range, the theme button
 * and the lens page under them, over one `DashboardData` whose source
 * answers a result set per range. URL parameters: `?lens=`, `?theme=`,
 * `?range=`, `?source=` and `?still`. The source is the mock unless the
 * page opens with `?source=live`, which reads the Atlas API the demo
 * server mounts under `/api/atlas` (`src/data/live.ts`).
 */
import type { ChartPrimitives } from '@open-tomato/charts';

import { createAtlasClient } from '@open-tomato/atlas-transport/client';
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
import { createLiveLensSource, LIVE_API_BASE } from './data/live.js';
import { createLensSource, type LensResult } from './data/source.js';
import { ArchitectLens, DeveloperLens, ProjectManagerLens, QaLens } from './lenses/index.js';
import { readPageSource, readParam, writeParam, type PageSource } from './url.js';

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

/** The source the page reads unless `?source=live` or a test asks for another. */
const DEFAULT_SOURCE: DataSource<LensResult, TimeRange> = createLensSource();

/** The page source `?source=` names: the mock, or the live source over the API on this page's origin. */
function pageSourceOf(kind: PageSource): DataSource<LensResult, TimeRange> {
  return kind === 'live'
    ? createLiveLensSource(createAtlasClient({ baseUrl: `${location.origin}${LIVE_API_BASE}` }))
    : DEFAULT_SOURCE;
}

/** The subtitle line, by the source the page reads. */
const SUBTITLES: Readonly<Record<PageSource, string>> = {
  mock: 'Mock data through the card cascade of @open-tomato/atlas-ui, drawn by @open-tomato/charts on ECharts 6.',
  live: 'Live data from the Atlas API under /api/atlas for the cards a metric feeds; the others are not wired yet.',
};

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

function Shell({ sourceKind }: { readonly sourceKind: PageSource }): ReactElement {
  const [lens, setLens] = useState<LensId>(() => readParam('lens', LENS_IDS) ?? 'pm');
  const { theme, chosen, choose } = useTheme();
  const { range, setRange, data } = useDashboard<LensResult>();
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
          <p className={shellSubtitleVariants()}>{SUBTITLES[data?.source ?? sourceKind]}</p>
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
  /** Replaces the source `?source=` names; the subtitle follows the source of the result it answers. */
  readonly source?: DataSource<LensResult, TimeRange>;
  readonly engine?: ChartPrimitives;
}

/** The demo page: the engine, the page data over the range, and the shell. */
export function App({ source, engine = echartsEngine }: AppProps): ReactElement {
  const initialRange = readParam('range', TIME_RANGES) ?? undefined;
  // Read once per mount: the page's source is chosen by its URL when it opens, never by an effect.
  const [sourceKind] = useState<PageSource>(readPageSource);
  const [named] = useState(() => pageSourceOf(sourceKind));
  return (
    <ChartEngineProvider engine={engine}>
      <DashboardData source={source ?? named} defaultRange={initialRange} onRangeChange={(range) => writeParam('range', range)}>
        <Shell sourceKind={sourceKind} />
      </DashboardData>
    </ChartEngineProvider>
  );
}
