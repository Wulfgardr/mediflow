/**
 * Dossier da cartella (WUL-804, ADR 0175): acquisizione, rilettura, revisione e
 * applicazione, eseguite dal client Web che possiede la chiave.
 *
 * Confine: il modulo di dominio `lib/domain/documents/dossier-import.ts` produce solo
 * proposte. Qui si scrive, e soltanto attraverso le porte ordinarie della facade
 * cifrata (`lib/document-dossier-ports.ts`), dopo una conferma o decisione esplicita
 * del medico registrata nel record dossier. Nessuna chiamata a modelli, nessun SQL.
 *
 * Garanzie verificate dai test (`lib/document-dossier-session.test.ts`):
 * - l'originale si dichiara conservato solo dopo rilettura byte-identica dei byte CORRENTI,
 *   legata alla currentness host dell'allegato;
 * - la stessa fonte (sha256) non crea un secondo allegato, anche dopo un crash;
 * - ogni scrittura clinica ha un'autorizzazione (claim) persistita con CAS PRIMA dell'invio,
 *   ricontrollata sull'esatta revisione del fatto subito prima di ogni invio;
 * - la rilettura confronta tutti i campi clinici del payload; un 409 non vale mai come successo;
 * - sessione bloccata o contesto cambiato fermano l'operazione a ogni confine di scrittura;
 * - un'applicazione parziale resta dichiarata come tale e riprende senza duplicati.
 */

import {
    DOSSIER_FACT_TARGET, DOSSIER_SCHEMA_VERSION, classifyDossierSource, collectDossierTaxCodes,
    dossierFactBlockers, dossierFactFingerprint, dossierFactRef, dossierResidualSegments, evaluateDossierCoverage, evaluateDossierGroupIdentity,
    extractDossierCandidates, findExplicitDocumentDate, latestAppliedOutcome, preservationIsCurrent, readDossierRecord, reconcileDossierFacts,
    resolveDossierText, splitDossierUnits, writeDossierRecordIntoSnapshot,
    type DossierAppliedEntry, type DossierCoverage, type DossierCurrentRecords, type DossierExtraction, type DossierFact,
    type DossierFactAssessment, type DossierHostExtraction, type DossierIdentityEvaluation, type DossierRecord, type DossierResidualSegment,
    type DossierSourceClassification, type DossierTaxCodeEvidence, type DossierWriteClaim,
} from './domain/documents/dossier-import';
import { preparedBulkDecisions, preparedDossierFacts, preparedPatientKey, preparedPatientLabel, type PreparedExtraction, type PreparedPatient } from './domain/documents/dossier-prepared';
import { sameClinicalText, sameClinicalValue, sameDay, sameDosage, sameOptional, sameUnit } from './domain/documents/dossier-clinical-equality';

// ---------------------------------------------------------------------------
// Porte: la facade cifrata in produzione, un archivio sintetico nei test
// ---------------------------------------------------------------------------

export type DossierCurrentness = Readonly<{ sourceRef: string; revision: number; freshnessEpoch: number }>;

export interface DossierAttachmentMeta {
    id: string; patientId: string; name: string; size: number; type: string;
    parseEvidenceArtifactSnapshot?: string; currentness?: DossierCurrentness;
    /** Artefatto presente ma non decifrabile con la chiave corrente: blocca la deduplica. */
    artifactUnreadable?: boolean;
}

export interface DossierPatient { id: string; firstName: string; lastName: string; taxCode: string; birthDate?: string; version?: number;
    diagnoses: Array<{ code: string; description: string; system: string; date: string }>; exemptions: string[] }

export type DossierRecordTable = 'therapies' | 'observations' | 'entries' | 'service_prescriptions' | 'service_prescription_items' | 'prosthetic_prescriptions';

export class DossierWriteRejected extends Error {
    constructor(readonly status: number | null, message = 'Write rejected') { super(message); }
}
export class DossierVersionConflict extends Error { constructor() { super('Version conflict'); } }
export class DossierCollectionChanged extends Error { constructor() { super('Attachment collection changed'); } }

export interface DossierPorts {
    sessionSignal(): AbortSignal;
    extract(bytes: Uint8Array, signal: AbortSignal): Promise<DossierHostExtraction | { status: 'busy' }>;
    sha256(bytes: Uint8Array): Promise<string>;
    listPatients(signal: AbortSignal): Promise<DossierPatient[]>;
    getPatient(id: string, signal: AbortSignal): Promise<DossierPatient | undefined>;
    /** P-01 con versione attesa. Lancia DossierVersionConflict su 409 di versione. */
    updatePatientCodes(id: string, change: { version: number; diagnoses?: DossierPatient['diagnoses']; exemptions?: string[] }): Promise<void>;
    listAttachments(patientId: string, signal: AbortSignal): Promise<DossierAttachmentMeta[]>;
    /** Byte originali decifrati dell'allegato, o null se non leggibili. */
    readAttachmentBytes(id: string, patientId: string, signal: AbortSignal): Promise<Uint8Array | null>;
    /** D-04 con vista della collezione osservata. Lancia DossierCollectionChanged se è cambiata. */
    createAttachment(input: { id: string; patientId: string; name: string; type: string; size: number; bytes: Uint8Array;
        parseEvidenceArtifactSnapshot: string }, seen: readonly DossierAttachmentMeta[]): Promise<void>;
    /** D-02 con CAS della currentness. Lancia DossierVersionConflict se è cambiata. */
    updateArtifact(attachment: DossierAttachmentMeta, snapshot: string): Promise<void>;
    measureCreate(input: { name: string; type: string; bytes: Uint8Array; parseEvidenceArtifactSnapshot: string }): Promise<{ original: number; artifact: number; request: number }>;
    measureArtifact(snapshot: string): Promise<number>;
    /** Rilettura dalla lista del paziente: le route di creazione non espongono GET per id. */
    getRecord(table: DossierRecordTable, id: string, patientId: string, signal: AbortSignal): Promise<Record<string, unknown> | undefined>;
    createRecord(table: DossierRecordTable, record: Record<string, unknown>): Promise<void>;
    currentRecords(patientId: string, signal: AbortSignal): Promise<DossierCurrentRecords>;
    exemptionCodes(signal: AbortSignal): Promise<ReadonlySet<string>>;
    newId(): string;
    now(): Date;
    limits: { createRequestBytes: number; updateRequestBytes: number };
}

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

export interface DossierInputFile {
    name: string; size: number; type: string; relativePath: string; lastModified: number;
    read(): Promise<Uint8Array>;
}

export type DossierSourceStatus = 'ready' | 'duplicate_in_selection' | 'excluded' | 'unreadable';

export interface DossierDraftSource {
    key: string;
    group: string;
    relativePath: string;
    fileName: string;
    size: number;
    sha256: string;
    classification: DossierSourceClassification;
    extraction: DossierExtraction;
    text: string | null;
    taxCodes: DossierTaxCodeEvidence[];
    documentDate: DossierRecord['documentDate'];
    facts: DossierFact[];
    classificationResult: DossierRecord['classification'];
    status: DossierSourceStatus;
    duplicateOf?: string;
    file: DossierInputFile;
    /** Corrispondenza nell'estrazione preparata, per sha256 (ADR 0176). */
    prepared?: { patient: PreparedPatient | null; patientLabel: string; notes: string[]; facts: number };
}

export interface DossierDraftGroup { key: string; sources: DossierDraftSource[] }

export class DossierAbortedError extends Error { constructor() { super('Operazione interrotta: sessione bloccata o contesto cambiato.'); } }

function assertLive(signal: AbortSignal, isCurrent: () => boolean) {
    if (signal.aborted || !isCurrent()) throw new DossierAbortedError();
}

function groupKeyOf(relativePath: string): string {
    const parts = relativePath.split('/').filter(Boolean);
    // Primo livello sotto la cartella scelta. Un nome non decide mai il paziente.
    return parts.length > 2 ? parts[1] : '.';
}

async function extractWithRetry(ports: DossierPorts, bytes: Uint8Array, signal: AbortSignal): Promise<DossierHostExtraction> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const outcome = await ports.extract(bytes, signal);
        if (outcome.status !== 'busy') return outcome;
    }
    return { status: 'failed', detail: 'resource_limit' };
}

