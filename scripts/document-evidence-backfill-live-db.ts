#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
    buildDocumentEvidenceBackfillPlan,
    type DocumentEvidenceBackfillAttachmentInput,
    type DocumentEvidenceBackfillDecision,
    type DocumentEvidenceBackfillPlan,
} from '../lib/domain/documents/document-evidence-backfill';
import { serializeDocumentParseEvidenceArtifact } from '../lib/domain/documents/document-parse-evidence-artifact';
import { decryptData, encryptData, unwrapMasterKeyVersioned } from '../lib/security/security';
import {
    applyDocumentEvidenceArtifactsWithCurrentness,
    type BackfillCurrentnessCandidate,
} from './document-evidence-backfill-currentness-cas';

type SqliteDatabase = {
    prepare(sql: string): {
        all(...params: unknown[]): unknown[];
        get(...params: unknown[]): unknown;
        run(...params: unknown[]): { changes: number };
    };
    close(): void;
};

type SqliteConstructor = new (
    filename: string,
    options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

declare const require: {
    (id: string): unknown;
};

const Database = require('better-sqlite3') as SqliteConstructor;

type CliArgs = {
    db: string;
    out: string | null;
    markdownOut: string | null;
    pin: string | null;
    rebuildExisting: boolean;
    recoverPdfText: boolean;
    recoverArchivePdfText: boolean;
    archiveRoot: string | null;
    maxPdfPages: number;
    apply: boolean;
    confirmApply: string | null;
    backupOut: string | null;
    redactSalt: string | null;
    help: boolean;
};

type UserRow = {
    encrypted_master_key: string;
    salt: string;
};

type AttachmentRow = {
    id: string;
    patient_id: string;
    name: string;
    type: string;
    size: number;
    path: string;
    data: string | null;
    created_at: number | string | null;
    summary_snapshot: string | null;
    parse_evidence_artifact_snapshot: string | null;
    document_source_ref: string;
    document_revision: number;
    document_freshness_epoch: number;
    quality_status?: string | null;
    quality_reason?: string | null;
};

type RedactedLiveDbPlan = {
    schemaVersion: 'mediflow.document_evidence_live_db_backfill_report.v1';
    generatedAt: string;
    db: {
        pathHash: string;
        readOnly: true;
    };
    options: DocumentEvidenceBackfillPlan['options'];
    redaction: {
        strategy: 'sha256-first-16';
        salt: 'provided' | 'random-run';
        rawTextIncluded: false;
        candidateArtifactsIncluded: false;
    };
    totals: DocumentEvidenceBackfillPlan['totals'] & {
        patients: number;
        decryptFailures: number;
        pdfTextRecovered: number;
        pdfTextRecoveryFailures: number;
        pdfTextRecoveredChars: number;
        archivePatientsMatched: number;
        archivePdfsIndexed: number;
        archivePdfExactMatches: number;
        archivePdfSizeMatches: number;
        archivePdfAmbiguousMatches: number;
        archivePdfTextRecovered: number;
        archivePdfTextRecoveryFailures: number;
        archivePdfTextRecoveredChars: number;
    };
    apply: {
        mode: 'dry-run' | 'applied';
        eligibleCandidates: number;
        attempted: number;
        written: number;
        skipped: number;
        backupPathHash?: string;
        writesStructuredClinicalFields: false;
    };
    decisionCounts: Record<DocumentEvidenceBackfillDecision, number>;
    patients: Array<{
        patientHash: string;
        attachments: number;
        candidates: number;
        skippedExisting: number;
        skippedNoText: number;
        invalidExistingArtifacts: number;
        candidateFacts: number;
        candidateSuppressed: number;
        decisions: Record<DocumentEvidenceBackfillDecision, number>;
    }>;
};

function usage(): string {
    return [
        'Usage:',
        '  MEDIFLOW_PIN=**** npm run plan:document-evidence-backfill:live -- [--db <medical.db>] [--out report.redacted.json] [--markdown-out report.redacted.md] [--rebuild-existing] [--recover-pdf-text] [--recover-archive-pdf-text --archive-root <dir>] [--max-pdf-pages <n>] [--redact-salt <salt>]',
        '  MEDIFLOW_PIN=**** npm run plan:document-evidence-backfill:live -- --apply --confirm-apply DOCUMENT_EVIDENCE_ARTIFACTS_ONLY --backup-out <medical.backup.db> [same dry-run options]',
        '',
        'By default, reads the local MediFlow SQLite database in read-only mode, decrypts attachment names/summaries/artifacts in memory, and emits redacted aggregate reports only.',
        'Apply mode is opt-in, backup-first, and writes only attachments.parse_evidence_artifact_snapshot for candidate artifacts.',
        'Optional PDF text recovery reads only the saved PDF text layer; it does not OCR, apply writes, or emit raw text.',
    ].join('\n');
}

function defaultDbPath(): string {
    return path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow', 'medical.db');
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        db: defaultDbPath(),
        out: null,
        markdownOut: null,
        pin: process.env.MEDIFLOW_PIN || null,
        rebuildExisting: false,
        recoverPdfText: false,
        recoverArchivePdfText: false,
        archiveRoot: null,
        maxPdfPages: 12,
        apply: false,
        confirmApply: null,
        backupOut: null,
        redactSalt: null,
        help: false,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--help' || value === '-h') {
            args.help = true;
        } else if (value === '--db' && argv[index + 1]) {
            args.db = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--markdown-out' && argv[index + 1]) {
            args.markdownOut = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--rebuild-existing') {
            args.rebuildExisting = true;
        } else if (value === '--recover-pdf-text') {
            args.recoverPdfText = true;
        } else if (value === '--recover-archive-pdf-text') {
            args.recoverArchivePdfText = true;
        } else if (value === '--archive-root' && argv[index + 1]) {
            args.archiveRoot = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--max-pdf-pages' && argv[index + 1]) {
            args.maxPdfPages = Math.max(1, Number.parseInt(argv[index + 1], 10) || 12);
            index += 1;
        } else if (value === '--apply') {
            args.apply = true;
        } else if (value === '--confirm-apply' && argv[index + 1]) {
            args.confirmApply = argv[index + 1];
            index += 1;
        } else if (value === '--backup-out' && argv[index + 1]) {
            args.backupOut = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--redact-salt' && argv[index + 1]) {
            args.redactSalt = argv[index + 1];
            index += 1;
        } else {
            throw new Error(`Unknown or incomplete argument: ${value}`);
        }
    }

    return args;
}

