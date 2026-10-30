/**
 * Tests for `completeSpecBody` (`./spec-bodies.ts`), the filled issue
 * body three suites plant so that `rafa plan create` gets past the
 * readiness gate instead of being refused by it.
 *
 * The fixture is only worth having if it really answers no gap, and
 * nothing else would say so: a suite that planted a body the gate
 * refuses would fail on a refusal about the template rather than on its
 * own subject, and a reader chasing that failure would start in the
 * wrong module. So the first case reads `findReadinessGaps` over it
 * directly.
 *
 * ## What would pass while wrong
 *
 * A reading of an empty gap list proves nothing on its own, since a
 * check that never looked answers the same empty list. Each case here
 * therefore carries a control that breaks one thing and names the gap
 * that comes back. The heading case takes its headings from
 * `TEMPLATE_HEADINGS` rather than spelling them, so a heading ADDED to
 * the template reddens here — which is the failure this file exists to
 * turn from three confusing ones into one clear one.
 */
import { describe, expect, it } from 'bun:test';

import { findReadinessGaps, LIST_HEADINGS, TEMPLATE_HEADINGS } from '../board/readiness.js';

import { completeSpecBody } from './spec-bodies.js';

describe('the filled body three suites plant', () => {
  it('answers no readiness gap at all', () => {
    expect(findReadinessGaps(completeSpecBody('Issue 20'))).toEqual([]);
  });

  it('carries every template heading, and loses exactly the one taken out', () => {
    const body = completeSpecBody('Issue 20');

    for (const heading of TEMPLATE_HEADINGS) {
      expect(body).toContain(`## ${heading}\n`);

      // The control: with this heading cut out, the reading names it and
      // nothing else, so the case above is reading a check that fires.
      const without = body.replace(new RegExp(`## ${heading}\\n\\n[^#]*`, 'u'), '');
      expect(findReadinessGaps(without).map((gap) => `${gap.kind} ${gap.heading}`))
        .toEqual([`missing-heading ${heading}`]);
    }
  });

  it('puts a list item under each of the two headings a plan is written from', () => {
    const body = completeSpecBody('Issue 20');

    for (const heading of LIST_HEADINGS) {
      // The control: the item under this heading rewritten as prose is
      // the one gap the reading comes back with.
      const start = body.indexOf(`## ${heading}`);
      const section = body.slice(start).split('\n## ')[0] ?? '';
      const prose = body.replace(section, `## ${heading}\n\nA paragraph about the work.\n`);
      expect(findReadinessGaps(prose).map((gap) => `${gap.kind} ${gap.heading}`))
        .toEqual([`no-list-item ${heading}`]);
    }
  });

  it('spends the detail on the first heading, so two callers can differ without going thin', () => {
    const first = completeSpecBody('Issue 42', 'first body');
    const second = completeSpecBody('Issue 42', 'a different body');

    expect(first).toContain(`## ${String(TEMPLATE_HEADINGS[0])}\n\nfirst body\n`);
    expect(first).not.toBe(second);
    expect(findReadinessGaps(first)).toEqual([]);
    expect(findReadinessGaps(second)).toEqual([]);
  });

  it('titles the body as it is asked to, on the one line above the headings', () => {
    expect(completeSpecBody('The board routes').split('\n')[0]).toBe('# The board routes');
  });
});
