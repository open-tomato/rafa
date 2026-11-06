import { cn } from '@open-tomato/charts';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import { Button } from '../../atoms/Button/Button.js';
import {
  CARD_SPANS,
  TIME_RANGES,
  cardDescriptorSchema,
  type CardDescriptor,
  type CardSpan,
  type TimeRange,
} from '../../contract/schemas.js';
import { RANGE_LABELS } from '../RangeSelector/RangeSelector.js';

import {
  configActionsVariants,
  configControlVariants,
  configErrorVariants,
  configFieldVariants,
  configFormVariants,
  configLabelVariants,
} from './ConfigView.variants.js';

/** The label each span shows. */
const SPAN_LABELS: Readonly<Record<CardSpan, string>> = { one: 'One column', two: 'Two columns', full: 'Full width' };

/** A config view's props: the descriptor to edit and what to do with the edit. */
export interface ConfigViewProps {
  readonly value: CardDescriptor;
  /** Called with the parsed descriptor when the form is applied. */
  readonly onSubmit: (next: CardDescriptor) => void;
  readonly onCancel?: () => void;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/** The form's draft: every field as the text its control holds. */
interface Draft {
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly range: TimeRange | '';
  readonly span: CardSpan | '';
}

/** The draft a descriptor starts the form with. */
function draftOf(value: CardDescriptor): Draft {
  return {
    title: value.title,
    subtitle: value.subtitle ?? '',
    description: value.description ?? '',
    range: value.range ?? '',
    span: value.span ?? '',
  };
}

/** A draft as a descriptor candidate: blank optional fields are left out. */
function candidateOf(draft: Draft): Record<string, string> {
  return Object.fromEntries(Object.entries(draft).filter(([key, text]) => key === 'title' || text !== ''));
}

/**
 * The Config modal's form over a card's descriptor: title, subtitle,
 * description, range and span. The modal mounts it per opening, so the
 * draft starts from the current descriptor each time; Apply parses it
 * with the contract's schema and reports the first problem per field.
 */
export function ConfigView({ value, onSubmit, onCancel, className }: ConfigViewProps): ReactElement {
  const [draft, setDraft] = useState<Draft>(() => draftOf(value));
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const field = (name: keyof Draft | 'problem'): string => `${id}-${name}`;
  const set = (name: keyof Draft) => (event: { readonly currentTarget: { readonly value: string } }): void => {
    const text = event.currentTarget.value;
    setDraft((current) => ({ ...current, [name]: text }));
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = cardDescriptorSchema.safeParse(candidateOf(draft));
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'The settings are not valid.');
      return;
    }
    setProblem(null);
    onSubmit(parsed.data);
  };

  return (
    <form aria-label="Card settings" className={cn(configFormVariants(), className)} onSubmit={submit} noValidate>
      <div className={configFieldVariants()}>
        <label htmlFor={field('title')} className={configLabelVariants()}>Title</label>
        <input
          id={field('title')}
          value={draft.title}
          onChange={set('title')}
          aria-invalid={problem !== null}
          aria-describedby={problem === null
            ? undefined
            : field('problem')}
          className={configControlVariants({ invalid: problem !== null })}
        />
        {problem !== null && <p id={field('problem')} role="alert" className={configErrorVariants()}>{problem}</p>}
      </div>
      <div className={configFieldVariants()}>
        <label htmlFor={field('subtitle')} className={configLabelVariants()}>Subtitle</label>
        <input id={field('subtitle')} value={draft.subtitle} onChange={set('subtitle')} className={configControlVariants()} />
      </div>
      <div className={configFieldVariants()}>
        <label htmlFor={field('description')} className={configLabelVariants()}>Description</label>
        <textarea id={field('description')} rows={3} value={draft.description} onChange={set('description')} className={configControlVariants()} />
      </div>
      <div className={configFieldVariants()}>
        <label htmlFor={field('range')} className={configLabelVariants()}>Range</label>
        <select id={field('range')} value={draft.range} onChange={set('range')} className={configControlVariants()}>
          <option value="">Default</option>
          {TIME_RANGES.map((range) => <option key={range} value={range}>{RANGE_LABELS[range]}</option>)}
        </select>
      </div>
      <div className={configFieldVariants()}>
        <label htmlFor={field('span')} className={configLabelVariants()}>Width</label>
        <select id={field('span')} value={draft.span} onChange={set('span')} className={configControlVariants()}>
          <option value="">Default</option>
          {CARD_SPANS.map((span) => <option key={span} value={span}>{SPAN_LABELS[span]}</option>)}
        </select>
      </div>
      <div className={configActionsVariants()}>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button variant="primary" type="submit">Apply</Button>
      </div>
    </form>
  );
}
