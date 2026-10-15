import { prostheticsCatalogRequest } from '@/lib/reference-data/prosthetics-catalog-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return prostheticsCatalogRequest('documents', request); }
export async function POST(request: Request) { return prostheticsCatalogRequest('documents', request); }
