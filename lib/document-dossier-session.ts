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
 * - l'originale si dichiara conservato solo dopo rilettura byte-identica;
 * - la stessa fonte (sha256) non crea un secondo allegato, anche dopo un crash;
 * - ogni record clinico ha un'identità opaca persistita nell'artefatto PRIMA dell'invio;
 * - un esito incerto si rilegge; un 409 non vale mai come successo;
 * - sessione bloccata, cambio paziente o artefatto cambiato fermano l'operazione;
 * - un'applicazione parziale resta dichiarata come tale e riprende senza duplicati.
 */

import {
    DOSSIER_FACT_TARGET, DOSSIER_SCHEMA_VERSION, classifyDossierSource, collectDossierTaxCodes,
    dossierFactBlockers, dossierFactRef, evaluateDossierCoverage, evaluateDossierGroupIdentity, extractDossierCandidates,
    findExplicitDocumentDate, latestAppliedOutcome, readDossierRecord, reconcileDossierFacts, resolveDossierText,
    splitDossierUnits, writeDossierRecordIntoSnapshot,
    type DossierAppliedEntry, type DossierCoverage, type DossierCurrentRecords, type DossierExtraction, type DossierFact,
    type DossierFactAssessment, type DossierHostExtraction, type DossierIdentityEvaluation, type DossierRecord,
    type DossierSourceClassification, type DossierTaxCodeEvidence,
} from './domain/documents/dossier-import';

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
    ports: DossierPorts, files: readonly DossierInputFile[], options: { signal: AbortSignal; isCurrent: () => boolean; onProgress?: (done: number, total: number) => void },
): Promise<DossierDraftGroup[]> {
    const { signal, isCurrent } = options;
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
        sources.push({ key, group: groupKeyOf(file.relativePath), relativePath: file.relativePath, fileName: file.name, size: file.size, sha256,
            classification, extraction, text, taxCodes: text ? collectDossierTaxCodes(text) : [],
            documentDate: date ? { value: date.date, source: date.source } : null,
            facts: candidates.facts, classificationResult: candidates.classification,
            status: duplicateOf ? 'duplicate_in_selection' : 'ready', ...(duplicateOf ? { duplicateOf } : {}), file });
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
    if (!input.confirmed) throw new Error('Collegamento non confermato dal medico.');
    const patients = await ports.listPatients(signal);
    assertLive(signal, isCurrent);
    const identity = evaluateDraftGroupIdentity(group, patients, patientId);
    if (identity.blocking || !patients.some((patient) => patient.id === patientId)) throw new DossierIdentityBlocked(identity);
    const confirmedAt = ports.now().toISOString();
    const outcomes: DossierAcquireOutcome[] = [];
    for (const source of group.sources) {
        assertLive(signal, isCurrent);
        let outcome: DossierAcquireOutcome;
        if (source.status !== 'ready') {
            outcome = { key: source.key, status: 'skipped', reason: source.status === 'duplicate_in_selection' ? 'duplicate_in_selection' : source.status };
        } else {
            outcome = await acquireOne(ports, source, patientId, identity, confirmedAt, signal, isCurrent);
        }
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
        identity: { taxCodes: source.taxCodes, status: identity.status, confirmedAt },
        documentDate: source.documentDate,
        classification: source.classificationResult,
        facts: source.facts,
        residualReview: { state: 'pending' },
        applied: [],
        updatedAt: confirmedAt,
    };
}

