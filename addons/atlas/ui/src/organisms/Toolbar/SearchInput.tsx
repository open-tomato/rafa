import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';
import { Search, X } from 'lucide-react';

import { searchClearVariants, searchFieldVariants, searchIconVariants, searchInputVariants } from './Toolbar.variants.js';

/** The glyph sizes, in pixels. */
const SEARCH_ICON_SIZE = 16;
const CLEAR_ICON_SIZE = 15;

/** A search input's props: the controlled text, its change handler, the placeholder and the name. */
export interface SearchInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  /** Names the field for assistive technology. */
  readonly label?: string;
  /** Layout context from the parent (width, margin); never colour or size. */
  readonly className?: string;
}

/** The toolbar's search field: an icon, controlled text, an inline clear button once there is text. */
export function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search', className }: SearchInputProps): ReactElement {
  return (
    <div className={cn(searchFieldVariants(), className)}>
      <span className={searchIconVariants()}>
        <Search size={SEARCH_ICON_SIZE} aria-hidden="true" />
      </span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className={searchInputVariants({ clearable: value.length > 0 })}
      />
      {value.length > 0 && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className={searchClearVariants()}>
          <X size={CLEAR_ICON_SIZE} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
