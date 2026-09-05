/* @Codex */
import { acquireDocumentSynthesisProductionOperation } from '@/lib/ai-providers/fabric/document-synthesis-production-operation';
import { createDocumentSynthesisCaptureHttpHandler } from '@/lib/ai-providers/fabric/document-synthesis-production-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createDocumentSynthesisCaptureHttpHandler({ acquireOperation: acquireDocumentSynthesisProductionOperation });
