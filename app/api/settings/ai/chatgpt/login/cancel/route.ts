/* @Codex */
import { handleAccountRequest } from '@/lib/chatgpt-account/account-production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
    return handleAccountRequest(request, 'login/cancel');
}
