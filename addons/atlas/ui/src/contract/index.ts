/** The card contract: zod schemas with their inferred types, and the `describe()` roster. */
export {
  CARD_MODES,
  CARD_SPANS,
  MODAL_KEYS,
  TIME_RANGES,
  applyDescriptor,
  cardSpecSchema,
  cardDescriptorSchema,
  cardModeSchema,
  cardSpanSchema,
  chartDescriptorSchema,
  descriptorOf,
  legendConfigSchema,
  menuItemSchema,
  modalKeySchema,
  timeRangeSchema,
} from './schemas.js';
export type {
  CardSpec,
  CardDescriptor,
  CardMode,
  CardSpan,
  ChartDescriptor,
  LegendConfig,
  MenuItem,
  ModalKey,
  TimeRange,
} from './schemas.js';
export { DESCRIBE_SCHEMA_VERSION, describe } from './describe.js';
export type { DescribeDocument, DescribeEntry } from './describe.js';
