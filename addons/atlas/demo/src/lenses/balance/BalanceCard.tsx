import type { LensResult } from '../../data/source.js';

import { DashboardCard, Segmented, useDashboard, type ModalEntry } from '@open-tomato/atlas-ui';
import { useChartEngine } from '@open-tomato/charts';
import { ListChecks } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { readBalance } from '../../data/balance-readings.js';
import {
  BALANCE_CATALOGUE,
  BALANCE_MAX,
  BALANCE_POLES,
  BALANCE_WINDOW_WEEKS,
  balanceAxes,
  balanceSeries,
  defaultEnabled,
  toggleIndex,
} from '../../data/balance.js';
import { cardSpec, plotHeight } from '../spec.js';

import { balanceCardBodyVariants, balanceInfoVariants } from './BalanceCard.variants.js';
import { BalancePanel } from './BalancePanel.js';
import { IndexPicker } from './IndexPicker.js';

type HistoryWeeks = '2' | '6' | '12';

const HISTORY_OPTIONS: readonly { value: HistoryWeeks; label: string }[] = [
  { value: '2', label: '2 wk' },
  { value: '6', label: '6 wk' },
  { value: '12', label: '12 wk' },
];

const RADAR_HEIGHT = 380;

const BALANCE = cardSpec({
  id: 'dev-balance',
  title: 'Balance: shipping, failing, foundation',
  primitive: 'Radar',
  subtitle: 'each index divided by its twelve-week median, so the ring at 1 is as usual',
  span: 'two',
  source: 'Mock ratios for this week; in the port each index is a share or a rate over the store tables named in its definition, divided by its twelve-week median (src/data/balance.ts).',
  note: 'the shape tilts toward the pole that grew: 📦 shipping is good growth, 🔥 failing is bad growth, 🛠️ foundation is investment; the dev keeps it round. The history switch stands in for the weeks the medians have behind them.',
});

const INFO = (
  <div className={balanceInfoVariants()}>
    <p>Each axis is one index, pulled toward one of three poles. The ring at 1 is the index&apos;s twelve-week median, so the shape is round on a week like the usual and bulges toward the pole that grew.</p>
    <p>📦 Shipping grows when more lands; 🔥 Failing grows when more breaks, so its growth is the bad direction; 🛠️ Foundation grows when minutes go to repair, refactor and docs. The three poles partition the same minutes and changes, so a bulge on one side is paid for on another.</p>
    <p>The centre solidifies with the weeks of history behind the medians; the reading beside the chart names the week from the three pole levels.</p>
  </div>
);

/**
 * The balance radar with the reading beside it. The history switch sits in
 * the header; the index picker is the card menu's Indices entry.
 */
export function BalanceCard(): ReactElement {
  const { Radar } = useChartEngine();
  const catalogue = useDashboard<LensResult>().data?.balance ?? BALANCE_CATALOGUE;
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(() => defaultEnabled());
  const [historyWeeks, setHistoryWeeks] = useState<HistoryWeeks>('12');
  const history = { weeks: Number(historyWeeks), of: BALANCE_WINDOW_WEEKS };
  const toggle = (id: string): void => setEnabled((current) => toggleIndex(catalogue, current, id));
  const modals: Readonly<Record<string, ModalEntry>> = {
    indices: {
      label: 'Indices…',
      icon: ListChecks,
      title: 'Indices on the balance radar',
      render: <IndexPicker catalogue={catalogue} enabled={enabled} onToggle={toggle} />,
    },
  };

  return (
    <DashboardCard
      config={BALANCE}
      select={(result: LensResult) => result.balance}
      info={INFO}
      table={(indices) => ({
        columns: ['Index', 'Pole', 'This week', 'On'],
        rows: indices.map((index) => [index.label, index.pole, `${index.value.toFixed(2)}×`, enabled.has(index.id)
          ? 'on'
          : 'off']),
      })}
      actions={<Segmented value={historyWeeks} options={HISTORY_OPTIONS} onChange={setHistoryWeeks} label="Weeks of history behind the baseline" size="sm" />}
      modals={modals}
    >
      {({ data: indices, animate, height }) => {
        const axes = balanceAxes(indices, enabled);
        return (
          <div className={balanceCardBodyVariants({ fill: height === 'fill' })}>
            <Radar
              ariaLabel={`Balance radar: ${axes.length} indices pulled toward three poles, this week against the usual`}
              axes={axes}
              poles={BALANCE_POLES}
              series={balanceSeries(indices, enabled)}
              max={BALANCE_MAX}
              baseline={{ value: 1, label: 'as usual' }}
              history={history}
              valueFormat={(value) => `${value.toFixed(2)}×`}
              animate={animate}
              height={plotHeight(RADAR_HEIGHT, height)}
            />
            <BalancePanel reading={readBalance(indices, enabled)} history={history} />
          </div>
        );
      }}
    </DashboardCard>
  );
}
