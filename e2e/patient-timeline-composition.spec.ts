import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow } from './utils';

test('Timeline paziente: indice cronologico e accessi allo storico senza duplicare il Diario', async ({ baseURL }) => {
    test.setTimeout(180_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw new Error('Archivio e runtime sintetici isolati richiesti');
    const baseline = process.env.PATIENT_TIMELINE_BASELINE === '1';
    const causal = process.env.PATIENT_TIMELINE_CAUSAL === '1';
    const directory = process.env.PATIENT_TIMELINE_SCREENSHOTS;
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const errors: string[] = [], external: string[] = [], generations: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && /\/api\/ai\//u.test(request.url())) generations.push(request.url()); });
    await page.route('**/*', route => {
        if (new URL(route.request().url()).origin !== new URL(baseURL).origin) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
    });
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'atlas-history', checkedAt: '2026-10-26T10:00:00Z', browserProfile: null, warning: 'Fixture sintetica: nessuna osservazione reale.', sessionHealth: 'none', lastModule: null, lastModuleLabel: null, lastModuleAt: null, checkpoints: [] } }));
    const surfaces: unknown[] = [];
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        const fixture = await page.evaluate(async () => {
            const post = async (path: string, body: unknown) => {
                const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
                if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json();
            };
            const empty = await post('patients', { firstName: 'Timeline', lastName: 'Vuota sintetica', taxCode: `T15${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}`, birthDate: '1980-01-01', diagnoses: [] });
            const patient = await post('patients', { firstName: 'Timeline', lastName: 'Sintetica', taxCode: `T15${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}`, birthDate: '1980-01-01', diagnoses: [] });
            const entries: string[] = [];
            for (let n = 0; n < 6; n++) {
                const entry = await post('entries', { patientId: patient.id, type: n === 0 ? 'legacy-local-note' : 'visit', date: `2026-10-${26 - n}T10:00:00Z`, title: `Voce storica sintetica ${n + 1}`, content: `<p>Prosa originale del Diario ${n + 1}, da leggere integralmente nella sua sezione.</p>`, metadata: { authorName: 'Ada Sintetica', sourceLabel: 'Fonte inventata W15b', workflowStatus: 'signed' } }); entries.push(entry.id);
            }
            await post('entries', { patientId: patient.id, type: 'scale', date: '2026-10-31T10:00:00Z', title: 'Scala separata W15b', content: 'Storico della scala separato.', metadata: { title: 'Scala separata W15b', score: 1 } });
            for (let n = 0; n < 3; n++) await post('checkups', { patientId: patient.id, title: `Controllo sintetico ${n + 1}`, date: `2026-10-${28 - n}T12:00:00Z`, notes: `Nota originale controllo ${n + 1}`, status: 'pending' });
            const insights = Array.from({ length: 3 }, (_, n) => ({ id: `source-${n}`, fileName: `Fonte archiviata ${n + 1}.txt`, date: `2026-10-${30 - n}T10:00:00Z`, summary: `Sintesi storica inventata ${n + 1}, da rivedere sulla fonte.`, rawMarkdown: `Testo sorgente archiviato originale ${n + 1}.` }));
            const current = await (await fetch(`/api/patients/${patient.id}`)).json();
            const update = await fetch(`/api/patients/${patient.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: current.version, documentInsights: JSON.stringify(insights) }) });
            if (!update.ok) throw new Error(`Archive seed: ${update.status}`);
            return { patientId: patient.id as string, emptyId: empty.id as string, entries };
        });
        if (directory) await mkdir(directory, { recursive: true });
        const capture = async (state: string) => {
            if (causal) return;
            for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
                await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
                if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4); else await page.setViewportSize({ width: Number(size), height: 1000 });
                await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
                const pane = page.locator('#timeline'); await pane.scrollIntoViewIfNeeded();
                await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'Timeline', selector: '#timeline' }]);
                if (!baseline && state === 'piena') {
                    const link = pane.getByRole('link', { name: 'Apri il Diario', exact: true }); await link.evaluate(element => element.scrollIntoView({ block: 'center' })); await link.focus(); await expect(link).toBeFocused();
                    await expect.poll(() => link.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return element === hit || element.contains(hit); })).toBe(true);
                }
                const anchor = state === 'piena' ? pane.locator('h3').filter({ hasText: 'Fonte archiviata 1.txt' }) : state === 'singola' ? pane.locator('h3').filter({ hasText: 'Voce unica sintetica' }) : pane.getByText(/^Nessun evento recente/u);
                await anchor.evaluate(element => element.scrollIntoView({ block: 'center' }));
                if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
                surfaces.push({ state, theme, size, cssWidth: await page.evaluate(() => innerWidth) });
            }
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        };
        await page.goto(`/patients/${fixture.emptyId}/modules`); await openPatientSection(page, 'timeline');
        await expect(page.locator('#timeline')).toContainText('Nessun evento recente'); await capture('vuota');
        await page.evaluate(async patientId => {
            const response = await fetch('/api/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patientId, type: 'note', date: '2026-10-26', title: 'Voce unica sintetica', content: 'Testo della voce unica, conservato nel Diario.' }) });
            if (!response.ok) throw new Error(`Single fixture: ${response.status}`);
        }, fixture.emptyId);
        await page.reload(); await openPatientSection(page, 'timeline');
        await expect(page.locator('#timeline').getByRole('article')).toHaveCount(1); await capture('singola');
        await page.goto(`/patients/${fixture.patientId}/modules`); await openPatientSection(page, 'timeline');
        const pane = page.locator('#timeline'), feed = pane.getByRole('feed', { name: 'Timeline clinica del paziente', exact: true });
        await expect(feed.getByRole('article')).toHaveCount(6);
        await expect(pane).toContainText('6 eventi di 12'); await expect(pane).not.toContainText('Scala separata W15b');
        expect(await feed.locator('h3').allTextContents()).toEqual(['Fonte archiviata 1.txt', 'Fonte archiviata 2.txt', 'Controllo sintetico 2', 'Controllo sintetico 3', 'Voce storica sintetica 1', 'Voce storica sintetica 2']);
        if (!baseline || causal) {
            await expect(pane.getByRole('link', { name: 'Apri il Diario', exact: true })).toBeVisible();
            await expect(pane).not.toContainText('Prosa originale del Diario');
            await expect(feed.locator('[data-ink="pencil"]')).toHaveCount(2);
            await expect(feed).toContainText('Sintesi archiviata');
            await expect(feed.locator('article > time')).toHaveCount(6);
        }
        await capture('piena');
        if (!baseline) {
            await pane.getByRole('link', { name: 'Apri il Diario', exact: true }).focus(); await page.keyboard.press('Enter');
            const diary = page.locator('#diario'); await expect(diary).toBeVisible();
            await expect(diary.getByRole('article')).toHaveCount(6); await expect(diary).toContainText('Prosa originale del Diario 6'); await expect(diary).toContainText('Ada Sintetica'); await expect(diary).toContainText('Fonte inventata W15b');
            await openPatientSection(page, 'timeline'); await pane.getByRole('link', { name: 'Controlli', exact: true }).click();
            await expect(page.locator('#follow-up')).toBeVisible(); await expect(page.locator('#follow-up')).toContainText('Controllo sintetico 3');
            await openPatientSection(page, 'timeline'); await pane.getByRole('link', { name: 'Documenti', exact: true }).click();
            await expect(page.locator('#documenti')).toBeVisible(); await page.locator('#documenti').getByRole('button', { name: /^Sintesi archiviate/u }).click(); await expect(page.getByTestId('document-insights-archive')).toBeVisible();
            await page.getByTestId('document-insights-archive').getByRole('button', { name: /^Fonte archiviata 3.txt/u }).click();
            await expect(page.getByTestId('document-insights-archive')).toContainText('Testo sorgente archiviato originale 3.');
            await openPatientSection(page, 'timeline');
            await pane.getByRole('link', { name: 'Apri Fonte archiviata 1.txt · Sintesi archiviata', exact: true }).click();
            await expect(page.getByTestId('document-insights-archive')).toBeVisible();
            const after = await page.evaluate(async id => ({ patient: await (await fetch(`/api/patients/${id}`)).json(), entries: await (await fetch(`/api/entries?patientId=${id}`)).json() }), fixture.patientId);
            expect(after.entries.filter((entry: { type: string }) => entry.type !== 'scale')).toHaveLength(6);
            expect(after.entries.every((entry: { version: number }) => entry.version === 1)).toBe(true);
            expect(after.patient.version).toBe(2); expect(JSON.parse(after.patient.documentInsights)).toHaveLength(3);
        }
        if (directory) await writeFile(`${directory}/surfaces.json`, JSON.stringify({ fixture, surfaces, errors, external, generations }, null, 2));
        expect(errors).toEqual([]); expect(external).toEqual([]); expect(generations).toEqual([]);
    } finally { await zoom.close(); }
});
