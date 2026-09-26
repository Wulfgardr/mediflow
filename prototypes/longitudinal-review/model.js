/* @Codex — browser and Node compatible, in-memory proposal state only. */
(function () {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  function create(example) {
    if (!example || !Array.isArray(example.sources) || !Array.isArray(example.medicines)) throw new Error('Caso sintetico non valido');
    return { example: copy(example), selectedSources: [], draft: copy(example.draft), phase: 'idle',
      message: 'Seleziona le fonti e prepara una bozza da esaminare.', sourceRevision: 1,
      reviewedRevision: 1, cancelledSnapshot: null };
  }
  function chooseSource(state, sourceId, checked) {
    if (!state.example.sources.some((source) => source.id === sourceId)) throw new Error('Fonte non presente');
    const next = copy(state);
    next.selectedSources = checked
      ? [...new Set([...next.selectedSources, sourceId])]
      : next.selectedSources.filter((id) => id !== sourceId);
    if (next.phase === 'proposed') {
      next.phase = 'idle';
      next.message = 'Fonti cambiate nella bozza: prepara di nuovo il confronto.';
    }
    return next;
  }
  function edit(state, field, value) {
    if (!['medicine', 'dose', 'unit', 'frequency', 'note'].includes(field) || typeof value !== 'string' || value.length > 300) throw new Error('Campo non valido');
    const next = copy(state);
    next.draft[field] = value;
    if (next.phase === 'cancelled') throw new Error('Ripristina prima la bozza annullata');
    if (next.phase === 'proposed') {
      next.phase = 'idle';
      next.message = 'Bozza modificata: prepara di nuovo il confronto.';
    }
    return next;
  }
  function prepare(state) {
    const next = copy(state);
    if (next.selectedSources.length === 0 || !next.draft.note.trim()) {
      next.phase = 'failed';
      next.message = 'Bozza non pronta: seleziona almeno una fonte e scrivi che cosa resta da chiarire. I dati inseriti sono conservati.';
      return next;
    }
    if (next.sourceRevision !== next.reviewedRevision) {
      next.phase = 'stale';
      next.message = 'Una fonte è cambiata. La bozza è conservata; rileggi le fonti prima di riprovare.';
      return next;
    }
    next.phase = 'proposed';
    next.message = 'Bozza pronta per il confronto. Nessuna terapia è stata modificata.';
    return next;
  }
  function changeSource(state) {
    const next = copy(state);
    const first = next.example.sources[0];
    first.version = `${Number(first.version) + 1}`;
    first.quote += ' [Aggiornamento simulato: verificare nuovamente questa fonte.]';
    next.sourceRevision += 1;
    next.phase = 'stale';
    next.message = 'La prima fonte ha una nuova versione simulata. La bozza resta disponibile, ma non è più verificata.';
    return next;
  }
  function check(state) {
    const next = copy(state);
    if (next.sourceRevision !== next.reviewedRevision) {
      next.phase = 'conflict';
      next.message = 'Conflitto: la fonte è cambiata dopo la revisione. La bozza e le fonti scelte restano disponibili. Rileggi la fonte aggiornata.';
      return next;
    }
    return prepare(next);
  }
  function acknowledgeUpdatedSource(state) {
    const next = copy(state);
    next.reviewedRevision = next.sourceRevision;
    next.phase = 'idle';
    next.message = 'Fonte aggiornata riletta. La bozza è conservata: prepara di nuovo il confronto.';
    return next;
  }
  function cancel(state) {
    if (state.phase === 'cancelled') return state;
    const next = copy(state);
    next.cancelledSnapshot = copy(state);
    next.phase = 'cancelled';
    next.message = 'Bozza annullata. Puoi ripristinarla finché resti su questo caso.';
    return next;
  }
  function undoCancel(state) {
    return state.phase === 'cancelled' && state.cancelledSnapshot
      ? { ...copy(state.cancelledSnapshot), cancelledSnapshot: null }
      : state;
  }
  globalThis.MediFlowReviewModel = { create, chooseSource, edit, prepare, changeSource, check, acknowledgeUpdatedSource, cancel, undoCancel };
})();
