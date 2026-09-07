/* @Codex */
import { handleAccountRequest } from '@/lib/chatgpt-account/account-production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    return handleAccountRequest(request, 'status');
}
