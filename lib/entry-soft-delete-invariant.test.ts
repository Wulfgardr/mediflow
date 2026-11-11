import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEntryUpdate } from './entry-write-input.ts';

// Rischio #7 (censimento macchine a stati, 11/11): l'eliminazione logica di una
// voce di diario ha due campi, deletedAt e deletionReason. La DELETE esige un
// motivo non vuoto; la PUT (web, v1, rete) li accetta come campi indipendenti.
// Invariante: deletedAt valorizzato <=> deletionReason non vuoto.
for (const surface of ['web', 'v1', 'network'] as const) {
    test(`PUT ${surface}: eliminare una voce senza motivo è rifiutato come nella DELETE`, () => {
        const prepared = prepareEntryUpdate({ version: 1, deletedAt: '2026-11-01T10:00:00.000Z' }, surface);
        if (prepared.ok) {
            assert.equal(typeof prepared.values.deletionReason, 'string', `deletedAt senza motivo accettato: ${JSON.stringify(prepared.values)}`);
            assert.ok((prepared.values.deletionReason as string).trim().length > 0);
        }
    });

    test(`PUT ${surface}: ripristinare una voce azzera anche il motivo dell'eliminazione`, () => {
        const prepared = prepareEntryUpdate({ version: 2, deletedAt: null }, surface);
        assert.ok(prepared.ok, JSON.stringify(prepared));
        assert.equal(prepared.values.deletedAt, null);
        assert.equal(prepared.values.deletionReason, null, 'una voce attiva non conserva il motivo della vecchia eliminazione');
    });
}
