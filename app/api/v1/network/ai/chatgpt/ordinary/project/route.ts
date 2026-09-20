/* @Codex */
import { handleNativeOrdinaryHttp } from '@/lib/chatgpt-product/native-ordinary-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<Response> {
    return handleNativeOrdinaryHttp(request, 'project');
}
export async function DELETE(request: Request): Promise<Response> {
    return handleNativeOrdinaryHttp(request, 'project');
}
