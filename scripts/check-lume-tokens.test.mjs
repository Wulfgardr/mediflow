import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHexColor,
  contrastRatio,
  resolveColor,
  evaluateContract,
  formatReport,
  loadTokens,
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
});

test('committed token source passes the whole contract', () => {
  const result = evaluateContract(loadTokens());
  assert.equal(result.pass, true);
  assert.equal(result.checks.length, 30); // 3 registers x (2 ink x 4 surface + 2 accent)
  assert.ok(result.checks.every((c) => c.ratio >= c.minRatio));
  // The adjusted binding pair: giorno muted on chrome clears 4.5 with margin.
  const bind = result.checks.find(
    (c) => c.register === 'giorno' && c.label === 'ink.muted on surface.chrome',
  );
  assert.equal(bind.ratio.toFixed(3), '4.702');
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
