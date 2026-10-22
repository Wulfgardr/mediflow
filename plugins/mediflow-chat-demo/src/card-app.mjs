import { App, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
const { view, gestureKey } = JSON.parse('{"view":"__CARD_VIEW__","gestureKey":"__CARD_KEY__"}');
const key = crypto.subtle.importKey('raw', Uint8Array.from(gestureKey.match(/../g), byte => parseInt(byte, 16)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sign = crypto.subtle.sign.bind(crypto.subtle);
document.currentScript?.remove();
async function mount() {
  await new Promise(resolve => setTimeout(resolve, 0));
  const app = new App({ name: 'mediflow-synthetic-card', version: '0.1.0' }, {}, { autoResize: false });
  const el = id => document.getElementById(id);
  let epoch = 0, ready = false, expiry, initialResultSeen = false, initialInputSeen = false, nonce;
  const call = (operation, confirmation = {}) => app.callServerTool({ name: 'mediflow_synthetic_card', arguments: { operation, view, ...confirmation } });
  function status(text) { el('status').textContent = text; }
  function clear(text) {
    epoch++; ready = false; nonce = undefined; clearTimeout(expiry);
    el('card').replaceChildren(); el('card').hidden = true;
    for (const id of ['share', 'deny', 'revoke']) el(id).setAttribute('disabled', '');
    status(text);
  }
  async function revoke(text) { clear(text); try { await call('revoke'); } catch {} }
  function node(tag, text) { const result = document.createElement(tag); result.textContent = text; return result; }
  function render(card) {
    const section = el('card'); section.replaceChildren();
    const reference = node('p', card.pseudonym); reference.className = 'meta'; section.append(reference);
    for (const [title, items, summary, description] of [
      ['Storia', card.history, item => item.condition, item => `${item.note} · ${item.relativeTime}`],
      ['Terapie', card.therapies, item => item.medicine, item => `${item.dose} · ${item.frequency}`],
      ['Misure', card.measures, item => item.kind, item => `${item.value} ${item.unit} · ${item.relativeTime}`],
    ]) {
      const group = node('section', '');
      const list = node('div', '');
      const previous = node('button', 'Precedenti'), next = node('button', 'Successivi');
      const count = node('p', '');
      let page = 0;
      function update() {
        list.replaceChildren();
        const start = page * 10;
        for (const item of items.slice(start, start + 10)) {
          const details = document.createElement('details');
          const prose = node('p', description(item)); prose.className = 'prose';
          const source = node('p', `Fonte: ${item.sourceRef}`); source.className = 'meta';
          details.append(node('summary', summary(item)), prose, source);
          list.append(details);
        }
        previous.toggleAttribute('disabled', page === 0); next.toggleAttribute('disabled', start + 10 >= items.length);
        count.textContent = items.length ? `${start + 1}–${Math.min(start + 10, items.length)} di ${items.length}` : 'Nessuna voce';
      }
      previous.addEventListener('click', () => { page--; update(); });
      next.addEventListener('click', () => { page++; update(); });
      const nav = node('nav', ''); nav.setAttribute('aria-label', `${title}: pagine`);
      nav.hidden = items.length <= 10; nav.append(previous, next);
      group.append(node('h2', title), count, list, nav); section.append(group); update();
    }
    section.hidden = false;
  }
  el('share').addEventListener('click', async event => {
    if (!event.isTrusted || !ready) return;
    ready = false; el('share').setAttribute('disabled', ''); el('deny').setAttribute('disabled', '');
    el('revoke').removeAttribute('disabled');
    const current = epoch;
    status('Condivisione in corso…');
    try {
      const consentNonce = nonce;
      const signature = await sign('HMAC', await key, new TextEncoder().encode(consentNonce));
      if (current !== epoch) return;
      const gestureProof = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
      const result = await call('share', { nonce: consentNonce, gestureProof });
      if (current !== epoch) return;
      if (result.isError || !result.structuredContent) throw new Error();
      render(result.structuredContent); status('Scheda sintetica condivisa.');
    } catch { if (current === epoch) await revoke('Scheda non disponibile. Apri una nuova vista e riprova.'); }
  });
  el('deny').addEventListener('click', () => revoke('Nessun contenuto condiviso.'));
  el('revoke').addEventListener('click', () => revoke('Scheda chiusa.'));
  el('theme').addEventListener('change', event => { document.documentElement.dataset.theme = /** @type {HTMLSelectElement} */ (event.target).value; });
  function host(context) {
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    const height = context?.containerDimensions?.maxHeight;
    if (Number.isFinite(height) && height > 0) document.documentElement.style.setProperty('--view-height', `${Math.min(720, height)}px`);
    if (context?.theme) {
      const theme = context.theme === 'dark' ? 'grafite' : 'giorno';
      document.documentElement.dataset.theme = theme; /** @type {HTMLSelectElement} */ (el('theme')).value = theme;
    }
  }
  app.onhostcontextchanged = host;
  app.ontoolresult = result => {
    if (!initialResultSeen && result.content?.length === 1 && result.content[0].type === 'text'
        && result.content[0].text === 'Apri la vista per scegliere se condividere la scheda sintetica.') { initialResultSeen = true; return; }
    void revoke('Nuovo turno. Apri una nuova vista per condividere.');
  };
  app.ontoolinput = input => {
    if (!initialInputSeen && Object.keys(input.arguments ?? {}).length === 0) { initialInputSeen = true; return; }
    void revoke('Nuovo turno. Apri una nuova vista per condividere.');
  };
  app.onteardown = async () => { await revoke('Vista chiusa.'); return {}; };
  app.onclose = () => clear('Collegamento interrotto.');
  app.onerror = () => clear('Collegamento non verificato.');
  window.addEventListener('pagehide', () => { void revoke('Vista chiusa.'); });
  async function connect() {
    const current = epoch;
    try {
      await app.connect(); host(app.getHostContext());
      await app.sendSizeChanged({ height: document.querySelector('main').clientHeight });
      if (current !== epoch) return;
      const result = await call('prepare');
      if (current === epoch && !result.isError && typeof result._meta?.consentNonce === 'string') {
        nonce = result._meta.consentNonce;
        ready = true; el('share').removeAttribute('disabled'); el('deny').removeAttribute('disabled');
        status('Scegli se condividere questa scheda sintetica.');
        expiry = setTimeout(() => { void revoke('Scelta scaduta. Nessun nuovo contenuto condiviso.'); }, 30_000);
      } else if (current === epoch) clear('Scheda non disponibile. Apri una nuova vista e riprova.');
    } catch { if (current === epoch) clear('Scheda non disponibile. Apri una nuova vista e riprova.'); }
  }
  void connect();
}
void mount();
