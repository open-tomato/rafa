import type { Meta, StoryObj } from '@storybook/react-vite';

import { ErrorsView } from './ErrorsView.js';

/** A fixed error: the stack is written out so the story never depends on where it runs. */
function sampleError(): Error {
  const error = new TypeError('Cannot read properties of undefined (reading \'tokens\')');
  error.stack = 'TypeError: Cannot read properties of undefined (reading \'tokens\')\n    at TokensChart (TokensChart.tsx:42:18)\n    at ChartCard (ChartCard.tsx:88:7)';
  return error;
}

const meta = {
  title: 'Molecules/ErrorsView',
  component: ErrorsView,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { error: sampleError(), onRetry: () => undefined },
  decorators: [(Story) => <div className="w-96"><Story /></div>],
} satisfies Meta<typeof ErrorsView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithStack: Story = {};
export const MessageOnly: Story = { args: { showStack: false } };
export const NoRetry: Story = { args: { onRetry: undefined } };
