#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { unwrapMasterKeyVersioned, decryptData } from '../lib/security/security.ts';
import {
    describeAthenaMlxModelArtifact,
    generateWithAthenaMlx,
} from '../lib/athena-mlx-runtime.ts';
import { ATHENA_MLX_DEFAULT_MAX_TOKENS, ATHENA_R1_QWEN3_8B_MODEL_ID } from '../lib/athena-model-identity.ts';
import {
    buildTreatmentReasoningContextBundle,
} from '../lib/treatment-reasoning-context.ts';
import {
    generateTreatmentReasoningDraftFromContext,
    type TreatmentReasoningAiRuntime,
} from '../lib/treatment-reasoning-service.ts';
import type {
    Attachment,
    ClinicalEntry,
    DocumentInsight,
    Observation,
    Patient,
    Therapy,
} from '../lib/db.ts';

type SqliteDatabase = {
    prepare(sql: string): {
        all(...params: unknown[]): unknown[];
        get(...params: unknown[]): unknown;
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
    pin: string | null;
    runModel: boolean;
    runtime: 'athena_mlx' | 'ollama';
    cases: number;
    maxTokens: number;
    redactSalt: string | null;
    help: boolean;
};

type UserRow = {
    encrypted_master_key: string;
    salt: string;
};

type PatientRow = {
    id: string;
    first_name: string;
    last_name: string;
    tax_code: string;
    birth_date: number | string | null;
    address: string | null;
    phone: string | null;
    caregiver: string | null;
    notes: string | null;
    ai_summary: string | null;
    is_adi: number | null;
    is_archived: number | null;
    created_at: number | string | null;
    updated_at: number | string | null;
    document_insights: string | null;
    exemptions: string | null;
    diagnoses: string | null;
    monitoring_profile: string | null;
    deleted_at: number | string | null;
};

type TherapyRow = {
    id: string;
    patient_id: string;
    drug_name: string;
    dosage: string;
    status: 'active' | 'suspended' | 'completed';
    start_date: number | string;
    end_date: number | string | null;
    created_at: number | string | null;
    active_principle: string | null;
    motivation: string | null;
    diagnosis_code: string | null;
    diagnosis_name: string | null;
    aic: string | null;
    atc: string | null;
    updated_at: number | string | null;
    deleted_at: number | string | null;
};

type EntryRow = {
    id: string;
    patient_id: string;
    type: ClinicalEntry['type'];
    date: number | string;
    content: string;
    created_at: number | string | null;
    title: string;
    setting: ClinicalEntry['setting'] | null;
    updated_at: number | string | null;
    deleted_at: number | string | null;
};

type ObservationRow = {
    id: string;
    patient_id: string;
    code_system: 'LOINC';
    code: string;
    display: string;
    unit_system: 'UCUM';
    unit_code: string;
    value: string;
    notes: string | null;
    observed_at: number | string;
    source: Observation['source'];
    created_at: number | string | null;
    ref_low: string | null;
    ref_high: string | null;
    ref_text: string | null;
};

type AttachmentRow = {
    id: string;
    patient_id: string;
    name: string;
    type: string;
    size: number;
    path: string;
    summary_snapshot: string | null;
    created_at: number | string | null;
};

type SmokeReport = {
    schemaVersion: 'mediflow.treatment_reasoning_live_db_smoke_report.v1';
    generatedAt: string;
    db: {
        pathHash: string;
        readOnly: true;
    };
    redaction: {
        strategy: 'sha256-first-16';
        salt: 'provided' | 'random-run';
        rawPatientTextIncluded: false;
        rawModelOutputIncluded: false;
    };
    selectedPatient: {
        patientHash: string;
        selectionReason: string;
    };
    sourceSummary: ReturnType<typeof buildTreatmentReasoningContextBundle>['sourceSummary'];
    model: {
        run: boolean;
        provider: 'athena_mlx' | 'ollama' | 'none';
        model: string | null;
        maxTokens: number | null;
        runtimeArtifact?: string | null;
        quantizationBits?: number | null;
    };
    contract?: {
        validJson: boolean;
        validTask: boolean;
        validEvidenceRefs: boolean;
        recommendationChars: number;
        keyEvidence: number;
        reasoningItems: number;
        caveats: number;
        safetyFlags: number;
        suggestedActions: number;
        latencyMs?: number;
        tokensIn?: number;
        tokensOut?: number;
    };
    cases: Array<{
        patientHash: string;
        sourceSummary: ReturnType<typeof buildTreatmentReasoningContextBundle>['sourceSummary'];
        contract?: SmokeReport['contract'];
    }>;
    aggregate: {
        caseCount: number;
        contractValid: number;
        evidenceRefsValid: number;
    };
    noWrites: true;
};

function usage(): string {
    return [
        'Usage:',
        '  MEDIFLOW_PIN=**** npm run smoke:treatment-reasoning:live -- [--db <medical.db>] [--out report.redacted.json] [--run-model] [--runtime athena_mlx|ollama] [--cases <n>] [--max-tokens <n>] [--redact-salt <salt>]',
        '',
        'Reads the local MediFlow SQLite database in read-only mode, decrypts high-signal patient context in memory, and emits only redacted aggregate metrics.',
        'With --run-model it calls the selected local runtime and reports contract metrics without printing raw model output.',
    ].join('\n');
}

function defaultDbPath(): string {
    return path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow', 'medical.db');
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        db: defaultDbPath(),
        out: null,
        pin: process.env.MEDIFLOW_PIN || null,
        runModel: false,
        runtime: 'athena_mlx',
        cases: 1,
        maxTokens: ATHENA_MLX_DEFAULT_MAX_TOKENS,
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
        } else if (value === '--run-model') {
            args.runModel = true;
        } else if (value === '--runtime' && argv[index + 1]) {
            const runtime = argv[index + 1];
            if (runtime !== 'athena_mlx' && runtime !== 'ollama') {
                throw new Error(`Unsupported runtime: ${runtime}`);
            }
            args.runtime = runtime;
            index += 1;
        } else if (value === '--cases' && argv[index + 1]) {
            args.cases = Math.max(1, Math.min(Number.parseInt(argv[index + 1], 10) || 1, 5));
            index += 1;
        } else if (value === '--max-tokens' && argv[index + 1]) {
            args.maxTokens = Math.max(64, Math.min(Number.parseInt(argv[index + 1], 10) || ATHENA_MLX_DEFAULT_MAX_TOKENS, 4096));
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

function base64ToBytes(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, 'base64'));
}