export async function buildDossierInventory(
    ports: DossierPorts, files: readonly DossierInputFile[],
    options: { signal: AbortSignal; isCurrent: () => boolean; onProgress?: (done: number, total: number) => void; prepared?: PreparedExtraction | null },
): Promise<DossierDraftGroup[]> {
    const { signal, isCurrent } = options;
    const preparedSources = new Map((options.prepared?.sources ?? []).map((source) => [source.sha256, source]));
    const exemptionCodes = await ports.exemptionCodes(signal);
    assertLive(signal, isCurrent);
    const sources: DossierDraftSource[] = [];
    const firstBySha = new Map<string, string>();
    for (const [index, file] of files.entries()) {
        assertLive(signal, isCurrent);
        const key = `s${index + 1}`;
        let bytes: Uint8Array;
        try { bytes = await file.read(); } catch {
            sources.push({ key, group: groupKeyOf(file.relativePath), relativePath: file.relativePath, fileName: file.name, size: file.size, sha256: '',
                classification: { kind: 'unknown', mediaType: file.type || 'application/octet-stream', extractable: false, reason: 'File non leggibile dal browser.' },
                extraction: { state: 'not_extracted', reason: 'unknown' }, text: null, taxCodes: [], documentDate: null, facts: [],
                classificationResult: 'unknown', status: 'unreadable', file });
            continue;
        }
        assertLive(signal, isCurrent);
        const sha256 = await ports.sha256(bytes);
        const classification = classifyDossierSource({ name: file.name, size: bytes.byteLength, declaredType: file.type, head: bytes.subarray(0, 16) });
        const duplicateOf = firstBySha.get(sha256);
        if (!duplicateOf) firstBySha.set(sha256, key);
        let extraction: DossierExtraction = { state: 'not_extracted', reason: classification.kind };
        let text: string | null = null;
        if (!duplicateOf && classification.extractable) {
            const host = await extractWithRetry(ports, bytes, signal);
            assertLive(signal, isCurrent);
            if (host.status === 'extracted' && host.markdown.trim()) {
                text = host.markdown;
                const pageCount = host.ocr?.pageCount ?? null;
                const { units, unitBasis } = splitDossierUnits(text, pageCount);
                extraction = { state: 'extracted', engine: host.ocr ? 'anydoc_ocr' : 'anydoc', pageCount, ocrPageCount: host.ocr?.ocrPageCount ?? 0,
                    unitBasis, units, text: { location: 'parse_bundle', sha256: await ports.sha256(new TextEncoder().encode(text)), chars: text.length } };
            } else {
                extraction = { state: 'failed', detail: host.status === 'failed' ? host.detail : 'empty_extraction' };
            }
        }
        bytes.fill(0);
        const date = text ? findExplicitDocumentDate(text, file.name) : findExplicitDocumentDate('', file.name);
        const candidates = text && extraction.state === 'extracted'
            ? extractDossierCandidates({ fileName: file.name, text, units: extraction.units, documentDate: date?.date ?? null, exemptionCodes })
            : { facts: [], classification: 'unknown' as const };
        const taxCodes = text ? collectDossierTaxCodes(text) : [];
        const match = duplicateOf ? undefined : preparedSources.get(sha256);
        let facts = candidates.facts;
        let prepared: DossierDraftSource['prepared'];
        let preparedDate: string | null = null;
        if (match) {
            const merged = preparedDossierFacts({ source: match, text, units: extraction.state === 'extracted' ? extraction.units : [],
                documentDate: date?.date ?? null, parserFacts: candidates.facts, now: ports.now() });
            facts = merged.facts;
            preparedDate = merged.documentDate;
            prepared = { patient: match.patient, patientLabel: preparedPatientLabel(match.patient), notes: merged.notes, facts: merged.facts.filter((fact) => fact.origin === 'prepared').length };
            // Il CF dell'estrazione raggruppa soltanto: il controllo d'identità resta sui codici letti da MediFlow.
        }
        const documentDate = date ? { value: date.date, source: date.source } : preparedDate ? { value: preparedDate, source: 'text' as const } : null;
        const group = (match && preparedPatientKey(match.patient)) || groupKeyOf(file.relativePath);
        sources.push({ key, group, relativePath: file.relativePath, fileName: file.name, size: file.size, sha256,
            classification, extraction, text, taxCodes, documentDate,
            facts, classificationResult: candidates.classification,
            status: duplicateOf ? 'duplicate_in_selection' : 'ready', ...(duplicateOf ? { duplicateOf } : {}), ...(prepared ? { prepared } : {}), file });
        options.onProgress?.(index + 1, files.length);
    }
    const groups = new Map<string, DossierDraftSource[]>();
    for (const source of sources) groups.set(source.group, [...(groups.get(source.group) ?? []), source]);
    return [...groups.entries()].map(([key, items]) => ({ key, sources: items }));
}

export function evaluateDraftGroupIdentity(group: DossierDraftGroup, patients: readonly DossierPatient[], linkedPatientId: string | null): DossierIdentityEvaluation {
    return evaluateDossierGroupIdentity(group.sources.filter((source) => source.status === 'ready'), patients, linkedPatientId);
}

// ---------------------------------------------------------------------------
// Confini di scrittura: la revoca resta revoca, mai un errore di rete
// ---------------------------------------------------------------------------

type Guard = () => void;

function guardOf(signal: AbortSignal, isCurrent: () => boolean): Guard { return () => assertLive(signal, isCurrent); }

/**
 * Ogni chiamata che può scrivere passa da qui: controllo prima dell'invio e dopo la
 * risposta. Se il contesto è stato ritirato durante l'attesa, l'errore originale non
 * viene trattato come esito incerto o fallimento: si propaga l'interruzione.
 */
async function boundary<T>(guard: Guard, operation: () => Promise<T>): Promise<T> {
    guard();
    let value: T;
    try { value = await operation(); } catch (error) { guard(); throw error; }
    guard();
    return value;
}

// ---------------------------------------------------------------------------
// Acquisizione degli originali
// ---------------------------------------------------------------------------

export type DossierAcquireOutcome =
    | { key: string; status: 'stored' | 'reused'; attachmentId: string; verified: boolean; measured?: { original: number; artifact: number } }
    | { key: string; status: 'skipped'; reason: 'duplicate_in_selection' | 'excluded' | 'unreadable' }
    | { key: string; status: 'failed'; reason: 'source_changed' | 'too_large' | 'readback_mismatch' | 'write_failed' | 'artifact_conflict'; attachmentId?: string };

