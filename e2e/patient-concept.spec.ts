import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createConceptPatient } from './fixtures/concept-patient';
import { availablePreview, MODEL_OPTION_ID, PATIENT_INSIGHT_CATALOG } from './fixtures/patient-insight-preview';
import { parsePatientInsightPreviewRequest } from '../lib/ai-providers/fabric/patient-insight-preview-contract';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch } from './utils';

test('Scheda desktop del concept con identità, tre colonne e ritorno alle sezioni', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1320, height: 880 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234', { displayName: 'Dott. Sintetico', ambulatoryName: 'Ambulatorio di prova' });
    await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
    await page.route('**/api/settings/ai/functions', route => route.fulfill({ json: PATIENT_INSIGHT_CATALOG }));
    await page.route('**/api/ai/patient-insight/preview', route => {
        const request = parsePatientInsightPreviewRequest(route.request().postDataJSON());
        if (!request) throw new Error('Richiesta di anteprima non valida.');
        const result = availablePreview(request);
        Object.assign(result.preview.proposal, {
            summary: '',
            alerts: ['Iperkaliemia lieve con IRC 3a. Spironolattone già sospeso.'],
            currentState: ['Peso aumentato di 1,2 kg in 8 giorni.'],
            nextSteps: ['Ricontrollo degli elettroliti concordato nella telefonata.'],
            gaps: [],
        });
        return route.fulfill({ json: result });
    });
    const id = await createConceptPatient(page);
    await page.goto(`/patients/${id}/modules`);
    const record = page.getByTestId('lume-scheda-surface');
    await expect(record.getByText('Scompenso cardiaco').first()).toBeVisible();
    await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
    const draft = 'Bozza sintetica per il prossimo accesso della squadra ADI.';
    await editor.fill(draft);
    await expect(page.getByTestId('local-draft-status')).toContainText('conservati cifrati');
    await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Torna alla bozza', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Torna alla bozza', exact: true })).toHaveAccessibleDescription('9 parole');
    const change = record.getByRole('region', { name: 'Variazioni dall’ultima visita' });
    const medication = change.locator('details').filter({ has: page.locator('summary', { hasText: 'Spironolattone' }) });
    await expect(medication).toHaveCount(1);
    if (!await medication.evaluate(el => (el as HTMLDetailsElement).open)) await medication.locator('summary').click();
    await expect(page.getByText('ADI attiva', { exact: true })).toBeVisible();
    await expect(page.getByText('Ritorno dopo 15 giorni', { exact: true })).toBeVisible();
    const out = process.env.MEDIFLOW_CONCEPT_SCREENSHOTS;
    const setTheme = async (theme: string) => {
        if (await page.locator('html').evaluate(el => el.classList.contains('dark')) !== (theme === 'dark')) {
            await page.getByRole('button', { name: 'Cambia tema', exact: true }).click();
        }
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
    };
    const rect = (selector: string) => page.locator(selector).first().evaluate(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
    });
    for (const theme of ['light', 'dark']) {
        await setTheme(theme);
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }]);
        const rail = await rect('aside[aria-label="MediFlow"]');
        const main = await rect('[data-testid="lume-scheda-header"]');
        const stable = await rect('#riepilogo-problemi');
        const changed = await rect('[aria-label="Variazioni dall’ultima visita"]');
        const context = await rect('[data-record-tray="contesto"] > div');
        if (out) {
            mkdirSync(out, { recursive: true });
            await page.screenshot({ path: join(out, `scheda-${theme}.png`), animations: 'disabled' });
            writeFileSync(join(out, `misure-${theme}.json`), JSON.stringify({ rail, main, stable, changed, context }, null, 2));
        }
        expect(Math.abs(rail.width - 232)).toBeLessThanOrEqual(3);
        expect(Math.abs(main.x - 244)).toBeLessThanOrEqual(4);
        for (const [bounds, left, width] of [[stable, 269, 307], [changed, 592, 374], [context, 982, 307]] as const) {
            expect(Math.abs(bounds.x - left)).toBeLessThanOrEqual(4);
            expect(Math.abs(bounds.y - 235)).toBeLessThanOrEqual(5);
            expect(Math.abs(bounds.width - width)).toBeLessThanOrEqual(4);
        }
    }
    const proposal = page.getByTestId('patient-proposals-summary');
    await expect(proposal).toContainText('Nessuna proposta da rivedere');
    await proposal.getByRole('link', { name: 'Apri il Quadro e le fonti', exact: true }).click();
    const model = page.getByTestId('model-picker-patient_insight');
    await model.getByRole('button', { name: 'Cambia', exact: true }).click();
    await page.getByRole('combobox', { name: 'Modello per questa proposta' }).selectOption(MODEL_OPTION_ID);
    await page.getByRole('button', { name: 'Genera proposta', exact: true }).click();
    await expect(page.getByTestId('patient-insight-review-proposal')).toBeVisible();
    await openPatientSection(page, 'quadro');
    await expect(proposal).toContainText('Proposta · non registrata');
    await expect(proposal).toContainText('Iperkaliemia lieve con IRC 3a');
    await expect(proposal).toContainText('1,2 kg in 8 giorni');
    await expect(proposal).toContainText('Ricontrollo degli elettroliti');
    await expect(proposal.getByRole('link', { name: 'Diario', exact: true })).toHaveAttribute('href', `/patients/${id}/modules#diario`);
    await expect(page.locator('[data-record-tray="contesto"] > div').first()).toHaveCSS('border-top-style', 'dashed');
    if (!await medication.evaluate(el => (el as HTMLDetailsElement).open)) await medication.locator('summary').click();
    for (const theme of ['light', 'dark']) {
        await setTheme(theme);
        await page.getByTestId('lume-scheda-header').evaluate(element => element.scrollIntoView({ block: 'start' }));
        if (out) await page.screenshot({ path: join(out, `scheda-proposta-${theme}.png`), animations: 'disabled' });
    }
    const prescribe = page.getByRole('button', { name: 'Prescrivi', exact: true });
    const exposed = await prescribe.evaluate(button => {
        const box = button.getBoundingClientRect();
        return [3, box.height / 2, box.height - 3].every(dy => button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + dy)));
    });
    expect(exposed).toBe(true);
    await prescribe.click();
    await page.getByRole('menuitem', { name: 'Prescrizione di una prestazione' }).click();
    await expect(page.locator('#prestazioni')).toBeVisible();
    await page.getByRole('link', { name: 'Riepilogo', exact: true }).click();
    await expect(change).toBeVisible();
    await page.getByRole('link', { name: 'Torna alla bozza', exact: true }).click();
    await expect(editor).toHaveText(draft);
    await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
    await page.getByRole('link', { name: 'Cerca pazienti', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' })).toBeFocused();
});
