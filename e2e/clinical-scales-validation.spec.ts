import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

async function openSyntheticChart(page: Page, baseURL: string | undefined, suffixPrefix: string) {
    test.skip(process.env.E2E_SCALES_SYNTHETIC_ONLY !== '1', 'Requires an isolated synthetic database and explicit opt-in');
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL || 'http://127.0.0.1:3000').hostname);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await page.evaluate(async prefix => {
        const suffix = String(Date.now()).slice(-3);
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Synthetic', lastName: `ScaleTest${suffix}`,
                taxCode: `${prefix}80A01H${suffix}X`, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }),
        });
        if (!response.ok) throw new Error(`Synthetic patient setup failed: ${response.status}`);
        return (await response.json() as { id: string }).id;
    }, suffixPrefix);
    let writes = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/entries') writes++;
    });

    return { patientId, writes: () => writes };
}

async function tabTo(page: Page, target: Locator) {
    await expect(target).toBeVisible();
    for (let attempt = 0; attempt < 24; attempt++) {
        if (await target.evaluate(node => node === document.activeElement)) return;
        await page.keyboard.press('Tab');
    }
    await expect(target).toBeFocused();
}

async function capture(testInfo: ReturnType<typeof test.info>, target: Locator, name: string) {
    const path = testInfo.outputPath(`${name}.png`);
    await target.screenshot({ path });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('Untouched/partial scales do not write; explicit zero and complete POMA-28 do', async ({ page, baseURL }, testInfo) => {
    const { patientId, writes } = await openSyntheticChart(page, baseURL, 'SCLTST');
    await page.goto(`/patients/${patientId}/scales/adl`);
    const form = page.locator('#scala');
    await expect(form.getByRole('button', { name: 'Avanti', exact: true })).toBeDisabled();
    expect(writes()).toBe(0);
    const firstAnswer = form.getByRole('radio', { name: /^0\./ });
    await firstAnswer.focus();
    await page.keyboard.press('Space');
    await expect(firstAnswer).toBeFocused();
    await form.getByLabel('Contesto').selectOption('home');
    await form.getByRole('button', { name: 'Annulla', exact: true }).click();
    const leaveDialog = page.getByRole('dialog', { name: 'Lasciare la compilazione?', exact: true });
    await expect(leaveDialog).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await leaveDialog.getByRole('button', { name: 'Continua la compilazione', exact: true }).click();
    await expect(firstAnswer).toBeChecked();
    await expect(form.getByLabel('Contesto')).toHaveValue('home');
    expect(writes()).toBe(0);
    await form.getByRole('button', { name: 'Annulla', exact: true }).click();
    await leaveDialog.getByRole('button', { name: 'Esci senza salvare', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/scales$`));
    expect(writes()).toBe(0);
    await page.goto(`/patients/${patientId}/scales/adl`);
    for (let index = 0; index < 6; index++) {
        await expect(form.getByText(`Domanda ${index + 1} di 6`, { exact: true })).toBeVisible();
        const next = form.getByRole('button', { name: index === 5 ? 'Completa' : 'Avanti', exact: true });
        await expect(next).toBeDisabled();
        expect(writes()).toBe(0);
        if (index === 0) await tabTo(page, form.getByRole('radio', { name: /^0\./ }));
        await page.keyboard.press('0');
        if (index === 5) {
            await expect(form.getByRole('radio', { name: /^0\./ })).toBeChecked();
            await tabTo(page, next);
            await page.keyboard.press('Space');
        }
    }
    await expect.poll(writes).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules#scale$`));
    const history = page.getByRole('feed', { name: 'Storico delle scale del paziente', exact: true });
    await expect(history.getByRole('article')).toHaveCount(1);
    await expect(history.getByRole('article').first()).toContainText('ADL (Indice di Katz)');
    await expect(history.getByRole('article').first()).toContainText('Punteggio: 0');

    await page.goto(`/patients/${patientId}/scales/tinetti`);
    await expect(page.getByText(/Versione Tinetti precedente ritirata/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Completa', exact: true })).toHaveCount(0);
    expect(writes()).toBe(1);

    await page.goto(`/patients/${patientId}/scales/tinetti-poma28-v1`);
    const maxima = [1, 2, 2, 2, 2, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1];
    for (let index = 0; index < maxima.length; index++) {
        await expect(form.getByText(`Domanda ${index + 1} di 20`, { exact: true })).toBeVisible();
        const next = form.getByRole('button', { name: index === 19 ? 'Completa' : 'Avanti', exact: true });
        await expect(next).toBeDisabled();
        expect(writes()).toBe(1);
        await form.getByRole('radio', { name: new RegExp(`^${maxima[index]}\\.`) }).click();
        await next.click();
    }
    await expect.poll(writes).toBe(2);
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules#scale$`));
    await page.reload();
    const records = history.getByRole('article');
    await expect(records).toHaveCount(2);
    const poma = records.filter({ has: page.getByRole('heading', { name: 'Tinetti POMA-28', exact: true }) });
    const adl = records.filter({ hasText: 'ADL (Indice di Katz)' });
    await expect(poma).toHaveCount(1);
    await expect(poma.getByText('Punteggio 28/28', { exact: true })).toBeVisible();
    await capture(testInfo, poma, 'tinetti-history-28');
    await poma.getByRole('button', { name: 'Dettagli della valutazione' }).click();
    await expect(poma.getByTestId('scale-provenance-notice')).toBeVisible();
    await expect(poma.getByTestId('scale-provenance-notice')).toContainText('NHS FPS 006 V1 (2012)');
    await expect(adl).toHaveCount(1);
    await expect(adl).toContainText('Punteggio: 0');
    expect(writes()).toBe(2);
});

for (const theme of ['light', 'dark']) test(`Tinetti POMA-28: all 20 questions and corrections by keyboard, then explicit registration (${theme})`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 1180, height: 780 });
    await page.addInitScript(value => localStorage.setItem('mediflow-theme', value), theme);
    const { patientId, writes } = await openSyntheticChart(page, baseURL, 'SCLKBD');
    await page.goto(`/patients/${patientId}/scales`);
    const link = page.getByRole('link', { name: /^Tinetti POMA-28 / });
    await tabTo(page, link);
    await page.keyboard.press('Enter');

    const form = page.locator('#scala');
    await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^| )${theme}(?: |$)`));
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    const question = form.getByRole('heading', { level: 3 }).first();
    const zero = form.getByRole('radio', { name: /^0\./ });
    const one = form.getByRole('radio', { name: /^1\./ });
    const advance = form.getByRole('button', { name: 'Avanti', exact: true });
    const back = form.getByRole('button', { name: 'Indietro', exact: true });
    const complete = form.getByRole('button', { name: 'Completa', exact: true });
    const atQuestion = async (step: number) => {
        await expect(form.getByText(`Domanda ${step} di 20`, { exact: true })).toBeVisible();
        await expect(question).toBeFocused();
        expect(writes()).toBe(0);
    };
    await atQuestion(1);
    await expect(question).toHaveCSS('outline-style', 'solid');
    await expect(zero).toHaveAttribute('aria-keyshortcuts', '0');
    await expect(advance).toBeDisabled();
    for (const key of ['2', '9', 'Shift+0', 'Alt+0', 'Control+0', 'Meta+0', 'Enter']) await page.keyboard.press(key);
    await expect(advance).toBeDisabled();
    await expect(form.locator('input[type=radio]:checked')).toHaveCount(0);

    await page.keyboard.press('Tab');
    await expect(zero).toBeFocused();
    await expect(zero).toHaveJSProperty('checked', false);
    await page.keyboard.press('Space');
    await expect(zero).toBeChecked();
    await expect(advance).toBeEnabled();
    await page.keyboard.press('ArrowRight');
    await expect(one).toBeFocused();
    await expect(one).toBeChecked();
    const selected = one.locator('..');
    const unselected = zero.locator('..');
    await expect(selected).toHaveAttribute('data-selected', 'true');
    await expect(unselected).toHaveAttribute('data-selected', 'false');
    await expect(selected).toHaveCSS('outline-style', 'solid');
    await capture(testInfo, form, `tinetti-${theme}-keyboard-focus`);
    const shape = await selected.evaluate(label => {
        const style = getComputedStyle(label);
        const selectedColor = document.createElement('span');
        selectedColor.style.backgroundColor = 'var(--lume-surface-selected)';
        label.append(selectedColor);
        const selection = getComputedStyle(selectedColor).backgroundColor;
        selectedColor.remove();
        return {
            radius: style.borderTopLeftRadius,
            height: label.getBoundingClientRect().height,
            inset: label.querySelector('input')!.getBoundingClientRect().left - label.getBoundingClientRect().left,
            gap: label.getBoundingClientRect().top - label.previousElementSibling!.getBoundingClientRect().bottom,
            fillsSelection: style.backgroundColor === selection,
            outline: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset),
        };
    });
    await testInfo.attach(`risposta-tinetti-${theme}`, { body: JSON.stringify(shape), contentType: 'application/json' });
    expect(shape).toMatchObject({ radius: '10px', gap: 4, inset: 12, fillsSelection: true, outline: 0 });
    expect(shape.height).toBeGreaterThanOrEqual(44);
    await expect(unselected).toHaveCSS('border-top-left-radius', '10px');
    await page.keyboard.press('Enter');
    await atQuestion(2);

    await page.keyboard.down('2');
    await page.keyboard.down('2');
    await page.keyboard.up('2');
    await atQuestion(3);
    await expect(advance).toBeDisabled();
    await tabTo(page, back);
    await page.keyboard.press('Space');
    await atQuestion(2);
    await expect(form.getByRole('radio', { name: /^2\./ })).toBeChecked();
    await tabTo(page, back);
    await page.keyboard.press('Enter');
    await atQuestion(1);
    await expect(one).toBeChecked();

    for (let step = 1; step <= 20; step++) {
        await atQuestion(step);
        if (step > 2) await expect(form.locator('input[type=radio]:checked')).toHaveCount(0);
        if (step === 20) await expect(complete).toBeDisabled();
        await page.keyboard.press('0');
    }

    await expect(form.getByText('Domanda 20 di 20', { exact: true })).toBeVisible();
    await expect(zero).toBeFocused();
    await expect(zero).toBeChecked();
    await expect(complete).toBeEnabled();
    await expect(form.getByRole('complementary', { name: 'Risultato in bozza' }).getByText('0/28', { exact: true })).toBeVisible();
    for (const key of ['0', 'Space', 'Enter']) await page.keyboard.press(key);
    await expect(zero).toBeFocused();
    expect(writes()).toBe(0);

    await tabTo(page, complete);
    await page.keyboard.press('Space');
    await expect.poll(writes).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules#scale$`));

    const history = page.getByRole('feed', { name: 'Storico delle scale del paziente', exact: true });
    const result = history.getByRole('article');
    await expect(result).toHaveCount(1);
    for (const reopen of [false, true]) {
        if (reopen) await page.reload();
        await expect(result.getByRole('heading', { name: 'Tinetti POMA-28', exact: true })).toBeVisible();
        await expect(result.getByText('Punteggio 0/28', { exact: true })).toBeVisible();
        await expect(result.getByText('Il rischio di caduta richiede una valutazione clinica.', { exact: true })).toBeVisible();
        await expect(result.getByText('Resa italiana locale non validata.', { exact: true })).toBeVisible();
        expect(await result.innerText()).not.toMatch(/\(v1\)|mediflow\.poma28|Valutazione Tinetti|Versione interpretazione|Punteggio: 0/i);
    }
    await expect(page.locator('#timeline').getByText(/Tinetti POMA-28|mediflow\.poma28/)).toHaveCount(0);
    await capture(testInfo, result, 'tinetti-history-zero');
    const details = result.getByRole('button', { name: 'Dettagli della valutazione' });
    await tabTo(page, details);
    await page.keyboard.press('Enter');
    await expect(result.getByTestId('scale-provenance-notice')).toBeVisible();
    await expect(result.getByText(/mediflow\.poma28\.nonclassification\.v1/)).toBeVisible();
    expect(writes()).toBe(1);
});
