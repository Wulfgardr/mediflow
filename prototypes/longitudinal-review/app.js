/* @Codex — isolated browser interaction, no storage or network. */
(function () {
  const cases = globalThis.MediFlowSyntheticCases;
  const model = globalThis.MediFlowReviewModel;
  let state = model.create(cases[0]);
  const caseStates = new Map();
  const byId = (id) => document.getElementById(id);
  const node = (tag, className, content) => {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (content !== undefined) item.textContent = content;
    return item;
  };
  function action(next, focusId = 'status') {
    state = next;
    render();
    requestAnimationFrame(() => byId(focusId)?.focus());
  }
  function renderCases() {
    const nav = byId('cases'); nav.replaceChildren();
    for (const example of cases) {
      const button = node('button', '', example.label);
      button.type = 'button'; button.id = `choose-${example.id}`;
      button.setAttribute('aria-current', String(example.id === state.example.id));
      button.addEventListener('click', () => {
        caseStates.set(state.example.id, state);
        action(caseStates.get(example.id) ?? model.create(example), button.id);
      });
      nav.append(button);
    }
  }
  function renderSources() {
    const container = byId('sources'); container.replaceChildren();
    for (const source of state.example.sources) {
      const card = node('article', 'card');
      const label = node('label', 'source-choice');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.id = `source-${source.id}`;
      checkbox.checked = state.selectedSources.includes(source.id);
      checkbox.disabled = state.phase === 'cancelled';
      checkbox.addEventListener('change', () => action(model.chooseSource(state, source.id, checkbox.checked), checkbox.id));
      label.append(checkbox, node('span', '', `Usa ${source.title}`));
      card.append(label, node('p', 'meta', `Data: ${source.date} · Versione: ${source.version}`),
        node('p', 'quote', `Testo originale: «${source.quote}»`));
      container.append(card);
    }
  }
  function renderMedicines() {
    const container = byId('medicines'); container.replaceChildren();
    for (const medicine of state.example.medicines) {
      const card = node('article', 'card');
      card.append(node('h3', '', medicine.name));
      const facts = node('dl');
      for (const [term, value] of [['Precedente', medicine.historical], ['Riferito ora', medicine.reported]]) {
        facts.append(node('dt', '', term), node('dd', '', value));
      }
      card.append(facts, node('p', 'state-text', medicine.status), node('p', '', medicine.detail));
      container.append(card);
    }
  }
  function renderDraft() {
    const form = byId('draft-form');
    for (const field of ['medicine', 'dose', 'unit', 'frequency', 'note']) {
      form.elements.namedItem(field).value = state.draft[field];
      form.elements.namedItem(field).disabled = state.phase === 'cancelled';
    }
    form.querySelector('button[type="submit"]').disabled = state.phase === 'cancelled';
    byId('check').disabled = state.phase === 'cancelled';
    byId('cancel').hidden = state.phase === 'cancelled';
    byId('undo').hidden = state.phase !== 'cancelled';
    byId('change-source').disabled = state.phase === 'cancelled';
    byId('acknowledge').hidden = !['stale', 'conflict'].includes(state.phase);
    renderStatus();
  }
  function renderStatus() {
    const status = byId('status');
    status.dataset.phase = state.phase;
    status.textContent = `Stato: ${state.phase === 'idle' ? 'da preparare' :
      state.phase === 'proposed' ? 'bozza proposta' : state.phase === 'stale' ? 'fonte non più attuale' :
        state.phase === 'conflict' ? 'conflitto' : state.phase === 'failed' ? 'preparazione non riuscita' : 'bozza annullata'}. ${state.message}`;
  }
  function render() {
    renderCases();
    byId('case-title').textContent = state.example.label;
    byId('draft-context').textContent = `Questa bozza riguarda: ${state.example.label}.`;
    byId('case-context').textContent = state.example.context;
    byId('case-question').textContent = state.example.question;
    byId('follow-up').textContent = `Da seguire: ${state.example.followUp}`;
    renderSources(); renderMedicines(); renderDraft();
  }
  const form = byId('draft-form');
  form.addEventListener('input', (event) => {
    const field = event.target.name;
    if (['medicine', 'dose', 'unit', 'frequency', 'note'].includes(field)) {
      state = model.edit(state, field, event.target.value);
      renderStatus();
    }
  });
  form.addEventListener('submit', (event) => { event.preventDefault(); action(model.prepare(state)); });
  byId('check').addEventListener('click', () => action(model.check(state)));
  byId('change-source').addEventListener('click', () => action(model.changeSource(state)));
  byId('acknowledge').addEventListener('click', () => action(model.acknowledgeUpdatedSource(state)));
  byId('cancel').addEventListener('click', () => action(model.cancel(state)));
  byId('undo').addEventListener('click', () => action(model.undoCancel(state)));
  render();
})();
