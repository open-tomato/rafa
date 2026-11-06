import type { Meta, StoryObj } from '@storybook/react-vite';

import { GRAPH_LINKS, GRAPH_NODES, LAYER_TONES, seeded } from '../fixtures.js';

import { NetworkGraph } from './NetworkGraph.js';

const meta = {
  title: 'Engine/NetworkGraph',
  component: NetworkGraph,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  // The force layout draws on Math.random; a seeded stream makes every render the same picture.
  beforeEach: () => {
    const original = Math.random;
    Math.random = seeded(7);
    return () => {
      Math.random = original;
    };
  },
  args: {
    ariaLabel: 'Workspace members and their dependencies',
    nodes: GRAPH_NODES,
    links: GRAPH_LINKS,
    groupTones: LAYER_TONES,
    height: 340,
    animate: false,
  },
} satisfies Meta<typeof NetworkGraph>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