function encryptedPayload(value: { iv: string; data: string }): string {
    return `ENC:${value.iv}:${value.data}`;
}

function hashValue(value: string, salt: string): string {
    return createHash('sha256')
        .update(salt)
        .update('\0')
        .update(value)
        .digest('hex')
        .slice(0, 16);
}

function normalizeComparableName(value: string): string {
    const basename = path.basename(value || '');
    const withoutExtension = basename.replace(/\.[^.]+$/, '');
    return withoutExtension
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function base64ToBytes(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, 'base64'));
}

function encryptedParts(value: string | null | undefined): { iv: string; ciphertext: string } | null {
    if (!value || !value.startsWith('ENC:')) return null;
    const parts = value.split(':');
    if (parts.length !== 3) return null;
    return { iv: parts[1], ciphertext: parts[2] };
}

function dataStringToBytes(value: string): Uint8Array | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const payload = trimmed.startsWith('data:')
        ? trimmed.slice(trimmed.indexOf(',') + 1)
        : trimmed;
    try {
        return new Uint8Array(Buffer.from(payload, 'base64'));
    } catch {
        return null;
    }
}

function compactRecoveredText(value: string): string {
    return value
        .replace(/\u0000/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function extractPdfTextLayer(data: string, maxPages: number): Promise<string> {
    const bytes = dataStringToBytes(data);
    if (!bytes?.byteLength) return '';
    return extractPdfTextLayerFromBytes(bytes, maxPages);
}

async function extractPdfTextLayerFromFile(filePath: string, maxPages: number): Promise<string> {
    return extractPdfTextLayerFromBytes(new Uint8Array(fs.readFileSync(filePath)), maxPages);
}

async function extractPdfTextLayerFromBytes(bytes: Uint8Array, maxPages: number): Promise<string> {
    const moduleName = 'pdfjs-dist/legacy/build/pdf.js';
    const pdfjsLib = await import(moduleName) as any;
    const loadingTask = pdfjsLib.getDocument({
        data: bytes,
        disableWorker: true,
        verbosity: pdfjsLib.VerbosityLevel?.ERRORS ?? 0,
    });
    const pdf = await loadingTask.promise;
    const pages = Math.min(pdf.numPages || 0, maxPages);
    const chunks: string[] = [];

    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = (content.items as Array<{ str?: unknown }>)
            .map((item) => typeof item.str === 'string' ? item.str : '')
            .filter(Boolean)
            .join(' ');
        if (text.trim()) chunks.push(text);
    }

    return compactRecoveredText(chunks.join('\n\n'));
}

type ArchivePdfIndex = {
    patientsMatched: number;
    pdfsIndexed: number;
    byPatientTaxCode: Map<string, {
        byName: Map<string, string[]>;
        bySize: Map<number, string[]>;
    }>;
};

function walkPdfFiles(root: string): string[] {
    const results: string[] = [];
    const stack = [root];

    while (stack.length) {
        const current = stack.pop() as string;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
                results.push(fullPath);
            }
        }
    }

    return results;
}

