import assert from 'node:assert/strict';
import test from 'node:test';
import { flatten, mountContract, text } from './settings/settings-presentation.test-support.ts';

test('ogni passo della configurazione espone un unico titolo h1', () => {
  for (const [step, title] of [[1, 'Chi sei?'], [2, 'Proteggi l’accesso']] as const) {
    const tree = mountContract('components/onboarding-wizard.tsx', 'OnboardingWizard', {
      states: { 0: step }, props: { onComplete: async () => {} },
      imports: {
        '@/lib/security/unlock-credential': { checkPassphrase: () => ({ ok: false }) },
        '@/lib/patient-identity': { identifierError: () => null },
      },
    }).render();
    const headings = flatten(tree).filter(node => node.type === 'h1');
    assert.equal(headings.length, 1);
    assert.equal(text(headings[0]), title);
    if (step === 1) {
      const cfInput = flatten(tree).find(node => node.type === 'input' && node.props.id === 'setup-doctor-tax-code');
      assert.ok(cfInput);
    }
  }
});

test('il pannello dossier mostra il collegamento al Profilo quando manca il CF medico', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync('components/dossier-import-panel.tsx', 'utf8');
  assert.match(source, /identity\.missingPhysicianTaxCode[\s\S]*?<Link href="\/settings\/profilo"/u);
});

test('il kit di recupero ha un titolo h1 senza modificare i comandi di conferma', () => {
  const tree = mountContract('components/recovery-kit.tsx', 'RecoveryKitPanel', {
    props: { prepared: { kit: {}, recoveryKey: 'chiave-inventata' }, onCommit: async () => ({ ok: true }), onCancel: () => {} },
    imports: { '@/lib/recovery-backup': {}, '@/lib/security/unlock-credential': {}, './settings/settings-ui': {} },
  }).render();
  const headings = flatten(tree).filter(node => node.type === 'h1');
  assert.equal(headings.length, 1);
  assert.equal(text(headings[0]), 'Conserva il nuovo kit prima di continuare');
  const activate = flatten(tree).find(node => node.type === 'button' && text(node).includes('Attiva la nuova passphrase'));
  assert.equal(activate?.props.disabled, true);
});