function dataEqual(left: Uint8Array, right: Uint8Array): boolean {
    return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function recordsBySha(attachments: readonly DossierAttachmentMeta[]): Map<string, DossierAttachmentMeta> {
    const map = new Map<string, DossierAttachmentMeta>();
    for (const attachment of attachments) {
        const read = readDossierRecord(attachment.parseEvidenceArtifactSnapshot);
        if (read.status === 'present') map.set(read.record.source.sha256, attachment);
    }
    return map;
}

/**
 * Acquisisce le fonti di un gruppo sul paziente confermato. Richiede che la
 * valutazione d'identità, ricalcolata qui sui dati correnti, non sia bloccante.
 */
export async function acquireDossierGroup(
    ports: DossierPorts,
    input: { group: DossierDraftGroup; patientId: string; confirmed: boolean; signal: AbortSignal; isCurrent: () => boolean;
        onProgress?: (outcome: DossierAcquireOutcome) => void },
): Promise<DossierAcquireOutcome[]> {
    const { group, patientId, signal, isCurrent } = input;
    const guard = guardOf(signal, isCurrent);
    if (!input.confirmed) throw new Error('Collegamento non confermato dal medico.');
    const patients = await ports.listPatients(signal);
    guard();
    const identity = evaluateDraftGroupIdentity(group, patients, patientId);
    if (identity.blocking || !patients.some((patient) => patient.id === patientId)) throw new DossierIdentityBlocked(identity);
    const confirmedAt = ports.now().toISOString();
    const outcomes: DossierAcquireOutcome[] = [];
    for (const source of group.sources) {
        guard();
        const outcome: DossierAcquireOutcome = source.status !== 'ready'
            ? { key: source.key, status: 'skipped', reason: source.status === 'duplicate_in_selection' ? 'duplicate_in_selection' : source.status }
            : await acquireOne(ports, source, patientId, identity, confirmedAt, signal, guard);
        outcomes.push(outcome);
        input.onProgress?.(outcome);
    }
    return outcomes;
}

export class DossierIdentityBlocked extends Error {
    constructor(readonly identity: DossierIdentityEvaluation) { super(identity.message); }
}

function initialRecord(source: DossierDraftSource, ports: DossierPorts, identity: DossierIdentityEvaluation, confirmedAt: string, reusedExisting: boolean): DossierRecord {
    return {
        schemaVersion: DOSSIER_SCHEMA_VERSION,
        importId: ports.newId(),
        source: { sha256: source.sha256, byteLength: source.size, mediaType: source.classification.mediaType, kind: source.classification.kind,
            relativePath: source.relativePath, fileName: source.fileName },
        preservation: { state: 'pending_readback', reusedExisting },
        extraction: source.extraction,
        extractionAttempts: source.classification.extractable
            ? [{ at: confirmedAt, outcome: source.extraction.state === 'extracted' ? 'extracted' : 'failed',
                ...(source.extraction.state === 'failed' ? { detail: source.extraction.detail } : {}) }] : [],
        identity: { taxCodes: source.taxCodes, status: identity.status, confirmedAt },
        documentDate: source.documentDate,
        classification: source.classificationResult,
        facts: source.facts,
        residualReview: { state: 'pending' },
        applied: [],
        pendingWrites: [],
        updatedAt: confirmedAt,
    };
}

async function acquireOne(
    ports: DossierPorts, source: DossierDraftSource, patientId: string, identity: DossierIdentityEvaluation, confirmedAt: string,
    signal: AbortSignal, guard: Guard,
): Promise<DossierAcquireOutcome> {
    let bytes: Uint8Array;
    try { bytes = await source.file.read(); } catch { return { key: source.key, status: 'failed', reason: 'source_changed' }; }
    try {
        guard();
        // La fonte su disco deve essere quella inventariata e mostrata al medico.
        if (await ports.sha256(bytes) !== source.sha256) return { key: source.key, status: 'failed', reason: 'source_changed' };
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const seen = await ports.listAttachments(patientId, signal);
            guard();
            // Senza leggere tutti gli artefatti non si può escludere un duplicato.
            if (seen.some((item) => item.artifactUnreadable)) return { key: source.key, status: 'failed', reason: 'artifact_conflict' };
            const existing = recordsBySha(seen).get(source.sha256);
            if (existing) return await verifyReadback(ports, existing, bytes, source.key, 'reused', signal, guard, preparedMergeFor(existing, source));
            // Un allegato già in app senza record dossier: stessa dimensione, poi confronto dei byte.
            for (const candidate of seen.filter((item) => item.size === bytes.byteLength && readDossierRecord(item.parseEvidenceArtifactSnapshot).status === 'absent')) {
                const stored = await ports.readAttachmentBytes(candidate.id, patientId, signal);
                guard();
                const same = Boolean(stored && dataEqual(stored, bytes));
                stored?.fill(0);
                if (!same) continue;
                const record = initialRecord(source, ports, identity, confirmedAt, true);
                let snapshot: string;
                try {
                    snapshot = writeDossierRecordIntoSnapshot(candidate.parseEvidenceArtifactSnapshot, withInlineText(record, source.text),
                        { attachmentId: candidate.id, fileName: source.fileName, text: source.text });
                } catch { return { key: source.key, status: 'failed', reason: 'artifact_conflict', attachmentId: candidate.id }; }
                if (await ports.measureArtifact(snapshot) > ports.limits.updateRequestBytes) return { key: source.key, status: 'failed', reason: 'too_large', attachmentId: candidate.id };
                try { await boundary(guard, () => ports.updateArtifact(candidate, snapshot)); }
                catch (error) {
                    if (error instanceof DossierAbortedError) throw error;
                    if (error instanceof DossierVersionConflict) break;
                    return { key: source.key, status: 'failed', reason: 'write_failed', attachmentId: candidate.id };
                }
                const reread = (await ports.listAttachments(patientId, signal)).find((item) => item.id === candidate.id);
                guard();
                if (!reread) return { key: source.key, status: 'failed', reason: 'write_failed', attachmentId: candidate.id };
                return await verifyReadback(ports, reread, bytes, source.key, 'reused', signal, guard);
            }
            if (attempt > 0 && recordsBySha(seen).size === 0 && seen.some((item) => item.size === bytes.byteLength)) continue;
            const id = ports.newId();
            const record = initialRecord(source, ports, identity, confirmedAt, false);
            const base = { id, patientId, name: source.fileName, type: source.classification.mediaType, size: bytes.byteLength, bytes };
            const probe = await ports.measureCreate({ ...base, parseEvidenceArtifactSnapshot: writeDossierRecordIntoSnapshot(undefined, record, { attachmentId: id, fileName: source.fileName, text: source.text }) });
            // La misura dell'originale cifrato resta nel record: lo spazio si attribuisce alla fonte e al paziente.
            const measuredRecord: DossierRecord = { ...record, storage: { originalCiphertextChars: probe.original, measuredAt: ports.now().toISOString() } };
            const create = { ...base, parseEvidenceArtifactSnapshot: writeDossierRecordIntoSnapshot(undefined, measuredRecord, { attachmentId: id, fileName: source.fileName, text: source.text }) };
            const measured = await ports.measureCreate(create);
            if (measured.request > ports.limits.createRequestBytes || measured.artifact > ports.limits.updateRequestBytes) {
                return { key: source.key, status: 'failed', reason: 'too_large' };
            }
            try {
                await boundary(guard, () => ports.createAttachment(create, seen));
            } catch (error) {
                if (error instanceof DossierAbortedError) throw error;
                if (error instanceof DossierCollectionChanged) continue;
                // Esito incerto: si rilegge per sha256, mai per nome.
                const after = recordsBySha(await ports.listAttachments(patientId, signal)).get(source.sha256);
                guard();
                if (!after) return { key: source.key, status: 'failed', reason: 'write_failed' };
                const verified = await verifyReadback(ports, after, bytes, source.key, 'stored', signal, guard);
                return verified.status === 'stored' ? { ...verified, measured: { original: measured.original, artifact: measured.artifact } } : verified;
            }
            const created = (await ports.listAttachments(patientId, signal)).find((item) => item.id === id);
            guard();
            if (!created) return { key: source.key, status: 'failed', reason: 'write_failed', attachmentId: id };
            const verified = await verifyReadback(ports, created, bytes, source.key, 'stored', signal, guard);
            return verified.status === 'stored' ? { ...verified, measured: { original: measured.original, artifact: measured.artifact } } : verified;
        }
        return { key: source.key, status: 'failed', reason: 'write_failed' };
    } finally { bytes.fill(0); }
}

/**
 * Proposte preparate da aggiungere a un dossier già acquisito: solo se il testo conservato è lo
 * stesso su cui le citazioni sono state verificate, altrimenti gli offset non varrebbero.
 */
function preparedMergeFor(existing: DossierAttachmentMeta, source: DossierDraftSource): DossierFact[] {
    const read = readDossierRecord(existing.parseEvidenceArtifactSnapshot);
    if (read.status !== 'present' || read.record.extraction.state !== 'extracted' || source.extraction.state !== 'extracted') return [];
    if (read.record.extraction.text.sha256 !== source.extraction.text.sha256) return [];
    return source.facts.filter((fact) => fact.origin === 'prepared');
}

function withInlineText(record: DossierRecord, text: string | null): DossierRecord {
    if (record.extraction.state !== 'extracted' || text === null) return record;
    return { ...record, extraction: { ...record.extraction, text: { ...record.extraction.text, location: 'inline', inline: text } } };
}

/**
 * Confronta SEMPRE i byte correnti dell'allegato con la fonte, anche se un'attestazione
 * precedente esiste, e la riscrive legata alla currentness host osservata.
 */
