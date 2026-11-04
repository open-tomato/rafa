import type { CardSpec } from '../contract/schemas.js';

import { createContext, use, useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

/** What `useCardSpec()` answers: the card's spec and a way to change it. */
export interface CardSpecHandle {
  readonly config: CardSpec;
  /** Replaces the spec: the owner's `onChange` when controlled, the provider's own state otherwise. */
  readonly update: (next: CardSpec) => void;
}

const CardSpecContext = createContext<CardSpecHandle | null>(null);

/** The spec layer's props: the descriptor, an optional change handler, and the card below. */
export interface CardSpecProviderProps {
  /** The descriptor; the starting value when uncontrolled, the value itself when `onChange` is set. */
  readonly value: CardSpec;
  /** Makes the provider controlled: an edit is handed here and the owner passes the new `value` back. */
  readonly onChange?: (next: CardSpec) => void;
  readonly children?: ReactNode;
}

/**
 * The spec concern of the cascade: the card's static descriptor (title,
 * chart, options, menu) for every layer below, through `useCardSpec()`.
 * Uncontrolled, it keeps edits in its own state, seeded from `value`
 * and reseeded whenever the owner hands it a new `value`, so a page can
 * change a card's title or note after mount without a new `key`.
 */
export function CardSpecProvider({ value, onChange, children }: CardSpecProviderProps): ReactElement {
  const [own, setOwn] = useState(value);
  const [seed, setSeed] = useState(value);
  if (value !== seed) {
    setSeed(value);
    setOwn(value);
  }
  const config = onChange === undefined
    ? own
    : value;
  const update = useCallback((next: CardSpec) => {
    if (onChange === undefined) setOwn(next);
    else onChange(next);
  }, [onChange]);
  const handle = useMemo(() => ({ config, update }), [config, update]);
  return <CardSpecContext value={handle}>{children}</CardSpecContext>;
}

/** The enclosing card's spec; throws outside a `CardSpecProvider`. */
export function useCardSpec(): CardSpecHandle {
  const handle = use(CardSpecContext);
  if (handle === null) throw new Error('useCardSpec() needs a <CardSpecProvider> above it.');
  return handle;
}
