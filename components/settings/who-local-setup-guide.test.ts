/* @Codex: source-boundary tests only; not mounted React/browser acceptance. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { whoSetupGuideStatus } from '../../lib/reference-data/who-local-setup-guide-state.ts';
const source = readFileSync(new URL('./who-local-setup-guide.tsx', import.meta.url), 'utf8');

test('source boundary: Web guide only copies fixed host commands; no Docker, process, account or file API authority', () => {
    assert.match(source, /navigator\.clipboard\.writeText\(command\)/u);
    assert.match(source, /Comando copiato\. Non è stato eseguito\./u);
    assert.doesNotMatch(source, /\b(fetch|spawn|exec|require)\s*\(|child_process|['"]node:|localStorage|sessionStorage|document\.cookie|process\.env/u);
    for (const command of ['node scripts/who-local-onboarding.mjs', './Setup_WHO.command', 'Setup_WHO.ps1', 'bash ./Setup_WHO.sh']) assert.ok(source.includes(command));
    assert.match(source, /non rilevato dal browser/u);
    assert.doesNotMatch(source, /userAgent|navigator\.platform/u);
});

test('source boundary: acceptance is transient, reset and independent of terminal installation consent', () => {
    assert.match(source, /\[accepted, setAccepted\] = useState\(false\)/u);
    assert.match(source, /setAccepted\(false\)/u);
    assert.match(source, /disabled=\{index === 2 && !accepted\}/u);
    assert.match(source, /non sostituisce il consenso nel terminale host/u);
    assert.match(source, /nessun target diventa disponibile da un checkbox/iu);
    assert.match(source, /accepted \? <>/u);
    assert.match(source, /if \(!event\.currentTarget\.open\) resetGuide\(\)/u);
});

test('source boundary: late clipboard resolution after close/unmount cannot confirm another command', () => {
    assert.match(source, /const lifetime = copyLifetime\.current/u);
    assert.match(source, /lifetime\.mounted = false; \+\+lifetime\.generation/u);
    assert.match(source, /copyLifetime\.current\.mounted && generation === copyLifetime\.current\.generation/u);
    assert.match(source, /const generation = \+\+copyLifetime\.current\.generation/u);
    assert.match(source, /setCopy\(null\)/u);
    assert.doesNotMatch(source, /eslint-disable|return \(\) => \{[^}]*copyLifetime\.current/u);
    assert.match(source, /copy\?\.command === command/u);
});

test('status presentation never promotes checkbox, command, container start or saved config into available', () => {
    for (const status of ['configured', 'downloading', 'qualifying', 'missing_prerequisites', 'image_evidence_missing', 'ready', 'started', 'accepted', 'copied', 'verified_metadata']) {
        assert.doesNotMatch(whoSetupGuideStatus(status), /risposta diretta osservata/u);
    }
    assert.match(whoSetupGuideStatus('available'), /osservata/u);
    assert.match(whoSetupGuideStatus('available'), /nuova verifica/u);
    assert.match(source, /risposta dalla cache non dimostra/u);
    assert.match(source, /manifest figlio e readback/u);
    assert.match(source, /solo metadati immagine, non download eseguiti, licenze accettate o installazioni qualificate/u);
    assert.doesNotMatch(source, /Per AMD64.*mancano/u);
});

test('source recovery distinguishes browser cancellation and host job; refresh does not install', () => {
    assert.match(source, /Annulla guida/u);
    assert.match(source, /non (?:può |puo )?(?:arresta|annulla|ferma)|non interrompe/u);
    assert.match(source, /Rileggere lo stato non avvia il servizio/u);
    assert.match(source, /aria-label="Passaggi configurazione WHO"/u);
    assert.match(source, /onClick=\{onRefresh\}/u);
    assert.match(source, /summary\.current\?\.focus\(\)/u);
});

// Explicit future fixture gate: this artifact run must not start a browser.
// With opt-in, missing locked dependencies/browser are failures, never substituted mocks.
// This uses the real component and invented UI state, not a backend/WHO availability trial.
test('WHO browser acceptance: explicit host commands, fresh consent, copy-only actions and no invented availability', {
    skip: process.env.MEDIFLOW_WHO_UI_ACCEPTANCE !== '1', timeout: 60_000,
}, async () => {
    assert.ok(process.env.MEDIFLOW_DATA_DIR?.trim(), 'Set an explicit synthetic MEDIFLOW_DATA_DIR');
    const { chromium, expect } = await import('@playwright/test');
    const { build } = await import('esbuild');
    const origin = 'http://127.0.0.1:48975';
    const entry = `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {WhoLocalSetupGuide} from './components/settings/who-local-setup-guide';
function Fixture(){const [reads,setReads]=useState(0);return <><output aria-label="Fixture reads">{reads}</output>
<WhoLocalSetupGuide status="configured" onRefresh={()=>setReads(x=>x+1)}/></>}
const root = createRoot(document.getElementById('root'));
window.remountWhoFixture = key => root.render(<React.StrictMode><Fixture key={key}/></React.StrictMode>);
window.removeWhoFixture = () => root.render(null);
window.remountWhoFixture(0);`;
    const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
        bundle: true, write: false, outfile: 'fixture/bundle.js', platform: 'browser', format: 'iife',
        define: { 'process.env.NODE_ENV': '"development"' } });
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await context.newPage(); const errors: string[] = [], unexpected: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) { unexpected.push(url.origin); await route.abort(); return; }
            if (url.pathname === '/') {
                await route.fulfill({ contentType: 'text/html', body: '<html lang="it"><head><title>Invented WHO UI fixture</title><link rel="stylesheet" href="/bundle.css"><style>button,input{font:inherit}body{margin:16px;font-family:sans-serif}code{overflow-wrap:anywhere}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' }); return;
            }
            if (url.pathname === '/bundle.js') {
                await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text }); return;
            }
            if (url.pathname === '/bundle.css') {
                await route.fulfill({ contentType: 'text/css', body: bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '' }); return;
            }
            unexpected.push(url.pathname); await route.abort();
        });
        await page.goto(origin);
        assert.equal(await page.title(), 'Invented WHO UI fixture');
        assert.equal(new URL(page.url()).origin, origin);
        const guide = page.getByTestId('who-local-setup-guide'), summary = guide.locator('summary');
        const commands = { node: 'node scripts/who-local-onboarding.mjs', darwin: './Setup_WHO.command', win32: '.\\Setup_WHO.ps1', linux: 'bash ./Setup_WHO.sh' };
        let reads = 0;
        for (const [host, command] of Object.entries(commands)) {
            await summary.click();
            await guide.getByRole('combobox').selectOption(host);
            const install = guide.getByRole('button', { name: '3. Installa e avvia', exact: true });
            await expect(install).toBeDisabled();
            await guide.getByRole('button', { name: '2. Licenza', exact: true }).click();
            const consent = guide.getByRole('checkbox'); await expect(consent).not.toBeChecked();
            await consent.check(); await install.click();
            await expect(guide.getByText(command, { exact: true })).toBeVisible();
            await guide.getByRole('button', { name: `Copia ${command}`, exact: true }).click();
            await expect(guide.getByText('Comando copiato. Non è stato eseguito.', { exact: true })).toBeVisible();
            assert.equal(await page.evaluate(() => navigator.clipboard.readText()), command);
            await guide.getByRole('button', { name: '4. Verifica', exact: true }).click();
            await expect(guide).toContainText('non conferma una risposta del servizio');
            await expect(guide).not.toContainText('risposta diretta osservata');
            await guide.getByRole('button', { name: 'Rileggi stato WHO', exact: true }).click();
            await expect(page.getByLabel('Fixture reads')).toHaveText(String(++reads));
            await expect(guide).not.toContainText('risposta diretta osservata');
            await guide.getByRole('button', { name: 'Annulla guida', exact: true }).click();
            await expect(summary).toBeFocused(); await expect(guide).not.toHaveAttribute('open', '');
        }
        // Only this subcase replaces clipboard scheduling with controlled promises. It still
        // mounts the real component (development StrictMode includes effect cleanup/replay).
        // No fake backend, host command execution or WHO success is introduced.
        type ClipboardFixtureWindow = Window & {
            whoPending: Array<{ command: string; resolve: () => void; reject: (reason: Error) => void }>;
            remountWhoFixture: (key: number) => void; removeWhoFixture: () => void;
        };
        await page.evaluate(() => {
            const fixture = window as unknown as ClipboardFixtureWindow;
            fixture.whoPending = [];
            Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true,
                value: (command: string) => new Promise<void>((resolve, reject) => fixture.whoPending.push({ command, resolve, reject })) });
        });
        const settle = async (index: number, rejected = false) => {
            await page.evaluate(async ({ index, rejected }) => {
                const pending = (window as unknown as ClipboardFixtureWindow).whoPending[index];
                if (!pending) throw new Error('missing controlled clipboard call');
                if (rejected) pending.reject(new Error('synthetic denied clipboard')); else pending.resolve();
                // Flush promise continuations and a paint; no timeout-based race assumptions.
                await Promise.resolve();
                await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            }, { index, rejected });
        };
        const copy = (command: string) => guide.getByRole('button', { name: `Copia ${command}`, exact: true });
        const copied = 'Comando copiato. Non è stato eseguito.';
        const checkCurrentCopy = async (command: string) => {
            await expect(copy(command).locator('..').getByRole('status')).toHaveText(copied);
            await expect(guide.getByRole('status')).toHaveCount(1);
            await expect(guide.getByText(/Copia non disponibile/u)).toHaveCount(0);
        };
        const acceptAndInstall = async () => {
            await guide.getByRole('button', { name: '2. Licenza', exact: true }).click();
            await guide.getByRole('checkbox').check();
            await guide.getByRole('button', { name: '3. Installa e avvia', exact: true }).click();
        };
        await summary.click(); await guide.getByRole('combobox').selectOption('node'); await acceptAndInstall();
        await copy(commands.node).click(); // pending[0]
        await copy(`${commands.node} start`).click(); // pending[1], latest generation
        await settle(1); await checkCurrentCopy(`${commands.node} start`);
        await settle(0, true); await checkCurrentCopy(`${commands.node} start`);

        await copy(commands.node).click(); // pending[2], invalidated by step and host change
        await guide.getByRole('button', { name: '1. Prepara', exact: true }).click();
        await guide.getByRole('combobox').selectOption('linux');
        await guide.getByRole('button', { name: '3. Installa e avvia', exact: true }).click();
        await copy(commands.linux).click(); // pending[3]
        await settle(3); await checkCurrentCopy(commands.linux);
        await settle(2); await checkCurrentCopy(commands.linux);

        await copy(commands.linux).click(); // pending[4], invalidated by cancel/reset
        await guide.getByRole('button', { name: 'Annulla guida', exact: true }).click();
        await expect(summary).toBeFocused(); await summary.click();
        await expect(guide.getByRole('button', { name: '3. Installa e avvia', exact: true })).toBeDisabled();
        await guide.getByRole('button', { name: '2. Licenza', exact: true }).click();
        await expect(guide.getByRole('checkbox')).not.toBeChecked(); await acceptAndInstall();
        await copy(commands.linux).click(); // pending[5]
        await settle(5); await checkCurrentCopy(commands.linux);
        await settle(4, true); await checkCurrentCopy(commands.linux);

        await copy(commands.linux).click(); // pending[6], lifetime must retire on unmount
        await page.evaluate(() => (window as unknown as ClipboardFixtureWindow).removeWhoFixture());
        await expect(guide).toHaveCount(0);
        await page.evaluate(() => (window as unknown as ClipboardFixtureWindow).remountWhoFixture(1));
        await expect(guide).toHaveCount(1); await summary.click();
        await expect(guide.getByRole('combobox')).toHaveValue('node');
        await expect(guide.getByRole('button', { name: '3. Installa e avvia', exact: true })).toBeDisabled();
        await acceptAndInstall(); await copy(commands.node).click(); // pending[7], new mount
        await settle(7); await checkCurrentCopy(commands.node);
        await settle(6); await checkCurrentCopy(commands.node);

        await copy(commands.node).click(); // pending[8], ordinary disclosure close also resets
        await summary.click(); await expect(guide).not.toHaveAttribute('open', '');
        await summary.click();
        await expect(guide.getByRole('button', { name: '3. Installa e avvia', exact: true })).toBeDisabled();
        await acceptAndInstall(); await copy(commands.node).click(); // pending[9]
        await settle(9); await checkCurrentCopy(commands.node);
        await settle(8, true); await checkCurrentCopy(commands.node);
        assert.equal(await page.evaluate(() => (window as unknown as ClipboardFixtureWindow).whoPending.length), 10);
        assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
