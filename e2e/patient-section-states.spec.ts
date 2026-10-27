import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow } from './utils';

async function patient(page: Page) {
    page.on('pageerror', error => console.log(`HC6_PAGE_ERROR ${error.stack ?? error.message}`));
    page.on('console', message => { if (message.type() === 'error') console.log(`HC6_CONSOLE_ERROR ${message.text()}`); });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    return page.evaluate(async () => {
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ firstName: 'Sezioni', lastName: 'Sintetiche', taxCode: `HC6${crypto.randomUUID()}`, birthDate: '1980-01-01', diagnoses: [] }),
        });
        if (!response.ok) throw new Error(`Synthetic patient: ${response.status}`);
        return (await response.json()).id as string;
    });
}

async function alignedHeader(pane: Locator) {
    const header = pane.locator(':scope > [data-section-header], :scope > h3');
    await expect(header).toHaveCount(1);
    const boxes = await header.evaluate(element => {
        const header = element.getBoundingClientRect(), pane = element.parentElement!.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { left: header.left - pane.left, right: pane.right - header.right, rule: style.borderBottomWidth };
    });
    expect(Math.abs(boxes.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes.right)).toBeLessThanOrEqual(1);
    expect(boxes.rule).toBe('1px');
    await expect(header.getByRole('heading').or(header.and(pane.getByRole('heading')))).toHaveCSS('font-size', '12px');
}

test('sezioni vuote: ricetta unica, creazione presso il titolo e Nuova voce stabile fra destinazioni', async ({ page }) => {
    test.setTimeout(180_000);
    const id = await patient(page);
    await page.goto(`/patients/${id}/modules`);
    for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 960 });
        for (const [section, title, creation] of [
            ['terapie', 'Nessuna terapia registrata.', 'Nuova terapia'],
            ['parametri', 'Nessuna misura registrata.', 'Nuova misura'],
            ['clinica', 'Nessuna diagnosi registrata.', ''],
            ['scale', 'Nessuna valutazione registrata.', ''],
            ['diario', 'Nessuna voce visibile nel diario clinico.', ''],
            ['follow-up', 'Nessun follow-up pianificato.', 'Aggiungi follow-up'],
            ['prestazioni', 'Nessuna prestazione prescritta registrata.', 'Nuova prestazione'],
            ['protesica', 'Nessuna prescrizione protesica registrata per questo paziente.', 'Nuova voce protesica'],
        ]) {
            await openPatientSection(page, section);
            const pane = page.locator(`#${section}`), state = pane.locator('[data-view-state=empty]');
            await expect(state).toHaveAttribute('role', 'status');
            await expect(state).toHaveText(title);
            const message = state.getByText(title, { exact: true });
            await expect(message).toHaveCSS('font-weight', '400');
            await expect(message).toHaveCSS('font-style', 'normal');
            expect(await message.evaluate(element => Math.abs(element.getBoundingClientRect().left - element.closest('[data-folder-pane]')!.getBoundingClientRect().left))).toBeLessThanOrEqual(1);
            await expect(state.locator('button,a')).toHaveCount(0);
            if (creation) {
                const control = pane.getByRole(section === 'follow-up' ? 'link' : 'button', { name: creation, exact: true });
                await expect(control).toHaveCount(1);
                await expect(pane.locator(':scope > [data-section-header]').getByRole(section === 'follow-up' ? 'link' : 'button', { name: creation, exact: true })).toHaveCount(1);
                await expect(control).toHaveClass(/mf-button-text/u);
                await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            }
            await alignedHeader(pane);
            await expect(page.getByRole('link', { name: 'Nuova voce', exact: true })).toHaveClass(/mf-button-primary/u);
            if (section === 'diario') await expect(pane.locator(':scope > [data-section-header]').getByRole('button', { name: 'Mostra voci eliminate', exact: true })).toBeVisible();
            if (section === 'scale') await expect(pane.locator('header').filter({ has: page.getByRole('heading', { name: 'Valutazioni registrate', exact: true }) }).getByRole('button', { name: 'Mostra cestino / audit', exact: true })).toBeVisible();
            await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: section, selector: `#${section}` }]);
        }
    }
});

test('prestazione annullata: totale, stato e dettaglio nominano ciò che contano; menu Clinica coerente', async ({ page }) => {
    const id = await patient(page);
    await page.evaluate(async patientId => {
        const response = await fetch('/api/service-prescriptions', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: crypto.randomUUID(), patientId, serviceName: 'Prestazione sintetica HC6', prescribedAt: '2026-10-01T09:00:00Z', status: 'cancelled' }),
        });
        if (!response.ok) throw new Error(`Synthetic prescription: ${response.status}`);
    }, id);
    await page.goto(`/patients/${id}/modules`);
    await openPatientSection(page, 'prestazioni');
    const pane = page.locator('#prestazioni');
    await expect(pane.getByRole('heading')).toContainText('1 prestazione totale · 1 annullata');
    await expect(pane).toContainText('0 voci di dettaglio · 0 prestazioni aperte · 0 referti ricevuti');
    await expect(pane.getByRole('row').filter({ hasText: 'Prestazione sintetica HC6' })).toContainText('Annullata');
    await alignedHeader(pane);
    await page.getByRole('navigation', { name: 'Sezioni della vista', exact: true }).getByRole('button', { name: 'Altro', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Altre sezioni della cartella', exact: true });
    await expect(menu.getByRole('menuitem', { name: 'Clinica 0 diagnosi', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Prestazioni 1 prestazione totale', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Scale 0 valutazioni', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Diario 0 voci', exact: true })).toBeVisible();
});
