import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
    parseTerritorialPackCommand, projectTerritorialPacks, TerritorialPackError,
    TERRITORIAL_PACK_SCHEMA, TERRITORIAL_PACK_SETTING_KEY, TERRITORIAL_PACK_INITIALIZATION_KEY,
    TERRITORIAL_PACK_OWNER, type TerritorialPackCapability,
} from './territorial-packs';

const INITIALIZATION_SCHEMA = 'mediflow.territorial-packs.initialization.v1';
type Actor = { actorType: 'user' | 'system'; actorRef: string; sourceSurface: 'web' | 'job' };
function setting(db: Database.Database, key: string): string | undefined {
    return (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value;
}
function initialized(raw: string | undefined): boolean {
    if (raw === undefined) return false;
    try {
        const item = JSON.parse(raw);
        return Object.keys(item).sort().join(',') === 'origin,schemaVersion' && item.schemaVersion === INITIALIZATION_SCHEMA
            && ['new', 'existing'].includes(item.origin);
    } catch { return false; }
}
export function readTerritorialPacks(db: Database.Database): TerritorialPackCapability {
    const raw = setting(db, TERRITORIAL_PACK_SETTING_KEY);
    const marker = setting(db, TERRITORIAL_PACK_INITIALIZATION_KEY);
    if ((marker !== undefined && !initialized(marker)) || (raw !== undefined && !initialized(marker))) return projectTerritorialPacks('invalid');
    return projectTerritorialPacks(raw);
}
function save(db: Database.Database, key: string, value: string): void {
    const result = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    if (result.changes !== 1 || setting(db, key) !== value) throw new Error('Territorial pack persistence failed');
}
function audit(db: Database.Database, eventType: string, actor: Actor, before: string, after: string, origin?: string): void {
    const id = randomUUID();
    const metadata = JSON.stringify({ flags: [`before:${before}`, `after:${after}`, ...(origin ? [`origin:${origin}`] : [])] });
    const result = db.prepare(`INSERT INTO audit_events
        (event_id,schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,redacted_metadata)
        VALUES (?,1,?,unixepoch(),'success',?,?,'settings',?,?,?)`).run(id, eventType, actor.actorType, actor.actorRef,
        TERRITORIAL_PACK_SETTING_KEY, actor.sourceSurface, metadata);
    const stored = db.prepare('SELECT redacted_metadata FROM audit_events WHERE event_id=?').get(id) as { redacted_metadata: string } | undefined;
    if (result.changes !== 1 || stored?.redacted_metadata !== metadata) throw new Error('Required territorial pack audit failed');
}

/** Schema admission alone supplies origin, before consuming its first-install reservation. */
export function initializeTerritorialPacks(db: Database.Database, origin: 'new' | 'existing'): void {
    if (!db.inTransaction) throw new Error('Territorial pack initialization requires the host admission transaction');
    if (setting(db, TERRITORIAL_PACK_INITIALIZATION_KEY) !== undefined || setting(db, TERRITORIAL_PACK_SETTING_KEY) !== undefined) return;
    if (origin === 'existing') {
        save(db, TERRITORIAL_PACK_SETTING_KEY, JSON.stringify({ schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: 1, preset: 'core+it+lom' }));
    }
    save(db, TERRITORIAL_PACK_INITIALIZATION_KEY, JSON.stringify({ schemaVersion: INITIALIZATION_SCHEMA, origin }));
    audit(db, origin === 'existing' ? 'territorial.packs.migrated' : 'territorial.packs.initialized',
        { actorType: 'system', actorRef: TERRITORIAL_PACK_OWNER, sourceSurface: 'job' }, 'core', origin === 'existing' ? 'core+it+lom' : 'core', origin);
}

/** Internal host writer. Transport adapters must admit their authority before calling it. */
export function commitTerritorialPackTransition(db: Database.Database, input: unknown, actor: Actor,
    assertAuthority: () => void): TerritorialPackCapability {
    const command = parseTerritorialPackCommand(input);
    return db.transaction(() => {
        assertAuthority();
        const before = readTerritorialPacks(db);
        if (before.status !== 'ready') throw new TerritorialPackError('configuration_error');
        if (command.expectedRevision !== before.revision) throw new TerritorialPackError('conflict');
        if (command.preset === before.preset) return before;
        const next = { schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: before.revision! + 1, preset: command.preset };
        save(db, TERRITORIAL_PACK_SETTING_KEY, JSON.stringify(next));
        audit(db, 'territorial.packs.changed', actor, before.preset, next.preset);
        return readTerritorialPacks(db);
    }).immediate();
}

/** Call under the operational writer's IMMEDIATE transaction, before mutation or egress. */
export function requireTerritorialPack(db: Database.Database, pack: 'it' | 'lom'): void {
    if (!db.inTransaction) throw new Error('Territorial writer requires a transaction');
    const current = readTerritorialPacks(db);
    if (current.status !== 'ready' || (pack === 'lom' ? current.preset !== 'core+it+lom' : current.preset === 'core')) {
        throw new TerritorialPackError('pack_disabled');
    }
}
