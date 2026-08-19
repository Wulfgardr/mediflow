// @Codex
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSourceCoverage } from './check-agent-interface-manifest.mjs';

const manifest = [
  { id: 'agent.interface.synthetic.v1', sources: { openApi: ['GET /api/v1/synthetic'], paired: ['network.synthetic'], fabric: ['synthetic'] } },
];

test('accetta inventari completamente classificati', () => {
  assert.deepEqual(validateSourceCoverage(manifest, {
    openApi: ['GET /api/v1/synthetic'], paired: ['network.synthetic'], fabric: ['synthetic'],
  }), []);
});

test('rifiuta sorgenti senza classificazione e duplicati', () => {
  assert.deepEqual(validateSourceCoverage([
    ...manifest,
    { id: 'agent.interface.duplicate.v1', sources: { paired: ['network.synthetic'] } },
  ], {
    openApi: ['GET /api/v1/synthetic', 'GET /api/v1/unclassified'], paired: ['network.synthetic'], fabric: ['synthetic'],
  }), [
    'openApi: unclassified GET /api/v1/unclassified',
    'paired: duplicated network.synthetic',
  ]);
});
