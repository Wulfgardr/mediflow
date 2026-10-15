import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const escape = value => String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function launcherPage(base, nonce, { nativeAvailable, development }) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Avvio | MediFlow</title>
<style nonce="${nonce}">
@font-face{font-family:Newsreader;src:url('${base}/font') format('truetype');font-display:swap;font-weight:400 600}
:root{color-scheme:light dark;--canvas:#e8eaee;--paper:#ffffff;--ink:#14161a;--muted:#555e6b;--rule:#c9ced6;--fresh:#2346b0}
@media(prefers-color-scheme:dark){:root{--canvas:#101216;--paper:#1a1d22;--ink:#e9ecef;--muted:#a3acb8;--rule:#3b414b;--fresh:#9db4ff}}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:400 14px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif}main{max-width:640px;margin:8vh auto;padding:32px;background:var(--paper)}h1{font:400 32px/1.2 Newsreader,Georgia,serif;margin:8px 0 24px}p{margin:8px 0;color:var(--muted)}header{font-size:13px;font-weight:600}section{padding:16px 0;border-top:1px solid var(--rule)}button,a{font:600 14px/1.4 system-ui;color:var(--fresh)}button{min-height:44px;padding:10px 16px;background:var(--paper);border:1px solid var(--rule);cursor:pointer}.primary{background:var(--fresh);color:var(--paper);border-color:var(--fresh)}button:disabled{color:var(--muted);cursor:wait}a{display:inline-block;min-height:44px;padding:10px 0}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--fresh);outline-offset:2px}label{display:flex;align-items:center;gap:8px;min-height:44px}input{width:18px;height:18px;accent-color:var(--fresh)}[hidden]{display:none!important}#status{white-space:pre-wrap;overflow-wrap:anywhere}footer{border-top:1px solid var(--rule);padding-top:16px;margin-top:16px;font-size:13px}@media(max-width:680px){main{margin:0;padding:24px;min-height:100vh}}
</style></head><body><main><header>MediFlow</header><h1>Avvio</h1>
<p id="status" role="status" aria-live="polite">Scegli come aprire MediFlow.</p>
<div id="choices"><section><button class="primary" data-choice="web" autofocus>Apri MediFlow</button><p>Lavora nel browser su questo computer.</p></section>
${process.platform === 'darwin' ? `<section>${nativeAvailable ? '<button data-choice="mac">App per Mac</button>' : '<p>App per Mac non disponibile. Per costruirla serve Xcode completo. Consulta la guida nativa.</p>'}</section>` : ''}
<section><button data-choice="agenti">Accesso per agenti</button><p>Avvia il collegamento locale per un client agente. Servono autenticazione e autorizzazioni in MediFlow. Il terminale resta riservato al collegamento.</p></section>
${development ? '<section><button data-choice="sviluppo">Apri per sviluppo</button><p>Questa cartella contiene modifiche non committate. La build di produzione è sospesa.</p></section>' : ''}
<label><input type="checkbox" id="remember">Ricorda la mia scelta</label></div>
<div id="install" hidden><p>Mancano le dipendenze. Installarle con npm ci? Richiede una connessione al registro npm.</p><button id="approve">Installa dipendenze</button></div>
<a href="?scegli=1" id="change">Cambia</a><footer><button id="stop">Arresta MediFlow</button><p>Lascia aperto il terminale. Ctrl+C arresta MediFlow.</p></footer>
<noscript><p>Attiva JavaScript oppure riapri il lanciatore dal terminale con --senza-browser.</p></noscript>
<script nonce="${nonce}">
const base=${JSON.stringify(base)};let choosing=new URLSearchParams(location.search).has('scegli');let stopped=false;
const status=document.getElementById('status'),choices=document.getElementById('choices');
async function action(name,data={}){try{const response=await fetch(base+'/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!response.ok)status.textContent=await response.text();}catch{status.textContent='Il lanciatore non risponde. Controlla il terminale.';}}
document.querySelectorAll('[data-choice]').forEach(button=>button.addEventListener('click',()=>{choosing=false;action('choose',{choice:button.dataset.choice,remember:document.getElementById('remember').checked});}));
document.getElementById('approve').onclick=()=>action('install');
document.getElementById('stop').onclick=async()=>{stopped=true;await action('stop');status.textContent='Arresto in corso. Attendi la conferma nel terminale.';choices.hidden=true;};
document.getElementById('change').onclick=event=>{event.preventDefault();choosing=true;history.replaceState(null,'','?scegli=1');choices.hidden=false;document.querySelector('[data-choice]').focus();};
async function poll(){if(stopped)return;try{const response=await fetch(base+'/state');if(!response.ok)throw Error();const state=await response.json();status.textContent=state.message;choices.hidden=state.busy&&!choosing;document.querySelectorAll('[data-choice]').forEach(button=>button.disabled=state.busy);document.getElementById('install').hidden=!state.needsInstall;if(state.ready&&state.url&&!choosing){location.replace(base+'/go');return;}}catch{status.textContent='Il lanciatore non risponde. Controlla il terminale.';}setTimeout(poll,500);}poll();
</script></main></body></html>`;
}

export async function createChoiceServer({ root, state, choose, install, stop, nativeAvailable = false, development = false }) {
  const token = crypto.randomBytes(24).toString('hex');
  const nonce = crypto.randomBytes(18).toString('base64');
  const base = `/${token}`;
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    const respond = (code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
    try {
      if (req.headers.host !== new URL(origin).host) return respond(403, 'Accesso negato.');
      const url = new URL(req.url, origin);
      const route = url.pathname;
      if (!route.startsWith(`${base}/`) && route !== base) return respond(404, 'Pagina non trovata.');
      if (req.method === 'GET') {
        if (route === base || route === `${base}/`) return respond(200, launcherPage(base, nonce, { nativeAvailable, development }), 'text/html; charset=utf-8');
        if (route === `${base}/font`) return respond(200, fs.readFileSync(path.join(root, 'app/fonts/Newsreader-Variable.ttf')), 'font/ttf');
        if (route === `${base}/state`) return respond(200, JSON.stringify(state()), 'application/json');
        if (route === `${base}/go`) {
          const current = state();
          if (!current.ready || !current.url) return respond(409, 'Avvio non ancora completato.');
          res.writeHead(303, { Location: current.url }); return res.end();
        }
      }
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return respond(403, 'Accesso negato.');
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2048) return respond(413, 'Richiesta troppo grande.');
      }
      const data = JSON.parse(body);
      if (route === `${base}/choose`) choose(data.choice, data.remember === true);
      else if (route === `${base}/install`) install();
      else if (route === `${base}/stop`) {
        respond(200, 'Arresto in corso.'); void stop(); return;
      } else return respond(404, 'Pagina non trovata.');
      respond(202, 'Richiesta accettata.');
    } catch (error) { respond(400, escape(error.message)); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: `${origin}${base}/`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
