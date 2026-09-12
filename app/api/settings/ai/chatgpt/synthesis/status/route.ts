/* @Codex */
import { handleChatGptProductRequest } from '@/lib/chatgpt-product/product-production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    return handleChatGptProductRequest(request, 'status');
}
