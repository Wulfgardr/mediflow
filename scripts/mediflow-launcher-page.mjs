import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const navigationIntents = new Set(['search', 'identity', 'history', 'prescribing']);

const escape = value => String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function launcherPage(base, nonce, { nativeAvailable, development, version = '', folder = '' }) {
  const row = (choice, title, detail) => `<li><button class="choice" data-choice="${choice}"><span class="dot" aria-hidden="true"></span><span><strong>${title}</strong><small>${detail}</small></span></button></li>`;
  const mac = process.platform !== 'darwin' ? '' : nativeAvailable
    ? row('mac', 'App per Mac', 'L’app nativa, collegata a questo computer.')
    : '<li class="unavailable"><span class="dot" aria-hidden="true"></span><span><strong>App per Mac</strong><small>Non ancora costruita: serve Xcode completo.</small></span></li>';
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MediFlow · Avvio</title>
<style nonce="${nonce}">
@font-face{font-family:Newsreader;src:url('${base}/font') format('truetype');font-display:swap;font-weight:400 600}
:root{color-scheme:light dark;--canvas:#e8eaee;--paper:#ffffff;--hover:#f5f6f8;--selected:#eef2fb;--ink:#14161a;--muted:#555e6b;--pencil:#5f6878;--fresh:#2346b0;--rule:#dfe2e7;--strong:#c9ced6;--critical:#a33a2f}
@media(prefers-color-scheme:dark){:root{--canvas:#101216;--paper:#1a1d22;--hover:#20242a;--selected:#232a3d;--ink:#e9ecef;--muted:#a3acb8;--pencil:#9aa3b0;--fresh:#9db4ff;--rule:#2a2e35;--strong:#3b414b;--critical:#f08a7d}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--canvas);color:var(--ink);font:400 14px/1.5 system-ui,-apple-system,'Segoe UI Variable','Segoe UI',sans-serif}
main{width:min(520px,100% - 32px);margin:48px 0;background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:28px 28px 20px}
.mark{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:28px}
.brand{font:500 21px/1 Newsreader,Georgia,serif;letter-spacing:-.01em}.brand b{color:var(--fresh);font-weight:500}
.version{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
h1{font:400 26px/1.2 Newsreader,Georgia,serif;margin:0 0 20px}
#status{margin:-12px 0 20px;color:var(--muted)}#status:empty{display:none}#status.error{color:var(--critical)}
ul{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}
li{border-bottom:1px solid var(--rule)}
.choice,.unavailable{display:flex;gap:14px;align-items:flex-start;width:100%;padding:14px 4px;text-align:left;font:inherit;color:inherit;background:none;border:0}
.choice{cursor:pointer;border-radius:8px}.choice:hover{background:var(--hover)}
.choice:focus-visible,.link:focus-visible,input:focus-visible{outline:2px solid var(--fresh);outline-offset:2px}
.choice strong,.unavailable strong{display:block;font-weight:600;font-size:15px}
.choice small,.unavailable small{display:block;font-size:13px;color:var(--muted);margin-top:2px}
.unavailable{color:var(--muted)}.unavailable strong{font-weight:400}
.dot{flex:none;width:10px;height:10px;margin-top:6px;border-radius:50%;border:1.5px solid var(--pencil)}
.choice:hover .dot,.choice:focus-visible .dot{border-color:var(--fresh)}
.unavailable .dot{border-style:dashed}
.remember{display:flex;align-items:center;gap:8px;margin:14px 0 0;color:var(--muted);font-size:13px;cursor:pointer}
input{width:16px;height:16px;margin:0;accent-color:var(--fresh)}
ol{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}
ol li{display:flex;gap:14px;align-items:baseline;padding:12px 4px;color:var(--muted)}
ol li .dot{margin-top:0;align-self:center}
ol li.current{color:var(--ink);font-weight:600}ol li.current .dot{border-color:var(--fresh);background:var(--fresh)}
ol li.done .dot{border-color:var(--ink);background:var(--ink)}ol li.done{color:var(--ink)}
.elapsed{margin-left:auto;font-weight:400;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
@media(prefers-reduced-motion:no-preference){ol li.current .dot{animation:breathe 1.6s ease-in-out infinite}}
@keyframes breathe{50%{opacity:.35}}
footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:24px;font-size:13px;color:var(--muted)}
.link{font:600 13px/1 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--fresh);background:none;border:0;padding:8px 0;cursor:pointer}
.folder{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.install{margin-top:16px}.install .link{font-size:14px}
[hidden]{display:none!important}
</style></head><body><main>
<div class="mark"><span class="brand">MediFlow<b>.</b></span><span class="version">${escape(version)}</span></div>
<h1 id="title">Come vuoi usare MediFlow?</h1>
<p id="status" role="status" aria-live="polite"></p>
<div id="choices"><ul>
${row('web', 'Nel browser', 'La cartella si apre in una scheda su questo computer.')}
${mac}
${row('agenti', 'Per un agente', 'Un client autorizzato lavora attraverso MediFlow; il terminale resta dedicato al collegamento.')}
${development ? row('sviluppo', 'Modalità sviluppo', 'Questa cartella ha modifiche non registrate: niente build di produzione.') : ''}
</ul>
<label class="remember"><input type="checkbox" id="remember">Ricorda questa scelta al prossimo avvio</label></div>
<ol id="steps" hidden>
<li data-step="dipendenze"><span class="dot" aria-hidden="true"></span>Dipendenze</li>
<li data-step="versione"><span class="dot" aria-hidden="true"></span>Preparazione della versione<span class="elapsed" id="elapsed"></span></li>
<li data-step="avvio"><span class="dot" aria-hidden="true"></span>Avvio</li>
<li data-step="pronto"><span class="dot" aria-hidden="true"></span>Pronto</li>
</ol>
<div id="install" class="install" hidden><button class="link" id="approve">Installa le dipendenze (npm ci)</button></div>
<footer><span class="folder" title="${escape(folder)}">${escape(folder)}</span><button class="link" id="stop">Arresta</button></footer>
<noscript><p>Attiva JavaScript oppure riapri il lanciatore dal terminale con --senza-browser.</p></noscript>
<script nonce="${nonce}">
const base=${JSON.stringify(base)};let choosing=new URLSearchParams(location.search).has('scegli');let stopped=false;
const $=id=>document.getElementById(id),order=['dipendenze','versione','avvio','pronto'];
const say=(text,error)=>{$('status').textContent=text||'';$('status').classList.toggle('error',!!error);};
async function action(name,data={}){try{const r=await fetch(base+'/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)say(await r.text(),true);}catch{say('Il lanciatore non risponde. Controlla il terminale.',true);}}
document.querySelectorAll('[data-choice]').forEach(b=>b.addEventListener('click',()=>{choosing=false;action('choose',{choice:b.dataset.choice,remember:$('remember').checked});}));
$('approve').onclick=()=>action('install');
$('stop').onclick=async()=>{stopped=true;await action('stop');$('choices').hidden=true;$('steps').hidden=true;$('title').textContent='MediFlow si sta arrestando';say('Puoi chiudere questa scheda quando il terminale conferma l’arresto.');};
const minutes=ms=>{const s=Math.max(0,Math.round(ms/1000));return s<60?s+' s':Math.floor(s/60)+' min '+String(s%60).padStart(2,'0')+' s';};

function render(state){const working=(state.busy||state.ready)&&!choosing;
$('choices').hidden=working;$('steps').hidden=!working;
$('title').textContent=working?(state.ready?'MediFlow è pronto':'Avvio di MediFlow'):'Come vuoi usare MediFlow?';
if(working){const at=order.indexOf(state.step);document.querySelectorAll('#steps li').forEach((li,i)=>{li.className=i<at||state.ready?'done':i===at?'current':'';});
$('elapsed').textContent=state.step==='versione'&&state.since?minutes(Date.now()-state.since):'';
say(state.step==='versione'?'Succede una volta per ogni nuova versione; i tempi dipendono dal computer.':'');}
else say(state.step==='errore'?state.message:'',state.step==='errore');
document.querySelectorAll('[data-choice]').forEach(b=>b.disabled=!!state.busy);$('install').hidden=!state.needsInstall;}
async function poll(){if(stopped)return;try{const r=await fetch(base+'/state');if(!r.ok)throw Error();const state=await r.json();render(state);if(state.ready&&state.url&&!choosing){location.replace(base+'/go');return;}}catch{say('Il lanciatore non risponde. Controlla il terminale.',true);}setTimeout(poll,500);}poll();
</script></main></body></html>`;
}

export async function createChoiceServer({ root, state, choose, install, stop, navigate = undefined, nativeAvailable = false, development = false, version = '', folder = '' }) {
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
        if (route === base || route === `${base}/`) return respond(200, launcherPage(base, nonce, { nativeAvailable, development, version, folder }), 'text/html; charset=utf-8');
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
      if (route === `${base}/navigate`) {
        if (!data || Object.keys(data).join(',') !== 'intent' || !navigationIntents.has(data.intent)
          || !state().ready || typeof navigate !== 'function') return respond(400, 'Navigazione non disponibile.');
        await navigate(data.intent);
      }
      else if (route === `${base}/choose`) choose(data.choice, data.remember === true);
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
