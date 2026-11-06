/**
 * ot/cva-only-classname
 *
 * A component's classes live in its `{C}.variants.ts` file as `cva` calls,
 * so a `className` JSX attribute may hold only one of three values:
 *
 *   - a variants call: `className={cardVariants({ tone })}`, any callee
 *     whose name ends in `Variants`;
 *   - a `cn(...)` call whose arguments are themselves variants calls or
 *     the passthrough `className` identifier, alone or behind a `&&`,
 *     `||`, `??` or a ternary: `cn(cardVariants({ tone }), className)`;
 *   - the passthrough `className` identifier, handed on unchanged.
 *
 * A string literal, a template literal, or any other expression is an
 * ad-hoc class and is refused. `react.mjs` registers the rule for TSX and
 * JSX files and leaves out `templates/`, `pages/`, `*.stories.tsx` and
 * `*.test.tsx`, where a layout class is the point.
 */

/** The passthrough prop a component merges last. */
const PASSTHROUGH = 'className';

/** The class merger from `src/lib/cn.ts`. */
const MERGER = 'cn';

/** A variants function, as `cva` calls are named by convention. */
const VARIANTS_CALLEE = /Variants$/;

/** The callee's name, for a plain identifier callee; `undefined` otherwise. */
function calleeName(node) {
  return node.type === 'CallExpression' && node.callee.type === 'Identifier'
    ? node.callee.name
    : undefined;
}

/** A variants call: `xVariants(...)`. */
function isVariantsCall(node) {
  const name = calleeName(node);
  return name !== undefined && VARIANTS_CALLEE.test(name);
}

/** The passthrough identifier: `className`. */
function isPassthrough(node) {
  return node.type === 'Identifier' && node.name === PASSTHROUGH;
}

/** An argument `cn` may take: a variants call or the passthrough, alone or behind a condition. */
function isMergeable(node) {
  if (isVariantsCall(node) || isPassthrough(node)) return true;
  if (node.type === 'LogicalExpression') return isMergeable(node.right);
  if (node.type === 'ConditionalExpression') return isMergeable(node.consequent) && isMergeable(node.alternate);
  return false;
}

/** A `cn(...)` call whose every argument is mergeable. */
function isMergeCall(node) {
  return calleeName(node) === MERGER && node.arguments.every(isMergeable);
}

/** Whether a `className` attribute's expression is one of the three allowed values. */
function isAllowedValue(expression) {
  return isVariantsCall(expression) || isMergeCall(expression) || isPassthrough(expression);
}

export const cvaOnlyClassName = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Allow a className JSX attribute only as a CVA variants call, a cn() over variants and the passthrough className, or the passthrough itself.',
    },
    schema: [],
    messages: {
      adHoc:
        'className holds an ad-hoc value. Put the classes in the component\'s .variants.ts as a cva call and pass {{hint}} instead.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== PASSTHROUGH) return;
        const { value } = node;
        const allowed = value !== null
          && value.type === 'JSXExpressionContainer'
          && value.expression.type !== 'JSXEmptyExpression'
          && isAllowedValue(value.expression);
        if (allowed) return;
        context.report({
          node,
          messageId: 'adHoc',
          data: { hint: 'xVariants(...), cn(xVariants(...), className) or className' },
        });
      },
    };
  },
};

export default {
  meta: { name: 'ot' },
  rules: { 'cva-only-classname': cvaOnlyClassName },
};
