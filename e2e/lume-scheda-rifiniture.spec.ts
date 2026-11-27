import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openSyntheticPatient, unlockSyntheticSheet } from './fixtures/synthetic-sheet';
import { openPatientSection } from './utils';

test.describe.configure({ retries: 0 });

const shots = process.env.MEDIFLOW_SHEET_FINISH_SCREENSHOTS;
const documentText = 'Vive con il coniuge, autonomo nelle attività di base. Riferimento familiare disponibile.';
const soapText = 'S: riferisce dispnea da sforzo.\nO: PA 135/80, FC 72 ritmica.\nA: scompenso compensato.\nP: controllo tra 30 giorni.';
const views = [
    { width: 1280, height: 800, label: '1280' },
    { width: 390, height: 844, label: '390' },
    { width: 640, height: 400, label: 'zoom200' },
] as const;

type Sheet = { lastName: string; name: string; id: string };

async function seedSheets(page: Page, baseURL: string | undefined): Promise<Sheet[]> {
    const { post, seal } = await unlockSyntheticSheet(page, baseURL);
    const sheets: Sheet[] = [];
    for (const firstName of ['Ada', 'Bruno', 'Carla']) {
        const lastName = `Sintetico ${randomUUID().slice(0, 6)}`;
        const id = await post('patients', { firstName, lastName, identifierType: 'none', taxCode: '',
            birthDatePrecision: 'estimated', birthYear: 1950 });
        sheets.push({ lastName, name: `${lastName} ${firstName}`, id });
    }
    const target = sheets[2];
    const visit = new Date();
    visit.setDate(visit.getDate() - 2);
    visit.setHours(10, 30, 0, 0);
    await post('entries', { patientId: target.id, type: 'visit', date: visit, title: await seal('Visita ambulatoriale'), content: await seal(soapText) });
    const documentDay = new Date();
    documentDay.setDate(documentDay.getDate() - 9);
    const civilDay = documentDay.toISOString().slice(0, 10);
    await post('entries', { patientId: target.id, type: 'note', date: `${civilDay}T00:00:00.000Z`,
        title: await seal('Contesto assistenziale da documento'), content: await seal(documentText),
        metadata: await seal({ dossier: { factRef: `sintetico:${randomUUID()}`, kind: 'care_context' } }) });
    for (const sheet of sheets) await openSyntheticPatient(page, sheet.lastName, sheet.name, sheet.id);
    return sheets;
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
    await page.evaluate(value => {
        document.documentElement.classList.toggle('light', value === 'light');
        document.documentElement.classList.toggle('dark', value === 'dark');
    }, theme);
}

async function shot(page: Page, name: string) {
    if (!shots) return;
    mkdirSync(shots, { recursive: true });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.screenshot({ path: `${shots}/${name}.png`, animations: 'disabled' });
}

async function toTop(page: Page) {
    await page.evaluate(() => { for (const node of [document.scrollingElement, ...document.querySelectorAll('main, [class*="page"]')]) node?.scrollTo(0, 0); });
}

async function openAssistantAccess(page: Page) {
    const header = page.getByTestId('lume-scheda-header');
    await header.getByRole('button', { name: 'Azioni', exact: true }).click();
    await page.getByRole('menu', { name: 'Azioni scheda', exact: true }).getByRole('menuitem', { name: 'Accesso assistente', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Accesso assistente', exact: true });
    await expect(panel).toBeVisible();
    return panel;
}

async function capture(page: Page, label: string) {
    for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await toTop(page);
        await shot(page, `${label}-schede-${theme}`);
        await openPatientSection(page, 'diario');
        await shot(page, `${label}-diario-${theme}`);
        await openPatientSection(page, 'terapie');
        await shot(page, `${label}-terapie-${theme}`);
        await toTop(page);
        const panel = await openAssistantAccess(page);
        await panel.evaluate(node => node.scrollIntoView({ block: 'nearest' }));
        await shot(page, `${label}-accesso-${theme}`);
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
    }
    await setTheme(page, 'light');
}

async function uncovered(locator: Locator) {
    return locator.evaluate(node => {
        const box = node.getBoundingClientRect();
        const points = [[box.left + 2, box.top + box.height / 2], [box.left + box.width / 2, box.top + 2], [box.right - 2, box.top + box.height / 2]];
        return points.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return Boolean(hit && (node === hit || node.contains(hit))); });
    });
}

const serif = /newsreader|georgia|serif/iu;
const isSerif = (family: string) => serif.test(family.replace(/sans-serif/giu, ''));