function buildArchivePdfIndex(archiveRoot: string, patientTaxCodes: Set<string>): ArchivePdfIndex {
    const byPatientTaxCode = new Map<string, {
        byName: Map<string, string[]>;
        bySize: Map<number, string[]>;
    }>();
    const root = path.join(archiveRoot, 'Pazienti_per_codice_fiscale');
    let patientsMatched = 0;
    let pdfsIndexed = 0;

    for (const taxCode of patientTaxCodes) {
        const patientRoot = path.join(root, taxCode);
        if (!fs.existsSync(patientRoot)) continue;
        patientsMatched += 1;

        const byName = new Map<string, string[]>();
        const bySize = new Map<number, string[]>();
        for (const filePath of walkPdfFiles(patientRoot)) {
            const key = normalizeComparableName(filePath);
            if (key) byName.set(key, [...(byName.get(key) || []), filePath]);
            const size = fs.statSync(filePath).size;
            bySize.set(size, [...(bySize.get(size) || []), filePath]);
            pdfsIndexed += 1;
        }
        byPatientTaxCode.set(taxCode, { byName, bySize });
    }

    return { patientsMatched, pdfsIndexed, byPatientTaxCode };
}

async function decryptOptionalString(value: string | null | undefined, masterKey: CryptoKey): Promise<{
    value: string | null;
    failed: boolean;
}> {
    const encrypted = encryptedParts(value);
    if (!encrypted) return { value: value ?? null, failed: false };

    const decrypted = await decryptData(encrypted.ciphertext, encrypted.iv, masterKey);
    if (typeof decrypted === 'string') return { value: decrypted, failed: false };
    if (decrypted === null) return { value: null, failed: true };
    return { value: JSON.stringify(decrypted), failed: false };
}

function createdAtToIso(value: number | string | null): string {
    if (typeof value === 'number') {
        const millis = value > 9_999_999_999 ? value : value * 1000;
        return new Date(millis).toISOString();
    }
    if (typeof value === 'string' && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return createdAtToIso(numeric);
        const parsed = new Date(value);
        if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    }
    return new Date(0).toISOString();
}

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
        .some((row) => row.name === column);
}

function readUser(db: SqliteDatabase): UserRow {
    const row = db.prepare(
        'select encrypted_master_key, salt from users order by created_at asc limit 1',
    ).get() as UserRow | undefined;
    if (!row?.encrypted_master_key || !row?.salt) {
        throw new Error('No unlockable MediFlow user found in the selected database.');
    }
    return row;
}

