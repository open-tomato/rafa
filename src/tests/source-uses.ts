/**
 * Where a source reaches `console` or `process.exit` in its code, for the
 * cases holding a module to the active output
 * (`src/adapters/output/active.ts`).
 *
 * The source is parsed with TypeScript and walked, so a comment or a
 * string naming either is no reading. `loop-output.test.ts` holds the
 * control: a planted source holding each in code, in a comment and in a
 * string. `command-output.test.ts` reads the modules of the other phase 0
 * commands with the same walk.
 */
import ts from 'typescript';

/** The owner and member a property or element access names, or null for any other node. */
function accessOf(node: ts.Node): readonly [string, string] | null {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return [node.expression.text, node.name.text];
  }
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const member = ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : '[computed]';
    return [node.expression.text, member];
  }
  return null;
}

/**
 * Each `console` member and each `process.exit` in the code of a source,
 * as `<line>: <owner>.<member>`, in source order.
 */
export function consoleAndExitUses(source: string): string[] {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const access = accessOf(node);
    if (access !== null) {
      const [owner, member] = access;
      if (owner === 'console' || (owner === 'process' && member === 'exit')) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        found.push(`${line + 1}: ${owner}.${member}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
