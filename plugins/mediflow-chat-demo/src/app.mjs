import { App } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'mediflow-chat-demo', version: '0.1.0' });
const element = id => document.getElementById(id);
const config = JSON.parse(element('demo-connection').textContent);
const view = crypto.randomUUID();
let token = '';
let epoch = 0;
let abort = new AbortController();
let expiry;
let heartbeat;
let connected = false;
let busy = false;
function enabled(id, value) { element(id).toggleAttribute('disabled', !value); }
function proof(id, value) { element(id).hidden = !value; }
function status(text) { element('status').textContent = text; }
function clearSession(message) {
  const previous = token;
  token = ''; epoch++; abort.abort(); abort = new AbortController();
  clearTimeout(expiry); clearInterval(heartbeat);
  element('local-data').replaceChildren(); element('local-data').hidden = true;
  proof('authorized', false); proof('reachable', false);
  enabled('lock', false); enabled('admit', false); enabled('check', connected);
  if (message) status(message);
  if (previous) fetch(`${config.endpoint}/revoke`, { method: 'POST', credentials: 'omit',
    cache: 'no-store', headers: { Authorization: `Bearer ${previous}`, 'X-Demo-View': view } }).catch(() => {});
}
async function request(path, method = 'GET', sessionToken = '', signal = abort.signal) {
  const response = await fetch(`${config.endpoint}${path}`, { method, signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { 'X-Demo-View': view, ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) } });
  if (!response.ok) throw new Error('Demo unavailable');
  const data = await response.json();
  if (data.serviceId !== config.serviceId) throw new Error('Demo unavailable');
  return data;
}
async function check() {
  if (!connected || busy) return;
  clearSession(); busy = true; enabled('check', false);
  const current = epoch;
  status('Verifica del servizio sintetico…');
  try {
    const data = await request('/health');
    if (current !== epoch) return;
    if (data.status !== 'synthetic_service_ready') throw new Error('Demo unavailable');
    proof('reachable', true); enabled('admit', true);
    status('Servizio verificato. Puoi autorizzare una sessione sintetica di un minuto.');
  } catch {
    if (current === epoch) { clearSession(); status('Servizio non verificato. Consulta i dettagli della prova e l’origine ammessa.'); }
  } finally { busy = false; enabled('check', connected); }
}
element('check').addEventListener('click', check);
element('admit').addEventListener('click', async () => {
  if (busy || !connected || element('reachable').hidden) return;
  busy = true; enabled('admit', false); enabled('check', false);
  const current = epoch;
  try {
    const admission = await request('/admit', 'POST');
    if (current !== epoch) return;
    if (admission.status !== 'demo_session_authorized' || typeof admission.token !== 'string'
      || !Number.isFinite(admission.expiresAt) || admission.expiresAt <= Date.now()
      || admission.expiresAt > Date.now() + 60_000) throw new Error('Demo unavailable');
    token = admission.token; enabled('lock', true);
    expiry = setTimeout(() => clearSession('Sessione scaduta. Il contenuto locale è stato rimosso.'), admission.expiresAt - Date.now());
    const data = await request('/fixture', 'GET', token);
    if (current !== epoch) return;
    if (data.status !== 'synthetic_fixture' || typeof data.sentinel !== 'string'
      || !/^SYNTHETIC_L_[0-9a-f-]{36}$/.test(data.sentinel)) throw new Error('Demo unavailable');
    proof('authorized', true); enabled('lock', true);
    element('local-data').textContent = `Contenuto sintetico ricevuto direttamente dal servizio: ${data.sentinel}`;
    element('local-data').hidden = false;
    status('Lettura locale riuscita. La sessione scade dopo un minuto.');
    heartbeat = setInterval(async () => {
      try { await request('/session', 'GET', token); }
      catch { if (current === epoch) clearSession('Sessione non più verificata. Il contenuto locale è stato rimosso.'); }
    }, 3_000);
  } catch {
    if (current === epoch) clearSession('Sessione non autorizzata o lettura non riuscita. Il contenuto locale è stato rimosso.');
  } finally { busy = false; enabled('check', connected); }
});
element('lock').addEventListener('click', () => clearSession('Dimostrazione bloccata. Il contenuto locale è stato rimosso.'));
element('theme').addEventListener('change', event => { document.documentElement.dataset.theme = /** @type {HTMLSelectElement} */ (event.target).value; });
element('origin').textContent = window.origin;
function hostTheme(context) {
  if (context?.theme) {
    const theme = context.theme === 'dark' ? 'grafite' : 'giorno';
    document.documentElement.dataset.theme = theme;
    /** @type {HTMLSelectElement} */ (element('theme')).value = theme;
  }
}
app.addEventListener('hostcontextchanged', hostTheme);
app.onteardown = async () => { connected = false; clearSession(); return {}; };
app.onclose = () => { connected = false; proof('connected', false); clearSession('Collegamento alla chat interrotto.'); };
app.onerror = () => { connected = false; proof('connected', false); clearSession('Collegamento alla chat non verificato.'); };
window.addEventListener('pagehide', () => clearSession());
document.addEventListener('visibilitychange', () => { if (document.hidden) clearSession('Vista nascosta. Autorizza nuovamente la dimostrazione.'); });
app.connect().then(() => {
  connected = true; proof('connected', true); enabled('check', true);
  hostTheme(app.getHostContext());
  status('Vista collegata alla chat. Verifica il servizio per provare il caricamento locale.');
}).catch(() => { connected = false; proof('connected', false); clearSession('Collegamento alla chat non disponibile. L’esempio resta leggibile.'); });
