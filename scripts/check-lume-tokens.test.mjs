import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  parseHexColor,
  contrastRatio,
  mixHexColors,
  resolveColor,
  evaluateContract,
  formatReport,
  loadTokens,
  loadCssMirror,
  loadGlobalStyles,
  parseCssBlocks,
  expectedMirror,
  verifyCssMirror,
  verifyGlobalStyles,
  ACTIVE_ALIASES,
  PALETTE_ALLOWLIST,
  paletteFingerprint,
  scanPalette,
  scanPaletteSource,
} from './check-lume-tokens.mjs';

// Minimal well-formed tokens covering every path the contract references.
function validTokens() {
  const register = (surface, ink, accent) => ({
    surface: {
      canvas: { $value: surface[0] },
      field: { $value: surface[1] },
      focal: { $value: surface[2] },
      chrome: { $value: surface[3] },
    },
    ink: { primary: { $value: ink[0] }, muted: { $value: ink[1] } },
    accent: { minerale: { $value: accent } },
  });
  return {
    register: {
      giorno: register(['#eef0f2', '#f5f5f4', '#fbfaf7', '#e6e8eb'], ['#1a1c1e', '#5c6772'], '#33506b'),
      grafite: register(['#121417', '#191c21', '#22252b', '#0e1013'], ['#e9ecef', '#8f9aa6'], '#8fb0cc'),
      guardia: register(['#0c0e12', '#14171d', '#1a1e26', '#090b0e'], ['#e3e8ee', '#8792a3'], '#7fa0bc'),
    },
    signal: {
      warning: { $value: '#9a6a2f' },
      critical: { $value: '#a33a2f' },
      success: { $value: '#4b6354' },
      plum: { $value: '#555161' },
    },
  };
}

test('WCAG primitives match known reference values', () => {
  // Black on white is the canonical 21:1 pair; equal colors are 1:1.
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(contrastRatio('#abcdef', '#abcdef'), 1);
  assert.deepEqual(parseHexColor('#33506b'), { r: 0x33, g: 0x50, b: 0x6b });
  assert.equal(mixHexColors('#ffffff', 0.5, '#000000'), '#808080');
  assert.throws(() => mixHexColors('#ffffff', 1.1, '#000000'), /invalid color-mix weight/);
});

test('committed token source passes the whole contract', () => {
  const result = evaluateContract(loadTokens());
  assert.equal(result.pass, true);
  assert.equal(result.checks.length, 42); // 3 registers x (2 ink x 4 surface + 2 accent + 4 signal recipes)
  assert.ok(result.checks.every((c) => c.ratio >= c.minRatio));
  // The adjusted binding pair: giorno muted on chrome clears 4.5 with margin.
  const bind = result.checks.find(
    (c) => c.register === 'giorno' && c.label === 'ink.muted on surface.chrome',
  );
  assert.equal(bind.ratio.toFixed(3), '4.702');
  const warningTint = result.checks.find(
    (c) => c.register === 'giorno' && c.label === 'signal.warning text on 10% signal tint',
  );
  assert.equal(warningTint.ratio.toFixed(3), '6.579');
  assert.ok(
    result.checks
      .filter((c) => c.signal)
      .every((c) => c.ratio >= 4.5 && c.measuredText && c.measuredBackground),
  );
  assert.match(formatReport(result), /CONTRACT VIOLATED|OK/);
});

test('inline valid tokens pass and report is deterministic', () => {
  const result = evaluateContract(validTokens());
  assert.equal(result.pass, true);
  assert.equal(formatReport(result), formatReport(evaluateContract(validTokens())));
});

test('missing required token fails closed', () => {
  const broken = validTokens();
  delete broken.signal.warning;
  assert.throws(() => evaluateContract(broken), /missing token: signal\.warning/);
  assert.throws(() => resolveColor(broken, 'signal.warning'), /missing token/);
});

