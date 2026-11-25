import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { secureLaunch } from '../e2e/fixtures/secure-browser';

let browser: Browser;
let script: string;
before(async () => {
    const bundle = await build({
        stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import PatientForm from './components/patient-form';
import {PrivacyProvider} from './components/privacy-provider';
const seed = { firstName: 'Paziente', lastName: 'Sintetico', exemptions: ['013', 'E01'] };
createRoot(document.getElementById('root')).render(<PrivacyProvider><PatientForm isEditMode defaultValues={seed} onSubmit={async () => {}} /></PrivacyProvider>);`, resolveDir: process.cwd(), loader: 'tsx' },
        bundle: true, write: false, outfile: 'fixture/bundle.js', platform: 'browser', format: 'iife',
        plugins: [{ name: 'navigation', setup(b) { b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const usePathname=()=>'/patients/synthetic/edit';export const useRouter=()=>({push(){},replace(){},back(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();" })); } }],
        jsx: 'automatic', loader: { '.css': 'empty' },
        define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    });
    script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
    browser = await chromium.launch(secureLaunch({ headless: true }));
});
after(async () => { await browser?.close(); });

async function openEdit(page: Page, catalog: Array<{ code: string; description: string }>) {
    const reads: string[] = [];
    await page.route('http://127.0.0.1/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/exemptions') {
            const codes = url.searchParams.get('codes');
            if (codes === null) return route.fulfill({ json: { count: catalog.length } });
            reads.push(codes);
            const wanted = new Set(codes.split(','));
            return route.fulfill({ json: catalog.filter(item => wanted.has(item.code)) });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
        return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${script}</script>` });
    });
    await page.goto('http://127.0.0.1/');
    return reads;
}

test('an exemption missing from the catalog is read once and the selector stops asking', { timeout: 20_000 }, async t => {
    const page = await browser.newPage();
    t.after(() => page.close());
    const reads = await openEdit(page, [{ code: 'E01', description: 'Esenzione sintetica di prova' }]);
    await expect(page.getByText('Esenzione sintetica di prova')).toBeVisible();
    await page.waitForTimeout(1500);
    assert.deepEqual(reads, ['013,E01']);
});

test('an empty catalog answer is remembered as an answer', { timeout: 20_000 }, async t => {
    const page = await browser.newPage();
    t.after(() => page.close());
    const reads = await openEdit(page, []);
    await expect(page.getByText('013', { exact: true })).toBeVisible();
    await page.waitForTimeout(1500);
    assert.equal(reads.length, 1);
});
