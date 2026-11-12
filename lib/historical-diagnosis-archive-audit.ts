/*
 * Controllo delle diagnosi estratte salvate nei `documentInsights` storici di un archivio
 * MediFlow (WUL-831), in sola lettura.
 *
 * Protocollo: impronte SHA-256 dell'archivio (e di -wal/-shm se ci sono), copia in una
 * cartella temporanea privata, apertura della copia in sola lettura, decifratura con il segreto
 * dato dall'utente, controllo, cancellazione della copia, impronte di nuovo. L'originale non
 * si apre mai: si legge solo per copiarlo.
 *
 * Il segreto è quello che apre la chiave master dell'archivio, come nella schermata di sblocco:
 * il PIN se la chiave è avvolta in versione 1 o 2, la passphrase se è in versione 3 (ADR 0143).
 *
 * Il risultato restituito contiene solo conteggi e impronte. L'elenco nominativo va in un
 * file separato con permessi 600, che non sovrascrive mai un file esistente.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DocumentInsight } from './db';
import { decryptData, KDF_ITERATIONS, parseWrappedMasterKey, unwrapMasterKeyVersioned } from './security/security';
import { deriveUnlockMaterial, openUnlockWrapping, UNLOCK_KDF_VERSION } from './security/unlock-credential';
import {
    auditHistoricalDiagnoses,
    type HistoricalDiagnosisAuditRow,
    type HistoricalDiagnosisAuditTotals,
} from './domain/documents/historical-diagnosis-grounding';

/**
 * Il driver SQLite lo passa chi chiama (lo script CLI o il test): lib/ non importa driver di
 * database (guard di confine). Questa funzione decide comunque che cosa aprire e come: solo la
 * copia, solo in lettura.
 */
export interface ReadOnlySqlite {
    prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
    close(): void;
}
export type SqliteDriver = new (file: string, options: { readonly: true; fileMustExist: true }) => ReadOnlySqlite;

export interface ArchiveFingerprint { file: string; sha256: string; size: number; mtimeMs: number }

export interface HistoricalDiagnosisArchiveAuditResult {
    fingerprintsBefore: ArchiveFingerprint[];
    fingerprintsAfter: ArchiveFingerprint[];
    fingerprintsUnchanged: boolean;
    copyRemoved: boolean;
    patientsWithInsights: number;
    undecryptable: number;
    notAnArray: number;
    totals: HistoricalDiagnosisAuditTotals;
    privateOut: string;
}

const SIDE_FILES = ['', '-wal', '-shm'] as const;
const ENC = /^ENC:([A-Za-z0-9+/]+=*):([A-Za-z0-9+/]+=*)$/u;

function fingerprints(dbPath: string): ArchiveFingerprint[] {
    return SIDE_FILES.map((suffix) => `${dbPath}${suffix}`).filter((file) => fs.existsSync(file)).map((file) => {
        const stat = fs.statSync(file);
        const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        return { file, sha256, size: stat.size, mtimeMs: stat.mtimeMs };
    });
}

function sameFingerprints(left: readonly ArchiveFingerprint[], right: readonly ArchiveFingerprint[]): boolean {
    return left.length === right.length && left.every((item, index) => item.file === right[index].file && item.sha256 === right[index].sha256);
}

async function readInsights(stored: string, key: CryptoKey): Promise<unknown> {
    const sealed = ENC.exec(stored);
    if (!sealed) return JSON.parse(stored);
    const value = await decryptData(sealed[2], sealed[1], key);
    return typeof value === 'string' ? JSON.parse(value) : value;
}

/**
 * Apre la chiave master come la schermata di sblocco (components/security-provider.tsx):
 * versione 3 con la passphrase, versioni 1 e 2 con il PIN. Una versione sconosciuta si
 * dichiara tale, non come segreto sbagliato.
 */
async function openMasterKey(encryptedMasterKey: string, secret: string, salt: Uint8Array): Promise<CryptoKey> {
    const { version } = parseWrappedMasterKey(encryptedMasterKey);
    if (version === UNLOCK_KDF_VERSION) {
        try {
            return await openUnlockWrapping(encryptedMasterKey, (await deriveUnlockMaterial(secret, salt)).kek);
        } catch {
            throw new Error(`Passphrase non valida per questo archivio (chiave in versione ${version}: serve la passphrase).`);
        }
    }
    if (!(version in KDF_ITERATIONS)) throw new Error(`Versione di avvolgimento della chiave non supportata: ${version}.`);
    try {
        return await unwrapMasterKeyVersioned(encryptedMasterKey, secret, salt);
    } catch {
        throw new Error(`PIN non valido per questo archivio (chiave in versione ${version}: serve il PIN).`);
    }
}

function cell(value: string): string {
    return value.replace(/\s+/gu, ' ').replace(/\|/gu, '/').trim() || '-';
}

