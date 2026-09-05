/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

const EVIDENCE_RECORD_IDS = [
  'data_protection_by_design',
  'security_controls',
  'backup_and_restore',
  'data_subject_workflows',
  'ai_transparency',
  'legal_applicability',
] as const;

test.describe.configure({ retries: 0 });

test('Compliance settings renders the technical evidence inventory without a legal verdict', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/settings/compliance');
  await expect(page).toHaveURL(/\/settings\/compliance$/);

  const surface = page.getByTestId('settings-compliance-section');
  await expect(surface).toBeVisible();
  await expect(surface.getByRole('heading', { name: 'Evidenze e conformità' })).toBeVisible();
  await expect(surface).toContainText('Inventario di evidenze, non attestazione');
  await expect(surface.getByRole('heading', { name: 'Nessun verdetto legale' })).toBeVisible();
  await expect(surface).toContainText('Lo stato legale non è valutato.');
  await expect(surface).toContainText('non determinano applicabilità, ruoli, adempimenti o certificazioni');

  const records = surface.locator('[data-testid^="compliance-evidence-"]');
  await expect(records).toHaveCount(EVIDENCE_RECORD_IDS.length);
  for (const id of EVIDENCE_RECORD_IDS) {
    await expect(surface.getByTestId(`compliance-evidence-${id}`)).toBeVisible();
  }

  const dataProtection = surface.getByTestId('compliance-evidence-data_protection_by_design');
  await expect(dataProtection.getByRole('heading', {
    name: 'Protezione dei dati per progettazione e impostazione predefinita',
  })).toBeVisible();
  await expect(dataProtection).toContainText('Confini local-first, minimizzazione ed egress disabilitato');
  await expect(dataProtection).toContainText('SECURITY.md');
  await expect(dataProtection).toContainText('Responsabile tecnico del deployment');

  const securityControls = surface.getByTestId('compliance-evidence-security_controls');
  await expect(securityControls.getByRole('heading', { name: 'Controlli tecnici di sicurezza' })).toBeVisible();
  await expect(securityControls).toContainText('Evidenza con limite esplicito');
  await expect(securityControls).toContainText('lib/security/security.ts');
  await expect(securityControls).toContainText('non condividono tutti un perimetro whole-database verificato');

  const backupAndRestore = surface.getByTestId('compliance-evidence-backup_and_restore');
  await expect(backupAndRestore.getByRole('heading', { name: 'Backup e ripristino' })).toBeVisible();
  await expect(backupAndRestore).toContainText('scripts/backup-restore-drill.mjs');
  await expect(backupAndRestore).toContainText('continuità operativa restano responsabilità del deployment');

  const aiTransparency = surface.getByTestId('compliance-evidence-ai_transparency');
  await expect(aiTransparency.getByRole('heading', { name: 'Trasparenza delle funzioni AI' })).toBeVisible();
  await expect(aiTransparency).toContainText('app/settings/ai/fabric/page.tsx');
  await expect(aiTransparency).toContainText('Senza receipt dell’operazione corrente');

  const legalApplicability = surface.getByTestId('compliance-evidence-legal_applicability');
  await expect(legalApplicability.getByRole('heading', {
    name: 'Applicabilità normativa e valutazione legale',
  })).toBeVisible();
  await expect(legalApplicability).toContainText('Valutazione esterna necessaria');
  await expect(legalApplicability).toContainText('non produce una certificazione o un parere legale');
  await expect(legalApplicability.getByRole('link')).toHaveCount(3);
  await expect(legalApplicability.getByRole('link', { name: 'GDPR, articolo 25' })).toHaveAttribute(
    'href',
    'https://eur-lex.europa.eu/eli/reg/2016/679/art_25/oj/eng',
  );
  await expect(legalApplicability.getByRole('link', { name: 'GDPR, articolo 32' })).toHaveAttribute(
    'href',
    'https://eur-lex.europa.eu/eli/reg/2016/679/art_32/oj/eng',
  );
  await expect(legalApplicability.getByRole('link', {
    name: 'Regolamento (UE) 2024/1689 (AI Act)',
  })).toHaveAttribute('href', 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en');
  await expect(legalApplicability.locator('a[target="_blank"][rel="noopener noreferrer"]')).toHaveCount(3);

  await expect(surface.locator('form, input, select, textarea, button, [role="switch"], [contenteditable="true"]')).toHaveCount(0);
});
