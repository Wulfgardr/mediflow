import { ambulatoryBootstrapHttp } from '@/lib/security/ambulatory-bootstrap-http';
export const runtime = 'nodejs';
export async function POST(request: Request) { return ambulatoryBootstrapHttp(request, 'begin'); }