async function acquireOne(
    ports: DossierPorts, source: DossierDraftSource, patientId: string, identity: DossierIdentityEvaluation, confirmedAt: string,
    signal: AbortSignal, isCurrent: () => boolean,
): Promise<DossierAcquireOutcome> {
    let bytes: Uint8Array;
    try { bytes = await source.file.read(); } catch { return { key: source.key, status: 'failed', reason: 'source_changed' }; }
    try {
        assertLive(signal, isCurrent);
        // La fonte su disco deve essere quella inventariata e mostrata al medico.
        if (await ports.sha256(bytes) !== source.sha256) return { key: source.key, status: 'failed', reason: 'source_changed' };
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const seen = await ports.listAttachments(patientId, signal);
            assertLive(signal, isCurrent);
            // Senza leggere tutti gli artefatti non si può escludere un duplicato.
            if (seen.some((item) => item.artifactUnreadable)) return { key: source.key, status: 'failed', reason: 'artifact_conflict' };
            const existing = recordsBySha(seen).get(source.sha256);
            if (existing) return await verifyReadback(ports, existing, bytes, source.key, 'reused', signal, isCurrent);
            // Un allegato già in app senza record dossier: stessa dimensione, poi confronto dei byte.
            for (const candidate of seen.filter((item) => item.size === bytes.byteLength && readDossierRecord(item.parseEvidenceArtifactSnapshot).status === 'absent')) {
                const stored = await ports.readAttachmentBytes(candidate.id, patientId, signal);
                assertLive(signal, isCurrent);
                if (stored && dataEqual(stored, bytes)) {
                    const record = initialRecord(source, ports, identity, confirmedAt, true);
                    let snapshot: string;
                    try {
                        snapshot = writeDossierRecordIntoSnapshot(candidate.parseEvidenceArtifactSnapshot, withInlineText(record, source.text),
                            { attachmentId: candidate.id, fileName: source.fileName, text: source.text });
                    } catch { return { key: source.key, status: 'failed', reason: 'artifact_conflict', attachmentId: candidate.id }; }
                    if (await ports.measureArtifact(snapshot) > ports.limits.updateRequestBytes) return { key: source.key, status: 'failed', reason: 'too_large', attachmentId: candidate.id };
                    try { await ports.updateArtifact(candidate, snapshot); }
                    catch (error) { if (error instanceof DossierVersionConflict) continue; return { key: source.key, status: 'failed', reason: 'write_failed', attachmentId: candidate.id }; }
                    const reread = (await ports.listAttachments(patientId, signal)).find((item) => item.id === candidate.id);
                    if (!reread) return { key: source.key, status: 'failed', reason: 'write_failed', attachmentId: candidate.id };
                    return await verifyReadback(ports, reread, bytes, source.key, 'reused', signal, isCurrent);
                }
            }
            const id = ports.newId();
            const record = initialRecord(source, ports, identity, confirmedAt, false);
            const snapshot = writeDossierRecordIntoSnapshot(undefined, record, { attachmentId: id, fileName: source.fileName, text: source.text });
            const create = { id, patientId, name: source.fileName, type: source.classification.mediaType, size: bytes.byteLength, bytes, parseEvidenceArtifactSnapshot: snapshot };
            const measured = await ports.measureCreate(create);
            if (measured.request > ports.limits.createRequestBytes || measured.artifact > ports.limits.updateRequestBytes) {
                return { key: source.key, status: 'failed', reason: 'too_large' };
            }
            assertLive(signal, isCurrent);
            try {
                await ports.createAttachment(create, seen);
            } catch (error) {
                if (error instanceof DossierCollectionChanged) continue;
                // Esito incerto: si rilegge per sha256, mai per nome.
                const after = recordsBySha(await ports.listAttachments(patientId, signal)).get(source.sha256);
                if (!after) return { key: source.key, status: 'failed', reason: 'write_failed' };
                const verified = await verifyReadback(ports, after, bytes, source.key, 'stored', signal, isCurrent);
                return verified.status === 'stored' ? { ...verified, measured: { original: measured.original, artifact: measured.artifact } } : verified;
            }
            const created = (await ports.listAttachments(patientId, signal)).find((item) => item.id === id);
            if (!created) return { key: source.key, status: 'failed', reason: 'write_failed', attachmentId: id };
            const verified = await verifyReadback(ports, created, bytes, source.key, 'stored', signal, isCurrent);
            return verified.status === 'stored' ? { ...verified, measured: { original: measured.original, artifact: measured.artifact } } : verified;
        }
        return { key: source.key, status: 'failed', reason: 'write_failed' };
    } finally { bytes.fill(0); }
}

