process.env.MEDIFLOW_DATA_DIR = process.argv[2];
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('../lib/db-server.ts');
openDbServer();
try {
    const { composeAll } = await import('../lib/test-fixtures/clinical-writer-composition.ts');
    console.log('SYNTHETIC_READY');
    await new Promise<void>(resolve => process.stdin.once('data', () => resolve()));
    try {
        composeAll(process.argv[3]!);
        console.log('SYNTHETIC_APPLIED');
    } catch (error) {
        if (!(error instanceof Error) || error.message !== 'SYNTHETIC_REVISION_CHANGED') throw error;
        console.log(error.message);
    }
} finally { dbServer.$client.close(); }
export {};
