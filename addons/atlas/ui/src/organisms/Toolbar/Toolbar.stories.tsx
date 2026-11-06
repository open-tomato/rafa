import type { Meta, StoryObj } from '@storybook/react-vite';

import { Cpu, Filter, Search } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';

import { Button } from '../../atoms/Button/Button.js';
import { Chip } from '../../atoms/Chip/Chip.js';
import { Segmented } from '../../atoms/Segmented/Segmented.js';
import { makeColumns, SESSIONS, STATUS, type Session } from '../../stories/sessions.js';
import { Table, type TableDensity } from '../Table/index.js';

import { FilterDropdown, type FilterOption } from './FilterDropdown.js';
import { SearchInput } from './SearchInput.js';
import { Toolbar, ToolbarControls, ToolbarCount, ToolbarSeparator, ToolbarSummary, ToolbarSummaryRule } from './Toolbar.js';

/** The status swatch beside a filter option. */
const DOT_CLASS: Readonly<Record<Session['status'], string>> = {
  running: 'bg-good',
  waiting: 'bg-warning',
  failed: 'bg-critical',
  done: 'bg-series-1',
  idle: 'bg-muted',
};

function Dot({ status }: { readonly status: Session['status'] }): ReactElement {
  return <span className={`size-2 shrink-0 rounded-full ${DOT_CLASS[status]}`} aria-hidden="true" />;
}

const STATUS_OPTIONS: readonly FilterOption[] = (Object.keys(STATUS) as Session['status'][]).map((status) => ({
  value: status,
  label: STATUS[status].label,
  swatch: <Dot status={status} />,
}));

const MODEL_OPTIONS: readonly FilterOption[] = [...new Set(SESSIONS.map((row) => row.model))].map((model) => ({ value: model, label: model }));

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
] as const;

/** Toggles `value` in `list`. */
function toggled(list: readonly string[], value: string): readonly string[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

/** The full controlled composition: the toolbar owns the query, the story derives the rows, the table stays pure. */
function ResultsToolbar({ attached }: { readonly attached: boolean }): ReactElement {
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<readonly string[]>([]);
  const [models, setModels] = useState<readonly string[]>([]);
  const [density, setDensity] = useState<TableDensity>('comfortable');

  const rows = useMemo(() => SESSIONS.filter((row) => {
    if (query !== '' && !`${row.name} ${row.goal}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (statuses.length > 0 && !statuses.includes(row.status)) return false;
    if (models.length > 0 && !models.includes(row.model)) return false;
    return true;
  }), [query, statuses, models]);

  const anyFilter = query !== '' || statuses.length > 0 || models.length > 0;
  const clearAll = (): void => {
    setQuery('');
    setStatuses([]);
    setModels([]);
  };

  const controls = (
    <ToolbarControls>
      <SearchInput value={query} onChange={setQuery} placeholder="Search sessions…" label="Search sessions" />
      <FilterDropdown label="Status" icon={<Filter size={15} aria-hidden="true" />} options={STATUS_OPTIONS} selected={statuses} onToggle={(value) => setStatuses((list) => toggled(list, value))} onClear={() => setStatuses([])} />
      <FilterDropdown label="Model" icon={<Cpu size={15} aria-hidden="true" />} options={MODEL_OPTIONS} selected={models} onToggle={(value) => setModels((list) => toggled(list, value))} onClear={() => setModels([])} />
      <ToolbarSeparator />
      <span className="inline-flex items-center gap-[7px]">
        <span className="font-mono text-[11.5px] text-muted">density</span>
        <Segmented size="sm" label="Row density" value={density} options={DENSITY_OPTIONS} onChange={setDensity} />
      </span>
    </ToolbarControls>
  );

  const summary = (
    <ToolbarSummary divided={attached}>
      <ToolbarCount count={rows.length} noun="sessions" of={anyFilter
        ? SESSIONS.length
        : undefined} />
      {anyFilter && (
        <>
          <ToolbarSummaryRule />
          {query !== '' && <Chip icon={<Search size={12} aria-hidden="true" />} onRemove={() => setQuery('')}>“{query}”</Chip>}
          {statuses.map((status) => (
            <Chip key={status} onRemove={() => setStatuses((list) => list.filter((item) => item !== status))}>
              <span className="inline-flex items-center gap-1.5"><Dot status={status as Session['status']} />{STATUS[status as Session['status']].label}</span>
            </Chip>
          ))}
          {models.map((model) => (
            <Chip key={model} onRemove={() => setModels((list) => list.filter((item) => item !== model))}>
              <span className="font-mono">{model}</span>
            </Chip>
          ))}
          <Button variant="text" className="ml-auto" onClick={clearAll}>Clear all</Button>
        </>
      )}
    </ToolbarSummary>
  );

  const empty = (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-sm font-semibold text-ink">No sessions match</p>
      <p className="max-w-sm text-xs text-muted">Nothing fits that query. Loosen a filter or clear them all to see everything again.</p>
      <Button variant="primary" onClick={clearAll}>Clear filters</Button>
    </div>
  );

  const results = rows.length > 0
    ? (
      <Table
        columns={makeColumns('clamp')}
        data={rows}
        getRowId={(row) => row.id}
        layout="fit"
        density={density}
        frame={!attached}
        initialSort={{ key: 'updated', dir: 'asc' }}
      />
    )
    : empty;

  if (attached) {
    return (
      <Toolbar>
        {controls}
        {summary}
        {results}
      </Toolbar>
    );
  }
  return (
    <div className="flex flex-col gap-3.5">
      <Toolbar>
        {controls}
        {summary}
      </Toolbar>
      {rows.length > 0
        ? results
        : <Toolbar>{empty}</Toolbar>}
    </div>
  );
}

const meta = {
  title: 'Organisms/Toolbar',
  component: Toolbar,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Toolbar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The default: two surfaces, each owning its frame, a gap between. */
export const Detached: Story = { render: () => <ResultsToolbar attached={false} /> };
/** One surface owns the frame; the table renders `frame={false}` inside it. */
export const Attached: Story = { render: () => <ResultsToolbar attached /> };
