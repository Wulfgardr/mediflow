/* @Codex — explicit account-free parent recipe, never invoked by app startup.
 * node scripts/run-strip-types.mjs lib/chatgpt-execution/execution-mac-c2.mjs
 *      <codex> <mac-owner.c> <frozen-config-schema-dir> <C1-RECEIPT.json>
 */
import { prepareMacProductQualification, MacQualificationFailure } from './execution-mac-qualification.ts';
const args = process.argv.slice(2);
if (args.length !== 4 || args.some(s => !s.startsWith('/'))) {
    console.error('Four explicit absolute artifact paths required; no default HOME or account lookup.'); process.exitCode = 2;
} else {
    const abort = new AbortController();
    const interrupted = () => abort.abort();
    process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
    let prepared;
    try {
        prepared = await prepareMacProductQualification({ binaryPath: args[0], nativeSourcePath: args[1], schemaDirectory: args[2],
            c1ReceiptPath: args[3], signal: abort.signal });
        const observed = prepared.audit();
        const drained = await prepared.close();
        console.log(JSON.stringify({ status: drained ? 'CANDIDATE_BOUNDARY_OBSERVED_NOT_LIVE' : 'HOLD_DRAIN_UNCONFIRMED',
            observed, final: prepared.audit(), login: 'NOT_RUN', providerTurn: 'NOT_RUN', production: 'HELD' }, null, 2));
        process.exitCode = drained ? 0 : 1;
    } catch (error) {
        console.log(JSON.stringify(error instanceof MacQualificationFailure ? { status: 'HOLD', stage: error.stage,
            audit: error.audit, retainedOwnedRoot: error.retainedRoot, login: 'NOT_RUN', providerTurn: 'NOT_RUN', production: 'HELD' }
            : { status: 'HOLD', code: 'unqualified_boundary', login: 'NOT_RUN', providerTurn: 'NOT_RUN' }, null, 2));
        process.exitCode = 1;
    } finally {
        if (prepared) await prepared.close();
        process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    }
}