function readAttachmentRows(db: SqliteDatabase): AttachmentRow[] {
    const hasQualityStatus = hasColumn(db, 'attachments', 'quality_status');
    const hasQualityReason = hasColumn(db, 'attachments', 'quality_reason');
    const qualityStatus = hasQualityStatus ? 'quality_status' : 'null as quality_status';
    const qualityReason = hasQualityReason ? 'quality_reason' : 'null as quality_reason';

    return db.prepare(`
        select
            id,
            patient_id,
            name,
            type,
            size,
            path,
            data,
            created_at,
            summary_snapshot,
            parse_evidence_artifact_snapshot,
            document_source_ref,
            document_revision,
            document_freshness_epoch,
            ${qualityStatus},
            ${qualityReason}
        from attachments
        order by patient_id asc, created_at desc, id asc
    `).all() as AttachmentRow[];
}

function backupDatabase(dbPath: string, backupPath: string): void {
    if (fs.existsSync(backupPath)) {
        throw new Error(`Backup target already exists: ${backupPath}`);
    }
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);
}

function readPatientTaxCodeMap(db: SqliteDatabase): Map<string, string> {
    const rows = db.prepare('select id, tax_code from patients').all() as Array<{ id: string; tax_code: string }>;
    return new Map(rows.map((row) => [row.id, row.tax_code]));
}

async function unlockMasterKey(user: UserRow, pin: string): Promise<CryptoKey> {
    // Version-aware: handles both legacy v1 (unmarked) and v2 (v2:) wrapped blobs.
    return unwrapMasterKeyVersioned(user.encrypted_master_key, pin, base64ToBytes(user.salt));
}