async function verifyReadback(
    ports: DossierPorts, attachment: DossierAttachmentMeta, bytes: Uint8Array, key: string, status: 'stored' | 'reused',
    signal: AbortSignal, guard: Guard, mergeFacts: readonly DossierFact[] = [],
): Promise<DossierAcquireOutcome> {
    const read = readDossierRecord(attachment.parseEvidenceArtifactSnapshot);
    if (read.status !== 'present') return { key, status: 'failed', reason: 'artifact_conflict', attachmentId: attachment.id };
    const stored = await ports.readAttachmentBytes(attachment.id, attachment.patientId, signal);
    guard();
    const same = Boolean(stored && dataEqual(stored, bytes));
    stored?.fill(0);
    const now = ports.now().toISOString();
    // Un dossier già acquisito riceve le nuove proposte preparate da decidere; quelle note restano come sono.
    const known = new Set(read.record.facts.map((fact) => fact.factId));
    let added = same ? mergeFacts.filter((fact) => !known.has(fact.factId)) : [];
    if (added.length) {
        // Un'aggiunta che porterebbe l'artefatto oltre il limite non si fa: il dossier resta com'era.
        const probe = writeDossierRecordIntoSnapshot(attachment.parseEvidenceArtifactSnapshot, { ...read.record, facts: [...read.record.facts, ...added] },
            { attachmentId: attachment.id, fileName: read.record.source.fileName, text: null });
        if (await ports.measureArtifact(probe) > ports.limits.updateRequestBytes) added = [];
    }
    const record: DossierRecord = { ...read.record, updatedAt: now, ...(added.length ? { facts: [...read.record.facts, ...added] } : {}), preservation: same
        ? { reusedExisting: read.record.preservation.reusedExisting, state: 'verified', verifiedAt: now, ...(attachment.currentness ? { verifiedSourceRef: attachment.currentness.sourceRef } : {}) }
        : { reusedExisting: read.record.preservation.reusedExisting, state: 'mismatch' } };
    try {
        await boundary(guard, () => ports.updateArtifact(attachment, writeDossierRecordIntoSnapshot(attachment.parseEvidenceArtifactSnapshot, record,
            { attachmentId: attachment.id, fileName: record.source.fileName, text: null })));
    } catch (error) {
        if (error instanceof DossierAbortedError) throw error;
        return { key, status: 'failed', reason: same ? 'write_failed' : 'readback_mismatch', attachmentId: attachment.id };
    }
    return same ? { key, status, attachmentId: attachment.id, verified: true } : { key, status: 'failed', reason: 'readback_mismatch', attachmentId: attachment.id };
}

// ---------------------------------------------------------------------------
// Dossier del paziente: lettura dal sistema, non dalla memoria della pagina
// ---------------------------------------------------------------------------

export interface DossierDocumentView {
    attachment: DossierAttachmentMeta;
    record: DossierRecord;
    text: string | null;
    textVerified: boolean;
    preservationCurrent: boolean;
    coverage: DossierCoverage;
    residual: DossierResidualSegment[];
    /** Byte cifrati dell'artefatto misurati alla lettura; null se non misurabile. */
    artifactCiphertextChars: number | null;
}

export interface DossierPatientView {
    patient: DossierPatient;
    documents: DossierDocumentView[];
    invalidDocuments: number;
    assessments: Map<string, DossierFactAssessment>;
    current: DossierCurrentRecords;
    exemptionCodes: ReadonlySet<string>;
}

export async function loadPatientDossier(ports: DossierPorts, patientId: string, signal: AbortSignal): Promise<DossierPatientView | null> {
    const patient = await ports.getPatient(patientId, signal);
    if (!patient || signal.aborted) return null;
    const [attachments, current, exemptionCodes] = await Promise.all([
        ports.listAttachments(patientId, signal), ports.currentRecords(patientId, signal), ports.exemptionCodes(signal),
    ]);
    const documents: DossierDocumentView[] = [];
    let invalidDocuments = 0;
    for (const attachment of attachments) {
        if (attachment.patientId !== patientId) continue;
        const read = readDossierRecord(attachment.parseEvidenceArtifactSnapshot);
        if (read.status === 'invalid') { invalidDocuments += 1; continue; }
        if (read.status !== 'present') continue;
        const text = resolveDossierText(attachment.parseEvidenceArtifactSnapshot!, read.record);
        const textVerified = read.record.extraction.state === 'extracted' && text !== null
            && await ports.sha256(new TextEncoder().encode(text)) === read.record.extraction.text.sha256;
        let artifactCiphertextChars: number | null = null;
        try { artifactCiphertextChars = await ports.measureArtifact(attachment.parseEvidenceArtifactSnapshot!); } catch { artifactCiphertextChars = null; }
        const identity = evaluateDossierGroupIdentity([read.record.identity], [patient], patientId);
        const coverageRecord = { ...read.record, identity: { ...read.record.identity, status: identity.status } };
        documents.push({ attachment, record: read.record, text, textVerified,
            preservationCurrent: preservationIsCurrent(read.record, attachment.currentness?.sourceRef),
            coverage: evaluateDossierCoverage(coverageRecord, textVerified, attachment.currentness?.sourceRef ?? ''),
            residual: textVerified && text !== null && read.record.extraction.state === 'extracted' ? dossierResidualSegments(text, read.record.extraction.units, read.record.facts) : [],
            artifactCiphertextChars });
    }
    documents.sort((a, b) => (a.record.documentDate?.value ?? '9999').localeCompare(b.record.documentDate?.value ?? '9999') || a.attachment.id.localeCompare(b.attachment.id));
    const assessments = reconcileDossierFacts(documents.map((document) => ({ documentKey: document.attachment.id,
        documentDate: document.record.documentDate?.value ?? null, facts: document.record.facts })), current);
    return { patient, documents, invalidDocuments, assessments, current, exemptionCodes };
}

// ---------------------------------------------------------------------------
// Revisione: CAS sulla revisione mostrata al medico
// ---------------------------------------------------------------------------

export class DossierStaleError extends Error { constructor() { super('Il documento è cambiato: rileggi il dossier prima di continuare.'); } }
export class DossierArtifactTooLarge extends Error { constructor() { super('Artefatto oltre il limite di aggiornamento.'); } }
export class DossierWriteInFlight extends Error { constructor() { super('Una scrittura di questo fatto è in corso o ha esito da verificare: riprendi l’applicazione prima di modificarlo.'); } }

function sameCurrentness(left?: DossierCurrentness, right?: DossierCurrentness): boolean {
    return Boolean(left && right && left.sourceRef === right.sourceRef && left.revision === right.revision && left.freshnessEpoch === right.freshnessEpoch);
}

async function rereadDocument(ports: DossierPorts, patientId: string, attachmentId: string, signal: AbortSignal) {
    const attachment = (await ports.listAttachments(patientId, signal)).find((item) => item.id === attachmentId && item.patientId === patientId);
    const read = attachment ? readDossierRecord(attachment.parseEvidenceArtifactSnapshot) : null;
    return attachment && read?.status === 'present' ? { attachment, record: read.record } : null;
}

async function persistRecord(ports: DossierPorts, attachment: DossierAttachmentMeta, record: DossierRecord, guard: Guard): Promise<void> {
    const snapshot = writeDossierRecordIntoSnapshot(attachment.parseEvidenceArtifactSnapshot, record,
        { attachmentId: attachment.id, fileName: record.source.fileName, text: null });
    if (await ports.measureArtifact(snapshot) > ports.limits.updateRequestBytes) throw new DossierArtifactTooLarge();
    await boundary(guard, () => ports.updateArtifact(attachment, snapshot));
}

