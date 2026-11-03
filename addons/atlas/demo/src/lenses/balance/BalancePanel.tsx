import type { ReactElement } from 'react';

import { LEVEL_LEGEND, type BalanceReading, type Level } from '../../data/balance-readings.js';
import { BALANCE_POLES, type PoleId } from '../../data/balance.js';

import {
  balanceHistoryVariants,
  balanceLegendRowVariants,
  balanceLegendTermVariants,
  balanceLegendVariants,
  balanceLevelVariants,
  balanceNotesVariants,
  balancePanelVariants,
  balancePoleDotVariants,
  balancePoleListVariants,
  balancePoleNameVariants,
  balancePoleRowVariants,
  balancePoleValueVariants,
  balanceReadingNameVariants,
  balanceReadingTextVariants,
  balanceReadingVariants,
  type BalancePoleDotTone,
} from './BalancePanel.variants.js';

/** The balance panel's props: the reading and the weeks of history behind it. */
export interface BalancePanelProps {
  readonly reading: BalanceReading;
  readonly history: { readonly weeks: number; readonly of: number };
}

const LEVEL_WORD: Readonly<Record<Level, string>> = { low: 'low', mid: 'usual', high: 'high' };

const LEVELS: readonly Level[] = ['low', 'mid', 'high'];

/** The core tone of each pole, as the dot draws it. */
const POLE_DOT: Readonly<Record<PoleId, BalancePoleDotTone>> = {
  shipping: 'pole-ship-core',
  failing: 'pole-fail-core',
  foundation: 'pole-base-core',
};

/** The reading beside the radar: each pole's level, the name of the week, its notes and the level legend. */
export function BalancePanel({ reading, history }: BalancePanelProps): ReactElement {
  return (
    <aside className={balancePanelVariants()} aria-label="Balance reading">
      <ul className={balancePoleListVariants()}>
        {BALANCE_POLES.map((pole) => {
          const id = pole.id as PoleId;
          const level = reading.levels[id];
          return (
            <li key={pole.id} className={balancePoleRowVariants()}>
              <span className={balancePoleNameVariants()}>
                <span aria-hidden="true" className={balancePoleDotVariants({ tone: POLE_DOT[id] })} />
                {pole.icon} {pole.label}
              </span>
              <span className={balancePoleValueVariants()}>
                {reading.means[id].toFixed(2)}×
                <span className={balanceLevelVariants({ usual: level === 'mid' })}>{LEVEL_WORD[level]}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className={balanceReadingVariants()}>
        <p className={balanceReadingNameVariants()}>{reading.reading.name}</p>
        <p className={balanceReadingTextVariants()}>{reading.reading.text}</p>
        {reading.notes.length > 0 && (
          <ul className={balanceNotesVariants()}>
            {reading.notes.map((note) => <li key={note}>· {note}</li>)}
          </ul>
        )}
      </div>
      <dl className={balanceLegendVariants()}>
        {LEVELS.map((level) => (
          <div key={level} className={balanceLegendRowVariants()}>
            <dt className={balanceLegendTermVariants()}>{LEVEL_WORD[level]}</dt>
            <dd>{LEVEL_LEGEND[level]}</dd>
          </div>
        ))}
      </dl>
      <p className={balanceHistoryVariants()}>
        The ring at 1 is as usual: {history.weeks} of {history.of} weeks behind it, so the centre is {history.weeks >= history.of
          ? 'solid'
          : 'still forming'}.
      </p>
    </aside>
  );
}
