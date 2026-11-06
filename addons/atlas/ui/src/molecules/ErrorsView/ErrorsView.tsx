import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';
import { RotateCcw } from 'lucide-react';

import { Button } from '../../atoms/Button/Button.js';

import { errorsMessageVariants, errorsStackVariants, errorsViewVariants } from './ErrorsView.variants.js';

/** The retry icon's size, in pixels. */
const RETRY_ICON_SIZE = 12;

/** An errors view's props: the error, whether to show its stack, and the retry. */
export interface ErrorsViewProps {
  readonly error: Error;
  /** Show the stack under the message; on by default. */
  readonly showStack?: boolean;
  /** Clears the error and renders the card again; without it there is no Try again. */
  readonly onRetry?: () => void;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/** What a card's boundary caught: the name and message, the stack, and Try again. */
export function ErrorsView({ error, showStack = true, onRetry, className }: ErrorsViewProps): ReactElement {
  return (
    <div className={cn(errorsViewVariants(), className)}>
      <p className={errorsMessageVariants()}>{error.name}: {error.message}</p>
      {showStack && error.stack && <pre className={errorsStackVariants()}>{error.stack}</pre>}
      {onRetry && (
        <Button onClick={onRetry}>
          <RotateCcw size={RETRY_ICON_SIZE} aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}