function withInlineText(record: DossierRecord, text: string | null): DossierRecord {
    if (record.extraction.state !== 'extracted' || text === null) return record;
    return { ...record, extraction: { ...record.extraction, text: { ...record.extraction.text, location: 'inline', inline: text } } };
}

async function verifyReadback(
    ports: DossierPorts, attachment: DossierAttachmentMeta, bytes: Uint8Array, key: string, status: 'stored' | 'reused',
    signal: AbortSignal, isCurrent: () => boolean,
): Promise<DossierAcquireOutcome> {
    const read = readDossierRecord(attachment.parseEvidenceArtifactSnapshot);
    if (read.status !== 'present') return { key, status: 'failed', reason: 'artifact_conflict', attachmentId: attachment.id };
    if (read.record.preservation.state === 'verified') return { key, status, attachmentId: attachment.id, verified: true };
    const stored = await ports.readAttachmentBytes(attachment.id, attachment.patientId, signal);
    assertLive(signal, isCurrent);
    const same = Boolean(stored && dataEqual(stored, bytes));
    stored?.fill(0);
    const record: DossierRecord = { ...read.record, preservation: { ...read.record.preservation, state: same ? 'verified' : 'mismatch',
        ...(same ? { verifiedAt: ports.now().toISOString() } : {}) }, updatedAt: ports.now().toISOString() };
    try {
        await ports.updateArtifact(attachment, writeDossierRecordIntoSnapshot(attachment.parseEvidenceArtifactSnapshot, record,
            { attachmentId: attachment.id, fileName: record.source.fileName, text: null }));
    } catch { return { key, status: 'failed', reason: 'write_failed', attachmentId: attachment.id }; }
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
    coverage: DossierCoverage;
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
        documents.push({ attachment, record: read.record, text, textVerified, coverage: evaluateDossierCoverage(read.record, textVerified) });
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

function sameCurrentness(left?: DossierCurrentness, right?: DossierCurrentness): boolean {
    return Boolean(left && right && left.sourceRef === right.sourceRef && left.revision === right.revision && left.freshnessEpoch === right.freshnessEpoch);
}

async function rereadDocument(ports: DossierPorts, patientId: string, attachmentId: string, signal: AbortSignal) {
    const attachment = (await ports.listAttachments(patientId, signal)).find((item) => item.id === attachmentId && item.patientId === patientId);
    const read = attachment ? readDossierRecord(attachment.parseEvidenceArtifactSnapshot) : null;
    return attachment && read?.status === 'present' ? { attachment, record: read.record } : null;
}

async function persistRecord(ports: DossierPorts, attachment: DossierAttachmentMeta, record: DossierRecord): Promise<void> {
    const snapshot = writeDossierRecordIntoSnapshot(attachment.parseEvidenceArtifactSnapshot, record,
        { attachmentId: attachment.id, fileName: record.source.fileName, text: null });
    if (await ports.measureArtifact(snapshot) > ports.limits.updateRequestBytes) throw new DossierArtifactTooLarge();
    await ports.updateArtifact(attachment, snapshot);
}

/** Salva decisioni o correzioni del medico sulla revisione che stava guardando. */
export async function saveDossierReview(
    ports: DossierPorts,
    input: { patientId: string; attachmentId: string; expected: DossierCurrentness; signal: AbortSignal; isCurrent: () => boolean;
        change: (record: DossierRecord) => DossierRecord },
): Promise<void> {
    const current = await rereadDocument(ports, input.patientId, input.attachmentId, input.signal);
    assertLive(input.signal, input.isCurrent);
    if (!current || !sameCurrentness(current.attachment.currentness, input.expected)) throw new DossierStaleError();
    const next = input.change(current.record);
    // Il registro delle scritture appartiene all'applicazione, mai alla revisione.
    if (JSON.stringify(next.applied) !== JSON.stringify(current.record.applied) || next.importId !== current.record.importId
        || next.source.sha256 !== current.record.source.sha256) throw new Error('La revisione non può modificare provenienza o registro.');
    for (const fact of next.facts) {
        const before = current.record.facts.find((item) => item.factId === fact.factId);
        const applied = latestAppliedOutcome(current.record, fact.factId);
        if (before && applied && (applied.outcome === 'applied' || applied.outcome === 'already_present') && JSON.stringify(before) !== JSON.stringify(fact)) {
            throw new Error('Un fatto già scritto non si modifica dal dossier: correggilo nella scheda.');
        }
    }
    try { await persistRecord(ports, current.attachment, { ...next, updatedAt: ports.now().toISOString() }); }
    catch (error) { if (error instanceof DossierVersionConflict) throw new DossierStaleError(); throw error; }
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
const sliceDay = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value ?? '')).slice(0, 10);
const norm = (value: unknown) => String(value ?? '').trim().toLowerCase();

