export function extendedCardLoad() {
  const sourceRef = 'src_' + 'a'.repeat(32);
  return { profile: 'mediflow.synthetic-chat-card.v1', pseudonym: 'card_' + 'b'.repeat(32),
    history: Array.from({ length: 100 }, () => ({ condition: 'diabete mellito tipo 2', note: 'Contenuto sintetico di carico.', relativeTime: 'ultimi_6_mesi', sourceRef })),
    therapies: Array.from({ length: 30 }, () => ({ medicine: 'metformina', dose: '500 mg', frequency: 'al mattino', sourceRef })),
    measures: [], documents: Array.from({ length: 10 }, () => ({ sourceRef })) };
}
