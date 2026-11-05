/**
 * Types for `cva-only-classname.mjs`, the `ot/cva-only-classname` rule, so
 * its TypeScript test reads the exports typed rather than as an implicit
 * `any`.
 */
import type { ESLint, Rule } from 'eslint';

/** The rule itself. */
export declare const cvaOnlyClassName: Rule.RuleModule;

/** The plugin registered as `ot` by `react.mjs`. */
declare const plugin: ESLint.Plugin;
export default plugin;