function privateList(rows: readonly HistoricalDiagnosisAuditRow[], names: ReadonlyMap<string, string>, totals: HistoricalDiagnosisAuditTotals): string {
    const section = (title: string, filter: (row: HistoricalDiagnosisAuditRow) => boolean) => {
        const selected = rows.filter(filter);
        const lines = [`## ${title} (${selected.length})`, ''];
        if (selected.length === 0) return [...lines, 'Nessuna.', ''].join('\n');
        lines.push('| Paziente | Id paziente | Documento | Sistema | Codice | Descrizione | Base |', '|---|---|---|---|---|---|---|');
        for (const row of selected) {
            lines.push(`| ${cell(names.get(row.patientId) ?? '')} | ${cell(row.patientId)} | ${cell(row.fileName)} | ${cell(row.system)} | ${cell(row.code)} | ${cell(row.description)} | ${cell(row.grounding.basis ?? '')} |`);
        }
        return [...lines, ''].join('\n');
    };
    return [
        '# WUL-831, elenco PRIVATO delle diagnosi storiche da rivedere',
        '',
        'Solo locale, permessi 600. Contiene dati clinici: non copiarlo in repository, PR, Linear o chat.',
        '',
        `Diagnosi controllate: ${totals.diagnoses}; con riscontro esplicito: ${totals.explicit}; parziale: ${totals.partial}; senza riscontro: ${totals.none}; documento senza testo: ${totals.noText}.`,
        '',
        section('Senza riscontro nel testo del documento', (row) => row.grounding.class === 'none'),
        section('Riscontro parziale', (row) => row.grounding.class === 'partial'),
        section('Documento senza testo', (row) => row.grounding.class === 'no_text'),
    ].join('\n');
}

export async function runHistoricalDiagnosisArchiveAudit(input: { dbPath: string; secret: string; privateOut: string; workParent?: string; driver: SqliteDriver }): Promise<HistoricalDiagnosisArchiveAuditResult> {
    const dbPath = path.resolve(input.dbPath);
    const privateOut = path.resolve(input.privateOut);
    if (fs.existsSync(privateOut)) throw new Error(`Il file privato esiste già, non lo sovrascrivo: ${privateOut}`);
    const fingerprintsBefore = fingerprints(dbPath);
    if (!fingerprintsBefore.some((item) => item.file === dbPath)) throw new Error(`Archivio non trovato: ${dbPath}`);

    const work = fs.mkdtempSync(path.join(input.workParent ?? os.tmpdir(), 'mediflow-diagnosi-storiche-'));
    fs.chmodSync(work, 0o700);
    let result: Omit<HistoricalDiagnosisArchiveAuditResult, 'fingerprintsAfter' | 'fingerprintsUnchanged' | 'copyRemoved'>;
    try {
        const copy = path.join(work, 'medical.db');
        for (const suffix of SIDE_FILES) {
            if (fs.existsSync(`${dbPath}${suffix}`)) fs.copyFileSync(`${dbPath}${suffix}`, `${copy}${suffix}`, fs.constants.COPYFILE_EXCL);
        }
        const db = new input.driver(copy, { readonly: true, fileMustExist: true });
        try {
            const user = db.prepare('select encrypted_master_key, salt from users order by created_at asc limit 1').get() as { encrypted_master_key?: string; salt?: string } | undefined;
            if (!user?.encrypted_master_key || !user.salt) throw new Error('Nessun utente con chiave nell\'archivio.');
            const key = await openMasterKey(user.encrypted_master_key, input.secret, new Uint8Array(Buffer.from(user.salt, 'base64')));
            const stored = db.prepare(`select id, first_name, last_name, document_insights from patients
                where document_insights is not null and document_insights not in ('', '[]', 'null') order by id`).all() as { id: string; first_name: string | null; last_name: string | null; document_insights: string }[];
            const names = new Map<string, string>();
            const patients: { patientId: string; insights: DocumentInsight[] }[] = [];
            let undecryptable = 0;
            let notAnArray = 0;
            for (const row of stored) {
                names.set(row.id, `${row.last_name ?? ''} ${row.first_name ?? ''}`.trim());
                let value: unknown;
                try { value = await readInsights(row.document_insights, key); } catch { value = null; }
                if (value === null || value === undefined) { undecryptable += 1; continue; }
                if (!Array.isArray(value)) { notAnArray += 1; continue; }
                patients.push({ patientId: row.id, insights: value.filter((item): item is DocumentInsight => Boolean(item) && typeof item === 'object') });
            }
            const audit = auditHistoricalDiagnoses(patients);
            fs.writeFileSync(privateOut, privateList(audit.rows, names, audit.totals), { mode: 0o600, flag: 'wx' });
            fs.chmodSync(privateOut, 0o600);
            result = { fingerprintsBefore, patientsWithInsights: stored.length, undecryptable, notAnArray, totals: audit.totals, privateOut };
        } finally {
            db.close();
        }
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
    const fingerprintsAfter = fingerprints(dbPath);
    return { ...result, fingerprintsAfter, fingerprintsUnchanged: sameFingerprints(fingerprintsBefore, fingerprintsAfter), copyRemoved: !fs.existsSync(work) };
}
