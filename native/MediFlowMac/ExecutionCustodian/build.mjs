/* @Codex — explicit local build review; never issues a qualification authority.
 * node scripts/run-strip-types.mjs native/MediFlowMac/ExecutionCustodian/build.mjs
 * Requires the installed macOS SDK, nonprivileged user and fixed source bytes. */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMacCustodian, MacNativeBuildError } from '../../../lib/chatgpt-execution/execution-mac-native.ts';
if (process.argv.length !== 2 || process.platform !== 'darwin' || process.getuid?.() === 0) {
    console.error('Mac nonprivileged explicit build only; no arguments, SDK installation or qualification.'); process.exitCode = 2;
} else {
    const root = realpathSync(mkdtempSync('/private/tmp/mfmac-build-')); chmodSync(root, 0o700);
    for (const name of ['runtime', 'tmp']) mkdirSync(join(root, name), { mode: 0o700 });
    try {
        const observed = buildMacCustodian(root, join(dirname(fileURLToPath(import.meta.url)), 'mac-owner.c'));
        console.log(JSON.stringify({ status: 'BUILT_NOT_QUALIFIED', ownedBuildRoot: root, ...observed }, null, 2));
    } catch (error) {
        const retained = error instanceof MacNativeBuildError && error.drainUnconfirmed;
        if (!retained) rmSync(root, { recursive: true, force: false });
        console.error(JSON.stringify({ status: 'HOLD_BUILD', retainedOwnedRoot: retained ? root : null })); process.exitCode = 1;
    }
}
