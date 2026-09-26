/* @Codex — invented examples; no patient records. */
globalThis.MediFlowSyntheticCases = [
  {
    id: 'case-a', label: 'Paziente sintetico A', context: 'Visita di controllo territoriale · identità inventata per questa dimostrazione',
    question: 'Quale terapia risulta attuale dopo una dimissione e un racconto successivo?',
    followUp: 'Esito del controllo programmato: non documentato nelle fonti di esempio.',
    sources: [
      { id: 'a-discharge', title: 'Lettera di dimissione', date: '10 settembre 2026', version: '2', quote: 'Metoprololo 50 mg: una compressa al mattino. Ramipril 5 mg: una compressa al mattino.' },
      { id: 'a-diary', title: 'Nota di diario', date: '18 settembre 2026', version: '1', quote: 'Elenco terapie della dimissione riportato in scheda; verifica con la persona ancora da completare.' },
      { id: 'a-report', title: 'Terapie riferite dalla persona', date: '22 settembre 2026', version: '1', quote: 'Riferisce metoprololo 25 mg al mattino e alla sera. Non menziona ramipril.' },
    ],
    medicines: [
      { name: 'Metoprololo', historical: '50 mg · una volta al giorno · dimissione', reported: '25 mg · due volte al giorno · riferito', status: 'In conflitto', detail: 'Dose e frequenza non coincidono. Nessuna equivalenza o modifica viene dedotta.' },
      { name: 'Ramipril', historical: '5 mg · una volta al giorno · dimissione', reported: 'Non menzionato', status: 'Stato attuale ignoto', detail: 'L’assenza nel racconto non documenta una sospensione.' },
    ],
    draft: { medicine: 'Metoprololo', dose: '', unit: 'mg', frequency: '', note: '' },
  },
  {
    id: 'case-b', label: 'Paziente sintetico B', context: 'Revisione dopo documenti successivi · identità inventata per questa dimostrazione',
    question: 'Come confrontare una lista precedente con una dose riferita più recente?',
    followUp: 'Chiarimento della posologia: non documentato nelle fonti di esempio.',
    sources: [
      { id: 'b-list', title: 'Elenco terapie precedente', date: '2 agosto 2026', version: '3', quote: 'Amlodipina 5 mg: una compressa ogni mattina. Metformina 500 mg: una compressa mattino e sera.' },
      { id: 'b-letter', title: 'Lettera specialistica', date: '14 settembre 2026', version: '1', quote: 'Riferita amlodipina 10 mg al mattino. Verificare la confezione effettivamente usata.' },
      { id: 'b-report', title: 'Terapie riferite dalla persona', date: '21 settembre 2026', version: '1', quote: 'Riferisce una compressa di amlodipina al mattino; non ricorda il dosaggio. Non cita metformina.' },
    ],
    medicines: [
      { name: 'Amlodipina', historical: '5 mg · una volta al giorno · elenco precedente', reported: 'Una compressa al mattino · dose ignota · riferito', status: 'In conflitto', detail: 'La lettera cita 10 mg, il racconto non specifica la dose. Non si sceglie un dosaggio.' },
      { name: 'Metformina', historical: '500 mg · due volte al giorno · elenco precedente', reported: 'Non menzionata', status: 'Stato attuale ignoto', detail: 'L’assenza nel racconto non documenta una sospensione.' },
    ],
    draft: { medicine: 'Amlodipina', dose: '', unit: 'mg', frequency: '', note: '' },
  },
];
