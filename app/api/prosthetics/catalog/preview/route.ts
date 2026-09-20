/* @Codex */
import { prostheticsCatalogRequest } from '@/lib/reference-data/prosthetics-catalog-http';
export const runtime = 'nodejs';
export async function POST(request: Request) { return prostheticsCatalogRequest('preview', request); }
