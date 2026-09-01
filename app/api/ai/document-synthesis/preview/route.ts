/* @Codex */
import { acquireDocumentSynthesisProductionOperation } from '@/lib/ai-providers/fabric/document-synthesis-production-operation';
import { createDocumentSynthesisPreviewHttpHandler } from '@/lib/ai-providers/fabric/document-synthesis-production-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createDocumentSynthesisPreviewHttpHandler({ acquireOperation: acquireDocumentSynthesisProductionOperation });
