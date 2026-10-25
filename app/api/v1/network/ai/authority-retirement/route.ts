import { handleNativeAuthorityRetirementHttp } from '@/lib/chatgpt-product/native-authority-retirement-http';
export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response> {
    return handleNativeAuthorityRetirementHttp(request);
}