function documentRefs(attachmentId: string, fact: DossierFact): string {
    return JSON.stringify([{ attachmentId, factId: fact.factId, ...(fact.evidence ? { unit: fact.evidence.unit } : {}) }]);
}

function entryType(kind: DossierFact['kind']): 'exam' | 'note' | 'visit' {
    return kind === 'imaging_report' || kind === 'document_entry' ? 'exam' : kind === 'assessment' ? 'visit' : 'note';
}

function recordFor(fact: DossierFact, patientId: string, attachmentId: string, now: Date, documentText: string | null): { table: DossierRecordTable; record: Record<string, unknown>; matches: (stored: Record<string, unknown>) => boolean } | null {
    const v = fact.values; const id = fact.recordId!;
    const base = { id, patientId };
    switch (fact.kind) {
        case 'therapy':
            return { table: 'therapies', record: { ...base, drugName: v.drugName.trim(), dosage: v.dosage.trim(), status: v.status,
                startDate: dateIso(v.startDate), ...(v.endDate ? { endDate: dateIso(v.endDate) } : {}),
                motivation: `Da documento ${fact.evidence ? `(unità ${fact.evidence.unit})` : ''}`.trim(), createdAt: now },
                matches: (s) => s.patientId === patientId && norm(s.drugName) === norm(v.drugName) && norm(s.dosage) === norm(v.dosage) && sliceDay(s.startDate) === v.startDate };
        case 'observation':
            return { table: 'observations', record: { ...base, codeSystem: 'LOINC', code: v.code.trim(), display: v.display.trim(), unitSystem: 'UCUM',
                unitCode: v.unitCode.trim(), value: v.value.trim(), refLow: v.refLow || null, refHigh: v.refHigh || null, refText: v.refText || null,
                observedAt: dateIso(v.observedAt), source: 'manual', createdAt: now },
                matches: (s) => s.patientId === patientId && norm(s.code) === norm(v.code) && norm(s.value) === norm(v.value) && sliceDay(s.observedAt) === v.observedAt };
        case 'service_prescription':
            return { table: 'service_prescriptions', record: { ...base, prescribedAt: dateIso(v.prescribedAt), status: 'prescribed', category: v.category,
                ...(v.priority ? { priority: v.priority } : {}), serviceName: v.serviceName.trim(), ...(v.clinicalQuestion ? { clinicalQuestion: v.clinicalQuestion } : {}),
                ...(v.requestReference ? { requestReference: v.requestReference } : {}), source: 'document_review', documentRefs: documentRefs(attachmentId, fact),
                version: 1, createdAt: now },
                matches: (s) => s.patientId === patientId && norm(s.serviceName) === norm(v.serviceName) && sliceDay(s.prescribedAt) === v.prescribedAt };
        case 'prosthetic':
            return { table: 'prosthetic_prescriptions', record: { ...base, prescribedAt: dateIso(v.prescribedAt), status: v.status || 'prescribed', category: v.category,
                description: v.description.trim(), ...(v.isoCode ? { isoCode: v.isoCode } : {}), source: 'document_review', documentRefs: documentRefs(attachmentId, fact),
                version: 1, createdAt: now },
                matches: (s) => s.patientId === patientId && norm(s.description) === norm(v.description) && sliceDay(s.prescribedAt) === v.prescribedAt };
        case 'diagnosis': case 'exemption': return null;
        default: {
            const title = fact.kind === 'reported_scale' ? `Scala riportata: ${v.scaleName} = ${v.scaleTotal}` : (v.title || '').trim() || fact.kind;
            const content = fact.kind === 'reported_scale'
                ? `Totale trascritto dal documento, non una somministrazione: ${v.scaleName} ${v.scaleTotal}.${v.text ? `\n\n${v.text}` : ''}`
                : v.textSource === 'document' ? documentText ?? '' : v.text;
            return { table: 'entries', record: { ...base, type: entryType(fact.kind), date: dateIso(v.date), title, content,
                attachments: [attachmentId], metadata: { dossier: { factRef: dossierFactRef(attachmentId, fact.factId), kind: fact.kind } },
                createdAt: now, updatedAt: now },
                matches: (s) => s.patientId === patientId && entryFactRef(s.metadata) === dossierFactRef(attachmentId, fact.factId) };
        }
    }
}

