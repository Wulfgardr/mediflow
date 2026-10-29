import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireTerritorialPack } from '../territorial-pack-store.ts';
import { LocalOperationError, recordSchema, type LocalOperationJournal, type LocalOperationRecord } from './contract.ts';

export const LOCAL_OPERATION_JOURNAL_KEY = 'localOperationJournal.v1';
const journalSchema = z.object({ schema: z.literal('mediflow.local-operation.journal.v1'), records: z.array(recordSchema).max(1000) }).strict();

/** The host supplies the current archive connection and encryption. No keys, public refs or reusable authority are persisted. */
export function createSqliteLocalOperationJournal(db: Database.Database, ports: {
    seal(plaintext: string): string;
    open(ciphertext: string): string;
    actor(): { operatorId: string; sourceSurface: 'native' | 'web' };
    recordConfirmed?(record: LocalOperationRecord): void;
}): LocalOperationJournal {
    function readAll() {
        const row = db.prepare('SELECT value FROM settings WHERE key=?').get(LOCAL_OPERATION_JOURNAL_KEY) as { value: string } | undefined;
        if (!row) return [];
        try {
            const records = journalSchema.parse(JSON.parse(ports.open(row.value))).records;
            if (new Set(records.map(record => record.operationId)).size !== records.length) throw new Error();
            return records;
        } catch { throw new LocalOperationError('corrupt'); }
    }
    function mutate(input: LocalOperationRecord, expectedRevision: number, assertCurrent: () => void, lane: 'core' | 'territorial') {
        const record = recordSchema.parse(input);
        try {
            return db.transaction(() => {
                assertCurrent();
                if (lane === 'territorial') requireTerritorialPack(db, record.territory);
                const records = readAll();
                const index = records.findIndex(item => item.operationId === record.operationId);
                const previous = index < 0 ? null : records[index]!;
                if ((previous?.revision ?? 0) !== expectedRevision || record.revision !== expectedRevision + 1) throw new LocalOperationError('conflict');
                if (!previous && records.some(item => item.patientId === record.patientId && item.practiceId === record.practiceId
                    && item.procedureId === record.procedureId && item.state !== 'confirmed')) throw new LocalOperationError('conflict');
                if (previous && ['patientId', 'practiceId', 'procedureId', 'territory', 'installationId', 'archiveGeneration'].some(key => previous[key as keyof LocalOperationRecord] !== record[key as keyof LocalOperationRecord])) throw new LocalOperationError('conflict');
                if (record.state === 'confirmed' && previous?.state !== 'confirmed') ports.recordConfirmed?.(record);
                if (index < 0) records.push(record); else records[index] = record;
                const plaintext = JSON.stringify(journalSchema.parse({ schema: 'mediflow.local-operation.journal.v1', records }));
                const ciphertext = ports.seal(plaintext);
                if (!ciphertext || ciphertext === plaintext || ports.open(ciphertext) !== plaintext) throw new LocalOperationError('storage_unavailable');
                const changed = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(LOCAL_OPERATION_JOURNAL_KEY, ciphertext);
                if (changed.changes !== 1 || (db.prepare('SELECT value FROM settings WHERE key=?').get(LOCAL_OPERATION_JOURNAL_KEY) as { value: string })?.value !== ciphertext) throw new LocalOperationError('storage_unavailable');
                const actor = ports.actor();
                if (!actor.operatorId || !['native', 'web'].includes(actor.sourceSurface)) throw new LocalOperationError('denied');
                const eventId = randomUUID();
                const metadata = JSON.stringify({ resourceVersion: record.revision, flags: [`state:${record.state}`, `lane:${lane}`] });
                const audit = db.prepare(`INSERT INTO audit_events
                    (event_id,schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,redacted_metadata)
                    VALUES (?,1,'local_operation.changed',?,'success','user',?,'agent_operation',?,?,?)`)
                    .run(eventId, Math.floor(record.updatedAt / 1000), actor.operatorId, record.operationId, actor.sourceSurface, metadata);
                if (audit.changes !== 1 || !(db.prepare('SELECT 1 FROM audit_events WHERE event_id=?').get(eventId))) throw new LocalOperationError('storage_unavailable');
                return structuredClone(record);
            }).immediate();
        } catch (error) {
            if (error instanceof LocalOperationError) throw error;
            throw new LocalOperationError('storage_unavailable');
        }
    }
    return Object.freeze({
        read(operationId: string) { return structuredClone(readAll().find(record => record.operationId === operationId) ?? null); },
        create(record: LocalOperationRecord, assertCurrent: () => void) { return mutate(record, 0, assertCurrent, 'territorial'); },
        save: mutate,
    });
}