test('malformed color value fails closed', () => {
  const broken = validTokens();
  broken.register.grafite.surface.focal.$value = 'rgb(1,2,3)';
  assert.throws(() => evaluateContract(broken), /malformed color/);
  assert.throws(() => parseHexColor('#fff'), /malformed color/);
});

test('a deliberately low-contrast pair is reported as a violation', () => {
  const failing = validTokens();
  // Muted on chrome lifted to near-chrome luminance drops well below 4.5:1.
  failing.register.giorno.ink.muted.$value = '#c8ccd0';
  const result = evaluateContract(failing);
  assert.equal(result.pass, false);
  const bad = result.checks.find(
    (c) => c.register === 'giorno' && c.label === 'ink.muted on surface.chrome',
  );
  assert.equal(bad.pass, false);
  assert.ok(bad.ratio < 4.5);
  assert.match(formatReport(result), /CONTRACT VIOLATED/);
});

// CSS mirror (app/lume-tokens.css)
test('parseCssBlocks strips comments and reads namespaced + alias declarations', () => {
  const blocks = parseCssBlocks('/* x */\n:root { --lume-a: #fff; --lume-b: var(--lume-a); }');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].selector, ':root');
  assert.equal(blocks[0].decls.get('--lume-a'), '#fff');
  assert.equal(blocks[0].decls.get('--lume-b'), 'var(--lume-a)');
});

test('committed CSS mirror matches the committed token source', () => {
  const summary = verifyCssMirror(loadTokens(), loadCssMirror());
  // 3 registers x (4 surface + 2 ink + 1 accent) + 4 signals.
  assert.equal(summary.tokens, expectedMirror(loadTokens()).size);
  assert.equal(summary.tokens, 25);
  assert.equal(summary.aliases, ACTIVE_ALIASES.length);
});

test('a drifted mirror value fails closed', () => {
  const css = loadCssMirror().replace('--lume-giorno-surface-canvas: #eef0f2;', '--lume-giorno-surface-canvas: #ffffff;');
  assert.throws(() => verifyCssMirror(loadTokens(), css), /mirror drift: --lume-giorno-surface-canvas/);
  assert.throws(() => verifyCssMirror(loadTokens(), `${css}\n:root { --lume-giorno-surface-canvas: #eef0f2 }`), /duplicate token/);
});

test('a mirror missing a namespaced token fails closed', () => {
  const css = loadCssMirror().replace('--lume-grafite-ink-muted: #8f9aa6;', '');
  assert.throws(() => verifyCssMirror(loadTokens(), css), /mirror missing token: --lume-grafite-ink-muted/);
});

test('a mirror missing the :root (giorno) active alias fails closed', () => {
  const css = loadCssMirror().replace('--lume-surface-canvas: var(--lume-giorno-surface-canvas);', '');
  assert.throws(() => verifyCssMirror(loadTokens(), css), /missing active alias --lume-surface-canvas in :root\/giorno/);
});

test('a mirror whose .dark alias points at the wrong register fails closed', () => {
  const css = loadCssMirror().replace('--lume-ink: var(--lume-grafite-ink-primary);', '--lume-ink: var(--lume-giorno-ink-primary);');
  assert.throws(() => verifyCssMirror(loadTokens(), css), /alias --lume-ink in \.dark\/grafite/);
});

// @Codex WUL-515
test('committed global CSS pins the listed semantic, scrim and shadow source recipes', () => {
  const summary = verifyGlobalStyles(loadGlobalStyles());
  assert.deepEqual(summary, { recipes: 11, semanticRecipes: 7, scrimRecipes: 2, shadowRecipes: 2 });
  assert.equal(PALETTE_ALLOWLIST.some((entry) => entry.path === 'app/globals.css'), false);
  const palette = scanPaletteSource({
    relativePath: 'app/globals.css',
    source: loadGlobalStyles(),
    tokens: loadTokens(),
  });
  assert.deepEqual(palette.violations, []);
  assert.deepEqual(palette.allowlistIssues, []);
});

