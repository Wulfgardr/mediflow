/* @Codex */
import { handleChatGptProductRequest } from '@/lib/chatgpt-product/product-production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
    return handleChatGptProductRequest(request, 'logout');
}
