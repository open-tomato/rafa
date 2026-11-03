import type { Meta, StoryObj } from '@storybook/react-vite';

import { userEvent, within } from 'storybook/test';

import { Sparkline } from '../../atoms/Sparkline/Sparkline.js';
import { InfoView } from '../../molecules/InfoView/InfoView.js';
import { SourceView } from '../../molecules/SourceView/SourceView.js';

import { CardLayout } from './CardLayout.js';

const VALUES = [12, 14, 11, 16, 18, 17, 21, 19, 23, 22, 26, 28];

const TABLE = { columns: ['Week', 'Tokens'], rows: VALUES.map((value, index) => [`W${index + 1}`, value]) };

/** A fixed error: the stack is written out so the story never depends on where it runs. */
function sampleError(): Error {
  const error = new Error('The source answered 503 Service Unavailable.');
  error.stack = 'Error: The source answered 503 Service Unavailable.\n    at fetchTokens (tokens.ts:12:11)';
  return error;
}

const meta = {
  title: 'Organisms/CardLayout',
  component: CardLayout,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    title: 'Tokens per week',
    content: <Sparkline values={VALUES} tone="series-1" width={320} height={120} label="Tokens per week" />,
    modals: {
      info: <InfoView description="Input and output tokens per week, summed across models." source="Fixed sample" />,
      source: <SourceView table={TABLE} caption="Tokens per week" source="Fixed sample" />,
    },
  },
  decorators: [(Story) => <div className="h-96 w-[26rem]"><Story /></div>],
} satisfies Meta<typeof CardLayout>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Opens the card menu. */
async function openMenu(canvasElement: HTMLElement): Promise<ReturnType<typeof within>> {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Options for Tokens per week' }));
  return canvas;
}

export const Default: Story = {};
export const WithoutMenu: Story = { args: { modals: undefined } };
export const WithFooter: Story = { args: { footer: 'Updated every hour.' } };
export const MenuOpen: Story = { args: { maximisable: true }, play: async ({ canvasElement }) => {
  await openMenu(canvasElement);
} };
export const InfoOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openMenu(canvasElement);
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Info' }));
  },
};
export const SourceOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openMenu(canvasElement);
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Source' }));
  },
};
export const ErrorsOpen: Story = {
  args: { error: sampleError() },
  play: async ({ canvasElement }) => {
    const canvas = await openMenu(canvasElement);
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Errors' }));
  },
};