function encryptedParts(value: string | null | undefined): { iv: string; ciphertext: string } | null {
    if (!value || !value.startsWith('ENC:')) return null;
    const parts = value.split(':');
    if (parts.length !== 3) return null;
    return { iv: parts[1], ciphertext: parts[2] };
}

async function decryptOptional(value: string | null | undefined, masterKey: CryptoKey): Promise<unknown> {
    const encrypted = encryptedParts(value);
    if (!encrypted) return value ?? null;
    return decryptData(encrypted.ciphertext, encrypted.iv, masterKey);
}

async function decryptOptionalString(value: string | null | undefined, masterKey: CryptoKey): Promise<string | undefined> {
    const decrypted = await decryptOptional(value, masterKey);
    if (decrypted === null || decrypted === undefined) return undefined;
    if (typeof decrypted === 'string') return decrypted;
    return JSON.stringify(decrypted);
}

async function decryptOptionalArray<T>(value: string | null | undefined, masterKey: CryptoKey): Promise<T[] | undefined> {
    const decrypted = await decryptOptional(value, masterKey);
    if (Array.isArray(decrypted)) return decrypted as T[];
    if (typeof decrypted === 'string' && decrypted.trim()) {
        try {
            const parsed = JSON.parse(decrypted);
            return Array.isArray(parsed) ? parsed as T[] : undefined;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function sqlDate(value: number | string | null | undefined): Date {
    if (typeof value === 'number') {
        const millis = value > 9_999_999_999 ? value : value * 1000;
        return new Date(millis);
    }
    if (typeof value === 'string' && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return sqlDate(numeric);
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date(0);
}

function hashValue(value: string, salt: string): string {
    return createHash('sha256')
        .update(salt)
        .update('\0')
        .update(value)
        .digest('hex')
        .slice(0, 16);
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

function readSettings(db: SqliteDatabase): Map<string, string> {
    const rows = db.prepare('select key, value from settings').all() as Array<{ key: string; value: string }>;
    return new Map(rows.map((row) => [row.key, row.value]));
}

function selectPatientRows(db: SqliteDatabase, limit: number): PatientRow[] {
    const rows = db.prepare(`
        select
            p.*,
            (select count(*) from therapies t where t.patient_id = p.id and t.status = 'active' and t.deleted_at is null) as active_therapy_count,
            (select count(*) from entries e where e.patient_id = p.id and e.deleted_at is null) as entry_count,
            (select count(*) from observations o where o.patient_id = p.id) as observation_count,
            (select count(*) from attachments a where a.patient_id = p.id and a.summary_snapshot is not null) as attachment_summary_count
        from patients p
        where p.deleted_at is null
            and (select count(*) from therapies t where t.patient_id = p.id and t.status = 'active' and t.deleted_at is null) > 0
            and length(coalesce(p.diagnoses, '')) > 0
        order by active_therapy_count desc, entry_count desc, observation_count desc, attachment_summary_count desc, p.updated_at desc
        limit ?
    `).all(limit) as PatientRow[];

    if (!rows.length) throw new Error('No active patient with therapies and diagnoses available in the selected database.');
    return rows;
}

function readTherapyRows(db: SqliteDatabase, patientId: string): TherapyRow[] {
    return db.prepare(`
        select *
        from therapies
        where patient_id = ?
        order by start_date desc, id asc
        limit 24
    `).all(patientId) as TherapyRow[];
}

function readEntryRows(db: SqliteDatabase, patientId: string): EntryRow[] {
    return db.prepare(`
        select *
        from entries
        where patient_id = ?
        order by date desc, id asc
        limit 12
    `).all(patientId) as EntryRow[];
}

function readObservationRows(db: SqliteDatabase, patientId: string): ObservationRow[] {
    return db.prepare(`
        select *
        from observations
        where patient_id = ?
        order by observed_at desc, id asc
        limit 12
    `).all(patientId) as ObservationRow[];
}

function readAttachmentRows(db: SqliteDatabase, patientId: string): AttachmentRow[] {
    return db.prepare(`
        select id, patient_id, name, type, size, path, summary_snapshot, created_at
        from attachments
        where patient_id = ? and summary_snapshot is not null
        order by created_at desc, id asc
        limit 8
    `).all(patientId) as AttachmentRow[];
}

async function toPatient(row: PatientRow, masterKey: CryptoKey): Promise<Patient> {
    const [notes, aiSummary, documentInsights, exemptions, diagnoses, address, phone, caregiver] = await Promise.all([
        decryptOptionalString(row.notes, masterKey),
        decryptOptionalString(row.ai_summary, masterKey),
        decryptOptionalArray<DocumentInsight>(row.document_insights, masterKey),
        decryptOptionalArray<string>(row.exemptions, masterKey),
        decryptOptionalArray<Patient['diagnoses'] extends Array<infer T> ? T : never>(row.diagnoses, masterKey),
        decryptOptionalString(row.address, masterKey),
        decryptOptionalString(row.phone, masterKey),
        decryptOptionalString(row.caregiver, masterKey),
    ]);

    return {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        taxCode: row.tax_code,
        birthDate: row.birth_date ? sqlDate(row.birth_date) : undefined,
        address: address ?? '',
        phone: phone ?? '',
        caregiver,
        notes,
        aiSummary,
        documentInsights,
        exemptions,
        diagnoses,
        monitoringProfile: row.monitoring_profile ?? undefined,
        isAdi: Boolean(row.is_adi),
        isArchived: Boolean(row.is_archived),
        createdAt: sqlDate(row.created_at),
        updatedAt: sqlDate(row.updated_at),
        deletedAt: row.deleted_at ? sqlDate(row.deleted_at) : undefined,
    };
}

async function toTherapy(row: TherapyRow, masterKey: CryptoKey): Promise<Therapy> {
    return {
        id: row.id,
        patientId: row.patient_id,
        drugName: row.drug_name,
        activePrinciple: row.active_principle ?? undefined,
        dosage: row.dosage,
        status: row.status,
        startDate: sqlDate(row.start_date),
        endDate: row.end_date ? sqlDate(row.end_date) : undefined,
        motivation: await decryptOptionalString(row.motivation, masterKey),
        diagnosisCode: row.diagnosis_code ?? undefined,
        diagnosisName: row.diagnosis_name ?? undefined,
        aic: row.aic ?? undefined,
        atc: row.atc ?? undefined,
        createdAt: sqlDate(row.created_at),
        updatedAt: row.updated_at ? sqlDate(row.updated_at) : undefined,
        deletedAt: row.deleted_at ? sqlDate(row.deleted_at) : undefined,
    };
}

async function toEntry(row: EntryRow, masterKey: CryptoKey): Promise<ClinicalEntry> {
    return {
        id: row.id,
        patientId: row.patient_id,
        type: row.type,
        date: sqlDate(row.date),
        title: await decryptOptionalString(row.title, masterKey) ?? 'Voce clinica',
        content: await decryptOptionalString(row.content, masterKey) ?? '',
        setting: row.setting ?? undefined,
        createdAt: sqlDate(row.created_at),
        updatedAt: sqlDate(row.updated_at),
        deletedAt: row.deleted_at ? sqlDate(row.deleted_at) : null,
    };
}

async function toObservation(row: ObservationRow, masterKey: CryptoKey): Promise<Observation> {
    return {
        id: row.id,
        patientId: row.patient_id,
        codeSystem: row.code_system,
        code: row.code,
        display: row.display,
        unitSystem: row.unit_system,
        unitCode: row.unit_code,
        value: row.value,
        notes: await decryptOptionalString(row.notes, masterKey),
        observedAt: sqlDate(row.observed_at),
        source: row.source,
        createdAt: sqlDate(row.created_at),
        refLow: row.ref_low,
        refHigh: row.ref_high,
        refText: row.ref_text,
    };
}

async function toAttachment(row: AttachmentRow, masterKey: CryptoKey): Promise<Attachment> {
    return {
        id: row.id,
        patientId: row.patient_id,
        name: await decryptOptionalString(row.name, masterKey) ?? 'Allegato',
        type: row.type,
        size: row.size,
        path: await decryptOptionalString(row.path, masterKey) ?? '',
        summarySnapshot: await decryptOptionalString(row.summary_snapshot, masterKey),
        createdAt: sqlDate(row.created_at),
    };
}

function resolveBaseUrl(settings: Map<string, string>): string {
    const raw = settings.get('aiUrl') || settings.get('ollamaUrl') || 'http://127.0.0.1:11434';
    return raw.replace(/\/v1?\/?$/, '').replace(/\/$/, '');
}

function resolveReasoningModel(settings: Map<string, string>): string {
    return settings.get('aiModel_reasoning') || settings.get('aiModel') || 'qwen3.5:35b-a3b';
}

class LocalOllamaRuntime implements TreatmentReasoningAiRuntime {
    constructor(private baseUrl: string, private model: string) {}

    getModelInfo() {
        return {
            provider: 'ollama',
            model: this.model,
        };
    }

    async chat(
        messages: Array<{ role: string; content: string }>,
        signal?: AbortSignal,
        maxTokens = 1500,
        options?: { responseFormat?: 'json' },
    ) {
        const start = Date.now();
        const timeoutSignal = AbortSignal.timeout(300_000);
        const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages,
                stream: false,
                ...(options?.responseFormat === 'json' ? { format: 'json' } : {}),
                keep_alive: '30m',
                options: {
                    temperature: 0.4,
                    num_predict: maxTokens,
                },
                think: false,
            }),
            signal: effectiveSignal,
        });

        if (!response.ok) {
            throw new Error(`Ollama chat failed: ${response.status} ${await response.text()}`);
        }

        const payload = await response.json() as {
            message?: { content?: string };
            prompt_eval_count?: number;
            eval_count?: number;
        };

        return {
            content: payload.message?.content || '',
            stats: {
                latency: Date.now() - start,
                tokensIn: payload.prompt_eval_count || 0,
                tokensOut: payload.eval_count || 0,
            },
        };
    }
}

class AthenaMlxCliRuntime implements TreatmentReasoningAiRuntime {
    getModelInfo() {
        const artifact = describeAthenaMlxModelArtifact();
        return {
            provider: 'athena_mlx',
            model: ATHENA_R1_QWEN3_8B_MODEL_ID,
            runtimeArtifact: artifact.artifactKind || undefined,
            quantizationBits: artifact.quantizationBits,
        };
    }

    async chat(messages: Array<{ role: string; content: string }>, _signal?: AbortSignal, maxTokens = ATHENA_MLX_DEFAULT_MAX_TOKENS) {
        const prompt = messages.map((message) => message.content).join('\n\n');
        const result = await generateWithAthenaMlx({
            prompt,
            maxTokens,
            timeoutMs: 420_000,
        });

        return {
            content: result.content,
            stats: {
                latency: result.latencyMs,
                tokensIn: 0,
                tokensOut: 0,
            },
        };
    }
}

async function buildReport(args: CliArgs): Promise<SmokeReport> {
    if (!args.pin) {
        throw new Error('MEDIFLOW_PIN is required.');
    }

    const salt = args.redactSalt || randomBytes(16).toString('hex');
    const db = new Database(args.db, { readonly: true, fileMustExist: true });
    try {
        const user = readUser(db);
        const masterKey = await unwrapMasterKeyVersioned(user.encrypted_master_key, args.pin, base64ToBytes(user.salt));
        const selectedRows = selectPatientRows(db, args.cases);
        const selected = selectedRows[0];
        const settings = readSettings(db);
        const model = resolveReasoningModel(settings);
        const athenaArtifact = args.runtime === 'athena_mlx'
            ? describeAthenaMlxModelArtifact()
            : null;
        const runtimeModel = args.runtime === 'athena_mlx'
            ? ATHENA_R1_QWEN3_8B_MODEL_ID
            : model;
        const report: SmokeReport = {
            schemaVersion: 'mediflow.treatment_reasoning_live_db_smoke_report.v1',
            generatedAt: new Date().toISOString(),
            db: {
                pathHash: hashValue(args.db, salt),
                readOnly: true,
            },
            redaction: {
                strategy: 'sha256-first-16',
                salt: args.redactSalt ? 'provided' : 'random-run',
                rawPatientTextIncluded: false,
                rawModelOutputIncluded: false,
            },
            selectedPatient: {
                patientHash: hashValue(selected.id, salt),
                selectionReason: 'highest active therapy count, then entries/observations/attachment summaries, then updated_at',
            },
            sourceSummary: {
                profile: 0,
                diagnoses: 0,
                activeTherapies: 0,
                observations: 0,
                clinicalEntries: 0,
                documentInsights: 0,
                attachmentEvidence: 0,
                total: 0,
            },
            model: {
                run: args.runModel,
                provider: args.runModel ? args.runtime : 'none',
                model: args.runModel ? runtimeModel : null,
                maxTokens: args.runModel ? args.maxTokens : null,
                runtimeArtifact: args.runModel && athenaArtifact ? athenaArtifact.artifactKind : null,
                quantizationBits: args.runModel && athenaArtifact ? athenaArtifact.quantizationBits ?? null : null,
            },
            cases: [],
            aggregate: {
                caseCount: 0,
                contractValid: 0,
                evidenceRefsValid: 0,
            },
            noWrites: true,
        };

        for (const row of selectedRows) {
            const [patient, therapies, entries, observations, attachments] = await Promise.all([
                toPatient(row, masterKey),
                Promise.all(readTherapyRows(db, row.id).map((therapyRow) => toTherapy(therapyRow, masterKey))),
                Promise.all(readEntryRows(db, row.id).map((entryRow) => toEntry(entryRow, masterKey))),
                Promise.all(readObservationRows(db, row.id).map((observationRow) => toObservation(observationRow, masterKey))),
                Promise.all(readAttachmentRows(db, row.id).map((attachmentRow) => toAttachment(attachmentRow, masterKey))),
            ]);
            const context = buildTreatmentReasoningContextBundle({
                patient,
                therapies,
                entries,
                observations,
                attachments,
            });
            const caseReport: SmokeReport['cases'][number] = {
                patientHash: hashValue(row.id, salt),
                sourceSummary: context.sourceSummary,
            };

            if (args.runModel) {
                const runtime = args.runtime === 'athena_mlx'
                    ? new AthenaMlxCliRuntime()
                    : new LocalOllamaRuntime(resolveBaseUrl(settings), model);
                const draft = await generateTreatmentReasoningDraftFromContext(context, runtime, {
                    maxTokens: args.maxTokens,
                });
                caseReport.contract = {
                    validJson: draft.parse.validJson,
                    validTask: draft.parse.validTask,
                    validEvidenceRefs: draft.parse.validEvidenceRefs,
                    recommendationChars: draft.envelope.data.recommendation.length,
                    keyEvidence: draft.envelope.data.keyEvidence.length,
                    reasoningItems: draft.envelope.data.reasoning.length,
                    caveats: draft.envelope.data.caveats.length,
                    safetyFlags: draft.envelope.data.safetyFlags.length,
                    suggestedActions: draft.envelope.data.suggestedActions.length,
                    latencyMs: draft.stats?.latency,
                    tokensIn: draft.stats?.tokensIn,
                    tokensOut: draft.stats?.tokensOut,
                };
            }

            report.cases.push(caseReport);
            report.aggregate.caseCount += 1;
            if (caseReport.contract?.validJson && caseReport.contract.validTask) {
                report.aggregate.contractValid += 1;
            }
            if (caseReport.contract?.validEvidenceRefs) {
                report.aggregate.evidenceRefsValid += 1;
            }
        }

        report.sourceSummary = report.cases[0].sourceSummary;
        report.contract = report.cases[0].contract;

        return report;
    } finally {
        db.close();
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv);
    if (args.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }

    const report = await buildReport(args);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (args.out) {
        fs.writeFileSync(args.out, serialized, 'utf8');
    } else {
        process.stdout.write(serialized);
    }
}

void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