test('global CSS rejects raw warning text instead of the measured 60% recipe', () => {
  const css = loadGlobalStyles().replace(
    'color: color-mix(in srgb, var(--lume-signal-warning) 60%, var(--lume-ink));',
    'color: var(--lume-signal-warning);',
  );
  assert.throws(() => verifyGlobalStyles(css), /global CSS \.graphite-chip-tone-warning color is var\(--lume-signal-warning\)/);
});

test('global CSS fails closed when a required selector or declaration is missing', () => {
  const missingSelector = loadGlobalStyles().replace('.mf-alert-critical {', '.mf-alert-critical-missing {');
  assert.throws(() => verifyGlobalStyles(missingSelector), /global CSS requires exactly one \.mf-alert-critical rule/);

  const missingDeclaration = loadGlobalStyles().replace(
    '.mf-alert-success {\n  border-color: color-mix(in srgb, var(--lume-signal-success) 30%, transparent);\n',
    '.mf-alert-success {\n',
  );
  assert.throws(() => verifyGlobalStyles(missingDeclaration), /global CSS \.mf-alert-success missing border-color/);
});

test('global CSS rejects conditional recipes, override selectors and cascade shorthands', () => {
  const conditional = loadGlobalStyles().replace(
    /(\.mf-alert-critical \{[^}]+\})/,
    '@media print { $1 }',
  );
  assert.throws(() => verifyGlobalStyles(conditional), /global CSS \.mf-alert-critical must not be conditional/);

  const override = `${loadGlobalStyles()}\n.dark .mf-alert-warning { color: var(--lume-ink) !important; }\n`;
  assert.throws(() => verifyGlobalStyles(override), /global CSS \.mf-alert-warning has a non-canonical override selector/);

  const shorthand = loadGlobalStyles().replace(
    '.mf-alert-success {',
    '.mf-alert-success {\n  background: transparent;',
  );
  assert.throws(() => verifyGlobalStyles(shorthand), /global CSS \.mf-alert-success has an interfering background shorthand/);
});

test('global CSS protects scrim and shadow selectors from conditional or non-canonical overrides', () => {
  const conditionalScrim = loadGlobalStyles().replace(
    /(\.mf-modal-backdrop \{[^}]+\})/,
    '@media print { $1 }',
  );
  assert.throws(() => verifyGlobalStyles(conditionalScrim), /global CSS \.mf-modal-backdrop must not be conditional/);

  const shadowOverride = `${loadGlobalStyles()}\n.dark .mf-popover { box-shadow: none; }\n`;
  assert.throws(() => verifyGlobalStyles(shadowOverride), /global CSS \.mf-popover has a non-canonical override selector/);
});

test('global CSS rejects destructive shorthands only on governed selectors', () => {
  const borderShorthand = loadGlobalStyles().replace(
    '.mf-alert-success {',
    '.mf-alert-success {\n  border: none;',
  );
  assert.throws(() => verifyGlobalStyles(borderShorthand), /global CSS \.mf-alert-success has an interfering border shorthand/);

  const sideBorderShorthand = loadGlobalStyles().replace(
    '.mf-alert-success {',
    '.mf-alert-success {\n  border-top: none;',
  );
  assert.throws(() => verifyGlobalStyles(sideBorderShorthand), /global CSS \.mf-alert-success has an interfering border shorthand/);

  const uppercaseColor = loadGlobalStyles().replace(
    '.mf-alert-success {',
    '.mf-alert-success {\n  COLOR: var(--lume-signal-critical);',
  );
  assert.throws(() => verifyGlobalStyles(uppercaseColor), /global CSS \.mf-alert-success has duplicate declarations/);

  const uppercaseBorder = loadGlobalStyles().replace(
    '.mf-alert-success {',
    '.mf-alert-success {\n  BORDER: none;',
  );
  assert.throws(() => verifyGlobalStyles(uppercaseBorder), /global CSS \.mf-alert-success has an interfering border shorthand/);

  const allShorthand = loadGlobalStyles().replace(
    '.mf-alert-success {',
    '.mf-alert-success {\n  ALL: unset;',
  );
  assert.throws(() => verifyGlobalStyles(allShorthand), /global CSS \.mf-alert-success has an interfering all shorthand/);

  const unrelatedFallback = `${loadGlobalStyles()}\n.unrelated { color: var(--lume-ink); color: inherit; }\n`;
  assert.doesNotThrow(() => verifyGlobalStyles(unrelatedFallback));
});

