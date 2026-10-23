import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { snapshotTreatmentReasoningProjectionAttachment, type TreatmentReasoningProjectionAttachment } from '../lib/ai-providers/fabric/treatment-reasoning-projection';
import { bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { HANDLE, AMBULATORY_A, FIXTURE_CATALOG, publicationFor, createFixture } from './fixtures/treatment-reasoning';

const panel = (page: Page) => page.getByTestId('treatment-reasoning-panel');
const disclosure = (page: Page) => page.locator('#terapie').getByRole('button', { name: 'Proposte', exact: true });
const baseline = process.env.TREATMENT_PROPOSAL_BASELINE === '1';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
test.describe.configure({ retries: 0 });
type State = 'spenta' | 'pronta' | 'in-corso' | 'proposta' | 'errore';

async function fixture(page: Page, state: State = 'pronta') {
    let projection: TreatmentReasoningProjectionAttachment | undefined;
    let release = () => {};
    const response = new Promise<void>(resolve => { release = resolve; });
    const generations: string[] = [];
    await page.route('**/api/settings/ai/functions', route => route.fulfill({ json: FIXTURE_CATALOG }));
    await page.route('**/api/ambulatories', route => route.fulfill({ json: [AMBULATORY_A] }));
    await page.route('**/api/ai/smart-import/selection', route => route.fulfill({ json: route.request().method() === 'GET' ? { selectionEpoch: 0 } : {
        selection: { sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1, patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`, leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: Number.MAX_SAFE_INTEGER },
    } }));
    await page.route('**/api/ai/treatment-reasoning/ingest', async route => {
        generations.push('ingest');
        projection = snapshotTreatmentReasoningProjectionAttachment(route.request().postDataJSON().projection, new Date().toISOString());
        await route.fulfill({ json: { handle: HANDLE } });
    });
    await page.route('**/api/ai/treatment-reasoning/preview', async route => {
        generations.push('preview');
        if (state === 'in-corso') await response;
        if (!projection) throw new Error('Projection sintetica assente');
        await route.fulfill(state === 'errore' ? { status: 503, json: { error: 'synthetic_unavailable' } } : { json: publicationFor(projection) });
    });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await setAiLaneKillSwitch(page, 'aiTreatmentReasoningKillSwitch', state === 'spenta' ? 'disabled' : 'enabled');
    const { patientId } = await createFixture(page);
    await page.goto(`/patients/${patientId}/modules`);
    await openPatientSection(page, 'terapie');
    await expect(page.locator('#terapie [data-clinical-register="therapies"]')).toContainText('Farmaco sintetico locale');
    return { generations, release };
}

async function open(page: Page) {
    if (await disclosure(page).count()) await disclosure(page).click();
    await expect(panel(page)).toBeVisible();
}

async function prepare(page: Page) {
    await panel(page).getByRole('button', { name: 'Prepara proposta', exact: true }).click();
    await expect(panel(page).getByLabel('Ambulatorio per questa proposta')).toBeVisible();
}

async function generate(page: Page) {
    await prepare(page);
    await panel(page).getByLabel('Ambulatorio per questa proposta').selectOption(AMBULATORY_A.id);
    await panel(page).getByRole('checkbox').check();
    await panel(page).getByRole('button', { name: 'Conferma e genera proposta' }).click();
}

async function reach(page: Page, state: State) {
    const run = await fixture(page, state);
    await open(page);
    if (['in-corso', 'proposta', 'errore'].includes(state)) await generate(page);
    if (state === 'in-corso') await expect(panel(page).getByRole('status').filter({ hasText: 'Preparazione della proposta…' })).toBeVisible();
    if (state === 'proposta') await expect(panel(page).getByTestId('treatment-reasoning-proposal')).toBeVisible();
    if (state === 'errore') await expect(panel(page).getByRole('alert')).toContainText('Anteprima non disponibile');
    return run;
}

test('difetto D6: Proposte chiusa sotto il registro, senza generazione all’apertura', async ({ page }) => {
    const { generations } = await fixture(page);
    await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page)).toBeHidden();
    expect(await disclosure(page).evaluate(element => !!(document.querySelector('#terapie [data-clinical-register="therapies"]')!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await disclosure(page).focus(); await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    expect(generations).toEqual([]);
    await prepare(page);
    await disclosure(page).click(); await disclosure(page).click();
    await expect(panel(page).getByLabel('Ambulatorio per questa proposta')).toBeVisible();
    await disclosure(page).focus(); await page.keyboard.press('Space');
    await expect(disclosure(page)).toBeFocused();
    await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'false');
});

test('difetto D14: funzione spenta mostra solo prerequisito e collegamento', async ({ page }) => {
    await reach(page, 'spenta');
    await expect(panel(page)).toContainText('Ragionamento terapeutico spento');
    await expect(panel(page).getByRole('link', { name: 'Apri le funzioni cliniche' })).toHaveAttribute('href', '/settings/ai/funzioni');
    await expect(panel(page).getByRole('button')).toHaveCount(0);
    await expect(panel(page).getByTestId('model-picker-treatment_reasoning')).toHaveCount(0);
    await expect(panel(page).getByRole('heading')).toHaveCount(0);
});

test('difetto D14: conferma transitoria quieta con spiegazione adiacente', async ({ page }) => {
    await fixture(page); await open(page); await prepare(page);
    const confirm = panel(page).getByRole('button', { name: 'Conferma e genera proposta' });
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveClass(/mf-button-secondary/);
    await expect(confirm).not.toHaveCSS('background-color', await page.getByRole('link', { name: 'Nuova voce', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor));
    await expect(panel(page).getByText('Scegli l’ambulatorio e conferma paziente e ambulatorio prima di generare.')).toBeVisible();
    await expect(page.locator('.mf-button-primary:visible')).toHaveCount(1);
    await page.locator('#terapie').getByRole('button', { name: 'Nuova terapia', exact: true }).click();
    await expect(page.locator('.mf-button-primary:visible')).toHaveCount(1);
    await expect(confirm).toHaveClass(/mf-button-secondary/);
});

test('pronta: modello riassunto, Cambia apre il campo comune', async ({ page }) => {
    await reach(page, 'pronta');
    await expect(panel(page).getByText('Modello: predefinito', { exact: true })).toBeVisible();
    await expect(panel(page).getByRole('combobox', { name: 'Modello per questa proposta' })).toBeHidden();
    await panel(page).getByRole('button', { name: 'Cambia', exact: true }).click();
    await expect(panel(page).getByRole('combobox', { name: 'Modello per questa proposta' })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Prepara proposta' })).toBeEnabled();
});

test('in corso: stato annunciato e nessun secondo avvio', async ({ page }) => {
    const run = await reach(page, 'in-corso');
    await expect(panel(page).getByRole('button', { name: /Prepara proposta|Conferma e genera/ })).toHaveCount(0);
    await expect.poll(() => run.generations).toEqual(['ingest', 'preview']);
    run.release();
    await expect(panel(page).getByTestId('treatment-reasoning-proposal')).toBeVisible();
});

test('proposta: matita, tratteggio, fonti e nessuna duplicazione nel Riepilogo', async ({ page }) => {
    await reach(page, 'proposta');
    const published = panel(page).getByTestId('treatment-reasoning-proposal');
    await expect(published).toHaveAttribute('data-ink-state', 'proposal');
    await expect(published.getByRole('heading', { name: 'Proposta', exact: true })).toBeVisible();
    await expect(published.getByRole('heading', { name: 'Proposta', exact: true }).locator('svg')).toHaveAttribute('aria-hidden', 'true');
    const lead = published.getByText('Rivedere la terapia sintetica prima di ogni decisione clinica.', { exact: true }).first();
    expect(await lead.evaluate(element => getComputedStyle(element.closest('p')!).textDecorationStyle)).toBe('dashed');
    await published.getByRole('button', { name: 'Terapia · Fonte 2: espandi le fonti della proposta' }).first().click();
    await expect(published.getByRole('button', { name: 'Fonti della proposta', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(published.getByText('ATHENA MLX · locale', { exact: true })).toBeHidden();
    await published.getByRole('button', { name: 'Origine e dettagli della generazione' }).click();
    await expect(published.getByText('ATHENA MLX · locale', { exact: true })).toBeVisible();
    await expect(published.getByRole('button', { name: /applica/i })).toHaveCount(0);
    await openPatientSection(page, 'quadro');
    await expect(panel(page)).toBeHidden();
    await openPatientSection(page, 'terapie');
    await expect(published).toBeVisible();
});

test('errore: causa visibile distinta da funzione spenta e recupero esplicito', async ({ page }) => {
    await reach(page, 'errore');
    await expect(panel(page)).not.toContainText('Ragionamento terapeutico spento');
    await expect(panel(page).getByRole('button', { name: 'Annulla', exact: true })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(panel(page).getByRole('button', { name: 'Prepara proposta' })).toBeDisabled();
    await panel(page).getByRole('button', { name: 'Riusa predefinito', exact: true }).click();
    await expect(panel(page).getByRole('button', { name: 'Prepara proposta' })).toBeEnabled();
});

test.describe('comandi al tocco', () => {
    test.use({ hasTouch: true });
    test('conferma raggiungibile con bersaglio di almeno 44 px', async ({ page }) => {
        await fixture(page); await open(page); await prepare(page);
        await panel(page).getByLabel('Ambulatorio per questa proposta').selectOption(AMBULATORY_A.id);
        await panel(page).getByRole('checkbox').check();
        const confirm = panel(page).getByRole('button', { name: 'Conferma e genera proposta' });
        for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            await confirm.scrollIntoViewIfNeeded();
            await expect(confirm).toBeEnabled();
            expect(await confirm.evaluate(element => {
                const rect = element.getBoundingClientRect();
                return matchMedia('(pointer: coarse)').matches && rect.height >= 44
                    && rect.left >= 0 && rect.right <= innerWidth
                    && [rect.top + 2, rect.bottom - 2].every(y => element.contains(document.elementFromPoint(rect.x + rect.width / 2, y)));
            }), `Conferma al tocco a ${width}`).toBe(true);
        }
    });
});

for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
    test(`catture proposta ${theme} ${size}`, async ({ page, baseURL }) => {
        test.setTimeout(180_000);
        const zoom = size.startsWith('zoom-') ? await openBrowserZoomFixture(baseURL!) : undefined;
        try {
            if (zoom) page = zoom.page;
            await page.setViewportSize({ width: zoom ? 1440 : Number(size), height: 1000 });
            const dir = process.env.TREATMENT_PROPOSAL_CAPTURES || test.info().outputPath('captures');
            await mkdir(dir, { recursive: true });
            for (const state of ['spenta', 'pronta', 'in-corso', 'proposta', 'errore'] as const) {
                if (zoom) await zoom.setZoom(1);
                await page.setViewportSize({ width: 1440, height: 1000 });
                const run = await reach(page, state);
                if (!zoom) await page.setViewportSize({ width: Number(size), height: 1000 });
                await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
                if (zoom) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
                await panel(page).scrollIntoViewIfNeeded();
                if (!baseline) {
                    await assertNoHorizontalOverflow(page, [{ label: 'documento', selector: 'document' }, { label: 'proposte', selector: '[data-testid="treatment-reasoning-panel"]' }]);
                    if (state === 'pronta') {
                        const action = panel(page).getByRole('button', { name: 'Prepara proposta' });
                        await action.focus();
                        await assertNotClippedInViewport(action, 'Prepara proposta');
                    }
                }
                const path = `${dir}/${baseline ? 'prima' : 'dopo'}-${theme}-${size}-${state}.png`;
                await page.screenshot({ path, animations: 'disabled', fullPage: !zoom });
                await test.info().attach(`${state}-${sha}`, { path, contentType: 'image/png' });
                run.release();
                if (state === 'in-corso') await expect(panel(page).getByTestId('treatment-reasoning-proposal')).toBeVisible();
            }
            await test.info().attach('revisione', { body: `${sha}\n${baseline ? 'prima' : 'dopo'}\n${zoom ? `Zoom reale Chromium ${size}` : `Viewport ${size}`}`, contentType: 'text/plain' });
        } finally { await zoom?.close(); }
    });
}
