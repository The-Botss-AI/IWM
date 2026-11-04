/**
 * Static check, no database: every HTTP route declares how it is authorized.
 *
 * PermissionsGuard denies a route that carries none of `@RequireAbility`,
 * `@SkipPermissions` (the service checks), `@Public` or `@PortalRoute` (on
 * the handler or its controller). This scan fails the build first, so a
 * forgotten decorator shows up here instead of as a 403 in production, and a
 * new route can never pass on login alone again.
 *
 * Run: pnpm --filter @botss/api test
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';

const HTTP_METHODS = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'All',
  'Head',
  'Options',
  'Sse',
]);
const DECLARATIONS = new Set(['RequireAbility', 'SkipPermissions', 'Public', 'PortalRoute']);

function decoratorNames(node: ts.Node): string[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).map((d) => {
    const expr = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
    return expr.getText();
  });
}

const srcRoot = resolve(__dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return name.endsWith('.controller.ts') ? [p] : [];
  });

const undeclared: string[] = [];
let routes = 0;
for (const file of walk(srcRoot)) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const classDeclared = decoratorNames(node).some((n) => DECLARATIONS.has(n));
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const names = decoratorNames(member);
        if (!names.some((n) => HTTP_METHODS.has(n))) continue;
        routes += 1;
        if (classDeclared || names.some((n) => DECLARATIONS.has(n))) continue;
        const at = sf.getLineAndCharacterOfPosition(member.getStart());
        undeclared.push(`${relative(srcRoot, file)}:${at.line + 1} ${member.name.getText()}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

assert.ok(routes > 300, `expected the controllers to define 300+ routes, found ${routes}`);
assert.deepEqual(
  undeclared,
  [],
  `Routes without @RequireAbility, @SkipPermissions, @Public or @PortalRoute ` +
    `(PermissionsGuard refuses them):\n${undeclared.join('\n')}`,
);

console.log(`route-permissions: OK (${routes} routes)`);
