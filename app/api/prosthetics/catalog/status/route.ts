/* @Codex */
import { prostheticsCatalogRequest } from '@/lib/reference-data/prosthetics-catalog-http';
export const runtime = 'nodejs';
export async function GET(request: Request) { return prostheticsCatalogRequest('status', request); }