/** Salva decisioni o correzioni del medico sulla revisione che stava guardando. */
export async function saveDossierReview(
    ports: DossierPorts,
    input: { patientId: string; attachmentId: string; expected: DossierCurrentness; signal: AbortSignal; isCurrent: () => boolean;
        change: (record: DossierRecord) => DossierRecord },
): Promise<void> {
    const guard = guardOf(input.signal, input.isCurrent);
    const current = await rereadDocument(ports, input.patientId, input.attachmentId, input.signal);
    guard();
    if (!current || !sameCurrentness(current.attachment.currentness, input.expected)) throw new DossierStaleError();
    const next = input.change(current.record);
    // Registro, autorizzazioni e provenienza appartengono all'applicazione, mai alla revisione.
    if (JSON.stringify(next.applied) !== JSON.stringify(current.record.applied)
        || JSON.stringify(next.pendingWrites ?? []) !== JSON.stringify(current.record.pendingWrites ?? [])
        || next.importId !== current.record.importId || next.source.sha256 !== current.record.source.sha256
        || JSON.stringify(next.preservation) !== JSON.stringify(current.record.preservation)) throw new Error('La revisione non può modificare provenienza o registro.');
    for (const fact of next.facts) {
        const before = current.record.facts.find((item) => item.factId === fact.factId);
        if (!before || JSON.stringify(before) === JSON.stringify(fact)) continue;
        if (current.record.pendingWrites?.some((claim) => claim.factId === fact.factId)) throw new DossierWriteInFlight();
        const applied = latestAppliedOutcome(current.record, fact.factId);
        if (applied && (applied.outcome === 'applied' || applied.outcome === 'already_present')) {
            throw new Error('Un fatto già scritto non si modifica dal dossier: correggilo nella scheda.');
        }
    }
    for (const before of current.record.facts) {
        if (!next.facts.some((fact) => fact.factId === before.factId)) throw new Error('Un fatto non si elimina dal dossier: rifiutalo.');
    }
    try { await persistRecord(ports, current.attachment, { ...next, updatedAt: ports.now().toISOString() }, guard); }
    catch (error) { if (error instanceof DossierVersionConflict) throw new DossierStaleError(); throw error; }
}

// ---------------------------------------------------------------------------
// Riprova dell'estrazione locale dall'originale conservato
// ---------------------------------------------------------------------------

export type DossierRetryOutcome = 'extracted' | 'failed' | 'stale' | 'not_retryable' | 'source_changed';

/**
 * Rilegge l'originale conservato (byte decifrati, sha256 uguale alla fonte) e ripete
 * l'estrazione locale. Il nuovo testo entra inline; i fatti già presenti, decisi o no,
 * restano intatti; le nuove proposte si aggiungono da decidere; il residuo torna da rivedere.
 */
export async function retryDossierExtraction(
    ports: DossierPorts,
    input: { patientId: string; attachmentId: string; expected: DossierCurrentness; signal: AbortSignal; isCurrent: () => boolean },
): Promise<DossierRetryOutcome> {
    const guard = guardOf(input.signal, input.isCurrent);
    const current = await rereadDocument(ports, input.patientId, input.attachmentId, input.signal);
    guard();
    if (!current || !sameCurrentness(current.attachment.currentness, input.expected)) return 'stale';
    const record = current.record;
    if (record.extraction.state === 'extracted' || (record.extraction.state === 'not_extracted' && !['pdf', 'image', 'office', 'text'].includes(record.source.kind))) return 'not_retryable';
    const bytes = await ports.readAttachmentBytes(current.attachment.id, input.patientId, input.signal);
    guard();
    if (!bytes) return 'source_changed';
    let host: DossierHostExtraction;
    try {
        if (await ports.sha256(bytes) !== record.source.sha256) return 'source_changed';
        host = await extractWithRetry(ports, bytes, input.signal);
        guard();
    } finally { bytes.fill(0); }
    const at = ports.now().toISOString();
    const text = host.status === 'extracted' && host.markdown.trim() ? host.markdown : null;
    let next: DossierRecord;
    if (!text) {
        next = { ...record, updatedAt: at, extractionAttempts: [...(record.extractionAttempts ?? []),
            { at, outcome: 'failed', detail: host.status === 'failed' ? host.detail : 'empty_extraction' }] };
    } else {
        const pageCount = host.status === 'extracted' ? host.ocr?.pageCount ?? null : null;
        const { units, unitBasis } = splitDossierUnits(text, pageCount);
        const extraction: DossierExtraction = { state: 'extracted', engine: host.status === 'extracted' && host.ocr ? 'anydoc_ocr' : 'anydoc', pageCount,
            ocrPageCount: host.status === 'extracted' ? host.ocr?.ocrPageCount ?? 0 : 0, unitBasis, units,
            text: { location: 'inline', inline: text, sha256: await ports.sha256(new TextEncoder().encode(text)), chars: text.length } };
        const exemptionCodes = await ports.exemptionCodes(input.signal);
        guard();
        const date = record.documentDate ?? (() => { const found = findExplicitDocumentDate(text, record.source.fileName); return found ? { value: found.date, source: found.source } : null; })();
        const proposed = extractDossierCandidates({ fileName: record.source.fileName, text, units, documentDate: date?.value ?? null, exemptionCodes });
        const patient = await ports.getPatient(input.patientId, input.signal);
        guard();
        if (!patient) return 'stale';
        const taxCodes = collectDossierTaxCodes(text);
        const identity = evaluateDossierGroupIdentity([{ taxCodes }], [patient], input.patientId);
        const known = new Set(record.facts.map((fact) => fact.factId));
        next = { ...record, updatedAt: at, extraction, documentDate: date,
            identity: { ...record.identity, taxCodes, status: identity.status },
            classification: proposed.classification,
            facts: [...record.facts, ...proposed.facts.filter((fact) => !known.has(fact.factId))],
            residualReview: { state: 'pending' },
            extractionAttempts: [...(record.extractionAttempts ?? []), { at, outcome: 'extracted' }] };
    }
    try { await persistRecord(ports, current.attachment, next, guard); }
    catch (error) { if (error instanceof DossierVersionConflict) return 'stale'; throw error; }
    return text ? 'extracted' : 'failed';
}

// ---------------------------------------------------------------------------
// Applicazione attraverso i writer ordinari
// ---------------------------------------------------------------------------

export interface DossierApplyResult {
    attachmentId: string;
    outcomes: DossierAppliedEntry[];
    stopped: null | 'stale' | 'identity' | 'registry' | 'aborted';
    partial: boolean;
}

const dateIso = (value: string) => new Date(`${value}T00:00:00.000Z`).toISOString();

function documentRefs(attachmentId: string, fact: DossierFact): string {
    return JSON.stringify([{ attachmentId, factId: fact.factId, ...(fact.evidence ? { unit: fact.evidence.unit } : {}) }]);
}

function entryType(kind: DossierFact['kind']): 'exam' | 'note' | 'visit' {
    return kind === 'imaging_report' || kind === 'document_entry' ? 'exam' : kind === 'assessment' ? 'visit' : 'note';
}

export function entryFactRef(metadata: unknown): string | undefined {
    let value = metadata;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return undefined; } }
    const dossier = value && typeof value === 'object' ? (value as { dossier?: unknown }).dossier : undefined;
    const ref = dossier && typeof dossier === 'object' ? (dossier as { factRef?: unknown }).factRef : undefined;
    return typeof ref === 'string' ? ref : undefined;
}

type FieldRule = 'text' | 'value' | 'unit' | 'day' | 'exact' | 'dosage' | 'factRef' | 'list';

/**
 * Confronta il record riletto con il payload inviato su TUTTI i campi clinici. Un campo
 * opzionale non inviato deve tornare vuoto; un record cancellato non è un esito valido.
 */
function payloadMatcher(rules: Record<string, FieldRule>, expected: Record<string, unknown>): (stored: Record<string, unknown>) => boolean {
    return (stored) => {
        if (stored.deletedAt) return false;
        return Object.entries(rules).every(([field, rule]) => {
            const want = expected[field]; const got = stored[field];
            switch (rule) {
                case 'text': return sameClinicalText(want as string, got as string);
                case 'value': return sameClinicalValue(want as string, got as string);
                case 'unit': return sameUnit(want as string, got as string);
                case 'day': return sameDay(want, got);
                case 'dosage': return sameDosage(want as string, got as string);
                case 'factRef': return entryFactRef(got) === entryFactRef(want);
                case 'list': return JSON.stringify(Array.isArray(got) ? got : []) === JSON.stringify(Array.isArray(want) ? want : []);
                default: return sameOptional(want, got);
            }
        });
    };
}

interface RecordSpec { table: DossierRecordTable; record: Record<string, unknown>; matches: (stored: Record<string, unknown>) => boolean }

