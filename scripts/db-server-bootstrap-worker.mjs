/* @Codex */

// Importing db-server executes the real pragma and schema-guard bootstrap.
// This worker exists only so the concurrency regression can launch the same
// boundary in multiple operating-system processes.
await import('@/lib/db-server');

console.log('[db-bootstrap-worker] ready');
