/*
 * WUL-831: riscontro delle diagnosi estratte salvate nei documentInsights storici, sul testo
 * del documento da cui vengono. Lavora su una copia in sola lettura, stampa solo conteggi e
 * impronte e scrive l'elenco nominativo in un file privato (permessi 600) che non esiste già.
 *
 *   MEDIFLOW_PIN=**** node scripts/run-strip-types.mjs scripts/audit-historical-diagnoses.ts \
 *     --db <medical.db> --private-out <elenco-privato.md> [--work-dir <cartella per la copia>]
 */
import { runHistoricalDiagnosisArchiveAudit } from '../lib/historical-diagnosis-archive-audit';

const USAGE = 'Uso: MEDIFLOW_PIN=**** node scripts/run-strip-types.mjs scripts/audit-historical-diagnoses.ts --db <medical.db> --private-out <file.md> [--work-dir <dir>]';

function option(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index > 0 ? process.argv[index + 1] : undefined;
}

const dbPath = option('--db');
const privateOut = option('--private-out');
const pin = process.env.MEDIFLOW_PIN;
if (!dbPath || !privateOut || !pin) {
    console.error(USAGE);
    process.exit(2);
}

runHistoricalDiagnosisArchiveAudit({ dbPath, pin, privateOut, workParent: option('--work-dir') })
    .then((result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); })
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