function recordFor(fact: DossierFact, patientId: string, attachmentId: string, now: Date, documentText: string | null): RecordSpec | null {
    const v = fact.values; const id = fact.recordId!;
    const base = { id, patientId };
    switch (fact.kind) {
        case 'therapy': {
            const record = { ...base, drugName: v.drugName.trim(), activePrinciple: v.activePrinciple?.trim() || null, dosage: v.dosage.trim(), status: v.status, startDate: dateIso(v.startDate),
                endDate: v.endDate ? dateIso(v.endDate) : null, motivation: `Da documento ${fact.evidence ? `(unità ${fact.evidence.unit})` : ''}`.trim(), createdAt: now };
            return { table: 'therapies', record, matches: payloadMatcher({ patientId: 'exact', drugName: 'text', activePrinciple: 'text', dosage: 'dosage', status: 'exact', startDate: 'day', endDate: 'day', motivation: 'text' }, record) };
        }
        case 'observation': {
            const record = { ...base, codeSystem: 'LOINC', code: v.code.trim(), display: v.display.trim(), unitSystem: 'UCUM', unitCode: v.unitCode.trim(),
                value: v.value.trim(), refLow: v.refLow || null, refHigh: v.refHigh || null, refText: v.refText || null, observedAt: dateIso(v.observedAt), source: 'manual', createdAt: now };
            return { table: 'observations', record, matches: payloadMatcher({ patientId: 'exact', codeSystem: 'exact', code: 'exact', display: 'text', unitSystem: 'exact',
                unitCode: 'unit', value: 'value', refLow: 'value', refHigh: 'value', refText: 'text', observedAt: 'day' }, record) };
        }
        case 'service_prescription': {
            const record = { ...base, prescribedAt: dateIso(v.prescribedAt), status: 'prescribed', category: v.category, priority: v.priority || null,
                serviceName: v.serviceName.trim(), clinicalQuestion: v.clinicalQuestion || null, requestReference: v.requestReference || null,
                source: 'document_review', documentRefs: documentRefs(attachmentId, fact), version: 1, createdAt: now };
            return { table: 'service_prescriptions', record, matches: payloadMatcher({ patientId: 'exact', prescribedAt: 'day', status: 'exact', category: 'exact', priority: 'exact',
                serviceName: 'text', clinicalQuestion: 'text', requestReference: 'exact', source: 'exact', documentRefs: 'exact' }, record) };
        }
        case 'prosthetic': {
            const record = { ...base, prescribedAt: dateIso(v.prescribedAt), status: v.status, category: v.category, description: v.description.trim(),
                isoCode: v.isoCode || null, source: 'document_review', documentRefs: documentRefs(attachmentId, fact), version: 1, createdAt: now };
            return { table: 'prosthetic_prescriptions', record, matches: payloadMatcher({ patientId: 'exact', prescribedAt: 'day', status: 'exact', category: 'exact',
                description: 'text', isoCode: 'exact', source: 'exact', documentRefs: 'exact' }, record) };
        }
        case 'diagnosis': case 'exemption': return null;
        default: {
            const title = fact.kind === 'reported_scale' ? `Scala riportata: ${v.scaleName} = ${v.scaleTotal}${v.scaleMax ? `/${v.scaleMax}` : ''}` : (v.title || '').trim() || fact.kind;
            const qualifiers = [v.subject && v.subject !== 'paziente' ? `Soggetto: ${v.subject}.` : '', v.temporality ? `Riferimento temporale: ${v.temporality}.` : '',
                v.certainty ? `Certezza: ${v.certainty}.` : ''].filter(Boolean).join(' ');
            const body = fact.kind === 'reported_scale'
                ? `Totale trascritto dal documento, non una somministrazione: ${v.scaleName} ${v.scaleTotal}${v.scaleMax ? `/${v.scaleMax}` : ''}.${v.text ? `\n\n${v.text}` : ''}`
                : v.textSource === 'document' ? documentText ?? ''
                    : v.textSource === 'prepared' ? [v.text, v.preparedNotes, 'Sintesi da estrazione preparata; il testo completo resta nell’allegato.'].filter(Boolean).join('\n\n') : v.text;
            const content = qualifiers ? `${qualifiers}\n\n${body}` : body;
            const record = { ...base, type: entryType(fact.kind), date: dateIso(v.date), title, content,
                attachments: [attachmentId], metadata: { dossier: { factRef: dossierFactRef(attachmentId, fact.factId), kind: fact.kind } },
                createdAt: now, updatedAt: now };
            return { table: 'entries', record, matches: payloadMatcher({ patientId: 'exact', type: 'exact', date: 'day', title: 'text', content: 'exact', attachments: 'list', metadata: 'factRef' }, record) };
        }
    }
}

function serviceItems(fact: DossierFact): string[] {
    return (fact.values.items ?? '').split('\n').map((item) => item.trim()).filter(Boolean);
}

type WriteResult = { outcome: DossierAppliedEntry['outcome']; detail?: string };

/**
 * Lookup → riautorizzazione sull'esatta revisione → invio → rilettura su tutti i campi.
 * `authorize` rilegge il record dossier subito prima dell'invio; se il fatto o la sua
 * autorizzazione sono cambiati, non si scrive nulla.
 */
async function writeIdempotent(
    ports: DossierPorts, spec: RecordSpec, id: string, patientId: string, signal: AbortSignal, guard: Guard, authorize: () => Promise<boolean>,
): Promise<WriteResult | 'unauthorized'> {
    const before = await ports.getRecord(spec.table, id, patientId, signal);
    guard();
    if (before) return spec.matches(before) ? { outcome: 'applied' } : { outcome: 'conflict', detail: 'Un record con questo identificativo esiste con contenuto diverso.' };
    if (!await authorize()) return 'unauthorized';
    try {
        await boundary(guard, () => ports.createRecord(spec.table, spec.record));
    } catch (error) {
        if (error instanceof DossierAbortedError) throw error;
        let after: Record<string, unknown> | undefined;
        try { after = await ports.getRecord(spec.table, id, patientId, signal); } catch { guard(); return { outcome: 'uncertain', detail: 'Esito non verificabile: rileggi prima di riprovare.' }; }
        guard();
        if (after) return spec.matches(after) ? { outcome: 'applied' } : { outcome: 'conflict', detail: 'Il record riletto non corrisponde a quanto inviato.' };
        const status = error instanceof DossierWriteRejected ? error.status : null;
        // Una rilettura vuota non esclude un commit ancora in volo dopo un timeout.
        if (status === null || status >= 500 || status === 408) return { outcome: 'uncertain', detail: 'Esito dell’invio non noto: riprendi la verifica prima di modificare il fatto.' };
        return { outcome: 'failed', detail: status ? `Scrittura rifiutata (${status}).` : 'Scrittura non riuscita.' };
    }
    const after = await ports.getRecord(spec.table, id, patientId, signal);
    guard();
    if (!after) return { outcome: 'uncertain', detail: 'Scrittura confermata ma record non riletto.' };
    return spec.matches(after) ? { outcome: 'applied' } : { outcome: 'conflict', detail: 'Il record riletto non corrisponde a quanto inviato.' };
}