export function entryFactRef(metadata: unknown): string | undefined {
    let value = metadata;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return undefined; } }
    const dossier = value && typeof value === 'object' ? (value as { dossier?: unknown }).dossier : undefined;
    const ref = dossier && typeof dossier === 'object' ? (dossier as { factRef?: unknown }).factRef : undefined;
    return typeof ref === 'string' ? ref : undefined;
}

function serviceItems(fact: DossierFact): string[] {
    return (fact.values.items ?? '').split('\n').map((item) => item.trim()).filter(Boolean);
}

async function writeIdempotent(
    ports: DossierPorts, table: DossierRecordTable, id: string, patientId: string, record: Record<string, unknown>, matches: (stored: Record<string, unknown>) => boolean, signal: AbortSignal,
): Promise<{ outcome: DossierAppliedEntry['outcome']; detail?: string }> {
    const before = await ports.getRecord(table, id, patientId, signal);
    if (before) return matches(before) ? { outcome: 'applied' } : { outcome: 'conflict', detail: 'Un record con questo identificativo esiste con contenuto diverso.' };
    try {
        await ports.createRecord(table, record);
        const after = await ports.getRecord(table, id, patientId, signal);
        if (!after) return { outcome: 'uncertain', detail: 'Scrittura confermata ma record non riletto.' };
        return matches(after) ? { outcome: 'applied' } : { outcome: 'conflict', detail: 'Il record riletto non corrisponde.' };
    } catch (error) {
        let after: Record<string, unknown> | undefined;
        try { after = await ports.getRecord(table, id, patientId, signal); } catch { return { outcome: 'uncertain', detail: 'Esito non verificabile: rileggi prima di riprovare.' }; }
        if (after) return matches(after) ? { outcome: 'applied' } : { outcome: 'conflict', detail: 'Un record con questo identificativo esiste con contenuto diverso.' };
        const status = error instanceof DossierWriteRejected ? error.status : null;
        return { outcome: 'failed', detail: status ? `Scrittura rifiutata (${status}).` : 'Scrittura non riuscita.' };
    }
}