test('global CSS rejects a light Grafite scrim or an unmeasured warning recipe', () => {
  const lightScrim = loadGlobalStyles().replace(
    'var(--lume-guardia-surface-chrome) 78%',
    'var(--lume-giorno-ink-primary) 78%',
  );
  assert.throws(() => verifyGlobalStyles(lightScrim), /global CSS :root\.dark \.mf-modal-backdrop background/);

  const unmeasuredWarning = loadGlobalStyles().replace(
    'var(--lume-signal-warning) 60%, var(--lume-ink)',
    'var(--lume-signal-warning) 70%, var(--lume-ink)',
  );
  assert.throws(() => verifyGlobalStyles(unmeasuredWarning), /global CSS \.graphite-chip-tone-warning color/);
});

test('palette guard catches an out-of-contract hex literal', () => {
  const result = scanPaletteSource({
    relativePath: 'components/example.tsx',
    source: 'const example = <div style={{ color: "#123456" }} />;',
    tokens: validTokens(),
    allowlist: [],
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].value, '#123456');
});

test('palette guard catches a Tailwind palette utility', () => {
  const result = scanPaletteSource({
    relativePath: 'components/example.tsx',
    source: 'const example = <div className="bg-blue-500" />;',
    tokens: validTokens(),
    allowlist: [],
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].kind, 'utility Tailwind');
});

test('palette guard catches neutral and fixed Tailwind color utilities', () => {
  const result = scanPaletteSource({
    relativePath: 'components/example.tsx',
    source: 'const example = <div className="bg-slate-500 text-gray-700 border-white bg-black/50" />;',
    tokens: validTokens(),
    allowlist: [],
  });
  assert.equal(result.violations.length, 4);
  assert.deepEqual(result.violations.map((finding) => finding.value).sort(), [
    'bg-black/50',
    'bg-slate-500',
    'border-white',
    'text-gray-700',
  ]);
});

test('palette guard accepts a declared Lume token, transparent, currentColor and non-color utilities', () => {
  const result = scanPaletteSource({
    relativePath: 'components/example.tsx',
    source: 'const example = <div className="bg-transparent text-current whitespace-nowrap" style={{ color: "#eef0f2", background: "transparent", outlineColor: "currentColor", borderColor: "inherit", outline: "hsl(0 0% 100%)" }} />;',
    tokens: validTokens(),
    allowlist: [],
  });
  assert.equal(result.violations.length, 0);
});

test('palette guard rejects an allowlist entry with zero occurrences', () => {
  assert.throws(() => scanPaletteSource({
    relativePath: 'components/example.tsx',
    source: 'export const example = true;',
    tokens: validTokens(),
    allowlist: [{
      path: 'components/example.tsx',
      reason: 'Fixture sintetica.',
      occurrences: 0,
      fingerprint: paletteFingerprint([]),
    }],
  }), /voce di allowlist invalida per components\/example\.tsx: occurrences deve essere un intero positivo\. Correggi la voce o rimuovila\./);
});

test('palette guard respects only the exact allowlisted baseline', () => {
  const source = 'const example = <div className="text-amber-600" />;';
  const unlisted = scanPaletteSource({
    relativePath: 'components/example.tsx',
    source,
    tokens: validTokens(),
    allowlist: [],
  });
  const allowlist = [{
    path: 'components/example.tsx',
    reason: 'Fixture sintetica.',
    occurrences: 1,
    fingerprint: paletteFingerprint(unlisted.violations),
  }];
  assert.equal(scanPaletteSource({ relativePath: 'components/example.tsx', source, tokens: validTokens(), allowlist }).violations.length, 0);
  assert.equal(scanPaletteSource({
    relativePath: 'components/example.tsx',
    source: `${source}\nconst extra = <div className="text-amber-600" />;`,
    tokens: validTokens(),
    allowlist,
  }).violations.length, 2);
});

