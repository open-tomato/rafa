import type { TimeRange } from '../../contract/schemas.js';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { RangeSelector } from './RangeSelector.js';

describe('RangeSelector', () => {
  it('offers the four ranges and reports a pick', () => {
    const onChange = mock<(range: TimeRange) => void>(() => undefined);
    render(<RangeSelector value="now" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Last year' }));

    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Now', 'Last week', 'Past month', 'Last year']);
    expect(onChange).toHaveBeenCalledWith('last-year');
  });
});
