import assert from 'node:assert/strict';
import test from 'node:test';

import type { DossierAcquireOutcome, DossierDraftGroup, DossierDraftSource } from './document-dossier-session';
import { dossierFolderDeletionAdvice, dossierFolderSettlement } from './dossier-folder-settlement';

function source(key: string, status: DossierDraftSource['status'] = 'ready', duplicateOf?: string): DossierDraftSource {
    return { key, status, ...(duplicateOf ? { duplicateOf } : {}) } as DossierDraftSource;
}
const group = (key: string, ...sources: DossierDraftSource[]): DossierDraftGroup => ({ key, sources, declaredTaxCode: 'X' });
const stored = (key: string, verified = true): DossierAcquireOutcome => ({ key, status: 'stored', attachmentId: `a-${key}`, verified });

test('il consiglio di cancellare compare solo con tutti i file della cartella al sicuro, in tutti i gruppi', () => {
    const groups = [group('cf:X', source('s1')), group('.', source('s2'))];
    const onlyPrepared = dossierFolderSettlement(groups, { s1: stored('s1') }, 0);
    assert.deepEqual(onlyPrepared, { safe: 1, total: 2 });
    assert.equal(dossierFolderDeletionAdvice(onlyPrepared), null);
    const both = dossierFolderSettlement(groups, { s1: stored('s1'), s2: stored('s2') }, 0);
    assert.equal(dossierFolderDeletionAdvice(both), 'Tutti i 2 file della cartella sono in MediFlow, riletti identici. Puoi cancellare la cartella dai Download.');
});

test('nel dubbio il consiglio non compare', () => {
    const groups = [group('.', source('s1'), source('s2', 'already_imported'))];
    const cases: Array<[string, Record<string, DossierAcquireOutcome>, number, DossierDraftGroup[]]> = [
        ['rilettura non verificata', { s1: stored('s1', false) }, 0, groups],
        ['rilettura diversa', { s1: { key: 's1', status: 'failed', reason: 'readback_mismatch' } }, 0, groups],
        ['saltato per identità', { s1: { key: 's1', status: 'skipped', reason: 'identity_unconfirmed' } }, 0, groups],
        ['non ancora salvato', {}, 0, groups],
        ['file fuori formato non letto', { s1: stored('s1') }, 1, groups],
        ['fonte esclusa', { s1: stored('s1') }, 0, [group('.', source('s1'), source('s2', 'excluded'))]],
        ['formato non ammesso', { s1: stored('s1') }, 0, [group('.', source('s1'), source('s2', 'unsupported_format'))]],
        ['copia di una fonte non salvata', {}, 0, [group('.', source('s1', 'excluded'), source('s2', 'duplicate_in_selection', 's1'))]],
        ['cartella vuota', {}, 0, []],
    ];
    for (const [name, outcomes, unread, folder] of cases) {
        assert.equal(dossierFolderDeletionAdvice(dossierFolderSettlement(folder, outcomes, unread)), null, name);
    }
});

test('già importati e copie di un originale salvato contano come al sicuro', () => {
    const settlement = dossierFolderSettlement([group('.', source('s1'), source('s2', 'already_imported'), source('s3', 'duplicate_in_selection', 's1'))], { s1: stored('s1') }, 0);
    assert.deepEqual(settlement, { safe: 3, total: 3 });
    assert.equal(dossierFolderDeletionAdvice({ safe: 1, total: 1 }), 'Il file della cartella è in MediFlow, riletto identico. Puoi cancellare la cartella dai Download.');
});
