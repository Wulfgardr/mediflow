import { expect, test, type Page } from '@playwright/test';
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

const blockedRequests = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  if (new URL(baseURL!).hostname !== '127.0.0.1' || new URL(baseURL!).port === '3000') throw Error('Explicit synthetic loopback runtime required');
  const blocked: string[] = []; blockedRequests.set(page, blocked);
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || url.pathname.startsWith('/api/ai/') || url.pathname.startsWith('/api/icd/')) {
      blocked.push(`${request.method()} ${request.url()}`); return route.abort();
    }
    if (url.pathname === '/api/siss/session-status') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
    return route.continue();
  });
});
test.afterEach(async ({ page }, info) => {
  const allBlocked = blockedRequests.get(page) ?? [];
  await info.attach('compliance-unexpected-requests.json', { body: JSON.stringify({ allBlocked }), contentType: 'application/json' });
  expect(allBlocked).toEqual([]);
});

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
    const record = surface.getByTestId(`compliance-evidence-${id}`);
    await expect(record).toBeVisible();
    await expect(record.locator('[data-compliance-status]')).toBeVisible();
    await expect(record.locator('dd').first()).toBeVisible();
    await record.getByRole('button', { name: 'Evidenze, responsabile e fonti', exact: true }).click();
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
  await expect(aiTransparency).toContainText('Senza prova dell’operazione corrente');

  const legalApplicability = surface.getByTestId('compliance-evidence-legal_applicability');
  await expect(legalApplicability.getByRole('heading', {
    name: 'Applicabilità normativa e valutazione legale',
  })).toBeVisible();
  await expect(legalApplicability).toContainText('Valutazione esterna necessaria');
  await expect(legalApplicability).toContainText('non produce una certificazione o un parere legale');
  await expect(legalApplicability.getByRole('link')).toHaveCount(3);
  // assert the versioned public references already adopted by the
  // inventory; they do not change its explicit not-assessed claim ceiling.
  await expect(legalApplicability.getByRole('link', {
    name: 'GDPR, artt. 25 e 32 (consolidato 04/05/2016, rettifica 23/05/2018)', exact: true,
  })).toHaveAttribute(
    'href',
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02016R0679-20160504',
  );
  await expect(legalApplicability.getByRole('link', {
    name: 'AI Act (consolidato 27/07/2026)', exact: true,
  })).toHaveAttribute(
    'href',
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727',
  );
  await expect(legalApplicability.getByRole('link', {
    name: 'Commissione europea: AI Act (pagina aggiornata 03/08/2026)', exact: true,
  })).toHaveAttribute('href', 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai');
  await expect(legalApplicability.locator('a[target="_blank"][rel="noopener noreferrer"]')).toHaveCount(3);

  await expect(surface.getByRole('button')).toHaveCount(6);
  await expect(surface.locator('[data-disclosure-control]')).toHaveCount(6);
  await expect(surface.locator('form, input, select, textarea, [role="switch"], [contenteditable="true"]')).toHaveCount(0);
});
