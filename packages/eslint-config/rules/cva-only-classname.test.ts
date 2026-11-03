/**
 * Tests for `ot/cva-only-classname`: ESLint's `RuleTester` over TSX
 * snippets, wired to bun's `describe` and `it` so each case is one bun
 * test. The valid cases are the three allowed values and the conditional
 * forms `cn` may take; the invalid cases are the ad-hoc values the rule
 * exists to refuse.
 */
import * as tsParser from '@typescript-eslint/parser';
import { describe, it } from 'bun:test';
import { RuleTester } from 'eslint';

import { cvaOnlyClassName } from './cva-only-classname.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/** One TSX snippet: a component returning `jsx`. */
function component(jsx: string): string {
  return `export function C({ className, tone, open }: Props) { return ${jsx}; }`;
}

const AD_HOC = [{ messageId: 'adHoc' }];

tester.run('ot/cva-only-classname', cvaOnlyClassName, {
  valid: [
    { code: component('<div className={cardVariants({ tone })} />') },
    { code: component('<div className={cn(cardVariants({ tone }), className)} />') },
    { code: component('<div className={className} />') },
    { code: component('<div className={cn(cardVariants(), open && openVariants(), className)} />') },
    { code: component('<div className={cn(open ? openVariants() : shutVariants(), className)} />') },
    { code: component('<div />') },
  ],
  invalid: [
    { code: component('<div className="p-4" />'), errors: AD_HOC },
    { code: component('<div className={\'p-4\'} />'), errors: AD_HOC },
    { code: component('<div className={`p-4 ${className}`} />'), errors: AD_HOC },
    { code: component('<div className={cn(\'p-4\', className)} />'), errors: AD_HOC },
    { code: component('<div className={cn(cardVariants(), open && \'ring-2\')} />'), errors: AD_HOC },
    { code: component('<div className={styles.card} />'), errors: AD_HOC },
    { code: component('<div className={clsx(cardVariants())} />'), errors: AD_HOC },
  ],
});
