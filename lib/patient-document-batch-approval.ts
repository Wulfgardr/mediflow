import 'server-only';
import { randomUUID } from 'node:crypto';
import { DOSSIER_BATCH_DIGEST, DOSSIER_BATCH_LIMIT, dossierBatchDigest } from './patient-document-batch-contract';
import type { PatientDocumentCreateHost } from './patient-document-create-command';

const LIFETIME = 15 * 60_000;
const deny = (): never => { throw new Error('Dossier batch denied'); };

type Phase = 'review' | 'verifying' | 'confirmed';
type Batch = {
    id: string;
    owner: PatientDocumentCreateHost;
    fingerprint: string;
    startsAt: number;
    phase: Phase;
    remainingRows: Set<string>;
    commands: Set<string>;
    release: () => void;
};

export function createDossierBatchApprovals(clock: () => number) {
    const batches = new Map<object, Batch>();

    function current(batch: Batch, owner: PatientDocumentCreateHost) {
        const age = clock() - batch.startsAt;
        return batches.get(owner.session) === batch && owner.surface === 'web'
            && owner.ambulatoryId === batch.owner.ambulatoryId && owner.archiveGeneration === batch.owner.archiveGeneration
            && owner.actorRef === batch.owner.actorRef && owner.epoch === batch.owner.epoch && age >= 0 && age < LIFETIME;
    }

    function requireBatch(owner: PatientDocumentCreateHost, id: string, phase: Phase): Batch {
        const batch = batches.get(owner.session);
        if (!batch || batch.id !== id || batch.phase !== phase || !current(batch, owner)) return deny();
        return batch;
    }

    return {
        async review(owner: PatientDocumentCreateHost, rows: unknown) {
            if (owner.surface !== 'web' || !Array.isArray(rows) || !rows.length || rows.length > DOSSIER_BATCH_LIMIT
                || !rows.every(row => typeof row === 'string' && DOSSIER_BATCH_DIGEST.test(row))
                || new Set(rows).size !== rows.length) return deny();
            const fingerprint = await dossierBatchDigest(rows);
            batches.get(owner.session)?.release();
            if (batches.size >= 16) return deny();
            const id = randomUUID();
            let releaseOwner = () => {};
            let disposed = false;
            const dispose = () => {
                disposed = true;
                clearTimeout(timer);
                if (batches.get(owner.session)?.id === id) batches.delete(owner.session);
            };
            const release = () => { dispose(); releaseOwner(); };
            const timer = setTimeout(release, LIFETIME);
            timer.unref();
            releaseOwner = owner.retain(dispose);
            if (disposed) { releaseOwner(); return deny(); }
            batches.set(owner.session, { id, owner, fingerprint, startsAt: clock(), phase: 'review',
                remainingRows: new Set(rows), commands: new Set(), release });
            return { batchId: id, fingerprint };
        },
        async confirm(owner: PatientDocumentCreateHost, id: string, fingerprint: unknown, pin: string) {
            const batch = requireBatch(owner, id, 'review');
            if (fingerprint !== batch.fingerprint) { batch.release(); return deny(); }
            batch.phase = 'verifying';
            try {
                if (!await owner.confirm(pin) || !current(batch, owner)) return deny();
                batch.phase = 'confirmed';
                return { status: 'confirmed' as const };
            } finally {
                if (batch.phase === 'verifying') batch.release();
            }
        },
        claimRow(owner: PatientDocumentCreateHost, id: string, digest: string) {
            const batch = requireBatch(owner, id, 'confirmed');
            if (!batch.remainingRows.delete(digest)) return deny();
            const assertCurrent = () => { if (!current(batch, owner)) return deny(); };
            return {
                assertCurrent,
                prepared(commandId: string) { assertCurrent(); batch.commands.add(commandId); },
            };
        },
        claimCommand(owner: PatientDocumentCreateHost, id: string, commandId: string) {
            const batch = requireBatch(owner, id, 'confirmed');
            if (!batch.commands.delete(commandId)) return deny();
            return () => current(batch, owner);
        },
        close(owner: PatientDocumentCreateHost, id: string) {
            const batch = batches.get(owner.session);
            if (batch && batch.id === id && current(batch, owner)) batch.release();
        },
    };
}
