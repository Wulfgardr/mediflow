/* synthetic data only. */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { installNetworkPatientCookieFixture } from './network-patient-authority-test-fixture';

// PR 910, Web Core su 3009b85e9: due processi contendenti installano la stessa
// fixture nella stessa cartella dati. Chi riscrive il file lo tronca prima di
// scriverlo, e l'altro processo, se carica next/headers in quell'istante, legge
// un modulo vuoto: «cookies is not a function».
test('the next/headers stub keeps cookies() when another process blanks the shared data directory', async () => {
    const dataDir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'cookie-fixture-'));
    const cleanup = installNetworkPatientCookieFixture(dataDir, { cookies: new Map([['ambulatory_id', 'synthetic-scope']]) });
    try {
        // Lo stato che un altro processo lascia mentre riscrive i suoi file.
        for (const name of readdirSync(dataDir)) writeFileSync(join(dataDir, name), '');
        const { cookies } = createRequire(import.meta.url)('next/headers') as { cookies: () => Promise<{ get(name: string): { value: string } | undefined }> };
        assert.equal((await cookies()).get('ambulatory_id')?.value, 'synthetic-scope');
    } finally {
        cleanup();
        rmSync(dataDir, { recursive: true, force: true });
    }
});
