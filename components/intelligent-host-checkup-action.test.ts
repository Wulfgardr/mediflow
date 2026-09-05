/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('wires the governed checkup flow into the Lume patient header without exposing its UI binding', () => {
  const component = readFileSync(new URL('./intelligent-host-checkup-action.tsx', import.meta.url), 'utf8');
  const adapter = readFileSync(new URL('../lib/security/intelligent-host-checkup-browser-adapter.ts',
    import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/patients/[id]/modules/page.tsx', import.meta.url), 'utf8');

  assert.match(component, /data-testid="intelligent-host-checkup-action"/u);
  assert.match(component, /data-lume-action="quiet"/u);
  assert.match(component, /aria-label="Checkup host"/u);
  assert.match(component, /min-h-11 min-w-11 sm:min-w-0/u);
  assert.match(component, /type="password"/u);
  assert.match(component, /client\.select\(patientId, ambulatoryId, selectedId\)/u);
  assert.match(component, /await client\.revokeOperation\(patientId\)[\s\S]{0,220}setSelectedId\(nextId\)/u);
  assert.match(component, /setCheckupRef\(''\); setProposalRef\(''\); setProposal\(null\)/u);
  assert.match(component, /selectedResource\.title[\s\S]{0,120}selectedResource\.revision/u);
  assert.match(component, /proposal\.resourceTitle/u);
  assert.match(component, /notifyDbChange\('checkups'\)/u);
  assert.match(component, /Rileggi receipt con PIN/u);
  assert.match(component, /Revoca ruolo definitivamente/u);
  assert.doesNotMatch(component, /uiBindingRef|setInterval|setTimeout|console\./u);

  assert.match(adapter, /selection\.initialize\(\)[\s\S]{0,160}selection\.select/u);
  assert.match(adapter, /intelligent-host\/activate/u);
  assert.match(adapter, /await activateCurrentHost\(patientId, ambulatoryId\)[\s\S]{0,200}checkup-status/u);
  assert.match(adapter, /proposalBindings = new WeakMap/u);
  assert.match(page, /<IntelligentHostCheckupAction patientId=\{patient\.id\}[\s\S]{0,120}ambulatoryId=\{patient\.ambulatoryId \?\? null\}/u);
  assert.doesNotMatch(page, /<IntelligentHostPatientAction/u);
});
