import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../atoms/Button/Button.js';

import { SectionCard } from './SectionCard.js';

const meta = {
  title: 'Molecules/SectionCard',
  component: SectionCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="max-w-xl"><Story /></div>],
} satisfies Meta<typeof SectionCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The section shell: title and subtitle, a rule, an 18px-padded body. */
export const Default: Story = {
  args: {
    title: 'Tool calls',
    subtitle: '4,734 calls',
    children: <div className="text-sm text-ink-2">Chart content goes here.</div>,
  },
};

/** The header's action slot: filters, legends, buttons on the right. */
export const WithAction: Story = {
  args: {
    title: 'Spend by agent',
    subtitle: '8 active',
    action: <Button variant="text">Export</Button>,
    children: <div className="text-sm text-ink-2">Chart content goes here.</div>,
  },
};

/** `padded={false}`: a full-bleed body for row lists. */
export const FullBleed: Story = {
  args: {
    title: 'Top sessions by spend',
    subtitle: 'Click through for the full transcript',
    padded: false,
    children: (
      <div className="divide-y divide-grid">
        {['auth-refactor', 'schema-migration', 'image-pipeline'].map((session) => (
          <div key={session} className="px-[18px] py-3 text-sm text-ink">{session}</div>
        ))}
      </div>
    ),
  },
};

/** The footer line with its rule. */
export const WithFooter: Story = {
  args: {
    title: 'Tool calls',
    footer: 'Counts include retries.',
    footerDivider: true,
    children: <div className="text-sm text-ink-2">Chart content goes here.</div>,
  },
};

/** No header: the bare shell. */
export const Headerless: Story = {
  args: {
    children: <div className="text-sm text-ink-2">Body only.</div>,
  },
};
