import { prepareSyntheticBackupDestination } from './scheduled-backup.test-support.ts';
import { isCiphertext, openPatientDocumentFile } from './security/attachment-file-envelope';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { commitExemptionImport, previewExemptionImport } from './exemption-catalog-import';
import { EXEMPTION_COLUMNS } from './exemption-import-contract';
import { createProstheticsCatalog } from './reference-data/prosthetics-catalog-service';
import { PROSTHETICS_TEMPLATE } from './reference-data/prosthetics-catalog-contract';
import { BACKUP_COLLECTIONS, createEmptyDataset, parseBackupArtifact, serializeBackupArtifact, stableStringify } from './backup-artifact';
import { decryptData, encryptData, generateMasterKey } from './security/security';

const fileGolden = JSON.parse(fs.readFileSync('native/contracts/attachment-file-golden.v2.json', 'utf8'));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOADER = pathToFileURL(path.join(ROOT, 'scripts/register-strip-types-loader.mjs')).href;
const MEMBERSHIP_TABLE = 'patients_to_ambulatories';
// WUL-730 / C15: duplicate intents are an operational local ledger, not exported.
// Same-DB restore retains tokens; export/restore into a new DB loses historical tokens.
// C05: retired patient IDs are current-DB identity state, not an exported collection.
// Their historical audit backfill does not qualify export/restore continuity (C15).
const NON_BACKUP_TABLES = new Set(['settings', 'users', 'patient_duplicate_intents', 'patient_retired_ids']);
/* Checkup enrollment is host-local authorization state and is not exported by the v1 clinical backup. */
const LOCAL_ONLY_AUTHORITY_TABLES = new Set(['headless_checkup_active_role_attestations', 'archive_generation', 'archive_session_generations', 'portable_import_origins']);
/* Command replay remains empty until append-only audit restore has a separate contract. */
const BACKUP_TABLES = {
    auditEvents: 'audit_events',
    ambulatories: 'ambulatories',
    attachments: 'attachments',
    conversations: 'conversations',
    documentDiagnosisProposals: 'document_diagnosis_proposals',
    drugs: 'drugs',
    entries: 'entries',
    exemptions: 'exemptions',
    exemptionImportReceipts: 'exemption_import_receipts',
    prostheticsCatalogEntries: 'prosthetics_catalog_entries',
    prostheticsCatalogReceipts: 'prosthetics_catalog_receipts',
    prostheticsCatalogSources: 'prosthetics_catalog_sources',
    prostheticsCatalogDocuments: 'prosthetics_catalog_documents',
    messages: 'messages',
    observations: 'observations',
    patients: 'patients',
    physicianReviewAttestations: 'physician_review_attestations',
    therapyStatusCommands: 'therapy_status_commands',
    ambulatoryDestructiveCommands: 'ambulatory_destructive_commands',
    prostheticPrescriptions: 'prosthetic_prescriptions',
    serviceCatalogEntries: 'service_catalog_entries',
    servicePrescriptionItems: 'service_prescription_items',
    servicePrescriptions: 'service_prescriptions',
    sissHandoffs: 'siss_handoff_events',
    checkups: 'checkups',
    therapies: 'therapies',
} as const;

