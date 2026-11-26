import type { DossierInputFile } from '../../document-dossier-session';
import type { DocumentDecisionClassification } from '../../domain/documents/document-decision';
import { isValidItalianTaxCode } from '../../patient-identity';

export type FseCategory = 'LAB' | 'REF' | 'PSS' | 'VAC' | 'AMM';

export const FSE_CATEGORY_LABELS: Readonly<Record<FseCategory, string>> = {
    LAB: 'Analisi di laboratorio',
    REF: 'Referto clinico',
    PSS: 'Profilo sanitario sintetico',
    VAC: 'Vaccinazioni',
    AMM: 'Documento amministrativo',
};

export interface FseFileName {
    date: string | null;
    category: FseCategory;
    description: string;
    documentId: string;
    extension: string;
}

const FSE_FILE_NAME = /^(\d{4})-(\d{2})-(\d{2})_(LAB|REF|PSS|VAC|AMM)_([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)_([0-9a-f]{8})\.([a-z0-9]{1,5})$/u;
const FSE_FOLDER = /^FSE_([A-Z0-9]{16})$/u;
const UNDATED = '0000-00-00';
const IMAGING_DESCRIPTION = /RADIOLOG|IMMAGINI|ECOGRAF|TOMOGRAF|RISONANZA|MAMMOGRAF/iu;

function calendarDate(year: string, month: string, day: string): string | null {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    const iso = `${year}-${month}-${day}`;
    return Number(year) >= 1900 && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Nome dato dall'estensione FSE ai file scaricati: `AAAA-MM-GG_<CAT>_<Tipo>_<Ente>_<impronta>.<ext>`. */
export function parseFseFileName(name: string): FseFileName | null {
    const match = FSE_FILE_NAME.exec(name);
    if (!match) return null;
    const [, year, month, day, category, description, documentId, extension] = match;
    const undated = `${year}-${month}-${day}` === UNDATED;
    const date = undated ? null : calendarDate(year, month, day);
    if (!undated && !date) return null;
    return { date, category: category as FseCategory, description, documentId, extension };
}

export function fseDocumentClassification(name: FseFileName): DocumentDecisionClassification | undefined {
    switch (name.category) {
        case 'LAB': return 'lab_report';
        case 'REF': return IMAGING_DESCRIPTION.test(name.description) ? 'imaging_report' : 'specialist_report';
        case 'AMM': return 'administrative';
        default: return undefined;
    }
}

export type FseFolderReading =
    | { kind: 'ready'; taxCode: string; files: DossierInputFile[]; malformed: string[] }
    | { kind: 'not_fse_folder' }
    | { kind: 'several_folders' }
    | { kind: 'invalid_tax_code' }
    | { kind: 'patient_without_tax_code' }
    | { kind: 'other_patient'; folderTaxCode: string }
    | { kind: 'no_documents'; malformed: string[] };

function parentFolder(relativePath: string): string | null {
    const parts = relativePath.split('/').filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : null;
}

/**
 * Legge la cartella `FSE_<CF>` prima di qualsiasi lettura dei byte. `patient` è la scheda di
 * destinazione quando è già nota: un codice fiscale diverso ferma tutto qui.
 */
export function readFseFolder(files: readonly DossierInputFile[], patient: { taxCode: string | null | undefined } | null): FseFolderReading {
    const documents = files.filter((file) => !file.name.startsWith('.'));
    const folders = new Set(documents.map((file) => parentFolder(file.relativePath)));
    if (folders.size > 1) return { kind: 'several_folders' };
    const [folder] = [...folders];
    const folderMatch = folder ? FSE_FOLDER.exec(folder) : null;
    if (!folderMatch) return { kind: 'not_fse_folder' };
    const taxCode = folderMatch[1];
    if (!isValidItalianTaxCode(taxCode)) return { kind: 'invalid_tax_code' };
    if (patient) {
        const expected = (patient.taxCode ?? '').trim().toUpperCase();
        if (!expected) return { kind: 'patient_without_tax_code' };
        if (expected !== taxCode) return { kind: 'other_patient', folderTaxCode: taxCode };
    }
    const malformed: string[] = [];
    const accepted: DossierInputFile[] = [];
    for (const file of documents) {
        const name = parseFseFileName(file.name);
        if (!name) { malformed.push(file.name); continue; }
        accepted.push({ ...file, hints: { categoryLabel: FSE_CATEGORY_LABELS[name.category], classification: fseDocumentClassification(name) } });
    }
    if (!accepted.length) return { kind: 'no_documents', malformed };
    return { kind: 'ready', taxCode, files: accepted, malformed };
}

export function fseFolderMessage(reading: Exclude<FseFolderReading, { kind: 'ready' }>): string {
    switch (reading.kind) {
        case 'not_fse_folder': return 'Scegli la cartella FSE_ del paziente, nei Download.';
        case 'several_folders': return 'Scegli una sola cartella FSE_, quella del paziente.';
        case 'invalid_tax_code': return 'Il nome della cartella non contiene un codice fiscale valido.';
        case 'patient_without_tax_code': return 'La scheda non ha un codice fiscale: non si può confrontare con la cartella.';
        case 'other_patient': return 'La cartella è di un altro codice fiscale. Nessun documento letto.';
        case 'no_documents': return 'Nella cartella non ci sono documenti scaricati dal Fascicolo.';
    }
}