async function toPlannerInputs(
    rows: AttachmentRow[],
    masterKey: CryptoKey,
    options: {
        recoverPdfText: boolean;
        recoverArchivePdfText: boolean;
        maxPdfPages: number;
        archiveIndex?: ArchivePdfIndex;
        patientTaxCodes: Map<string, string>;
    },
): Promise<{
    attachments: DocumentEvidenceBackfillAttachmentInput[];
    decryptFailures: number;
    pdfTextRecovered: number;
    pdfTextRecoveryFailures: number;
    pdfTextRecoveredChars: number;
    archivePatientsMatched: number;
    archivePdfsIndexed: number;
    archivePdfExactMatches: number;
    archivePdfSizeMatches: number;
    archivePdfAmbiguousMatches: number;
    archivePdfTextRecovered: number;
    archivePdfTextRecoveryFailures: number;
    archivePdfTextRecoveredChars: number;
}> {
    let decryptFailures = 0;
    let pdfTextRecovered = 0;
    let pdfTextRecoveryFailures = 0;
    let pdfTextRecoveredChars = 0;
    let archivePdfExactMatches = 0;
    let archivePdfSizeMatches = 0;
    let archivePdfAmbiguousMatches = 0;
    let archivePdfTextRecovered = 0;
    let archivePdfTextRecoveryFailures = 0;
    let archivePdfTextRecoveredChars = 0;
    const attachments: DocumentEvidenceBackfillAttachmentInput[] = [];

    for (const row of rows) {
        const [name, attachmentPath, data, summarySnapshot, parseEvidenceArtifactSnapshot] = await Promise.all([
            decryptOptionalString(row.name, masterKey),
            decryptOptionalString(row.path, masterKey),
            decryptOptionalString(row.data, masterKey),
            decryptOptionalString(row.summary_snapshot, masterKey),
            decryptOptionalString(row.parse_evidence_artifact_snapshot, masterKey),
        ]);
        decryptFailures += [name, attachmentPath, data, summarySnapshot, parseEvidenceArtifactSnapshot]
            .filter((result) => result.failed).length;

        let rawMarkdown: string | null = null;
        if (
            options.recoverPdfText
            && row.type === 'application/pdf'
            && data.value
        ) {
            try {
                rawMarkdown = await extractPdfTextLayer(data.value, options.maxPdfPages);
                if (rawMarkdown) {
                    pdfTextRecovered += 1;
                    pdfTextRecoveredChars += rawMarkdown.length;
                }
            } catch {
                pdfTextRecoveryFailures += 1;
            }
        }

        if (
            options.recoverArchivePdfText
            && !rawMarkdown
            && !data.value
            && options.archiveIndex
        ) {
            const patientTaxCode = options.patientTaxCodes.get(row.patient_id);
            const patientIndex = patientTaxCode
                ? options.archiveIndex.byPatientTaxCode.get(patientTaxCode)
                : undefined;
            const candidateKeys = Array.from(new Set([
                normalizeComparableName(name.value || ''),
                normalizeComparableName(attachmentPath.value || ''),
            ].filter(Boolean)));
            const nameMatches = candidateKeys.flatMap((key) => patientIndex?.byName.get(key) || []);
            const sizeMatches = patientIndex?.bySize.get(row.size) || [];
            const matches = nameMatches.length ? nameMatches : sizeMatches;
            const uniqueMatches = Array.from(new Set(matches));

            if (uniqueMatches.length === 1) {
                if (nameMatches.length) {
                    archivePdfExactMatches += 1;
                } else {
                    archivePdfSizeMatches += 1;
                }
                try {
                    rawMarkdown = await extractPdfTextLayerFromFile(uniqueMatches[0], options.maxPdfPages);
                    if (rawMarkdown) {
                        archivePdfTextRecovered += 1;
                        archivePdfTextRecoveredChars += rawMarkdown.length;
                    }
                } catch {
                    archivePdfTextRecoveryFailures += 1;
                }
            } else if (uniqueMatches.length > 1) {
                archivePdfAmbiguousMatches += 1;
            }
        }

        attachments.push({
            id: row.id,
            patientId: row.patient_id,
            fileName: name.value || 'attachment',
            createdAt: createdAtToIso(row.created_at),
            rawMarkdown,
            summarySnapshot: summarySnapshot.value,
            parseEvidenceArtifactSnapshot: parseEvidenceArtifactSnapshot.value,
            qualityStatus: row.quality_status === 'green' || row.quality_status === 'yellow' || row.quality_status === 'red'
                ? row.quality_status
                : null,
            qualityReason: row.quality_reason || null,
        });
    }

    return {
        attachments,
        decryptFailures,
        pdfTextRecovered,
        pdfTextRecoveryFailures,
        pdfTextRecoveredChars,
        archivePatientsMatched: options.archiveIndex?.patientsMatched || 0,
        archivePdfsIndexed: options.archiveIndex?.pdfsIndexed || 0,
        archivePdfExactMatches,
        archivePdfSizeMatches,
        archivePdfAmbiguousMatches,
        archivePdfTextRecovered,
        archivePdfTextRecoveryFailures,
        archivePdfTextRecoveredChars,
    };
}

function emptyDecisionCounts(): Record<DocumentEvidenceBackfillDecision, number> {
    return {
        create_from_source: 0,
        create_from_summary: 0,
        rebuild_invalid_artifact: 0,
        skip_existing_artifact: 0,
        skip_no_usable_text: 0,
    };
}