test('palette guard fails an over-provisioned stale allowlist entry', () => {
  const source = 'const example = <div className="text-amber-600" />;';
  const baseline = scanPaletteSource({ relativePath: 'components/example.tsx', source, tokens: validTokens(), allowlist: [] });
  const result = scanPaletteSource({
    relativePath: 'components/example.tsx',
    source,
    tokens: validTokens(),
    allowlist: [{
      path: 'components/example.tsx',
      reason: 'Fixture sintetica.',
      occurrences: 2,
      fingerprint: paletteFingerprint([...baseline.violations, ...baseline.violations]),
    }],
  });
  assert.equal(result.allowlistIssues.length, 1);
  assert.match(result.allowlistIssues[0].message, /voce di allowlist stale per components\/example\.tsx: dichiarate 2, trovate 1\. Aggiorna occurrences\+fingerprint o rimuovi la voce\./);
});

test('palette guard fails a stale allowlist fingerprint even with the declared count', () => {
  const source = 'const example = <div className="text-amber-600" />;';
  const result = scanPaletteSource({
    relativePath: 'components/example.tsx',
    source,
    tokens: validTokens(),
    allowlist: [{
      path: 'components/example.tsx',
      reason: 'Fixture sintetica.',
      occurrences: 1,
      fingerprint: paletteFingerprint([]),
    }],
  });
  assert.equal(result.allowlistIssues.length, 1);
  assert.match(result.allowlistIssues[0].message, /L'impronta non coincide con la baseline dichiarata\./);
});

test('palette guard fails an orphaned allowlist entry', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'lume-palette-'));
  try {
    mkdirSync(path.join(rootDir, 'app'));
    mkdirSync(path.join(rootDir, 'components'));
    writeFileSync(path.join(rootDir, 'components', 'present.tsx'), 'export const present = true;');
    const result = scanPalette({
      rootDir,
      tokens: validTokens(),
      allowlist: [{
        path: 'components/missing.tsx',
        reason: 'Fixture sintetica.',
        occurrences: 1,
        fingerprint: paletteFingerprint([]),
      }],
    });
    assert.equal(result.allowlistIssues.length, 1);
    assert.match(result.allowlistIssues[0].message, /voce orfana di allowlist per components\/missing\.tsx/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('palette guard accepts an exact allowlist entry', () => {
  const source = 'const example = <div className="text-amber-600" />;';
  const baseline = scanPaletteSource({ relativePath: 'components/example.tsx', source, tokens: validTokens(), allowlist: [] });
  const result = scanPaletteSource({
    relativePath: 'components/example.tsx',
    source,
    tokens: validTokens(),
    allowlist: [{
      path: 'components/example.tsx',
      reason: 'Fixture sintetica.',
      occurrences: 1,
      fingerprint: paletteFingerprint(baseline.violations),
    }],
  });
  assert.equal(result.violations.length, 0);
  assert.equal(result.allowlistIssues.length, 0);
});

test('palette guard fails a regression beyond the declared allowlist entry', () => {
  const source = 'const example = <div className="text-amber-600" />;';
  const baseline = scanPaletteSource({ relativePath: 'components/example.tsx', source, tokens: validTokens(), allowlist: [] });
  const result = scanPaletteSource({
    relativePath: 'components/example.tsx',
    source: `${source}\nconst extra = <div className="text-amber-600" />;`,
    tokens: validTokens(),
    allowlist: [{
      path: 'components/example.tsx',
      reason: 'Fixture sintetica.',
      occurrences: 1,
      fingerprint: paletteFingerprint(baseline.violations),
    }],
  });
  assert.equal(result.violations.length, 2);
  assert.equal(result.allowlistIssues.length, 0);
});
