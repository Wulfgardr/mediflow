/* @Codex: repeatable static UI inventory. Candidates are not a claim that every
   branch is visible at runtime, nor that every dynamic label is covered. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = process.cwd();
const output = path.resolve(process.argv[2] || 'tmp-086-twin/ui-copy-inventory.tsv');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const roots = walk(path.join(root, 'app')).filter(file => /\/(page|layout)\.tsx$/.test(file) && !file.includes('/mockups/') && !file.includes('/api/'));
const pending = [...roots]; const visited = new Set(); const rows = [];
const uiKeys = new Set(['title', 'label', 'description', 'placeholder', 'aria-label', 'summary', 'kicker', 'eyebrow', 'subtitle', 'backLabel', 'patientLabel', 'statusLabel', 'helpText', 'emptyMessage', 'confirmLabel', 'cancelLabel']);
function resolveImport(from, spec) {
  const stem = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!stem) return null;
  return ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map(suffix => stem + suffix).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
}
for (let file; (file = pending.pop());) {
  if (visited.has(file) || !/\.tsx?$/.test(file)) continue;
  visited.add(file);
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const record = (node, kind, value) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || !/[\p{L}]/u.test(text)) return;
    rows.push([path.relative(root, file), source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind, text]);
  };
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const next = resolveImport(file, node.moduleSpecifier.text); if (next) pending.push(next);
    }
    if (ts.isJsxText(node)) record(node, 'jsx-text', node.text);
    if (ts.isJsxAttribute(node) && uiKeys.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) record(node, `attribute:${node.name.getText(source)}`, node.initializer.text);
    if (ts.isJsxExpression(node) && node.expression) {
      const collect = part => {
        if (ts.isStringLiteral(part) || ts.isNoSubstitutionTemplateLiteral(part)) record(part, 'jsx-expression-literal', part.text);
        else if (ts.isConditionalExpression(part)) { collect(part.whenTrue); collect(part.whenFalse); }
      }; collect(node.expression);
    }
    if (ts.isPropertyAssignment(node) && uiKeys.has(node.name.getText(source).replace(/['"]/g, '')) && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) record(node, `copy-property:${node.name.getText(source)}`, node.initializer.text);
    ts.forEachChild(node, visit);
  }; visit(source);
}
rows.sort((a,b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, [['source','line','kind','text'],...rows].map(row => row.map(cell => String(cell).replace(/[\t\r\n]/g,' ')).join('\t')).join('\n')+'\n');
const coverage = { roots: roots.length, reachableSourceFiles: visited.size, candidateStrings: rows.length, filesWithCopy: new Set(rows.map(row=>row[0])).size, limitations: ['Static candidates include conditional, hidden and non-rendered branches.', 'Dynamic strings from data, translation, template concatenation and runtime services require separate review.', 'Inventory is not evidence of copy approval or tested UI coverage.'] };
fs.writeFileSync(output.replace(/\.tsv$/, '.json'), JSON.stringify(coverage,null,2)+'\n');
console.log(JSON.stringify(coverage));