async function applyPatientCode(
    ports: DossierPorts, patientId: string, fact: DossierFact, signal: AbortSignal, guard: Guard, authorize: () => Promise<boolean>,
): Promise<WriteResult | 'unauthorized'> {
    const present = (patient: DossierPatient) => fact.kind === 'exemption'
        ? patient.exemptions.some((code) => code.toUpperCase() === fact.values.code.toUpperCase())
        : patient.diagnoses.some((diagnosis) => fact.values.code
            ? diagnosis.code.toUpperCase() === fact.values.code.toUpperCase() && diagnosis.system === fact.values.system
            : sameClinicalText(diagnosis.description, fact.values.description) && sameDay(diagnosis.date, fact.values.date));
    const patient = await ports.getPatient(patientId, signal);
    guard();
    if (!patient) return { outcome: 'failed', detail: 'Scheda non disponibile.' };
    if (present(patient)) return { outcome: 'already_present' };
    if (typeof patient.version !== 'number') return { outcome: 'failed', detail: 'Versione della scheda non disponibile.' };
    const change = fact.kind === 'exemption'
        ? { version: patient.version, exemptions: [...patient.exemptions, fact.values.code.toUpperCase()] }
        : { version: patient.version, diagnoses: [...patient.diagnoses, { code: fact.values.code ?? '', description: fact.values.description.trim(),
            system: fact.values.system || (fact.values.code ? 'ICD-10' : ''), date: dateIso(fact.values.date) }] };
    if (!await authorize()) return 'unauthorized';
    try {
        await boundary(guard, () => ports.updatePatientCodes(patientId, change));
    } catch (error) {
        if (error instanceof DossierAbortedError) throw error;
        const reread = await ports.getPatient(patientId, signal).catch(() => undefined);
        guard();
        if (error instanceof DossierVersionConflict) {
            // Il 409 di versione garantisce che questa scrittura non è avvenuta.
            return reread && present(reread) ? { outcome: 'already_present', detail: 'Aggiunto nel frattempo da un’altra modifica.' }
                : { outcome: 'conflict', detail: 'La scheda è cambiata: rileggi e riprova.' };
        }
        if (reread && present(reread)) return { outcome: 'applied' };
        const status = error instanceof DossierWriteRejected ? error.status : null;
        return status !== null && status >= 400 && status < 500 && status !== 408
            ? { outcome: 'failed', detail: `Scrittura rifiutata (${status}).` }
            : { outcome: 'uncertain', detail: 'Esito dell’invio non noto: riprendi la verifica prima di modificare il fatto.' };
    }
    const after = await ports.getPatient(patientId, signal);
    guard();
    return after && present(after) ? { outcome: 'applied' } : { outcome: 'uncertain', detail: 'Scrittura confermata ma non riletta.' };
}

function eligible(record: DossierRecord, fact: DossierFact, exemptionCodes: ReadonlySet<string>): boolean {
    if (fact.decision !== 'accepted' || dossierFactBlockers(fact, { exemptionCodes }).length) return false;
    const last = latestAppliedOutcome(record, fact.factId);
    if (!last || (last.outcome !== 'applied' && last.outcome !== 'already_present')) return true;
    return false;
}

/**
 * Applica i fatti accettati di un documento. Per ogni fatto:
 * 1. autorizzazione (claim) persistita con CAS sull'esatta revisione e impronta del fatto;
 * 2. lookup, poi nuova rilettura del record dossier subito prima di ogni invio (anche per ogni voce);
 * 3. scrittura con il writer ordinario e rilettura su tutti i campi del payload;
 * 4. registro con l'impronta della revisione scritta e rilascio del claim (CAS).
 * Il claim non rende atomici browser e writer: impedisce alla revisione dossier di cambiare
 * il fatto mentre la scrittura è in volo e rende recuperabile un esito interrotto.
 */
export async function applyDossierDocument(
    ports: DossierPorts,
    input: { patientId: string; attachmentId: string; expected: DossierCurrentness; signal: AbortSignal; isCurrent: () => boolean },
): Promise<DossierApplyResult> {
    const { patientId, attachmentId, signal } = input;
    const guard = guardOf(signal, input.isCurrent);
    const result: DossierApplyResult = { attachmentId, outcomes: [], stopped: null, partial: false };
    const finish = (stopped: DossierApplyResult['stopped']) => {
        result.stopped = stopped;
        result.partial = stopped !== null || result.outcomes.some((entry) => entry.outcome !== 'applied' && entry.outcome !== 'already_present');
        return result;
    };
    const first = await rereadDocument(ports, patientId, attachmentId, signal);
    guard();
    if (!first || !sameCurrentness(first.attachment.currentness, input.expected)) return finish('stale');
    const patient = await ports.getPatient(patientId, signal);
    guard();
    if (!patient || first.attachment.patientId !== patientId || !preservationIsCurrent(first.record, first.attachment.currentness?.sourceRef)
        || evaluateDossierGroupIdentity([first.record.identity], [patient], patientId).blocking) return finish('identity');
    const exemptionCodes = await ports.exemptionCodes(signal);
    guard();
    const planned = first.record.facts.filter((fact) => eligible(first.record, fact, exemptionCodes)).map((fact) => fact.factId);
    let documentText: string | null | undefined;
    for (const factId of planned) {
        guard();
        // 1. Autorizzazione persistita.
        let doc = await rereadDocument(ports, patientId, attachmentId, signal);
        guard();
        if (!doc || !preservationIsCurrent(doc.record, doc.attachment.currentness?.sourceRef)) return finish('stale');
        let fact = doc.record.facts.find((item) => item.factId === factId);
        if (!fact || !eligible(doc.record, fact, exemptionCodes)) continue;
        let claim = doc.record.pendingWrites?.find((item) => item.factId === factId);
        const target = DOSSIER_FACT_TARGET[fact.kind];
        const codeTarget = target === 'patient_diagnoses' || target === 'patient_exemptions';
        if (!claim) {
            const recordId = codeTarget ? null : fact.recordId ?? ports.newId();
            const claimed: DossierFact = codeTarget ? fact : { ...fact, recordId: recordId! };
            claim = { factId, recordId, factFingerprint: dossierFactFingerprint(claimed), at: ports.now().toISOString() };
            try {
                await persistRecord(ports, doc.attachment, { ...doc.record, updatedAt: ports.now().toISOString(),
                    facts: doc.record.facts.map((item) => item.factId === factId ? claimed : item),
                    pendingWrites: [...(doc.record.pendingWrites ?? []), claim] }, guard);
            } catch (error) {
                if (error instanceof DossierAbortedError) throw error;
                return finish(error instanceof DossierVersionConflict ? 'stale' : 'registry');
            }
            doc = await rereadDocument(ports, patientId, attachmentId, signal);
            guard();
            if (!doc) return finish('stale');
            fact = doc.record.facts.find((item) => item.factId === factId);
            if (!fact) return finish('stale');
        }
        const activeClaim = claim;
        if (dossierFactFingerprint(fact) !== activeClaim.factFingerprint) {
            // Il fatto è cambiato fuori dalla revisione dossier: non si scrive per la nuova revisione.
            // Se un invio precedente era in volo, il registro lo attribuisce alla revisione autorizzata.
            const previous = activeClaim.recordId ? await (async () => {
                for (const table of ['therapies', 'observations', 'entries', 'service_prescriptions', 'prosthetic_prescriptions'] as const) {
                    const found = await ports.getRecord(table, activeClaim.recordId!, patientId, signal);
                    guard();
                    if (found) return found;
                }
                return undefined;
            })() : undefined;
            const entry: DossierAppliedEntry | null = previous || codeTarget ? { factId, target, recordId: activeClaim.recordId,
                outcome: previous ? 'conflict' : 'uncertain', at: ports.now().toISOString(), factFingerprint: activeClaim.factFingerprint,
                detail: previous ? 'Record scritto per una revisione precedente del fatto: verifica nella scheda.'
                    : 'Il fatto è cambiato con una scrittura sulla scheda forse in corso: verifica nella scheda.' } : null;
            if (entry) result.outcomes.push(entry);
            await releaseClaim(ports, patientId, attachmentId, activeClaim, entry && entry.outcome === 'uncertain' ? { ...entry, outcome: 'conflict' } : entry, signal, guard);
            return finish('stale');
        }
        // 2. Riautorizzazione subito prima di ogni invio.
        const authorize = async (): Promise<boolean> => {
            const fresh = await rereadDocument(ports, patientId, attachmentId, signal);
            guard();
            const linked = await ports.getPatient(patientId, signal);
            guard();
            const freshFact = fresh?.record.facts.find((item) => item.factId === factId);
            return Boolean(fresh && linked && !evaluateDossierGroupIdentity([fresh.record.identity], [linked], patientId).blocking
                && freshFact && fresh.record.pendingWrites?.some((item) => item.factId === factId && item.factFingerprint === activeClaim.factFingerprint)
                && dossierFactFingerprint(freshFact) === activeClaim.factFingerprint && freshFact.decision === 'accepted'
                && preservationIsCurrent(fresh.record, fresh.attachment.currentness?.sourceRef));
        };
        let write: WriteResult | 'unauthorized';
        if (codeTarget) {
            write = await applyPatientCode(ports, patientId, fact, signal, guard, authorize);
        } else {
            if (documentText === undefined) {
                documentText = null;
                if (doc.record.extraction.state === 'extracted' && doc.attachment.parseEvidenceArtifactSnapshot) {
                    const text = resolveDossierText(doc.attachment.parseEvidenceArtifactSnapshot, doc.record);
                    if (text !== null && await ports.sha256(new TextEncoder().encode(text)) === doc.record.extraction.text.sha256) documentText = text;
                    guard();
                }
            }
            const spec = recordFor(fact, patientId, attachmentId, ports.now(), documentText)!;
            write = fact.values.textSource === 'document' && !documentText
                ? { outcome: 'failed', detail: 'Testo del documento non verificabile: voce non scritta.' }
                : await writeIdempotent(ports, spec, activeClaim.recordId!, patientId, signal, guard, authorize);
            if (write !== 'unauthorized' && write.outcome === 'applied' && fact.kind === 'service_prescription') {
                for (const [index, name] of serviceItems(fact).entries()) {
                    const itemId = `${activeClaim.recordId}-item-${index + 1}`;
                    const record = { id: itemId, patientId, prescriptionId: activeClaim.recordId, ordinal: index + 1, status: 'prescribed',
                        category: fact.values.category, serviceName: name, matchStatus: 'unmatched', version: 1, createdAt: ports.now() };
                    const item = await writeIdempotent(ports, { table: 'service_prescription_items', record,
                        matches: payloadMatcher({ prescriptionId: 'exact', ordinal: 'exact', status: 'exact', category: 'exact', serviceName: 'text' }, record) },
                    itemId, patientId, signal, guard, authorize);
                    if (item === 'unauthorized') { write = { outcome: 'uncertain', detail: `Prescrizione scritta; voce ${index + 1} non autorizzata: il fatto è cambiato.` }; break; }
                    if (item.outcome !== 'applied') { write = { outcome: item.outcome === 'conflict' ? 'conflict' : 'uncertain', detail: `Voce ${index + 1}: ${item.detail ?? item.outcome}` }; break; }
                }
            }
        }
        if (write === 'unauthorized') {
            // Nessun invio: l'autorizzazione si rilascia senza registrare un esito per la nuova revisione.
            await releaseClaim(ports, patientId, attachmentId, activeClaim, null, signal, guard);
            return finish('stale');
        }
        const entry: DossierAppliedEntry = { factId, target, recordId: activeClaim.recordId, outcome: write.outcome, at: ports.now().toISOString(),
            ...(write.detail ? { detail: write.detail } : {}), factFingerprint: activeClaim.factFingerprint };
        result.outcomes.push(entry);
        // 4. Registro e rilascio, con CAS; un conflitto rilegge e ritenta una volta.
        const recorded = await releaseClaim(ports, patientId, attachmentId, activeClaim, entry, signal, guard);
        if (!recorded) return finish('registry');
    }
    return finish(null);
}

