import assert from 'node:assert/strict';
import test from 'node:test';

import type { DossierInputFile } from '../../document-dossier-session';
import { syntheticTaxCode } from '../../patient-identity.test-support.ts';
import { fseDocumentClassification, parseFseFileName, readFseFolder } from './fse-folder';

const CF = syntheticTaxCode('fascicolo');
const OTHER = syntheticTaxCode('altro-fascicolo');

function file(relativePath: string): DossierInputFile {
    const name = relativePath.split('/').pop()!;
    return { name, size: 10, type: 'application/pdf', lastModified: 0, relativePath, read: async () => new Uint8Array() };
}

test('il nome dato dall’estensione porta data, categoria, descrizione e impronta', () => {
    assert.deepEqual(parseFseFileName('2026-03-26_LAB_REFERTO_SPECIALISTICO_LABORATORIO_ASST_SINTETICA_0a1b2c3d.pdf'), {
        date: '2026-03-26', category: 'LAB', description: 'REFERTO_SPECIALISTICO_LABORATORIO_ASST_SINTETICA', documentId: '0a1b2c3d', extension: 'pdf',
    });
    assert.equal(parseFseFileName('0000-00-00_PSS_Profilo_sanitario_ffffffff.xml')?.date, null);
});

test('i nomi malformati non si leggono come documenti del Fascicolo', () => {
    for (const name of [
        'referto.pdf',
        '2026-03-26_XYZ_Referto_0a1b2c3d.pdf',
        '2026-02-30_LAB_Referto_0a1b2c3d.pdf',
        '2026-13-01_LAB_Referto_0a1b2c3d.pdf',
        '2026-03-26_LAB_Referto_0a1b2c3.pdf',
        '2026-03-26_LAB__0a1b2c3d.pdf',
        '2026-03-26_LAB_Referto_0A1B2C3D.pdf',
        '2026-03-26_LAB_Referto_0a1b2c3d',
        '2026-03-26_lab_Referto_0a1b2c3d.pdf',
        '2026-03-26_LAB_Referto/../x_0a1b2c3d.pdf',
        '2026-03-26_LAB_Referto_0a1b2c3d.pdf.crdownload',
    ]) assert.equal(parseFseFileName(name), null, name);
});

test('la categoria del nome diventa la classe del documento', () => {
    const classOf = (name: string) => fseDocumentClassification(parseFseFileName(name)!);
    assert.equal(classOf('2026-01-02_LAB_Emocromo_Ente_00000001.pdf'), 'lab_report');
    assert.equal(classOf('2026-01-02_REF_Visita_cardiologica_Ente_00000002.pdf'), 'specialist_report');
    assert.equal(classOf('2026-01-02_REF_REFERTO_RADIOLOGIA_Ente_00000003.pdf'), 'imaging_report');
    assert.equal(classOf('2026-01-02_AMM_Esenzione_Ente_00000004.pdf'), 'administrative');
    assert.equal(classOf('2026-01-02_VAC_Certificato_vaccinale_00000005.pdf'), undefined);
});

test('la cartella del paziente giusto passa con categoria per ogni file', () => {
    const reading = readFseFolder([
        file(`FSE_${CF}/2026-03-26_LAB_Emocromo_Ente_0a1b2c3d.pdf`),
        file(`FSE_${CF}/.DS_Store`),
        file(`FSE_${CF}/appunti.pdf`),
    ], { taxCode: CF.toLowerCase() });
    assert.equal(reading.kind, 'ready');
    if (reading.kind !== 'ready') return;
    assert.equal(reading.taxCode, CF);
    assert.deepEqual(reading.files.map((item) => item.hints), [{ categoryLabel: 'Analisi di laboratorio', classification: 'lab_report' }]);
    assert.deepEqual(reading.malformed, ['appunti.pdf']);
});

test('una cartella di un altro codice fiscale si ferma prima di leggere i file', async () => {
    let reads = 0;
    const counted = { ...file(`FSE_${OTHER}/2026-03-26_LAB_Emocromo_Ente_0a1b2c3d.pdf`), read: async () => { reads += 1; return new Uint8Array(); } };
    assert.deepEqual(readFseFolder([counted], { taxCode: CF }), { kind: 'other_patient', folderTaxCode: OTHER });
    assert.equal(reads, 0);
});

test('cartelle non riconosciute, miste o con codice non valido non passano', () => {
    const name = '2026-03-26_LAB_Emocromo_Ente_0a1b2c3d.pdf';
    assert.equal(readFseFolder([file(`Download/${name}`)], null).kind, 'not_fse_folder');
    assert.equal(readFseFolder([file(name)], null).kind, 'not_fse_folder');
    assert.equal(readFseFolder([file(`FSE_${CF}/${name}`), file(`FSE_${OTHER}/${name}`)], null).kind, 'several_folders');
    assert.equal(readFseFolder([file(`FSE_${CF.slice(0, 15)}X/${name}`)], null).kind, 'invalid_tax_code');
    assert.equal(readFseFolder([file(`FSE_${CF}/${name}`)], { taxCode: '' }).kind, 'patient_without_tax_code');
    assert.deepEqual(readFseFolder([file(`FSE_${CF}/appunti.pdf`)], null), { kind: 'no_documents', malformed: ['appunti.pdf'] });
});

test('dalla Nuova scheda il codice della cartella viene dichiarato senza una scheda da confrontare', () => {
    const reading = readFseFolder([file(`Download/FSE_${CF}/2026-03-26_REF_Visita_Ente_0a1b2c3d.pdf`)], null);
    assert.equal(reading.kind, 'ready');
});
