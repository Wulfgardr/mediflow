/*
 * Conta in sola lettura le righe di un archivio MediFlow che non rispettano le
 * regole di stato di WUL-800. Apre il file in sola lettura, non scrive nulla e
 * stampa solo conteggi. Il percorso va indicato esplicitamente.
 *
 *   node scripts/run-strip-types.mjs scripts/count-clinical-status-incoherence.ts <archivio.db>
 */
import Database from 'better-sqlite3';
import { countClinicalStatusIncoherence } from '../lib/clinical-status-incoherence';

const file = process.argv[2];
if (!file) {
    console.error('Uso: node scripts/run-strip-types.mjs scripts/count-clinical-status-incoherence.ts <archivio.db>');
    process.exit(2);
}
const db = new Database(file, { readonly: true, fileMustExist: true });
try {
    process.stdout.write(`${JSON.stringify(countClinicalStatusIncoherence(db), null, 2)}\n`);
} finally {
    db.close();
}
