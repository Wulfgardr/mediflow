/*
 * WUL-831: riscontro delle diagnosi estratte salvate nei documentInsights storici, sul testo
 * del documento da cui vengono. Lavora su una copia in sola lettura, stampa solo conteggi e
 * impronte e scrive l'elenco nominativo in un file privato (permessi 600) che non esiste già.
 *
 * MEDIFLOW_UNLOCK_SECRET è il segreto di sblocco dell'archivio: il PIN o, se l'account è passato
 * alla passphrase, la passphrase. MEDIFLOW_PIN resta accettata con lo stesso significato.
 *
 *   MEDIFLOW_UNLOCK_SECRET=**** node scripts/run-strip-types.mjs scripts/audit-historical-diagnoses.ts \
 *     --db <medical.db> --private-out <elenco-privato.md> [--work-dir <cartella per la copia>]
 */
import Database from 'better-sqlite3';
import { runHistoricalDiagnosisArchiveAudit } from '../lib/historical-diagnosis-archive-audit';

const USAGE = 'Uso: MEDIFLOW_UNLOCK_SECRET=<PIN o passphrase> node scripts/run-strip-types.mjs scripts/audit-historical-diagnoses.ts --db <medical.db> --private-out <file.md> [--work-dir <dir>]';

function option(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index > 0 ? process.argv[index + 1] : undefined;
}

const dbPath = option('--db');
const privateOut = option('--private-out');
const secret = process.env.MEDIFLOW_UNLOCK_SECRET || process.env.MEDIFLOW_PIN;
if (!dbPath || !privateOut || !secret) {
    console.error(USAGE);
    process.exit(2);
}

runHistoricalDiagnosisArchiveAudit({ dbPath, secret, privateOut, workParent: option('--work-dir'), driver: Database })
    .then((result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); })
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
