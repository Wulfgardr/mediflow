(() => {
  'use strict';
  const snapshot = JSON.parse(document.getElementById('snapshot').textContent);
  const byId = new Map(snapshot.nodes.map(node => [node.id, node]));
  const labels = { surface: 'Ingresso', transport: 'Comunicazione', host: 'Servizi dell’host',
    policy: 'Regole e conferma', service: 'Servizio nominato', storage: 'Persistenza locale' };
  const kinds = { import: 'Import', call: 'Chiamata', composition: 'Composizione', contract: 'Contratto', http: 'HTTP' };
  const svg = document.getElementById('edges'), nodes = document.getElementById('nodes');
  const picker = document.getElementById('list-picker'), inspector = document.getElementById('inspector');
  const search = document.getElementById('search'), status = document.getElementById('search-status');
  const buttons = new Map(), paths = new Map();
  let selected = 'mcp', preview = null, query = '';
  const element = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    return item;
  };
  const normalize = value => value.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const matches = node => normalize([node.label, node.summary, ...node.evidence.map(ref => ref.path)].join(' ')).includes(query);
  const reference = ref => {
    const a = element('a', `${ref.path} · riga ${ref.line}`);
    a.href = ref.url;
    return a;
  };
  function renderInspector() {
    inspector.replaceChildren();
    if (!selected) {
      inspector.append(element('h2', 'Segui un collegamento'), element('p', 'Scegli un elemento nella mappa o nell’elenco per leggere ruolo, regole e fonti.'));
      return;
    }
    const node = byId.get(selected);
    inspector.append(element('p', labels[node.group], 'eyebrow'), element('h2', node.label), element('p', node.summary));
    for (const [key, title] of [['data', 'Dove passa il dato?'], ['authority', 'Chi può modificarlo?'], ['evidence', 'Quali prove abbiamo?']]) {
      inspector.append(element('p', title, 'question'), element('p', node.questions[key]));
    }
    inspector.append(element('p', `Limite: ${node.knownUnknown}`, 'limit'));
    const sources = element('details'), sourceList = element('ul');
    sources.append(element('summary', 'Dettagli tecnici e fonti'));
    for (const ref of node.evidence) {
      const li = element('li'); li.append(reference(ref), element('p', `SHA-256 del file: ${ref.sha256}`, 'technical')); sourceList.append(li);
    }
    sources.append(sourceList);
    const relations = element('ul');
    for (const edge of snapshot.edges.filter(edge => edge.source === selected || edge.target === selected)) {
      const other = edge.source === selected ? edge.target : edge.source;
      const li = element('li', `${byId.get(edge.source).label} → ${byId.get(edge.target).label}: ${edge.label}. ${kinds[edge.kind]}. `);
      const button = element('button', `Esplora: ${byId.get(other).label}`); button.type = 'button';
      button.addEventListener('click', () => { select(other); inspector.querySelector('h2').focus(); });
      for (const ref of edge.evidence) li.append(reference(ref), document.createElement('br'));
      li.append(button); relations.append(li);
    }
    sources.append(element('h3', 'Relazioni documentate'), relations); inspector.append(sources);
    inspector.querySelector('h2').tabIndex = -1;
  }
  function highlight() {
    const active = preview || selected, connected = new Set(active ? [active] : byId.keys());
    for (const edge of snapshot.edges) {
      const relevant = !active || edge.source === active || edge.target === active;
      if (relevant) { connected.add(edge.source); connected.add(edge.target); }
      paths.get(edge.id).classList.toggle('dim', !relevant);
      paths.get(edge.id).classList.toggle('active', relevant && Boolean(active));
    }
    for (const node of snapshot.nodes) {
      const [mapButton, listButton] = buttons.get(node.id);
      mapButton.classList.toggle('dim', !connected.has(node.id));
      mapButton.classList.toggle('search-miss', !matches(node));
      listButton.hidden = !matches(node);
      document.getElementById(`source-${node.id}`).hidden = !matches(node);
      for (const button of [mapButton, listButton]) button.setAttribute('aria-pressed', String(selected === node.id));
    }
  }
  function select(id) { selected = id; preview = null; renderInspector(); highlight(); }
  for (const edge of snapshot.edges) {
    const from = byId.get(edge.source), to = byId.get(edge.target);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const mid = (from.x + to.x) / 2;
    path.setAttribute('d', `M ${from.x} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x} ${to.y}`);
    path.setAttribute('class', `edge ${edge.kind}`); paths.set(edge.id, path); svg.append(path);
  }
  for (const node of snapshot.nodes) {
    const mapButton = element('button', node.label, `node ${node.group}`), listButton = element('button', node.label);
    mapButton.style.left = `${node.x / 990 * 100}%`; mapButton.style.top = `${node.y / 710 * 100}%`;
    for (const button of [mapButton, listButton]) {
      button.type = 'button'; button.dataset.node = node.id;
      button.setAttribute('aria-controls', 'inspector');
      button.addEventListener('click', () => {
        select(node.id);
        if (button === listButton) inspector.querySelector('h2').focus();
      });
      button.addEventListener('focus', () => { preview = node.id; highlight(); });
      button.addEventListener('blur', () => { preview = null; highlight(); });
    }
    mapButton.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { preview = node.id; highlight(); } });
    mapButton.addEventListener('pointerleave', () => { preview = null; highlight(); });
    nodes.append(mapButton); picker.append(listButton); buttons.set(node.id, [mapButton, listButton]);
  }
  search.addEventListener('input', () => {
    query = normalize(search.value.trim());
    const count = snapshot.nodes.filter(matches).length;
    status.textContent = count ? `${count} ${count === 1 ? 'elemento trovato' : 'elementi trovati'} nell’elenco.` : 'Nessun elemento trovato. Prova un altro nome o un percorso di file.';
    highlight();
  });
  document.getElementById('reset').addEventListener('click', () => {
    query = ''; search.value = ''; status.textContent = ''; select(null);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { preview = null; highlight(); }
  });
  for (const id of ['controls', 'workspace', 'list-picker']) document.getElementById(id).hidden = false;
  select(selected);
})();
