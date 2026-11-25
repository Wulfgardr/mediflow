import type { Page, TestInfo } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { expect, test } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openUnlockedDocument } from './utils';
import { startFakeLocalVoice } from '../lib/local-voice/fake-service.test-support';
import { randomSyntheticTaxCode } from '../lib/patient-identity.test-support';
import { taxCodeBirthDetails } from '../lib/patient-identity';

test.describe.configure({ mode: 'serial', retries: 0 });
const pin = '314159';
const TONE_HZ = 440;

const secret = randomBytes(32).toString('hex');
const port = 40_000 + Math.floor(Math.random() * 9_000);
process.env.MEDIFLOW_LOCAL_VOICE_URL = `http://127.0.0.1:${port}`;
process.env.MEDIFLOW_LOCAL_VOICE_SECRET = secret;
test.use({ permissions: ['microphone'] });

async function syntheticMicrophone(page: Page) {
    await page.addInitScript((hertz) => {
        const devices = navigator.mediaDevices;
        const original = devices.getUserMedia.bind(devices);
        devices.getUserMedia = async (constraints) => {
            if (!constraints?.audio) return original(constraints);
            const context = new AudioContext();
            const tone = context.createOscillator();
            const level = context.createGain();
            const output = context.createMediaStreamDestination();
            tone.frequency.value = hertz;
            level.gain.value = 0.35;
            tone.connect(level).connect(output);
            tone.start();
            await context.resume();
            const [track] = output.stream.getAudioTracks();
            track.addEventListener('ended', () => { void context.close(); });
            const stop = track.stop.bind(track);
            track.stop = () => { stop(); void context.close(); };
            return output.stream;
        };
    }, TONE_HZ);
}

const VISIT = [
    { speaker: 'doctor' as const, text: 'Buongiorno, come va la pressione in questi giorni?' },
    { speaker: 'patient' as const, text: 'Bene, prendo il Ramipli ogni mattina.' },
    { speaker: 'doctor' as const, text: 'Continuiamo così e ci rivediamo fra tre mesi.' },
];
let fake: Awaited<ReturnType<typeof startFakeLocalVoice>> | null = null;
const service = () => { if (!fake) throw new Error('Synthetic voice service not running'); return fake; };
async function startService(model: 'ready' | 'missing' = 'ready', lines = VISIT) {
    await fake?.close();
    fake = await startFakeLocalVoice({ secret, port, model, lines, drugSuggestions: [{ original: 'Ramipli', replacement: 'Ramipril' }] });
}

test.afterAll(async () => {
    await fake?.close();
    delete process.env.MEDIFLOW_LOCAL_VOICE_URL;
    delete process.env.MEDIFLOW_LOCAL_VOICE_SECRET;
});

async function capture(info: TestInfo, page: Page, name: string) {
    const target = info.outputPath(name);
    await page.screenshot({ fullPage: true, path: target });
    await info.attach(name, { path: target, contentType: 'image/png' });
}

async function syntheticPatient(page: Page, lastName: string): Promise<string> {
    return page.evaluate(async (surname) => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Voce', lastName: surname, taxCode: `VCE${crypto.randomUUID().replaceAll('-', '').slice(0, 13)}`, birthDate: '1960-01-01' }) });
        if (response.status !== 201) throw new Error(`Synthetic patient: ${response.status}`);
        return (await response.json() as { id: string }).id;
    }, lastName);
}

function dominantFrequency(samples: Int16Array, rate: number): number {
    let crossings = 0;
    for (let index = 1; index < samples.length; index += 1) if ((samples[index - 1] < 0) !== (samples[index] < 0)) crossings += 1;
    return crossings / 2 / (samples.length / rate);
}

