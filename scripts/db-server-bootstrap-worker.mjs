/* @Codex */

// Explicitly open db-server to execute the real pragma and schema-guard bootstrap.
// This worker exists only so the concurrency regression can launch the same
// boundary in multiple operating-system processes.
const { openDbServer } = await import('@/lib/db-server');
openDbServer();

console.log('[db-bootstrap-worker] ready');
