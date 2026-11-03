import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { MaximiseView } from './MaximiseView.js';

const LEGEND = <ul aria-label="Legend"><li>input</li><li>output</li></ul>;
const TABLE = <table aria-label="Tokens"><tbody><tr><td>120</td></tr></tbody></table>;

/** The maximise dialog, by the card's title. */
function box(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Tokens' });
}

/** The chart's box: the element around the content. */
function chartBox(): HTMLElement {
  const content = screen.getByText(/^chart/);
  const parent = content.parentElement;
  if (parent === null) throw new Error('the content has no box');
  return parent;
}

describe('MaximiseView', () => {
  it('opens medium: a square chart box of 70% of the viewport\'s smaller side less the chrome, the content told to fill it', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined}>{({ height }) => <p>chart height={height}</p>}</MaximiseView>);

    expect(box().tagName).toBe('DIALOG');
    expect(box().className).toContain('max-w-[calc(100vw-30vmin)]');
    expect(chartBox().className).toContain('size-[calc(70vmin-5rem)]');
    expect(chartBox().className).toContain('overflow-hidden');
    expect(screen.getByRole('radio', { name: 'Medium' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('chart height=fill')).toBeDefined();
  });

  it('opens at the size the card names, and switches from the picker', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined} options={{ size: 'large' }}><p>chart</p></MaximiseView>);

    expect(chartBox().className).toContain('size-[calc(90vmin-5rem)]');
    expect(box().className).toContain('max-h-[calc(100vh-10vmin)]');
    fireEvent.click(screen.getByRole('radio', { name: 'Medium' }));
    expect(chartBox().className).toContain('size-[calc(70vmin-5rem)]');
    expect(chartBox().className).not.toContain('90vmin');
    expect(box().className).toContain('max-w-[calc(100vw-30vmin)]');
  });

  it('stands the extras beside the box on a landscape viewport, as tall as the box, and under it on a portrait one', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined} legend={LEGEND} table={TABLE}><p>chart</p></MaximiseView>);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const extras = screen.getByRole('table', { name: 'Tokens' }).parentElement;
    const view = chartBox().parentElement;

    expect(view?.className).toContain('landscape:flex-row');
    expect(view?.className).toContain('flex-col');
    expect(extras?.className).toContain('landscape:h-[calc(70vmin-5rem)]');
    expect(extras?.className).toContain('landscape:overflow-auto');
    expect(extras?.className).toContain('landscape:shrink');
    expect(extras?.className).toContain('[scrollbar-width:thin]');
  });

  it('names the size control for assistive technology', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined}>chart</MaximiseView>);

    expect(screen.getByRole('radiogroup', { name: 'Box size' })).toBeDefined();
  });

  it('shows and hides the legend and the table from their toggles, both off at first', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined} legend={LEGEND} table={TABLE}>chart</MaximiseView>);
    const legendToggle = screen.getByRole('button', { name: 'Legend' });
    const tableToggle = screen.getByRole('button', { name: 'Table' });

    expect(legendToggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Tokens' })).toBeNull();

    fireEvent.click(legendToggle);
    fireEvent.click(tableToggle);
    expect(legendToggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('list', { name: 'Legend' })).toBeDefined();
    expect(screen.getByRole('table', { name: 'Tokens' })).toBeDefined();

    fireEvent.click(legendToggle);
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Tokens' })).toBeDefined();
  });

  it('shows an always extra without a toggle, and starts a toggle-on extra shown', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined} legend={LEGEND} table={TABLE} options={{ legend: 'always', table: 'toggle-on' }}>chart</MaximiseView>);

    expect(screen.queryByRole('button', { name: 'Legend' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Legend' })).toBeDefined();
    const tableToggle = screen.getByRole('button', { name: 'Table' });
    expect(tableToggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('table', { name: 'Tokens' })).toBeDefined();
    fireEvent.click(tableToggle);
    expect(screen.queryByRole('table', { name: 'Tokens' })).toBeNull();
  });

  it('leaves out an extra the card does not have, whatever its mode', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined} legend={LEGEND} options={{ table: 'always' }}>chart</MaximiseView>);

    expect(screen.getByRole('button', { name: 'Legend' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('calls onClose from Close', () => {
    const onClose = mock(() => undefined);
    render(<MaximiseView title="Tokens" onClose={onClose}>chart</MaximiseView>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