async function applyPatientCode(ports: DossierPorts, patientId: string, fact: DossierFact, signal: AbortSignal): Promise<{ outcome: DossierAppliedEntry['outcome']; detail?: string }> {
    const present = (patient: DossierPatient) => fact.kind === 'exemption'
        ? patient.exemptions.some((code) => code.toUpperCase() === fact.values.code.toUpperCase())
        : patient.diagnoses.some((diagnosis) => fact.values.code
            ? diagnosis.code.toUpperCase() === fact.values.code.toUpperCase() && diagnosis.system === fact.values.system
            : norm(diagnosis.description) === norm(fact.values.description) && sliceDay(diagnosis.date) === fact.values.date);
    const patient = await ports.getPatient(patientId, signal);
    if (!patient) return { outcome: 'failed', detail: 'Scheda non disponibile.' };
    if (present(patient)) return { outcome: 'already_present' };
    if (typeof patient.version !== 'number') return { outcome: 'failed', detail: 'Versione della scheda non disponibile.' };
    const change = fact.kind === 'exemption'
        ? { version: patient.version, exemptions: [...patient.exemptions, fact.values.code.toUpperCase()] }
        : { version: patient.version, diagnoses: [...patient.diagnoses, { code: fact.values.code ?? '', description: fact.values.description.trim(),
            system: fact.values.system || 'ICD-10', date: dateIso(fact.values.date) }] };
    try {
        await ports.updatePatientCodes(patientId, change);
    } catch (error) {
        const reread = await ports.getPatient(patientId, signal).catch(() => undefined);
        if (error instanceof DossierVersionConflict) {
            // Il 409 di versione garantisce che questa scrittura non è avvenuta.
            return reread && present(reread) ? { outcome: 'already_present', detail: 'Aggiunto nel frattempo da un’altra modifica.' }
                : { outcome: 'conflict', detail: 'La scheda è cambiata: rileggi e riprova.' };
        }
        if (reread && present(reread)) return { outcome: 'applied' };
        return reread ? { outcome: 'failed', detail: 'Scrittura non riuscita.' } : { outcome: 'uncertain', detail: 'Esito non verificabile.' };
    }
    const after = await ports.getPatient(patientId, signal);
    return after && present(after) ? { outcome: 'applied' } : { outcome: 'uncertain', detail: 'Scrittura confermata ma non riletta.' };
}

/**
 * Applica i fatti accettati di un documento. Ordine per ogni fatto:
 * identità opaca persistita → scrittura idempotente → rilettura → registro (CAS).
 * Ogni await è seguito dal controllo di sessione e contesto.
 */
