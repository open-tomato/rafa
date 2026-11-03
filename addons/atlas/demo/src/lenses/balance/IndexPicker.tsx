import type { ReactElement } from 'react';

import { BALANCE_MAX_PER_POLE, BALANCE_POLES, canEnable, countOn, type BalanceIndex, type PoleId } from '../../data/balance.js';

import {
  indexPickerCaptionVariants,
  indexPickerCellVariants,
  indexPickerFrameVariants,
  indexPickerHeadRowVariants,
  indexPickerHeadVariants,
  indexPickerRowVariants,
  indexPickerTableVariants,
  indexPickerTextVariants,
} from './IndexPicker.variants.js';

/** The index picker's props: the catalogue, the switched-on ids and the toggle. */
export interface IndexPickerProps {
  readonly catalogue: readonly BalanceIndex[];
  readonly enabled: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
}

/** Why a switch is disabled: the last index of its pole, or a full pole. */
function blockedReason(catalogue: readonly BalanceIndex[], enabled: ReadonlySet<string>, index: BalanceIndex): string | undefined {
  if (enabled.has(index.id)) {
    return countOn(catalogue, enabled, index.pole) <= 1
      ? 'The last index of its pole'
      : undefined;
  }
  return canEnable(catalogue, enabled, index.id)
    ? undefined
    : 'This pole is full';
}

/**
 * The catalogue as a table with a switch per index: name, pole, this
 * week's value and the definition. The balance card's `indices` modal
 * entry renders it.
 */
export function IndexPicker({ catalogue, enabled, onToggle }: IndexPickerProps): ReactElement {
  const poleOf = (id: PoleId) => BALANCE_POLES.find((pole) => pole.id === id);
  const room = BALANCE_POLES.map((pole) => `${pole.icon ?? ''} ${countOn(catalogue, enabled, pole.id as PoleId)} of ${BALANCE_MAX_PER_POLE}`).join(' · ');
  return (
    <div>
      <p className={indexPickerTextVariants()}>Up to {BALANCE_MAX_PER_POLE} per pole; the last one on a pole stays on. Each value is this week over its twelve-week median.</p>
      <div className={indexPickerFrameVariants()}>
        <table className={indexPickerTableVariants()}>
          <caption className={indexPickerCaptionVariants()}>Balance indices with their pole, value and definition</caption>
          <thead>
            <tr className={indexPickerHeadRowVariants()}>
              <th scope="col" className={indexPickerHeadVariants()}>On</th>
              <th scope="col" className={indexPickerHeadVariants()}>Index</th>
              <th scope="col" className={indexPickerHeadVariants()}>Pole</th>
              <th scope="col" className={indexPickerHeadVariants({ align: 'end' })}>Value</th>
              <th scope="col" className={indexPickerHeadVariants({ align: 'last' })}>Definition</th>
            </tr>
          </thead>
          <tbody>
            {catalogue.map((index) => {
              const on = enabled.has(index.id);
              const pole = poleOf(index.pole);
              const blocked = blockedReason(catalogue, enabled, index);
              return (
                <tr key={index.id} className={indexPickerRowVariants({ on })}>
                  <td className={indexPickerCellVariants()}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={blocked !== undefined}
                      onChange={() => onToggle(index.id)}
                      aria-label={`${index.label} on the radar`}
                      title={blocked}
                    />
                  </td>
                  <td className={indexPickerCellVariants({ emphasis: 'name' })}>{index.label}</td>
                  <td className={indexPickerCellVariants({ emphasis: 'pole' })}>{pole?.icon} {pole?.label}</td>
                  <td className={indexPickerCellVariants({ align: 'end' })}>{index.value.toFixed(2)}×</td>
                  <td className={indexPickerCellVariants({ align: 'last' })}>{index.definition}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={indexPickerTextVariants({ tone: 'ink' })}>{room}</p>
    </div>
  );
}