test('scheda paziente: schede aperte, testata, diario e sezioni restano nel sistema', async ({ page, baseURL }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const sheets = await seedSheets(page, baseURL);
    for (const view of views) {
        await page.setViewportSize({ width: view.width, height: view.height });
        await capture(page, view.label);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await toTop(page);

    const openRecords = page.getByRole('navigation', { name: 'Cartelle aperte', exact: true });
    const tabs = openRecords.locator(':scope > [data-active]');
    await expect(tabs).toHaveCount(3);
    const geometry = await tabs.evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return { radius: parseFloat(style.borderTopLeftRadius), border: style.borderTopWidth, left: box.left, right: box.right,
            background: style.backgroundColor, active: node.getAttribute('data-active') === 'true' };
    }));
    for (const tab of geometry) {
        expect(tab.radius, 'ogni scheda aperta ha gli angoli arrotondati').toBeGreaterThanOrEqual(6);
        expect(tab.border, 'ogni scheda aperta ha un bordo').not.toBe('0px');
    }
    for (let index = 1; index < geometry.length; index += 1) {
        expect(geometry[index].left - geometry[index - 1].right, 'le schede sono separate').toBeGreaterThanOrEqual(4);
    }
    expect(geometry.filter(tab => tab.active)).toHaveLength(1);
    expect(new Set(geometry.map(tab => tab.background)).size, 'la scheda attiva ha un fondo suo').toBe(2);
    await expect(tabs.last().getByRole('link', { name: new RegExp(sheets[2].name, 'u') })).toBeVisible();

    await openPatientSection(page, 'diario');
    const diary = page.locator('#diario');
    const feed = diary.getByRole('feed');
    await expect(feed.locator(':scope > article').filter({ hasText: 'Contesto assistenziale da documento' })).toBeVisible();
    await expect(feed.locator(':scope > article').filter({ hasText: 'Visita ambulatoriale' }).locator('time')).toContainText('10:30');
    const fonts = await diary.locator('.prose, .clinical-rich-text').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontFamily));
    expect(fonts.length).toBeGreaterThanOrEqual(2);
    for (const family of fonts) expect(isSerif(family), `testo clinico senza grazie: ${family}`).toBe(false);
    const frame = await diary.evaluate(node => {
        const style = getComputedStyle(node);
        const title = node.querySelector('h2, h3');
        const box = node.getBoundingClientRect();
        const titleBox = title?.getBoundingClientRect();
        return { radius: parseFloat(style.borderTopLeftRadius), inset: titleBox ? titleBox.left - box.left : 0 };
    });
    expect(frame.radius, 'il riquadro del diario ha angoli arrotondati').toBeGreaterThanOrEqual(8);
    expect(frame.inset, 'il titolo del diario non tocca il bordo').toBeGreaterThanOrEqual(16);

    await openPatientSection(page, 'terapie');
    const glyph = await page.locator('#terapie').evaluate(node => {
        const icon = node.querySelector('h3 svg, h2 svg');
        if (!icon) return null;
        const frameBox = node.getBoundingClientRect();
        const box = icon.getBoundingClientRect();
        return { left: box.left - frameBox.left, top: box.top - frameBox.top };
    });
    expect(glyph, 'la sezione mostra il suo glifo').not.toBeNull();
    expect(glyph!.left, 'il glifo non tocca il bordo sinistro').toBeGreaterThanOrEqual(16);
    expect(glyph!.top, 'il glifo non tocca il bordo superiore').toBeGreaterThanOrEqual(12);

    for (const view of views) {
        await page.setViewportSize({ width: view.width, height: view.height });
        await toTop(page);
        const header = page.getByTestId('lume-scheda-header');
        const commands = header.locator(':is(a, button):visible').filter({ hasText: /Prescrivi|Registra la visita|Nuova voce/u }).or(header.getByRole('button', { name: 'Azioni', exact: true }));
        await expect(commands).toHaveCount(4);
        const toolbar = await header.getByRole('toolbar', { name: 'Comandi della scheda', exact: true }).evaluate(node => node.getBoundingClientRect().toJSON());
        const boxes = await commands.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
        const rows = [...new Set(boxes.map(box => Math.round(box.top)))].map(top => boxes.filter(box => Math.round(box.top) === top));
        if (view.width > 750) expect(rows, `${view.label}: i quattro comandi stanno su una riga`).toHaveLength(1);
        else for (const row of rows) {
            expect(Math.abs(row[0].left - toolbar.left), `${view.label}: ogni riga di comandi parte dal bordo`).toBeLessThanOrEqual(1);
            expect(Math.abs(row.at(-1)!.right - toolbar.right), `${view.label}: ogni riga di comandi arriva al bordo`).toBeLessThanOrEqual(1);
        }
        for (const command of await commands.all()) expect(await uncovered(command), `${view.label}: comando scoperto`).toBe(true);
        const panel = await openAssistantAccess(page);
        const title = panel.getByRole('heading', { name: 'Accesso assistente', exact: true });
        await title.scrollIntoViewIfNeeded();
        expect(await uncovered(title), `${view.label}: titolo del pannello scoperto`).toBe(true);
        await page.keyboard.press('Escape');
    }
});
