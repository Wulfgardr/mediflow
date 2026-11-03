/* Child process for the crash proofs of the account reset journal. Synthetic data only. */
import { openVersionedSqliteDatabase } from '../sqlite-schema-open';
import { resetAccountsDurably, type AccountResetPhase } from './account-reset-journal';

const [file, stopAt] = process.argv.slice(2) as [string, AccountResetPhase];
const db = openVersionedSqliteDatabase(file);
resetAccountsDurably(db, { onPhaseForTest: phase => {
    if (phase !== stopAt) return;
    process.stdout.write(`PHASE:${phase}\n`);
    // Hold every lock and handle the reset owns at this point until the parent sends SIGKILL.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
} });
process.stdout.write('PHASE:returned\n');
