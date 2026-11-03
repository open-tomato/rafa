import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { SectionCard } from './SectionCard.js';

describe('SectionCard', () => {
  it('renders a region named by its title, with the subtitle, body and footer', () => {
    render(
      <SectionCard title="Tool calls" subtitle="4,734 calls" footer="Counts include retries." footerDivider>
        body
      </SectionCard>,
    );
    const card = screen.getByRole('region', { name: 'Tool calls' });

    expect(card.querySelector('header')?.textContent).toBe('Tool calls4,734 calls');
    expect(card.textContent).toContain('body');
    expect(screen.getByText('Counts include retries.').className).toContain('border-t');
  });

  it('skips the header without a title or an action, and the padding when told', () => {
    render(<SectionCard padded={false}>rows</SectionCard>);
    const body = screen.getByText('rows');

    expect(body.closest('section')?.querySelector('header')).toBeNull();
    expect(body.className).toContain('p-0');
  });

  it('renders the action slot on the right of the header', () => {
    render(<SectionCard title="Spend" action={<button type="button">Export</button>}>body</SectionCard>);

    expect(screen.getByRole('button', { name: 'Export' }).closest('header')).not.toBeNull();
  });
});