function buildReport(
    plan: DocumentEvidenceBackfillPlan,
    dbPath: string,
    recoveryStats: {
        decryptFailures: number;
        pdfTextRecovered: number;
        pdfTextRecoveryFailures: number;
        pdfTextRecoveredChars: number;
        archivePatientsMatched: number;
        archivePdfsIndexed: number;
        archivePdfExactMatches: number;
        archivePdfSizeMatches: number;
        archivePdfAmbiguousMatches: number;
        archivePdfTextRecovered: number;
        archivePdfTextRecoveryFailures: number;
        archivePdfTextRecoveredChars: number;
    },
    applyStats: RedactedLiveDbPlan['apply'],
    salt: string,
    saltMode: 'provided' | 'random-run',
): RedactedLiveDbPlan {
    const decisionCounts = plan.items.reduce((counts, item) => {
        counts[item.decision] += 1;
        return counts;
    }, emptyDecisionCounts());
    const byPatient = new Map<string, DocumentEvidenceBackfillPlan['items']>();
    for (const item of plan.items) {
        byPatient.set(item.patientId, [...(byPatient.get(item.patientId) || []), item]);
    }

    return {
        schemaVersion: 'mediflow.document_evidence_live_db_backfill_report.v1',
        generatedAt: plan.generatedAt,
        db: {
            pathHash: hashValue(dbPath, salt),
            readOnly: true,
        },
        options: plan.options,
        redaction: {
            strategy: 'sha256-first-16',
            salt: saltMode,
            rawTextIncluded: false,
            candidateArtifactsIncluded: false,
        },
        totals: {
            ...plan.totals,
            patients: byPatient.size,
            decryptFailures: recoveryStats.decryptFailures,
            pdfTextRecovered: recoveryStats.pdfTextRecovered,
            pdfTextRecoveryFailures: recoveryStats.pdfTextRecoveryFailures,
            pdfTextRecoveredChars: recoveryStats.pdfTextRecoveredChars,
            archivePatientsMatched: recoveryStats.archivePatientsMatched,
            archivePdfsIndexed: recoveryStats.archivePdfsIndexed,
            archivePdfExactMatches: recoveryStats.archivePdfExactMatches,
            archivePdfSizeMatches: recoveryStats.archivePdfSizeMatches,
            archivePdfAmbiguousMatches: recoveryStats.archivePdfAmbiguousMatches,
            archivePdfTextRecovered: recoveryStats.archivePdfTextRecovered,
            archivePdfTextRecoveryFailures: recoveryStats.archivePdfTextRecoveryFailures,
            archivePdfTextRecoveredChars: recoveryStats.archivePdfTextRecoveredChars,
        },
        apply: applyStats,
        decisionCounts,
        patients: Array.from(byPatient.entries()).map(([patientId, items]) => {
            const patientCounts = items.reduce((counts, item) => {
                counts[item.decision] += 1;
                return counts;
            }, emptyDecisionCounts());
            return {
                patientHash: hashValue(patientId, salt),
                attachments: items.length,
                candidates: items.filter((item) => item.candidateMetrics).length,
                skippedExisting: patientCounts.skip_existing_artifact,
                skippedNoText: patientCounts.skip_no_usable_text,
                invalidExistingArtifacts: items.filter((item) => (
                    item.existingArtifactSnapshotPresent && !item.existingArtifactValid
                )).length,
                candidateFacts: items.reduce((total, item) => total + (item.candidateMetrics?.factCount || 0), 0),
                candidateSuppressed: items.reduce(
                    (total, item) => total + (item.candidateMetrics?.suppressedCandidateCount || 0),
                    0,
                ),
                decisions: patientCounts,
            };
        }).sort((left, right) => (
            right.candidates - left.candidates
            || right.invalidExistingArtifacts - left.invalidExistingArtifacts
            || right.attachments - left.attachments
            || left.patientHash.localeCompare(right.patientHash)
        )),
    };
}

async function applyCandidateArtifacts(
    db: SqliteDatabase,
    plan: DocumentEvidenceBackfillPlan,
    masterKey: CryptoKey,
    rows: readonly AttachmentRow[],
): Promise<Pick<RedactedLiveDbPlan['apply'], 'attempted' | 'written' | 'skipped'>> {
    const candidates = plan.items.filter((item) => item.candidateArtifact);
    const sourceRows = new Map(rows.map((row) => [row.id, row]));
    const prepared: BackfillCurrentnessCandidate[] = [];
    for (const item of candidates) {
        if (!item.candidateArtifact) continue;
        const row = sourceRows.get(item.attachmentId);
        if (!row || row.patient_id !== item.patientId
            || !/^[0-9a-f]{64}$/u.test(row.document_source_ref)
            || !Number.isSafeInteger(row.document_revision) || row.document_revision < 1
            || !Number.isSafeInteger(row.document_freshness_epoch) || row.document_freshness_epoch < 1) {
            throw new Error('Attachment currentness snapshot is unavailable for a candidate artifact.');
        }
        const serialized = serializeDocumentParseEvidenceArtifact(item.candidateArtifact);
        prepared.push(Object.freeze({
            attachmentId: item.attachmentId,
            patientId: item.patientId,
            sourceRef: row.document_source_ref,
            revision: row.document_revision,
            freshnessEpoch: row.document_freshness_epoch,
            encryptedArtifact: encryptedPayload(await encryptData(serialized, masterKey)),
        }));
    }
    return applyDocumentEvidenceArtifactsWithCurrentness(db, prepared);
}

