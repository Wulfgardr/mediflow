import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

test('SISS: comandi esterni, stati leggibili, diario e disclosure', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { sessionHealth: 'none', lastModule: null, lastModuleAt: null, checkpoints: [] } }));
    let mode = 'blocked';
    await page.route('**/api/fse/validate-patient?*', route => mode === 'unavailable' ? route.fulfill({ status: 503, json: { error: 'Controllo sintetico indisponibile' } }) : route.fulfill({ json: {
        hasErrors: mode === 'blocked', hasWarnings: mode === 'warning',
        therapyMedication: { total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: [] }, observationVitals: { total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: [] },
    } }));
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await page.evaluate(async () => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Contesto', lastName: 'Sintetico', taxCode: `HC10${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`, birthDate: '1980-01-01T00:00:00Z', diagnoses: [] }) });
        if (!response.ok) throw new Error(`Creazione paziente sintetico: ${response.status}`);
        return (await response.json()).id as string;
    });
    await page.goto(`/patients/${patientId}/modules`);
    await openPatientSection(page, 'siss');
    const pane = page.locator('#siss');
    await expect(pane.getByRole('button', { name: 'Requisiti e controllo locale dei dati', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(pane.getByRole('heading', { name: /^SISS e FSE/i }).getByText(/0 passaggi/)).toHaveCount(0);
    for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        for (const label of ['Prescrittivo Regionale (PRREG)', 'Protesica-RL', 'FSE', 'Anagrafe', 'Menu SISS']) {
            const command = pane.getByRole('button', { name: `Apri ${label}, fuori da MediFlow`, exact: true });
            await expect(command).toBeEnabled();
            await expect(command.locator('svg')).toHaveCount(1);
            await expect(command.locator('svg.lucide-external-link')).toHaveCount(1);
        }
        await expect(pane.getByText('Le operazioni si svolgono nei portali regionali.', { exact: true })).toBeVisible();
        await expect(pane.getByText('Codice fiscale disponibile da copiare.', { exact: true })).toBeVisible();
        const warning = pane.getByRole('alert').filter({ hasText: 'Dati da correggere per l’esportazione FSE. Puoi aprire i portali.' });
        await expect(warning).toBeVisible();
        const requirements = pane.getByRole('button', { name: 'Requisiti e controllo locale dei dati', exact: true });
        if (await requirements.getAttribute('aria-expanded') === 'true') await requirements.click();
        await expect(warning).toBeVisible();
        const disclosure = pane.getByRole('button', { name: 'Funzioni non automatiche 4', exact: true });
        await expect(disclosure.locator('svg')).toHaveCount(1);
        const content = page.locator(`[id="${await disclosure.getAttribute('aria-controls')}"]`);
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        await expect(content).toBeHidden();
        const closed = await disclosure.locator('svg').evaluate(el => getComputedStyle(el).transform);
        await disclosure.click();
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        await expect(content).toBeVisible();
        await expect.poll(() => disclosure.locator('svg').evaluate(el => getComputedStyle(el).transform)).not.toBe(closed);
        await expect(content).toContainText('Prescrittivo nativo');
        await disclosure.click();
        await expect(content).toBeHidden();
    }
    const requirements = pane.getByRole('button', { name: 'Requisiti e controllo locale dei dati', exact: true });
    await requirements.click();
    for (const state of ['warning', 'clean', 'unavailable']) {
        mode = state;
        await pane.getByRole('button', { name: 'Aggiorna controllo FSE locale', exact: true }).click();
        await expect(pane.getByText(state === 'unavailable' ? 'Controllo dei dati per l’esportazione FSE non disponibile.' : state === 'warning' ? 'Dati da verificare per l’esportazione FSE.' : 'Dati pronti per l’esportazione FSE.', { exact: true })).toBeVisible();
    }
    await page.evaluate(async patientId => {
        const now = new Date().toISOString();
        const response = await fetch('/api/siss-handoffs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), patientId, action: 'registry.lookup', moduleLabel: 'Anagrafe', reason: 'Verifica sintetica HC10', startedAt: now, outcome: 'started', createdAt: now, updatedAt: now }) });
        if (!response.ok) throw new Error(`Diario sintetico: ${response.status}`);
    }, patientId);
    await page.reload(); await openPatientSection(page, 'siss');
    await expect(pane.getByText('1 passaggio registrato', { exact: true })).toBeVisible();
});
