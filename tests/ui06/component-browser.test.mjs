/* @Codex UI06: actual React component interactions, outer boundaries explicitly doubled.
   NOT Next routing, a live Fabric generation, privacy/auth qualification, or DB integration. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './browser-harness.mjs';
let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness?.close(); });

async function pageFor(t, route, viewport = { width: 1280, height: 900 }) {
    const context = await harness.browser.newContext({ viewport });
    const errors = [];
    await context.route('**/*', async interception => {
        const request = interception.request(); const url = new URL(request.url());
        if (url.origin !== harness.origin || request.method() !== 'GET' || url.pathname.startsWith('/api/')) {
            errors.push(`Unexpected transport ${request.method()} ${url.pathname}`); await interception.abort(); return;
        }
        await interception.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
    t.after(async () => { try { assert.deepEqual(errors, [], 'No React/DOM errors or unexpected transports'); } finally { await context.close(); } });
    await page.goto(harness.origin + route);
    await harness.expect(page).toHaveTitle('MediFlow UI06 — component fixture');
    await harness.expect(page.locator('#root')).not.toBeEmpty();
    await harness.expect(page.locator('nextjs-portal')).toHaveCount(0);
    return page;
}
async function reachNumeric(page) {
    await page.getByRole('radio', { name: 'Opzione zero', exact: true }).check();
    await page.getByRole('button', { name: 'Avanti', exact: true }).click();
    await page.getByRole('radio', { name: 'No / non corretto', exact: true }).check();
    await page.getByRole('button', { name: 'Avanti', exact: true }).click();
}
async function completeDraft(page) {
    await reachNumeric(page); await page.getByRole('spinbutton').fill('0');
    await page.getByRole('button', { name: 'Avanti', exact: true }).click();
}
async function confirmSynthesis(page) {
    const action = page.getByRole('button', { name: 'Conferma e genera proposta', exact: true });
    await page.getByRole('button', { name: 'Genera proposta', exact: true }).click();
    await harness.expect(action).toBeDisabled();
    await page.getByRole('combobox').selectOption('ui06-ambulatory');
    await harness.expect(action).toBeDisabled();
    await page.getByRole('checkbox').check();
    await harness.expect(action).toBeEnabled();
    await action.click();
}
async function noHorizontalOverflow(page) {
    const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(size.scroll <= size.viewport + 1, `Horizontal overflow: ${JSON.stringify(size)}`);
}

