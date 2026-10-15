import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindModule from '../tailwind.config.ts';

const tailwindConfig = tailwindModule.default ?? tailwindModule;

const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTER_SIZES = new Set(['0.75rem', '0.8125rem', '0.875rem', '0.9375rem']);
export const TYPE_ROLES = Object.freeze({
  'page-title': '400 1.625rem/1.2 var(--lume-font-voice)',
  person: '400 1.75rem/1.1 var(--lume-font-voice)',
  'person-compact': '400 1.625rem/1.1 var(--lume-font-voice)',
  'person-preview': '400 1.375rem/1.2 var(--lume-font-voice)',
  prose: '400 1.0625rem/1.5 var(--lume-font-voice)',
  brand: '500 1.3125rem/1.2 var(--lume-font-voice)',
  body: '400 0.875rem/1.5 var(--lume-font-sans)',
  strong: '600 0.875rem/1.5 var(--lume-font-sans)',
  threshold: '600 0.9375rem/1.5 var(--lume-font-sans)',
  meta: '400 0.8125rem/1.5 var(--lume-font-sans)',
  section: '600 0.75rem/1.5 var(--lume-font-sans)',
  code: '400 0.75rem/1.5 var(--font-registro), monospace',
});

// Zero hides a word in the collapsed rail; it never renders visible text.
export const TYPE_ALLOWLIST = Object.freeze([
  { path: 'components/runtime-twin-workspace.module.css', selector: ".workspace[data-rail-open='false'] .brand strong", property: 'font-size', value: '0', reason: 'Marchio contratto nella navigazione chiusa.' },
  { path: 'components/kree8/kree8-clinical-cockpit-shell.module.css', selector: '.commandToolChip', property: 'font-size', value: '0', reason: 'Etichetta nascosta nella navigazione compatta storica.' },
]);

const forbiddenUtilities = /\b(?:font-(?:bold|extrabold|black|serif|mono)|text-(?:xl|[2-9]xl|[23]xs|micro)|(?:text|font)-\[(?:[\d.]|length:|size:|family:|weight:)[^\]]*\])/g;
const typeVariable = /^var\(--type-([a-z-]+)\)$/;
const sizeVariable = /^var\(--twin-type-(?:section|subsection|body|caption)(?:, (?:0\.75|0\.8125|0\.875|0\.9375)rem)?\)$/;

export function scanTypeSource(relativePath, source, allowlist = TYPE_ALLOWLIST) {
  const problems = [];
  const report = (line, value) => problems.push({ path: relativePath, line, value });
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
  for (const match of clean.matchAll(forbiddenUtilities)) {
    // CSS custom property --font-serif is the family token, not a utility.
    if (clean.slice(Math.max(0, match.index - 2), match.index) === '--') continue;
    report(clean.slice(0, match.index).split('\n').length, match[0]);
  }
  if (relativePath.endsWith('.css')) {
    const tree = postcss.parse(source, { from: relativePath });
    tree.walkDecls(declaration => {
      const { prop, value } = declaration;
      if (allowlist.some(entry => entry.path === relativePath && entry.selector === declaration.parent.selector
        && entry.property === prop && entry.value === value)) return;
      let valid = true;
      if (prop.startsWith('--type-')) valid = relativePath === 'app/globals.css' && TYPE_ROLES[prop.slice(7)] === value;
      else if (prop.startsWith('--twin-type-')) valid = relativePath === 'app/runtime-twin.css' && REGISTER_SIZES.has(value);
      else if (prop === '--twin-heading-weight') valid = value === '600';
      else if (prop === 'font-size') valid = REGISTER_SIZES.has(value) || value === 'inherit' || sizeVariable.test(value);
      else if (prop === 'font-weight') valid = ['400', '600', 'inherit', 'var(--twin-heading-weight)'].includes(value);
      else if (prop === 'font') {
        const role = typeVariable.exec(value)?.[1];
        valid = value === 'inherit' || Boolean(role && TYPE_ROLES[role])
          || /^(?:(?:400|600) )?0\.(?:75|8125|875|9375)rem(?:\/[\d.]+)? var\(--lume-font-sans\)$/.test(value);
      }
      else if (prop === 'font-family') valid = value === 'inherit' || /^var\(--lume-font-sans(?:, [^)]+)?\)$/.test(value);
      if (!valid) report(declaration.source.start.line, `${prop}: ${value}`);
    });
  } else {
    for (const match of clean.matchAll(/\b(fontSize|fontWeight|fontFamily)\s*:\s*([^,}\n]+)/g)) {
      const value = match[2].trim().replace(/^['"]|['"]$/g, '');
      const valid = match[1] === 'fontSize' ? REGISTER_SIZES.has(value)
        : match[1] === 'fontWeight' ? ['400', '600'].includes(value) : value === 'var(--lume-font-sans)';
      if (!valid) report(clean.slice(0, match.index).split('\n').length, match[0]);
    }
  }
  return problems;
}

export function checkTailwindScale(config) {
  const problems = [];
  const sizes = { xs: '0.75rem', sm: '0.8125rem', base: '0.875rem', lg: '0.9375rem', xl: '1.625rem', '2xl': '1.625rem', '3xl': '1.625rem', '4xl': '1.625rem' };
  for (const [utility, size] of Object.entries(sizes)) {
    if (config.theme?.fontSize?.[utility]?.[0] !== size) problems.push(`text-${utility}: atteso ${size}`);
  }
  for (const [utility, weight] of Object.entries({ thin: '400', extralight: '400', light: '400', normal: '400', medium: '400', semibold: '600', bold: '600', extrabold: '600', black: '600' })) {
    if (config.theme?.fontWeight?.[utility] !== weight) problems.push(`font-${utility}: atteso ${weight}`);
  }
  return problems;
}

export function scanTypeScale(root = ROOT) {
  const problems = checkTailwindScale(tailwindConfig).map(value => ({ path: 'tailwind.config.ts', line: 1, value }));
  function visit(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (/\.(?:css|[jt]sx?)$/.test(file) && !/\.(?:test|spec)\.[jt]sx?$/.test(file)) problems.push(...scanTypeSource(file, readFileSync(path.join(root, file), 'utf8')));
    }
  }
  visit('app'); visit('components');
  const globals = postcss.parse(readFileSync(path.join(root, 'app/globals.css'), 'utf8'));
  if (!globals.nodes.some(node => node.type === 'atrule' && node.name === 'config' && node.params === '"../tailwind.config.ts"')) {
    problems.push({ path: 'app/globals.css', line: 1, value: 'Configurazione Tailwind non collegata' });
  }
  for (const role of Object.keys(TYPE_ROLES)) {
    let count = 0;
    globals.walkDecls(`--type-${role}`, () => count++);
    if (count !== 1) problems.push({ path: 'app/globals.css', line: 1, value: `--type-${role}: attesa una definizione, trovate ${count}` });
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = scanTypeScale();
  for (const issue of problems) console.error(`${issue.path}:${issue.line}: ${issue.value}`);
  console.log(`Scala tipografica: ${problems.length ? `${problems.length} violazioni` : 'OK'}`);
  process.exitCode = problems.length ? 1 : 0;
}