export async function applyDossierDocument(
    ports: DossierPorts,
    input: { patientId: string; attachmentId: string; expected: DossierCurrentness; signal: AbortSignal; isCurrent: () => boolean },
): Promise<DossierApplyResult> {
    const { patientId, attachmentId, signal, isCurrent } = input;
    const result: DossierApplyResult = { attachmentId, outcomes: [], stopped: null, partial: false };
    let current = await rereadDocument(ports, patientId, attachmentId, signal);
    assertLive(signal, isCurrent);
    if (!current || !sameCurrentness(current.attachment.currentness, input.expected)) return { ...result, stopped: 'stale' };
    const patient = await ports.getPatient(patientId, signal);
    assertLive(signal, isCurrent);
    if (!patient || current.attachment.patientId !== patientId || current.record.preservation.state !== 'verified'
        || ['mixed', 'discordant'].includes(current.record.identity.status)) return { ...result, stopped: 'identity' };
    const exemptionCodes = await ports.exemptionCodes(signal);
    const pending = current.record.facts.filter((fact) => {
        if (fact.decision !== 'accepted' || dossierFactBlockers(fact, { exemptionCodes }).length) return false;
        const last = latestAppliedOutcome(current!.record, fact.factId)?.outcome;
        return last !== 'applied' && last !== 'already_present';
    });
    // 1. Identità opache persistite prima di qualunque invio.
    const missing = pending.filter((fact) => !fact.recordId && DOSSIER_FACT_TARGET[fact.kind] !== 'patient_diagnoses' && DOSSIER_FACT_TARGET[fact.kind] !== 'patient_exemptions');
    if (missing.length) {
        const assigned = new Map(missing.map((fact) => [fact.factId, ports.newId()] as const));
        try {
            await persistRecord(ports, current.attachment, { ...current.record, updatedAt: ports.now().toISOString(),
                facts: current.record.facts.map((fact) => assigned.has(fact.factId) ? { ...fact, recordId: assigned.get(fact.factId) } : fact) });
        } catch { return { ...result, stopped: 'stale' }; }
        current = await rereadDocument(ports, patientId, attachmentId, signal);
        assertLive(signal, isCurrent);
        if (!current) return { ...result, stopped: 'stale' };
    }
    const ready = current.record.facts.filter((fact) => pending.some((item) => item.factId === fact.factId));
    // Il testo completo entra in una voce solo se coincide con quello estratto e registrato.
    let documentText: string | null = null;
    if (current.record.extraction.state === 'extracted' && current.attachment.parseEvidenceArtifactSnapshot) {
        const text = resolveDossierText(current.attachment.parseEvidenceArtifactSnapshot, current.record);
        if (text !== null && await ports.sha256(new TextEncoder().encode(text)) === current.record.extraction.text.sha256) documentText = text;
        assertLive(signal, isCurrent);
    }
    for (const fact of ready) {
        assertLive(signal, isCurrent);
        let write: { outcome: DossierAppliedEntry['outcome']; detail?: string };
        const target = DOSSIER_FACT_TARGET[fact.kind];
        if (target === 'patient_diagnoses' || target === 'patient_exemptions') {
            write = await applyPatientCode(ports, patientId, fact, signal);
        } else {
            if (!fact.recordId) { result.stopped = 'stale'; break; }
            const spec = recordFor(fact, patientId, attachmentId, ports.now(), documentText)!;
            write = fact.values.textSource === 'document' && !documentText
                ? { outcome: 'failed', detail: 'Testo del documento non verificabile: voce non scritta.' }
                : await writeIdempotent(ports, spec.table, fact.recordId, patientId, spec.record, spec.matches, signal);
            if (write.outcome === 'applied' && fact.kind === 'service_prescription') {
                for (const [index, name] of serviceItems(fact).entries()) {
                    const itemId = `${fact.recordId}-item-${index + 1}`;
                    const item = await writeIdempotent(ports, 'service_prescription_items', itemId, patientId, { id: itemId, patientId, prescriptionId: fact.recordId,
                        ordinal: index + 1, status: 'prescribed', category: fact.values.category, serviceName: name, matchStatus: 'unmatched', version: 1, createdAt: ports.now() },
                        (s) => s.prescriptionId === fact.recordId && norm(s.serviceName) === norm(name), signal);
                    if (item.outcome !== 'applied') { write = { outcome: item.outcome, detail: `Voce ${index + 1}: ${item.detail ?? item.outcome}` }; break; }
                }
            }
        }
        assertLive(signal, isCurrent);
        const entry: DossierAppliedEntry = { factId: fact.factId, target, recordId: fact.recordId ?? null, outcome: write.outcome,
            at: ports.now().toISOString(), ...(write.detail ? { detail: write.detail } : {}) };
        result.outcomes.push(entry);
        // 3. Registro nel record, con CAS; un conflitto rilegge e ritenta una volta.
        let recorded = false;
        for (let attempt = 0; attempt < 2 && !recorded; attempt += 1) {
            const fresh = await rereadDocument(ports, patientId, attachmentId, signal);
            assertLive(signal, isCurrent);
            if (!fresh) break;
            try {
                await persistRecord(ports, fresh.attachment, { ...fresh.record, applied: [...fresh.record.applied, entry], updatedAt: ports.now().toISOString() });
                recorded = true;
            } catch (error) { if (!(error instanceof DossierVersionConflict)) break; }
        }
        if (!recorded) { result.stopped = 'registry'; break; }
    }
    result.partial = result.stopped !== null || result.outcomes.some((entry) => entry.outcome !== 'applied' && entry.outcome !== 'already_present')
        || result.outcomes.length < ready.length;
    return result;
}
