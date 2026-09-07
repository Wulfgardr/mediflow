/* @Codex */
import { inspectAnyDocDesktopOcrCapability } from '../lib/domain/documents/anydoc-pdf-child-process-owner';

const capability = inspectAnyDocDesktopOcrCapability();
console.log(JSON.stringify(capability, null, 2));
// Exit zero attests only artifact integrity, never successful OCR or target qualification.
process.exitCode = capability.status === 'artifacts_verified' ? 0 : 1;
