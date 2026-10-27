import { ambulatoryDestructiveHttp } from '@/lib/security/ambulatory-destructive-http';

export async function POST(request: Request) {
    return ambulatoryDestructiveHttp(request, 'begin');
}
