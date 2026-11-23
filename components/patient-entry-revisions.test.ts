import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { secureLaunch } from '../e2e/fixtures/secure-browser';

const richText = '<p data-fixture="remove"><strong>Controllo sintetico</strong> <mark>rivisto</mark></p>';
const plainText = 'PA <120 e A & B\n**Controllo sintetico**';

const fixture = `
import { createRoot } from 'react-dom/client';
import { PatientEntryRevisions } from './components/patient-entry-revisions';

const entries = [
    { id: 'rich', title: 'Nota formattata', content: ${JSON.stringify(richText)} },
    { id: 'plain', title: 'Nota semplice', content: ${JSON.stringify(plainText)} },
    { id: 'encoded', title: 'Nota archiviata', content: 'PA &lt;120 e A &amp; B' },
];
createRoot(document.getElementById('root')).render(entries.map(entry =>
    <section key={entry.id} aria-label={entry.title}>
        <PatientEntryRevisions entry={{ ...entry, version: 1 }}><p>{entry.title}</p></PatientEntryRevisions>
    </section>
));
`;

test('la rettifica ammette solo la formattazione prevista e conserva il testo semplice', { timeout: 30_000 }, async t => {
    const bundle = await build({
        stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' },
        bundle: true,
        write: false,
        outfile: 'fixture/bundle.js',
        jsx: 'automatic',
        plugins: [{
            name: 'correction-write',
            setup(builder) {
                builder.onResolve({ filter: /^@\/lib\/db$/ }, () => ({ path: 'db', namespace: 'fixture' }));
                builder.onLoad({ filter: /^db$/, namespace: 'fixture' }, () => ({ contents: `
                    export class ApiConflictError extends Error {}
                    export const db = {
                        getSessionReadSignal: () => new AbortController().signal,
                        correctDiaryEntry: (_, changes) => { window.savedCorrection = changes; },
                    };
                ` }));
            },
        }],
    });
    const browser = await chromium.launch(secureLaunch({ headless: true }));
    t.after(() => browser.close());
    const page = await browser.newPage();
    const url = 'http://127.0.0.1:1/';
    await page.route(url, route => route.fulfill({
        contentType: 'text/html',
        body: '<style>[contenteditable] { white-space: pre-wrap; }</style><div id="root"></div><script src="/bundle.js"></script>',
    }));
    await page.route(url + 'bundle.js', route => route.fulfill({
        contentType: 'application/javascript',
        body: bundle.outputFiles.find(file => file.path.endsWith('/bundle.js'))!.text,
    }));
    await page.goto(url);

    await t.test('rimuove elementi e attributi esterni al formato ammesso', async () => {
        const rich = page.getByRole('region', { name: 'Nota formattata' });
        await rich.getByRole('button', { name: 'Rettifica', exact: true }).click();
        const editor = rich.getByRole('textbox', { name: 'Testo della rettifica' });
        await expect(editor.locator('strong')).toHaveText('Controllo sintetico');
        await expect(editor.locator('mark, [data-fixture]')).toHaveCount(0);
        await expect(editor).toHaveText('Controllo sintetico rivisto');
    });

    await t.test('conserva caratteri, a capo e Markdown dopo una modifica', async () => {
        const plain = page.getByRole('region', { name: 'Nota semplice' });
        await plain.getByRole('button', { name: 'Rettifica', exact: true }).click();
        const editor = plain.getByRole('textbox', { name: 'Testo della rettifica' });
        const save = plain.getByRole('button', { name: 'Salva rettifica' });
        expect(await editor.textContent()).toBe(plainText);
        await editor.focus();
        await plain.getByRole('textbox', { name: 'Titolo' }).focus();
        await expect(save).toBeDisabled();
        await editor.focus();
        await editor.evaluate(element => {
            window.getSelection()?.selectAllChildren(element);
            window.getSelection()?.collapseToEnd();
        });
        await page.keyboard.insertText(' rivisto');
        await save.click();
        const saved = await page.evaluate(() => Reflect.get(window, 'savedCorrection'));
        expect(saved).toEqual({ version: 1, content: plainText + ' rivisto' });
    });

    await t.test('apre il testo semplice archiviato con le entità HTML', async () => {
        const original = page.getByRole('region', { name: 'Nota archiviata' });
        await original.getByRole('button', { name: 'Rettifica', exact: true }).click();
        await expect(original.getByRole('textbox', { name: 'Testo della rettifica' })).toHaveText('PA <120 e A & B');
    });
});
