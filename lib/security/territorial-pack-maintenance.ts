import path from 'node:path';
import { openVersionedSqliteDatabase } from '../sqlite-schema-open';
import { openAdmittedSqlite } from '../sqlite-maintenance-admission.mjs';
import { commitTerritorialPackTransition } from '../territorial-pack-store';
import { parseTerritorialPackCommand, TERRITORIAL_PACK_OWNER, TERRITORIAL_PACK_SCHEMA } from '../territorial-packs';

/** Local supervisor entrypoint; never registered in Web, AIP, MCP or Headless dispatch. */
export function runTerritorialPackMaintenance(args: string[], directory: string) {
    if (args.length !== 5 || args[0] !== '--territorial-packs' || args[2] !== '--expected-revision'
        || args[4] !== '--confirm' || !/^(0|[1-9][0-9]*)$/u.test(args[3]) || !path.isAbsolute(directory)) throw new Error('territorial_maintenance_arguments_invalid');
    const command = parseTerritorialPackCommand({ schemaVersion: TERRITORIAL_PACK_SCHEMA,
        preset: args[1], expectedRevision: Number(args[3]), confirmed: true });
    let admission: ReturnType<typeof openAdmittedSqlite> | undefined;
    const db = openVersionedSqliteDatabase(path.join(directory, 'medical.db'), file => {
        admission = openAdmittedSqlite(file, { role: 'territorial-pack-supervisor', sqliteOptions: { fileMustExist: true } });
        return admission.database;
    });
    try {
        return commitTerritorialPackTransition(db, command,
            { actorType: 'system', actorRef: TERRITORIAL_PACK_OWNER, sourceSurface: 'job' }, () => {});
    } finally { if (admission) admission.closeSync(); else db.close(); }
}