async function releaseClaim(
    ports: DossierPorts, patientId: string, attachmentId: string, claim: DossierWriteClaim, entry: DossierAppliedEntry | null,
    signal: AbortSignal, guard: Guard,
): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const fresh = await rereadDocument(ports, patientId, attachmentId, signal);
        guard();
        if (!fresh) return false;
        try {
            // Un esito incerto tiene il claim: la ripresa rilegge il record prima di qualunque nuovo invio.
            const keep = entry?.outcome === 'uncertain';
            await persistRecord(ports, fresh.attachment, { ...fresh.record, updatedAt: ports.now().toISOString(),
                applied: entry ? [...fresh.record.applied, entry] : fresh.record.applied,
                pendingWrites: keep ? fresh.record.pendingWrites : (fresh.record.pendingWrites ?? []).filter((item) => item.factId !== claim.factId) }, guard);
            return true;
        } catch (error) {
            if (error instanceof DossierAbortedError) throw error;
            if (!(error instanceof DossierVersionConflict)) return false;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Accettazione in blocco del verificato (ADR 0176)
// ---------------------------------------------------------------------------

export interface DossierBulkResult {
    documents: number;
    accepted: number;
    alreadyPresent: number;
    superseded: number;
    leftPending: number;
    residualAcknowledged: number;
    applied: DossierApplyResult[];
    skipped: number;
}

/**
 * Un solo gesto del medico per scheda: accetta le proposte verificate sulla fonte, nuove e
 * senza blocchi, segna come già presenti quelle in scheda o accettate in un'altra fonte,
 * rifiuta le proposte per sezione sostituite dall'estrazione preparata, conferma il residuo
 * solo dove l'estrazione dichiara coperte tutte le pagine; poi applica con i writer ordinari.
 * Conflitti, incertezze, negazioni e citazioni non trovate restano da decidere.
 */
export async function acceptVerifiedAndApply(
    ports: DossierPorts, input: { patientId: string; signal: AbortSignal; isCurrent: () => boolean; includeSummaries?: boolean },
): Promise<DossierBulkResult> {
    const { patientId, signal, isCurrent } = input;
    const includeSummaries = input.includeSummaries === true;
    const guard = guardOf(signal, isCurrent);
    const result: DossierBulkResult = { documents: 0, accepted: 0, alreadyPresent: 0, superseded: 0, leftPending: 0, residualAcknowledged: 0, applied: [], skipped: 0 };
    const view = await loadPatientDossier(ports, patientId, signal);
    guard();
    if (!view) return result;
    const acceptedElsewhere = new Set(view.documents.flatMap((document) => document.record.facts
        .filter((fact) => fact.decision === 'accepted' || fact.decision === 'already_present').map((fact) => dossierFactRef(document.attachment.id, fact.factId))));
    for (const document of view.documents) {
        if (document.coverage.gaps.includes('identity_conflict') || !document.preservationCurrent || !document.attachment.currentness) { result.skipped += 1; continue; }
        const decide = (record: DossierRecord) => preparedBulkDecisions({ record, documentKey: document.attachment.id,
            assessment: (ref) => view.assessments.get(ref), exemptionCodes: view.exemptionCodes, acceptedElsewhere, includeSummaries });
        const preview = decide(document.record);
        const acknowledge = preview.acknowledgeResidual && document.record.residualReview.state !== 'acknowledged';
        result.documents += 1;
        if (!preview.counts.accepted && !preview.counts.alreadyPresent && !preview.counts.superseded && !acknowledge) {
            result.leftPending += preview.counts.leftPending;
            continue;
        }
        let decided = preview;
        try {
            await saveDossierReview(ports, { patientId, attachmentId: document.attachment.id, expected: document.attachment.currentness, signal, isCurrent,
                change: (fresh) => {
                    decided = decide(fresh);
                    return { ...fresh, facts: decided.facts, residualReview: decided.acknowledgeResidual && fresh.residualReview.state !== 'acknowledged'
                        ? { state: 'acknowledged', at: ports.now().toISOString(), note: 'Sintesi accettata; pagine dichiarate lette coerenti con il testo conservato.' }
                        : fresh.residualReview };
                } });
        } catch (error) {
            // Un documento cambiato o con scritture in volo si salta; gli altri proseguono.
            if (error instanceof DossierStaleError || error instanceof DossierWriteInFlight) { result.skipped += 1; continue; }
            throw error;
        }
        guard();
        for (const ref of decided.accepted) acceptedElsewhere.add(ref);
        result.accepted += decided.counts.accepted; result.alreadyPresent += decided.counts.alreadyPresent;
        result.superseded += decided.counts.superseded; result.leftPending += decided.counts.leftPending;
        if (acknowledge) result.residualAcknowledged += 1;
    }
    const fresh = await loadPatientDossier(ports, patientId, signal);
    guard();
    for (const document of fresh?.documents ?? []) {
        if (!document.attachment.currentness || document.coverage.gaps.includes('identity_conflict')) continue;
        const ready = document.record.facts.some((fact) => eligible(document.record, fact, fresh!.exemptionCodes));
        if (!ready) continue;
        result.applied.push(await applyDossierDocument(ports, { patientId, attachmentId: document.attachment.id, expected: document.attachment.currentness, signal, isCurrent }));
        guard();
    }
    return result;
}
