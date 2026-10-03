(() => {
  'use strict';
  const topology = JSON.parse(document.getElementById('file-topology').textContent);
  const byId = new Map(topology.files.map(file => [file.id, file]));
  const declarationById = new Map(topology.declarations.map(item => [item.id, item]));
  const section = document.getElementById('file-section'), inspector = document.getElementById('file-inspector');
  const picker = document.getElementById('file-picker'), nodes = document.getElementById('file-nodes'), svg = document.getElementById('file-edges');
  const search = document.getElementById('file-search'), moduleFilter = document.getElementById('module-filter');
  const declarationFilter = document.getElementById('declaration-filter'), status = document.getElementById('file-status');
  const resolutionLabels = { included: 'Tra file selezionati', 'outside-selection': 'File fuori selezione, non analizzato',
    builtin: 'Modulo Node', 'external-package': 'Pacchetto esterno', unresolved: 'Target non risolto' };
  const typeLabels = { 'type-only': 'Solo tipi', mixed: 'Valori e tipi', value: 'Valori', 'side-effect': 'Import senza nomi' };
  let selected = null, preview = null;
  const normalize = value => value.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const element = (tag, text, className) => {
    const item = document.createElement(tag); if (text) item.textContent = text; if (className) item.className = className; return item;
  };
  const link = (label, url) => { const item = element('a', label); item.href = url; return item; };
  const relatedDeclarations = file => topology.declarations.filter(item => item.source === file.id || (item.target === file.id && item.resolution === 'included'));
  const declarationMatches = item => {
    const filter = declarationFilter.value;
    return filter === 'all' || item.typeUsage === filter || item.syntax === filter || item.resolution === filter;
  };
  const visibleFiles = () => {
    const query = normalize(search.value.trim());
    const membership = moduleFilter.value ? new Set(topology.memberships.filter(item => item.moduleId === moduleFilter.value).map(item => item.fileId)) : new Set(byId.keys());
    return topology.files.filter(file => {
      if (!membership.has(file.id)) return false;
      const declarations = relatedDeclarations(file).filter(declarationMatches);
      if (declarationFilter.value !== 'all' && !declarations.length) return false;
      return !query || normalize([file.path, ...declarations.map(item => `${item.specifier} ${item.source} ${item.target || ''}`)].join(' ')).includes(query);
    });
  };
  function choose(id, moveFocus = false) {
    selected = id; preview = null; renderInspector(); highlight();
    if (moveFocus) inspector.querySelector('h2').focus();
  }
  function declarationRow(item, incoming) {
    const li = element('li');
    li.append(element('p', `${item.syntax === 're-export' ? 'Re-export' : 'Import'} · ${typeLabels[item.typeUsage]} · ${resolutionLabels[item.resolution]}`, 'technical'));
    li.append(element('code', item.specifier), document.createElement('br'), link(`Dichiarazione alle righe ${item.line}–${item.endLine}`, item.url));
    const other = incoming ? item.source : item.target;
    if (other && byId.has(other)) {
      const button = element('button', `Seleziona ${other}`); button.type = 'button';
      button.addEventListener('click', () => {
        moduleFilter.value = ''; search.value = ''; declarationFilter.value = 'all'; render(); choose(other, true);
      });
      li.append(button);
    } else if (item.targetUrl) li.append(document.createElement('br'), link(`Leggi ${item.target}`, item.targetUrl));
    return li;
  }
  function renderInspector() {
    inspector.replaceChildren();
    if (!selected) {
      inspector.append(element('h2', 'Scegli un file'), element('p', 'Seleziona un file per leggere dove è citato e quali dichiarazioni statiche contiene.'));
    } else {
      const file = byId.get(selected);
      inspector.append(element('p', 'File del sorgente storico', 'eyebrow'), element('h2', file.path), link('Apri il file al commit indicato', file.url));
      const memberships = topology.memberships.filter(item => item.fileId === selected), list = element('ul');
      inspector.append(element('h3', 'File citato come prova'));
      const distinct = new Set();
      for (const membership of memberships) {
        const key = `${membership.moduleId}:${membership.basis}:${membership.evidenceId}`;
        if (distinct.has(key)) continue; distinct.add(key);
        const moduleItem = topology.modules.find(item => item.id === membership.moduleId);
        const li = element('li', `${moduleItem.label} · ${membership.basis === 'node-evidence' ? 'fonte del modulo' : `fonte della relazione ${membership.evidenceId}`}. `);
        li.append(link(`Prova alla riga ${membership.reference.line}`, membership.reference.url)); list.append(li);
      }
      inspector.append(list, element('p', 'Una fonte può essere condivisa: questa associazione non attribuisce proprietà del file o autorità sul dato.', 'limit'));
      for (const [incoming, title] of [[false, 'Dichiarazioni in uscita'], [true, 'Citazioni dai file selezionati']]) {
        const declarations = topology.declarations.filter(item => (incoming ? item.target === selected && item.resolution === 'included' : item.source === selected) && declarationMatches(item));
        inspector.append(element('h3', `${title} (${declarations.length})`));
        const relations = element('ul');
        for (const item of declarations) relations.append(declarationRow(item, incoming));
        inspector.append(declarations.length ? relations : element('p', 'Nessuna dichiarazione corrisponde ai filtri nella selezione; non prova isolamento.'));
      }
      const omissions = topology.omitted.filter(item => item.source === selected), details = element('details');
      details.append(element('summary', 'Esclusioni e provenienza'));
      details.append(element('p', `${omissions.length} costrutti esclusi rilevati in questo file. I target fuori selezione non sono analizzati ricorsivamente.`));
      for (const item of omissions) details.append(link(`${item.syntax} · righe ${item.line}–${item.endLine}`, item.url), document.createElement('br'));
      details.append(element('p', `Blob Git: ${file.blob}`, 'technical'), element('p', `SHA-256: ${file.sha256}`, 'technical'));
      inspector.append(details);
    }
    inspector.querySelector('h2').tabIndex = -1;
  }
  function highlight() {
    const active = preview || selected, connected = new Set(active ? [active] : byId.keys());
    for (const edge of topology.edges) {
      if (!active || edge.source === active || edge.target === active) { connected.add(edge.source); connected.add(edge.target); }
    }
    for (const button of nodes.querySelectorAll('button')) {
      button.classList.toggle('dim', !connected.has(button.dataset.file));
      button.setAttribute('aria-pressed', String(selected === button.dataset.file));
    }
    for (const button of picker.querySelectorAll('button')) button.setAttribute('aria-pressed', String(selected === button.dataset.file));
    for (const path of svg.querySelectorAll('[data-source]')) {
      const relevant = !active || path.dataset.source === active || path.dataset.target === active;
      path.classList.toggle('dim', !relevant); path.classList.toggle('active', relevant && Boolean(active));
    }
  }
  function curve(from, to, className, source, target) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'), mid = (from.x + to.x) / 2;
    path.setAttribute('d', `M ${from.x} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x} ${to.y}`);
    path.setAttribute('class', className); path.dataset.source = source; path.dataset.target = target; svg.append(path);
  }
  function render() {
    const files = visibleFiles(), ids = new Set(files.map(file => file.id)), positions = new Map();
    nodes.replaceChildren(); picker.replaceChildren(); svg.replaceChildren();
    if (selected && !ids.has(selected)) selected = null;
    const columns = moduleFilter.value ? 2 : 3, rows = Math.ceil(files.length / columns);
    const map = nodes.parentElement;
    map.style.aspectRatio = 'auto'; map.style.minHeight = '280px';
    map.style.height = `${Math.max(280, rows * 115)}px`;
    files.forEach((file, index) => {
      const position = { x: moduleFilter.value ? [450, 800][index % columns] : [165, 495, 825][index % columns],
        y: rows === 1 ? 355 : 65 + Math.floor(index / columns) * 580 / (rows - 1) };
      positions.set(file.id, position);
      const mapButton = element('button', file.path.split('/').at(-1), 'node file-node'), listButton = element('button', file.path);
      mapButton.style.left = `${position.x / 990 * 100}%`; mapButton.style.top = `${position.y / 710 * 100}%`;
      mapButton.title = file.path;
      for (const button of [mapButton, listButton]) {
        button.type = 'button'; button.dataset.file = file.id; button.setAttribute('aria-controls', 'file-inspector');
        button.setAttribute('aria-label', file.path);
        button.addEventListener('click', () => choose(file.id, button === listButton));
        button.addEventListener('focus', () => { preview = file.id; highlight(); });
        button.addEventListener('blur', () => { preview = null; highlight(); });
      }
      mapButton.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { preview = file.id; highlight(); } });
      mapButton.addEventListener('pointerleave', () => { preview = null; highlight(); });
      nodes.append(mapButton); picker.append(listButton);
    });
    if (moduleFilter.value && files.length) {
      const marker = element('div', topology.modules.find(item => item.id === moduleFilter.value).label, 'module-marker');
      nodes.append(marker);
      for (const file of files) curve({ x: 100, y: 355 }, positions.get(file.id), 'edge membership', moduleFilter.value, file.id);
    }
    let pairCount = 0;
    for (const edge of topology.edges) {
      const declarations = edge.declarationIds.map(id => declarationById.get(id)).filter(declarationMatches);
      if (ids.has(edge.source) && ids.has(edge.target) && declarations.length) {
        curve(positions.get(edge.source), positions.get(edge.target), `edge${declarations.every(item => item.typeUsage === 'type-only') ? ' type-only' : ''}`, edge.source, edge.target); pairCount++;
      }
    }
    for (const detail of document.getElementById('file-fallback').children) detail.hidden = !ids.has(detail.querySelector('summary').textContent);
    status.textContent = `${files.length} file mostrati su ${topology.files.length}; ${pairCount} coppie di file collegate dai filtri. La copertura totale resta quella indicata sopra.`;
    renderInspector(); highlight();
  }
  for (const moduleItem of topology.modules) {
    const option = element('option', moduleItem.label); option.value = moduleItem.id; moduleFilter.append(option);
  }
  moduleFilter.addEventListener('change', render); declarationFilter.addEventListener('change', render); search.addEventListener('input', render);
  document.getElementById('file-reset').addEventListener('click', () => { moduleFilter.value = ''; declarationFilter.value = 'all'; search.value = ''; selected = null; render(); });
  const setView = files => {
    for (const id of ['controls', 'workspace', 'source-list', 'search-status']) document.getElementById(id).hidden = files;
    section.hidden = !files;
    document.getElementById('architecture-view').setAttribute('aria-pressed', String(!files));
    document.getElementById('files-view').setAttribute('aria-pressed', String(files));
  };
  document.getElementById('architecture-view').addEventListener('click', () => setView(false));
  document.getElementById('files-view').addEventListener('click', () => setView(true));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { preview = null; highlight(); } });
  for (const id of ['view-controls', 'file-controls', 'file-workspace', 'file-picker']) document.getElementById(id).hidden = false;
  render(); setView(false);
})();