function runNode(args: string[], env: Record<string, string> = {}): string {
    if (env.MEDIFLOW_BACKUP_DEST_DIR) args = ['--import', prepareSyntheticBackupDestination(env.MEDIFLOW_DATA_DIR, env.MEDIFLOW_BACKUP_DEST_DIR), ...args];
    return execFileSync(process.execPath, args, {
        cwd: ROOT,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function prepareDatabase(dataDir: string): void {
    runNode(['scripts/prepare-e2e-db.mjs'], { MEDIFLOW_DATA_DIR: dataDir });
    bootstrapSchemaGuards(dataDir);
}

function bootstrapSchemaGuards(dataDir: string): void {
    const dbServerUrl = pathToFileURL(path.join(ROOT, 'lib/db-server.ts')).href;
    runNode(
        ['--experimental-strip-types', '--import', LOADER, '--input-type=module', '--eval', `(await import(${JSON.stringify(dbServerUrl)})).openDbServer();`],
        { MEDIFLOW_DATA_DIR: dataDir },
    );
}

function schemaTables(db: Database.Database): string[] {
    return (db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>).map((row) => row.name);
}

function quoteIdentifier(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
}

function clearBackupTables(db: Database.Database, tables: string[]): void {
    db.pragma('foreign_keys = OFF');
    try {
        db.transaction(() => {
            for (const table of tables.filter(table => table !== 'audit_events')) {
                db.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
            }
        })();
    } finally {
        db.pragma('foreign_keys = ON');
    }
}

function insertRow(db: Database.Database, table: string, row: Record<string, unknown>): void {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    db.prepare(
        `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`,
    ).run(...Object.values(row));
}

/* The authority record references a local user, which the backup intentionally does not export. */
function alignSyntheticAuthorityActor(db: Database.Database): string {
    const current = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    assert.ok(current?.id, 'fixture database must contain a synthetic local user');
    const actorRef = 'w7-review-authority-actor';
    db.prepare('UPDATE users SET id = ? WHERE id = ?').run(actorRef, current.id);
    return actorRef;
}

async function populateSyntheticClinicalFixture(db: Database.Database, actorRef: string) {
    const masterKey = await generateMasterKey();
    const seal = async (label: string): Promise<string> => {
        const encrypted = await encryptData(`synthetic:${label}`, masterKey);
        assert.equal(await decryptData(encrypted.data, encrypted.iv, masterKey), `synthetic:${label}`);
        return `ENC:${encrypted.iv}:${encrypted.data}`;
    };
    const sealed = async (table: string, columns: string[]): Promise<Record<string, string>> => Object.fromEntries(
        await Promise.all(columns.map(async (column) => [column, await seal(`${table}.${column}`)])),
    );
    const now = 1_783_000_000;
    insertRow(db, 'ambulatory_destructive_commands', { command_id: '61111111-1111-4111-8111-111111111111', protocol: 'ambulatory.destructive.v1',
        operation: 'ambulatory.delete.v1', original_archive_generation: (db.prepare('SELECT generation FROM archive_generation WHERE id=1').get() as {generation:string}).generation,
        original_scope_id: 'synthetic-original-scope', ambulatory_id: 'synthetic-unreceived-ambulatory', expected_version: 1, plan_digest: 'a'.repeat(64),
        actor_ref: actorRef, device_id: 'synthetic-paired-client', device_platform: 'macos', device_token_hash: 'b'.repeat(64),
        outcome: 'closed', reason: null, committed_at: now, result_json: null, audit_snapshots: null });
    insertRow(db, 'therapy_status_commands', { command_id: '51111111-1111-4111-8111-111111111111', protocol: 'therapy.status.change.v1',
        archive_generation: (db.prepare('SELECT generation FROM archive_generation WHERE id=1').get() as {generation:string}).generation,
        actor_ref: actorRef, patient_id: 'synthetic-historical-patient', therapy_id: 'synthetic-unreceived-therapy', expected_version: 1,
        target: null, outcome: 'closed', reason: null, committed_at: now, result_version: null, result_end_date: null, audit_event_id: null, audit_snapshot: null });

    insertRow(db, 'ambulatories', { id: 'w7-amb-primary', name: 'Ambulatorio sintetico W7', address: 'fixture locale', type: 'synthetic', is_default: 1, version: 3, created_at: now });
    insertRow(db, 'ambulatories', { id: 'w7-amb-secondary', name: 'Ambulatorio sintetico secondario', type: 'synthetic', is_default: 0, version: 2, created_at: now + 1 });
    const allergyCipher = await encryptData([{ substance: 'Amoxicillina sintetica', reaction: 'Orticaria sintetica', severity: 'moderate' }], masterKey);
    insertRow(db, 'patients', {
        id: 'w7-patient', first_name: 'Synthetic', last_name: 'Roundtrip', tax_code: 'SYNTHETIC-W7', birth_date: -631_152_000,
        ...(await sealed('patients', ['address', 'phone', 'caregiver', 'exemptions', 'diagnoses', 'status_reason', 'notes', 'ai_summary', 'document_insights', 'archive_reason', 'archive_note', 'deletion_reason'])),
        allergies: `ENC:${allergyCipher.iv}:${allergyCipher.data}`,
        monitoring_profile: 'synthetic-monitoring', is_adi: 1, is_archived: 1, deleted_at: now - 10, version: 7,
        ambulatory_id: 'w7-amb-primary', created_at: now, updated_at: now + 2,
    });
    insertRow(db, MEMBERSHIP_TABLE, { patient_id: 'w7-patient', ambulatory_id: 'w7-amb-primary', assigned_at: now + 24 });
    insertRow(db, MEMBERSHIP_TABLE, { patient_id: 'w7-patient', ambulatory_id: 'w7-amb-secondary', assigned_at: now + 25 });
    insertRow(db, 'entries', {
        recorded_by: 'Ada Sintetica al momento della registrazione',
        id: 'w7-entry', patient_id: 'w7-patient', type: 'note', date: now + 3,
        ...(await sealed('entries', ['title', 'content', 'metadata', 'attachments', 'deletion_reason'])),
        setting: 'ambulatorio', deleted_at: now + 4, version: 4, created_at: now + 3, updated_at: now + 4,
    });
    insertRow(db, 'therapies', {
        id: 'w7-therapy', patient_id: 'w7-patient', drug_name: 'Farmaco sintetico', dosage: '1 unita', status: 'stopped',
        start_date: now + 5, end_date: now + 6, motivation: await seal('therapies.motivation'), deletion_reason: await seal('therapies.deletion_reason'),
        active_principle: 'Principio sintetico', diagnosis_code: 'SYN', diagnosis_name: 'Condizione sintetica', aic: 'W7AIC', atc: 'W7ATC',
        version: 5, created_at: now + 5, updated_at: now + 6, deleted_at: now + 6,
    });
    insertRow(db, 'prosthetic_prescriptions', {
        id: 'w7-prosthetic', patient_id: 'w7-patient', prescribed_at: now + 7, status: 'completed', category: 'standard', iso_code: 'SYN-ISO',
        ...(await sealed('prosthetic_prescriptions', ['description', 'measures', 'clinical_reason', 'regional_prescription_id', 'supplier', 'collaudo_outcome', 'document_refs', 'notes'])),
        collaudo_at: now + 8, source: 'manual', version: 2, created_at: now + 7, updated_at: now + 8,
    });
    insertRow(db, 'service_catalog_entries', {
        id: 'w7-catalog', code_system: 'urn:synthetic', service_code: 'W7-SERVICE', display_name: 'Prestazione sintetica', category: 'laboratory',
        branch_code: 'SYN', synonyms: '["fixture"]', source: 'manual', version: 'w7', active: 1, imported_at: now + 9, updated_at: now + 9,
    });
    insertRow(db, 'service_prescriptions', {
        id: 'w7-service', patient_id: 'w7-patient', prescribed_at: now + 10, status: 'performed', category: 'laboratory', priority: 'routine',
        code_system: 'urn:synthetic', service_code: 'W7-SERVICE',
        ...(await sealed('service_prescriptions', ['service_name', 'clinical_question', 'provider', 'outcome_note', 'request_reference', 'document_refs', 'notes'])),
        scheduled_at: now + 11, performed_at: now + 12, report_received_at: now + 13, source: 'manual', version: 6, created_at: now + 10, updated_at: now + 13,
    });
    insertRow(db, 'service_prescription_items', {
        id: 'w7-service-item', patient_id: 'w7-patient', prescription_id: 'w7-service', ordinal: 0, status: 'performed', category: 'laboratory',
        code_system: 'urn:synthetic', service_code: 'W7-SERVICE', catalog_entry_id: 'w7-catalog', match_status: 'manual', confidence: '1',
        ...(await sealed('service_prescription_items', ['service_name', 'catalog_display_name', 'evidence', 'notes', 'outcome_note'])),
        scheduled_at: now + 11, performed_at: now + 12, report_received_at: now + 13, version: 3, created_at: now + 10, updated_at: now + 13,
    });
    insertRow(db, 'observations', {
        id: 'w7-observation', patient_id: 'w7-patient', code_system: 'http://loinc.org', code: 'W7', display: 'Osservazione sintetica',
        unit_system: 'http://unitsofmeasure.org', unit_code: '1', value: '42', notes: await seal('observations.notes'), observed_at: now + 14,
        source: 'manual', ref_low: '1', ref_high: '100', ref_text: 'fixture', service_prescription_item_id: 'w7-service-item',
        deletion_reason: await seal('observations.deletion_reason'), version: 4, created_at: now + 14, updated_at: now + 15, deleted_at: now + 15,
    });
    insertRow(db, 'checkups', {
        id: 'w7-checkup', patient_id: 'w7-patient', date: now + 16, title: 'Controllo sintetico', notes: await seal('checkups.notes'),
        status: 'done', source: 'manual', deletion_reason: await seal('checkups.deletion_reason'), version: 2, created_at: now + 16, updated_at: now + 17, deleted_at: now + 17,
    });
    insertRow(db, 'siss_handoff_events', {
        id: 'w7-siss', patient_id: 'w7-patient', action: 'open', module_label: 'Modulo sintetico',
        ...(await sealed('siss_handoff_events', ['reason', 'next_action', 'notes', 'correlation_id'])),
        started_at: now + 18, completed_at: now + 19, outcome: 'completed', created_at: now + 18, updated_at: now + 19,
    });
    const proposal = {
        id: 'w7-proposal', patient_id: 'w7-patient', source_document_key: 'source-hmac-w7', candidate_key: 'candidate-hmac-w7',
        payload: await seal('document_diagnosis_proposals.payload'), status: 'accepted', confidence: 'high', decided_at: now + 20,
        decision_actor_type: 'user', decision_actor_ref: 'actor-synthetic', decision_payload: await seal('document_diagnosis_proposals.decision_payload'),
        version: 9, created_at: now + 20, updated_at: now + 21,
    };
    insertRow(db, 'document_diagnosis_proposals', proposal);
    assert.throws(() => insertRow(db, 'document_diagnosis_proposals', { ...proposal, id: 'w7-proposal-duplicate' }), /UNIQUE/);
    insertRow(db, 'document_diagnosis_proposals', {
        ...proposal,
        id: 'w7-proposal-other-source', source_document_key: 'source-hmac-w7-other', status: 'pending', decided_at: null,
        decision_actor_type: null, decision_actor_ref: null, decision_payload: null,
    });
    insertRow(db, 'physician_review_attestations', {
        actor_ref: actorRef,
        schema_version: 'mediflow.physician-review-attestation.v1',
        capability: 'physician_terminal_review',
        status: 'active',
        attestation_version: 1,
        policy_version: 'physician_terminal_review.v1',
        revoked_at: null,
        created_at: now + 22,
        updated_at: now + 22,
    });
    insertRow(db, 'attachments', {
        id: 'w7-attachment', patient_id: 'w7-patient', type: 'application/pdf', size: 128,
        ...(await sealed('attachments', ['name', 'path', 'summary_snapshot', 'parse_evidence_artifact_snapshot', 'ocr_replay_artifact_snapshot'])),
        data: fileGolden.data,
        ocr_queue_state: 'ocr_done', ocr_queue_reason: 'synthetic', ocr_queue_updated_at: now + 22, created_at: now + 22,
        document_source_ref: 'a'.repeat(64), document_revision: 7, document_freshness_epoch: 11,
    });
    insertRow(db, 'conversations', { id: 'w7-conversation', title: await seal('conversations.title'), updated_at: now + 23, is_archived: 1, is_deleted: 1, created_at: now + 23 });
    insertRow(db, 'messages', {
        id: 'w7-message', conversation_id: 'w7-conversation', role: 'user', content: await seal('messages.content'), metadata: await seal('messages.metadata'),
        attachment_type: 'application/octet-stream', attachment_base64: await seal('messages.attachment_base64'), created_at: now + 24,
    });
    insertRow(db, 'drugs', { aic: 'W7AIC', name: 'Farmaco sintetico', active_principle: 'Principio sintetico', company: 'Azienda sintetica', packaging: 'Fixture', packaging_search: 'fixture', class: 'A', price: 123, atc: 'W7ATC' });
    insertRow(db, 'exemptions', { code: 'W7EX', description: 'Esenzione sintetica', type: 'synthetic', source: 'fixture', start_date: now, end_date: now + 30, is_pharma: 1, is_specialist: 1, is_national: 0, updated_at: now + 25 });
    /* Produce a real receipt using only an invented catalog row. */
    const bytes = Buffer.from([EXEMPTION_COLUMNS.join('|'), ['ZZ_BACKUP', 'Esenzione inventata backup', '\\N', '\\N', '\\N', 'S', 'N', '\\N'].join('|')].join('\r\n') + '\r\n');
    const preview = previewExemptionImport(db, bytes, 'inventato-backup.txt', 'synthetic-backup-operator');
    assert.ok(preview.proof);
    commitExemptionImport(db, { bytes, sourceName: 'inventato-backup.txt', proof: preview.proof, acceptSubset: true }, 'synthetic-backup-operator');
}

function primaryKeyColumns(db: Database.Database, table: string): string[] {
    return (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string; pk: number }>)
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name);
}

function readOrderedRows(db: Database.Database, table: string): Array<Record<string, unknown>> {
    const primaryKey = primaryKeyColumns(db, table);
    assert.ok(primaryKey.length > 0, `${table} must expose a primary key for record-by-record comparison`);
    const rows = db.prepare(
        `SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${primaryKey.map(quoteIdentifier).join(', ')}`,
    ).all() as Array<Record<string, unknown>>;
    return rows.map(row => typeof row.catalog_snapshot === 'string' ? { ...row, catalog_snapshot: stableStringify(JSON.parse(row.catalog_snapshot)) } : row);
}

type RestoreFenceMode = 'complete' | 'throw' | 'async' | 'missing';

function restoreArtifact(
    targetDataDir: string,
    artifactPath: string,
    fenceMode: RestoreFenceMode = 'complete',
): void {
    const artifactUrl = pathToFileURL(path.join(ROOT, 'lib/backup-artifact.ts')).href;
    const executorUrl = pathToFileURL(path.join(ROOT, 'lib/backup-restore-executor.ts')).href;
    const source = `
        import fs from 'node:fs';
        import { parseBackupArtifact } from ${JSON.stringify(artifactUrl)};
        import { restoreBackupArtifact } from ${JSON.stringify(executorUrl)};
        const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(process.env.W7_ARTIFACT_PATH, 'utf8')));
        const mode = process.env.W7_RESTORE_FENCE_MODE;
        if (mode === 'missing') {
            restoreBackupArtifact(artifact);
        } else {
            restoreBackupArtifact(artifact, () => {
                if (mode === 'throw') throw new Error('synthetic fence failure');
                if (mode === 'async') return Promise.resolve(false);
                return false;
            });
        }
    `;
    runNode(
        ['--experimental-strip-types', '--import', LOADER, '--input-type=module', '--eval', source],
        {
            MEDIFLOW_DATA_DIR: targetDataDir,
            W7_ARTIFACT_PATH: artifactPath,
            W7_RESTORE_FENCE_MODE: fenceMode,
        },
    );
}

/* Exercises the real proposal owner across a same-ID/version restore in one Web process. */
function exerciseCheckupAbaRestoreFence(targetDataDir: string, artifactPath: string): Record<string, unknown> {
    const artifactUrl = pathToFileURL(path.join(ROOT, 'lib/backup-artifact.ts')).href;
    const executorUrl = pathToFileURL(path.join(ROOT, 'lib/backup-restore-executor.ts')).href;
    const ownerUrl = pathToFileURL(path.join(ROOT, 'lib/security/headless-checkup-status-transition-web-owner.ts')).href;
    const ipcUrl = pathToFileURL(path.join(ROOT, 'packages/aip/src/checkup-status-transition-ipc.ts')).href;
    const source = `
        import fs from 'node:fs';
        import { parseBackupArtifact } from ${JSON.stringify(artifactUrl)};
        import { restoreBackupArtifact } from ${JSON.stringify(executorUrl)};
        import { createHeadlessCheckupStatusTransitionWebOwnerV1 } from ${JSON.stringify(ownerUrl)};
        import { CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, decodeCheckupStatusTransitionIpcFrameV1,
            encodeCheckupStatusTransitionIpcFrameV1 } from ${JSON.stringify(ipcUrl)};
        const closed = (value) => Object.freeze(Object.assign(Object.create(null), value));
        const operationId = 'mediflow.patient.checkup.status.transition.v1';
        const owner = createHeadlessCheckupStatusTransitionWebOwnerV1(closed({
            now: () => 1_802_000_000_000,
            readHostScopeCandidate: () => closed({ status: 'available', actorRef: 'synthetic-restore-actor',
                patientId: 'restore-aba-patient', ambulatoryId: 'restore-aba-ambulatory',
                checkupId: 'restore-aba-checkup', generation: 1, revocationGeneration: 0, selectionEpoch: 1 }),
            readCurrentUiContext: async () => closed({ status: 'available', actorRef: 'synthetic-restore-actor',
                sessionRef: 'synthetic-restore-session', role: 'physician', generation: 1,
                revocationGeneration: 0, selectionEpoch: 1 }),
            verifyFreshPin: async () => closed({ actorRef: 'synthetic-restore-actor',
                sessionRef: 'synthetic-restore-session' }),
            writeDenialAudit: async () => {},
        }));
        const checkupRef = owner.hostUi.issueSelectedCheckupRef();
        const projection = owner.hostUi.readSelectedCheckupUiProjection(checkupRef);
        const previewFrame = encodeCheckupStatusTransitionIpcFrameV1({
            schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1,
            type: 'preview', requestRef: 'hcqr_00000000000000000000000000000001', operationId,
            input: { schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1', operationId,
                checkupRef, targetStatus: 'completed', expectedRevision: projection.expectedRevision },
        });
        const preview = decodeCheckupStatusTransitionIpcFrameV1(await owner.parent.handlePreview(previewFrame));
        const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(process.env.W7_ARTIFACT_PATH, 'utf8')));
        restoreBackupArtifact(artifact, owner.dispose);
        let proposalDenial = null;
        try { await owner.hostUi.readCurrentProposal(preview.proposalRef); }
        catch (error) { proposalDenial = error?.code ?? error?.message ?? 'denied'; }
        let authorityDenial = null;
        try { owner.hostUi.readSelectedCheckupUiProjection(checkupRef); }
        catch (error) { authorityDenial = error?.code ?? error?.message ?? 'denied'; }
        process.stdout.write(JSON.stringify({ previewOutcome: preview.outcome, proposalDenial, authorityDenial }));
    `;
    return JSON.parse(runNode(
        ['--experimental-strip-types', '--import', LOADER, '--input-type=module', '--eval', source],
        { MEDIFLOW_DATA_DIR: targetDataDir, W7_ARTIFACT_PATH: artifactPath },
    )) as Record<string, unknown>;
}

function countRows(db: Database.Database, table: string, where = ''): number {
    return (db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} ${where}`).get() as { count: number }).count;
}

test('requires a synchronous runtime fence before the first destructive restore mutation', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-backup-runtime-fence-'));
    const targetDataDir = path.join(workDir, 'target');
    const artifactPath = path.join(workDir, 'empty.mediflow');
    try {
        prepareDatabase(targetDataDir);
        fs.writeFileSync(artifactPath, await serializeBackupArtifact(createEmptyDataset()));
        const target = new Database(path.join(targetDataDir, 'medical.db'));
        try {
            insertRow(target, 'ambulatories', {
                id: 'restore-fence-sentinel',
                name: 'Sentinella sintetica pre-restore',
                type: 'synthetic',
                created_at: 1_783_000_000,
            });
            for (const mode of ['missing', 'throw', 'async'] as const) {
                assert.throws(
                    () => restoreArtifact(targetDataDir, artifactPath, mode),
                    (error: unknown) => String((error as { stderr?: unknown }).stderr ?? error)
                        .includes('Restore blocked: runtime mutation fence unavailable.'),
                );
                assert.equal(countRows(target, 'ambulatories', "WHERE id = 'restore-fence-sentinel'"), 1);
            }
            restoreArtifact(targetDataDir, artifactPath);
            assert.equal(countRows(target, 'ambulatories', "WHERE id = 'restore-fence-sentinel'"), 0);
        } finally { target.close(); }
    } finally { fs.rmSync(workDir, { recursive: true, force: true }); }
});

test('retires a pending Checkup proposal before a same-ID/version restore ABA swap', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-backup-checkup-aba-'));
    const targetDataDir = path.join(workDir, 'target');
    const artifactPath = path.join(workDir, 'replacement.mediflow');
    try {
        prepareDatabase(targetDataDir);
        const target = new Database(path.join(targetDataDir, 'medical.db'));
        try {
            clearBackupTables(target, [...Object.values(BACKUP_TABLES), MEMBERSHIP_TABLE]);
            insertRow(target, 'ambulatories', {
                id: 'restore-aba-ambulatory', name: 'Ambulatorio sintetico ABA', type: 'synthetic',
                version: 1, created_at: 1_783_000_000,
            });
            insertRow(target, 'patients', {
                id: 'restore-aba-patient', first_name: 'Synthetic', last_name: 'Before', tax_code: 'SYNTHETIC-ABA',
                ambulatory_id: 'restore-aba-ambulatory', is_archived: 0, version: 1,
                created_at: 1_783_000_000, updated_at: 1_783_000_000,
            });
            insertRow(target, MEMBERSHIP_TABLE, {
                patient_id: 'restore-aba-patient', ambulatory_id: 'restore-aba-ambulatory', assigned_at: 1_783_000_000,
            });
            insertRow(target, 'checkups', {
                id: 'restore-aba-checkup', patient_id: 'restore-aba-patient', date: 1_783_000_100,
                title: 'Checkup sintetico prima del restore', status: 'pending', source: 'manual', version: 1,
                created_at: 1_783_000_100, updated_at: 1_783_000_100,
            });
        } finally { target.close(); }

        const payload = createEmptyDataset();
        payload.ambulatories = [{
            id: 'restore-aba-ambulatory', name: 'Ambulatorio sintetico ABA', type: 'synthetic',
            version: 1, createdAt: '2026-07-01T08:00:00.000Z',
        }];
        payload.patients = [{
            id: 'restore-aba-patient', firstName: 'Synthetic', lastName: 'After', taxCode: 'SYNTHETIC-ABA',
            ambulatoryId: 'restore-aba-ambulatory', assignedAmbulatoryIds: ['restore-aba-ambulatory'],
            isArchived: false, version: 1, createdAt: '2026-07-01T08:00:00.000Z',
            updatedAt: '2026-07-01T08:00:00.000Z',
        }];
        payload.checkups = [{
            id: 'restore-aba-checkup', patientId: 'restore-aba-patient', date: '2026-07-01T09:00:00.000Z',
            title: 'Checkup sintetico dopo il restore', status: 'pending', source: 'manual', version: 1,
            createdAt: '2026-07-01T09:00:00.000Z', updatedAt: '2026-07-01T09:00:00.000Z',
        }];
        fs.writeFileSync(artifactPath, await serializeBackupArtifact(payload));

        assert.deepEqual(exerciseCheckupAbaRestoreFence(targetDataDir, artifactPath), {
            previewOutcome: 'proposed',
            proposalDenial: 'invalid_input',
            authorityDenial: 'operation_unavailable',
        });
        const restored = new Database(path.join(targetDataDir, 'medical.db'), { readonly: true });
        try {
            assert.deepEqual(
                restored.prepare('SELECT title, status, version FROM checkups WHERE id = ?')
                    .get('restore-aba-checkup'),
                { title: 'Checkup sintetico dopo il restore', status: 'pending', version: 1 },
            );
        } finally { restored.close(); }

    } finally { fs.rmSync(workDir, { recursive: true, force: true }); }
});

test('scheduled backup restores every clinical table and preserves ciphertext bytes', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-backup-roundtrip-'));
    const sourceDataDir = path.join(workDir, 'source');
    const targetDataDir = path.join(workDir, 'target');
    const backupDir = path.join(workDir, 'backups');
    const restoredBackupDir = path.join(workDir, 'restored-backups');

    try {
        prepareDatabase(sourceDataDir);
        prepareDatabase(targetDataDir);
        fs.mkdirSync(backupDir, { recursive: true });
        fs.mkdirSync(restoredBackupDir, { recursive: true });

        const sourceDb = new Database(path.join(sourceDataDir, 'medical.db'));
        const targetDb = new Database(path.join(targetDataDir, 'medical.db'));
        try {
            const sourceActorRef = alignSyntheticAuthorityActor(sourceDb);
            assert.equal(alignSyntheticAuthorityActor(targetDb), sourceActorRef);
            const actualSchemaTables = schemaTables(sourceDb);
            const expectedSchemaTables = [
                ...NON_BACKUP_TABLES,
                ...LOCAL_ONLY_AUTHORITY_TABLES,
                ...Object.values(BACKUP_TABLES),
                MEMBERSHIP_TABLE,
            ].sort();
            assert.deepEqual(actualSchemaTables, expectedSchemaTables, 'new schema tables must be backed up or explicitly classified');
            assert.deepEqual([...Object.keys(BACKUP_TABLES)].sort(), [...BACKUP_COLLECTIONS].sort());

            const clinicalTables = actualSchemaTables.filter((table) => !NON_BACKUP_TABLES.has(table)
                && !LOCAL_ONLY_AUTHORITY_TABLES.has(table));
            clearBackupTables(sourceDb, clinicalTables);
            clearBackupTables(targetDb, clinicalTables);
            const targetInitialAudits = readOrderedRows(targetDb, 'audit_events');
            await populateSyntheticClinicalFixture(sourceDb, sourceActorRef);
            /* Include nonempty synthetic repertory and receipt in the total round-trip gate. */
            const prosthetics = createProstheticsCatalog(sourceDb), catalogBytes = Buffer.from(PROSTHETICS_TEMPLATE);
            const catalogPreview = prosthetics.preview(catalogBytes, 'synthetic-roundtrip.csv', 'synthetic-backup');
            prosthetics.commit({ bytes: catalogBytes, sourceName: 'synthetic-roundtrip.csv', proof: catalogPreview.proof!, acceptSubset: true }, 'synthetic-backup', () => {});
            if (process.platform !== 'win32') {
                fs.chmodSync(sourceDataDir, 0o700);
                for (const suffix of ['', '-wal', '-shm']) {
                    const file = path.join(sourceDataDir, `medical.db${suffix}`);
                    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
                }
            }
            const sourceId = prosthetics.sources().sources[0].id;
            prosthetics.addDocument({ sourceId, revision: prosthetics.status().revision, name: 'originale-sintetico.pdf',
                base64: Buffer.from('%PDF-1.4 Originale sintetico').toString('base64'), page: '2' }, () => {});
            const selection = { entryId: prosthetics.search('').entries[0].id, revision: prosthetics.status().revision };
            sourceDb.prepare('UPDATE prosthetic_prescriptions SET catalog_snapshot=? WHERE id=?').run(JSON.stringify(prosthetics.snapshot(selection)), 'w7-prosthetic');

            for (const table of clinicalTables) {
                assert.deepEqual(readOrderedRows(targetDb, table), table === 'audit_events' ? targetInitialAudits : [], `target ${table} retains only its initial host audit before restore`);
                assert.ok(readOrderedRows(sourceDb, table).length > 0, `source ${table} must contain a synthetic fixture`);
            }

            const runner = JSON.parse(runNode(['scripts/run-scheduled-backup.mjs'], {
                MEDIFLOW_DATA_DIR: sourceDataDir,
                MEDIFLOW_BACKUP_DEST_DIR: backupDir,
                MEDIFLOW_BACKUP_FORCE: '1',
            })) as { ok: boolean; artifactPath?: string; message?: string };
            assert.equal(runner.ok, true, runner.message);
            assert.ok(runner.artifactPath);

            const schedulerRow = sourceDb.prepare("SELECT value FROM settings WHERE key = 'backupScheduler'").get() as { value: string };
            const schedulerState = JSON.parse(schedulerRow.value);
            assert.equal(schedulerState.run.lastRunStatus, 'success');
            assert.equal(schedulerState.run.lastArtifactPath, runner.artifactPath);
            assert.equal(typeof schedulerState.run.lastRunAt, 'string');
            assert.equal(schedulerState.run.lastRetentionMode, null);

            const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(runner.artifactPath, 'utf8')));
            for (const [collection, table] of Object.entries(BACKUP_TABLES)) {
                assert.equal(artifact.manifest.recordCounts[collection as keyof typeof BACKUP_TABLES], readOrderedRows(sourceDb, table).length);
            }

            restoreArtifact(targetDataDir, runner.artifactPath);

            let encryptedFieldCount = 0;
            for (const table of clinicalTables) {
                const sourceRows = readOrderedRows(sourceDb, table);
                const allTargetRows = readOrderedRows(targetDb, table);
                if (table === 'audit_events') {
                    const imports = allTargetRows.filter(row => row.event_type === 'backup.portable.imported');
                    assert.equal(imports.length, 1);
                    assert.equal(imports[0].subject_ref, artifact.manifest.checksum);
                    const markers = allTargetRows.filter(row => row.event_type === 'backup.audit.imported');
                    assert.deepEqual(markers.map(row => row.subject_ref).sort(), sourceRows.map(row => row.event_id).sort());
                    assert.ok(markers.every(row => row.request_id === imports[0].event_id));
                }
                const targetRows = table === 'audit_events' ? allTargetRows.filter(row => !['backup.portable.imported', 'backup.audit.imported', 'backup.therapy-command.imported'].includes(String(row.event_type))) : allTargetRows;
                // The activation is a grant of the source host: the physician attestation reaches the target inactive.
                const expectedRows: Array<Record<string, unknown>> = table === 'physician_review_attestations' ? sourceRows.map(row => row.status === 'active' ? { ...row, status: 'inactive' } : row)
                    : table === 'audit_events' ? [...sourceRows, ...targetInitialAudits].sort((a, b) => String(a.event_id).localeCompare(String(b.event_id))) : sourceRows;
                assert.equal(targetRows.length, expectedRows.length, `${table} count must survive restore`);
                assert.deepEqual(targetRows, expectedRows, `${table} rows must reach the target as the restore contract declares`);

                for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex += 1) {
                    for (const [column, value] of Object.entries(sourceRows[rowIndex])) {
                        if (typeof value !== 'string' || !isCiphertext(value)) continue;
                        encryptedFieldCount += 1;
                        assert.equal(
                            Buffer.from(String(targetRows[rowIndex][column])).compare(Buffer.from(value)),
                            0,
                            `${table}.${column} ciphertext must be byte-identical`,
                        );
                    }
                }
            }
            const reexport = JSON.parse(runNode(['scripts/run-scheduled-backup.mjs'], {
                MEDIFLOW_DATA_DIR: targetDataDir,
                MEDIFLOW_BACKUP_DEST_DIR: restoredBackupDir,
                MEDIFLOW_BACKUP_FORCE: '1',
            })) as { ok: boolean; artifactPath?: string; message?: string };
            assert.equal(reexport.ok, true, reexport.message); assert.ok(reexport.artifactPath);
            const restoredArtifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(reexport.artifactPath, 'utf8')));
            const fileKey = await crypto.subtle.importKey('raw', Buffer.from(fileGolden.masterKey, 'base64'), 'AES-GCM', false, ['decrypt']);
            const restoredFile = restoredArtifact.payload.attachments.find(row => row.id === 'w7-attachment')!;
            assert.equal(restoredFile.data, fileGolden.data);
            assert.equal(await openPatientDocumentFile(restoredFile.data as string, fileKey), `data:application/pdf;base64,${fileGolden.original}`);
            assert.deepEqual(restoredArtifact.payload.attachments.map(({ documentSourceRef, documentRevision, documentFreshnessEpoch }) => ({ documentSourceRef, documentRevision, documentFreshnessEpoch })),
                artifact.payload.attachments.map(({ documentSourceRef, documentRevision, documentFreshnessEpoch }) => ({ documentSourceRef, documentRevision, documentFreshnessEpoch })));
            assert.ok(encryptedFieldCount >= 50, 'fixture must exercise the complete encrypted clinical surface');
        } finally {
            sourceDb.close();
            targetDb.close();
        }
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
});

test('patient identity ledgers are present and explicitly classified as local-only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-duplicate-classification-'));
    try {
        bootstrapSchemaGuards(dir);
        const db = new Database(path.join(dir, 'medical.db'));
        try {
            assert.deepEqual(schemaTables(db), [
                ...NON_BACKUP_TABLES, ...LOCAL_ONLY_AUTHORITY_TABLES,
                ...Object.values(BACKUP_TABLES), MEMBERSHIP_TABLE,
            ].sort(), 'every actual table remains classified');
            db.prepare('INSERT INTO patient_duplicate_intents(id) VALUES(?)').run('11cf2a9a-5448-44f2-81b1-4101267477ca');
            assert.deepEqual(db.prepare('SELECT id FROM patient_duplicate_intents').all(), [{ id: '11cf2a9a-5448-44f2-81b1-4101267477ca' }]);
            assert.equal(NON_BACKUP_TABLES.has('patient_duplicate_intents'), true);
            assert.equal(new Set<string>(Object.values(BACKUP_TABLES)).has('patient_duplicate_intents'), false);
            assert.equal(NON_BACKUP_TABLES.has('patient_retired_ids'), true);
            assert.equal(new Set<string>(Object.values(BACKUP_TABLES)).has('patient_retired_ids'), false);
            assert.deepEqual([...Object.keys(BACKUP_TABLES)].sort(), [...BACKUP_COLLECTIONS].sort());
        } finally { db.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
