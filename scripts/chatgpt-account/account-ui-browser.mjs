/* @Codex: isolated component fixture; no product server, account login, or remote requests. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.cwd();
const output = resolve(process.argv[2] ?? '/private/tmp/mediflow-086-release-followup/WUL-689-account-ui');
await mkdir(output, { recursive: true, mode: 0o700 });
const entry = join(output, 'fixture.tsx');
await writeFile(entry, `/* @Codex: synthetic component fixture. */
import React, { useState } from '${root}/node_modules/react/index.js';
import { createRoot } from '${root}/node_modules/react-dom/client.js';
import { ChatGptAccountCard } from '${root}/components/settings/chatgpt-account-card.tsx';
function Fixture() { const [active, setActive] = useState(true); return <main><h1>Impostazioni AI · fixture sintetica</h1><ChatGptAccountCard active={active}/><button id="lock-fixture" onClick={() => setActive(false)}>Blocca fixture</button></main>; }
createRoot(document.getElementById('root')!).render(<Fixture/>);
`);
await build({ entryPoints: [entry], bundle: true, outfile: join(output, 'fixture.js'), jsx: 'automatic', platform: 'browser',
    nodePaths: [join(root, 'node_modules')], tsconfig: join(root, 'tsconfig.json'), loader: { '.module.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"test"' } });
const utilities = await postcss([tailwind({ base: root })]).process(`@import "tailwindcss" source(none); @source "${root}/components/settings/settings-ui.tsx"; @source "${root}/components/settings/chatgpt-account-card.tsx";`, { from: join(root, 'app/account-fixture.css') });
const tokens = (await Promise.all(['lume-tokens.css','lume-motion.css','runtime-twin.css'].map(file => readFile(join(root, 'app', file), 'utf8')))).join('\n');
await writeFile(join(output, 'base.css'), utilities.css + '\n' + tokens + '\nbody{margin:0;background:var(--lume-surface-canvas);color:var(--lume-ink);font-family:system-ui}main{width:calc(100% - 32px);max-width:1080px;margin:32px auto}h1{font-size:20px;margin-bottom:24px}#lock-fixture{margin-top:32px}');
await writeFile(join(output, 'index.html'), '<!doctype html><html lang="it" data-runtime-twin-design="proposal" data-ui-style="redesign" data-twin-composition="stream"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ChatGPT account — fixture sintetica</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
const files = new Set(['index.html','base.css','fixture.css','fixture.js']);
const server = createServer(async (req,res) => {
    const name = req.url === '/' ? 'index.html' : req.url?.slice(1);
    if (!files.has(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(join(output, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const evidence = { fixtureOnly: true, viewports: [], states: [], checks: [], errors: [] };
function status(state, notice = null) {
    return { state, notice, plan: state === 'connected' ? 'plus' : null, loginExpiresAt: state === 'awaiting_login' ? Date.now() + 300000 : null,
        actions: state === 'connected' ? ['logout','read_models','read_rate_limits','refresh_account'] : state === 'awaiting_login' ? ['cancel_login'] : state === 'verifying' ? ['complete_login','cancel_login'] : state === 'unavailable' ? ['configure_host'] : ['connect'],
        inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' };
}
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    let state = 'disconnected'; let notice = null; let delayedStart = null;
    const calls = [];
    page.on('pageerror', error => evidence.errors.push(error.message));
    await page.route('**/*', async route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.origin !== origin) { evidence.errors.push('unexpected external request'); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const operation = url.pathname.split('/chatgpt/')[1]; calls.push(operation);
        if (operation !== 'status') { assert.equal(request.method(), 'POST'); assert.equal(request.postData(), '{}'); }
        let response;
        if (operation === 'login/start') {
            state = 'awaiting_login'; notice = null;
            response = { status: status(state), authUrl: 'https://auth.openai.com/oauth/authorize?state=synthetic-browser-fixture' };
            if (delayedStart) { await delayedStart.promise; }
        } else if (operation === 'login/cancel') { state = 'disconnected'; notice = 'canceled'; response = status(state, notice); }
        else if (operation === 'login/complete') { state = 'connected'; response = status(state); }
        else if (operation === 'logout') { state = 'disconnected'; notice = null; response = status(state); }
        else if (operation === 'models') response = { status: status(state), models: [{ id:'synthetic-model',model:'synthetic-model',isDefault:true }] };
        else if (operation === 'rate-limits') response = { status: status(state), primary: { usedPercent: 84, windowDurationMins:300, resetsAt:null }, secondary:null };
        else response = status(state, notice);
        await route.fulfill({ json: response }).catch(() => undefined);
    });
    const panel = page.getByTestId('chatgpt-account-panel');
    async function geometry(width, name) {
        await page.setViewportSize({ width, height: 1000 });
        const metrics = await panel.evaluate(element => {
            const controls = [...element.querySelectorAll('button,a,summary')].filter(node => node.checkVisibility());
            const rectangles = controls.map(node => { const r=node.getBoundingClientRect(); return { text: node.textContent, x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; });
            const overlaps=[];
            for(let i=0;i<rectangles.length;i++) for(let j=i+1;j<rectangles.length;j++) {
                const a=rectangles[i],b=rectangles[j]; if(Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1) overlaps.push([a.text,b.text]);
            }
            return { documentWidth:document.documentElement.scrollWidth, viewport:innerWidth, panelWidth:element.getBoundingClientRect().width, overlaps, controls:rectangles };
        });
        assert.ok(metrics.documentWidth <= width, `${name}: horizontal overflow`); assert.deepEqual(metrics.overlaps, []);
        assert.ok(metrics.controls.every(item => item.height >= 44));
        evidence.viewports.push({ width, state:name, ...metrics });
        await panel.screenshot({ path:join(output,`${name}-${width}.png`) });
    }
    await page.goto(origin); await panel.getByText('Non collegato', { exact:true }).waitFor();
    for (const width of [390,965,1440]) await geometry(width,'disconnected');
    await panel.getByRole('button',{name:'Collega ChatGPT',exact:true}).click();
    await panel.getByRole('link',{name:'Apri accesso ufficiale'}).waitFor(); evidence.states.push('awaiting_login');
    assert.equal(await panel.getByRole('link').getAttribute('rel'), 'noopener noreferrer');
    await geometry(390,'awaiting');
    state = 'verifying'; await panel.getByRole('button',{name:'Rileggi stato'}).click();
    await panel.getByRole('button',{name:'Verifica accesso'}).waitFor(); assert.equal(await panel.getByRole('link').count(),0); evidence.states.push('verifying');
    await panel.getByRole('button',{name:'Verifica accesso'}).click();
    await panel.getByText('Account collegato',{exact:true}).waitFor(); evidence.states.push('connected');
    assert.equal(calls.includes('models'),false); assert.equal(calls.includes('rate-limits'),false);
    await panel.locator('summary').focus(); await page.keyboard.press('Enter');
    await panel.getByRole('button',{name:'Mostra modelli'}).click(); await panel.getByText('synthetic-model',{exact:true}).waitFor();
    await panel.getByRole('button',{name:'Controlla utilizzo'}).click(); await panel.getByText('84% utilizzato',{exact:false}).waitFor();
    assert.equal(await panel.getByRole('progressbar').getAttribute('value'),'84');
    assert.equal(await panel.getByText('Limite aggiuntivo: dato non disponibile.',{exact:true}).count(),1);
    evidence.states.push('quota');
    for (const width of [390,965,1440]) await geometry(width,'connected-disclosure');
    await panel.getByRole('button',{name:'Scollega ChatGPT'}).click(); await panel.getByText('Non collegato',{exact:true}).waitFor();
    assert.equal(await panel.getByText('synthetic-model',{exact:true}).count(),0);
    await panel.getByRole('button',{name:'Collega ChatGPT',exact:true}).click(); await panel.getByRole('link',{name:'Apri accesso ufficiale'}).waitFor();
    await panel.getByRole('button',{name:'Annulla accesso'}).click(); await panel.getByText('Accesso annullato.',{exact:true}).waitFor(); assert.equal(await panel.getByRole('link').count(),0); evidence.states.push('cancel');
    state='error';notice='login_expired';await panel.getByRole('button',{name:'Rileggi stato'}).click(); await panel.getByText('Collegamento interrotto',{exact:true}).waitFor(); evidence.states.push('error'); await geometry(390,'expired');
    let release; delayedStart={promise:new Promise(resolve=>{release=resolve;})};
    await panel.getByRole('button',{name:'Collega ChatGPT',exact:true}).click();
    await panel.getByRole('button',{name:'Annulla accesso'}).click(); await panel.getByText('Accesso annullato.',{exact:true}).waitFor(); release(); delayedStart=null;
    await page.waitForTimeout(100); assert.equal(await panel.getByRole('link').count(),0); evidence.states.push('late_reply');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await panel.getByText('Sessione bloccata',{exact:true}).waitFor(); assert.equal(await panel.getByRole('link').count(),0);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await panel.getByText('Non collegato',{exact:true}).waitFor(); evidence.states.push('page_restore');
    await page.locator('#lock-fixture').click(); await panel.getByText('Sessione bloccata',{exact:true}).waitFor(); assert.equal(await panel.getByRole('button').count(),0); evidence.states.push('locked');
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    evidence.checks.push('no overlap/overflow','shared action height >=44px','keyboard disclosure','no automatic model/quota read','no storage','no external request','cancel/lock remove URL','late reply ignored');
    assert.deepEqual(evidence.errors,[]);
    await writeFile(join(output,'browser-results.json'),JSON.stringify(evidence,null,2));
    process.stdout.write(JSON.stringify({ pass:true, states:evidence.states, geometry:evidence.viewports.length, output })+'\n');
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