test('native radio group: no preselection, Tab/Space/arrows select exact values', async t => {
    const page = await pageFor(t, '/scale'); const expect = harness.expect;
    await expect(page.getByRole('group', { name: 'Scelta sintetica' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Avanti', exact: true })).toBeDisabled();
    assert.equal(await page.locator('input[type=radio]:checked').count(), 0);
    await expect(page.getByRole('heading', { name: 'Scelta sintetica' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Opzione zero', exact: true })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: 'Opzione zero', exact: true })).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'Opzione uno', exact: true })).toBeChecked();
    await page.keyboard.press('ArrowUp');
    await page.getByRole('button', { name: 'Avanti', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Conferma sintetica' })).toBeFocused();
    assert.equal(await page.locator('input[type=radio]:checked').count(), 0);
    await page.getByRole('button', { name: 'Indietro', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Opzione zero', exact: true })).toBeChecked();
});

test('numeric blank/clear never turns into zero; back preserves an explicit zero', async t => {
    const page = await pageFor(t, '/scale'); const expect = harness.expect;
    await reachNumeric(page);
    await expect(page.getByRole('button', { name: 'Avanti', exact: true })).toBeDisabled();
    const input = page.getByRole('spinbutton'); await input.fill('0');
    await expect(page.getByRole('button', { name: 'Avanti', exact: true })).toBeEnabled();
    await input.fill(''); await expect(page.getByRole('button', { name: 'Avanti', exact: true })).toBeDisabled();
    await input.fill('0'); await page.getByRole('button', { name: 'Avanti', exact: true }).click();
    await page.getByRole('button', { name: 'Indietro', exact: true }).click();
    await expect(input).toHaveValue('0');
});

test('pending submission freezes answers and navigation; failed write retains a retryable draft', async t => {
    const page = await pageFor(t, '/scale?mode=deferred'); const expect = harness.expect;
    await completeDraft(page);
    // Two ordinary click events in one task exercise the synchronous write guard.
    await page.getByRole('button', { name: 'Completa', exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect(page.locator('[aria-busy=true]')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Nota sintetica facoltativa' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Indietro', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Annulla', exact: true })).toBeDisabled();
    assert.equal(await page.evaluate(() => window.ui06.scale.calls), 1);
    await page.evaluate(() => window.ui06.scale.settle(true));
    await expect(page.getByRole('alert')).toContainText('Valutazione non inviata');
    await expect(page.getByRole('button', { name: 'Completa', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Indietro', exact: true }).click();
    await expect(page.getByRole('spinbutton')).toHaveValue('0');
    await page.getByRole('button', { name: 'Avanti', exact: true }).click();
    await page.getByRole('button', { name: 'Completa', exact: true }).click();
    assert.equal(await page.evaluate(() => window.ui06.scale.calls), 2);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.evaluate(() => window.ui06.scale.settle(false));
    await expect(page.locator('[aria-busy=true]')).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.ui06.scale.results[1].answers), { choice: 0, boolean: 0, number: 0 });
});

test('cancel dialog retains draft and focus on continue/Escape; exits only after explicit confirmation', async t => {
    const page = await pageFor(t, '/scale'); const expect = harness.expect;
    await page.getByRole('radio', { name: 'Opzione zero', exact: true }).check();
    const cancel = page.getByRole('button', { name: 'Annulla', exact: true });
    await cancel.click(); await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Continua a scrivere', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Opzione zero', exact: true })).toBeChecked();
    await expect(cancel).toBeFocused();
    await cancel.click(); await page.keyboard.press('Escape'); await expect(cancel).toBeFocused();
    assert.equal(await page.evaluate(() => window.ui06.scale.cancelled), 0);
    await cancel.click(); await page.getByRole('button', { name: 'Esci senza salvare', exact: true }).click();
    await expect(page.getByText('Compilazione chiusa', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.ui06.scale.cancelled), 1);
});

test('composition changes do not remount the pending scale or clear selected answers', async t => {
    const page = await pageFor(t, '/scale'); const expect = harness.expect;
    await page.getByRole('radio', { name: 'Opzione uno', exact: true }).check();
    await expect(page.getByLabel('Bozza pendente')).toHaveText('true');
    await page.getByRole('button', { name: 'Cambia composizione fixture' }).click();
    await expect(page.getByRole('radio', { name: 'Opzione uno', exact: true })).toBeChecked();
    assert.equal(await page.evaluate(() => window.ui06.scale.calls), 0);
});

for (const width of [1280, 390, 320]) {
    test(`scale and complete counters reflow at ${width}px`, async t => {
        const page = await pageFor(t, '/scale', { width, height: 900 });
        await noHorizontalOverflow(page);
        const field = await page.getByRole('group').evaluate(element => getComputedStyle(element).borderTopWidth);
        assert.equal(field, '0px', 'no native duplicate fieldset frame');
        const choice = await page.locator('label').first().boundingBox(); assert.ok(choice && choice.height >= 44);
        await page.goto(harness.origin + '/signals'); await harness.expect(page.getByText('123456789', { exact: true })).toBeVisible();
        await harness.expect(page.getByText('0', { exact: true })).toBeVisible();
        const hint = page.getByText('Contesto completo inventato che deve restare leggibile anche nella colonna stretta senza essere troncato.', { exact: true });
        await harness.expect(hint).toBeVisible();
        assert.equal(await hint.evaluate(element => getComputedStyle(element).textOverflow), 'clip');
        assert.ok(await hint.evaluate(element => element.scrollHeight <= element.clientHeight + 1));
        await noHorizontalOverflow(page);
    });
}

test('200% CSS text size proxy retains labels, counters and full context (not browser-menu zoom)', async t => {
    const page = await pageFor(t, '/signals', { width: 640, height: 900 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await noHorizontalOverflow(page);
    await harness.expect(page.getByText('123456789', { exact: true })).toBeVisible();
    await page.goto(harness.origin + '/scale');
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await noHorizontalOverflow(page);
});

test('settings subroute has an explicit home destination and preserves child state when search opens', async t => {
    const page = await pageFor(t, '/settings/ai/fabric'); const expect = harness.expect;
    const back = page.getByRole('link', { name: 'Torna alle impostazioni', exact: true });
    await expect(back).toHaveAttribute('href', '/settings');
    await expect(page.getByRole('link', { name: 'Torna ai pazienti', exact: true })).toHaveAttribute('href', '/?area=incarico');
    await page.getByRole('textbox', { name: 'Campo locale fixture' }).fill('Bozza locale');
    await page.getByRole('button', { name: 'Ricerca impostazioni (fixture)' }).click();
    await expect(page.getByRole('textbox', { name: 'Campo locale fixture' })).toHaveValue('Bozza locale');
    await page.getByRole('button', { name: 'Chiudi ricerca' }).click();
    await back.click(); await expect(page).toHaveURL(harness.origin + '/settings');
    await expect(page.getByRole('link', { name: 'Torna alle impostazioni', exact: true })).toHaveCount(0);
});

for (const [domain, present, absent] of [
    ['anagrafica', 'NomeSintetico CognomeSintetico', ['Diagnosi inventata UI06', 'Esenzione inventata UI06']],
    ['clinica', 'Diagnosi inventata UI06', ['NomeSintetico CognomeSintetico', 'Esenzione inventata UI06']],
    ['amministrazione', 'Esenzione inventata UI06', ['NomeSintetico CognomeSintetico', 'Diagnosi inventata UI06']],
]) {
    test(`identity reader domain ${domain} stays separate`, async t => {
        const page = await pageFor(t, `/identity?domain=${domain}`);
        await harness.expect(page.getByText(present, { exact: true })).toBeVisible();
        for (const text of absent) await harness.expect(page.getByText(text, { exact: true })).toHaveCount(0);
    });
}

test('disabled synthesis is truthful and does not read context or execute', async t => {
    const page = await pageFor(t, '/synthesis?disabled');
    await harness.expect(page.getByRole('button', { name: 'Genera proposta', exact: true })).toBeDisabled();
    await harness.expect(page.getByRole('status')).toHaveText('La funzione di sintesi è disabilitata localmente.');
    assert.deepEqual(await page.evaluate(() => [window.ui06.document.reads, window.ui06.document.runs]), [0, 0]);
});

test('synthesis requires explicit context, leaves summary readable and disclosures keyboard-accessible', async t => {
    const page = await pageFor(t, '/synthesis'); const expect = harness.expect;
    await confirmSynthesis(page);
    await expect(page.getByTestId('document-synthesis-fabric-result')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => [window.ui06.document.runs, window.ui06.document.runConfirmed, window.ui06.document.selectedAmbulatory]), [1, true, 'ui06-ambulatory']);
    await expect(page.getByText('Riepilogo interamente inventato UI06.', { exact: true })).toBeVisible();
    const citations = page.locator('summary').filter({ hasText: 'Citazioni dal documento' });
    const source = page.getByText('Passaggio interamente inventato UI06.', { exact: true });
    await expect(source).toBeHidden(); await citations.focus(); await page.keyboard.press('Enter'); await expect(source).toBeVisible();
    const verification = page.locator('summary').filter({ hasText: 'Dettagli di verifica' });
    await expect(page.getByText('0 scritture · applicazione non consentita', { exact: true })).toBeHidden();
    await verification.focus(); await page.keyboard.press('Space');
    await expect(page.getByText('0 scritture · applicazione non consentita', { exact: true })).toBeVisible();
    await expect(page.getByText('not_established', { exact: true })).toBeVisible();
});

test('unavailable context exposes a readable status and retains the full technical outcome in disclosure', async t => {
    const page = await pageFor(t, '/synthesis?mode=unavailable');
    await page.getByRole('button', { name: 'Genera proposta', exact: true }).click();
    await harness.expect(page.getByRole('status')).toHaveText('Sintesi non disponibile. La cartella rimane invariata.');
    const technical = page.getByText('unavailable · context_unavailable — la proposta non è utilizzabile.', { exact: true });
    await harness.expect(technical).toBeHidden();
    await page.locator('summary').filter({ hasText: 'Dettagli dell’esito' }).click();
    await harness.expect(technical).toBeVisible();
    assert.equal(await page.evaluate(() => window.ui06.document.runs), 0);
});

test('unsupported extraction keeps manual review visible, not hidden with diagnostic detail', async t => {
    const page = await pageFor(t, '/synthesis?mode=unsupported');
    await confirmSynthesis(page);
    await harness.expect(page.getByRole('status')).toHaveText('Testo locale non disponibile. È necessaria la revisione manuale del documento.');
    await harness.expect(page.getByTestId('document-synthesis-fabric-result')).toHaveCount(0);
});

test('closing a running synthesis discards its later presentation result', async t => {
    const page = await pageFor(t, '/synthesis?mode=deferred');
    await confirmSynthesis(page);
    await harness.expect.poll(() => page.evaluate(() => window.ui06.document.runs)).toBe(1);
    await page.getByRole('button', { name: 'Annulla', exact: true }).click();
    await page.evaluate(() => window.ui06.document.publish());
    await harness.expect(page.getByRole('button', { name: 'Genera proposta', exact: true })).toBeVisible();
    await harness.expect(page.getByTestId('document-synthesis-fabric-result')).toHaveCount(0);
});

test('security lock unmounts the presentation and does not resurrect a late preview after unlock', async t => {
    const page = await pageFor(t, '/synthesis?mode=deferred');
    await confirmSynthesis(page);
    await harness.expect.poll(() => page.evaluate(() => window.ui06.document.runs)).toBe(1);
    await page.evaluate(() => window.ui06.document.lock(true));
    await harness.expect(page.getByTestId('document-synthesis-fabric-review-ui06-attachment')).toHaveCount(0);
    await page.evaluate(() => { window.ui06.document.publish(); window.ui06.document.lock(false); });
    await harness.expect(page.getByRole('button', { name: 'Genera proposta', exact: true })).toBeVisible();
    await harness.expect(page.getByTestId('document-synthesis-fabric-result')).toHaveCount(0);
});
