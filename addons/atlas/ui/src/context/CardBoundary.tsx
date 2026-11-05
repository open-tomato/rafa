import { Component, type ErrorInfo, type ReactNode } from 'react';

import { CardStatus } from '../molecules/CardStatus/CardStatus.js';

import { toError } from './errors.js';

/** What a boundary shows once it caught: a node, or a function of the error and a reset. */
export type BoundaryFallback = ReactNode | ((error: Error, reset: () => void) => ReactNode);

/** A boundary's props: the error handler, the reset key, the fallback and the subtree it guards. */
export interface CardBoundaryProps {
  /** Told once per caught error, after React committed the fallback. */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
  /** A new value clears the caught error and renders the children again. */
  readonly resetKey?: unknown;
  /** Shown in place of the children after a throw; a status line by default. */
  readonly fallback?: BoundaryFallback;
  readonly children?: ReactNode;
}

/** The boundary's state: the caught error and the reset key it last saw. */
interface CardBoundaryState {
  readonly error: Error | null;
  readonly resetKey: unknown;
}

/** The status line a boundary shows when it has no fallback of its own. */
const DEFAULT_FALLBACK = <CardStatus kind="error" detail="The details are under the card menu's Errors item." />;

/**
 * The error concern of the cascade: a throw in the subtree (a chart, its
 * data, a handler during render) becomes the fallback instead of
 * unmounting the page, and `onError` hears of it so the card can list an
 * Errors entry. A new `resetKey`, or the `reset` a fallback function
 * receives, renders the children again. A class, since only a class can
 * be an error boundary.
 */
export class CardBoundary extends Component<CardBoundaryProps, CardBoundaryState> {
  override state: CardBoundaryState = { error: null, resetKey: undefined };

  static getDerivedStateFromError(thrown: unknown): Partial<CardBoundaryState> {
    return { error: toError(thrown) };
  }

  static getDerivedStateFromProps(props: CardBoundaryProps, state: CardBoundaryState): Partial<CardBoundaryState> | null {
    return Object.is(props.resetKey, state.resetKey)
      ? null
      : { error: null, resetKey: props.resetKey };
  }

  override componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    this.props.onError?.(toError(thrown), info);
  }

  /** Clears the caught error, so the children render again. */
  readonly reset: () => void = () => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const { fallback = DEFAULT_FALLBACK } = this.props;
    return typeof fallback === 'function'
      ? fallback(error, this.reset)
      : fallback;
  }
}
