import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { openUnlockedDocument, assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';

const cases = [
    { key: 'affollato', drug: 'Bisoprololo', admitted: '2,5 mg', discharged: '1,25 mg', textSize: 10,
        rows: [{ x1: 56, x2: 449, y1: 90, y2: 116 }, { x1: 56, x2: 455, y1: 254, y2: 280 }] },
    { key: 'gemello', drug: 'Losartan', admitted: '1 cp la sera', discharged: '½ cp la sera', textSize: 8.5,
        rows: [{ x1: 56, x2: 490, y1: 322, y2: 396 }] },
] as const;

type Fixture = (typeof cases)[number];

async function syntheticPdf(fixture: Fixture, name: string): Promise<Buffer> {
    const originals = process.env.FONTE_PDF;
    if (originals) return readFile(join(originals, name));

    const file = await PDFDocument.create();
    const font = await file.embedFont(StandardFonts.Helvetica);
    for (const number of [1, 2]) {
        const page = file.addPage([595, 842]);
        const line = (text: string, x: number, top: number, size = fixture.textSize) =>
            page.drawText(text, { x, y: 842 - top - size, size, font });
        line(`Documento sintetico di prova — Pagina ${number} di 2`, 56, 65, 10);
        if (number === 2 && fixture.key === 'gemello') {
            ['Farmaco', 'All’ingresso', 'Alla dimissione'].forEach((text, index) => line(text, 56 + 161 * index, 322));
            [fixture.drug, fixture.admitted, fixture.discharged].forEach((text, index) => line(text, 56 + 161 * index, 387));
        }
        if (number === 2 && fixture.key === 'affollato') {
            line('Terapia all’ingresso', 56, 90);
            line(`${fixture.drug} ${fixture.admitted}: 1 compressa al mattino.`, 56, 105);
            line('Terapia alla dimissione', 56, 254);
            line(`${fixture.drug} ${fixture.discharged}: 1 compressa al mattino.`, 56, 269);
        }
    }
    return Buffer.from(await file.save({ useObjectStreams: false }));
}

async function selection(editor: Locator) {
    return editor.evaluate(element => {
        const selected = getSelection();
        return {
            anchor: selected?.anchorOffset, focus: selected?.focusOffset, text: selected?.toString(),
            inside: element.contains(selected?.anchorNode ?? null) && element.contains(selected?.focusNode ?? null),
        };
    });
}

for (const [fixture, width, height] of [
    [cases[0], 1180, 660], [cases[1], 1180, 660], [cases[1], 1024, 640], [cases[1], 390, 640],
] as const) {
    test(`riprende la bozza dal PDF ${fixture.key} a ${width}×${height}`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height });
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        const pdfName = `lettera-dimissione-sintetica-${fixture.key}.pdf`;
        const bytes = await syntheticPdf(fixture, pdfName);
        const { patientId, attachmentId, name } = await page.evaluate(async input => {
            const post = async (collection: string, fields: unknown) => {
                const response = await fetch(`/api/${collection}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
                });
                if (!response.ok) throw Error(`Fixture ${collection}: HTTP ${response.status}`);
                return response.json() as Promise<{ id: string }>;
            };
            const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 11);
            const name = `Fonte${suffix} Sintetica`;
            const { id: patientId } = await post('patients', {
                firstName: 'Sintetica', lastName: `Fonte${suffix}`, taxCode: `PDF${suffix}00`, birthDate: '1980-01-01', diagnoses: [],
            });
            const { id: attachmentId } = await post('attachments', { id: crypto.randomUUID(), patientId, name: input.pdfName,
                type: 'application/pdf', size: input.size, path: `uploads/${input.pdfName}`, data: `data:application/pdf;base64,${input.data}` });
            await post('therapies', { patientId, drugName: input.drug, dosage: 'Posologia sintetica in cartella',
                status: 'active', startDate: '2026-11-12', endDate: null });
            return { patientId, attachmentId, name };
        }, { pdfName, size: bytes.length, data: bytes.toString('base64'), drug: fixture.drug });
        const directory = process.env.FONTE_EVIDENCE;
        if (directory) await mkdir(directory, { recursive: true });
        const capture = async (state: string) => {
            if (directory) await page.screenshot({ path: join(directory, `dopo-${fixture.key}-${width}-${state}.png`), animations: 'disabled' });
        };
        const pendingWrites: string[] = [];
        page.on('request', request => {
            const pathname = new URL(request.url()).pathname;
            if (request.method() === 'POST' && (pathname === '/api/entries' || pathname === '/api/attachments')) pendingWrites.push(pathname);
        });

        await openUnlockedDocument(page, `/?area=incarico&paziente=${patientId}`);
        const person = page.getByRole('option').filter({ hasText: name });
        await expect(person).toBeVisible();
        await person.press('Enter');
        const header = page.getByTestId('lume-scheda-header');
        await expect(header.getByRole('heading', { level: 1 })).toHaveText(name);

        const activeTherapy = page.getByRole('table', { name: 'Terapie attive', exact: true }).getByRole('row')
            .filter({ has: page.getByRole('cell', { name: fixture.drug, exact: true }) });
        await expect(activeTherapy.getByRole('cell', { name: 'Posologia sintetica in cartella', exact: true })).toBeVisible();
        await activeTherapy.scrollIntoViewIfNeeded();
        await capture('terapia');

        await header.getByRole('link', { name: 'Nuova voce', exact: true }).press('Enter');
        const workflow = page.getByTestId('lume-editor-workflow');
        const editor = workflow.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
        const before = `Nel referto, ${fixture.drug} alla dimissione: `;
        const placeholder = fixture.key === 'gemello' ? '___' : '';
        const after = ', come riportato nella lettera.';
        await editor.focus();
        await page.keyboard.insertText(before + placeholder + after);
        for (const _ of after) await page.keyboard.press('ArrowLeft');
        for (const _ of placeholder) await page.keyboard.press('Shift+ArrowLeft');
        const saved = await selection(editor);
        const savedText = await editor.textContent();
        expect(saved).toEqual({ anchor: before.length + placeholder.length, focus: before.length, text: placeholder, inside: true });

        const start = performance.now();
        const readOriginal = page.waitForResponse(response => {
            const request = response.request();
            return request.method() === 'GET' && new URL(response.url()).pathname === `/api/attachments/${attachmentId}`;
        });
        await workflow.getByRole('button', { name: `Apri originale: ${pdfName}`, exact: true }).press('Enter');
        const viewer = page.getByRole('dialog', { name: pdfName, exact: true });
        const close = viewer.getByRole('button', { name: 'Chiudi', exact: true });
        await expect(close).toBeFocused();
        expect((await readOriginal).ok()).toBe(true);
        const pdf = viewer.getByTestId('document-preview-pdf');
        await expect(pdf).toHaveAttribute('data-state', 'ready');
        const firstPageMs = Math.round(performance.now() - start);
        const next = pdf.getByRole('button', { name: 'Pagina successiva', exact: true });
        await page.keyboard.press('Tab');
        await expect(next).toBeFocused();
        const changePage = performance.now();
        await page.keyboard.press('Enter');
        await expect(pdf.getByTestId('document-preview-page-number')).toHaveText('Pagina 2 di 2');
        await expect(pdf).toHaveAttribute('data-state', 'ready');
        const secondPageMs = Math.round(performance.now() - changePage);

        const strip = viewer.getByRole('contentinfo', { name: 'Bozza', exact: true });
        await expect(strip).toContainText('Bozza non registrata');
        await expect(strip).toContainText(before.trim());
        await expect(strip).toContainText(after.trim());
        if (placeholder) await expect(strip.locator('mark')).toHaveText(placeholder);
        const resume = strip.getByRole('button', { name: 'Riprendi la bozza', exact: true });
        await expect(resume).toHaveCSS('border-top-left-radius', '10px');

        const image = pdf.getByTestId('document-preview-pdf-page');
        const scrollport = pdf.getByLabel('Pagina PDF', { exact: true });
        await expect(scrollport).toBeFocused();
        const canvas = (await image.boundingBox())!;
        const port = (await scrollport.boundingBox())!;
        const bar = (await strip.boundingBox())!;
        expect(canvas.width).toBeGreaterThan(width * 0.88);
        expect(port.y + port.height).toBeLessThanOrEqual(bar.y);
        expect(bar.y + bar.height).toBeLessThanOrEqual(height);
        const fitTextPx = canvas.width * fixture.textSize / 595;
        if (width >= 1024) expect(fitTextPx).toBeGreaterThan(12);

        const zoom = pdf.getByRole('combobox', { name: 'Zoom PDF', exact: true });
        if (width <= 1024) {
            const magnification = width === 390 ? '200' : '125';
            await zoom.selectOption(magnification);
            await expect(zoom).toHaveValue(magnification);
            await assertNoHorizontalOverflow(page, [{ label: 'finestra con referto ingrandito', selector: 'document' }]);
        }
        const resolution = await image.evaluate((element: HTMLCanvasElement) => ({
            rasterWidth: element.width, displayWidth: element.getBoundingClientRect().width,
        }));
        expect(resolution.rasterWidth).toBeGreaterThanOrEqual(Math.floor(resolution.displayWidth));
        if (width === 390) {
            await scrollport.focus();
            await page.keyboard.press('ArrowRight');
            await expect.poll(() => scrollport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
            await capture('zoom');
        } else {
            for (const [index, row] of fixture.rows.entries()) {
                const pageBox = (await image.boundingBox())!;
                const scale = pageBox.width / 595;
                const visible = (await scrollport.boundingBox())!;
                const down = Math.max(0, Math.ceil(pageBox.y + row.y1 * scale - visible.y - 12));
                const right = Math.max(0, Math.ceil(pageBox.x + row.x2 * scale - visible.x - visible.width + 12));
                if (down || right) {
                    await scrollport.hover();
                    await page.mouse.wheel(right, down);
                }
                await expect.poll(async () => {
                    const current = (await image.boundingBox())!;
                    return current.y + row.y1 * scale >= visible.y
                        && current.y + row.y2 * scale <= visible.y + visible.height
                        && current.x + row.x1 * scale >= visible.x
                        && current.x + row.x2 * scale <= visible.x + visible.width;
                }).toBe(true);
                await capture(`pagina-2-riga-${index + 1}`);
            }
        }

        await expect(viewer).toBeVisible();
        expect(pendingWrites).toEqual([]);
        const returning = performance.now();
        if (fixture.key === 'affollato') await close.click();
        else if (width === 390) await resume.press('Enter');
        else {
            await scrollport.focus();
            await page.keyboard.press('Escape');
        }
        await expect(viewer).toHaveCount(0);
        await expect(editor).toBeFocused();
        expect(await selection(editor)).toEqual(saved);
        expect(await editor.textContent()).toBe(savedText);
        const resumeMs = Math.round(performance.now() - returning);
        await activeTherapy.scrollIntoViewIfNeeded();
        await expect(activeTherapy.getByRole('cell', { name: 'Posologia sintetica in cartella', exact: true })).toBeInViewport();
        await editor.scrollIntoViewIfNeeded();
        await expect(editor).toBeFocused();
        expect(await selection(editor)).toEqual(saved);
        await page.keyboard.insertText(fixture.discharged);
        const note = before + fixture.discharged + after;
        await expect(editor).toHaveText(note);
        await capture('ripresa');

        await workflow.getByRole('button', { name: 'Rivedi', exact: true }).press('Enter');
        const review = workflow.getByRole('region', { name: 'Riepilogo della voce', exact: true });
        await expect(review).toContainText(name);
        await expect(review).toContainText(note);
        if (width === 1024) {
            await workflow.getByRole('button', { name: `Apri originale: ${pdfName}`, exact: true }).press('Enter');
            await expect(close).toBeFocused();
            await page.keyboard.press('Escape');
            await expect(review.getByRole('heading', { name: 'Che cosa verrà registrato', exact: true })).toBeFocused();
            await expect(review).toContainText(note);
        }
        expect(pendingWrites).toEqual([]);
        await capture('revisione');
        await workflow.getByRole('button', { name: 'Conferma e registra', exact: true }).press('Enter');
        const receipt = page.getByRole('region', { name: 'Esito della registrazione', exact: true });
        await expect(receipt.getByRole('status')).toContainText('Registrata alle');
        await expect(receipt).toContainText(note);
        await capture('registrata');
        expect(pendingWrites).toEqual(['/api/entries']);
        const entries = await page.evaluate(async id => {
            const response = await fetch(`/api/entries?patientId=${id}`);
            if (!response.ok) throw Error(`Rilettura: HTTP ${response.status}`);
            return response.json() as Promise<{ patientId: string; version: number }[]>;
        }, patientId);
        expect(entries).toEqual([expect.objectContaining({ patientId, version: 1 })]);
        console.log(JSON.stringify({ fixture: fixture.key, width, height, ...resolution, fitWidth: canvas.width,
            visibleHeight: port.height, stripHeight: bar.height, fitTextPx, firstPageMs, secondPageMs, resumeMs, writes: pendingWrites.length }));
    });
}
