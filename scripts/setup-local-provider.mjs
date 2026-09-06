#!/usr/bin/env node
/* @Codex */
import { parseLocalProviderSetupArgs, runLocalProviderSetup, LocalProviderSetupError } from './local-provider-setup.ts';
try {
    const result = await runLocalProviderSetup(parseLocalProviderSetupArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
    const code = error instanceof LocalProviderSetupError ? error.code : 'local_setup_failed';
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
}
