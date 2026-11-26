import { webAmbulatoryDestructiveHttp } from '@/lib/security/web-ambulatory-destructive-http';

export async function POST(request: Request) {
    return webAmbulatoryDestructiveHttp(request, 'execute');
}
