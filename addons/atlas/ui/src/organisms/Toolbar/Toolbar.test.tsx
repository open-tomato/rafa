import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { FilterDropdown } from './FilterDropdown.js';
import { SearchInput } from './SearchInput.js';
import { Toolbar, ToolbarControls, ToolbarCount, ToolbarSummary } from './Toolbar.js';

describe('SearchInput', () => {
  it('reports typed text and clears it from the inline button', () => {
    const onChange = mock((value: string) => value);
    const { rerender } = render(<SearchInput value="" onChange={onChange} label="Search sessions" />);

    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), { target: { value: 'auth' } });
    expect(onChange).toHaveBeenCalledWith('auth');

    rerender(<SearchInput value="auth" onChange={onChange} label="Search sessions" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});

describe('FilterDropdown', () => {
  const options = [{ value: 'running', label: 'running' }, { value: 'done', label: 'done' }];

  it('opens its checklist, toggles a value and keeps the panel open', () => {
    const onToggle = mock((value: string) => value);
    render(<FilterDropdown label="Status" options={options} selected={['done']} onToggle={onToggle} onClear={() => undefined} />);

    const trigger = screen.getByRole('button', { name: /Status/ });
    expect(trigger.textContent).toContain('1');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('checkbox', { name: 'running' }));

    expect(onToggle).toHaveBeenCalledWith('running');
    expect(screen.getByRole('checkbox', { name: 'done' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('group', { name: 'Status' })).toBeTruthy();
  });

  it('clears from the panel and closes it', () => {
    const onClear = mock(() => undefined);
    render(<FilterDropdown label="Status" options={options} selected={['done']} onToggle={() => undefined} onClear={onClear} />);

    fireEvent.click(screen.getByRole('button', { name: /Status/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('Toolbar', () => {
  it('lays the controls band as a toolbar and writes the filtered count', () => {
    render(
      <Toolbar>
        <ToolbarControls><span>controls</span></ToolbarControls>
        <ToolbarSummary divided><ToolbarCount count={3} noun="sessions" of={12} /></ToolbarSummary>
      </Toolbar>,
    );

    expect(screen.getByRole('toolbar').textContent).toBe('controls');
    expect(screen.getByText('of 12 sessions').parentElement?.className).toContain('border-b');
  });
});
