import type { Meta, StoryObj } from '@storybook/react-vite';

import { TREEMAP_NODES, TREEMAP_TONES } from '../fixtures.js';

import { Treemap } from './Treemap.js';

const meta = {
  title: 'Engine/Treemap',
  component: Treemap,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Lines of source by module',
    nodes: TREEMAP_NODES,
    groupTones: TREEMAP_TONES,
    unit: 'lines',
    height: 280,
    animate: false,
  },
} satisfies Meta<typeof Treemap>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
