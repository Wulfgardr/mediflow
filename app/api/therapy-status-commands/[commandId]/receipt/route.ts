import { therapyStatusCommandHttp } from '@/lib/therapy-status-command-http';
export async function GET(request: Request, { params }: { params: Promise<{ commandId: string }> }) {
    return therapyStatusCommandHttp(request, (await params).commandId, 'receipt');
}
