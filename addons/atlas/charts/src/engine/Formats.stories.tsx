import type { FormatContext, ValueFormat } from '../seam/format.js';
import type { LineSeries } from '../seam/types.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';

import { formatterFor } from '../seam/format.js';
import { FormatProvider, useFormatter } from '../seam/FormatProvider.js';

import { AREA_SERIES } from './fixtures.js';
import { LineChart } from './LineChart/LineChart.js';

/** The props of the preview: one value format, the context it reads, and the x-axis date pattern. */
interface FormatPreviewProps {
  /** How the value axis and the tooltip write a value. */
  format: ValueFormat;
  /** The locale, currency and custom formatters in scope. */
  context: FormatContext;
  /** How the time axis writes a date; `day` when absent. */
  dates?: ValueFormat;
  /** Pins the time axis's ticks to a step, so a weekly pattern lands on week starts. */
  xStep?: 'week';
  /** The series multiplied by this, for a kind that reads another scale (a fraction for `percent`). */
  scale?: number;
}

/** The chart under the provider, so `useFormatter` reads the context. */
function Chart({ format, dates, xStep, scale }: Omit<FormatPreviewProps, 'context'>): ReactElement {
  const valueFormat = useFormatter(format);
  const dateFormat = useFormatter(dates);
  const series: readonly LineSeries[] = AREA_SERIES.map((line) => ({
    ...line,
    points: line.points.map((point) => ({ x: point.x, y: point.y * (scale ?? 1) })),
  }));
  return (
    <LineChart
      ariaLabel="Tokens per day"
      series={series}
      variant="area"
      height={260}
      animate={false}
      valueFormat={valueFormat}
      xStep={xStep}
      xFormat={dateFormat === undefined
        ? undefined
        : (date) => dateFormat(date.getTime())}
    />
  );
}

/** The same series, written by one value format. */
function FormatPreview({ context, ...chart }: FormatPreviewProps): ReactElement {
  return <FormatProvider context={context}><Chart {...chart} /></FormatProvider>;
}

/** A context pinned in the story, so the picture never depends on the viewer's locale. */
const GB: FormatContext = { locale: 'en-GB', currency: 'USD', timeZone: 'UTC' };

/** A formatter an app registers under an id, for the `custom` kind. */
const CUSTOM: FormatContext = {
  ...GB,
  customFormatters: { tokens: (value) => `${formatterFor({ kind: 'compact' })(value)} tok` },
};

const meta = {
  title: 'Engine/Formats',
  component: FormatPreview,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    format: { kind: 'compact' },
    context: GB,
  },
} satisfies Meta<typeof FormatPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Raw: Story = { args: { format: { kind: 'raw' } } };
export const NumberGrouped: Story = { args: { format: { kind: 'number', digits: 0 } } };
export const Compact: Story = { args: { format: { kind: 'compact' } } };
export const Percent: Story = { args: { format: { kind: 'percent', digits: 0 }, scale: 1 / 2_500_000 } };
export const Money: Story = { args: { format: { kind: 'money', digits: 0 } } };
export const MoneyInGermany: Story = { args: { format: { kind: 'money', digits: 0 }, context: { locale: 'de-DE', currency: 'EUR', timeZone: 'UTC' } } };
export const Unit: Story = { args: { format: { kind: 'unit', unit: 'tok' } } };
export const Duration: Story = { args: { format: { kind: 'duration', from: 'seconds' } } };
export const DateWeek: Story = { args: { dates: { kind: 'date', pattern: 'week' }, xStep: 'week' } };
export const DateMonth: Story = { args: { dates: { kind: 'date', pattern: 'month' } } };
export const Custom: Story = { args: { format: { kind: 'custom', id: 'tokens' }, context: CUSTOM } };
