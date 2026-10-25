// Turns the extracted game script (plain JS written for a classic <script>)
// into src/game.ts. Every rule is mechanical and keeps line breaks intact, so
// line N of game.js is always line N + HEADER_LINES of game.ts.
//
// Rules (each fixes one class of TypeScript error without changing behaviour):
//   params   every plain parameter becomes optional (`x` -> `x?`); the code
//            calls helpers with fewer arguments all the time.
//   literals `const a = {...}` / `[...]` gets a type: the one named in
//            config.annotations, else `any` / `any[]`. The code adds
//            properties to these objects after creating them.
//   expando  `fn.prop` on a function declaration becomes `(fn as any).prop`
//            (the code caches values on functions, e.g. `hud.l`).
//   rebind   assigning to a function declaration (`build = ...`) becomes
//            `(build as any) = ...`.
//   boolnum  a comparison or `!x` used in arithmetic gets a unary plus,
//            `1 + (a < b)` -> `1 + +(a < b)`, which is what JS did anyway.
//   tuples   an inline array of mixed [number, string] rows is cast to any[].
//   replace  exact-text substitutions from config.replace (e.g. the model
//            data now comes from an import instead of a <script> tag).
import * as acorn from 'acorn';

const ARITH = new Set(['+', '-', '*', '/', '%', '**']);
const COMPARE = new Set(['<', '>', '<=', '>=', '==', '!=', '===', '!==', 'in', 'instanceof']);
const FN_BUILTINS = new Set(['call', 'apply', 'bind', 'name', 'length', 'toString', 'prototype']);

function walk(node, visit, parent = null) {
  visit(node, parent);
  for (const key in node) {
    if (key === 'start' || key === 'end' || key === 'type') continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, node) }
    else if (v && typeof v.type === 'string') walk(v, visit, node);
  }
}

export function toTs(js, config) {
  const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
  const edits = [], warnings = [], counts = { params: 0, literals: 0, expando: 0, rebind: 0, boolnum: 0, tuples: 0, replace: 0 };
  const ins = (at, text, rule) => { edits.push({ start: at, end: at, text }); if (rule) counts[rule]++ };
  const rep = (start, end, text, rule) => { edits.push({ start, end, text }); if (rule) counts[rule]++ };

  const fnNames = new Set();
  walk(ast, n => { if (n.type === 'FunctionDeclaration' && n.id) fnNames.add(n.id.name) });

  walk(ast, (n, parent) => {
    switch (n.type) {
      case 'FunctionDeclaration':
        if (parent && parent.type !== 'Program' && !(parent.type === 'BlockStatement' && parent.isFnBody))
          warnings.push(`function ${n.id.name} is declared inside a block; ES modules scope it to that block (classic scripts did not)`);
      // fallthrough
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        if (n.body && n.body.type === 'BlockStatement') n.body.isFnBody = true;
        // `x => ...` and `async x => ...` have no parentheses to put `?` inside.
        const bare = n.type === 'ArrowFunctionExpression' && n.params.length === 1 && !js.slice(n.start, n.params[0].start).includes('(');
        for (const p of n.params) {
          if (p.type !== 'Identifier') continue;
          if (bare) rep(p.start, p.end, `(${p.name}?)`, 'params');
          else ins(p.end, '?', 'params');
        }
        break;
      }
      case 'VariableDeclarator': {
        if (n.id.type !== 'Identifier') break;
        const named = parent && parent.topLevel && config.annotations[n.id.name];
        if (named) ins(n.id.end, `: ${named}`, 'literals');
        else if (n.init && n.init.type === 'ObjectExpression') ins(n.id.end, ': any', 'literals');
        else if (n.init && n.init.type === 'ArrayExpression') ins(n.id.end, ': any[]', 'literals');
        break;
      }
      case 'VariableDeclaration':
        if (parent && parent.type === 'Program') n.topLevel = true;
        break;
      case 'MemberExpression':
        if (n.object.type === 'Identifier' && fnNames.has(n.object.name) && !(n.property.type === 'Identifier' && !n.computed && FN_BUILTINS.has(n.property.name)))
          rep(n.object.start, n.object.end, `(${n.object.name} as any)`, 'expando');
        break;
      case 'AssignmentExpression':
        if (n.left.type === 'Identifier' && fnNames.has(n.left.name)) rep(n.left.start, n.left.end, `(${n.left.name} as any)`, 'rebind');
        break;
      case 'ArrayExpression': {
        // Inline tables of mixed tuples, `[[1, 'armR'], [-1, 'armL']].forEach(([s, k]) => ...)`:
        // TS widens each tuple to (string | number)[], so cast the table to any[].
        if (parent && parent.type === 'VariableDeclarator') break;
        const rows = n.elements.filter(e => e && e.type === 'ArrayExpression');
        const kinds = new Set(rows.flatMap(r => r.elements.filter(e => e && e.type === 'Literal').map(e => typeof e.value)));
        if (rows.length && rows.length === n.elements.length && kinds.has('string') && kinds.has('number')) {
          ins(n.start, '(', 'tuples'); ins(n.end, ' as any[])');
        }
        break;
      }
      case 'BinaryExpression':
        if (ARITH.has(n.operator)) for (const side of [n.left, n.right]) {
          const boolish = (side.type === 'BinaryExpression' && COMPARE.has(side.operator)) || (side.type === 'UnaryExpression' && side.operator === '!') || (side.type === 'Literal' && typeof side.value === 'boolean');
          if (boolish) { ins(side.start, '+(', 'boolnum'); ins(side.end, ')') }
        }
        break;
    }
  });

  for (const r of config.replace) {
    const at = js.indexOf(r.find);
    if (at < 0) { warnings.push(`replace: text not found, check by hand: ${r.find}`); continue }
    if (js.indexOf(r.find, at + 1) >= 0) warnings.push(`replace: text occurs more than once, only the first was replaced: ${r.find}`);
    rep(at, at + r.find.length, r.with, 'replace');
  }

  // Apply right to left. At the same position, replacements go before
  // insertions so an inserted prefix lands in front of the replaced text.
  edits.sort((a, b) => b.start - a.start || (b.end - b.start) - (a.end - a.start));
  let out = js;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  const header = config.header.join('\n') + '\n';
  return { code: header + out, warnings, counts, headerLines: config.header.length };
}
