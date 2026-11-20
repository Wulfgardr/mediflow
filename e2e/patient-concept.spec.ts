import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createConceptPatient } from './fixtures/concept-patient';
import { availablePreview, MODEL_OPTION_ID, PATIENT_INSIGHT_CATALOG } from './fixtures/patient-insight-preview';
import { parsePatientInsightPreviewRequest } from '../lib/ai-providers/fabric/patient-insight-preview-contract';
import { openSyntheticPatient, unlockSyntheticSheet } from './fixtures/synthetic-sheet';
import { assertNoHorizontalOverflow, openPatientSection, setAiLaneKillSwitch } from './utils';

test('Scheda desktop del concept con identità, tre colonne e ritorno alle sezioni', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1320, height: 880 });
    const fixture = await unlockSyntheticSheet(page, baseURL);
    await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
    await page.route('**/api/settings/ai/functions', route => route.fulfill({ json: PATIENT_INSIGHT_CATALOG }));
    await page.route('**/api/ai/patient-insight/preview', route => {
        const request = parsePatientInsightPreviewRequest(route.request().postDataJSON());
        if (!request) throw new Error('Richiesta di anteprima non valida.');
        const events = request.sources.recentEvents.map(event => event.summary).join('\n');
        expect(events).toContain('Peso 70,2 kg');
        expect(events).toContain('Peso 71,4 kg');
        expect(events).toContain('Potassio 5,6. Sospeso spironolattone. Ricontrollo elettroliti tra 7 giorni.');
        const result = availablePreview(request);
        Object.assign(result.preview.proposal, {
            summary: '',
            alerts: ['Iperkaliemia lieve con IRC 3a. Spironolattone già sospeso.'],
            currentState: ['Peso aumentato di 1,2 kg, da 70,2 a 71,4 kg.'],
            nextSteps: ['Ricontrollo degli elettroliti concordato nella telefonata.'],
            gaps: [],
        });
        return route.fulfill({ json: result });
    });
    const { id, taxCode } = await createConceptPatient(fixture);
    await openSyntheticPatient(page, taxCode, 'Sintetica Bianca', id);
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
        const dark = theme === 'dark';
        await expect(page.locator('aside[aria-label="MediFlow"]')).toHaveCSS('background-color', dark ? 'rgb(22, 25, 29)' : 'rgb(242, 244, 247)');
        await expect(page.getByTestId('lume-scheda-scroll').locator('..')).toHaveCSS('background-color', dark ? 'rgb(23, 25, 30)' : 'rgb(255, 255, 255)');
        await expect(change.getByText('1 valore fuori intervallo', { exact: true })).toHaveCSS('background-color', dark ? 'rgb(58, 35, 33)' : 'rgb(251, 232, 230)');
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }]);
        const rail = await rect('aside[aria-label="MediFlow"]');
        const main = await rect('[data-testid="lume-scheda-header"]');
        const stable = await rect('#riepilogo-problemi');
        const changed = await rect('[aria-label="Variazioni dall’ultima visita"]');
        const context = await rect('[data-record-tray="contesto"] > div');
        const trays = await Promise.all(['stabile', 'cambiato', 'contesto'].map(zone => rect(`[data-record-tray="${zone}"]`)));
        if (out) {
            mkdirSync(out, { recursive: true });
            await page.screenshot({ path: join(out, `scheda-${theme}.png`), animations: 'disabled' });
            writeFileSync(join(out, `misure-${theme}.json`), JSON.stringify({ rail, main, trays, stable, changed, context }, null, 2));
        }
        expect(Math.abs(rail.width - 232)).toBeLessThanOrEqual(3);
        expect(Math.abs(main.x - 244)).toBeLessThanOrEqual(4);
        for (const [tray, left, width] of [[trays[0], 259, 326], [trays[1], 597, 376], [trays[2], 985, 314]] as const) {
            expect(Math.abs(tray.x - left)).toBeLessThanOrEqual(4);
            expect(Math.abs(tray.y - 209)).toBeLessThanOrEqual(2);
            expect(Math.abs(tray.y - trays[0].y)).toBeLessThanOrEqual(1);
            expect(Math.abs(tray.width - width)).toBeLessThanOrEqual(4);
        }
        for (const [island, tray] of [[stable, trays[0]], [changed, trays[1]], [context, trays[2]]] as const) {
            expect(Math.abs(island.x - tray.x - 10)).toBeLessThanOrEqual(1);
            expect(Math.abs(island.x + island.width - (tray.x + tray.width - 10))).toBeLessThanOrEqual(1);
            expect(Math.abs(island.y - tray.y - 50)).toBeLessThanOrEqual(2);
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
    await expect(proposal).toContainText('1,2 kg, da 70,2 a 71,4 kg');
    await expect(proposal).toContainText('Ricontrollo degli elettroliti');
    await expect(proposal.getByRole('link', { name: 'Diario', exact: true })).toHaveAttribute('href', `/patients/${id}/modules#diario`);
    await expect(page.locator('[data-record-tray="contesto"] > div').first()).toHaveCSS('border-top-style', 'dashed');
    if (!await medication.evaluate(el => (el as HTMLDetailsElement).open)) await medication.locator('summary').click();
    await expect(medication.getByText('Potassio 5,6 mmol/L', { exact: true })).toBeVisible();
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
    const tabs = page.getByRole('navigation', { name: 'Cartelle aperte' });
    await tabs.getByRole('link', { name: 'Pazienti', exact: true }).click();
    await expect(page.getByRole('option', { name: /^Sintetica Bianca/u })).toBeFocused();
    await tabs.getByRole('link', { name: /^Sintetica Bianca/u }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${id}/modules$`));
    await page.getByRole('link', { name: 'Cerca pazienti', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' })).toBeFocused();
});