function renderMarkdown(report: RedactedLiveDbPlan): string {
    return [
        '# Live DB Document Evidence Backfill Dry Run',
        '',
        `Generated: \`${report.generatedAt}\``,
        `Schema: \`${report.schemaVersion}\``,
        `Rebuild existing: \`${report.options.rebuildExisting}\``,
        '',
        '## Totals',
        '',
        `- Patients with attachments: ${report.totals.patients}`,
        `- Attachments: ${report.totals.attachments}`,
        `- Candidates: ${report.totals.candidates}`,
        `- Skipped existing: ${report.totals.skippedExisting}`,
        `- Skipped no text: ${report.totals.skippedNoText}`,
        `- Invalid existing artifacts: ${report.totals.invalidExistingArtifacts}`,
        `- Candidate facts: ${report.totals.candidateFacts}`,
        `- Candidate suppressed: ${report.totals.candidateSuppressed}`,
        `- Decrypt failures: ${report.totals.decryptFailures}`,
        `- PDF text recovered: ${report.totals.pdfTextRecovered}`,
        `- PDF text recovery failures: ${report.totals.pdfTextRecoveryFailures}`,
        `- PDF text recovered chars: ${report.totals.pdfTextRecoveredChars}`,
        `- Archive patients matched: ${report.totals.archivePatientsMatched}`,
        `- Archive PDFs indexed: ${report.totals.archivePdfsIndexed}`,
        `- Archive exact matches: ${report.totals.archivePdfExactMatches}`,
        `- Archive size matches: ${report.totals.archivePdfSizeMatches}`,
        `- Archive ambiguous matches: ${report.totals.archivePdfAmbiguousMatches}`,
        `- Archive PDF text recovered: ${report.totals.archivePdfTextRecovered}`,
        `- Archive PDF text recovery failures: ${report.totals.archivePdfTextRecoveryFailures}`,
        `- Archive PDF text recovered chars: ${report.totals.archivePdfTextRecoveredChars}`,
        `- Apply mode: ${report.apply.mode}`,
        `- Apply eligible candidates: ${report.apply.eligibleCandidates}`,
        `- Apply attempted: ${report.apply.attempted}`,
        `- Apply written: ${report.apply.written}`,
        `- Apply skipped: ${report.apply.skipped}`,
        '',
        '## Patient Coverage',
        '',
        '| Patient | Attachments | Candidates | Existing | No text | Invalid artifacts | Facts | Suppressed |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...report.patients.map((patient) => [
            `| ${patient.patientHash}`,
            patient.attachments,
            patient.candidates,
            patient.skippedExisting,
            patient.skippedNoText,
            patient.invalidExistingArtifacts,
            patient.candidateFacts,
            `${patient.candidateSuppressed} |`,
        ].join(' | ')),
        '',
    ].join('\n');
}

