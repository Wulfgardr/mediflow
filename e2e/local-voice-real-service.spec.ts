import type { Page, TestInfo } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openUnlockedDocument } from './utils';
import { syntheticMicrophone, syntheticPatient } from './local-voice-utils';

const enabled = process.env.E2E_LOCAL_VOICE_REAL === '1' && process.platform === 'darwin'
    && Boolean(process.env.MEDIFLOW_LOCAL_VOICE_URL && process.env.MEDIFLOW_LOCAL_VOICE_SECRET);
test.skip(!enabled, 'Mac only: needs mediflow-voice with the installed model (E2E_LOCAL_VOICE_REAL=1).');
test.describe.configure({ mode: 'serial', retries: 0 });
test.use({ permissions: ['microphone'] });
const pin = '314159';
const VOICES = { M: 'Eddy (Italian (Italy))', P: 'Grandma (Italian (Italy))' } as const;

function spoken(turns: Array<[keyof typeof VOICES, string]>): { pcm16k: string; seconds: number } {
    const work = mkdtempSync(path.join(tmpdir(), 'mediflow-voice-say-'));
    const pieces: Buffer[] = [];
    try {
        turns.forEach(([role, text], index) => {
            const aiff = path.join(work, `${index}.aiff`), wav = path.join(work, `${index}.wav`);
            if (spawnSync('/usr/bin/say', ['-v', VOICES[role], '-r', '175', '-o', aiff, text]).status !== 0) throw new Error('say failed');
            if (spawnSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav]).status !== 0) throw new Error('afconvert failed');
            const file = readFileSync(wav);
            const data = file.indexOf('data');
            pieces.push(file.subarray(data + 8), Buffer.alloc(16_000 * 2 * 0.7));
        });
    } finally { rmSync(work, { recursive: true, force: true }); }
    const pcm = Buffer.concat([Buffer.alloc(16_000), ...pieces]);
    return { pcm16k: pcm.toString('base64'), seconds: pcm.length / 2 / 16_000 };
}

async function capture(info: TestInfo, page: Page, name: string) {
    const target = info.outputPath(name);
    await page.screenshot({ path: target });
    await info.attach(name, { path: target, contentType: 'image/png' });
}

async function recordAll(page: Page, info: TestInfo, seconds: number) {
    const recorder = page.getByTestId('local-voice-recorder');
    const clicked = Date.now();
    await recorder.getByRole('button', { name: 'Ascolta la visita' }).click();
    await expect(recorder.getByText('Avvio della trascrizione…')).toBeVisible({ timeout: 10_000 });
    await expect(recorder.getByTestId('local-voice-indicator')).toContainText('In registrazione', { timeout: 240_000 });
    const loading = (Date.now() - clicked) / 1000;
    await info.attach('avvio-secondi.txt', { body: String(loading), contentType: 'text/plain' });
    await page.waitForTimeout(Math.max(0, seconds - loading) * 1000 + 3_000);
    await recorder.getByRole('button', { name: 'Termina' }).click();
    const review = recorder.getByTestId('local-voice-review');
    await expect(review).toBeVisible({ timeout: 150_000 });
    return review;
}

test('servizio vero: visita a due voci sintetiche dalla scheda, testo attribuito nella nota', async ({ page }, info) => {
    test.setTimeout(600_000);
    const visit = spoken([
        ['M', 'Buongiorno, come è andata la pressione questo mese?'],
        ['P', 'Abbastanza bene, dottore. Prendo il ramipril cinque milligrammi ogni mattina.'],
        ['M', 'Ha avuto mal di testa o capogiri?'],
        ['P', 'No, nessun capogiro. Solo un po di stanchezza la sera.'],
        ['M', 'Bene, continuiamo così e ci rivediamo fra tre mesi.'],
    ]);
    await syntheticMicrophone(page, { pcm16k: visit.pcm16k });
    await bootstrapUnlockedSession(page, pin);
    const patientId = await syntheticPatient(page, 'Ascolto');
    await openUnlockedDocument(page, `/patients/${patientId}/modules`, pin);
    await page.getByRole('link', { name: 'Registra la visita' }).click();
    const review = await recordAll(page, info, visit.seconds);
    const text = await review.inputValue();
    await info.attach('trascrizione-visita.txt', { body: text, contentType: 'text/plain' });
    await capture(info, page, 'vero-1-testo-da-rivedere.png');
    expect(text).toMatch(/^Medico: /mu);
    expect(text).toMatch(/^Paziente: /mu);
    expect(text.toLowerCase()).toContain('pressione');
    expect(text.toLowerCase()).toContain('ramipril');
    await page.getByTestId('local-voice-take').click();
    await expect(page.getByRole('textbox', { name: 'Resoconto clinico', exact: true })).toContainText('pressione');
    await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
    await page.getByRole('button', { name: 'Conferma e registra', exact: true }).click();
    await expect(page.getByText(/^Registrata alle/u)).toBeVisible({ timeout: 30_000 });
    await capture(info, page, 'vero-2-registrata.png');
});

test('servizio vero: prima visita detta, proposte d’anagrafica dalla trascrizione', async ({ page }, info) => {
    test.setTimeout(600_000);
    const visit = spoken([
        ['M', 'Buongiorno, è la prima volta da me. Mi dice cognome e nome?'],
        ['P', 'Mi chiamo Anna Bianchi. Sono nata il 12 marzo 1951.'],
        ['M', 'Grazie. Che farmaci prende?'],
        ['P', 'Prendo la metformina mille milligrammi due volte al giorno.'],
    ]);
    await syntheticMicrophone(page, { pcm16k: visit.pcm16k });
    await bootstrapUnlockedSession(page, pin);
    await openUnlockedDocument(page, '/patients/new', pin);
    const review = await recordAll(page, info, visit.seconds);
    const text = await review.inputValue();
    await info.attach('trascrizione-prima-visita.txt', { body: text, contentType: 'text/plain' });
    await capture(info, page, 'vero-3-prima-visita-da-rivedere.png');
    await page.getByRole('button', { name: 'Usa per la nuova scheda' }).click();
    const group = page.getByTestId('dossier-import').getByTestId('dossier-group');
    await expect(group.getByTestId('dossier-source')).toHaveCount(1, { timeout: 120_000 });
    await capture(info, page, 'vero-4-fonte-nel-motore.png');
    const create = group.getByTestId('dossier-new-patient').getByTestId('patient-document-create');
    if (await create.count()) {
        await create.getByRole('button', { name: 'Avvia la revisione del documento' }).click();
        await expect(create.getByRole('heading', { name: 'Revisione dei dati' })).toBeVisible({ timeout: 60_000 });
        const proposals = await create.getByTestId('patient-document-dossier-proposals').innerText().catch(() => '');
        await info.attach('proposte.txt', { body: proposals, contentType: 'text/plain' });
        expect(proposals).toContain('Bianchi');
        expect(proposals).toContain('Anna');
        await capture(info, page, 'vero-5-proposte.png');
    }
});
