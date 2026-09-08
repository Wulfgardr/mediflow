/* @Codex UI06: loopback-only component tests with explicit boundary doubles. */
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function createHarness() {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error(`UI06 browser suite requires Node 24.x; found ${process.version}. No test was executed.`);
    const require = createRequire(import.meta.url);
    // These versions already belong to package-lock.json. Do not install or change the lock from this harness.
    const { build } = require('esbuild');
    const { chromium, expect } = require('@playwright/test');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const temporary = await mkdtemp(path.join(tmpdir(), 'mediflow-ui06-browser-'));
    const previousData = process.env.MEDIFLOW_DATA_DIR;
    process.env.MEDIFLOW_DATA_DIR = path.join(temporary, 'synthetic-data');
    await mkdir(process.env.MEDIFLOW_DATA_DIR);
    let server; let browser;
    const restore = async () => {
        try { await browser?.close(); } finally {
            try {
                if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
            } finally {
                if (previousData === undefined) delete process.env.MEDIFLOW_DATA_DIR;
                else process.env.MEDIFLOW_DATA_DIR = previousData;
                await rm(temporary, { recursive: true, force: true });
            }
        }
    };
    try {
        const boundaryFile = path.join(root, 'tests/ui06/browser-boundaries.tsx');
        const boundaries = new Map([
            ['next/link', 'FixtureLink as default'], ['next/navigation', 'usePathname'],
            ['@/components/kree8/kree8-workspace-shell', 'Kree8WorkspaceShell'],
            ['@/components/settings/settings-nav-sidebar', 'SettingsNavSidebar'],
            ['@/components/settings/settings-search', 'SettingsSearchOverlay, useSettingsSearch'],
            ['@/components/privacy-blur', 'FixturePrivacy as default'],
            ['@/components/security-provider', 'useSecurity'],
            ['@/components/function-models/function-model-picker', 'FunctionModelPicker, useFunctionModelPicker'],
            ['@/lib/ai-providers/fabric/document-synthesis-review-browser-controller', 'createDocumentSynthesisReviewBrowserController, DocumentSynthesisReviewBrowserControllerError'],
            ['@/lib/ai-providers/fabric/document-synthesis-browser-orchestrator', 'DocumentSynthesisBrowserOrchestratorError'],
            ['@/lib/security/smart-import-selection-browser-adapter', 'SmartImportSelectionBrowserAdapterError'],
        ]);
        const built = await build({
            absWorkingDir: root, entryPoints: ['tests/ui06/browser-fixture.tsx'], bundle: true,
            outfile: path.join(temporary, 'bundle.js'), write: false, platform: 'browser', format: 'esm',
            jsx: 'automatic', target: ['chrome120'], logLevel: 'silent',
            // Keep React development warnings: an invalid DOM structure must fail the tests.
            define: { 'process.env.NODE_ENV': '"development"' },
            plugins: [{ name: 'ui06-explicit-test-boundaries', setup(builder) {
                builder.onResolve({ filter: /.*/ }, args => boundaries.has(args.path) ? { path: args.path, namespace: 'ui06-test-boundary' } : undefined);
                builder.onLoad({ filter: /.*/, namespace: 'ui06-test-boundary' }, args => ({ contents: `export { ${boundaries.get(args.path)} } from ${JSON.stringify(boundaryFile)};`, loader: 'js', resolveDir: root }));
            } }],
        });
        const js = built.outputFiles.find(file => file.path.endsWith('.js'))?.contents;
        const css = built.outputFiles.find(file => file.path.endsWith('.css'))?.contents;
        if (!js || !css) throw new Error('UI06: expected a real-component JS/CSS bundle');
        // Minimal fixture canvas and dialog layout. Not the app's missing Tailwind/global stylesheet.
        const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MediFlow UI06 — component fixture</title><link rel="stylesheet" href="/bundle.css"><style>
            :root{font-family:system-ui;font-size:16px;--lume-accent:#176451;--lume-ink:#282321;--lume-ink-muted:#625950;--lume-surface-field:#fff;--lume-surface-canvas:#fff;--lume-border-color:#bbb;--lume-control-height:44px;--lume-radius-control:12px}
            *{box-sizing:border-box}body{margin:0;padding:16px}#root{max-width:1080px;margin:auto;min-width:0}button,input,select{font:inherit}button,a,summary{touch-action:manipulation}
            .mf-modal-backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0003;padding:16px;z-index:10}.mf-modal-backdrop>button{position:absolute;inset:0}.mf-modal-shell{position:relative;background:white;max-width:460px;padding:24px}.mf-modal-shell button{min-height:44px}.mf-modal-shell button+button{margin-left:8px}
            </style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;
        server = createServer((request, response) => {
            if (request.method !== 'GET') { response.writeHead(405).end(); return; }
            const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
            if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
            if (pathname === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(js); return; }
            if (pathname === '/bundle.css') { response.writeHead(200, { 'Content-Type': 'text/css' }).end(css); return; }
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
        });
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('UI06 loopback address missing');
        const origin = `http://127.0.0.1:${address.port}`;
        browser = await chromium.launch({ headless: true });
        return { origin, browser, expect, close: restore };
    } catch (error) { await restore(); throw error; }
}