function writeOutput(filePath: string, value: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log(usage());
        return;
    }
    if (!args.pin) throw new Error('Missing MEDIFLOW_PIN.\n\n' + usage());
    if (!fs.existsSync(args.db)) throw new Error(`Database not found: ${args.db}`);
    if (args.recoverArchivePdfText && (!args.archiveRoot || !fs.existsSync(args.archiveRoot))) {
        throw new Error('Missing or invalid --archive-root for --recover-archive-pdf-text.');
    }
    if (args.apply && args.confirmApply !== 'DOCUMENT_EVIDENCE_ARTIFACTS_ONLY') {
        throw new Error('Apply mode requires --confirm-apply DOCUMENT_EVIDENCE_ARTIFACTS_ONLY.');
    }
    if (args.apply && !args.backupOut) {
        throw new Error('Apply mode requires --backup-out <path> before opening the database in write mode.');
    }
    if (!args.apply && args.backupOut) {
        throw new Error('--backup-out is only valid together with --apply.');
    }
    if (args.apply && args.backupOut) {
        backupDatabase(args.db, args.backupOut);
    }

    const db = new Database(args.db, { readonly: !args.apply, fileMustExist: true });
    try {
        const masterKey = await unlockMasterKey(readUser(db), args.pin);
        const patientTaxCodes = readPatientTaxCodeMap(db);
        const archiveIndex = args.recoverArchivePdfText && args.archiveRoot
            ? buildArchivePdfIndex(args.archiveRoot, new Set(patientTaxCodes.values()))
            : undefined;
        const attachmentRows = readAttachmentRows(db);
        const {
            attachments,
            decryptFailures,
            pdfTextRecovered,
            pdfTextRecoveryFailures,
            pdfTextRecoveredChars,
            archivePatientsMatched,
            archivePdfsIndexed,
            archivePdfExactMatches,
            archivePdfSizeMatches,
            archivePdfAmbiguousMatches,
            archivePdfTextRecovered,
            archivePdfTextRecoveryFailures,
            archivePdfTextRecoveredChars,
        } = await toPlannerInputs(attachmentRows, masterKey, {
            recoverPdfText: args.recoverPdfText,
            recoverArchivePdfText: args.recoverArchivePdfText,
            maxPdfPages: args.maxPdfPages,
            archiveIndex,
            patientTaxCodes,
        });
        const plan = buildDocumentEvidenceBackfillPlan(attachments, {
            rebuildExisting: args.rebuildExisting,
        });
        const salt = args.redactSalt || randomBytes(32).toString('hex');
        const eligibleCandidates = plan.items.filter((item) => item.candidateArtifact).length;
        const applyResult = args.apply
            ? await applyCandidateArtifacts(db, plan, masterKey, attachmentRows)
            : { attempted: 0, written: 0, skipped: 0 };
        const applyStats: RedactedLiveDbPlan['apply'] = {
            mode: args.apply ? 'applied' : 'dry-run',
            eligibleCandidates,
            ...applyResult,
            ...(args.backupOut ? { backupPathHash: hashValue(args.backupOut, salt) } : {}),
            writesStructuredClinicalFields: false,
        };
        const report = buildReport(plan, args.db, {
            decryptFailures,
            pdfTextRecovered,
            pdfTextRecoveryFailures,
            pdfTextRecoveredChars,
            archivePatientsMatched,
            archivePdfsIndexed,
            archivePdfExactMatches,
            archivePdfSizeMatches,
            archivePdfAmbiguousMatches,
            archivePdfTextRecovered,
            archivePdfTextRecoveryFailures,
            archivePdfTextRecoveredChars,
        }, applyStats, salt, args.redactSalt ? 'provided' : 'random-run');
        const json = JSON.stringify(report, null, 2) + '\n';

        if (args.out) {
            writeOutput(args.out, json);
        } else {
            process.stdout.write(json);
        }
        if (args.markdownOut) {
            writeOutput(args.markdownOut, renderMarkdown(report));
        }

        process.stderr.write([
            `live document evidence dry-run: ${report.totals.candidates}/${report.totals.attachments} candidates`,
            `patients with attachments: ${report.totals.patients}`,
            `decrypt failures: ${report.totals.decryptFailures}`,
            `pdf text recovered: ${report.totals.pdfTextRecovered}`,
            `archive pdf text recovered: ${report.totals.archivePdfTextRecovered}`,
            `apply mode: ${report.apply.mode}`,
            `apply written: ${report.apply.written}`,
            args.out ? `json: ${args.out}` : null,
            args.markdownOut ? `markdown: ${args.markdownOut}` : null,
        ].filter(Boolean).join('\n') + '\n');
    } finally {
        db.close();
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
