/* @Codex */
// This explicit qualification command must never pass by skipping a missing engine.
process.env.MEDIFLOW_TEST_TESSERACT_REAL = '1';
await import('../lib/domain/documents/anydoc-tesseract-desktop.test.ts');
export {};
