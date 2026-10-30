import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { test, closureGallery } from './fixtures/patient-closure-gallery';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

async function fixture(page: Page) {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    return page.evaluate(async () => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Ada sintetica', lastName: 'Lettura', taxCode: `SYN${crypto.randomUUID()}`, notes: 'Nota sintetica W10: lettura conclusa, nessun dato reale.' }) });
        if (!response.ok) throw new Error(`Patient fixture: ${response.status}`);
        return (await response.json()).id as string;
    });
}

async function capture(page: Page, state: string) {
    if (await closureGallery(page, 'followup', state, state.startsWith('followup') ? page.locator('#follow-up') : page.getByTestId('patient-profile-notes'))) return;
    const directory = process.env.W10_EVIDENCE_DIR;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    for (const theme of ['giorno', 'grafite']) for (const width of [1440, 768]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.evaluate(theme => {
            document.documentElement.classList.remove('light', 'dark');
            document.documentElement.classList.add(theme === 'giorno' ? 'light' : 'dark');
        }, theme);
        const file = `${state}-${theme}-${width}`;
        await page.screenshot({ path: `${directory}/${file}.png`, fullPage: true, animations: 'disabled' });
        await writeFile(`${directory}/${file}.json`, JSON.stringify({ state, theme, width,
            head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            diff: execFileSync('git', ['diff', '--stat'], { encoding: 'utf8' }),
            url: page.url(), text: await page.locator('main').first().innerText() }, null, 2));
    }
}

for (const state of ['loading', 'error', 'empty', 'available'] as const) test(`Follow-up: ${state}`, async ({ page }) => {
    test.setTimeout(180_000);
    const id = await fixture(page);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let reads = 0, replied = 0;
    await page.route('**/api/checkups?**', async route => {
        reads++;
        if (state === 'loading') await pending;
        await route.fulfill({ status: state === 'error' ? 500 : 200, contentType: 'application/json', body: JSON.stringify(state === 'available'
            ? [{ id: 'synthetic-checkup', patientId: id, title: 'Controllo sintetico W10', notes: 'Nota del controllo sintetico', date: '2027-01-10', status: 'pending' }]
            : state === 'error' ? { error: 'Synthetic read failure' } : []) });
        replied++;
    });
    try {
        await page.goto(`/patients/${id}/modules`);
        if (state !== 'loading') { await expect.poll(() => replied).toBeGreaterThan(0); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
        await openPatientSection(page, 'follow-up');
        const section = page.locator('#follow-up');
        if (state === 'loading') await expect.poll(() => reads).toBeGreaterThan(0);
        else if (state === 'available') await expect(section).toContainText('Controllo sintetico W10');

        await capture(page, `followup-${state}`);
        if (state === 'loading' || state === 'error') await expect(section.getByRole('heading')).not.toContainText(/\d+ follow-up/);
        else await expect(section.getByRole('heading')).toContainText(`${state === 'empty' ? 0 : 1} follow-up`);
        const creation = section.getByRole('link', { name: 'Aggiungi follow-up', exact: true });
        await expect(creation).toHaveCount(1);
        await expect(creation).toHaveAttribute('href', `/patients/${id}/edit#pianificazione`);
        if (state === 'loading') {
            await expect(section.getByRole('status')).toContainText('Lettura dei follow-up in corso');
            await expect(section).not.toContainText('Nessun follow-up pianificato');
            release();
            await expect(section).toContainText('Nessun follow-up pianificato');
        } else if (state === 'error') {
            await expect(section.getByRole('alert')).toContainText('Impossibile leggere i follow-up');
            await expect(section).not.toContainText('Nessun follow-up pianificato');
        } else if (state === 'empty') await expect(section.getByRole('status')).toContainText('Nessun follow-up pianificato');
        else await expect(section).toContainText('Nota del controllo sintetico');
        await expect(section.locator('[data-section-header]').getByRole('link', { name: 'Aggiungi follow-up', exact: true })).toHaveCount(1);
    } finally { release(); }
});

for (const state of ['loading', 'unavailable', 'available'] as const) test(`Note cattura 011: ${state}`, async ({ page }) => {
    test.setTimeout(180_000);
    const id = await fixture(page);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route(`**/api/patients/${id}/profile-query`, async route => {
        requests++;
        if (state === 'loading') await pending;
        if (state === 'unavailable') await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic scope denial' }) });
        else await route.continue();
    });
    try {
        await page.goto(`/patients/${id}/modules`);
        const notes = page.getByTestId('patient-profile-notes');
        if (state === 'loading') {
            await expect.poll(() => requests).toBeGreaterThan(0);
            await expect(notes.getByRole('status')).toContainText('Lettura delle note in corso');
        } else if (state === 'unavailable') await expect(notes.getByRole('alert')).toContainText('La sessione corrente non consente di leggere queste note');
        else await expect(notes).toContainText('Nota sintetica W10: lettura conclusa');
        await capture(page, `notes-${state}`);
        await expect(notes).not.toContainText('Nessuna nota generale registrata');
        if (state === 'loading') {
            release();
            await expect(notes).toContainText('Nota sintetica W10: lettura conclusa');
        }
        await expect(notes).not.toContainText('Lettura delle note in corso');
        if (state === 'unavailable') await expect(notes.getByRole('button', { name: 'Riapri le note', exact: true })).toBeVisible();
    } finally { release(); }
});
