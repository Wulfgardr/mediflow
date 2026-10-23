import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readSqliteArchiveGeneration } from '../archive-generation.ts';
import { readTerritorialPacks } from '../territorial-pack-store.ts';
import { createAipOperationRpcHostV1 } from '../../packages/aip/src/operation-rpc.ts';
import { LOCAL_OPERATION_DESCRIPTOR } from '../../packages/mcp/src/local-operation-contract.ts';
import { deny, type LocalOperationPorts, type LiveContext } from './contract.ts';
import { createLocalOperationJournalCipher } from './journal-cipher.ts';
import { createSqliteLocalOperationJournal } from './sqlite-journal.ts';
import { createLocalOperationService, type LocalCapability } from './service.ts';
import { createLocalOperationRemoteHost } from './remote-host.ts';

type ChildPort = Readonly<{
    subscribe(listener: (frame: unknown) => void): () => void;
    publish(frame: string): void;
    onClose(listener: () => void): () => void;
}>;
type Child = Readonly<{ kind: 'local_operation_child' }>;

/** Local composition root. None of these ports is supplied by MCP, a page, or an HTTP request body. */
export function createLocalOperationHost(ports: Omit<LocalOperationPorts, 'journal' | 'currentTerritory' | 'currentContext' | 'captureArchive'> & {
    database(): Database.Database;
    currentContext(): LiveContext | null;
    currentArchiveKey(): Uint8Array | null;
    sourceSurface: 'native' | 'web';
    requestOpen(): Promise<void>;
    requestResume(capability: LocalCapability): Promise<void>;
}) {
    let closed = false;
    function currentContext() {
        const context = ports.currentContext();
        if (closed || !context || context.expiresAt <= ports.now()
            || context.archiveGeneration !== readSqliteArchiveGeneration(ports.database())) return null;
        return context;
    }
    const cipher = createLocalOperationJournalCipher(ports.currentArchiveKey);
    function journal() {
        const connection = ports.database();
        return createSqliteLocalOperationJournal(connection, { ...cipher,
            actor() {
                const context = currentContext();
                if (!context || context.archiveGeneration !== readSqliteArchiveGeneration(connection)) deny();
                return { operatorId: context.operatorId, sourceSurface: ports.sourceSurface };
            },
        });
    }
    function captureArchive() {
        const connection = ports.database(), context = currentContext();
        const keyHash = () => {
            const key = ports.currentArchiveKey();
            if (!key || key.byteLength !== 32) deny();
            return createHash('sha256').update(key).digest('hex');
        };
        if (!context) deny();
        const installation = context.installationId, generation = context.archiveGeneration, key = keyHash();
        return Object.freeze({ assertCurrent() {
            // Compare the connection before reading any journal/generation of a detached archive.
            if (ports.database() !== connection || keyHash() !== key) deny();
            const live = currentContext();
            if (!live || live.installationId !== installation || live.archiveGeneration !== generation) deny();
        } });
    }
    const service = createLocalOperationService({ ...ports, currentContext, captureArchive,
        currentTerritory: () => readTerritorialPacks(ports.database()),
        journal: {
            read: operationId => journal().read(operationId),
            create: (record, guard) => journal().create(record, guard),
            save: (record, revision, guard, lane) => journal().save(record, revision, guard, lane),
        },
    });
    const children = new Map<Child, { host: ReturnType<typeof createLocalOperationRemoteHost>; dispose(): void }>();
    const sessionBinding = () => {
        const context = currentContext();
        return context ? JSON.stringify([context.installationId, context.archiveGeneration, context.sessionId,
            context.clientId, context.operatorId, context.revocationEpoch]) : null;
    };
    return Object.freeze({
        trusted: service,
        attachChild(port: ChildPort): Child {
            if (!currentContext()) deny();
            const host = createLocalOperationRemoteHost({ service, currentSessionBinding: sessionBinding,
                requestOpen: ports.requestOpen, requestResume: ports.requestResume, now: ports.now });
            const rpc = createAipOperationRpcHostV1({ operations: [{ ...LOCAL_OPERATION_DESCRIPTOR, timeoutMs: 5_000,
                execute: (input: unknown) => host.remote.request(input) }] });
            const handle = rpc.attach({ subscribe: port.subscribe, publish: port.publish });
            const child = Object.freeze({ kind: 'local_operation_child' as const });
            let off = () => {};
            const dispose = () => {
                if (!children.delete(child)) return;
                off(); rpc.revoke(handle); host.remote.close(); service.revoke();
            };
            children.set(child, { host, dispose });
            off = port.onClose(dispose);
            return child;
        },
        publish(child: Child, capability: LocalCapability) {
            const target = children.get(child);
            if (!target || closed) deny();
            return target.host.publish(capability);
        },
        detachChild(child: Child) { children.get(child)?.dispose(); },
        close() {
            if (closed) return;
            for (const child of [...children.values()]) child.dispose();
            service.close(); closed = true;
        },
    });
}