async function browserKeepsNoText(page: Page, words: string[]) {
    const found = await page.evaluate(async (needles) => {
        const values = [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n');
        const databases = 'databases' in indexedDB ? (await indexedDB.databases()).map((item) => item.name ?? '') : [];
        const caches = 'caches' in window ? await window.caches.keys() : [];
        return { plain: needles.filter((needle) => values.includes(needle)), databases, caches };
    }, words);
    expect(found.plain).toEqual([]);
    expect(found.caches).toEqual([]);
    expect(found.databases.filter((name) => /voce|voice|audio/iu.test(name))).toEqual([]);
}

async function recordUntilReview(page: Page, recorder: ReturnType<Page['getByTestId']>, withPause: boolean) {
    await recorder.getByRole('button', { name: 'Ascolta la visita' }).click();
    const indicator = recorder.getByTestId('local-voice-indicator');
    await expect(indicator).toContainText('In registrazione', { timeout: 15_000 });
    await expect.poll(() => service().state.blocks.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    if (withPause) {
        await recorder.getByRole('button', { name: 'Pausa' }).click();
        await expect(indicator).toContainText('In pausa');
        const paused = service().state.blocks.length;
        await page.waitForTimeout(1_200);
        expect(service().state.blocks.length).toBe(paused);
        await recorder.getByRole('button', { name: 'Riprendi' }).click();
        await expect(indicator).toContainText('In registrazione');
        await expect.poll(() => service().state.blocks.length, { timeout: 15_000 }).toBeGreaterThan(paused + 1);
    }
    await recorder.getByRole('button', { name: 'Termina' }).click();
    await expect(recorder.getByTestId('local-voice-review')).toBeVisible({ timeout: 15_000 });
    await expect(indicator).toContainText('Ferma');
}

test('dalla scheda: registro una visita a due voci, pausa, ripresa, fine, rileggo e porto il testo nella nota', async ({ page }, info) => {
    test.setTimeout(180_000);
    await startService();
    await syntheticMicrophone(page);
    await bootstrapUnlockedSession(page, pin);
    const patientId = await syntheticPatient(page, 'Ascolto');
    await openUnlockedDocument(page, `/patients/${patientId}/modules`, pin);
    const command = page.getByRole('link', { name: 'Registra la visita' });
    await expect(command).toBeVisible();
    await expect(page.locator('[data-lume-primary="true"], .mf-button-primary').filter({ visible: true })).toHaveCount(1);
    await capture(info, page, '1-scheda-con-registra.png');

    await command.click();
    const recorder = page.getByTestId('local-voice-recorder');
    await expect(recorder.getByRole('button', { name: 'Ascolta la visita' })).toBeFocused();
    await capture(info, page, '2-registrazione-pronta.png');
    await recordUntilReview(page, recorder, true);
    expect(service().state.session?.subject).toBe(`paziente:${patientId}`);
    expect(Math.abs(dominantFrequency(service().samples(), 16_000) - TONE_HZ)).toBeLessThan(15);
    const commandsSent = service().state.requests.filter((item) => item.path.endsWith('/commands')).length;
    expect(commandsSent).toBe(4);

    const review = recorder.getByTestId('local-voice-review');
    await expect(review).toHaveValue('Medico: Buongiorno, come va la pressione in questi giorni?\nPaziente: Bene, prendo il Ramipli ogni mattina.\nMedico: Continuiamo così e ci rivediamo fra tre mesi.');
    await capture(info, page, '3-testo-da-rivedere.png');
    await browserKeepsNoText(page, ['Ramipli', 'Buongiorno, come va']);
    await recorder.getByRole('button', { name: 'Ramipli → Ramipril' }).click();
    await recorder.getByRole('button', { name: 'Scambia medico e paziente' }).click();
    await expect(review).toHaveValue(/^Paziente: Buongiorno/u);
    await recorder.getByRole('button', { name: 'Scambia medico e paziente' }).click();
    await expect(review).toHaveValue(/^Medico: Buongiorno.*\nPaziente: Bene, prendo il Ramipril ogni mattina\./u);
    const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
    await expect(editor).toHaveText('');

    await recorder.getByTestId('local-voice-take').click();
    await expect(editor).toContainText('Paziente: Bene, prendo il Ramipril ogni mattina.');
    await expect.poll(() => service().state.session).toBeNull();
    await expect(recorder.getByRole('button', { name: 'Ascolta la visita' })).toBeVisible();
    expect(await page.evaluate(async (id) => (await fetch(`/api/entries?patientId=${id}`)).json(), patientId)).toEqual([]);
    await capture(info, page, '4-testo-nella-nota.png');

    await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
    await page.getByRole('button', { name: 'Conferma e registra', exact: true }).click();
    await expect(page.getByText(/^Registrata alle/u)).toBeVisible({ timeout: 30_000 });
    const entries = await page.evaluate(async (id) => (await fetch(`/api/entries?patientId=${id}`)).json() as Promise<Array<{ content: string }>>, patientId);
    expect(entries).toHaveLength(1);
});

test('da «Nuova scheda»: registro una prima visita, l’anagrafica detta è proposta con il passaggio e creo la scheda con il PIN', async ({ page }, info) => {
    test.setTimeout(240_000);
    const taxCode = randomSyntheticTaxCode();
    const birth = taxCodeBirthDetails(taxCode)!;
    const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const year = 1900 + birth.yearSuffix;
    await startService('ready', [
        { speaker: 'doctor', text: 'Buongiorno, è la prima volta da me: mi dice i suoi dati?' },
        { speaker: 'patient', text: `Cognome: Bianchi. Nome: Anna. Sono nata il ${birth.day} ${months[birth.month - 1]} ${year}.` },
        { speaker: 'patient', text: `Codice fiscale ${taxCode}.` },
        { speaker: 'doctor', text: 'Bene, misuriamo la pressione.' },
    ]);
    await syntheticMicrophone(page);
    await bootstrapUnlockedSession(page, pin);
    await openUnlockedDocument(page, '/patients/new', pin);
    const recorder = page.getByTestId('local-voice-recorder');
    await expect(recorder.getByRole('heading', { name: 'Registra la prima visita' })).toBeVisible();
    await capture(info, page, '5-nuova-scheda-con-registrazione.png');
    await recordUntilReview(page, recorder, false);
    expect(service().state.session?.subject).toMatch(/^prima-visita:[a-f0-9-]{36}$/u);
    await capture(info, page, '6-prima-visita-da-rivedere.png');
    await recorder.getByRole('button', { name: 'Usa per la nuova scheda' }).click();
    await expect.poll(() => service().state.session).toBeNull();

    const group = page.getByTestId('dossier-import').getByTestId('dossier-group');
    await expect(group).toHaveAttribute('data-identity', 'unmatched_cf', { timeout: 120_000 });
    await expect(group.getByTestId('dossier-source')).toHaveCount(1);
    await expect(group.getByTestId('dossier-source')).toContainText(/prima-visita-\d{4}-\d{2}-\d{2}\.pdf/u);
    const create = group.getByTestId('dossier-new-patient').getByTestId('patient-document-create');
    await create.getByRole('button', { name: 'Avvia la revisione del documento' }).click();
    await expect(create.getByRole('heading', { name: 'Revisione dei dati' })).toBeVisible({ timeout: 60_000 });
    const proposals = create.getByTestId('patient-document-dossier-proposals');
    await expect(proposals).toContainText('Cognome: Bianchi');
    await expect(proposals).toContainText(`nata il ${birth.day} ${months[birth.month - 1]} ${year}`);
    await capture(info, page, '7-anagrafica-proposta-dalla-visita.png');
    await create.getByRole('button', { name: 'Usa tutte le proposte' }).click();
    await expect(create.getByLabel('Cognome', { exact: true })).toHaveValue('Bianchi');
    await expect(create.getByLabel('Nome', { exact: true })).toHaveValue('Anna');
    await expect(create.getByLabel('Codice fiscale', { exact: true })).toHaveValue(taxCode);
    await expect(create.getByLabel('Data di nascita', { exact: true })).toHaveValue(`${year}-${String(birth.month).padStart(2, '0')}-${String(birth.day).padStart(2, '0')}`);
    await expect(create.locator('#patient-document-lastName-source')).toHaveText(/^Fonte: prima-visita-.*\.pdf$/u);
    await create.getByRole('button', { name: 'Prosegui alla conferma' }).click();
    await create.getByLabel('PIN di conferma').fill(pin);
    await create.getByRole('button', { name: 'Conferma creazione con PIN' }).click();
    await expect(create.getByRole('heading', { name: 'Scheda creata', exact: true })).toBeVisible({ timeout: 30_000 });
    await capture(info, page, '8-scheda-creata.png');
});

test('servizio assente o modello mancante: la pagina lo dice e non offre di registrare', async ({ page }, info) => {
    test.setTimeout(120_000);
    await fake?.close();
    fake = null;
    await syntheticMicrophone(page);
    await bootstrapUnlockedSession(page, pin);
    const patientId = await syntheticPatient(page, 'Silenzio');
    await openUnlockedDocument(page, `/patients/${patientId}/modules`, pin);
    await expect(page.getByRole('link', { name: 'Nuova voce' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Registra la visita' })).toHaveCount(0);
    await openUnlockedDocument(page, `/patients/${patientId}/modules?voce=nuova`, pin);
    const recorder = page.getByTestId('local-voice-recorder');
    await expect(recorder.getByTestId('local-voice-notice')).toHaveText('Il servizio della voce non è attivo su questo computer.');
    await expect(recorder.getByRole('button')).toHaveCount(0);
    await capture(info, page, '9-servizio-assente.png');

    await startService('missing');
    await openUnlockedDocument(page, `/patients/${patientId}/modules?voce=nuova`, pin);
    await expect(recorder.getByTestId('local-voice-notice')).toHaveText('Manca il modello della voce su questo Mac.');
    await expect(recorder.getByRole('button')).toHaveCount(0);
    await openUnlockedDocument(page, '/patients/new', pin);
    await expect(recorder.getByTestId('local-voice-notice')).toHaveText('Manca il modello della voce su questo Mac.');
    await expect(recorder.getByRole('button')).toHaveCount(0);
    expect(service().state.requests.filter((item) => item.path === '/v1/sessions')).toEqual([]);
    await capture(info, page, '10-modello-mancante.png');
});

test('il testo di un altro paziente o di un’altra prima visita non viene preparato', async ({ page, context }, info) => {
    test.setTimeout(180_000);
    await startService();
    await syntheticMicrophone(page);
    await bootstrapUnlockedSession(page, pin);
    const first = await syntheticPatient(page, 'Primo');
    const second = await syntheticPatient(page, 'Secondo');
    await openUnlockedDocument(page, `/patients/${first}/modules?voce=nuova`, pin);
    await recordUntilReview(page, page.getByTestId('local-voice-recorder'), false);

    await openUnlockedDocument(page, `/patients/${second}/modules?voce=nuova`, pin);
    const recorder = page.getByTestId('local-voice-recorder');
    await expect(recorder.getByTestId('local-voice-foreign')).toContainText('C’è da rivedere la registrazione di un altro paziente.');
    await expect(recorder.getByTestId('local-voice-review')).toHaveCount(0);
    await expect(recorder.getByRole('button', { name: 'Ascolta la visita' })).toHaveCount(0);
    await expect(page.getByText('Buongiorno, come va la pressione')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Resoconto clinico', exact: true })).toHaveText('');
    await capture(info, page, '11-registrazione-di-un-altro-paziente.png');
    await recorder.getByRole('link', { name: 'Apri la sua scheda' }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${first}/modules\\?voce=nuova#registrazione$`));
    await expect(page.getByTestId('local-voice-review')).toBeVisible();

    service().state.subjectOverride = `paziente:${second}`;
    await openUnlockedDocument(page, `/patients/${first}/modules?voce=nuova`, pin);
    await expect(page.getByTestId('local-voice-foreign')).toContainText('C’è da rivedere la registrazione di un altro paziente.');
    await expect(page.getByTestId('local-voice-review')).toHaveCount(0);
    await expect(page.getByText('Buongiorno, come va la pressione')).toHaveCount(0);
    service().state.subjectOverride = null;
    await openUnlockedDocument(page, `/patients/${first}/modules?voce=nuova`, pin);
    await expect(page.getByTestId('local-voice-review')).toBeVisible();
    await page.getByTestId('local-voice-recorder').getByRole('button', { name: 'Scarta' }).click();
    await page.getByRole('button', { name: 'Scarta', exact: true }).last().click();
    await expect.poll(() => service().state.session).toBeNull();

    await openUnlockedDocument(page, '/patients/new', pin);
    await recordUntilReview(page, page.getByTestId('local-voice-recorder'), false);
    const other = await context.newPage();
    await syntheticMicrophone(other);
    await openUnlockedDocument(other, '/patients/new', pin);
    const elsewhere = other.getByTestId('local-voice-recorder');
    await expect(elsewhere.getByTestId('local-voice-foreign')).toContainText('C’è da rivedere la registrazione di una prima visita aperta altrove.');
    await expect(elsewhere.getByTestId('local-voice-review')).toHaveCount(0);
    await expect(other.getByTestId('dossier-group')).toHaveCount(0);
    await capture(info, other, '12-prima-visita-di-un-altra-bozza.png');
    await elsewhere.getByRole('button', { name: 'Scarta quella registrazione' }).click();
    await other.getByRole('button', { name: 'Scarta', exact: true }).last().click();
    await expect.poll(() => service().state.session).toBeNull();
    await expect(elsewhere.getByRole('button', { name: 'Ascolta la visita' })).toBeVisible();
});
